/**
 * First-page PDF thumbnail rendering, loaded lazily so pdf.js only reaches the
 * browser when a PDF is actually selected for publishing.
 */

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ThumbnailResult } from './thumbnailService';
import {
  MAX_THUMBNAIL_BYTES,
  MAX_THUMBNAIL_HEIGHT,
  MAX_THUMBNAIL_WIDTH,
  fitWithin,
} from './thumbnailMath';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

export const renderPdfThumbnail = async (file: File): Promise<ThumbnailResult> => {
  const data = new Uint8Array(await file.arrayBuffer());
  const documentTask = pdfjs.getDocument({ data });
  const pdf = await documentTask.promise;

  try {
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const target = fitWithin(baseViewport.width, baseViewport.height);
    const scale = target.width / baseViewport.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.min(MAX_THUMBNAIL_WIDTH, Math.round(viewport.width)));
    canvas.height = Math.max(1, Math.min(MAX_THUMBNAIL_HEIGHT, Math.round(viewport.height)));

    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, reason: 'Canvas rendering is unavailable in this browser.' };

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const mimeType = 'image/jpeg';
    for (const quality of [0.82, 0.7, 0.58, 0.45]) {
      const blob = await canvasToBlob(canvas, mimeType, quality);
      if (blob && blob.size <= MAX_THUMBNAIL_BYTES) {
        return {
          ok: true,
          thumbnail: {
            blob,
            mimeType,
            width: canvas.width,
            height: canvas.height,
            source: 'pdf',
          },
        };
      }
    }
    return { ok: false, reason: 'PDF preview stayed above the size bound after re-encoding.' };
  } finally {
    await pdf.destroy();
  }
};
