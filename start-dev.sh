#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

mkdir -p .dev runtime .workspace/common_input

ENV_FILE="$ROOT/.env"
if [ ! -f "$ENV_FILE" ]; then
  cp .env.example "$ENV_FILE"
  echo "Created $ENV_FILE from .env.example"
fi

set -a
# shellcheck disable=SC1091
source "$ENV_FILE"
set +a

: "${FLASK_APP:=wsgi:app}"
: "${FLASK_ENV:=development}"
: "${FLASK_DEBUG:=1}"
: "${FLASK_RUN_HOST:=127.0.0.1}"
: "${FLASK_RUN_PORT:=5000}"
: "${WORKSPACE_PATH:=$ROOT/.workspace}"
: "${RUNTIME_DIR:=$ROOT/.dev/runtime}"

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

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for local Postgres"
  exit 1
fi

pkill -f "agents44/frontend/node_modules/.bin/vite" 2>/dev/null || true
stop_pid .dev/flask.pid
stop_pid .dev/frontend.pid

containers="$(docker ps -q)"
if [ -n "$containers" ]; then
  echo "Stopping all running containers..."
  docker stop $containers
fi

docker compose -f docker-compose.dev.yml up -d
echo "Waiting for Postgres..."
for _ in $(seq 1 30); do
  if docker compose -f docker-compose.dev.yml exec -T postgres pg_isready -U agents44 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if [ ! -d backend/.venv ]; then
  python3 -m venv backend/.venv
fi
# shellcheck disable=SC1091
source backend/.venv/bin/activate
pip install -q -r backend/requirements.txt

cd backend
alembic upgrade head || true
cd "$ROOT"

flask_run_args=(run --host "$FLASK_RUN_HOST" --port "$FLASK_RUN_PORT")
case "${FLASK_DEBUG,,}" in
  1 | true | yes) flask_run_args+=(--debug) ;;
esac

if [ -f .dev/flask.pid ] && kill -0 "$(cat .dev/flask.pid)" 2>/dev/null; then
  echo "Flask already running"
else
  # shellcheck disable=SC1091
  source backend/.venv/bin/activate
  cd backend
  nohup flask "${flask_run_args[@]}" > "$ROOT/.dev/flask.log" 2>&1 &
  echo $! > "$ROOT/.dev/flask.pid"
  cd "$ROOT"
fi

if [ ! -d frontend/node_modules ]; then
  (cd frontend && npm install)
fi

if [ -f .dev/frontend.pid ] && kill -0 "$(cat .dev/frontend.pid)" 2>/dev/null; then
  echo "Frontend already running"
else
  cd frontend
  nohup npm start > "$ROOT/.dev/frontend.log" 2>&1 &
  echo $! > "$ROOT/.dev/frontend.pid"
  cd "$ROOT"
fi

echo ""
echo "Agents44 dev stack started (no nginx — Vite + Flask dev servers with auto-reload)"
echo "  Frontend: http://localhost:3000  (npm start / Vite HMR)"
echo "  API:      http://localhost:${FLASK_RUN_PORT}/api  (flask run, FLASK_DEBUG=${FLASK_DEBUG})"
echo "  Health:   http://localhost:${FLASK_RUN_PORT}/api/health"
echo ""

exec "$ROOT/logs-dev.sh"
