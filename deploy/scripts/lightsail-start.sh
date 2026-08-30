#!/bin/bash
# Start (or upgrade) one Agents44 container from ECR.
# Usage: lightsail-start.sh <name> [port]
#
# Per-instance config lives on the host and is mounted into the container:
#   ~/.agents/<name>/.env  →  /opt/agents44/.env
#
# Generated once (stable across upgrades — delete the .env to regenerate):
#   PSQL_PASSWORD, FLASK_SECRET_KEY, DEV_LOGIN_PASSWORD
#
# Refreshed from the host environment on every start (when set):
#   ANTHROPIC_API_KEY (required), GOOGLE_CLIENT_ID, FRONTEND_URL,
#   DEV_LOGIN_EMAIL, ADMIN_EMAIL, SMTP_*
#
# Required host env: ANTHROPIC_API_KEY (export in ~/.bashrc)
set -euo pipefail

NAME="${1:-}"
PORT="${2:-8080}"

if [ -z "$NAME" ]; then
  echo "Usage: $0 <name> [port]" >&2
  echo "  Requires ANTHROPIC_API_KEY in the environment." >&2
  echo "  Optional: FRONTEND_URL GOOGLE_CLIENT_ID DEV_LOGIN_EMAIL DEV_LOGIN_PASSWORD AGENTS44_IMAGE_TAG" >&2
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

# Capture host exports before we source the instance .env
HOST_ANTHROPIC="${ANTHROPIC_API_KEY:-}"
HOST_GOOGLE="${GOOGLE_CLIENT_ID:-}"
HOST_FRONTEND="${FRONTEND_URL:-}"
HOST_DEV_EMAIL="${DEV_LOGIN_EMAIL:-}"
HOST_DEV_PASS="${DEV_LOGIN_PASSWORD:-}"
HOST_ADMIN="${ADMIN_EMAIL:-}"
HOST_SMTP_HOST="${SMTP_HOST:-}"
HOST_SMTP_PORT="${SMTP_PORT:-}"
HOST_SMTP_USER="${SMTP_USER:-}"
HOST_SMTP_PASS="${SMTP_APP_PASSWORD:-}"

if [ -z "$HOST_ANTHROPIC" ]; then
  echo "ERROR: ANTHROPIC_API_KEY is not set in the environment" >&2
  echo "       Use:  export ANTHROPIC_API_KEY='...'   (must be exported)" >&2
  echo "       Check: env | grep '^ANTHROPIC_API_KEY='" >&2
  exit 1
fi

REGION="${AWS_REGION:-eu-central-1}"
ACCOUNT="${AWS_ACCOUNT_ID:-461838309529}"
IMAGE_TAG="${AGENTS44_IMAGE_TAG:-latest}"
IMAGE="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/agents44:${IMAGE_TAG}"

CONTAINER="agents44-${NAME}"
INSTANCE_DIR="${HOME}/.agents/${NAME}"
ENV_FILE="${INSTANCE_DIR}/.env"

rand_password() {
  openssl rand -base64 24 | tr -d '/+=' | head -c 32
}

rand_secret() {
  openssl rand -hex 32
}

ENV_REUSED=0
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
  ENV_REUSED=1
  echo "==> Reusing instance env ${ENV_FILE}"
fi

# Stable secrets: keep from file, generate only if missing
PSQL_PASSWORD="${PSQL_PASSWORD:-$(rand_password)}"
FLASK_SECRET_KEY="${FLASK_SECRET_KEY:-$(rand_secret)}"
DEV_LOGIN_PASSWORD="${HOST_DEV_PASS:-${DEV_LOGIN_PASSWORD:-$(rand_password | head -c 20)}}"
DEV_LOGIN_EMAIL="${HOST_DEV_EMAIL:-${DEV_LOGIN_EMAIL:-admin@catch44.co.il}}"

# Always refresh from host when provided
ANTHROPIC_API_KEY="$HOST_ANTHROPIC"
GOOGLE_CLIENT_ID="${HOST_GOOGLE:-${GOOGLE_CLIENT_ID:-}}"
FRONTEND_URL="${HOST_FRONTEND:-${FRONTEND_URL:-https://agents.catch44.co.il}}"
ADMIN_EMAIL="${HOST_ADMIN:-${ADMIN_EMAIL:-admin@catch44.co.il}}"
SMTP_HOST="${HOST_SMTP_HOST:-${SMTP_HOST:-smtp.gmail.com}}"
SMTP_PORT="${HOST_SMTP_PORT:-${SMTP_PORT:-587}}"
SMTP_USER="${HOST_SMTP_USER:-${SMTP_USER:-$ADMIN_EMAIL}}"
SMTP_APP_PASSWORD="${HOST_SMTP_PASS:-${SMTP_APP_PASSWORD:-}}"

PSQL_DB="${PSQL_DB:-agents44}"
PSQL_USER="${PSQL_USER:-agents44}"
MCP_PORT="${MCP_PORT:-5001}"

mkdir -p "$INSTANCE_DIR"
umask 077
cat > "$ENV_FILE" <<EOF
# Agents44 instance "${NAME}" — mounted at /opt/agents44/.env
# Stable secrets persist across lightsail-start upgrades.
# Delete this file to regenerate PSQL/Flask/dev-login secrets.

PSQL_HOST=localhost
PSQL_PORT=5432
PSQL_DB=${PSQL_DB}
PSQL_USER=${PSQL_USER}
PSQL_PASSWORD=${PSQL_PASSWORD}

FLASK_SECRET_KEY=${FLASK_SECRET_KEY}
FRONTEND_URL=${FRONTEND_URL}

DEV_LOGIN_EMAIL=${DEV_LOGIN_EMAIL}
DEV_LOGIN_PASSWORD=${DEV_LOGIN_PASSWORD}

GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}

SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_USER=${SMTP_USER}
SMTP_APP_PASSWORD=${SMTP_APP_PASSWORD}
ADMIN_EMAIL=${ADMIN_EMAIL}

ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
DEFAULT_MODEL=

MCP_PORT=${MCP_PORT}
REACT_APP_API_URL=/api
EOF
chmod 600 "$ENV_FILE"

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Container $CONTAINER already exists — stopping and removing it (volumes + .env kept)"
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
  -v "${ENV_FILE}:/opt/agents44/.env:ro" \
  -v "agents44_${NAME}_pgdata:/var/lib/psql/data" \
  -v "agents44_${NAME}_workspace:/opt/agents44/workspace" \
  -v "agents44_${NAME}_logs:/opt/agents44/logs" \
  -v "agents44_${NAME}_runtime:/opt/agents44/runtime" \
  "$IMAGE"

echo ""
echo "Started ${CONTAINER}"
echo "  Image:     ${IMAGE}"
echo "  URL:       ${FRONTEND_URL}"
echo "  Health:    ${FRONTEND_URL%/}/api/health"
echo "  Env file:  ${ENV_FILE}  ($( [ "$ENV_REUSED" -eq 1 ] && echo reused || echo created ))"
echo "  Dev login: ${DEV_LOGIN_EMAIL}"
if [ "$ENV_REUSED" -eq 0 ]; then
  echo "  Dev pass:  ${DEV_LOGIN_PASSWORD}  (also in .env)"
fi
if [ -n "$GOOGLE_CLIENT_ID" ]; then
  echo "  Google:    enabled"
else
  echo "  Google:    disabled (export GOOGLE_CLIENT_ID and re-run)"
fi
echo "  Volumes:   agents44_${NAME}_{pgdata,workspace,logs,runtime}"
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
