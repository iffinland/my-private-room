import type { FileCategory } from '../types';

/* ------------------------------------------------------------------ */
/*  Internal file categories                                          */
/* ------------------------------------------------------------------ */

/**
 * Categories used by My File Office for filtering and card icons.
 *
 * These are NOT the QDN metadata categories. QDN requires a value from the
 * Core `Category` enum, so each internal category maps to one through
 * {@link qdnCategoryFor}. The internal id is stored as the first QDN tag so it
 * survives a round-trip without adding another resource.
 */
export const FILE_CATEGORIES: FileCategory[] = [
  {
    id: 'document',
    label: 'Documents',
    icon: 'file-text',
    mimePatterns: ['application/pdf', 'text/', 'application/msword', 'application/vnd.openxmlformats', 'application/vnd.ms-'],
  },
  {
    id: 'image',
    label: 'Images',
    icon: 'image',
    mimePatterns: ['image/'],
  },
  {
    id: 'video',
    label: 'Videos',
    icon: 'video',
    mimePatterns: ['video/'],
  },
  {
    id: 'audio',
    label: 'Audio',
    icon: 'music',
    mimePatterns: ['audio/'],
  },
  {
    id: 'archive',
    label: 'Archives',
    icon: 'archive',
    mimePatterns: ['application/zip', 'application/x-tar', 'application/gzip', 'application/x-7z-compressed', 'application/x-rar'],
  },
  {
    id: 'other',
    label: 'Other',
    icon: 'file',
    mimePatterns: [],
  },
];

const INTERNAL_CATEGORY_IDS = new Set(FILE_CATEGORIES.map((category) => category.id));

/** Guess the internal category for a given MIME type */
export const guessCategory = (mimeType: string): string => {
  const normalized = (mimeType || '').toLowerCase();
  for (const cat of FILE_CATEGORIES) {
    if (cat.mimePatterns.some((pattern) => normalized.startsWith(pattern))) {
      return cat.id;
    }
  }
  return 'other';
};

/** QDN metadata categories accepted by Core, keyed by internal category. */
const QDN_CATEGORY_BY_FILE_CATEGORY: Record<string, string> = {
  document: 'PRODUCTIVITY',
  image: 'PHOTOGRAPHY',
  video: 'VIDEO',
  audio: 'MUSIC',
  archive: 'OTHER',
  other: 'OTHER',
};

const FILE_CATEGORY_BY_QDN_CATEGORY: Record<string, string> = {
  PRODUCTIVITY: 'document',
  BOOKS: 'document',
  KNOWLEDGE: 'document',
  PHOTOGRAPHY: 'image',
  ART: 'image',
  DESIGN: 'image',
  VIDEO: 'video',
  MUSIC: 'audio',
  ENTERTAINMENT: 'audio',
  OTHER: 'other',
  UNCATEGORIZED: 'other',
};

/** Map an internal category to a Core-valid QDN metadata category */
export const qdnCategoryFor = (categoryId: string): string =>
  QDN_CATEGORY_BY_FILE_CATEGORY[categoryId] ?? 'OTHER';

/** Map a QDN metadata category back to an internal category, when known */
export const fileCategoryForQdnCategory = (qdnCategory: unknown): string | null => {
  if (typeof qdnCategory !== 'string') return null;
  return FILE_CATEGORY_BY_QDN_CATEGORY[qdnCategory.toUpperCase()] ?? null;
};

export const isInternalCategoryId = (value: string): boolean =>
  INTERNAL_CATEGORY_IDS.has(value.toLowerCase());

/**
 * Resolve the internal category from QDN metadata tags/category, falling back
 * to MIME sniffing. Legacy resources published by this app before Home 2 used
 * `tag1` for the category, which Core surfaced as the first tag.
 */
export const resolveFileCategory = (
  tags: string[],
  qdnCategory: unknown,
  mimeType: string,
): string => {
  for (const tag of tags) {
    const normalized = tag.trim().toLowerCase();
    if (INTERNAL_CATEGORY_IDS.has(normalized)) return normalized;
  }
  const fromQdn = fileCategoryForQdnCategory(qdnCategory);
  if (fromQdn) return fromQdn;
  return guessCategory(mimeType);
};

/** Remove the internal category marker from user-visible tags */
export const resolveUserTags = (tags: string[]): string[] =>
  tags
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0 && !INTERNAL_CATEGORY_IDS.has(tag.toLowerCase()))
    .filter((tag) => tag.toLowerCase() !== 'thumbnail' && tag.toLowerCase() !== 'description')
    .slice(0, 4);

/** Trim a tag to Core's 20-byte limit without splitting a UTF-8 sequence */
export const limitTagBytes = (tag: string, maxBytes = 20): string => {
  let result = '';
  let bytes = 0;
  for (const char of tag.trim()) {
    const charBytes = new TextEncoder().encode(char).length;
    if (bytes + charBytes > maxBytes) break;
    result += char;
    bytes += charBytes;
  }
  return result;
};
