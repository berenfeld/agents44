#!/bin/bash
# Start (or upgrade) one Agents44 container from ECR.
# Usage: lightsail-start.sh <name> [port]
#
# Per-instance config lives on the host and is mounted into the container:
#   ~/.agents/<name>/.env  →  /opt/agents44/.env
#
# Generated once (stable across upgrades — delete the .env to regenerate):
#   PSQL_PASSWORD, FLASK_SECRET_KEY, DEV_LOGIN_PASSWORD, ANTHROPIC_API_KEY
#
# ANTHROPIC_API_KEY is optional at start (UI comes up; agent runs fail until it is set).
# Seed it when the instance .env is new or the key is empty:
#   ANTHROPIC_API_KEY='...' ./lightsail-start.sh <name> [port]
# Or leave it blank and later: ./set-env-var.sh ~/.agents/<name>/.env ANTHROPIC_API_KEY '...'
# then re-run this script (or docker restart agents44-<name>).
# After that the key lives in ~/.agents/<name>/.env — do not export it in ~/.bashrc.
#
# Refreshed from the host environment on every start (when set):
#   GOOGLE_CLIENT_ID, FRONTEND_URL, DEV_LOGIN_EMAIL, ADMIN_EMAIL, SMTP_*
set -euo pipefail

NAME="${1:-}"
PORT="${2:-8080}"

if [ -z "$NAME" ]; then
  echo "Usage: $0 <name> [port]" >&2
  echo "  Optional: ANTHROPIC_API_KEY FRONTEND_URL GOOGLE_CLIENT_ID DEV_LOGIN_EMAIL DEV_LOGIN_PASSWORD AGENTS44_IMAGE_TAG" >&2
  echo "  Anthropic key lives in ~/.agents/<name>/.env (do not put it in ~/.bashrc)." >&2
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

# Capture host exports before we source the instance .env.
# Unset the host Anthropic key so a leftover ~/.bashrc export cannot
# override ~/.agents/<name>/.env on upgrade.
HOST_ANTHROPIC="${ANTHROPIC_API_KEY:-}"
unset ANTHROPIC_API_KEY
HOST_GOOGLE="${GOOGLE_CLIENT_ID:-}"
HOST_FRONTEND="${FRONTEND_URL:-}"
HOST_DEV_EMAIL="${DEV_LOGIN_EMAIL:-}"
HOST_DEV_PASS="${DEV_LOGIN_PASSWORD:-}"
HOST_ADMIN="${ADMIN_EMAIL:-}"
HOST_SMTP_HOST="${SMTP_HOST:-}"
HOST_SMTP_PORT="${SMTP_PORT:-}"
HOST_SMTP_USER="${SMTP_USER:-}"
HOST_SMTP_PASS="${SMTP_APP_PASSWORD:-}"

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

# Anthropic key is per-instance. Host env seeds only when the .env has none.
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-${HOST_ANTHROPIC:-}}"
ANTHROPIC_MISSING=0
if [ -z "${ANTHROPIC_API_KEY}" ]; then
  ANTHROPIC_MISSING=1
  echo "WARNING: ANTHROPIC_API_KEY is empty for instance ${NAME}" >&2
  echo "         Container will start; agent runs and the model list will fail until you set it." >&2
  echo "         Put the key in ${ENV_FILE} then re-run $0 ${NAME} ${PORT}" >&2
  echo "         (or: $(dirname "$0")/set-env-var.sh ${ENV_FILE} ANTHROPIC_API_KEY '...')" >&2
  echo "         Do not export the key in ~/.bashrc (it would be shared by every instance)." >&2
fi

# Always refresh from host when provided
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
# Delete this file to regenerate PSQL/Flask/dev-login secrets (and the Anthropic key).

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
if [ "$ANTHROPIC_MISSING" -eq 1 ]; then
  echo "  Anthropic:  EMPTY — set ANTHROPIC_API_KEY in ${ENV_FILE} then re-run this script"
else
  echo "  Anthropic:  stored in ${ENV_FILE} (not ~/.bashrc)"
fi
echo "  Dev login: ${DEV_LOGIN_EMAIL}"
echo "  Dev pass:  ${DEV_LOGIN_PASSWORD}"
echo "             (from ${ENV_FILE}; frontend does not embed this password)"
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
