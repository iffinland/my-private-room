import type { GeneratedThumbnail } from './thumbnailService';
import {
  descriptionIdentifierFor,
  stagePublishSource,
  thumbnailIdentifierFor,
  publishQdnResource,
  publishQdnResources,
  requireHome2Publishing,
  fileToBase64,
  blobToBase64,
  utf8ToBase64,
  HOME2_BATCH_MAX_BYTES,
  HOME2_STAGE_MAX_BYTES,
  type PublishResourceItem,
  type QdnPublishFailure,
} from './qortium/qortiumClient';
import {
  buildDescriptionDocument,
  clearFileDescriptionCache,
  descriptionMetadataExcerpt,
  type StoredDescriptionDocument,
} from './descriptionService';
import { getFileStatus } from './fileService';
import { qdnCategoryFor, limitTagBytes } from './fileCategories';
import { truncateUtf8 } from '../lib/sanitizeHtml';
import { createShortId, FILE_IDENTIFIER_PREFIX } from './qortium/qortiumClient';

export type PublishProgressStage =
  | 'preparing'
  | 'staging'
  | 'publishing'
  | 'verifying';

export type PublishProgress = (stage: PublishProgressStage, message: string) => void;

export interface PublishFileInput {
  file: File;
  ownerName: string;
  categoryId: string;
  tags: string[];
  /** Raw editor HTML; sanitized before anything is staged. */
  descriptionHtml: string;
  /** Bounded preview generated in the browser, or null for the icon fallback. */
  thumbnail: GeneratedThumbnail | null;
  onProgress?: PublishProgress;
}

export interface PublishedFileResult {
  identifier: string;
  descriptionIdentifier: string;
  thumbnailIdentifier: string | null;
  published: string[];
  failures: PublishFailure[];
  warnings: string[];
  approvals: number;
  transactionSignatures: string[];
}

export interface PublishFailure {
  label: string;
  service: string;
  identifier: string;
  message: string;
  outcome?: string;
  transactionSignature?: string;
}

export class PublishError extends Error {
  readonly code: string;
  readonly failures: PublishFailure[];
  readonly transactionSignatures: string[];

  constructor(
    message: string,
    code: string,
    options: { failures?: PublishFailure[]; transactionSignatures?: string[] } = {},
  ) {
    super(message);
    this.name = 'PublishError';
    this.code = code;
    this.failures = options.failures ?? [];
    this.transactionSignatures = options.transactionSignatures ?? [];
  }
}

interface PreparedItem {
  label: string;
  service: string;
  identifier: string;
  bytes: number;
  payload: Omit<PublishResourceItem, 'sourceToken'>;
}

const coerceFailure = (
  label: string,
  service: string,
  identifier: string,
  failure: QdnPublishFailure,
): PublishFailure => ({
  label,
  service: failure.service ?? service,
  identifier: failure.identifier ?? identifier,
  message: failure.error,
  outcome: failure.outcome,
  transactionSignature: failure.transactionSignature,
});

const publishGroup = async (
  prepared: PreparedItem[],
  tokens: Map<string, string>,
  supportsBatch: boolean,
): Promise<{ published: string[]; failures: PublishFailure[]; signatures: string[] }> => {
  const items: PublishResourceItem[] = prepared.map((entry) => ({
    ...entry.payload,
    sourceToken: tokens.get(entry.identifier) as string,
  }));

  if (items.length === 1 || !supportsBatch) {
    // Without batch support, one Home approval per item is the only contract.
    const published: string[] = [];
    const failures: PublishFailure[] = [];
    const signatures: string[] = [];
    for (const item of items) {
      const entry = prepared.find((candidate) => candidate.identifier === item.identifier) as PreparedItem;
      try {
        const result = await publishQdnResource(item);
        if (result.published.length > 0) published.push(entry.identifier);
        if (result.transactionSignature) signatures.push(result.transactionSignature);
        for (const failure of result.failures) {
          failures.push(coerceFailure(entry.label, entry.service, entry.identifier, failure));
        }
      } catch (error) {
        failures.push({
          label: entry.label,
          service: entry.service,
          identifier: entry.identifier,
          message: error instanceof Error ? error.message : 'Publish failed.',
        });
      }
    }
    return { published, failures, signatures };
  }

  const result = await publishQdnResources(items);
  const published = result.published
    .map((entry) => entry.identifier)
    .filter((identifier): identifier is string => typeof identifier === 'string');
  const signatures = result.published
    .map((entry) => entry.transactionSignature)
    .filter((signature): signature is string => typeof signature === 'string');
  const failures = result.failures.map((failure) => {
    const match = prepared.find((entry) => entry.identifier === failure.identifier);
    return coerceFailure(
      match?.label ?? 'Resource',
      match?.service ?? failure.service ?? '',
      match?.identifier ?? failure.identifier ?? '',
      failure,
    );
  });
  return { published, failures, signatures };
};

