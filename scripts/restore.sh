#!/usr/bin/env bash
set -euo pipefail

# Restore script: lists available backups and restores the selected one

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_BASE="/home/iffiolen/VS-Code-Projects/_workspace_backups/QORTIUM"
PACKAGE_JSON="$PROJECT_DIR/package.json"

NAME=$(grep -m1 '"name"' "$PACKAGE_JSON" 2>/dev/null | sed -E 's/.*"name": *"([^"]+)".*/\1/' || true)
if [ -z "$NAME" ]; then NAME=$(basename "$PROJECT_DIR"); fi

DIR="$BACKUP_BASE/$NAME"
if [ ! -d "$DIR" ]; then
  echo "No backups found in $DIR"
  exit 1
fi

mapfile -t files < <(ls -1t "$DIR"/*.tar.gz 2>/dev/null)
if [ ${#files[@]} -eq 0 ]; then
  echo "No backups found in $DIR"
  exit 1
fi

echo "Available backups for $NAME:"
for i in "${!files[@]}"; do
  echo "[$i] $(basename "${files[$i]}")"
done

read -p "Enter number to restore: " idx
if ! [[ "$idx" =~ ^[0-9]+$ ]] || [ "$idx" -lt 0 ] || [ "$idx" -ge "${#files[@]}" ]; then
  echo "Invalid selection"
  exit 1
fi

sel="${files[$idx]}"
echo "You selected: $(basename "$sel")"
read -p "This will overwrite files in $PROJECT_DIR. Continue? [y/N] " confirm
if [[ ! "$confirm" =~ ^[Yy] ]]; then
  echo "Aborted"
  exit 0
fi

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo "Extracting backup to temporary location..."
tar -xzf "$sel" -C "$TMPDIR"

echo "Applying backup to project directory (rsync)..."
rsync -a --delete "$TMPDIR"/ "$PROJECT_DIR"/

echo "Restore complete."
