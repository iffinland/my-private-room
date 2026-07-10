# Backup & Restore scripts

This directory contains simple backup and restore scripts for the project.

- `backup.sh` — creates a timestamped tar.gz backup of the project and keeps the 2 most recent backups.
- `restore.sh` — shows a list of available backups and restores the selected one (interactive).

Backup location
- Backups are stored under `/home/iffiolen/VS-Code-Projects/_workspace_backups/QORTIUM/<project-name>/`
- Backup files are named `<project-name>_YYYY-MM-DDTHH-MM-SS.tar.gz`.

Usage
- From the project root you can run via npm:

```bash
npm run backup
npm run restore
```

Notes
- The scripts exclude `node_modules`, `.git` and `dist` contents from the archive.
- `restore.sh` extracts to a temporary directory and then uses `rsync --delete` to apply the backup.
- Ensure you have `tar`, `rsync`, and `bash` available (Linux systems typically do).
