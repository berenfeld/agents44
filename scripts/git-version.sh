#!/bin/bash
# Print app version: 1.0.<commit-count>.<git-hash>
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "1.0.0.dev"
  exit 0
fi

COMMIT_COUNT="$(git rev-list --count HEAD)"
GIT_HASH="$(git rev-parse --short HEAD)"
printf '1.0.%s.%s\n' "$COMMIT_COUNT" "$GIT_HASH"
