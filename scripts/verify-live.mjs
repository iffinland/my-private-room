#!/usr/bin/env node
/**
 * Read-only live verification for My File Office.
 *
 * This script only issues GET requests to a locally reachable Qortium node.
 * It never publishes, deletes, signs or changes anything. Run it before a
 * release to record the node/app state that the build was validated against.
 *
 *   node scripts/verify-live.mjs
 *   QORTIUM_API_URL=http://127.0.0.1:24891 node scripts/verify-live.mjs
 *   QDN_APP_NAME="My File Office" QDN_APP_IDENTIFIER=myfileoffice node scripts/verify-live.mjs
 */

const baseUrl = (process.env.QORTIUM_API_URL || 'http://127.0.0.1:24891').replace(/\/$/, '');
const appName = process.env.QDN_APP_NAME || 'My File Office';
const appIdentifier = process.env.QDN_APP_IDENTIFIER || 'myfileoffice';

const getJson = async (path) => {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${path} -> HTTP ${response.status}`);
  return response.json();
};

const pick = (value, keys) =>
  Object.fromEntries(keys.map((key) => [key, value?.[key] ?? null]));

const main = async () => {
  const status = await getJson('/admin/status');
  const info = await getJson('/admin/info');

  const encodedName = encodeURIComponent(appName);
  const encodedIdentifier = encodeURIComponent(appIdentifier);
  const appProperties = await getJson(
    `/arbitrary/resource/properties/APP/${encodedName}/${encodedIdentifier}`,
  );
  const appStatus = await getJson(
    `/arbitrary/resource/status/APP/${encodedName}/${encodedIdentifier}?build=false`,
  );
  const appMetadata = await getJson(`/arbitrary/metadata/APP/${encodedName}/${encodedIdentifier}`);

  const report = {
    checkedAt: new Date().toISOString(),
    api: baseUrl,
    node: {
      ...pick(info, ['buildVersion', 'buildTimestamp']),
      ...pick(status, [
        'syncPercent',
        'height',
        'numberOfConnections',
        'isMintingPossible',
        'isQDNPortMapped',
        'isP2PPortMapped',
      ]),
    },
    app: {
      service: 'APP',
      name: appName,
      identifier: appIdentifier,
      status: appStatus.status ?? null,
      size: appProperties.size ?? null,
      title: appMetadata.title ?? null,
      files: appMetadata.files ?? null,
    },
    note: 'Read-only check. No publish, delete, signing or transaction request was sent.',
  };

  console.log(JSON.stringify(report, null, 2));

  if (status.syncPercent !== undefined && Number(status.syncPercent) < 100) {
    throw new Error(`Node is not fully synchronized: ${status.syncPercent}%`);
  }
  if (appStatus.status !== 'READY') {
    throw new Error(`Published app resource is not READY: ${appStatus.status}`);
  }
};

main().catch((error) => {
  console.error(`verify-live: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
