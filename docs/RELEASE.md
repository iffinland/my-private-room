# My File Office Release and Deployment Runbook

## Status: blocked

The current project is not approved for release as private storage. QDN `FILE`
resources are public, and the UI gate does not provide confidentiality.

The existing `npm run qdn:publish` helper is also **not an approved release
path**: current source sends only `dist/index.html` rather than a verified full
application artifact and publishes the misleading description “Personal
encrypted file vault on Qortium”. It must be corrected and reviewed in a
separate implementation task before use.

## Required owner decisions

1. Product/privacy model and acceptable public-data disclosure.
2. Final product name, APP publisher name, identifier, and live URI.
3. Full artifact packaging/publication mechanism.
4. Threat model, encryption, and key lifecycle if confidentiality is required.

## Pre-release gates after remediation

1. Record Git/remote/working-tree baseline and preserve owner changes.
2. Verify manifest/identity/version/permissions and intended environment.
3. Run:

   ```bash
   npm ci
   npm run build
   npm run lint
   git diff --check
   ```

4. Inspect the complete artifact and record source commit plus SHA-256.
5. Independently review privacy claims and publication payload.

## Deployment validation

Only after explicit authorization, publish via the remediated reviewed path and
record the transaction/resource reference. Validate exact deployed routes,
selected account, public resource visibility, file/reference discovery,
ownership, refresh/readback, and failure recovery in Home. Never report
confidentiality without cryptographic and live evidence.
