# My File Office Release and Deployment Runbook

## Status

Release candidate for the Home 2+ compatibility and description/thumbnail
feature work. The app is **not** private storage: QDN `FILE`, `JSON` and
`THUMBNAIL` resources are public, and the UI gate does not provide
confidentiality.

Publication is an owner-authorized write. This repository intentionally contains
no CLI command that publishes to a live Qortium node.

## The APP package must have index.html at its archive root

Qortium Core renders an APP as a website only when the *published file tree* has
an index file at its root. `Service.APP` does not validate a ZIP's internal
layout, and a single-file publish is stored opaquely. The renderer
(`ArbitraryDataRenderer`) looks for `index.html` in the resource root; there is
no recursive search.

Three publication shapes are easy to confuse:

| Source sent to Core | `isZip` / unpack | `metadata.files` | Render root |
| --- | --- | --- | --- |
| ZIP containing `index.html`, `assets/…` at its **root** | `true` | `index.html`, `assets/…` | `200` |
| ZIP containing a top-level `dist/` wrapper | `true` | `dist/index.html`, `dist/assets/…` | `404` (no root index) |
| ZIP published as one opaque file | `false`/omitted | `["<name>.zip"]` | `404` |

`npm run qdn:prepare` now produces `release/myfileoffice-app.zip`: a
deterministic archive of the **contents** of `dist/`, with `index.html`,
`assets/…` and `favicon.svg` at the archive root. Publish that archive (or the
`dist/` folder itself). Do not zip `dist/` from its parent directory, and do not
publish an opaque ZIP that Core cannot unpack.

Core 1.8+ also supports an optional metadata `entryPoint` (for example
`dist/index.html`) for multi-file resources and SPA route fallback. It does not
repair an opaque archive, and the release gate still requires a root
`index.html`, so do not depend on it for this app.

### Observed live failures

- 2026-11-01: `APP/My File Office/myfileoffice` was `READY` with
  `metadata.files = ["myfileoffice.zip"]`, render root `404`, while
  `/render/APP/My%20File%20Office/myfileoffice/myfileoffice.zip` returned `200`.
  The ZIP's `index.html` and asset hashes matched `dist/`; the publish shape was
  the defect.
- 2026-11-02: the resource was republished as `dist-katalog.zip` (3 068 400
  bytes). The archive contained the corrected build under a top-level `dist/`
  plus `dist/katalogi-sisu.zip`, but `metadata.files` was still
  `["dist-katalog.zip"]` and the render root still returned `404`. A correct
  build inside an opaque ZIP changes nothing.

`npm run verify:live` fails on both shapes and, when
`release/myfileoffice-app.zip` exists, compares its entry list with the live
`metadata.files` list.

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

3. Inspect `dist/publish-manifest.json`. It records `publishAs: "app-zip"`,
   `packageRoot: "contents of dist/"`, `entryPoint: "index.html"`, every file,
   byte size and SHA-256 digest, and the `release/myfileoffice-app.zip` size and
   digest. No network request is made.
4. Confirm the manifest and archive contain `index.html`, all `assets/*.js`,
   all `assets/*.css`, `favicon.svg`, the background images, the lazy PDF
   renderer chunk and the pdf.js worker at the package root.
5. Record the source commit and package digest in the handoff.
6. `npm run verify:live` must report `verdict: PASS`, a `publishedShape.status`
   of `directory`, a `200` render root, matching served asset names, matching
   asset SHA-256 values, and an empty `packageComparison.missingFromLive` list.
   `READY` alone is not sufficient.

## Publication (owner only, explicit authorization)

Use Qortium Home 2.1.0-beta.14 or newer:

1. Select the publishing account with a registered name.
2. Publish **APP** → source → `release/myfileoffice-app.zip` (preferred), or
   select the project's `dist/` **folder** itself.
3. Use the owner-approved name/identifier (current live:
   `My File Office` / `myfileoffice`).
4. Description must stay accurate, for example:
   “My File Office is a QDN file library for Qortium Home. Published resources
   are public. Publish, browse, preview, describe and share files.”
5. Category/tags must be valid Core values; do not add an app-supplied fee.
6. Wait for Home's approval prompt once per publish request. Folder/APP
   publication is one request.

Home sets `isZip=true` for APP/WEBSITE ZIP sources (a `.zip` filename or ZIP
magic bytes) and Core unpacks the archive. Selecting `dist/` from its parent
folder produces a `dist/` wrapper inside the archive; selecting the `dist/`
folder itself, or the prepared package above, does not. Do not use inline
`data64` request bodies that bypass the ZIP/unpack path, and do not publish a
ZIP whose root is `dist/`.

## Post-publication validation

1. `npm run verify:live` must report the APP resource `READY`.
2. Fetch `/render/APP/<name>/<identifier>/` and confirm it returns HTTP 200 HTML
   whose asset names match `dist/index.html`.
3. Compare each served asset's SHA-256 with `dist/publish-manifest.json` and
   confirm `packageComparison.matches` is true.
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
