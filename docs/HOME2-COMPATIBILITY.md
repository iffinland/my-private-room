# Qortium Home 2+ compatibility

## Verified target

| Component | Checked value |
| --- | --- |
| Qortium Home source tag | `v2.1.0-beta.14` (`a4b7ce1`) |
| Qortium Home `origin/main` at check time | `3e45c9a` (one commit after the tag, no newer tag) |
| Running Qortium Core on the development host | `qortium-1.8.1-51cfb30` |
| Qortium Core checkout used for source inspection | `1.8.2` (`f0b688d`) |
| Bridge | `window.qdnRequest` / `qdnRequest` |

The app does not read Home/Core versions at runtime. It feature-detects the
publishing actions and fails closed with a truthful message when the runtime is
old or unavailable.

## Bridge actions used

### Read

| Action | Purpose |
| --- | --- |
| `WHICH_UI` | Host detection. Home 2 returns a plain string (`QORTIUM_HOME_ELECTRON`); older builds returned `{ ui }`. Both are accepted. |
| `SHOW_ACTIONS` | Capability detection; Home 2 returns a string array. |
| `GET_SELECTED_ACCOUNT` | Address, primary `name`, unlock state. Home 2.1 returns `name`, not a `names` array. |
| `LIST_QDN_RESOURCES` | Complete publisher enumeration for `FILE` resources (`name`, `mode=ALL`, `includeMetadata`). |
| `GET_QDN_RESOURCE_PROPERTIES` | Real filename, MIME type and size. May trigger a node download, so it is cached per session. |
| `GET_QDN_RESOURCE_METADATA` | Title, description, tags, category and file list. |
| `GET_QDN_RESOURCE_URL` | `/render/...` URL for previews and thumbnails. |
| `GET_QDN_RESOURCE_STATUS` | Readiness (`READY`/`DOWNLOADED`) after publish. |
| `FETCH_QDN_RESOURCE` | Base64 bytes for text preview, download and the description JSON. |
| `DELETE_QDN_RESOURCE` | File plus derived description/thumbnail resources. |

### Write

```text
SHOW_ACTIONS
  -> require STAGE_QDN_PUBLISH_SOURCE and PUBLISH_QDN_RESOURCE
STAGE_QDN_PUBLISH_SOURCE { bytesBase64, fileName, mimeType? }  // no prompt
PUBLISH_MULTIPLE_QDN_RESOURCES { resources: [...] }             // one approval
PUBLISH_QDN_RESOURCE { ...resource, sourceToken }               // fallback
```

- Staging is prompt-free and grants nothing.
- A publish request carries **only** the source token and mutable metadata. The
  app rejects `base64`, `data64`, `bytes`, `filename`/`fileName`, `path`,
  `mimeType`, `source`, `uri`, `fee` and similar legacy fields before a request
  is made.
- Every batch item uses a distinct token. Batches are limited to 10 items and
  25 MiB of decoded bytes.
- Home's public publish contract limits (Qortium): name 40 bytes, identifier 64
  bytes, title 80 bytes, description 500 bytes, category 40 bytes, and five tags
  of 20 bytes each. The app further bounds the metadata description to 240 bytes
  because Core stores at most 240.
- A batch result is per item, not atomic. `outcome: 'unknown'` is surfaced and
  the app refuses to describe it as success. The UI tells the owner not to retry
  blindly.
- `THUMBNAIL` resources are bounded to 500 KiB by Core; the app's own bound is
  300 KiB.

## Backward compatibility

- Files published by older versions keep their `mpr_*` FILE identifiers and
  metadata. They list normally.
- Their old metadata description is shown in the description dialog as legacy
  plain text; missing descriptions produce an explicit “No description” state.
- Missing thumbnails fall back to a category icon. No new resource is published
  just to upgrade a legacy file.
- The app no longer publishes the old reference JSON scheme; existing resources
  remain untouched.

## Verification layers

This document records source-level compatibility. The app's tests use a fake
`qdnRequest` that implements the observed Home 2 request/response contract and
asserts token-only payloads, refusal of legacy fields, batch parsing and failure
handling. Real Home approval/read-back must be performed by the owner on a
machine with Home installed; the VPS has no Home runtime.
