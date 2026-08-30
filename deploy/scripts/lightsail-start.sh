#!/bin/bash
# Start (or upgrade) one Agents44 container from ECR.
# Usage: lightsail-start.sh <name> [port]
#   name  — used for container + volume names (e.g. project1)
#   port  — host port mapped to container :80 (default 8080)
#
#   ./lightsail-start.sh project1
#   ./lightsail-start.sh project1 8080
#
# Re-running the same name upgrades to the newest image tag (default: latest):
# stops/removes the old container, pulls again, starts fresh. Named volumes
# (Postgres/workspace/logs/runtime) are kept.
#
# Required env:
#   ANTHROPIC_API_KEY
#
# Optional env (passed into the container):
#   AGENTS44_IMAGE_TAG    default latest
#   FRONTEND_URL          default https://agents.catch44.co.il
#   GOOGLE_CLIENT_ID      enables Google Sign-In button
#   DEV_LOGIN_EMAIL       enables admin/dev login (default admin@catch44.co.il)
#   DEV_LOGIN_PASSWORD    admin/dev password (random if unset; printed once)
#   ADMIN_EMAIL           default admin@catch44.co.il
set -euo pipefail

NAME="${1:-}"
PORT="${2:-8080}"

if [ -z "$NAME" ]; then
  echo "Usage: $0 <name> [port]" >&2
  echo "  Requires ANTHROPIC_API_KEY in the environment." >&2
  echo "  Optional env: FRONTEND_URL GOOGLE_CLIENT_ID DEV_LOGIN_EMAIL DEV_LOGIN_PASSWORD AGENTS44_IMAGE_TAG" >&2
  exit 1
fi

ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"

REGION="${AWS_REGION:-eu-central-1}"
ACCOUNT="${AWS_ACCOUNT_ID:-461838309529}"
IMAGE_TAG="${AGENTS44_IMAGE_TAG:-latest}"
IMAGE="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/agents44:${IMAGE_TAG}"

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "ERROR: ANTHROPIC_API_KEY is not set in the environment" >&2
  echo "       Use:  export ANTHROPIC_API_KEY='...'   (not a bare assignment in ~/.bashrc)" >&2
  echo "       Check: env | grep '^ANTHROPIC_API_KEY='" >&2
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

FRONTEND_URL="${FRONTEND_URL:-https://agents.catch44.co.il}"
DEV_LOGIN_EMAIL="${DEV_LOGIN_EMAIL:-admin@catch44.co.il}"
if [ -z "${DEV_LOGIN_PASSWORD:-}" ]; then
  DEV_LOGIN_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | head -c 20)"
  GENERATED_DEV_PASSWORD=1
else
  GENERATED_DEV_PASSWORD=0
fi
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@catch44.co.il}"

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Container $CONTAINER already exists — stopping and removing it (volumes kept)"
  docker stop "$CONTAINER" >/dev/null || true
  docker rm "$CONTAINER" >/dev/null || true
fi

echo "==> ECR login (${REGION})"
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"

echo "==> Pull ${IMAGE}"
docker pull "$IMAGE"

echo "==> Start ${CONTAINER} on host port ${PORT}"
docker_args=(
  run -d
  --name "$CONTAINER"
  --restart unless-stopped
  -p "${PORT}:80"
  -e "PSQL_DB=agents44"
  -e "PSQL_USER=agents44"
  -e "PSQL_PASSWORD=${PSQL_PASSWORD}"
  -e "FLASK_SECRET_KEY=${FLASK_SECRET_KEY}"
  -e "FRONTEND_URL=${FRONTEND_URL}"
  -e "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}"
  -e "ADMIN_EMAIL=${ADMIN_EMAIL}"
  -e "DEV_LOGIN_EMAIL=${DEV_LOGIN_EMAIL}"
  -e "DEV_LOGIN_PASSWORD=${DEV_LOGIN_PASSWORD}"
  -v "agents44_${NAME}_pgdata:/var/lib/psql/data"
  -v "agents44_${NAME}_workspace:/opt/agents44/workspace"
  -v "agents44_${NAME}_logs:/opt/agents44/logs"
  -v "agents44_${NAME}_runtime:/opt/agents44/runtime"
)
if [ -n "$GOOGLE_CLIENT_ID" ]; then
  docker_args+=(-e "GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}")
fi

docker "${docker_args[@]}" "$IMAGE"

echo ""
echo "Started ${CONTAINER}"
echo "  Image:         ${IMAGE}"
echo "  URL:           ${FRONTEND_URL}"
echo "  Health:        ${FRONTEND_URL%/}/api/health"
echo "  Dev login:     ${DEV_LOGIN_EMAIL}"
if [ "$GENERATED_DEV_PASSWORD" -eq 1 ]; then
  echo "  Dev password:  ${DEV_LOGIN_PASSWORD}  (save this; generated this run)"
fi
if [ -n "$GOOGLE_CLIENT_ID" ]; then
  echo "  Google login:  enabled (GOOGLE_CLIENT_ID set)"
else
  echo "  Google login:  disabled — set GOOGLE_CLIENT_ID and re-run to enable"
fi
echo "  Volumes:       agents44_${NAME}_{pgdata,workspace,logs,runtime}"
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
  echo "Auth config:"
  curl -sS "http://127.0.0.1:${PORT}/api/auth/dev-login/config"; echo
  curl -sS "http://127.0.0.1:${PORT}/api/auth/google/config"; echo
else
  echo "Health check not ready yet — check: docker logs -f ${CONTAINER}" >&2
  exit 1
fi
