import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import FilePreview from './FilePreview';
import type { PrivateFile } from '../../types';
import { utf8ToBase64 } from '../../services/qortium/qortiumClient';

type Bridge = (payload: Record<string, unknown>) => Promise<unknown>;
const globalRecord = globalThis as unknown as { qdnRequest?: Bridge };

const file = (overrides: Partial<PrivateFile> = {}): PrivateFile => ({
  id: 'Alice:mpr_1',
  identifier: 'mpr_1',
  name: 'Alice',
  fileName: 'greeting.txt',
  mimeType: 'text/plain',
  sizeBytes: 10,
  category: 'document',
  tags: [],
  uploadedAt: '2026-01-01T00:00:00.000Z',
  descriptionIdentifier: '',
  thumbnailIdentifier: '',
  ...overrides,
});

afterEach(() => {
  cleanup();
  delete globalRecord.qdnRequest;
});

describe('FilePreview', () => {
  it('renders UTF-8 text instead of decodable Latin-1 garbage', async () => {
    globalRecord.qdnRequest = async (payload) => {
      if (payload.action === 'FETCH_QDN_RESOURCE') return utf8ToBase64('Hei ä ö õ — tere');
      throw new Error(`Unexpected action ${String(payload.action)}`);
    };

    const { container } = render(<FilePreview file={file()} onClose={() => {}} />);

    await waitFor(() => {
      expect(container.querySelector('pre')?.textContent).toBe('Hei ä ö õ — tere');
    });
  });

  it('shows an explicit empty state for an empty text file', async () => {
    globalRecord.qdnRequest = async () => utf8ToBase64('');

    render(<FilePreview file={file()} onClose={() => {}} />);

    expect(await screen.findByText('This file is empty.')).toBeTruthy();
  });

  it('shows a clear error for an unsupported file type', async () => {
    render(<FilePreview file={file({ mimeType: 'application/zip' })} onClose={() => {}} />);

    expect(await screen.findByText('This file type cannot be previewed.')).toBeTruthy();
  });
});
