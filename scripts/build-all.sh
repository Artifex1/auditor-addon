#!/usr/bin/env bash
# Cross-compile aa for all supported platforms.
# Outputs to skills/auditor-addon-cli/bin/ alongside the dispatcher.
# Usage: ./scripts/build-all.sh [--release]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="Debug"
if [[ "${1:-}" == "--release" ]]; then
    MODE="ReleaseSafe"
fi

TARGETS=(
    aarch64-macos
    x86_64-macos
    aarch64-linux
    x86_64-linux
    aarch64-windows
    x86_64-windows
)

OUT_DIR="$ROOT/skills/auditor-addon-cli/bin"

echo "Building aa ($MODE) for ${#TARGETS[@]} targets..."

mkdir -p "$OUT_DIR"

for target in "${TARGETS[@]}"; do
    echo "  $target"

    # Zig cross-compilation: -Dtarget= uses Zig's built-in cross-compiler
    zig build -Dtarget="$target" -Doptimize="$MODE" --prefix "zig-out/stage" 2>&1

    # Determine source binary name and destination name
    src="zig-out/stage/bin/aa"
    suffix=""
    if [[ "$target" == *-windows ]]; then
        src="${src}.exe"
        suffix=".exe"
    fi

    dest="$OUT_DIR/aa-${target}${suffix}"
    mv "$src" "$dest"

    echo "    -> $(basename "$dest") ($(wc -c < "$dest" | tr -d ' ') bytes)"
done

# Clean up staging directory
rm -rf zig-out/stage

echo ""
echo "Done. Binaries in $OUT_DIR/:"
ls -lh "$OUT_DIR/"
