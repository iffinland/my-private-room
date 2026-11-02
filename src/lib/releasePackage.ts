/**
 * APP release package helpers.
 *
 * Qortium Core renders an APP resource as a website only when the published
 * file tree has an index file at its root. Two publication shapes look similar
 * locally but behave very differently live:
 *
 * - a ZIP whose *root* contains index.html + assets/ (the shape this module
 *   builds), published with isZip/unpack enabled, becomes a directory resource
 *   and /render/APP/<name>/<id>/ returns 200;
 * - a ZIP whose root contains a dist/ directory, or a ZIP published as one
 *   opaque file, leaves no root index.html and the render root returns 404.
 *
 * The helpers here are pure (no Node imports) so the release script, the live
 * verifier and Vitest can all share exactly the same rules.
 */

export const APP_ENTRY_FILE = 'index.html';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export const crc32 = (data: Uint8Array): number => {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

export interface ReleaseFileEntry {
  /** Forward-slash path relative to the package root, e.g. "assets/app.js". */
  path: string;
  data: Uint8Array;
}

export const normalizePackagePath = (value: string): string =>
  value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');

const assertSafePackagePath = (value: string): void => {
  if (value === '' || value === '.' || value === '..') {
    throw new Error(`Invalid release path: "${value}"`);
  }
  if (value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Release path must be a normalized relative path: "${value}"`);
  }
};

/**
 * Build a deterministic, stored (uncompressed) ZIP. Stored entries keep the
 * writer dependency-free and byte-reproducible; the APP size budget (50 MiB in
 * Core, 250 MiB here) is far above the built app, and images are already
 * compressed.
 */
export const createStoredZip = (entries: ReleaseFileEntry[]): Uint8Array => {
  const prepared = [...entries]
    .map((entry) => ({ path: normalizePackagePath(entry.path), data: entry.data }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  const seen = new Set<string>();
  for (const entry of prepared) {
    assertSafePackagePath(entry.path);
    if (seen.has(entry.path)) throw new Error(`Duplicate release path: "${entry.path}"`);
    seen.add(entry.path);
    if (entry.data.length > 0xfffffffe) throw new Error(`Release file is too large: "${entry.path}"`);
  }

  const encoder = new TextEncoder();
  const encodedNames = prepared.map((entry) => encoder.encode(entry.path));
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  // Fixed DOS timestamp (1980-01-01 00:00:00) keeps the archive reproducible.
  const dosTime = 0;
  const dosDate = (1 << 5) | 1;

  prepared.forEach((entry, index) => {
    const name = encodedNames[index];
    const crc = crc32(entry.data);

    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true); // UTF-8 names
    localView.setUint16(8, 0, true); // stored
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, entry.data.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);

    localParts.push(local, entry.data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, entry.data.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);

    centralParts.push(central);
    offset += local.length + entry.data.length;
  });

  const centralOffset = offset;
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, prepared.length, true);
  endView.setUint16(10, prepared.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);
  endView.setUint16(20, 0, true);

  const totalSize =
    localParts.reduce((total, part) => total + part.length, 0) + centralSize + end.length;
  const output = new Uint8Array(totalSize);
  let cursor = 0;
  for (const part of [...localParts, ...centralParts, end]) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
};

export interface ZipEntryReadback {
  path: string;
  data: Uint8Array;
}

/**
 * Read a stored ZIP produced by {@link createStoredZip}. Supports stored
 * entries only; the release gate uses it to prove the archive's root layout
 * before anything is published.
 */
export const readStoredZip = (bytes: Uint8Array): ZipEntryReadback[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = -1;
  const minimum = Math.max(0, bytes.length - 22 - 0xffff);
  for (let index = bytes.length - 22; index >= minimum; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      endOffset = index;
      break;
    }
  }
  if (endOffset < 0) throw new Error('Not a ZIP archive: end-of-central-directory record not found.');

  const entryCount = view.getUint16(endOffset + 10, true);
  let cursor = view.getUint32(endOffset + 16, true);
  const decoder = new TextDecoder();
  const entries: ZipEntryReadback[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error('Corrupt ZIP archive: bad central-directory entry.');
    }
    const method = view.getUint16(cursor + 10, true);
    if (method !== 0) throw new Error('Unsupported ZIP archive: stored entries only.');
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

    if (view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error('Corrupt ZIP archive: bad local file header.');
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.slice(dataStart, dataStart + compressedSize);

    entries.push({ path: name, data });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
};

export class ReleasePackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleasePackageError';
  }
}

/**
 * Enforce the layout Core can actually render: index.html exactly at the
 * package root, every path relative, and no wrapper directory such as dist/.
 */
export const assertAppPackageEntries = (paths: string[]): string[] => {
  const normalized = paths.map(normalizePackagePath);
  const unique = [...new Set(normalized)].sort();

  if (unique.length === 0) {
    throw new ReleasePackageError('Release package is empty.');
  }

  for (const path of unique) {
    try {
      assertSafePackagePath(path);
    } catch (error) {
      throw new ReleasePackageError((error as Error).message);
    }
  }

  const nestedRoots = unique.filter((path) => path.endsWith(`/${APP_ENTRY_FILE}`));
  if (nestedRoots.length > 0) {
    throw new ReleasePackageError(
      `Release package has index.html below a wrapper directory (${nestedRoots.join(', ')}). ` +
        'Core only renders an APP when index.html is at the archive root; zip the contents of dist/, not dist/ itself.',
    );
  }

  if (!unique.includes(APP_ENTRY_FILE)) {
    throw new ReleasePackageError(
      `Release package has no top-level ${APP_ENTRY_FILE}. Core will not render the APP.`,
    );
  }

  return unique;
};
