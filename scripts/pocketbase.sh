#!/usr/bin/env bash
# Installs / updates PocketBase next to the site and runs it with PM2, bound to 127.0.0.1 only.
# Creates the superuser and writes POCKETBASE_* into ./.env.production for scripts/deploy.sh.
#   cd ~/htdocs/<site> && bash scripts/pocketbase.sh
# Options (environment variables):
#   PB_DIR=$HOME/pocketbase   where the binary and pb_data live
#   PB_PORT=8090              local port (never expose it publicly)
#   PB_NAME=pocketbase        PM2 process name
#   PB_VERSION=               e.g. 0.30.0 (default: latest release)
#   PB_ADMIN_EMAIL=info.teknodoz@gmail.com
#   PB_ADMIN_PASSWORD=        (default: generated once and stored in .env.production)
set -euo pipefail

PB_DIR="${PB_DIR:-$HOME/pocketbase}"
PB_PORT="${PB_PORT:-8090}"
PB_NAME="${PB_NAME:-pocketbase}"
PB_ADMIN_EMAIL="${PB_ADMIN_EMAIL:-info.teknodoz@gmail.com}"
ENV_FILE="$(pwd)/.env.production"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

for c in curl unzip pm2 openssl; do command -v "$c" >/dev/null || die "$c not found"; done
[ -f package.json ] || die "run this from the project root (package.json not found)"

case "$(uname -m)" in
  x86_64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) die "unsupported CPU: $(uname -m)" ;;
esac

PB_VERSION="${PB_VERSION:-}"
if [ -z "$PB_VERSION" ]; then
  PB_VERSION="$(curl -fsSL https://api.github.com/repos/pocketbase/pocketbase/releases/latest \
    | grep -m1 '"tag_name"' | sed -E 's/.*"v?([0-9][^"]*)".*/\1/')"
fi
[ -n "$PB_VERSION" ] || die "could not resolve the PocketBase version (set PB_VERSION)"

mkdir -p "$PB_DIR"
if [ ! -x "$PB_DIR/pocketbase" ] || [ "$("$PB_DIR/pocketbase" --version 2>/dev/null | awk '{print $NF}')" != "$PB_VERSION" ]; then
  say "Downloading PocketBase $PB_VERSION ($ARCH)"
  TMP="$(mktemp -d)"
  curl -fsSL -o "$TMP/pb.zip" \
    "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${ARCH}.zip"
  unzip -oq "$TMP/pb.zip" pocketbase -d "$PB_DIR"
  rm -rf "$TMP"
  chmod 755 "$PB_DIR/pocketbase"
fi
"$PB_DIR/pocketbase" --version

# Keep an existing password so re-running this script never locks the app out.
env_get() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }
PB_ADMIN_PASSWORD="${PB_ADMIN_PASSWORD:-$(env_get POCKETBASE_ADMIN_PASSWORD)}"
[ -n "$PB_ADMIN_PASSWORD" ] || PB_ADMIN_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=\n')"

say "Superuser $PB_ADMIN_EMAIL"
"$PB_DIR/pocketbase" superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" --dir "$PB_DIR/pb_data"

say "Starting under PM2 ($PB_NAME on 127.0.0.1:$PB_PORT)"
pm2 delete "$PB_NAME" >/dev/null 2>&1 || true
pm2 start "$PB_DIR/pocketbase" --name "$PB_NAME" -- serve \
  --http="127.0.0.1:$PB_PORT" --dir "$PB_DIR/pb_data" >/dev/null
pm2 save >/dev/null

touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
set_env() {
  grep -vE "^$1=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}
set_env POCKETBASE_URL "http://127.0.0.1:$PB_PORT"
set_env POCKETBASE_ADMIN_EMAIL "$PB_ADMIN_EMAIL"
set_env POCKETBASE_ADMIN_PASSWORD "$PB_ADMIN_PASSWORD"

for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -fsS "http://127.0.0.1:$PB_PORT/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$PB_PORT/api/health" >/dev/null || die "PocketBase did not answer on port $PB_PORT (pm2 logs $PB_NAME)"

say "PocketBase is up. Now deploy the site so it picks up the new settings:"
echo "  PORT=3011 bash scripts/deploy.sh"
echo "Admin UI (private): ssh -L $PB_PORT:127.0.0.1:$PB_PORT <user>@<server>  ->  http://127.0.0.1:$PB_PORT/_/"
