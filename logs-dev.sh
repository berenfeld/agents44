#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "Tailing Agents44 container logs (Ctrl+C to stop)..."
exec docker compose logs -f --tail=200
