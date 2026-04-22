#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/bump-version.sh <new-version>
# Example: ./scripts/bump-version.sh 1.0.12

if [[ $# -ne 1 ]]; then
    echo "Usage: $0 <new-version>" >&2
    exit 1
fi

NEW="$1"

# Validate semver format
if ! [[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: version must be in X.Y.Z format" >&2
    exit 1
fi

JSON_FILES=(
    ".claude-plugin/plugin.json"
    ".claude-plugin/marketplace.json"
    "gemini-extension.json"
)

for f in "${JSON_FILES[@]}"; do
    # Replace first occurrence of "version": "<anything>" that matches our addon version pattern
    sed -i '' "s/\"version\": \"[0-9]*\.[0-9]*\.[0-9]*\"/\"version\": \"$NEW\"/" "$f"
    echo "Updated $f"
done

ZON_FILES=(
    "build.zig.zon"
)

for f in "${ZON_FILES[@]}"; do
    # Replace .version = "X.Y.Z" (Zig zon format)
    sed -i '' "s/\.version = \"[0-9]*\.[0-9]*\.[0-9]*\"/.version = \"$NEW\"/" "$f"
    echo "Updated $f"
done

echo "Version bumped to $NEW"
