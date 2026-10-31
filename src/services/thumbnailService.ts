/**
 * Bounded, client-side thumbnail generation.
 *
 * Nothing is generated on a VPS and nothing is published unless a real preview
 * was produced: images, the first frame of supported videos, a text excerpt,
 * and the first page of PDFs. Everything else falls back to a file-type icon in
 * the UI, so unsupported formats never add QDN storage.
 *
 * All output is bounded to MAX_THUMBNAIL_WIDTH x MAX_THUMBNAIL_HEIGHT and
 * MAX_THUMBNAIL_BYTES before it is staged for publishing.
 */

export { MAX_THUMBNAIL_BYTES, MAX_THUMBNAIL_HEIGHT, MAX_THUMBNAIL_WIDTH, fitWithin, coverRect } from './thumbnailMath';
import {
  MAX_THUMBNAIL_BYTES,
  MAX_THUMBNAIL_WIDTH,
  coverRect,
  fitWithin,
} from './thumbnailMath';

export const MAX_IMAGE_SOURCE_BYTES = 80 * 1024 * 1024;
export const MAX_PDF_SOURCE_BYTES = 32 * 1024 * 1024;
export const MAX_TEXT_PREVIEW_BYTES = 8 * 1024;
const VIDEO_CAPTURE_TIMEOUT_MS = 12_000;
const IMAGE_DECODE_TIMEOUT_MS = 15_000;
const PDF_RENDER_TIMEOUT_MS = 20_000;

export type ThumbnailSource = 'image' | 'video' | 'text' | 'pdf' | 'custom';

export interface GeneratedThumbnail {
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  source: ThumbnailSource;
}

