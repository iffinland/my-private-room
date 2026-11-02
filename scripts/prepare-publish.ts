#!/usr/bin/env -S npx tsx
/**
 * Publication preflight for My File Office.
 *
 * Performs NO network writes. It verifies the production build and produces a
 * publish-ready APP ZIP whose root contains index.html. The previous helper
 * only pointed at dist/ and warned about ZIPs; the recurring live failure was
 * a published resource whose metadata.files was ["<name>.zip"], so Core kept
 * the archive opaque and /render/APP/... returned HTTP 404.
 *
 *   npm run build
 *   npm run qdn:prepare
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractEntryAssetPaths } from '../src/lib/releaseArtifact';
import {
  APP_ENTRY_FILE,
  assertAppPackageEntries,
  createStoredZip,
  readStoredZip,
  type ReleaseFileEntry,
} from '../src/lib/releasePackage';

const PROJECT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = join(PROJECT_DIR, 'dist');
const RELEASE_DIR = join(PROJECT_DIR, 'release');
const PACKAGE_PATH = join(RELEASE_DIR, 'myfileoffice-app.zip');
const MANIFEST_PATH = join(DIST_DIR, 'publish-manifest.json');
const MAX_APP_BYTES = 250 * 1024 * 1024;

const fail = (message: string): never => {
  console.error(`prepare-publish: ${message}`);
  process.exit(1);
};

if (!existsSync(join(DIST_DIR, APP_ENTRY_FILE))) {
  fail('dist/index.html is missing. Run `npm run build` first.');
}

const walk = (directory: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'publish-manifest.json' || entry.name === '.DS_Store') continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
};

const toPackagePath = (absolute: string): string => relative(DIST_DIR, absolute).split(sep).join('/');

const files = walk(DIST_DIR).sort();
const indexHtml = readFileSync(join(DIST_DIR, APP_ENTRY_FILE), 'utf8');

// Every asset referenced by index.html must exist in the package, otherwise the
// render root can be 200 while the app still fails to boot.
const referenced = extractEntryAssetPaths(indexHtml);
for (const reference of referenced) {
  const absolute = resolve(DIST_DIR, reference);
  const prefix = DIST_DIR.endsWith(sep) ? DIST_DIR : `${DIST_DIR}${sep}`;
  if (!absolute.startsWith(prefix) || !existsSync(absolute)) {
    fail(`index.html references a missing asset: ${reference}`);
  }
}

const entryFiles: ReleaseFileEntry[] = files.map((absolute) => ({
  path: toPackagePath(absolute),
  data: new Uint8Array(readFileSync(absolute)),
}));
const packagePaths = assertAppPackageEntries(entryFiles.map((entry) => entry.path));

const packageBytes = createStoredZip(entryFiles);

// Read the archive back and prove the bytes/layout before writing the manifest.
const readback = readStoredZip(packageBytes);
const readbackPaths = readback.map((entry) => entry.path);
if (readbackPaths.length !== packagePaths.length || readbackPaths.some((path, index) => path !== packagePaths[index])) {
  fail('release ZIP read-back does not match the built file list.');
}
for (const entry of readback) {
  const source = entryFiles.find((candidate) => candidate.path === entry.path);
  if (!source || Buffer.compare(Buffer.from(source.data), Buffer.from(entry.data)) !== 0) {
    fail(`release ZIP read-back differs for ${entry.path}`);
  }
}

const totalBytes = entryFiles.reduce((total, entry) => total + entry.data.length, 0);
if (totalBytes > MAX_APP_BYTES) {
  fail(`dist/ is ${(totalBytes / 1024 / 1024).toFixed(1)} MiB, above the 250 MiB safety budget.`);
}

mkdirSync(RELEASE_DIR, { recursive: true });
writeFileSync(PACKAGE_PATH, packageBytes);

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const manifest = {
  application: 'My File Office',
  service: 'APP',
  name: 'My File Office',
  identifier: 'myfileoffice',
  // The archive root is the APP root. Publishing this archive with Home's
  // APP/WEBSITE ZIP handling makes Core unpack it into a directory resource.
  publishAs: 'app-zip',
  packageRoot: 'contents of dist/',
  entryPoint: APP_ENTRY_FILE,
  preparedAt: new Date().toISOString(),
  note: 'Generated locally. No network request or QDN publication was performed.',
  totalBytes,
  files: entryFiles.map((entry) => ({
    path: entry.path,
    bytes: entry.data.length,
    sha256: sha256(entry.data),
  })),
  package: {
    path: relative(PROJECT_DIR, PACKAGE_PATH).split(sep).join('/'),
    bytes: packageBytes.length,
    sha256: sha256(packageBytes),
    entries: packagePaths.length,
  },
};

writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\\n`);

console.log(`Prepared ${entryFiles.length} files (${(totalBytes / 1024).toFixed(1)} KiB).`);
console.log(`Package: ${manifest.package.path} (${manifest.package.bytes} bytes, sha256 ${manifest.package.sha256}).`);
console.log(`Manifest: ${relative(PROJECT_DIR, MANIFEST_PATH)}`);
console.log('Root layout verified: index.html + ' + referenced.length + ' referenced assets; no dist/ wrapper.');
console.log('No network request or QDN publication was performed.');
console.log('');
console.log('Owner publication step (requires explicit authorization):');
console.log('  1. Open Qortium Home 2.1.0-beta.14 or newer and select the publishing account.');
console.log('  2. Publish APP → "My File Office" / identifier "myfileoffice".');
console.log('  3. Select release/myfileoffice-app.zip as the source (or the dist/ folder itself).');
console.log('     Home must send isZip=true; Core then unpacks index.html at the archive root.');
console.log('  4. Keep the description accurate: public QDN file library, not private storage.');
console.log('  5. Run `npm run verify:live`; metadata.files must list index.html and assets/.');
console.log('  6. Compare the published file list with dist/publish-manifest.json.');
