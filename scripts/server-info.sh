#!/usr/bin/env bash
# Read-only server report: what is installed and running (docker, pm2, ports, disk, …).
# Changes nothing and never prints secret values (only the NAMES of variables in .env.production).
#   cd ~/htdocs/<site> && bash scripts/server-info.sh
set +e

h() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
ver() { have "$1" && printf '%-14s %s\n' "$1" "$("$@" 2>&1 | head -1)" || printf '%-14s (not installed)\n' "$1"; }

h "System"
echo "user: $(whoami)   host: $(hostname)   cpu: $(uname -m)   cores: $(nproc 2>/dev/null)"
grep -m1 PRETTY_NAME /etc/os-release 2>/dev/null
uptime -p 2>/dev/null
free -h 2>/dev/null | sed -n '1,2p'
df -h "$HOME" 2>/dev/null | sed -n '1,2p'

h "Tools"
ver git --version
ver node --version
ver npm --version
ver bun --version
ver pm2 --version
ver docker --version
ver docker-compose --version
have docker && docker compose version 2>&1 | head -1
ver curl --version
ver unzip -v
ver openssl version
ver nginx -v
ver sqlite3 --version

h "Docker"
if have docker; then
  if docker info >/dev/null 2>&1; then
    echo "-- running containers"
    docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
    echo "-- all containers"
    docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' | head -30
    echo "-- images"
    docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}' | head -20
  else
    echo "docker is installed but this user cannot use it (not in the docker group / daemon off)."
    id | tr ' ' '\n' | grep -i docker || echo "user is not in the docker group"
  fi
else
  echo "docker is not installed for this user."
fi

h "PM2"
if have pm2; then pm2 list 2>&1 | head -30; else echo "pm2 not installed"; fi

h "Listening ports (TCP)"
if have ss; then ss -tlnp 2>/dev/null | awk 'NR==1 || /LISTEN/' | head -40; else echo "ss not available"; fi

h "Site folder"
echo "pwd: $(pwd)"
[ -f package.json ] && echo "package.json: yes" || echo "package.json: NO (run this from the project root)"
if [ -d .git ]; then
  echo "branch: $(git rev-parse --abbrev-ref HEAD)   commit: $(git rev-parse --short HEAD) $(git log -1 --pretty=%s | cut -c1-60)"
  echo "local changes: $(git status --short | wc -l) file(s)"
fi
[ -d .output ] && echo ".output: built" || echo ".output: not built yet"
[ -f .env.production ] && { echo ".env.production variables:"; sed -E 's/=.*//' .env.production | grep -E '^[A-Za-z_]' | sed 's/^/  /'; } || echo ".env.production: missing"
ls -d data 2>/dev/null | sed 's/^/data dir: /'

h "PocketBase"
PBD="${PB_DIR:-$HOME/pocketbase}"
if [ -x "$PBD/pocketbase" ]; then
  echo "binary: $("$PBD/pocketbase" --version 2>&1 | head -1)  ($PBD)"
  du -sh "$PBD/pb_data" 2>/dev/null | sed 's/^/pb_data size: /'
else
  echo "not installed at $PBD"
fi
curl -fsS -m 3 http://127.0.0.1:8090/api/health 2>/dev/null && echo || echo "health: no answer on 127.0.0.1:8090"

h "Site health"
for p in /studio /watch /api/catalog /api/i18n; do
  printf '%-14s %s\n' "$p" "$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT:-3011}$p")"
done
echo
echo "Done. Nothing was changed."
