# My File Office Release and Deployment Runbook

## Status

Release candidate for the Home 2+ compatibility and description/thumbnail
feature work. The app is **not** private storage: QDN `FILE`, `JSON` and
`THUMBNAIL` resources are public, and the UI gate does not provide
confidentiality.

Publication is an owner-authorized write. This repository intentionally contains
no CLI command that publishes to a live Qortium node.

## Publish the directory, never a ZIP file

Core only renders an APP as a website when the resource is a **directory**
resource. Home 2 does that when the source is a folder: it uploads the folder
archive with `isZip=true`, Core unpacks it, and `metadata.files` lists
`index.html` plus `assets/...`.

A ZIP selected or uploaded as a normal *file* is different. Home sends it as a
single-file publish, Core stores it opaquely, and `metadata.files` is just
`["<name>.zip"]`. `/arbitrary/APP/...` then returns that ZIP, while
`/render/APP/.../` has no `index.html` and returns **HTTP 404**.

The live `APP/My File Office/myfileoffice` resource was in exactly that state on
2026-11-01: `READY`, `metadata.files = ["myfileoffice.zip"]`, render root `404`,
and `/render/APP/My%20File%20Office/myfileoffice/myfileoffice.zip` `200`. The
ZIP's `index.html` and asset hashes matched the local `dist/`, so the defect was
the publication shape, not the build.

`npm run verify:live` now fails on this shape and names the repair. When
publishing, use **APP → folder/directory source → `dist/`**; do not select the
`dist.zip`/`myfileoffice.zip` file.

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

3. Inspect `dist/publish-manifest.json`. It records `publishAs: "directory"`,
   `entryPoint: "index.html"`, every file, byte size and SHA-256 digest in the
   release artifact. No network request is made.
4. Confirm the manifest contains `index.html`, all `assets/*.js`, all
   `assets/*.css`, `favicon.svg`, the background images, the lazy PDF renderer
   chunk and the pdf.js worker.
5. Record the source commit and artifact digest in the handoff.
6. `npm run verify:live` must report `verdict: PASS`, a `publishedShape.status`
   of `directory`, a `200` render root, matching served asset names and matching
   asset SHA-256 values. `READY` alone is not sufficient.

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
