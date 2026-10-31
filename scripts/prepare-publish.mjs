#!/usr/bin/env node
/**
 * Publication preflight for My File Office.
 *
 * This script performs NO network writes. It verifies that the built `dist/`
 * is a complete, self-contained QDN APP artifact and writes a manifest with
 * every file and SHA-256 digest for review.
 *
 * Publication is a separate, explicitly authorized owner action through
 * Qortium Home's APP folder publish flow. The previous direct-Core publish
 * helper sent only `dist/index.html` with inline base64, which cannot produce a
 * working APP resource and used an inaccurate description.
 *
 *   npm run build
 *   npm run qdn:prepare
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, '..');
const DIST_DIR = resolve(PROJECT_DIR, 'dist');
const INDEX_PATH = resolve(DIST_DIR, 'index.html');
const MANIFEST_PATH = resolve(DIST_DIR, 'publish-manifest.json');
const MAX_APP_BYTES = 250 * 1024 * 1024;

const fail = (message) => {
  console.error(`prepare-publish: ${message}`);
  process.exit(1);
};

if (!existsSync(INDEX_PATH)) {
  fail('dist/index.html is missing. Run `npm run build` first.');
}

const walk = (directory) => {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'publish-manifest.json') continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
};

const files = walk(DIST_DIR).sort();
const indexHtml = readFileSync(INDEX_PATH, 'utf8');

// Every script/stylesheet referenced by index.html must exist locally.
const referenced = [...indexHtml.matchAll(/(?:src|href)="\.?\/?([^"]+)"/g)]
  .map((match) => match[1])
  .filter((path) => !/^(https?:|data:|#)/.test(path) && !path.endsWith('.ico'));

for (const reference of referenced) {
  if (!existsSync(resolve(DIST_DIR, reference))) {
    fail(`index.html references missing asset: ${reference}`);
  }
}

const entries = files.map((absolute) => {
  const bytes = statSync(absolute).size;
  const digest = createHash('sha256').update(readFileSync(absolute)).digest('hex');
  return {
    path: relative(DIST_DIR, absolute).split('\\').join('/'),
    bytes,
    sha256: digest,
  };
});

const totalBytes = entries.reduce((total, entry) => total + entry.bytes, 0);
if (totalBytes > MAX_APP_BYTES) {
  fail(`dist/ is ${(totalBytes / 1024 / 1024).toFixed(1)} MiB, above the 250 MiB safety budget.`);
}

const manifest = {
  application: 'My File Office',
  service: 'APP',
  preparedAt: new Date().toISOString(),
  note: 'Generated locally. No network request or QDN publication was performed.',
  totalBytes,
  files: entries,
};

writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Prepared ${entries.length} files (${(totalBytes / 1024).toFixed(1)} KiB).`);
console.log(`Manifest: ${relative(PROJECT_DIR, MANIFEST_PATH)}`);
console.log('No network request or QDN publication was performed.');
console.log('');
console.log('Owner publication step (requires explicit authorization):');
console.log('  1. Open Qortium Home 2.x and select the publishing account.');
console.log('  2. Publish APP → folder → this project\'s dist/ directory.');
console.log('  3. Name: "My File Office"; identifier: "myfileoffice".');
console.log('  4. Keep the description accurate: public QDN file library, not private storage.');
console.log('  5. Compare the published file list with the manifest before announcing the release.');
