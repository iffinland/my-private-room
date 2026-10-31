import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearThumbnailUrlCache, getThumbnailUrl, searchMyFiles } from './fileService';

type Bridge = (payload: Record<string, unknown>) => Promise<unknown>;
const globalRecord = globalThis as unknown as { qdnRequest?: Bridge };

const installBridge = (handler: Bridge) => {
  const bridge = vi.fn(handler);
  globalRecord.qdnRequest = bridge;
  return bridge;
};

afterEach(() => {
  delete globalRecord.qdnRequest;
  clearThumbnailUrlCache();
});

describe('searchMyFiles', () => {
  it('maps FILE resources with metadata and properties', async () => {
    const bridge = installBridge(async (payload) => {
      if (payload.action === 'LIST_QDN_RESOURCES') {
        return [
          {
            name: 'Alice',
            service: 'FILE',
            identifier: 'mpr_new',
            created: 1_700_000_000_000,
            metadata: {
              title: 'New note',
              description: 'Legacy plain text',
              category: 'PRODUCTIVITY',
              tags: ['document', 'notes', 'extra'],
            },
          },
          {
            name: 'Alice',
            service: 'FILE',
            identifier: 'mpr_old',
            created: 1_600_000_000_000,
            metadata: { title: 'Old image', category: 'PHOTOGRAPHY', tags: [] },
          },
          {
            name: 'Bob',
            service: 'FILE',
            identifier: 'mpr_other',
            created: 1_700_000_000_000,
          },
          {
            name: 'Alice',
            service: 'FILE',
            identifier: 'not_ours',
            created: 1_700_000_000_000,
          },
        ];
      }
      if (payload.action === 'GET_QDN_RESOURCE_PROPERTIES') {
        if (payload.identifier === 'mpr_new') {
          return { filename: 'new-note.txt', size: 120, mimeType: 'text/plain' };
        }
        return { filename: 'old.png', size: 2048, mimeType: 'image/png' };
      }
      throw new Error(`Unexpected action ${String(payload.action)}`);
    });

    const files = await searchMyFiles('Alice');

    expect(bridge).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'LIST_QDN_RESOURCES',
        service: 'FILE',
        name: 'Alice',
        mode: 'ALL',
        includeMetadata: true,
      }),
    );
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({
      identifier: 'mpr_new',
      name: 'Alice',
      fileName: 'new-note.txt',
      mimeType: 'text/plain',
      sizeBytes: 120,
      category: 'document',
      tags: ['notes', 'extra'],
      description: 'Legacy plain text',
      descriptionIdentifier: 'mpr_desc_new',
      thumbnailIdentifier: 'mpr_thumb_new',
    });
    expect(files[1]).toMatchObject({
      identifier: 'mpr_old',
      fileName: 'old.png',
      category: 'image',
      descriptionIdentifier: 'mpr_desc_old',
    });
    // Newest first.
    expect(files.map((file) => file.identifier)).toEqual(['mpr_new', 'mpr_old']);
  });

  it('falls back to metadata when properties cannot be fetched', async () => {
    installBridge(async (payload) => {
      if (payload.action === 'LIST_QDN_RESOURCES') {
        return [
          {
            name: 'Alice',
            service: 'FILE',
            identifier: 'mpr_1',
            created: 1_700_000_000_000,
            metadata: { title: 'fallback.txt', mimeType: 'text/plain', tags: ['document'] },
          },
        ];
      }
      throw new Error('not ready');
    });

    const files = await searchMyFiles('Alice');
    expect(files[0]).toMatchObject({
      fileName: 'fallback.txt',
      mimeType: 'text/plain',
      sizeBytes: 0,
      category: 'document',
    });
  });
});

describe('getThumbnailUrl', () => {
  it('returns a resolved URL and caches it', async () => {
    const bridge = installBridge(async (payload) => {
      if (payload.action === 'GET_QDN_RESOURCE_STATUS') return { status: 'READY' };
      if (payload.action === 'GET_QDN_RESOURCE_URL') return 'https://node/render/THUMBNAIL/Alice/mpr_thumb_1';
      throw new Error('unexpected');
    });

    await expect(getThumbnailUrl('Alice', 'mpr_1')).resolves.toBe(
      'https://node/render/THUMBNAIL/Alice/mpr_thumb_1',
    );
    await getThumbnailUrl('Alice', 'mpr_1');

    expect(bridge.mock.calls.filter(([payload]) => payload.action === 'GET_QDN_RESOURCE_URL')).toHaveLength(1);
  });

  it('returns null for a missing thumbnail and caches the miss', async () => {
    const bridge = installBridge(async (payload) => {
      if (payload.action === 'GET_QDN_RESOURCE_STATUS') return { status: 'NOT_PUBLISHED' };
      if (payload.action === 'GET_QDN_RESOURCE_URL') throw new Error('Resource does not exist.');
      throw new Error('unexpected');
    });

    await expect(getThumbnailUrl('Alice', 'mpr_2')).resolves.toBeNull();
    await getThumbnailUrl('Alice', 'mpr_2');

    expect(bridge.mock.calls.filter(([payload]) => payload.action === 'GET_QDN_RESOURCE_URL')).toHaveLength(1);
  });
});
