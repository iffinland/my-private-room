# My File Office

My File Office is an early Qortium file-reference dApp in the repository
directory `my-private-room`. It can publish public QDN `FILE` resources and
store JSON references to existing QDN resources.

## Privacy notice

QDN resources used by the current implementation are public. The access gate
and private-looking interface do not encrypt files or make them confidential.
Do not use this application for sensitive material or describe it as private
storage until a reviewed encryption and key-management design exists.

## Current data model

- file resources: `FILE/<name>/mpr_<id>`;
- reference resources: `JSON/<name>/mpr_ref_<id>`;
- reference schema: `qortium.mpr.qdn-ref.v1`;
- references preserve the original QDN resource instead of republishing it.

## Development

```bash
npm ci
npm run dev
npm run build
npm run lint
```

`npm run qdn:publish` is a live write, not a build or validation command. It must
not be run without explicit authorization for the exact artifact, environment,
publisher name, and identifier.

## Documentation and agent routing

- [`AGENTS.md`](AGENTS.md) — project entry point for AI-assisted work.
- [`docs/RELEASE.md`](docs/RELEASE.md) — release/deployment and privacy gates.
- [`scripts/README.md`](scripts/README.md) — backup/restore helper notes.
- Canonical project context:
  `/home/iffi/VsCodec-Projects/Qortium/qortium-dev-workspace/projects/my-private-room.md`

AI work reports belong under
`/home/iffi/VsCodec-Projects/Qortium/docs/my-private-room/`.
