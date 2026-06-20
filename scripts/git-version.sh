#!/usr/bin/env bash
# Print app version: 1.0.<commit-count>-<hash> or 1.0.<commit-count>-<branch>-<hash> off main.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "1.0.0-dev"
  exit 0
fi

COMMIT_COUNT="$(git rev-list --count HEAD)"
GIT_HASH="$(git rev-parse --short HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [ "$BRANCH" = "main" ]; then
  printf '1.0.%s-%s\n' "$COMMIT_COUNT" "$GIT_HASH"
else
  printf '1.0.%s-%s-%s\n' "$COMMIT_COUNT" "$BRANCH" "$GIT_HASH"
fi
