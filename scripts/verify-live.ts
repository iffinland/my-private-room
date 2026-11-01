#!/usr/bin/env -S npx tsx
/**
 * Read-only live verification for My File Office.
 *
 * Issues GET requests only. It never publishes, deletes, signs or changes
 * anything. The check distinguishes three layers that are easy to conflate:
 *
 * 1. the node is synced and the APP resource is READY;
 * 2. the published resource is a *directory* APP (not an opaque ZIP file);
 * 3. `/render/APP/<name>/<id>/` serves index.html and the same JS/CSS/favicon
 *    names (and bytes, when `dist/` exists) as the local release artifact.
 *
 *   node scripts/verify-live.ts            # via npm run verify:live
 *   QORTIUM_API_URL=http://127.0.0.1:24891 npm run verify:live
 *   QDN_APP_NAME="My File Office" QDN_APP_IDENTIFIER=myfileoffice npm run verify:live
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyPublishedApp,
  compareEntryAssets,
  extractEntryAssetPaths,
} from '../src/lib/releaseArtifact';

const baseUrl = (process.env.QORTIUM_API_URL || 'http://127.0.0.1:24891').replace(/\/$/, '');
const appName = process.env.QDN_APP_NAME || 'My File Office';
const appIdentifier = process.env.QDN_APP_IDENTIFIER || 'myfileoffice';

const projectDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const distDir = join(projectDir, 'dist');
const localIndexPath = join(distDir, 'index.html');

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const getJson = async (path: string): Promise<unknown> => {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${path} -> HTTP ${response.status}`);
  return response.json();
};

const fetchResource = async (path: string): Promise<Response> =>
  fetch(`${baseUrl}${path}`, {
    headers: { accept: '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000),
  });

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const encodeAssetPath = (path: string): string =>
  path.split('/').map((segment) => encodeURIComponent(segment)).join('/');

const resolveInsideDist = (relativePath: string): string | null => {
  const absolute = resolve(distDir, relativePath);
  const prefix = distDir.endsWith(sep) ? distDir : `${distDir}${sep}`;
  return absolute === distDir || absolute.startsWith(prefix) ? absolute : null;
};

const isHtml = (contentType: string, body: string): boolean =>
  contentType.toLowerCase().includes('text/html') || /^\s*<!doctype html/i.test(body);

interface AssetEvidence {
  path: string;
  httpStatus: number | null;
  servedSha256: string | null;
  localSha256: string | null;
  matchesLocal: boolean | null;
  error?: string;
}

interface Report {
  checkedAt: string;
  api: string;
  node: Record<string, unknown>;
  app: Record<string, unknown>;
  render: Record<string, unknown> | null;
  assets: AssetEvidence[];
  failures: string[];
  warnings: string[];
  verdict: 'PASS' | 'FAIL';
  note: string;
}

async function main(): Promise<void> {
  const failures: string[] = [];
  const warnings: string[] = [];

  const status = asRecord(await getJson('/admin/status'));
  const info = asRecord(await getJson('/admin/info'));

  const encodedName = encodeURIComponent(appName);
  const encodedIdentifier = encodeURIComponent(appIdentifier);

  const properties = asRecord(
    await getJson(`/arbitrary/resource/properties/APP/${encodedName}/${encodedIdentifier}`),
  );
  const appStatus = asRecord(
    await getJson(`/arbitrary/resource/status/APP/${encodedName}/${encodedIdentifier}?build=false`),
  );
  const metadata = asRecord(await getJson(`/arbitrary/metadata/APP/${encodedName}/${encodedIdentifier}`));

  const shape = classifyPublishedApp(metadata.files);
  const syncPercent = numberOrNull(status.syncPercent);

  if (syncPercent !== null && syncPercent < 100) {
    failures.push(`Node is not fully synchronized: ${syncPercent}%`);
  }
  if (appStatus.status !== 'READY') {
    failures.push(`Published app resource is not READY: ${String(appStatus.status ?? 'unknown')}`);
  }
  if (shape.status !== 'directory') {
    failures.push(
      `${shape.message} Republish the built dist/ directory through Qortium Home's APP folder ` +
        'source (SELECT_QDN_PUBLISH_SOURCE kind=directory); do not publish dist/ as one ZIP file.',
    );
  }

  const renderPath = `/render/APP/${encodedName}/${encodedIdentifier}/`;
  const render: Record<string, unknown> = {
    url: `${baseUrl}${renderPath}`,
    httpStatus: null,
    contentType: null,
    bytes: null,
    servedIndex: false,
    assetComparison: null,
  };
  const assets: AssetEvidence[] = [];

  const renderResponse = await fetchResource(renderPath);
  const renderBody = await renderResponse.text();
  render.httpStatus = renderResponse.status;
  render.bytes = renderBody.length;
  render.contentType = renderResponse.headers.get('content-type');
  render.servedIndex = isHtml(renderResponse.headers.get('content-type') ?? '', renderBody);

  if (!renderResponse.ok || !render.servedIndex) {
    failures.push(
      `Render root ${renderPath} returned HTTP ${renderResponse.status} ` +
        `(${renderResponse.headers.get('content-type') ?? 'no content type'}), not an index.html document.`,
    );
  }

  const localDist = existsSync(localIndexPath);
  if (!localDist) {
    warnings.push(
      'dist/index.html is missing; live bundle-name/hash comparison was skipped. Run `npm run build` first.',
    );
  }

  if (renderResponse.ok && render.servedIndex) {
    let expectedAssets: string[] = [];

    if (localDist) {
      const localHtml = readFileSync(localIndexPath, 'utf8');
      const comparison = compareEntryAssets(localHtml, renderBody);
      render.assetComparison = comparison;
      expectedAssets = comparison.expectedAssets;

      if (!comparison.matches) {
        failures.push(
          `Served index assets differ from the local build. Missing live: ` +
            `[${comparison.missingFromServed.join(', ')}]; not in local build: ` +
            `[${comparison.unexpectedInServed.join(', ')}].`,
        );
      }
    } else {
      expectedAssets = extractEntryAssetPaths(renderBody);
    }

    for (const asset of expectedAssets) {
      const evidence: AssetEvidence = {
        path: asset,
        httpStatus: null,
        servedSha256: null,
        localSha256: null,
        matchesLocal: null,
      };

      const localPath = localDist ? resolveInsideDist(asset) : null;
      if (localDist && (!localPath || !existsSync(localPath))) {
        evidence.error = 'Asset is referenced but missing from the local build.';
        failures.push(`${asset}: referenced by index.html but missing from dist/.`);
        assets.push(evidence);
        continue;
      }

      if (localPath) evidence.localSha256 = sha256(readFileSync(localPath));

      const assetResponse = await fetchResource(
        `/render/APP/${encodedName}/${encodedIdentifier}/${encodeAssetPath(asset)}`,
      );
      evidence.httpStatus = assetResponse.status;

      if (!assetResponse.ok) {
        evidence.error = `HTTP ${assetResponse.status}`;
        failures.push(`${asset}: live render returned HTTP ${assetResponse.status}.`);
        assets.push(evidence);
        continue;
      }

      const servedBytes = new Uint8Array(await assetResponse.arrayBuffer());
      evidence.servedSha256 = sha256(servedBytes);

      if (evidence.localSha256) {
        evidence.matchesLocal = evidence.servedSha256 === evidence.localSha256;
        if (!evidence.matchesLocal) {
          failures.push(
            `${asset}: served SHA-256 ${evidence.servedSha256} differs from local ${evidence.localSha256}.`,
          );
        }
      }

      assets.push(evidence);
    }
  }

  const report: Report = {
    checkedAt: new Date().toISOString(),
    api: baseUrl,
    node: {
      buildVersion: stringOrNull(info.buildVersion),
      buildTimestamp: numberOrNull(info.buildTimestamp),
      syncPercent,
      height: numberOrNull(status.height),
      numberOfConnections: numberOrNull(status.numberOfConnections),
    },
    app: {
      service: 'APP',
      name: appName,
      identifier: appIdentifier,
      status: stringOrNull(appStatus.status),
      size: numberOrNull(properties.size),
      filename: stringOrNull(properties.filename),
      mimeType: stringOrNull(properties.mimeType),
      title: stringOrNull(metadata.title),
      files: Array.isArray(metadata.files) ? metadata.files : null,
      publishedShape: { status: shape.status, message: shape.message },
    },
    render,
    assets,
    failures,
    warnings,
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    note: 'Read-only check. No publish, delete, signing or transaction request was sent.',
  };

  console.log(JSON.stringify(report, null, 2));

  if (failures.length > 0) {
    console.error(`verify-live: FAIL (${failures.length} issue${failures.length === 1 ? '' : 's'})`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`verify-live: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
