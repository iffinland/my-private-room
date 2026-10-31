/** Pure thumbnail bounds shared by the generator and lazy PDF renderer. */

export const MAX_THUMBNAIL_WIDTH = 512;
export const MAX_THUMBNAIL_HEIGHT = 384;
export const MAX_THUMBNAIL_BYTES = 300_000;

export const fitWithin = (
  width: number,
  height: number,
  maxWidth = MAX_THUMBNAIL_WIDTH,
  maxHeight = MAX_THUMBNAIL_HEIGHT,
): { width: number; height: number } => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 1, height: 1 };
  }
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

export const coverRect = (
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): { sx: number; sy: number; sw: number; sh: number } => {
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;
  if (sourceRatio > targetRatio) {
    const sw = sourceHeight * targetRatio;
    return { sx: (sourceWidth - sw) / 2, sy: 0, sw, sh: sourceHeight };
  }
  const sh = sourceWidth / targetRatio;
  return { sx: 0, sy: (sourceHeight - sh) / 2, sw: sourceWidth, sh };
};
