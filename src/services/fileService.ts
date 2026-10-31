import type { PrivateFile, QdnResourceStatus } from '../types';
import {
  requestQortium,
  thumbnailIdentifierFor,
  descriptionIdentifierFor,
  base64ToBytes,
  base64ToUtf8,
} from './qortium/qortiumClient';
import {
  FILE_CATEGORIES,
  resolveFileCategory,
  resolveUserTags,
  fileCategoryForQdnCategory,
} from './fileCategories';

export { FILE_CATEGORIES, guessCategory } from './fileCategories';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

/** QDN service used for file payloads (public — QDN has no private FILE mode) */
const FILE_SERVICE = 'FILE';
const THUMBNAIL_SERVICE = 'THUMBNAIL';
const DESCRIPTION_SERVICE = 'JSON';

const PROPERTY_CONCURRENCY = 6;

/** Successful property lookups for this session (may trigger a node download). */
const propertiesCache = new Map<string, QdnResourceProperties>();

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface QdnListHit {
  name?: string;
  service?: string;
  identifier?: string;
  title?: string;
  filename?: string;
  size?: number;
  created?: number;
  updated?: number;
  metadata?: QdnMetadata;
  [key: string]: unknown;
}

export interface QdnMetadata {
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  mimeType?: string;
  files?: string[];
}

export interface QdnResourceProperties {
  filename: string;
  size: number;
  mimeType: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const run = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  };

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(runners);
  return results;
};

const normalizeTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((tag): tag is string => typeof tag === 'string');
};

/* ------------------------------------------------------------------ */
/*  Fetching & mapping                                                */
/* ------------------------------------------------------------------ */

/** Fetch properties (filename, size, mimeType) for a single QDN resource */
export const getFileProperties = async (
  name: string,
  identifier: string,
): Promise<QdnResourceProperties> => {
  const key = `${name}:${identifier}`;
  const cached = propertiesCache.get(key);
  if (cached) return cached;

  const props = (await requestQortium({
    action: 'GET_QDN_RESOURCE_PROPERTIES',
    service: FILE_SERVICE,
    name,
    identifier,
  })) as QdnResourceProperties;

  const properties: QdnResourceProperties = {
    filename: typeof props?.filename === 'string' ? props.filename : identifier,
    size: typeof props?.size === 'number' ? props.size : 0,
    mimeType: typeof props?.mimeType === 'string' ? props.mimeType : 'application/octet-stream',
  };
  propertiesCache.set(key, properties);
  return properties;
};

/** Fetch mutable QDN metadata for any service/coordinate. */
export const getResourceMetadata = async (
  service: string,
  name: string,
  identifier: string,
): Promise<QdnMetadata | null> => {
  try {
    const metadata = (await requestQortium({
      action: 'GET_QDN_RESOURCE_METADATA',
      service,
      name,
      identifier,
    })) as unknown;
    if (!metadata || typeof metadata !== 'object') return null;
    const record = metadata as Record<string, unknown>;
    return {
      title: typeof record.title === 'string' ? record.title : undefined,
      description: typeof record.description === 'string' ? record.description : undefined,
      category: typeof record.category === 'string' ? record.category : undefined,
      tags: normalizeTags(record.tags),
      mimeType: typeof record.mimeType === 'string' ? record.mimeType : undefined,
      files: normalizeTags(record.files),
    };
  } catch {
    return null;
  }
};

/** Resolve a renderable URL for a published QDN resource */
export const getResourceUrl = async (
  service: string,
  name: string,
  identifier: string,
): Promise<string> => {
  const result = (await requestQortium({
    action: 'GET_QDN_RESOURCE_URL',
    service,
    name,
    identifier,
  })) as unknown;
  if (typeof result === 'string') return result;
  // Some bridge versions wrap the URL; accept the common shapes.
  const record = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  if (typeof record.url === 'string') return record.url;
  throw new Error('Qortium Home did not return a resource URL.');
};

/** Resolve a renderable URL for a published file */
export const getFileUrl = (name: string, identifier: string): Promise<string> =>
  getResourceUrl(FILE_SERVICE, name, identifier);

