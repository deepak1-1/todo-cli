#!/usr/bin/env bash
# todo-cli installer — downloads the standalone binary from GitHub Releases
# Usage: curl -fsSL https://raw.githubusercontent.com/deepak1-1/todo-cli/main/install.sh | bash
# Env: TODO_VERSION=vX.Y.Z pins a version; TODO_INSTALL_DIR overrides the install dir
set -euo pipefail

REPO="deepak1-1/todo-cli"
INSTALL_DIR="${TODO_INSTALL_DIR:-$HOME/.local/lib/todo-cli}"
BIN_DIR="$HOME/.local/bin"

uninstall() {
    rm -rf "$INSTALL_DIR"
    rm -f "$BIN_DIR/todo"
    echo "todo-cli uninstalled ($INSTALL_DIR and $BIN_DIR/todo removed)."
    exit 0
}
[ "${1:-}" = "--uninstall" ] && uninstall

OS=$(uname -s)
ARCH=$(uname -m)
case "$OS" in
    Darwin) OS=darwin ;;
    Linux) OS=linux ;;
    *)
        echo "Unsupported OS: $OS. On Windows, install via npm instead: npm install -g <package>" >&2
        exit 1
        ;;
esac
case "$ARCH" in
    x86_64) ARCH=x64 ;;
    arm64 | aarch64) ARCH=arm64 ;;
    *)
        echo "Unsupported architecture: $ARCH" >&2
        exit 1
        ;;
esac

VERSION="${TODO_VERSION:-}"
if [ -z "$VERSION" ]; then
    VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep -m1 '"tag_name"' | cut -d '"' -f 4)
    [ -n "$VERSION" ] || { echo "Could not resolve the latest release tag." >&2; exit 1; }
fi

TARBALL="todo-${VERSION}-${OS}-${ARCH}.tar.gz"
BASE_URL="https://github.com/$REPO/releases/download/$VERSION"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Downloading $TARBALL ($VERSION)..."
curl -fsSL -o "$TMP/$TARBALL" "$BASE_URL/$TARBALL"
curl -fsSL -o "$TMP/checksums.txt" "$BASE_URL/checksums.txt"

echo "Verifying checksum..."
EXPECTED=$(grep "  $TARBALL\$" "$TMP/checksums.txt" | awk '{print $1}')
[ -n "$EXPECTED" ] || { echo "No checksum found for $TARBALL." >&2; exit 1; }
ACTUAL=$(shasum -a 256 "$TMP/$TARBALL" | awk '{print $1}')
[ "$EXPECTED" = "$ACTUAL" ] || { echo "Checksum mismatch for $TARBALL." >&2; exit 1; }

echo "Installing to $INSTALL_DIR..."
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR" "$BIN_DIR"
tar -xzf "$TMP/$TARBALL" -C "$INSTALL_DIR"
ln -sf "$INSTALL_DIR/todo" "$BIN_DIR/todo"

echo "Installed todo $VERSION."
case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *)
        echo "Note: $BIN_DIR is not on your PATH. Add this to your shell profile:"
        echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
        ;;
esac
echo "Uninstall later with: curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash -s -- --uninstall"