const waitForResourceReady = async (
  ownerName: string,
  identifier: string,
  onProgress?: PublishProgress,
): Promise<boolean> => {
  const deadline = Date.now() + 20_000;
  onProgress?.('verifying', 'Checking that Home and the node can serve the new file…');
  while (Date.now() < deadline) {
    try {
      const status = await getFileStatus(ownerName, identifier);
      if (status.status === 'READY' || status.status === 'DOWNLOADED') return true;
    } catch {
      // Readback is best-effort: the transaction is already broadcast.
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return false;
};

/**
 * Publish one file plus its optional rich description and thumbnail through
 * Qortium Home 2.
 *
 * The file, thumbnail and description are staged separately (one token each)
 * and published in a single `PUBLISH_MULTIPLE_QDN_RESOURCES` request when the
 * aggregate fits Home's 25 MiB batch budget. Otherwise the file is published
 * alone and the small extras follow in their own batch/request.
 */
export const publishFile = async (input: PublishFileInput): Promise<PublishedFileResult> => {
  const { file, ownerName, categoryId, tags, descriptionHtml, thumbnail, onProgress } = input;

  if (!ownerName.trim()) {
    throw new PublishError(
      'The selected account has no Qortium name. QDN publishing requires a registered name.',
      'NO_PUBLISHER_NAME',
    );
  }

  if (new TextEncoder().encode(ownerName).length > 40) {
    throw new PublishError('The selected publisher name exceeds QDN\'s 40-byte limit.', 'NAME_TOO_LONG');
  }

  if (file.size > HOME2_STAGE_MAX_BYTES) {
    throw new PublishError(
      `This file is ${(file.size / (1024 * 1024)).toFixed(1)} MiB. Qortium Home 2 can stage at most ` +
        '25 MiB per resource from app-held bytes.',
      'FILE_TOO_LARGE',
    );
  }

  onProgress?.('preparing', 'Preparing description and thumbnail…');

  let descriptionDocument: StoredDescriptionDocument | null = null;
  try {
    descriptionDocument = buildDescriptionDocument(descriptionHtml);
  } catch (error) {
    throw new PublishError(
      error instanceof Error ? error.message : 'Description could not be prepared.',
      'DESCRIPTION_INVALID',
    );
  }

  const { supportsBatch } = await requireHome2Publishing();

  const suffix = createShortId();
  const fileIdentifier = `${FILE_IDENTIFIER_PREFIX}${suffix}`;
  const descriptionIdentifier = descriptionIdentifierFor(fileIdentifier);
  const thumbnailIdentifier = thumbnail ? thumbnailIdentifierFor(fileIdentifier) : null;

  const qdnCategory = qdnCategoryFor(categoryId);
  const metadataTags = Array.from(
    new Set(
      [categoryId, ...tags.map((tag) => limitTagBytes(tag))]
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
    ),
  ).slice(0, 5);

  const filePayload: Omit<PublishResourceItem, 'sourceToken'> = {
    service: 'FILE',
    name: ownerName,
    identifier: fileIdentifier,
    title: truncateUtf8(file.name, 80),
    description: descriptionDocument ? descriptionMetadataExcerpt(descriptionDocument.html) : undefined,
    category: qdnCategory,
    tags: metadataTags,
  };

  const prepared: PreparedItem[] = [];
  const tokens = new Map<string, string>();

  const addDescription = async (): Promise<void> => {
    if (!descriptionDocument) return;
    const descriptionJson = JSON.stringify(descriptionDocument);
    const descriptionBytes = new TextEncoder().encode(descriptionJson);
    onProgress?.('staging', 'Staging description…');
    const stagedDescription = await stagePublishSource({
      bytesBase64: utf8ToBase64(descriptionJson),
      fileName: `${descriptionIdentifier}.json`,
      mimeType: 'application/json',
    });
    tokens.set(descriptionIdentifier, stagedDescription.sourceToken);
    prepared.push({
      label: 'Description',
      service: 'JSON',
      identifier: descriptionIdentifier,
      bytes: descriptionBytes.length,
      payload: {
        service: 'JSON',
        name: ownerName,
        identifier: descriptionIdentifier,
        title: truncateUtf8(`Description — ${file.name}`, 80),
        tags: ['description'],
      },
    });
  };

  const addThumbnail = async (): Promise<void> => {
    if (!thumbnail || !thumbnailIdentifier) return;
    onProgress?.('staging', 'Staging thumbnail…');
    const extension = thumbnail.mimeType === 'image/webp' ? 'webp' : 'jpg';
    const stagedThumbnail = await stagePublishSource({
      bytesBase64: await blobToBase64(thumbnail.blob),
      fileName: `${thumbnailIdentifier}.${extension}`,
      mimeType: thumbnail.mimeType,
    });
    tokens.set(thumbnailIdentifier, stagedThumbnail.sourceToken);
    prepared.push({
      label: 'Thumbnail',
      service: 'THUMBNAIL',
      identifier: thumbnailIdentifier,
      bytes: thumbnail.blob.size,
      payload: {
        service: 'THUMBNAIL',
        name: ownerName,
        identifier: thumbnailIdentifier,
        title: truncateUtf8(`Thumbnail — ${file.name}`, 80),
        category: qdnCategory,
        tags: ['thumbnail'],
      },
    });
  };

  try {
    onProgress?.('staging', `Staging ${file.name} in Qortium Home…`);
    {
      // Keep the base64 copy block-scoped so it can be reclaimed after staging.
      const fileBase64 = await fileToBase64(file);
      const stagedFile = await stagePublishSource({
        bytesBase64: fileBase64,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
      });
      tokens.set(fileIdentifier, stagedFile.sourceToken);
    }
    prepared.push({
      label: 'File',
      service: 'FILE',
      identifier: fileIdentifier,
      bytes: file.size,
      payload: filePayload,
    });

    await addDescription();
    await addThumbnail();
  } catch (error) {
    if (error instanceof PublishError) throw error;
    throw new PublishError(
      error instanceof Error ? error.message : 'Qortium Home could not stage the publish source.',
      'STAGING_FAILED',
    );
  }

  const totalBytes = prepared.reduce((total, entry) => total + entry.bytes, 0);
  const oneBatch = supportsBatch && prepared.length > 1 && totalBytes <= HOME2_BATCH_MAX_BYTES;

  const published: string[] = [];
  const failures: PublishFailure[] = [];
  const signatures: string[] = [];
  let approvals = 0;

  try {
    if (oneBatch) {
      onProgress?.('publishing', 'Approve the publish in Qortium Home…');
      approvals += 1;
      const result = await publishGroup(prepared, tokens, supportsBatch);
      published.push(...result.published);
      failures.push(...result.failures);
      signatures.push(...result.signatures);
    } else if (prepared.length === 1) {
      onProgress?.('publishing', 'Approve the publish in Qortium Home…');
      approvals += 1;
      const result = await publishGroup(prepared, tokens, false);
      published.push(...result.published);
      failures.push(...result.failures);
      signatures.push(...result.signatures);
    } else {
      const fileItem = prepared[0];
      onProgress?.('publishing', 'Approve the file publish in Qortium Home…');
      approvals += 1;
      const fileResult = await publishGroup([fileItem], tokens, false);
      published.push(...fileResult.published);
      failures.push(...fileResult.failures);
      signatures.push(...fileResult.signatures);

      if (fileResult.published.includes(fileIdentifier)) {
        const extras = prepared.slice(1);
        onProgress?.('publishing', 'Approve the description and thumbnail publish in Qortium Home…');
        approvals += 1;
        try {
          const extraResult = await publishGroup(extras, tokens, supportsBatch);
          published.push(...extraResult.published);
          failures.push(...extraResult.failures);
          signatures.push(...extraResult.signatures);
        } catch (error) {
          failures.push({
            label: 'Extras',
            service: 'JSON',
            identifier: descriptionIdentifier,
            message: error instanceof Error ? error.message : 'Description/thumbnail publish failed.',
          });
        }
      }
    }
  } catch (error) {
    throw new PublishError(
      error instanceof Error ? error.message : 'Qortium Home rejected the publish request.',
      'PUBLISH_REFUSED',
      { failures, transactionSignatures: signatures },
    );
  }

  const filePublished = published.includes(fileIdentifier);
  const fileFailure = failures.find(
    (failure) => failure.service === 'FILE' && failure.identifier === fileIdentifier,
  );

  if (!filePublished) {
    const unknown = fileFailure?.outcome === 'unknown';
    throw new PublishError(
      unknown
        ? 'Home signed the file publish but could not confirm the broadcast. Do not retry blindly; ' +
          `reconcile transaction ${fileFailure?.transactionSignature ?? '(signature unavailable)'} first.`
        : fileFailure?.message ?? 'The file was not published.',
      unknown ? 'OUTCOME_UNKNOWN' : 'FILE_PUBLISH_FAILED',
      { failures, transactionSignatures: signatures },
    );
  }

  const warnings = failures
    .filter((failure) => failure.identifier !== fileIdentifier)
    .map((failure) => `${failure.label} was not published: ${failure.message}`);

  if (warnings.length === 0) {
    const ready = await waitForResourceReady(ownerName, fileIdentifier, onProgress);
    if (!ready) {
      warnings.push(
        'The publish was accepted, but the node did not report the resource READY within 20 seconds. ' +
          'It may still be propagating.',
      );
    }
  }

  clearFileDescriptionCache(ownerName, fileIdentifier);

  return {
    identifier: fileIdentifier,
    descriptionIdentifier,
    thumbnailIdentifier: published.includes(thumbnailIdentifier ?? '') ? thumbnailIdentifier : null,
    published,
    failures,
    warnings,
    approvals,
    transactionSignatures: signatures,
  };
};
