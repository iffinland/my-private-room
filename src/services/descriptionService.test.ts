import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDescriptionDocument,
  clearDescriptionCache,
  descriptionMetadataExcerpt,
  DESCRIPTION_SCHEMA,
  DescriptionTooLongError,
  loadFileDescription,
  MAX_DESCRIPTION_TEXT,
} from './descriptionService';
import { descriptionIdentifierFor, utf8ToBase64 } from './qortium/qortiumClient';
import type { PrivateFile } from '../types';

type Bridge = (payload: Record<string, unknown>) => Promise<unknown>;
const globalRecord = globalThis as unknown as { qdnRequest?: Bridge };

const installBridge = (handler: Bridge) => {
  globalRecord.qdnRequest = vi.fn(handler);
};

const descriptionFile = (overrides: Partial<PrivateFile> = {}): PrivateFile => ({
  id: 'Alice:mpr_1',
  identifier: 'mpr_1',
  name: 'Alice',
  fileName: 'notes.txt',
  mimeType: 'text/plain',
  sizeBytes: 12,
  category: 'document',
  tags: [],
  uploadedAt: '2026-01-01T00:00:00.000Z',
  descriptionIdentifier: descriptionIdentifierFor('mpr_1'),
  thumbnailIdentifier: '',
  ...overrides,
});

beforeEach(() => {
  clearDescriptionCache();
});

afterEach(() => {
  delete globalRecord.qdnRequest;
});

describe('buildDescriptionDocument', () => {
  it('sanitizes markup and derives plain text', () => {
    const document = buildDescriptionDocument(
      '<p onclick="x()"><strong>Hello</strong> <a href="javascript:alert(1)">world</a></p>',
    );
    expect(document).not.toBeNull();
    expect(document?.schema).toBe(DESCRIPTION_SCHEMA);
    expect(document?.format).toBe('html');
    expect(document?.html).toBe('<p><strong>Hello</strong> world</p>');
    expect(document?.text).toBe('Hello world');
    expect(document?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns null for empty or whitespace-only content', () => {
    expect(buildDescriptionDocument('')).toBeNull();
    expect(buildDescriptionDocument('<p><br></p>')).toBeNull();
  });

  it('rejects descriptions above the text limit', () => {
    expect(() => buildDescriptionDocument('a'.repeat(MAX_DESCRIPTION_TEXT + 1))).toThrow(
      DescriptionTooLongError,
    );
  });

  it('builds a metadata excerpt within Core limits', () => {
    const excerpt = descriptionMetadataExcerpt(`<p>${'ä'.repeat(500)}</p>`);
    expect(new TextEncoder().encode(excerpt).length).toBeLessThanOrEqual(240);
  });
});

describe('loadFileDescription', () => {
  it('loads and re-sanitizes a dedicated description resource', async () => {
    const document = {
      schema: DESCRIPTION_SCHEMA,
      format: 'html',
      html: '<p><strong>Stored</strong><script>alert(1)</script></p>',
      text: 'Stored',
      updatedAt: '2026-02-03T04:05:06.000Z',
    };
    const bridge = vi.fn(async () => utf8ToBase64(JSON.stringify(document)));
    installBridge(bridge);

    const loaded = await loadFileDescription('Alice', descriptionFile());

    expect(bridge).toHaveBeenCalledWith({
      action: 'FETCH_QDN_RESOURCE',
      service: 'JSON',
      name: 'Alice',
      identifier: descriptionIdentifierFor('mpr_1'),
      encoding: 'base64',
    });
    expect(loaded.source).toBe('resource');
    expect(loaded.html).toBe('<p><strong>Stored</strong></p>');
    expect(loaded.text).toBe('Stored');
    expect(loaded.updatedAt).toBe('2026-02-03T04:05:06.000Z');
  });

  it('falls back to legacy metadata when the description resource is missing', async () => {
    installBridge(async () => {
      throw new Error('Resource does not exist.');
    });

    const loaded = await loadFileDescription(
      'Alice',
      descriptionFile({ description: 'Legacy <plain> text' }),
    );

    expect(loaded.source).toBe('legacy-metadata');
    expect(loaded.text).toBe('Legacy <plain> text');
    expect(loaded.html).toBe('<p>Legacy &lt;plain&gt; text</p>');
  });

  it('returns an empty result for legacy files without a description', async () => {
    installBridge(async () => {
      throw new Error('Resource does not exist.');
    });

    const loaded = await loadFileDescription('Alice', descriptionFile());
    expect(loaded).toMatchObject({ html: '', text: '', source: 'none' });
  });

  it('caches the result per publisher and file', async () => {
    const bridge = vi.fn(async () => {
      throw new Error('Resource does not exist.');
    });
    installBridge(bridge);

    await loadFileDescription('Alice', descriptionFile());
    await loadFileDescription('Alice', descriptionFile());

    expect(bridge).toHaveBeenCalledTimes(1);
  });
});
