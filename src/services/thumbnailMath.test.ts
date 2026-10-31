import { describe, expect, it } from 'vitest';
import {
  coverRect,
  fitWithin,
  MAX_THUMBNAIL_BYTES,
  MAX_THUMBNAIL_HEIGHT,
  MAX_THUMBNAIL_WIDTH,
} from './thumbnailMath';

describe('thumbnail bounds', () => {
  it('keeps the documented bounds', () => {
    expect(MAX_THUMBNAIL_WIDTH).toBe(512);
    expect(MAX_THUMBNAIL_HEIGHT).toBe(384);
    expect(MAX_THUMBNAIL_BYTES).toBeLessThanOrEqual(500 * 1024);
  });

  it('scales large images down preserving aspect ratio', () => {
    expect(fitWithin(2000, 1000)).toEqual({ width: 512, height: 256 });
    expect(fitWithin(1000, 2000)).toEqual({ width: 192, height: 384 });
  });

  it('never upscales small images', () => {
    expect(fitWithin(120, 80)).toEqual({ width: 120, height: 80 });
  });

  it('falls back to a valid 1x1 box for invalid dimensions', () => {
    expect(fitWithin(0, 100)).toEqual({ width: 1, height: 1 });
    expect(fitWithin(Number.NaN, 100)).toEqual({ width: 1, height: 1 });
    expect(fitWithin(-5, -5)).toEqual({ width: 1, height: 1 });
  });
});

describe('coverRect', () => {
  it('crops a wide source horizontally', () => {
    expect(coverRect(200, 100, 100, 100)).toEqual({ sx: 50, sy: 0, sw: 100, sh: 100 });
  });

  it('crops a tall source vertically', () => {
    expect(coverRect(100, 200, 100, 100)).toEqual({ sx: 0, sy: 50, sw: 100, sh: 100 });
  });

  it('keeps a matching aspect ratio uncropped', () => {
    expect(coverRect(400, 300, 400, 300)).toEqual({ sx: 0, sy: 0, sw: 400, sh: 300 });
  });
});
