import { describe, expect, it } from 'vitest';
import {
  fileCategoryForQdnCategory,
  guessCategory,
  isInternalCategoryId,
  limitTagBytes,
  qdnCategoryFor,
  resolveFileCategory,
  resolveUserTags,
} from './fileCategories';

describe('category mapping', () => {
  it('guesses internal categories from MIME types', () => {
    expect(guessCategory('image/png')).toBe('image');
    expect(guessCategory('video/mp4')).toBe('video');
    expect(guessCategory('audio/ogg')).toBe('audio');
    expect(guessCategory('application/pdf')).toBe('document');
    expect(guessCategory('application/zip')).toBe('archive');
    expect(guessCategory('application/x-unknown')).toBe('other');
  });

  it('maps internal categories to Core-valid QDN categories', () => {
    expect(qdnCategoryFor('document')).toBe('PRODUCTIVITY');
    expect(qdnCategoryFor('image')).toBe('PHOTOGRAPHY');
    expect(qdnCategoryFor('video')).toBe('VIDEO');
    expect(qdnCategoryFor('audio')).toBe('MUSIC');
    expect(qdnCategoryFor('unknown')).toBe('OTHER');
  });

  it('maps QDN categories back to internal categories', () => {
    expect(fileCategoryForQdnCategory('PHOTOGRAPHY')).toBe('image');
    expect(fileCategoryForQdnCategory('BOOKS')).toBe('document');
    expect(fileCategoryForQdnCategory('NOT_A_CATEGORY')).toBeNull();
    expect(fileCategoryForQdnCategory(5)).toBeNull();
  });

  it('prefers an explicit internal tag over QDN metadata', () => {
    expect(resolveFileCategory(['video'], 'PHOTOGRAPHY', 'image/png')).toBe('video');
    expect(resolveFileCategory([], 'PHOTOGRAPHY', 'image/png')).toBe('image');
    expect(resolveFileCategory([], undefined, 'text/plain')).toBe('document');
  });

  it('validates internal category ids', () => {
    expect(isInternalCategoryId('IMAGE')).toBe(true);
    expect(isInternalCategoryId('other')).toBe(true);
    expect(isInternalCategoryId('thumbnail')).toBe(false);
  });
});

describe('tag helpers', () => {
  it('hides internal and derived-resource tags from users', () => {
    expect(resolveUserTags(['image', 'holiday', 'thumbnail', 'description', ' summer '])).toEqual([
      'holiday',
      'summer',
    ]);
  });

  it('caps user tags at four values', () => {
    expect(resolveUserTags(['1', '2', '3', '4', '5'])).toEqual(['1', '2', '3', '4']);
  });

  it('bounds tags to 20 UTF-8 bytes without splitting characters', () => {
    const tag = limitTagBytes('ä'.repeat(20));
    expect(new TextEncoder().encode(tag).length).toBeLessThanOrEqual(20);
    expect(limitTagBytes('  short  ')).toBe('short');
  });
});
