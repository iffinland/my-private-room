import type { PrivateFile } from '../types';
import {
  descriptionIdentifierFor,
  requestQortium,
  base64ToUtf8,
} from './qortium/qortiumClient';
import {
  htmlToPlainText,
  metadataExcerpt,
  plainTextToHtml,
  sanitizeRichText,
  truncateUtf8,
} from '../lib/sanitizeHtml';

/** Schema for the dedicated rich-description QDN resource. */
export const DESCRIPTION_SCHEMA = 'qortium.mpr.description.v1';
export const MAX_DESCRIPTION_TEXT = 10_000;
export const MAX_DESCRIPTION_HTML = 20_000;
export const MAX_DESCRIPTION_DOCUMENT_BYTES = 48_000;

export interface StoredDescriptionDocument {
  schema: typeof DESCRIPTION_SCHEMA;
  format: 'html';
  html: string;
  text: string;
  updatedAt: string;
}

export type DescriptionSource = 'resource' | 'legacy-metadata' | 'none';

export interface LoadedDescription {
  html: string;
  text: string;
  source: DescriptionSource;
  descriptionIdentifier: string;
  updatedAt?: string;
}

export class DescriptionTooLongError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DescriptionTooLongError';
  }
}

/** Build the JSON document that is published as `JSON/<name>/mpr_desc_<id>`. */
export const buildDescriptionDocument = (
  html: string,
  now: Date = new Date(),
): StoredDescriptionDocument | null => {
  const sanitized = sanitizeRichText(html);
  const text = htmlToPlainText(sanitized);

  if (!text) return null;

  if (text.length > MAX_DESCRIPTION_TEXT) {
    throw new DescriptionTooLongError(
      `Description is too long (${text.length}/${MAX_DESCRIPTION_TEXT} characters).`,
    );
  }
  if (sanitized.length > MAX_DESCRIPTION_HTML) {
    throw new DescriptionTooLongError('Description formatting is too complex. Try simplifying it.');
  }

  const document: StoredDescriptionDocument = {
    schema: DESCRIPTION_SCHEMA,
    format: 'html',
    html: sanitized,
    text,
    updatedAt: now.toISOString(),
  };

  if (new TextEncoder().encode(JSON.stringify(document)).length > MAX_DESCRIPTION_DOCUMENT_BYTES) {
    throw new DescriptionTooLongError('Description is too large to publish.');
  }

  return document;
};

/** Plain-text excerpt that fits Core's 240-byte metadata description field. */
export const descriptionMetadataExcerpt = (html: string): string =>
  metadataExcerpt(htmlToPlainText(sanitizeRichText(html)), 240);

const parseDescriptionDocument = (value: unknown): StoredDescriptionDocument | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.schema !== DESCRIPTION_SCHEMA || typeof record.html !== 'string') return null;
  const html = sanitizeRichText(record.html);
  const text =
    typeof record.text === 'string' && record.text.trim()
      ? record.text
      : htmlToPlainText(html);
  if (!text.trim()) return null;
  return {
    schema: DESCRIPTION_SCHEMA,
    format: 'html',
    html,
    text,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(0).toISOString(),
  };
};

const parseFetchedJson = (raw: unknown): unknown => {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  try {
    return JSON.parse(base64ToUtf8(trimmed));
  } catch {
    return null;
  }
};

const cache = new Map<string, LoadedDescription>();

const cacheKey = (name: string, identifier: string): string => `${name}:${identifier}`;

/** Clear the in-memory description cache (used after publishing/deleting). */
export const clearDescriptionCache = (): void => {
  cache.clear();
};

export const clearFileDescriptionCache = (name: string, identifier: string): void => {
  cache.delete(cacheKey(name, identifier));
};

/**
 * Load a rich description. Falls back to the legacy plain-text metadata
 * description for resources published before descriptions existed.
 */
export const loadFileDescription = async (
  ownerName: string,
  file: Pick<PrivateFile, 'identifier' | 'description'>,
): Promise<LoadedDescription> => {
  const key = cacheKey(ownerName, file.identifier);
  const cached = cache.get(key);
  if (cached) return cached;

  const descriptionIdentifier = descriptionIdentifierFor(file.identifier);

  try {
    const raw = await requestQortium({
      action: 'FETCH_QDN_RESOURCE',
      service: 'JSON',
      name: ownerName,
      identifier: descriptionIdentifier,
      encoding: 'base64',
    });
    const parsed = parseDescriptionDocument(parseFetchedJson(raw));
    if (parsed) {
      const loaded: LoadedDescription = {
        html: parsed.html,
        text: parsed.text,
        source: 'resource',
        descriptionIdentifier,
        updatedAt: parsed.updatedAt,
      };
      cache.set(key, loaded);
      return loaded;
    }
  } catch {
    // Missing description is expected for legacy resources; fall through.
  }

  if (file.description && file.description.trim()) {
    const text = truncateUtf8(file.description.trim(), 4_000);
    const loaded: LoadedDescription = {
      html: plainTextToHtml(text),
      text,
      source: 'legacy-metadata',
      descriptionIdentifier,
    };
    cache.set(key, loaded);
    return loaded;
  }

  const empty: LoadedDescription = {
    html: '',
    text: '',
    source: 'none',
    descriptionIdentifier,
  };
  cache.set(key, empty);
  return empty;
};
