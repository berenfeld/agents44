#!/bin/bash
# Build and run the same Agents44 Docker image used in AWS/ECR.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required"
  exit 1
fi

ENV_FILE="$ROOT/.env"
if [ ! -f "$ENV_FILE" ]; then
  cp .env.example "$ENV_FILE"
  echo "Created $ENV_FILE from .env.example"
fi

mkdir -p .workspace/common_input

export APP_VERSION
APP_VERSION="$(bash "$ROOT/scripts/git-version.sh")"
bash "$ROOT/deploy/scripts/set-env-var.sh" "$ENV_FILE" REACT_APP_VERSION "$APP_VERSION"
bash "$ROOT/deploy/scripts/set-env-var.sh" "$ENV_FILE" FRONTEND_URL "http://localhost"
export TAG=local

echo "Building and starting Agents44 image (version ${APP_VERSION})..."
docker compose up --build -d

echo ""
echo "Agents44 container is up"
echo "  UI:     http://localhost/"
echo "  API:    http://localhost/api"
echo "  Health: http://localhost/api/health"
echo ""
echo "Logs: ./logs-dev.sh   Stop: ./stop-dev.sh"
echo ""

exec "$ROOT/logs-dev.sh"
