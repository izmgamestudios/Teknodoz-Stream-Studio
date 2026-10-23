#!/usr/bin/env bash
# Installs rclone into ~/bin (no root) and prints the one-time Google Drive setup steps.
#   bash scripts/rclone-setup.sh
set -euo pipefail
say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
for c in curl unzip; do command -v "$c" >/dev/null || die "$c not found"; done
case "$(uname -m)" in
  x86_64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) die "unsupported CPU: $(uname -m)" ;;
esac
mkdir -p "$HOME/bin"
if ! command -v rclone >/dev/null 2>&1 && [ ! -x "$HOME/bin/rclone" ]; then
  say "Downloading rclone"
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  curl -fsSL -o "$TMP/rclone.zip" "https://downloads.rclone.org/rclone-current-linux-$ARCH.zip"
  unzip -oq "$TMP/rclone.zip" -d "$TMP"
  cp "$TMP"/rclone-*/rclone "$HOME/bin/rclone"
  chmod 755 "$HOME/bin/rclone"
fi
export PATH="$HOME/bin:$PATH"
rclone version | head -1
cat <<'TXT'

Google Drive setup (once). The server has no browser, so authorise on your own computer:

  1. On your computer (rclone installed: https://rclone.org/downloads/) run:
         rclone authorize "drive" "" "" --drive-scope drive.file
     A browser opens; sign in with the Google account that should hold the backups.
     Copy the JSON token it prints ({"access_token": ...}).

  2. On the server run:  rclone config
         n) New remote   name> gdrive   Storage> drive
         client_id / client_secret: leave empty (better: your own, see rclone docs)
         scope> 3 (drive.file: rclone only sees files it created)
         Use auto config?> n
         "config_token>" paste the JSON from step 1
         Configure as Shared Drive?> n

  3. Test:   rclone mkdir gdrive:teknodoz-backups && rclone lsd gdrive:
  4. Add ~/bin to PATH for cron (crontab line):   PATH=/home/<user>/bin:/usr/local/bin:/usr/bin:/bin
  5. First backup + restore drill:
         cd ~/htdocs/<site> && bash scripts/backup.sh
         bash scripts/restore.sh                              # list
         bash scripts/restore.sh teknodoz-YYYYMMDD-HHMMSS.tar.gz --drill
TXT