export type ThumbnailResult =
  | { ok: true; thumbnail: GeneratedThumbnail }
  | { ok: false; reason: string };

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out.`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

const createCanvas = (width: number, height: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
};

const webpSupported = (): boolean => {
  try {
    const canvas = createCanvas(1, 1);
    return canvas.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
};

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Encode a canvas to the smallest acceptable preview. Quality is reduced first,
 * then dimensions, so a pathological image cannot exceed the Thumbnail service
 * bound.
 */
const encodeCanvas = async (
  sourceCanvas: HTMLCanvasElement,
  source: ThumbnailSource,
): Promise<ThumbnailResult> => {
  const mimeType = webpSupported() ? 'image/webp' : 'image/jpeg';
  let canvas = sourceCanvas;

  for (let dimensionPass = 0; dimensionPass < 4; dimensionPass += 1) {
    for (const quality of [0.85, 0.75, 0.65, 0.55, 0.4]) {
      const blob = await canvasToBlob(canvas, mimeType, quality);
      if (!blob) continue;
      if (blob.size <= MAX_THUMBNAIL_BYTES) {
        return {
          ok: true,
          thumbnail: {
            blob,
            mimeType,
            width: canvas.width,
            height: canvas.height,
            source,
          },
        };
      }
    }
    const nextWidth = Math.round(canvas.width * 0.8);
    const nextHeight = Math.round(canvas.height * 0.8);
    if (nextWidth < 64 || nextHeight < 64) break;
    const scaled = createCanvas(nextWidth, nextHeight);
    const ctx = scaled.getContext('2d');
    if (!ctx) break;
    ctx.drawImage(canvas, 0, 0, nextWidth, nextHeight);
    canvas = scaled;
  }

  return { ok: false, reason: 'Thumbnail stayed above the size bound after re-encoding.' };
};

const drawCover = (
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  background = '#0b0f19',
): void => {
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  const rect = coverRect(sourceWidth, sourceHeight, targetWidth, targetHeight);
  ctx.drawImage(image, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, targetWidth, targetHeight);
};

interface DecodedImage {
  image: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
}

const decodeImage = async (file: Blob): Promise<DecodedImage> => {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await withTimeout(
        createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions),
        IMAGE_DECODE_TIMEOUT_MS,
        'Image decode',
      );
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        dispose: () => bitmap.close(),
      };
    } catch {
      // Fall through to the <img> path for older decoders.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await withTimeout(
      new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('This image format could not be decoded.'));
        element.src = url;
      }),
      IMAGE_DECODE_TIMEOUT_MS,
      'Image decode',
    );
    return {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
};

const thumbnailFromImage = async (file: Blob, source: ThumbnailSource): Promise<ThumbnailResult> => {
  const decoded = await decodeImage(file);
  try {
    const target = fitWithin(decoded.width, decoded.height);
    const canvas = createCanvas(target.width, target.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, reason: 'Canvas rendering is unavailable in this browser.' };
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    drawCover(ctx, decoded.image, decoded.width, decoded.height, target.width, target.height);
    return await encodeCanvas(canvas, source);
  } finally {
    decoded.dispose();
  }
};

const thumbnailFromVideo = async (file: File): Promise<ThumbnailResult> => {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;

  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () =>
          reject(new Error('This video codec/container is not supported by the browser.'));
        video.load();
      }),
      VIDEO_CAPTURE_TIMEOUT_MS,
      'Video frame decode',
    );

    if (!video.videoWidth || !video.videoHeight) {
      return { ok: false, reason: 'The video reported no frame dimensions.' };
    }

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const captureAt = duration > 0 ? Math.min(Math.max(duration * 0.1, 0.1), 5) : 0;

    if (captureAt > 0) {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          video.onseeked = () => resolve();
          video.onerror = () => reject(new Error('Seeking the video failed.'));
          video.currentTime = captureAt;
        }),
        VIDEO_CAPTURE_TIMEOUT_MS,
        'Video seek',
      );
    }

    const target = fitWithin(video.videoWidth, video.videoHeight);
    const canvas = createCanvas(target.width, target.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, reason: 'Canvas rendering is unavailable in this browser.' };
    drawCover(ctx, video, video.videoWidth, video.videoHeight, target.width, target.height, '#000000');
    return await encodeCanvas(canvas, 'video');
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
};

const truncateForCanvas = (value: string, maxChars: number): string =>
  value.length > maxChars ? `${value.slice(0, Math.max(0, maxChars - 1))}…` : value;

const thumbnailFromText = async (file: File, text: string): Promise<ThumbnailResult> => {
  const width = MAX_THUMBNAIL_WIDTH;
  const height = 320;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ok: false, reason: 'Canvas rendering is unavailable in this browser.' };

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#0f172a');
  gradient.addColorStop(1, '#1e293b');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = 'rgba(99, 102, 241, 0.9)';
  ctx.fillRect(0, 0, 6, height);

  ctx.fillStyle = '#c7d2fe';
  ctx.font = '600 15px system-ui, -apple-system, sans-serif';
  ctx.fillText(truncateForCanvas(file.name, 46), 24, 32);

  ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
  ctx.font = '600 10px ui-monospace, monospace';
  const extension = (file.name.split('.').pop() || 'TEXT').toUpperCase().slice(0, 10);
  ctx.fillText(`${extension} · ${formatBytes(file.size)}`, 24, 49);

  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .slice(0, 17)
    .map((line) => truncateForCanvas(line.replace(/\t/g, '  '), 58));

  ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#e2e8f0';
  if (lines.length === 0 || lines.every((line) => line.trim() === '')) {
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('Empty text file', 24, 84);
  } else {
    lines.forEach((line, index) => {
      ctx.fillText(line, 24, 78 + index * 14);
    });
  }

  return encodeCanvas(canvas, 'text');
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const isTextLike = (file: File): boolean => {
  const mime = (file.type || '').toLowerCase();
  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/javascript' ||
    mime === 'application/x-yaml'
  ) {
    return true;
  }
  return /\.(txt|md|markdown|json|ya?ml|toml|ini|cfg|conf|csv|tsv|log|xml|html?|css|scss|js|mjs|cjs|ts|tsx|jsx|py|rb|rs|go|java|c|h|cpp|hpp|sh|bash|zsh|sql)$/i.test(
    file.name,
  );
};

const isPdf = (file: File): boolean =>
  file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

const readTextPrefix = async (file: File): Promise<string> => {
  const slice = file.slice(0, MAX_TEXT_PREVIEW_BYTES);
  return new TextDecoder('utf-8', { fatal: false }).decode(await slice.arrayBuffer());
};

/**
 * Produce the best preview this browser can make for the file.
 * Never throws; callers render a file-type icon on failure.
 */
export const generateThumbnail = async (file: File): Promise<ThumbnailResult> => {
  try {
    if (file.type.startsWith('image/')) {
      if (file.size > MAX_IMAGE_SOURCE_BYTES) {
        return { ok: false, reason: 'Image is too large to decode safely.' };
      }
      return await thumbnailFromImage(file, 'image');
    }

    if (file.type.startsWith('video/')) {
      return await thumbnailFromVideo(file);
    }

    if (isPdf(file)) {
      if (file.size > MAX_PDF_SOURCE_BYTES) {
        return { ok: false, reason: 'PDF is too large to render a page preview safely.' };
      }
      const { renderPdfThumbnail } = await import('./thumbnailPdf');
      return await withTimeout(renderPdfThumbnail(file), PDF_RENDER_TIMEOUT_MS, 'PDF preview');
    }

    if (isTextLike(file)) {
      return await thumbnailFromText(file, await readTextPrefix(file));
    }

    return { ok: false, reason: 'No safe in-browser preview is available for this file type.' };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Thumbnail generation failed.',
    };
  }
};

/** Re-encode a user-selected image as a bounded custom thumbnail. */
export const normalizeCustomThumbnail = async (file: File): Promise<ThumbnailResult> => {
  if (!file.type.startsWith('image/')) {
    return { ok: false, reason: 'The custom thumbnail must be an image file.' };
  }
  if (file.size > MAX_IMAGE_SOURCE_BYTES) {
    return { ok: false, reason: 'The custom thumbnail image is too large to decode safely.' };
  }
  try {
    return await thumbnailFromImage(file, 'custom');
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Custom thumbnail could not be decoded.',
    };
  }
};