const thumbnailUrlCache = new Map<string, string | null>();

/**
 * Resolve a published thumbnail URL. Legacy files and fallback-only files have
 * no THUMBNAIL resource; cache the miss so cards do not re-request it.
 */
export const getThumbnailUrl = async (
  ownerName: string,
  fileIdentifier: string,
): Promise<string | null> => {
  const identifier = thumbnailIdentifierFor(fileIdentifier);
  const key = `${ownerName}:${identifier}`;
  if (thumbnailUrlCache.has(key)) return thumbnailUrlCache.get(key) ?? null;

  try {
    const url = await getResourceUrl(THUMBNAIL_SERVICE, ownerName, identifier);
    thumbnailUrlCache.set(key, url);
    return url;
  } catch {
    thumbnailUrlCache.set(key, null);
    return null;
  }
};

export const clearThumbnailUrlCache = (): void => {
  thumbnailUrlCache.clear();
};

/** Check whether a file's MIME type supports in-app preview */
export const canPreviewFile = (mimeType: string): boolean => {
  if (mimeType.startsWith('image/')) return true;
  if (mimeType.startsWith('video/')) return true;
  if (mimeType.startsWith('audio/')) return true;
  if (mimeType === 'application/pdf') return true;
  if (mimeType.startsWith('text/')) return true;
  if (mimeType === 'application/json') return true;
  return false;
};

const mapQdnResultToPrivateFile = (
  raw: QdnListHit,
  metadata: QdnMetadata | null,
  props?: QdnResourceProperties,
): PrivateFile => {
  const identifier = typeof raw.identifier === 'string' ? raw.identifier : '';
  const name = typeof raw.name === 'string' ? raw.name : '';
  const meta = metadata ?? raw.metadata ?? {};

  const fileName =
    props?.filename ||
    (typeof raw.filename === 'string' ? raw.filename : '') ||
    (typeof meta.title === 'string' ? meta.title : '') ||
    (typeof raw.title === 'string' ? raw.title : '') ||
    identifier;

  const mimeType =
    props?.mimeType ||
    (typeof meta.mimeType === 'string' ? meta.mimeType : '') ||
    'application/octet-stream';

  const sizeBytes = props?.size ?? (typeof raw.size === 'number' ? raw.size : 0);
  const metadataTags = normalizeTags(meta.tags);
  const category = resolveFileCategory(metadataTags, meta.category, mimeType);
  const tags = resolveUserTags(metadataTags);
  const uploadedAt =
    typeof raw.created === 'number' ? new Date(raw.created).toISOString() : new Date().toISOString();
  const description =
    typeof meta.description === 'string' && meta.description.trim()
      ? meta.description.trim()
      : undefined;

  return {
    id: `${name}:${identifier}`,
    identifier,
    name,
    fileName,
    mimeType,
    sizeBytes,
    category,
    tags,
    uploadedAt,
    description,
    descriptionIdentifier: descriptionIdentifierFor(identifier),
    thumbnailIdentifier: thumbnailIdentifierFor(identifier),
  };
};

/**
 * List all file-office FILE resources for a publisher.
 *
 * This uses LIST_QDN_RESOURCES with the publisher name (complete enumeration)
 * rather than a prefix search, then reads properties for the real filename,
 * MIME type and decoded size. Metadata comes from the list response when the
 * node supports `includeMetadata`; otherwise it is read per resource.
 */
