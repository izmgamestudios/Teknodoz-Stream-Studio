#!/usr/bin/env bash
# Installs open-source Whisper speech recognition for automatic subtitles and writes WHISPER_*
# into ./.env.production (then run scripts/deploy.sh).
#   cd ~/htdocs/<site> && bash scripts/whisper-setup.sh            # whisper.cpp (default)
#   cd ~/htdocs/<site> && bash scripts/whisper-setup.sh ctranslate2 # faster-whisper via pip
# Options (environment variables):
#   WHISPER_DIR=$HOME/whisper.cpp        where whisper.cpp is cloned and built
#   WHISPER_VENV=$HOME/whisper-venv      python venv for the ctranslate2 mode
#   WHISPER_MODEL_NAME=small             tiny | base | small | medium (bigger = slower, more accurate)
#   WHISPER_THREADS=<cores>
# whisper.cpp needs: git, cmake, a C++ compiler (g++/make). ctranslate2 needs: python3 (venv, pip).
set -euo pipefail

MODE="${1:-cpp}"
MODEL_NAME="${WHISPER_MODEL_NAME:-small}"
THREADS="${WHISPER_THREADS:-$(nproc 2>/dev/null || echo 2)}"
ENV_FILE="$(pwd)/.env.production"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 not found: $2"; }

[ -f package.json ] || die "run this from the project root (package.json not found)"
need ffmpeg "install ffmpeg first (subtitles need it to extract the audio)"

set_env() {
  touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
  grep -vE "^$1=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"; chmod 600 "$ENV_FILE"
}

case "$MODE" in
  cpp)
    need git "sudo apt install git"
    need cmake "sudo apt install cmake (ask the server admin)"
    command -v g++ >/dev/null 2>&1 || command -v c++ >/dev/null 2>&1 || die "no C++ compiler (sudo apt install build-essential), or use: bash scripts/whisper-setup.sh ctranslate2"
    WHISPER_DIR="${WHISPER_DIR:-$HOME/whisper.cpp}"
    if [ -d "$WHISPER_DIR/.git" ]; then
      say "Updating whisper.cpp"
      git -C "$WHISPER_DIR" pull --ff-only
    else
      say "Cloning whisper.cpp"
      git clone --depth 1 https://github.com/ggml-org/whisper.cpp "$WHISPER_DIR"
    fi
    say "Building (this takes a few minutes)"
    cmake -S "$WHISPER_DIR" -B "$WHISPER_DIR/build" -DCMAKE_BUILD_TYPE=Release >/dev/null
    cmake --build "$WHISPER_DIR/build" -j "$THREADS" --config Release
    BIN="$WHISPER_DIR/build/bin/whisper-cli"
    [ -x "$BIN" ] || die "build finished but $BIN is missing"
    say "Downloading model: $MODEL_NAME"
    (cd "$WHISPER_DIR" && sh ./models/download-ggml-model.sh "$MODEL_NAME")
    MODEL="$WHISPER_DIR/models/ggml-$MODEL_NAME.bin"
    [ -f "$MODEL" ] || die "model file $MODEL is missing"
    "$BIN" --help >/dev/null 2>&1 || die "$BIN does not run"
    set_env WHISPER_BACKEND whisper-cpp
    set_env WHISPER_BIN "$BIN"
    set_env WHISPER_MODEL "$MODEL"
    ;;
  ctranslate2)
    need python3 "install python3 + python3-venv"
    VENV="${WHISPER_VENV:-$HOME/whisper-venv}"
    say "Creating the virtual environment in $VENV"
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install --upgrade pip >/dev/null
    say "Installing whisper-ctranslate2 (faster-whisper)"
    "$VENV/bin/pip" install whisper-ctranslate2
    say "Downloading model: $MODEL_NAME"
    "$VENV/bin/python" -c "from faster_whisper import WhisperModel; WhisperModel('$MODEL_NAME', device='cpu', compute_type='int8')"
    BIN="$VENV/bin/whisper-ctranslate2"
    [ -x "$BIN" ] || die "$BIN is missing"
    set_env WHISPER_BACKEND whisper-ctranslate2
    set_env WHISPER_BIN "$BIN"
    set_env WHISPER_MODEL "$MODEL_NAME"
    ;;
  *) die "unknown mode '$MODE' (use: cpp | ctranslate2)" ;;
esac

set_env WHISPER_THREADS "$THREADS"
say "Whisper is ready. Now restart the site so it picks the settings up:"
echo "  PORT=3011 bash scripts/deploy.sh"
echo "Then open /library -> pick a video -> Subtitles -> Generate."
