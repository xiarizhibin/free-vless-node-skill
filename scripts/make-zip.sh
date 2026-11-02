#!/usr/bin/env bash
# zip the deployable project (server.js + package.json at archive root)
# usage: bash make-zip.sh ./project relay.zip
set -euo pipefail
DIR="${1:-./project}"
OUT="${2:-./relay.zip}"
[ -d "$DIR" ] || { echo "dir not found: $DIR" >&2; exit 1; }
rm -f "$OUT"
cd "$DIR"
zip -q -X "$OUT" server.js package.json $( [ -f package-lock.json ] && echo package-lock.json )
cd - >/dev/null
mv "$DIR/$(basename "$OUT")" "$OUT" 2>/dev/null || true
unzip -l "$OUT"
