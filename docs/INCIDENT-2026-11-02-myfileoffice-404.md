# Incident evidence: My File Office APP render 404

Date: 2026-11-02 (Europe/Helsinki)
Resource: `APP / My File Office / myfileoffice`
Node: `qortium-1.8.1-51cfb30` (preview testnet, API `http://127.0.0.1:24891`)
Source branch: `agent/my-file-office/home2-descriptions-thumbnails` at `acf3639`

## Live resource state (read-only)

`GET /arbitrary/resource/properties/APP/My%20File%20Office/myfileoffice`

```json
{"filename":"dist-katalog.zip","mimeType":"application/zip","size":3068400}
```

`GET /arbitrary/resource/status/APP/My%20File%20Office/myfileoffice?build=false`

```json
{"status":"READY","id":"READY","title":"Ready","description":"Ready","localChunkCount":7,"totalChunkCount":7,"percentLoaded":100.0}
```

`GET /arbitrary/metadata/APP/My%20File%20Office/myfileoffice`

```json
{"title":"My File Office","description":"My File Office is a QDN application for Qortium Home that gives you a simple, clean interface to publish, browse, preview, and share your personal files on the Qortium Data Network.","tags":["file","manager","explorer","organizer"],"files":["dist-katalog.zip"],"mimeType":"application/zip"}
```

Latest on-chain update:

```json
{"type":"ARBITRARY","timestamp":1793564682278,"fee":"0.00000000","signature":"pEUYqTsGGzNwYHPYaoWkNEErYH9GjC9ap9jDek74gjgX2ZGXPnZoK5S3ePcL5dJMJFDLovcasyUxynwXaGRgJo5","txGroupId":0,"nonce":1522,"blockHeight":189523,"approvalStatus":"NOT_REQUIRED","creatorAddress":"QWifxJWGbJZ6Yo6kiimFkBGcm4AxQefdUm","version":1,"senderPublicKey":"EU23f7WwEVzgV7vRCsb4SFhRSpxC9oN4meSrzncP9J8","service":1000,"size":3067957,"name":"My File Office","identifier":"myfileoffice","method":"PUT","secret":"<redacted>","compression":"ZIP","data":"2nShSrMiELTRGnN5n2C4u1o2cNmxAkQf4t9VTiUedkVX","dataType":"DATA_HASH","metadataHash":"5qdxDSyY57YmLLnLzUmD4tv4uMiHESzVZ6QGfjYt59LV","payments":[]}
```

## Reproduction

```text
GET /render/APP/My%20File%20Office/myfileoffice        -> 404 text/plain  "Error 404: File Not Found" (25 bytes)
GET /render/APP/My%20File%20Office/myfileoffice/       -> 404 text/plain  "Error 404: File Not Found" (25 bytes)
GET /render/APP/My%20File%20Office/myfileoffice/index.html -> 404
GET /arbitrary/APP/My%20File%20Office/myfileoffice     -> 200 application/zip (3 068 261 bytes)
GET /render/APP/.../dist-katalog.zip                   -> 200 application/zip
```

The published archive is opaque to the renderer. Its listing:

```text
dist/
dist/assets/01-mountains-BivU0q2r.jpg
dist/assets/02-ocean-D30xYZ0S.jpg
dist/assets/03-forest-fog-BORoPYW9.jpg
dist/assets/04-forest-light-DIubgFMu.jpg
dist/assets/05-nature-path-Bx5_iZ6n.jpg
dist/assets/06-lake-BCnWJ3_Z.jpg
dist/assets/index-B5Gyq3jI.css
dist/assets/index-C4iHl5CR.js
dist/assets/pdf.worker.min-yatZIOMy.mjs
dist/assets/thumbnailPdf-DArT6QlG.js
dist/favicon.svg
dist/index.html
dist/katalogi-sisu.zip (1 534 441 bytes)
```

## Root cause

`metadata.files = ["dist-katalog.zip"]` means Core stored one opaque file. The
archive was not unpacked (`isZip` not applied by the publishing client), and its
own root is a `dist/` wrapper. `ArbitraryDataRenderer` looks for an index file in
the resource root and finds none, so the render root returns 404. The built
`dist/index.html` and asset hashes inside the archive are correct; the defect is
the publication shape.

## Verified package fix

`npm run qdn:prepare` produced `release/myfileoffice-app.zip` (3 036 546 bytes,
sha256 `306fa133389df1dd2db7752b491aaa415b96a2fd53d7775c3fc0c3031ef9d0d9`) with
12 root-level entries: `index.html`, `favicon.svg` and `assets/…`.

Core's no-write preview endpoint was used to prove the package renders before any
publish:

```text
POST /arbitrary/preview/APP/upload?archive=true&filename=myfileoffice-app.zip -> 200 /render/hash/<hash>?secret=…
GET  /render/hash/<hash>/                       -> 200 text/html  1 088 bytes
GET  /render/hash/<hash>/assets/index-C4iHl5CR.js       -> 200 text/javascript 310 487
GET  /render/hash/<hash>/assets/index-B5Gyq3jI.css      -> 200 text/css         33 361
GET  /render/hash/<hash>/favicon.svg                    -> 200 image/svg+xml      338
GET  /render/hash/<hash>/assets/thumbnailPdf-DArT6QlG.js -> 200 text/javascript 365 125
GET  /render/hash/<hash>/assets/pdf.worker.min-yatZIOMy.mjs -> 200 text/javascript 1 375 838
```

## Remaining step

The publishing account is the name owner `QWifxJWGbJZ6Yo6kiimFkBGcm4AxQefdUm`.
Core accepts an APP publish only as an unsigned transaction; signing requires the
owner's private key (Home's vault or an explicit `/transactions/sign` request).
This host has no Home runtime and no owner signing key, so the live overwrite is
an owner-authorized Home action. Publish `release/myfileoffice-app.zip` (or
`dist/` itself) to the coordinates above, then run `npm run verify:live`.
