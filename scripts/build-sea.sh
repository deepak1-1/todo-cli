#!/usr/bin/env bash
# Build a standalone `todo` binary via Node SEA and package it as todo-v<ver>-<os>-<arch>.tar.gz
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
NODE_BIN=$(command -v node)
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
    x86_64) ARCH=x64 ;;
    aarch64) ARCH=arm64 ;;
esac

OUT_DIR="sea-out"
rm -rf "$OUT_DIR" sea-prep.blob
mkdir -p "$OUT_DIR"

echo "==> Generating SEA blob (dist-sea/index.cjs must exist — run npm run build:sea first)"
[ -f dist-sea/index.cjs ] || { echo "dist-sea/index.cjs missing; run: npm run build:sea" >&2; exit 1; }
node --experimental-sea-config sea-config.json

echo "==> Copying node binary"
cp "$NODE_BIN" "$OUT_DIR/todo"
chmod +w "$OUT_DIR/todo"

if [ "$OS" = "darwin" ]; then
    codesign --remove-signature "$OUT_DIR/todo"
fi

echo "==> Injecting blob"
npx --yes postject "$OUT_DIR/todo" NODE_SEA_BLOB sea-prep.blob \
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
    $( [ "$OS" = "darwin" ] && echo "--macho-segment-name NODE_SEA" )

if [ "$OS" = "darwin" ]; then
    codesign --sign - "$OUT_DIR/todo"
fi

echo "==> Adding sidecar addon + license"
# v13 ships N-API prebuilds inside the package (glibc runners, so plain linux-*)
cp "node_modules/better-sqlite3/prebuilds/${OS}-${ARCH}.node" "$OUT_DIR/better_sqlite3.node"
cp LICENSE "$OUT_DIR/" 2>/dev/null || true

TARBALL="todo-v${VERSION}-${OS}-${ARCH}.tar.gz"
tar -czf "$TARBALL" -C "$OUT_DIR" .
echo "==> Built $TARBALL"
