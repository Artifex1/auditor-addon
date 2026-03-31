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

FILES=(
    ".claude-plugin/plugin.json"
    ".claude-plugin/marketplace.json"
    "gemini-extension.json"
)

for f in "${FILES[@]}"; do
    # Replace first occurrence of "version": "<anything>" that matches our addon version pattern
    sed -i '' "s/\"version\": \"[0-9]*\.[0-9]*\.[0-9]*\"/\"version\": \"$NEW\"/" "$f"
    echo "Updated $f"
done

echo "Version bumped to $NEW"
