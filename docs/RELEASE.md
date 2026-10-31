# My File Office Release and Deployment Runbook

## Status

Release candidate for the Home 2+ compatibility and description/thumbnail
feature work. The app is **not** private storage: QDN `FILE`, `JSON` and
`THUMBNAIL` resources are public, and the UI gate does not provide
confidentiality.

Publication is an owner-authorized write. This repository intentionally contains
no CLI command that publishes to a live Qortium node.

## Required owner decisions before publication

1. Product/privacy wording. The current wording must not imply confidentiality.
2. Final APP publisher name, identifier and display name. The existing live
   resource is `APP/My File Office/myfileoffice`; keep it only if that is still
   the intended coordinate.
3. Whether the release folder is published through Qortium Home's APP folder
   flow or another reviewed publisher.

## Pre-release gates

1. Record Git branch, HEAD and clean working-tree state.
2. Run:

   ```bash
   npm ci
   npm run lint
   npm run test
   npm run build
   npm run qdn:prepare
   npm run verify:live
   git diff --check
   ```

3. Inspect `dist/publish-manifest.json`. It records every file, byte size and
   SHA-256 digest in the release artifact. No network request is made.
4. Confirm the manifest contains `index.html`, all `assets/*.js`, all
   `assets/*.css`, the background images, the lazy PDF renderer chunk and the
   pdf.js worker.
5. Record the source commit and artifact digest in the handoff.

## Publication (owner only, explicit authorization)

Use Qortium Home 2.1.0-beta.14 or newer:

1. Select the publishing account with a registered name.
2. Publish **APP** → folder → the project's `dist/` directory.
3. Use the owner-approved name/identifier (current live:
   `My File Office` / `myfileoffice`).
4. Description must stay accurate, for example:
   “My File Office is a QDN file library for Qortium Home. Published resources
   are public. Publish, browse, preview, describe and share files.”
5. Category/tags must be valid Core values; do not add an app-supplied fee.
6. Wait for Home's approval prompt once per publish request. Folder/APP
   publication is one request.

Do not use inline `data64` request bodies, a single `index.html`, or a
`base64`/`zip` blob whose asset paths would 404. The previous helper did that and
is not a valid release path; it has been removed.

## Post-publication validation

1. `npm run verify:live` must report the APP resource `READY`.
2. Fetch `/render/APP/<name>/<identifier>` and confirm `index.html` names the
   same JS/CSS hashes as `dist/index.html`.
3. Compare each served asset's SHA-256 with `dist/publish-manifest.json`.
4. Validate inside Home:
   - account selection and publish approval;
   - file listing and legacy files;
   - rich description create → view → reopen;
   - generated/custom thumbnail card display and fallback icons;
   - file preview (image, video, audio, PDF, text/JSON);
   - delete removes file, description and thumbnail;
   - publish failure/`outcome: 'unknown'` messaging.
5. Record exact resource coordinates, transaction signatures and read-back
   evidence. A visible resource or `accepted: true` alone is not proof that the
   intended bundle is served.

Never report confidentiality without cryptographic and live evidence.
