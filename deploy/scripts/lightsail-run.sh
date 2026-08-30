#!/bin/bash
# Start one Agents44 container from ECR.
# Usage: lightsail-run.sh <name> <anthropic_api_key> [port]
#   name  — used for container + volume names (e.g. project1)
#   port  — host port mapped to container :80 (default 8080)
set -euo pipefail

NAME="${1:-}"
ANTHROPIC_API_KEY="${2:-}"
PORT="${3:-8080}"

REGION="${AWS_REGION:-eu-central-1}"
ACCOUNT="${AWS_ACCOUNT_ID:-461838309529}"
IMAGE_TAG="${AGENTS44_IMAGE_TAG:-latest}"
IMAGE="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/agents44:${IMAGE_TAG}"

if [ -z "$NAME" ] || [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "Usage: $0 <name> <anthropic_api_key> [port]" >&2
  echo "  Example: $0 project1 sk-ant-... 8080" >&2
  exit 1
fi

if ! [[ "$NAME" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]]; then
  echo "Invalid name: use letters, numbers, _ or - (must start alphanumeric)" >&2
  exit 1
fi

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "Invalid port: $PORT" >&2
  exit 1
fi

CONTAINER="agents44-${NAME}"
PSQL_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
FLASK_SECRET_KEY="$(openssl rand -hex 32)"

# Public URL for browser redirects / CORS-ish config (override with FRONTEND_URL=...)
PUBLIC_IP="$(curl -sS --max-time 3 http://checkip.amazonaws.com 2>/dev/null || true)"
FRONTEND_URL="${FRONTEND_URL:-http://${PUBLIC_IP:-127.0.0.1}:${PORT}}"

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Container $CONTAINER already exists — stopping and removing it"
  docker stop "$CONTAINER" >/dev/null || true
  docker rm "$CONTAINER" >/dev/null || true
fi

echo "==> ECR login (${REGION})"
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"

echo "==> Pull ${IMAGE}"
docker pull "$IMAGE"

echo "==> Start ${CONTAINER} on host port ${PORT}"
docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  -p "${PORT}:80" \
  -e PSQL_DB=agents44 \
  -e PSQL_USER=agents44 \
  -e PSQL_PASSWORD="$PSQL_PASSWORD" \
  -e FLASK_SECRET_KEY="$FLASK_SECRET_KEY" \
  -e FRONTEND_URL="$FRONTEND_URL" \
  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  -e ADMIN_EMAIL="${ADMIN_EMAIL:-admin@catch44.co.il}" \
  -v "agents44_${NAME}_pgdata:/var/lib/psql/data" \
  -v "agents44_${NAME}_workspace:/opt/agents44/workspace" \
  -v "agents44_${NAME}_logs:/opt/agents44/logs" \
  -v "agents44_${NAME}_runtime:/opt/agents44/runtime" \
  "$IMAGE"

echo ""
echo "Started ${CONTAINER}"
echo "  Image:    ${IMAGE}"
echo "  URL:      ${FRONTEND_URL}"
echo "  Health:   ${FRONTEND_URL%/}/api/health"
echo "  Volumes:  agents44_${NAME}_{pgdata,workspace,logs,runtime}"
echo ""
echo "Waiting for health..."
ok=0
for _ in $(seq 1 45); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 1
done
if [ "$ok" -eq 1 ]; then
  curl -sS "http://127.0.0.1:${PORT}/api/health"
  echo
else
  echo "Health check not ready yet — check: docker logs -f ${CONTAINER}" >&2
  exit 1
fi
