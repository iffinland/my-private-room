/**
 * Qortium bridge client — wraps window.qdnRequest() for type-safe calls.
 *
 * Home 2 refuses the Home 1.x inline/path publishing shapes. This module owns
 * the Home 2 source-token contract: app-held bytes are staged once to obtain an
 * opaque token, and the publish request carries only the token plus the
 * resource coordinate and mutable metadata.
 */

type BridgeRequest = (payload: Record<string, unknown>) => Promise<unknown>;

const getBridge = (): BridgeRequest | null => {
  const candidate =
    (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).qdnRequest) ||
    (typeof globalThis !== 'undefined' && (globalThis as unknown as Record<string, unknown>).qdnRequest) ||
    null;

  return typeof candidate === 'function' ? (candidate as BridgeRequest) : null;
};

/** Returns true when running inside Qortium Home with the qdnRequest bridge */
export const hasQortiumBridge = (): boolean => getBridge() !== null;

/** Make a typed request through the Qortium bridge */
export const requestQortium = async <T = unknown>(payload: Record<string, unknown>): Promise<T> => {
  const bridge = getBridge();

  if (!bridge) {
    throw new Error('Qortium bridge not available. Open this app inside Qortium Home.');
  }

  return bridge(payload) as Promise<T>;
};

/** Bridge error details Home attaches to rejected requests. */
export interface QdnBridgeError extends Error {
  code?: string;
  outcome?: 'rejected' | 'unknown';
  retryable?: boolean;
}

export const asBridgeError = (error: unknown): QdnBridgeError => {
  if (error instanceof Error) return error as QdnBridgeError;
  const message = typeof error === 'string' ? error : 'Qortium bridge request failed.';
  return Object.assign(new Error(message), { code: 'UNKNOWN' }) as QdnBridgeError;
};

/** Read bridge state (available actions, whether inside Home) */
export const getBridgeState = async (): Promise<{
  actions: string[];
  isHomeBridge: boolean;
  isUsingPublicNode: boolean;
  ui: string;
}> => {
  try {
    const ui = await getUiMode();
    const actions = await getBridgeActions().catch(() => [] as string[]);
    return {
      actions,
      isHomeBridge: ui !== 'UNKNOWN' && ui !== 'BROWSER_DEV',
      isUsingPublicNode: false,
      ui,
    };
  } catch {
    return { actions: [], isHomeBridge: false, isUsingPublicNode: false, ui: 'UNKNOWN' };
  }
};

/**
 * Home 2 answers WHICH_UI with a plain string (`QORTIUM_HOME_ELECTRON`);
 * older bridge builds returned `{ ui }`. Accept both shapes.
 */
const getUiMode = async (): Promise<string> => {
  const result = (await requestQortium({ action: 'WHICH_UI' })) as unknown;
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const ui = (result as Record<string, unknown>).ui;
    if (typeof ui === 'string') return ui;
  }
  return 'UNKNOWN';
};

/* ------------------------------------------------------------------ */
/*  Capability detection                                              */
/* ------------------------------------------------------------------ */

/** Publish actions required by this app's Home 2 publishing contract. */
export const HOME2_PUBLISH_ACTIONS = [
  'SHOW_ACTIONS',
  'STAGE_QDN_PUBLISH_SOURCE',
  'PUBLISH_QDN_RESOURCE',
] as const;

export const getBridgeActions = async (): Promise<string[]> => {
  const raw = (await requestQortium({ action: 'SHOW_ACTIONS' })) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is string => typeof value === 'string');
};

export class Home2PublishUnsupportedError extends Error {
  readonly code = 'HOME2_PUBLISH_UNSUPPORTED';

  constructor(message: string) {
    super(message);
    this.name = 'Home2PublishUnsupportedError';
  }
}

/**
 * Fail closed unless the runtime advertises the Home 2 staging contract.
 * Never fall back to the Home 1.x inline shape: Home 2 refuses it before any
 * approval is shown, which looks like a silent publish failure to the user.
 */
