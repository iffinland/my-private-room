import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  descriptionIdentifierFor,
  getBridgeActions,
  hasQortiumBridge,
  HOME2_BATCH_MAX_ITEMS,
  Home2PublishUnsupportedError,
  publishQdnResource,
  publishQdnResources,
  requestQortium,
  requireHome2Publishing,
  stagePublishSource,
  thumbnailIdentifierFor,
  type PublishResourceItem,
} from './qortiumClient';

type Bridge = (payload: Record<string, unknown>) => Promise<unknown>;
const globalRecord = globalThis as unknown as { qdnRequest?: Bridge };

const installBridge = (handler: Bridge) => {
  const bridge = vi.fn(handler);
  globalRecord.qdnRequest = bridge;
  return bridge;
};

const item = (token: string, identifier = 'mpr_1'): PublishResourceItem => ({
  service: 'FILE',
  name: 'Alice',
  identifier,
  sourceToken: token,
  title: 'File',
});

afterEach(() => {
  delete globalRecord.qdnRequest;
});

describe('bridge availability', () => {
  it('detects a missing bridge', async () => {
    expect(hasQortiumBridge()).toBe(false);
    await expect(requestQortium({ action: 'SHOW_ACTIONS' })).rejects.toThrow(/bridge not available/i);
  });

  it('reads the advertised action list', async () => {
    installBridge(async () => ['SHOW_ACTIONS', 'STAGE_QDN_PUBLISH_SOURCE', 7, null]);
    expect(await getBridgeActions()).toEqual(['SHOW_ACTIONS', 'STAGE_QDN_PUBLISH_SOURCE']);
  });
});

describe('requireHome2Publishing', () => {
  it('accepts Home 2 publishing with batch support', async () => {
    installBridge(async () => [
      'SHOW_ACTIONS',
      'STAGE_QDN_PUBLISH_SOURCE',
      'PUBLISH_QDN_RESOURCE',
      'PUBLISH_MULTIPLE_QDN_RESOURCES',
    ]);
    await expect(requireHome2Publishing()).resolves.toMatchObject({ supportsBatch: true });
  });

  it('fails closed when the staging contract is absent', async () => {
    installBridge(async () => ['SHOW_ACTIONS', 'PUBLISH_QDN_RESOURCE']);
    await expect(requireHome2Publishing()).rejects.toBeInstanceOf(Home2PublishUnsupportedError);
  });

  it('fails closed when capability detection fails', async () => {
    installBridge(async () => {
      throw new Error('denied');
    });
    await expect(requireHome2Publishing()).rejects.toThrow(/Could not read Qortium Home capabilities/);
  });
});

describe('stagePublishSource', () => {
  it('sends canonical base64 and returns the Home token', async () => {
    const bridge = installBridge(async () => ({
      sourceToken: 'token-1',
      fileName: 'note.txt',
      size: 3,
      mimeType: 'text/plain',
      kind: 'file',
    }));

    const staged = await stagePublishSource({
      bytesBase64: 'AAEC',
      fileName: 'note.txt',
      mimeType: 'text/plain',
    });

    expect(bridge).toHaveBeenCalledWith({
      action: 'STAGE_QDN_PUBLISH_SOURCE',
      bytesBase64: 'AAEC',
      fileName: 'note.txt',
      mimeType: 'text/plain',
    });
    expect(staged).toEqual({
      sourceToken: 'token-1',
      fileName: 'note.txt',
      size: 3,
      mimeType: 'text/plain',
      kind: 'file',
    });
  });

  it('rejects path-like file names before calling Home', async () => {
    const bridge = installBridge(async () => ({ sourceToken: 'token-1' }));
    await expect(
      stagePublishSource({ bytesBase64: 'AAEC', fileName: '../escape.txt' }),
    ).rejects.toThrow(/plain file name/);
    expect(bridge).not.toHaveBeenCalled();
  });

  it('rejects a missing token response', async () => {
    installBridge(async () => ({ fileName: 'note.txt' }));
    await expect(
      stagePublishSource({ bytesBase64: 'AAEC', fileName: 'note.txt' }),
    ).rejects.toThrow(/did not return a publish source token/);
  });
});

