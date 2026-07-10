/**
 * QDN publish helper for My File Office.
 *
 * Publishes the built dist/ as a QDN APP resource.
 *
 * Usage:
 *   npm run build && npm run qdn:publish
 *
 * Environment variables:
 *   - QORTIUM_NODE_API_URL   (default: http://127.0.0.1:24891)
 *   - QORTIUM_QDN_NAME        (default: MyFileOffice)
 *   - QORTIUM_QDN_IDENTIFIER  (default: MyFileOffice)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(__dirname, '..', 'dist');
const INDEX_PATH = resolve(__dirname, '..', 'dist', 'index.html');

const API_URL = process.env.QORTIUM_NODE_API_URL || 'http://127.0.0.1:24891';
const QDN_NAME = process.env.QORTIUM_QDN_NAME || 'MyFileOffice';
const QDN_IDENTIFIER = process.env.QORTIUM_QDN_IDENTIFIER || 'MyFileOffice';
const QDN_SERVICE = 'APP';

async function main() {
  if (!existsSync(DIST_DIR) || !existsSync(INDEX_PATH)) {
    console.error('Error: dist/ not found. Run `npm run build` first.');
    process.exit(1);
  }

  console.log(`Publishing ${QDN_SERVICE}/${QDN_NAME}/${QDN_IDENTIFIER} → ${API_URL}`);

  const indexHtml = readFileSync(INDEX_PATH, 'utf8');
  const base64 = Buffer.from(indexHtml, 'utf8').toString('base64');

  const body = JSON.stringify({
    action: 'PUBLISH_QDN_RESOURCE',
    name: QDN_NAME,
    service: QDN_SERVICE,
    identifier: QDN_IDENTIFIER,
    data64: base64,
    filename: 'index.html',
    title: 'My File Office',
    description: 'Personal encrypted file vault on Qortium',
    category: 'TECHNOLOGY',
  });

  try {
    const response = await fetch(`${API_URL}/arbitrary/APP/${QDN_NAME}/${QDN_IDENTIFIER}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`Publish failed (${response.status}):`, text);
      process.exit(1);
    }

    const result = await response.json();
    console.log('Published successfully:', JSON.stringify(result, null, 2));
    console.log(`\nOpen in Qortium Home: qdn://APP/${QDN_NAME}/${QDN_IDENTIFIER}`);
  } catch (err) {
    console.error('Publish error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
