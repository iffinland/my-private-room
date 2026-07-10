import type { PrivateFile, FileCategory, QdnResourceStatus } from '../types';
import { requestQortium, fileToBase64, createShortId } from './qortium/qortiumClient';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

/** QDN identifier prefix — all files published by this app start with this */
const ID_PREFIX = 'mpr_';

/** QDN service used for file payloads (public — Home does not yet support private resources) */
const FILE_SERVICE = 'FILE';

/** QDN service used for encrypted metadata (the "index entry") */
const META_SERVICE = 'JSON';

/* ------------------------------------------------------------------ */
/*  File categories                                                   */
/* ------------------------------------------------------------------ */

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

/** Guess the category for a given MIME type */
export const guessCategory = (mimeType: string): string => {
  for (const cat of FILE_CATEGORIES) {
    if (cat.mimePatterns.some((pattern) => mimeType.startsWith(pattern))) {
      return cat.id;
    }
  }
  return 'other';
};

/* ------------------------------------------------------------------ */
/*  Publishing                                                        */
/* ------------------------------------------------------------------ */

/** Publish a file to QDN and return its identifier */
export const publishFile = async (
  file: File,
  ownerName: string,
  category: string,
  tags: string[],
  description = '',
): Promise<string> => {
  const identifier = `${ID_PREFIX}${createShortId()}`;
  const base64Data = await fileToBase64(file);

  await requestQortium({
    action: 'PUBLISH_QDN_RESOURCE',
    name: ownerName,
    service: FILE_SERVICE,
    identifier,
    data64: base64Data,
    filename: file.name,
    title: file.name,
    description: description || undefined,
    tag1: category,
    tag2: tags.join(','),
  });

  return identifier;
};

/** Publish the file metadata index entry (JSON) */
export const publishFileMetadata = async (
  ownerName: string,
  metaIdentifier: string,
  metadata: Record<string, unknown>,
): Promise<void> => {
  const json = JSON.stringify(metadata);
  const base64Data = btoa(unescape(encodeURIComponent(json)));

  await requestQortium({
    action: 'PUBLISH_QDN_RESOURCE',
    name: ownerName,
    service: META_SERVICE,
    identifier: metaIdentifier,
    data64: base64Data,
    title: 'metadata',
  });
};

/* ------------------------------------------------------------------ */
/*  Searching & fetching                                              */
/* ------------------------------------------------------------------ */

interface QdnSearchHit {
  name: string;
  service: string;
  identifier: string;
  title?: string;
  filename?: string;
  size?: number;
  created?: number;
  tag1?: string;
  tag2?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface QdnResourceProperties {
  filename: string;
  size: number;
  mimeType: string;
}

/** Fetch properties (filename, size, mimeType) for a single QDN resource */
const getFileProperties = async (
  name: string,
  identifier: string,
): Promise<QdnResourceProperties> => {
  const props = (await requestQortium({
    action: 'GET_QDN_RESOURCE_PROPERTIES',
    service: FILE_SERVICE,
    name,
    identifier,
  })) as QdnResourceProperties;

  return {
    filename: typeof props?.filename === 'string' ? props.filename : identifier,
    size: typeof props?.size === 'number' ? props.size : 0,
    mimeType: typeof props?.mimeType === 'string' ? props.mimeType : 'application/octet-stream',
  };
};

/** Resolve a renderable URL for a published QDN file */
export const getFileUrl = async (
  name: string,
  identifier: string,
): Promise<string> => {
  const result = (await requestQortium({
    action: 'GET_QDN_RESOURCE_URL',
    service: FILE_SERVICE,
    name,
    identifier,
  })) as string;

  return result;
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

/** Search for all file-office files published by a specific owner name */
export const searchMyFiles = async (ownerName: string): Promise<PrivateFile[]> => {
  // Search by QDN identifier prefix — returns { name, identifier } for each match.
  const raw = await requestQortium<unknown[]>({
    action: 'SEARCH_QDN_RESOURCES',
    service: FILE_SERVICE,
    identifier: ID_PREFIX,
    prefix: true,
    mode: 'ALL',
    includeMetadata: true,
    limit: 1000,
    offset: 0,
    reverse: true,
  });

  const items = (Array.isArray(raw) ? raw : []).map(
    (item) => item as QdnSearchHit,
  );

  // Keep only resources published by the owner.
  const mine = items.filter((item) => item.name === ownerName);

  // Fetch properties for each file so we have real filenames, sizes, and MIME types.
  const results: PrivateFile[] = [];
  for (const item of mine) {
    try {
      const props = await getFileProperties(item.name, item.identifier);
      results.push(mapQdnResultToPrivateFile(item, props));
    } catch {
      // Skip files whose properties can't be fetched (e.g. not yet ready).
      results.push(mapQdnResultToPrivateFile(item));
    }
  }

  return results;
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
  })) as string;

  return result;
};

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

/** Delete a file from QDN */
export const deleteFile = async (ownerName: string, identifier: string): Promise<void> => {
  await requestQortium({
    action: 'DELETE_QDN_RESOURCE',
    name: ownerName,
    service: FILE_SERVICE,
    identifier,
  });
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const mapQdnResultToPrivateFile = (
  raw: Record<string, unknown>,
  props?: QdnResourceProperties,
): PrivateFile => {
  const identifier = typeof raw.identifier === 'string' ? raw.identifier : '';
  const name = typeof raw.name === 'string' ? raw.name : '';

  // Prefer properties from GET_QDN_RESOURCE_PROPERTIES, fall back to search result fields.
  const fileName =
    props?.filename ??
    (typeof raw?.filename === 'string' ? raw.filename : null) ??
    (typeof raw?.title === 'string' ? raw.title : null) ??
    identifier;

  const mimeType =
    props?.mimeType ??
    (typeof raw?.metadata === 'object' && raw.metadata !== null
      ? (raw.metadata as Record<string, unknown>).mimeType as string | undefined
      : undefined) ??
    'application/octet-stream';

  const sizeBytes =
    props?.size ??
    (typeof raw?.size === 'number' ? raw.size : 0);

  const rawMeta = (raw.metadata ?? {}) as Record<string, unknown>;

  const category =
    typeof raw?.tag1 === 'string'
      ? raw.tag1
      : typeof rawMeta?.category === 'string'
        ? rawMeta.category
        : guessCategory(mimeType);

  const tagsStr =
    typeof raw?.tag2 === 'string'
      ? raw.tag2
      : typeof rawMeta?.tags === 'string'
        ? rawMeta.tags
        : '';

  const tags = tagsStr ? tagsStr.split(',').map((t) => t.trim()).filter(Boolean) : [];
  const uploadedAt =
    typeof raw?.created === 'number'
      ? new Date(raw.created).toISOString()
      : new Date().toISOString();

  const description =
    typeof raw?.description === 'string' && raw.description.trim()
      ? raw.description.trim()
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
    thumbnailIdentifier: null,
  };
};
