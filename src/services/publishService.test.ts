import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishFile, PublishError } from './publishService';
import type { GeneratedThumbnail } from './thumbnailService';

type Bridge = (payload: Record<string, unknown>) => Promise<unknown>;
const globalRecord = globalThis as unknown as { qdnRequest?: Bridge };

const HOME2_ACTIONS = [
  'SHOW_ACTIONS',
  'STAGE_QDN_PUBLISH_SOURCE',
  'PUBLISH_QDN_RESOURCE',
  'PUBLISH_MULTIPLE_QDN_RESOURCES',
];

interface FakeHome {
  bridge: Bridge;
  stageCalls: Record<string, unknown>[];
  singlePublishes: Record<string, unknown>[];
  batchPublishes: Record<string, unknown>[][];
}

const installHome = (options: { batch?: boolean; failFile?: boolean } = {}): FakeHome => {
  const stageCalls: Record<string, unknown>[] = [];
  const singlePublishes: Record<string, unknown>[] = [];
  const batchPublishes: Record<string, unknown>[][] = [];
  let token = 0;

  const bridge: Bridge = async (payload) => {
    switch (payload.action) {
      case 'SHOW_ACTIONS':
        return options.batch === false
          ? HOME2_ACTIONS.filter((action) => action !== 'PUBLISH_MULTIPLE_QDN_RESOURCES')
          : HOME2_ACTIONS;
      case 'STAGE_QDN_PUBLISH_SOURCE':
        stageCalls.push(payload);
        token += 1;
        return { sourceToken: `token-${token}`, fileName: payload.fileName, size: 1 };
      case 'GET_QDN_RESOURCE_STATUS':
        return { status: 'READY' };
      case 'PUBLISH_QDN_RESOURCE':
        singlePublishes.push(payload);
        return { accepted: true, transactionSignature: `single-${singlePublishes.length}` };
      case 'PUBLISH_MULTIPLE_QDN_RESOURCES': {
        const resources = payload.resources as Record<string, unknown>[];
        batchPublishes.push(resources);
        return {
          accepted: true,
          published: (options.failFile ? resources.slice(1) : resources).map((resource) => ({
            resource: {
              service: resource.service,
              name: resource.name,
              identifier: resource.identifier,
            },
            transactionSignature: `sig-${resource.identifier}`,
          })),
          failures: options.failFile
            ? [
                {
                  resource: {
                    service: 'FILE',
                    name: resources[0].name,
                    identifier: resources[0].identifier,
                  },
                  error: 'The file publish was rejected.',
                  outcome: 'rejected',
                },
              ]
            : [],
        };
      }
      default:
        throw new Error(`Unexpected action ${String(payload.action)}`);
    }
  };

  const spy = vi.fn(bridge);
  globalRecord.qdnRequest = spy;
  return { bridge: spy, stageCalls, singlePublishes, batchPublishes };
};

const file = (): File => new File(['hello world'], 'hello.txt', { type: 'text/plain' });

const thumbnail = (): GeneratedThumbnail => ({
  blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }),
  mimeType: 'image/webp',
  width: 100,
  height: 80,
  source: 'image',
});

afterEach(() => {
  delete globalRecord.qdnRequest;
});

describe('publishFile (Home 2 source-token contract)', () => {
  it('stages file, description and thumbnail and publishes them in one batch', async () => {
    const home = installHome();
    const progress: string[] = [];

    const result = await publishFile({
      file: file(),
      ownerName: 'Alice',
      categoryId: 'document',
      tags: ['holiday'],
      descriptionHtml: '<p><strong>Hello</strong> <a href="https://example.com">world</a></p>',
      thumbnail: thumbnail(),
      onProgress: (stage) => progress.push(stage),
    });

    expect(home.stageCalls).toHaveLength(3);
    expect(home.batchPublishes).toHaveLength(1);
    expect(home.singlePublishes).toHaveLength(0);
    expect(result.approvals).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(result.identifier).toMatch(/^mpr_/);
    expect(result.descriptionIdentifier).toBe(result.identifier.replace('mpr_', 'mpr_desc_'));
    expect(result.thumbnailIdentifier).toBe(result.identifier.replace('mpr_', 'mpr_thumb_'));

    const resources = home.batchPublishes[0];
    expect(resources.map((resource) => resource.service)).toEqual(['FILE', 'JSON', 'THUMBNAIL']);
    for (const resource of resources) {
      expect(typeof resource.sourceToken).toBe('string');
      expect(resource).not.toHaveProperty('base64');
      expect(resource).not.toHaveProperty('data64');
      expect(resource).not.toHaveProperty('filename');
      expect(resource).not.toHaveProperty('path');
      expect(resource).not.toHaveProperty('fee');
    }

    const fileResource = resources[0];
    expect(fileResource.name).toBe('Alice');
    expect(fileResource.category).toBe('PRODUCTIVITY');
    expect(fileResource.tags).toEqual(['document', 'holiday']);
    expect(fileResource.description).toContain('Hello');
    expect(fileResource.title).toBe('hello.txt');
    expect(progress).toContain('staging');
    expect(progress).toContain('publishing');
  });

  it('falls back to two approvals when Home cannot batch', async () => {
    const home = installHome({ batch: false });

    const result = await publishFile({
      file: file(),
      ownerName: 'Alice',
      categoryId: 'document',
      tags: [],
      descriptionHtml: '<p>Notes</p>',
      thumbnail: null,
    });

    expect(result.approvals).toBe(2);
    expect(home.singlePublishes).toHaveLength(2);
    expect(home.batchPublishes).toHaveLength(0);
    expect(home.singlePublishes[0].service).toBe('FILE');
    expect(home.singlePublishes[1].service).toBe('JSON');
  });

  it('publishes a file without derived resources in one approval', async () => {
    const home = installHome();

    const result = await publishFile({
      file: file(),
      ownerName: 'Alice',
      categoryId: 'other',
      tags: [],
      descriptionHtml: '',
      thumbnail: null,
    });

    expect(home.stageCalls).toHaveLength(1);
    expect(home.singlePublishes).toHaveLength(1);
    expect(result.approvals).toBe(1);
    expect(result.thumbnailIdentifier).toBeNull();
    expect(result.published).toHaveLength(1);
  });

  it('reports a file publish failure without pretending success', async () => {
    installHome({ failFile: true });

    await expect(
      publishFile({
        file: file(),
        ownerName: 'Alice',
        categoryId: 'document',
        tags: [],
        descriptionHtml: '<p>Notes</p>',
        thumbnail: null,
      }),
    ).rejects.toMatchObject({ name: 'PublishError', code: 'FILE_PUBLISH_FAILED' });
  });

  it('rejects an invalid description before staging anything', async () => {
    const home = installHome();

    await expect(
      publishFile({
        file: file(),
        ownerName: 'Alice',
        categoryId: 'document',
        tags: [],
        descriptionHtml: 'a'.repeat(10_001),
        thumbnail: null,
      }),
    ).rejects.toBeInstanceOf(PublishError);

    expect(home.stageCalls).toHaveLength(0);
  });

  it('requires a publisher name', async () => {
    installHome();
    await expect(
      publishFile({
        file: file(),
        ownerName: '  ',
        categoryId: 'document',
        tags: [],
        descriptionHtml: '',
        thumbnail: null,
      }),
    ).rejects.toMatchObject({ code: 'NO_PUBLISHER_NAME' });
  });
});