describe('token-only publish boundary', () => {
  it('refuses legacy inline bytes before calling Home', async () => {
    const bridge = installBridge(async () => ({ accepted: true }));
    const legacy = {
      ...item('token-1'),
      base64: 'AAEC',
    } as unknown as PublishResourceItem;

    await expect(publishQdnResource(legacy)).rejects.toThrow(/legacy publish field "base64"/);
    expect(bridge).not.toHaveBeenCalled();
  });

  it('publishes one staged resource', async () => {
    const bridge = installBridge(async () => ({
      accepted: true,
      transactionSignature: 'sig-1',
      immutable: { contentHash: 'abc' },
    }));

    const result = await publishQdnResource(item('token-1'));

    expect(bridge).toHaveBeenCalledWith({
      action: 'PUBLISH_QDN_RESOURCE',
      service: 'FILE',
      name: 'Alice',
      identifier: 'mpr_1',
      sourceToken: 'token-1',
      title: 'File',
    });
    expect(result.accepted).toBe(true);
    expect(result.published[0]).toMatchObject({ identifier: 'mpr_1', transactionSignature: 'sig-1' });
    expect(result.failures).toEqual([]);
  });

  it('reports a refused single publish without throwing', async () => {
    installBridge(async () => ({ accepted: false, outcome: 'unknown', transactionSignature: 'sig-2' }));
    const result = await publishQdnResource(item('token-1'));
    expect(result.accepted).toBe(false);
    expect(result.failures[0]).toMatchObject({ outcome: 'unknown', transactionSignature: 'sig-2' });
  });

  it('rejects duplicate source tokens', async () => {
    installBridge(async () => ({ accepted: true, published: [], failures: [] }));
    await expect(
      publishQdnResources([item('same'), item('same', 'mpr_2')]),
    ).rejects.toThrow(/distinct Home-issued source token/);
  });

  it('rejects batches above the Home limit', async () => {
    installBridge(async () => ({ accepted: true, published: [], failures: [] }));
    const items = Array.from({ length: HOME2_BATCH_MAX_ITEMS + 1 }, (_, index) =>
      item(`token-${index}`, `mpr_${index}`),
    );
    await expect(publishQdnResources(items)).rejects.toThrow(/at most 10 resources/);
  });

  it('parses batch success and failure records', async () => {
    const bridge = installBridge(async () => ({
      accepted: true,
      published: [
        {
          resource: { service: 'FILE', name: 'Alice', identifier: 'mpr_1' },
          transactionSignature: 'sig-1',
        },
      ],
      failures: [
        {
          resource: { service: 'JSON', name: 'Alice', identifier: 'mpr_desc_1' },
          error: 'rejected',
          outcome: 'rejected',
        },
      ],
    }));

    const result = await publishQdnResources([item('token-1')]);

    expect(bridge).toHaveBeenCalledWith({
      action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
      resources: [
        {
          service: 'FILE',
          name: 'Alice',
          identifier: 'mpr_1',
          sourceToken: 'token-1',
          title: 'File',
        },
      ],
    });
    expect(result.published[0].identifier).toBe('mpr_1');
    expect(result.failures[0]).toMatchObject({ identifier: 'mpr_desc_1', error: 'rejected' });
  });
});

describe('derived identifiers', () => {
  it('derives deterministic thumbnail and description coordinates', () => {
    expect(thumbnailIdentifierFor('mpr_abc')).toBe('mpr_thumb_abc');
    expect(descriptionIdentifierFor('mpr_abc')).toBe('mpr_desc_abc');
  });

  it('keeps derived identifiers within the 64-byte limit', () => {
    expect(descriptionIdentifierFor(`mpr_${'x'.repeat(100)}`)).toHaveLength(64);
  });
});
