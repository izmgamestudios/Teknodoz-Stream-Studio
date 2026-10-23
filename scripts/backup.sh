#!/usr/bin/env bash
# Nightly backup: consistent PocketBase snapshot + site JSON data -> one .tar.gz -> Google Drive
# (rclone) with 14-day retention. Secrets (.env.production) are NOT included.
#   bash scripts/backup.sh                      run once
#   crontab: 17 3 * * * cd ~/htdocs/<site> && bash scripts/backup.sh >> ~/backup.log 2>&1
# Options (environment variables):
#   PB_DIR=$HOME/pocketbase          PocketBase folder (pb_data inside)
#   DATA_DIR=./data                  site JSON files (catalog.json, content*.json, ...)
#   MEDIA_DIR=./data/media           uploaded media (synced, not archived) when BACKUP_MEDIA=1
#   BACKUP_REMOTE=gdrive:teknodoz-backups   rclone remote:path (a local folder path also works)
#   KEEP_DAYS=14                     delete archives older than this
#   BACKUP_MEDIA=0                   1 = also mirror MEDIA_DIR to $BACKUP_REMOTE/media
set -euo pipefail

PB_DIR="${PB_DIR:-$HOME/pocketbase}"
DATA_DIR="${DATA_DIR:-$(pwd)/data}"
MEDIA_DIR="${MEDIA_DIR:-$DATA_DIR/media}"
BACKUP_REMOTE="${BACKUP_REMOTE:-gdrive:teknodoz-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
BACKUP_MEDIA="${BACKUP_MEDIA:-0}"
STAMP="$(date +%Y%m%d-%H%M%S)"

say() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { printf '[%s] ERROR: %s\n' "$(date '+%F %T')" "$*" >&2; exit 1; }
is_local() { case "$BACKUP_REMOTE" in /*|./*|../*) return 0 ;; *) return 1 ;; esac; }

command -v sqlite3 >/dev/null || die "sqlite3 not found"
is_local || command -v rclone >/dev/null || die "rclone not found (bash scripts/rclone-setup.sh)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/snap/data"

if [ -f "$PB_DIR/pb_data/data.db" ]; then
  say "Snapshotting PocketBase (online, consistent)"
  sqlite3 "$PB_DIR/pb_data/data.db" ".backup '$WORK/snap/data.db'"
  [ "$(sqlite3 "$WORK/snap/data.db" 'PRAGMA integrity_check;')" = "ok" ] || die "snapshot failed the integrity check"
else
  say "No PocketBase data found at $PB_DIR/pb_data (skipping)"
fi

if [ -d "$DATA_DIR" ]; then
  say "Copying site data files"
  find "$DATA_DIR" -maxdepth 1 -type f \( -name '*.json' -o -name '*.jsonl' \) -exec cp {} "$WORK/snap/data/" \;
fi

ARCHIVE="teknodoz-$STAMP.tar.gz"
tar -C "$WORK/snap" -czf "$WORK/$ARCHIVE" .
( cd "$WORK" && sha256sum "$ARCHIVE" > "$ARCHIVE.sha256" )
say "Archive $ARCHIVE ($(du -h "$WORK/$ARCHIVE" | cut -f1))"

if is_local; then
  mkdir -p "$BACKUP_REMOTE/db"
  cp "$WORK/$ARCHIVE" "$WORK/$ARCHIVE.sha256" "$BACKUP_REMOTE/db/"
  find "$BACKUP_REMOTE/db" -type f -mtime +"$KEEP_DAYS" -delete
else
  rclone copy "$WORK/$ARCHIVE" "$BACKUP_REMOTE/db" --quiet
  rclone copy "$WORK/$ARCHIVE.sha256" "$BACKUP_REMOTE/db" --quiet
  rclone delete "$BACKUP_REMOTE/db" --min-age "${KEEP_DAYS}d" --quiet
  if [ "$BACKUP_MEDIA" = "1" ] && [ -d "$MEDIA_DIR" ]; then
    say "Mirroring media"
    rclone sync "$MEDIA_DIR" "$BACKUP_REMOTE/media" --quiet --transfers 4
  fi
fi
say "Backup done: $BACKUP_REMOTE/db/$ARCHIVE"
