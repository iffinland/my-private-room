#!/usr/bin/env bash
set -euo pipefail

# Backup script: creates a timestamped tar.gz of the project
# Keeps only the 2 most recent backups for this project

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE_JSON="$PROJECT_DIR/package.json"

# Try to read project name from package.json, fallback to directory name
NAME=$(grep -m1 '"name"' "$PACKAGE_JSON" 2>/dev/null | sed -E 's/.*"name": *"([^"]+)".*/\1/' || true)
if [ -z "$NAME" ]; then NAME=$(basename "$PROJECT_DIR"); fi

BACKUP_BASE="/home/iffiolen/VS-Code-Projects/_workspace_backups/QORTIUM"
DEST_DIR="$BACKUP_BASE/$NAME"
mkdir -p "$DEST_DIR"

TS=$(date +"%Y-%m-%dT%H-%M-%S")
FILENAME="${NAME}_${TS}.tar.gz"

echo "Creating backup: $FILENAME"

# Create archive of project contents, excluding node_modules and .git
tar -C "$PROJECT_DIR" \
    --exclude='./node_modules' \
    --exclude='./.git' \
    --exclude='./dist' \
    -czf "$DEST_DIR/$FILENAME" .

echo "Backup saved to: $DEST_DIR/$FILENAME"

# Rotate: keep only 2 most recent backups
cd "$DEST_DIR"
shopt -s nullglob
files=( *.tar.gz )
if [ "${#files[@]}" -gt 2 ]; then
  # list sorted by newest first, remove older than 2
  todelete=$(ls -1t *.tar.gz | tail -n +3)
  if [ -n "$todelete" ]; then
    echo "Removing old backups:"
    echo "$todelete"
    echo "$todelete" | xargs -r rm --
  fi
fi

echo "Done. Kept latest 2 backups in $DEST_DIR"