export const requireHome2Publishing = async (): Promise<{
  supportsBatch: boolean;
  actions: string[];
}> => {
  if (!hasQortiumBridge()) {
    throw new Home2PublishUnsupportedError(
      'Publishing requires Qortium Home. Open My File Office inside Home and try again.',
    );
  }

  let actions: string[];
  try {
    actions = await getBridgeActions();
  } catch (error) {
    throw new Home2PublishUnsupportedError(
      `Could not read Qortium Home capabilities: ${asBridgeError(error).message}`,
    );
  }

  const missing = HOME2_PUBLISH_ACTIONS.filter((action) => !actions.includes(action));
  if (missing.length > 0) {
    throw new Home2PublishUnsupportedError(
      'This app requires Qortium Home 2.x with QDN source-token publishing ' +
        `(missing: ${missing.join(', ')}). Update Qortium Home and reopen the app.`,
    );
  }

  return {
    supportsBatch: actions.includes('PUBLISH_MULTIPLE_QDN_RESOURCES'),
    actions,
  };
};

/* ------------------------------------------------------------------ */
/*  Base64 helpers                                                    */
/* ------------------------------------------------------------------ */

/** Encode bytes to canonical base64 without blowing the call stack. */
export const bytesToBase64 = (bytes: Uint8Array): string => {
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

export const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

export const utf8ToBase64 = (text: string): string =>
  bytesToBase64(new TextEncoder().encode(text));

export const base64ToUtf8 = (value: string): string =>
  new TextDecoder().decode(base64ToBytes(value));

/** Read a File as base64 */
export const fileToBase64 = async (file: Blob): Promise<string> =>
  bytesToBase64(new Uint8Array(await file.arrayBuffer()));

/** Read a Blob as base64 */
export const blobToBase64 = (blob: Blob): Promise<string> => fileToBase64(blob);

/* ------------------------------------------------------------------ */
/*  Home 2 source-token publishing                                    */
/* ------------------------------------------------------------------ */

/** Home 2 stages at most 25 MiB of decoded bytes per source. */
export const HOME2_STAGE_MAX_BYTES = 25 * 1024 * 1024;

/** Home 2 batches at most ten items and 25 MiB of decoded bytes in aggregate. */
export const HOME2_BATCH_MAX_ITEMS = 10;
export const HOME2_BATCH_MAX_BYTES = 25 * 1024 * 1024;

export interface StagedPublishSource {
  sourceToken: string;
  fileName: string;
  size: number;
  mimeType?: string;
  kind: string;
}

const normalizeStagedSource = (raw: unknown): StagedPublishSource => {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const sourceToken = typeof record.sourceToken === 'string' ? record.sourceToken : '';
  if (!sourceToken) {
    throw new Error('Qortium Home did not return a publish source token.');
  }
  return {
    sourceToken,
    fileName: typeof record.fileName === 'string' ? record.fileName : '',
    size: typeof record.size === 'number' && Number.isFinite(record.size) ? record.size : 0,
    mimeType: typeof record.mimeType === 'string' ? record.mimeType : undefined,
    kind: typeof record.kind === 'string' ? record.kind : 'file',
  };
};

/**
 * Stage bytes the app already holds. Staging never prompts and grants nothing:
 * the later publish still runs Home's approval, signing and broadcast flow.
 */
export const stagePublishSource = async (input: {
  bytesBase64: string;
  fileName: string;
  mimeType?: string;
}): Promise<StagedPublishSource> => {
  if (!input.fileName || /[/\\]/.test(input.fileName)) {
    throw new Error('Publish source filename must be a plain file name.');
  }
  const raw = await requestQortium({
    action: 'STAGE_QDN_PUBLISH_SOURCE',
    bytesBase64: input.bytesBase64,
    fileName: input.fileName,
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
  });
  return normalizeStagedSource(raw);
};

export interface PublishResourceItem {
  service: string;
  name: string;
  identifier?: string;
  sourceToken: string;
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
}

/**
 * Strip any field Home 2 refuses on a publish request. The app's own boundary
 * rejects legacy inline/path shapes so a refactor cannot silently reintroduce
 * them.
 */
const assertTokenOnlyPublish = (item: PublishResourceItem): void => {
  const record = item as unknown as Record<string, unknown>;
  const refused = [
    'base64',
    'data',
    'data64',
    'dataBase64',
    'bytes',
    'bytesBase64',
    'file',
    'fileName',
    'filePath',
    'filename',
    'filepath',
    'mimeType',
    'path',
    'source',
    'sourceBase64',
    'uri',
    'fee',
  ];
  for (const field of refused) {
    if (record[field] !== undefined) {
      throw new Error(`Refusing to send legacy publish field "${field}" to Qortium Home 2.`);
    }
  }
  if (!item.sourceToken) throw new Error('A Home-issued sourceToken is required to publish.');
  if (!item.service || !item.name) throw new Error('QDN service and name are required to publish.');
};

const buildPublishPayload = (item: PublishResourceItem): Record<string, unknown> => {
  assertTokenOnlyPublish(item);
  return {
    service: item.service,
    name: item.name,
    ...(item.identifier ? { identifier: item.identifier } : {}),
    sourceToken: item.sourceToken,
    ...(item.title ? { title: item.title } : {}),
    ...(item.description ? { description: item.description } : {}),
    ...(item.category ? { category: item.category } : {}),
    ...(item.tags && item.tags.length > 0 ? { tags: item.tags } : {}),
  };
};

export interface QdnPublishFailure {
  service?: string;
  name?: string;
  identifier?: string | null;
  error: string;
  outcome?: string;
  transactionSignature?: string;
}

export interface QdnPublishResult {
  accepted: boolean;
  published: Array<{
    service: string;
    name: string;
    identifier: string | null;
    transactionSignature?: string;
    immutable?: { contentHash?: string };
  }>;
  failures: QdnPublishFailure[];
  transactionSignature?: string;
  outcome?: string;
  error?: string;
}

const normalizeSinglePublishResult = (
  raw: unknown,
  item: PublishResourceItem,
): QdnPublishResult => {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const accepted = record.accepted === true;
  const outcome = typeof record.outcome === 'string' ? record.outcome : undefined;
  const transactionSignature =
    typeof record.transactionSignature === 'string' ? record.transactionSignature : undefined;

  if (accepted) {
    return {
      accepted: true,
      published: [
        {
          service: item.service,
          name: item.name,
          identifier: item.identifier ?? null,
          transactionSignature,
          immutable:
            record.immutable && typeof record.immutable === 'object'
              ? (record.immutable as { contentHash?: string })
              : undefined,
        },
      ],
      failures: [],
      transactionSignature,
    };
  }

  return {
    accepted: false,
    published: [],
    failures: [
      {
        service: item.service,
        name: item.name,
        identifier: item.identifier ?? null,
        error:
          typeof record.error === 'string'
            ? record.error
            : outcome === 'unknown'
              ? 'Home signed the publish but could not confirm the broadcast.'
              : 'QDN publish was not accepted.',
        outcome,
        transactionSignature,
      },
    ],
    transactionSignature,
    outcome,
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
  };
};

/** Publish one staged source. */
export const publishQdnResource = async (item: PublishResourceItem): Promise<QdnPublishResult> => {
  const raw = await requestQortium({
    action: 'PUBLISH_QDN_RESOURCE',
    ...buildPublishPayload(item),
  });
  return normalizeSinglePublishResult(raw, item);
};

/**
 * Publish up to ten staged sources under one Home approval. Execution is
 * per-item, never atomic; items that fail are reported in `failures`.
 */
export const publishQdnResources = async (
  items: PublishResourceItem[],
): Promise<QdnPublishResult> => {
  if (items.length === 0) throw new Error('No publish items were prepared.');
  if (items.length > HOME2_BATCH_MAX_ITEMS) {
    throw new Error(`Home 2 accepts at most ${HOME2_BATCH_MAX_ITEMS} resources per batch.`);
  }
  const tokens = new Set(items.map((item) => item.sourceToken));
  if (tokens.size !== items.length) {
    throw new Error('Every batch item must use a distinct Home-issued source token.');
  }

  const raw = await requestQortium({
    action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
    resources: items.map((item) => buildPublishPayload(item)),
  });

  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (record.accepted !== true) {
    throw new Error(
      typeof record.error === 'string'
        ? record.error
        : 'Qortium Home did not accept the publish batch.',
    );
  }

  const publishedRaw = Array.isArray(record.published) ? record.published : [];
  const failuresRaw = Array.isArray(record.failures) ? record.failures : [];

  const published = publishedRaw.map((entry) => {
    const row = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const resource = (row.resource && typeof row.resource === 'object' ? row.resource : {}) as Record<
      string,
      unknown
    >;
    return {
      service: typeof resource.service === 'string' ? resource.service : '',
      name: typeof resource.name === 'string' ? resource.name : '',
      identifier: typeof resource.identifier === 'string' ? resource.identifier : null,
      transactionSignature:
        typeof row.transactionSignature === 'string' ? row.transactionSignature : undefined,
      immutable:
        row.immutable && typeof row.immutable === 'object'
          ? (row.immutable as { contentHash?: string })
          : undefined,
    };
  });

  const failures = failuresRaw.map((entry) => {
    const row = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const resource = (row.resource && typeof row.resource === 'object' ? row.resource : {}) as Record<
      string,
      unknown
    >;
    return {
      service: typeof resource.service === 'string' ? resource.service : undefined,
      name: typeof resource.name === 'string' ? resource.name : undefined,
      identifier: typeof resource.identifier === 'string' ? resource.identifier : null,
      error: typeof row.error === 'string' ? row.error : 'QDN publish failed.',
      outcome: typeof row.outcome === 'string' ? row.outcome : undefined,
      transactionSignature:
        typeof row.transactionSignature === 'string' ? row.transactionSignature : undefined,
    };
  });

  return { accepted: failures.length === 0, published, failures };
};

/* ------------------------------------------------------------------ */
/*  Identifiers                                                       */
/* ------------------------------------------------------------------ */

/** Sanitise a string into a QDN-safe identifier segment */
export const sanitizeId = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);

