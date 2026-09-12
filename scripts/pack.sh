#!/bin/sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist"
NAME="CineMode"
IINA_PLUGIN="${IINA_PLUGIN:-/Applications/IINA.app/Contents/MacOS/iina-plugin}"

mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

STAGE="$TMP/${NAME}.iinaplugin"
mkdir -p "$STAGE"

rsync -a \
  --exclude ".git/" \
  --exclude "dist/" \
  --exclude "scripts/" \
  --exclude ".github/" \
  --exclude "*.iinaplgz" \
  --exclude ".DS_Store" \
  --exclude ".gitignore" \
  "$ROOT/" "$STAGE/"

if [ ! -f "$STAGE/Info.json" ]; then
  echo "missing Info.json in staged plugin" >&2
  exit 1
fi

if [ -x "$IINA_PLUGIN" ]; then
  (
    cd "$TMP"
    "$IINA_PLUGIN" pack "${NAME}.iinaplugin"
    mv -f "${NAME}.iinaplgz" "$OUT/${NAME}.iinaplgz" 2>/dev/null \
      || mv -f "${NAME}.iinaplugin.iinaplgz" "$OUT/${NAME}.iinaplgz" 2>/dev/null \
      || find . -name "*.iinaplgz" -exec mv -f {} "$OUT/${NAME}.iinaplgz" \;
  )
else
  (
    cd "$TMP"
    zip -r "$OUT/${NAME}.iinaplgz" "${NAME}.iinaplugin" >/dev/null
  )
fi

echo "Packed $OUT/${NAME}.iinaplgz"
ls -lh "$OUT/${NAME}.iinaplgz"
