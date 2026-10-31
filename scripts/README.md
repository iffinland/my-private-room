# Helper scripts

## Publication preflight

```bash
npm run qdn:prepare
```

Verifies `dist/` and writes `dist/publish-manifest.json` with every release file
and its SHA-256 digest. It performs **no network request** and does not publish.
Publication remains an explicitly authorized owner action in Qortium Home; see
[`docs/RELEASE.md`](../docs/RELEASE.md).

The previous `scripts/publish.mjs` posted only `dist/index.html` with inline
base64 to the Core API and used an inaccurate description. That path could not
produce a working APP resource and has been removed.

## Read-only live check

```bash
npm run verify:live
```

GETs `/admin/status`, `/admin/info`, and the deployed APP resource/metadata. It
never publishes, deletes, signs or transacts. Override with:

```bash
QORTIUM_API_URL=http://127.0.0.1:24891 \
QDN_APP_NAME="My File Office" \
QDN_APP_IDENTIFIER=myfileoffice \
npm run verify:live
```

## Backup & restore scripts

`backup.sh` creates a timestamped tar.gz of the project and keeps the 2 most
recent backups. `restore.sh` lists backups and restores the selected one
interactively.

Backups are stored under
`/home/iffiolen/VS-Code-Projects/_workspace_backups/QORTIUM/<project-name>/`.
The scripts exclude `node_modules`, `.git` and `dist` contents.

```bash
npm run backup
npm run restore
```

Requirements: `tar`, `rsync`, `bash`.
