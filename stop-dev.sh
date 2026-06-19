#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

stop_pid() {
  local file="$1"
  if [ -f "$file" ]; then
    local pid
    pid="$(cat "$file")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      pkill -P "$pid" 2>/dev/null || true
    fi
    rm -f "$file"
  fi
}

# Stop vite/node children that may outlive npm start
pkill -f "agents44/frontend/node_modules/.bin/vite" 2>/dev/null || true

stop_pid .dev/flask.pid
stop_pid .dev/frontend.pid

if command -v docker >/dev/null 2>&1; then
  docker compose -f docker-compose.dev.yml down || true
fi

echo "Agents44 dev stack stopped"
