# My File Office

My File Office is an early Qortium file-library dApp in the repository
directory `my-private-room`. It publishes public QDN `FILE` resources plus an
optional rich description and thumbnail, then lists, previews and shares them
inside Qortium Home 2+.

## Privacy notice

QDN resources used by this implementation are **public**. The access gate and
private-looking interface do not encrypt files or make them confidential. Do not
use this application for sensitive material or describe it as private storage
until a reviewed encryption and key-management design exists.

## Current data model

Every published entry is a public QDN resource published under the selected
account's registered name.

| Resource | Service | Identifier | Purpose |
| --- | --- | --- | --- |
| File | `FILE` | `mpr_<id>` | Original bytes, original filename and MIME type |
| Description | `JSON` | `mpr_desc_<id>` | Allowlisted rich-text HTML plus plain-text excerpt |
| Thumbnail | `THUMBNAIL` | `mpr_thumb_<id>` | Bounded WebP/JPEG card preview (optional) |

- The file's mutable QDN metadata keeps `title`, a ≤240-byte plain-text
  description excerpt, a Core-valid category, and up to five tags. The first tag
  preserves this app's internal category (`document`, `image`, …).
- The derived coordinates are deterministic, so deleting a file also removes
  its description and thumbnail.
- Legacy files (no description or thumbnail resources) still list and preview
  normally. Their old plain-text metadata description is shown in the
  description dialog; otherwise a file-type icon is used.
- Nothing is encrypted and nothing is published to a server for thumbnail
  generation: previews are produced in the browser.

## Home 2 compatibility

Publishing uses the current `qdnRequest` source-token contract:

```text
SHOW_ACTIONS -> require STAGE_QDN_PUBLISH_SOURCE
STAGE_QDN_PUBLISH_SOURCE { bytesBase64, fileName, mimeType }
PUBLISH_MULTIPLE_QDN_RESOURCES / PUBLISH_QDN_RESOURCE { sourceToken, ...metadata }
```

Inline bytes, path fields, filename fields and app-provided fees are rejected
before they reach Home. See [`docs/HOME2-COMPATIBILITY.md`](docs/HOME2-COMPATIBILITY.md).

## Development

```bash
npm ci
npm run dev          # Vite on 127.0.0.1
npm run test         # Vitest regression suite
npm run lint         # ESLint flat config
npm run build        # TypeScript + production Vite build
npm run verify:live  # read-only node + deployed APP check
npm run qdn:prepare  # verify dist/ and write a publication manifest (no network)
```

`npm run verify:live` only performs GET requests. It verifies that the published
APP is a directory resource (`metadata.files` contains `index.html`), that the
render root serves HTML, and — when `dist/` exists — that the served JS/CSS
asset names and SHA-256 values match the local build. An opaque
`["<name>.zip"]` resource is reported as the exact cause of a render-root 404.
`npm run qdn:prepare` performs no network writes and does not publish.

Publication is a separate, explicitly authorized owner action through Qortium
Home's APP **folder** publishing flow. Publish the `dist/` directory, never a ZIP
of it: a ZIP uploaded as a file stays opaque and Core cannot render
`/render/APP/.../`. There is intentionally no CLI command that publishes to the
live network. See [`docs/RELEASE.md`](docs/RELEASE.md).

## Browser and format limits

Thumbnail formats, dimensions and fallback behavior are documented in
[`docs/THUMBNAILS.md`](docs/THUMBNAILS.md). Rich descriptions are sanitized both
when written and when read.

## Documentation and agent routing

- [`AGENTS.md`](AGENTS.md) — project entry point for AI-assisted work.
- [`docs/RELEASE.md`](docs/RELEASE.md) — release/deployment and privacy gates.
- [`docs/HOME2-COMPATIBILITY.md`](docs/HOME2-COMPATIBILITY.md) — bridge contract.
- [`docs/THUMBNAILS.md`](docs/THUMBNAILS.md) — preview generation and limits.
- [`scripts/README.md`](scripts/README.md) — helper script notes.

Substantial AI work reports belong under the canonical central tree:
`/home/iffi/dev-workspace/docs/my-private-room/`.
