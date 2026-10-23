#!/usr/bin/env bash
# Installs a static ffmpeg + ffprobe into your home directory (no root needed) and writes
# FFMPEG_PATH / FFPROBE_PATH into ./.env.production. Needed for the library editor, posters,
# automatic subtitles and file validation.
#   cd ~/htdocs/<site> && bash scripts/ffmpeg-setup.sh
# Options (environment variables):
#   FFMPEG_DIR=$HOME/ffmpeg   install folder
#   FFMPEG_URL=...            another static build (.tar.xz with bin/ffmpeg + bin/ffprobe)
set -euo pipefail

FFMPEG_DIR="${FFMPEG_DIR:-$HOME/ffmpeg}"
ENV_FILE="$(pwd)/.env.production"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ -f package.json ] || die "run this from the project root (package.json not found)"
for c in curl tar xz; do command -v "$c" >/dev/null 2>&1 || die "$c not found"; done

case "$(uname -m)" in
  x86_64) ARCH=linux64 ;;
  aarch64|arm64) ARCH=linuxarm64 ;;
  *) die "unsupported CPU: $(uname -m)" ;;
esac
# BtbN static builds (GPL: libx264 + libass included)
URL="${FFMPEG_URL:-https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-${ARCH}-gpl.tar.xz}"

mkdir -p "$FFMPEG_DIR"
if [ ! -x "$FFMPEG_DIR/ffmpeg" ] || [ ! -x "$FFMPEG_DIR/ffprobe" ]; then
  say "Downloading a static ffmpeg build (about 100 MB)"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  curl -fSL --retry 3 -o "$TMP/ffmpeg.tar.xz" "$URL"
  tar -xJf "$TMP/ffmpeg.tar.xz" -C "$TMP"
  SRC="$(find "$TMP" -type f -name ffmpeg -path '*/bin/*' | head -1)"
  [ -n "$SRC" ] || die "the archive has no bin/ffmpeg"
  BIN_DIR="$(dirname "$SRC")"
  cp "$BIN_DIR/ffmpeg" "$BIN_DIR/ffprobe" "$FFMPEG_DIR/"
  chmod 755 "$FFMPEG_DIR/ffmpeg" "$FFMPEG_DIR/ffprobe"
fi

"$FFMPEG_DIR/ffmpeg" -version | head -1
"$FFMPEG_DIR/ffprobe" -version | head -1
ENC="$("$FFMPEG_DIR/ffmpeg" -hide_banner -encoders 2>/dev/null)"
FLT="$("$FFMPEG_DIR/ffmpeg" -hide_banner -filters 2>/dev/null)"
for want in libx264; do
  printf '%s' "$ENC" | grep -q "$want" || die "this ffmpeg build lacks $want (set FFMPEG_URL to a GPL static build)"
done
printf '%s' "$FLT" | grep -qw subtitles && echo "subtitles filter: yes" || echo "subtitles filter: NO (burned-in captions unavailable)"
printf '%s' "$FLT" | grep -qw loudnorm && echo "loudnorm filter: yes" || echo "loudnorm filter: NO"

touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
set_env() {
  grep -vE "^$1=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"; chmod 600 "$ENV_FILE"
}
set_env FFMPEG_PATH "$FFMPEG_DIR/ffmpeg"
set_env FFPROBE_PATH "$FFMPEG_DIR/ffprobe"

say "ffmpeg is ready. Restart the site so it picks the paths up:"
echo "  PORT=3011 bash scripts/deploy.sh"
