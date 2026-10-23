#!/usr/bin/env bash
# Restores a backup made by scripts/backup.sh.
#   bash scripts/restore.sh                       list archives on the remote
#   bash scripts/restore.sh <archive> --drill     SAFE: unpack to a temp folder, verify, print row counts
#   bash scripts/restore.sh <archive> --yes       REAL: stop PocketBase, replace data.db + site data, restart
# Options: PB_DIR, DATA_DIR, BACKUP_REMOTE, PB_NAME (same as backup.sh; PB_NAME defaults to pocketbase)
set -euo pipefail

PB_DIR="${PB_DIR:-$HOME/pocketbase}"
DATA_DIR="${DATA_DIR:-$(pwd)/data}"
BACKUP_REMOTE="${BACKUP_REMOTE:-gdrive:teknodoz-backups}"
PB_NAME="${PB_NAME:-pocketbase}"
ARCHIVE="${1:-}"
MODE="${2:-}"

say() { printf '\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
is_local() { case "$BACKUP_REMOTE" in /*|./*|../*) return 0 ;; *) return 1 ;; esac; }

command -v sqlite3 >/dev/null || die "sqlite3 not found"

if [ -z "$ARCHIVE" ]; then
  say "Archives on $BACKUP_REMOTE/db"
  if is_local; then ls -1 "$BACKUP_REMOTE/db" | grep '\.tar\.gz$' | sort; else rclone lsf "$BACKUP_REMOTE/db" | grep '\.tar\.gz$' | sort; fi
  exit 0
fi
[ "$MODE" = "--drill" ] || [ "$MODE" = "--yes" ] || die "second argument must be --drill (safe test) or --yes (real restore)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
if is_local; then
  cp "$BACKUP_REMOTE/db/$ARCHIVE" "$BACKUP_REMOTE/db/$ARCHIVE.sha256" "$WORK/"
else
  rclone copy "$BACKUP_REMOTE/db/$ARCHIVE" "$WORK" --quiet
  rclone copy "$BACKUP_REMOTE/db/$ARCHIVE.sha256" "$WORK" --quiet
fi
( cd "$WORK" && sha256sum -c "$ARCHIVE.sha256" >/dev/null ) || die "checksum mismatch: the archive is damaged"
mkdir -p "$WORK/out"
tar -C "$WORK/out" -xzf "$WORK/$ARCHIVE"

if [ -f "$WORK/out/data.db" ]; then
  [ "$(sqlite3 "$WORK/out/data.db" 'PRAGMA integrity_check;')" = "ok" ] || die "database in the archive is corrupt"
  say "Row counts in the backup"
  for t in catalog_items media_items i18n_messages content_items content_audit content_redirects; do
    n="$(sqlite3 "$WORK/out/data.db" "SELECT COUNT(*) FROM $t;" 2>/dev/null || echo '-')"
    printf '  %-20s %s\n' "$t" "$n"
  done
fi
say "Site data files: $(ls "$WORK/out/data" 2>/dev/null | tr '\n' ' ')"

if [ "$MODE" = "--drill" ]; then
  say "Drill OK: the archive is intact and readable. Nothing was changed."
  exit 0
fi

say "Restoring (PocketBase will be stopped for a few seconds)"
command -v pm2 >/dev/null && pm2 stop "$PB_NAME" >/dev/null 2>&1 || true
if [ -f "$WORK/out/data.db" ]; then
  mkdir -p "$PB_DIR/pb_data"
  [ -f "$PB_DIR/pb_data/data.db" ] && cp "$PB_DIR/pb_data/data.db" "$PB_DIR/pb_data/data.db.before-restore"
  rm -f "$PB_DIR/pb_data/data.db-wal" "$PB_DIR/pb_data/data.db-shm"
  cp "$WORK/out/data.db" "$PB_DIR/pb_data/data.db"
fi
if [ -d "$WORK/out/data" ]; then
  mkdir -p "$DATA_DIR"
  cp -f "$WORK/out/data/"* "$DATA_DIR/" 2>/dev/null || true
fi
command -v pm2 >/dev/null && pm2 start "$PB_NAME" >/dev/null 2>&1 || true
say "Restored. The previous database is kept as data.db.before-restore."