/** Create a unique, time-sorted ID suitable for QDN identifiers */
export const createShortId = (): string => {
  const timePart = Date.now().toString(36);
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const randomPart = Array.from(bytes)
    .map((b) => b.toString(36).padStart(2, '0'))
    .join('');
  return `${timePart}${randomPart}`;
};

/** QDN identifier prefix — all file resources published by this app use it */
export const FILE_IDENTIFIER_PREFIX = 'mpr_';
export const THUMBNAIL_IDENTIFIER_PREFIX = 'mpr_thumb_';
export const DESCRIPTION_IDENTIFIER_PREFIX = 'mpr_desc_';

const resourceSuffix = (fileIdentifier: string): string =>
  fileIdentifier.startsWith(FILE_IDENTIFIER_PREFIX)
    ? fileIdentifier.slice(FILE_IDENTIFIER_PREFIX.length)
    : fileIdentifier;

/** Deterministic thumbnail coordinate derived from the file identifier. */
export const thumbnailIdentifierFor = (fileIdentifier: string): string =>
  `${THUMBNAIL_IDENTIFIER_PREFIX}${resourceSuffix(fileIdentifier)}`.slice(0, 64);

/** Deterministic rich-description coordinate derived from the file identifier. */
export const descriptionIdentifierFor = (fileIdentifier: string): string =>
  `${DESCRIPTION_IDENTIFIER_PREFIX}${resourceSuffix(fileIdentifier)}`.slice(0, 64);