export const searchMyFiles = async (ownerName: string): Promise<PrivateFile[]> => {
  const raw = await requestQortium<unknown>({
    action: 'LIST_QDN_RESOURCES',
    service: FILE_SERVICE,
    name: ownerName,
    mode: 'ALL',
    includeMetadata: true,
    limit: 1000,
    offset: 0,
    reverse: true,
  });

  const items = (Array.isArray(raw) ? raw : [])
    .map((item) => item as QdnListHit)
    .filter(
      (item) =>
        item.name === ownerName &&
        typeof item.identifier === 'string' &&
        item.identifier.startsWith('mpr_'),
    );

  const mapped = await mapWithConcurrency(items, PROPERTY_CONCURRENCY, async (item) => {
    const identifier = item.identifier as string;
    const [props, metadata] = await Promise.all([
      getFileProperties(item.name as string, identifier).catch(() => undefined),
      item.metadata
        ? Promise.resolve(item.metadata as QdnMetadata)
        : getResourceMetadata(FILE_SERVICE, item.name as string, identifier),
    ]);
    return mapQdnResultToPrivateFile(item, metadata, props);
  });

  return mapped.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
};

/** Fetch the raw content of a published file (returns base64) */
export const fetchFileContent = async (
  ownerName: string,
  identifier: string,
): Promise<string> => {
  const result = (await requestQortium({
    action: 'FETCH_QDN_RESOURCE',
    name: ownerName,
    service: FILE_SERVICE,
    identifier,
    encoding: 'base64',
  })) as unknown;

  if (typeof result === 'string') return result;

  // A bridge/runtime may return the decoded object for JSON resources.
  const record = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  if (typeof record.base64 === 'string') return record.base64;
  if (typeof record.data === 'string') return record.data;
  throw new Error('Qortium Home did not return file content.');
};

/** Decode a fetched file to bytes (used by download). */
export const fetchFileBytes = async (ownerName: string, identifier: string): Promise<Uint8Array> =>
  base64ToBytes(await fetchFileContent(ownerName, identifier));

/** Decode a fetched text/JSON file as UTF-8. */
export const fetchFileText = async (ownerName: string, identifier: string): Promise<string> =>
  base64ToUtf8(await fetchFileContent(ownerName, identifier));

/** Get the status of a published QDN resource */
export const getFileStatus = async (
  ownerName: string,
  identifier: string,
): Promise<QdnResourceStatus> => {
  const result = (await requestQortium({
    action: 'GET_QDN_RESOURCE_STATUS',
    name: ownerName,
    service: FILE_SERVICE,
    identifier,
    build: true,
  })) as Record<string, unknown>;

  return {
    status: typeof result?.status === 'string' ? result.status.toUpperCase() : 'UNKNOWN',
    description: typeof result?.description === 'string' ? result.description : undefined,
    localChunkCount: typeof result?.localChunkCount === 'number' ? result.localChunkCount : undefined,
    totalChunkCount: typeof result?.totalChunkCount === 'number' ? result.totalChunkCount : undefined,
  };
};

const deleteResource = async (
  service: string,
  ownerName: string,
  identifier: string,
): Promise<void> => {
  await requestQortium({
    action: 'DELETE_QDN_RESOURCE',
    name: ownerName,
    service,
    identifier,
  });
};

/**
 * Delete a file and its derived description/thumbnail resources.
 * Returns warnings for extras that could not be removed; the file itself
 * must delete successfully or the promise rejects.
 */
export const deleteFile = async (
  ownerName: string,
  identifier: string,
): Promise<{ warnings: string[] }> => {
  const warnings: string[] = [];

  // Derived resources first: if the file delete fails, the file stays visible
  // with its description instead of becoming an orphan card.
  for (const [label, service, derivedIdentifier] of [
    ['description', DESCRIPTION_SERVICE, descriptionIdentifierFor(identifier)],
    ['thumbnail', THUMBNAIL_SERVICE, thumbnailIdentifierFor(identifier)],
  ] as const) {
    try {
      await deleteResource(service, ownerName, derivedIdentifier);
    } catch (error) {
      warnings.push(
        `${label} could not be deleted: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  await deleteResource(FILE_SERVICE, ownerName, identifier);
  thumbnailUrlCache.delete(`${ownerName}:${thumbnailIdentifierFor(identifier)}`);
  return { warnings };
};

/** Category label lookup used by list rows. */
export const categoryLabel = (categoryId: string): string =>
  FILE_CATEGORIES.find((category) => category.id === categoryId)?.label ??
  fileCategoryForQdnCategory(categoryId) ??
  categoryId;
