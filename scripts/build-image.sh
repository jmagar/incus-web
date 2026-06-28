#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DEFINITION="${DISTROBUILDER_YAML:-$ROOT/distrobuilder.yaml}"
IMAGE_ALIAS="${IMAGE_ALIAS:-incus-web-agent}"
EXPORT_DIR="${EXPORT_DIR:-$ROOT/dist}"
BUILD_TYPE="${BUILD_TYPE:-unified}"

log() {
  printf '[incus-web] %s\n' "$*"
}

have() {
  command -v "$1" >/dev/null 2>&1
}

if ! have distrobuilder; then
  printf '[incus-web] error: distrobuilder is required\n' >&2
  exit 1
fi

if [[ ! -f "$DEFINITION" ]]; then
  printf '[incus-web] error: missing distrobuilder definition: %s\n' "$DEFINITION" >&2
  exit 1
fi

mkdir -p "$EXPORT_DIR"
rm -f "$EXPORT_DIR/$IMAGE_ALIAS.tar.xz" "$EXPORT_DIR/rootfs.squashfs" "$EXPORT_DIR/incus.tar.xz"

log "building $IMAGE_ALIAS from $DEFINITION with distrobuilder"
distrobuilder build-incus "$DEFINITION" "$EXPORT_DIR" --type "$BUILD_TYPE"

if [[ "$BUILD_TYPE" == "unified" && -f "$EXPORT_DIR/incus.tar.xz" ]]; then
  mv "$EXPORT_DIR/incus.tar.xz" "$EXPORT_DIR/$IMAGE_ALIAS.tar.xz"
fi

ls -lh "$EXPORT_DIR"
