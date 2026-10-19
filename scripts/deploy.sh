#!/usr/bin/env bash
# Teknodoz Stream Studio: pull -> install -> build -> (re)start with PM2 -> health check -> rollback.
# CloudPanel (Nginx + Node) usage, from the site's SSH user:
#   cd ~/htdocs/<site> && bash scripts/deploy.sh
# Options (environment variables):
#   BRANCH=main        branch to deploy
#   PORT=3011          must equal the "App Port" in CloudPanel -> Site -> Settings
#   PM2_NAME=studio    PM2 process name
#   HEALTH_PATH=/studio
set -euo pipefail

BRANCH="${BRANCH:-main}"
PORT="${PORT:-3011}"
PM2_NAME="${PM2_NAME:-studio}"
HEALTH_PATH="${HEALTH_PATH:-/studio}"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

command -v git >/dev/null || die "git not found"
command -v bun >/dev/null || die "bun not found (npm install -g bun)"
command -v pm2 >/dev/null || die "pm2 not found (npm install -g pm2)"
[ -f package.json ] || die "run this from the project root (package.json not found)"

say "Fetching $BRANCH"
git checkout -- bun.lock 2>/dev/null || true   # bun may rewrite the lockfile; it is generated
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
say "Now at $(git rev-parse --short HEAD): $(git log -1 --pretty=%s)"

say "Installing dependencies"
bun install --frozen-lockfile || bun install

say "Building (node-server preset)"
rm -rf .output.prev
[ -d .output ] && cp -a .output .output.prev
NITRO_PRESET=node-server bun run build
[ -f .output/server/index.mjs ] || die "build did not produce .output/server/index.mjs"

start_app() {
  if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
    PORT="$PORT" pm2 restart "$PM2_NAME" --update-env >/dev/null
  else
    PORT="$PORT" pm2 start .output/server/index.mjs --name "$PM2_NAME" >/dev/null
  fi
}

healthy() {
  for _ in $(seq 1 20); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}${HEALTH_PATH}" || true)"
    [ "$code" = "200" ] && return 0
    sleep 1
  done
  return 1
}

say "Starting $PM2_NAME on port $PORT"
start_app
if healthy; then
  pm2 save >/dev/null
  rm -rf .output.prev
  say "OK: http://127.0.0.1:${PORT}${HEALTH_PATH} -> 200"
  pm2 status "$PM2_NAME"
  exit 0
fi

printf '\033[1;31mHealth check failed.\033[0m Last logs:\n'
pm2 logs "$PM2_NAME" --lines 30 --nostream || true
if [ -d .output.prev ]; then
  say "Rolling back to the previous build"
  rm -rf .output && mv .output.prev .output
  start_app
  healthy && say "Rollback is serving again" || printf 'Rollback also failed; check pm2 logs %s\n' "$PM2_NAME"
fi
exit 1
