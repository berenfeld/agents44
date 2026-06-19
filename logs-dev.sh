#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

FLASK_LOG=".dev/flask.log"
FRONTEND_LOG=".dev/frontend.log"

mkdir -p .dev
touch "$FLASK_LOG" "$FRONTEND_LOG"

echo "Tailing dev logs (Ctrl+C to stop):"
echo "  Flask:    $FLASK_LOG"
echo "  Frontend: $FRONTEND_LOG"
echo ""

tail -f "$FLASK_LOG" "$FRONTEND_LOG"
