/**
 * Pure helpers for the release/deployment gate.
 *
 * A built `dist/` directory can be perfectly valid while the published QDN APP
 * is still unusable. Qortium Core only serves `/render/APP/<name>/<id>/` as a
 * website when the resource is a *directory* resource. If a ZIP archive is
 * published as a single file (`isZip` absent/false), Core keeps it opaque:
 * metadata.files is `["<name>.zip"]`, the render root has no index.html and
 * Home shows HTTP 404. These helpers make that difference explicit so the
 * release check fails with the real cause instead of only checking READY.
 */

export const APP_ENTRY_FILE = 'index.html';

export type PublishedAppShapeStatus =
  | 'directory'
  | 'opaque-archive'
  | 'missing-entry'
  | 'unknown';

export interface PublishedAppShape {
  status: PublishedAppShapeStatus;
  files: string[];
  message: string;
}

/** Normalize a metadata file entry to a forward-slash, relative path. */
export const normalizePublishedPath = (value: string): string =>
  value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');

const isUsablePath = (value: string): boolean =>
  value !== '' && value !== '.' && value !== '..' && !value.startsWith('../');

/** Keep only usable string entries from Core metadata `files`. */
export const normalizePublishedFiles = (rawFiles: unknown): string[] => {
  if (!Array.isArray(rawFiles)) return [];
  return rawFiles
    .filter((value): value is string => typeof value === 'string')
    .map(normalizePublishedPath)
    .filter(isUsablePath);
};

/**
 * Classify the *published* APP resource from Core metadata `files`.
 *
 * - `directory`: Home/Core unpacked the folder archive (isZip=true).
 * - `opaque-archive`: a single ZIP was published as a file, which Core cannot
 *   render as an app. This is the observed cause of a render-root 404.
 * - `missing-entry`: multi-file but no top-level index.html.
 */
export const classifyPublishedApp = (rawFiles: unknown): PublishedAppShape => {
  const files = normalizePublishedFiles(rawFiles);

  if (files.length === 0) {
    return {
      status: 'unknown',
      files,
      message:
        'Core metadata has no file list, so the published APP cannot be proven to be a directory resource.',
    };
  }

  if (files.length === 1 && /\.zip$/i.test(files[0])) {
    return {
      status: 'opaque-archive',
      files,
      message:
        `Published as a single opaque archive (${files[0]}). Core serves the ZIP as a file, ` +
        `so /render/APP/.../ has no ${APP_ENTRY_FILE} and returns HTTP 404.`,
    };
  }

  if (!files.includes(APP_ENTRY_FILE)) {
    return {
      status: 'missing-entry',
      files,
      message: `Published file list has no top-level ${APP_ENTRY_FILE}.`,
    };
  }

  return {
    status: 'directory',
    files,
    message: `Published as a directory resource with ${files.length} files.`,
  };
};

/**
 * Extract local asset references from an index.html.
 *
 * Host-injected absolute paths (`<base>`, `/apps/q-apps.js`) and external/data
 * URLs are ignored because they are not part of the release artifact.
 */
export const extractEntryAssetPaths = (html: string): string[] => {
  const paths = new Set<string>();

  for (const match of html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)) {
    const raw = match[1].trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('/')) continue;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) continue;

    const withoutQuery = raw.split(/[?#]/)[0];
    const normalized = normalizePublishedPath(withoutQuery);
    if (isUsablePath(normalized)) paths.add(normalized);
  }

  return [...paths].sort();
};

export interface EntryAssetComparison {
  expectedAssets: string[];
  servedAssets: string[];
  missingFromServed: string[];
  unexpectedInServed: string[];
  matches: boolean;
}

/**
 * Compare the assets referenced by the local build's index.html with the ones
 * the live render root serves. A mismatch means the published bundle is not the
 * bundle that was built and tested.
 */
export const compareEntryAssets = (
  expectedHtml: string,
  servedHtml: string,
): EntryAssetComparison => {
  const expectedAssets = extractEntryAssetPaths(expectedHtml);
  const servedAssets = extractEntryAssetPaths(servedHtml);
  const served = new Set(servedAssets);
  const expected = new Set(expectedAssets);

  const missingFromServed = expectedAssets.filter((asset) => !served.has(asset));
  const unexpectedInServed = servedAssets.filter((asset) => !expected.has(asset));

  return {
    expectedAssets,
    servedAssets,
    missingFromServed,
    unexpectedInServed,
    matches: missingFromServed.length === 0 && unexpectedInServed.length === 0,
  };
};
