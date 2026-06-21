#!/usr/bin/env bash
# Production PostgreSQL shell using PSQL_* vars from /opt/agents44/.env.
# Usage: db-prod.sh [SQL query...]
set -euo pipefail

APP_DIR="/opt/agents44"
ENV_FILE="$APP_DIR/.env"

usage() {
  echo "Usage: $0 [SQL query...]"
  echo "Connects to the production database using PSQL_* vars in $ENV_FILE."
  echo "Examples:"
  echo "  $0"
  echo "  $0 '\\dt'"
  echo "  $0 'SELECT * FROM system_agents;'"
  exit "${1:-0}"
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage 0
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE"
  exit 1
fi

if [ ! -r "$ENV_FILE" ]; then
  exec sudo -u agents44 "$0" "$@"
fi

read_env() {
  local key="$1" default="${2:-}"
  local line value
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -1 || true)"
  if [ -z "$line" ]; then
    printf '%s' "$default"
    return
  fi
  value="${line#*=}"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

PSQL_USER="$(read_env PSQL_USER agents44)"
PSQL_PASSWORD="$(read_env PSQL_PASSWORD agents44)"
PSQL_DB="$(read_env PSQL_DB agents44)"
PSQL_HOST="$(read_env PSQL_HOST localhost)"
PSQL_PORT="$(read_env PSQL_PORT 5432)"

if [ -z "$PSQL_PASSWORD" ]; then
  echo "ERROR: PSQL_PASSWORD is empty in $ENV_FILE"
  exit 1
fi

echo "Connecting to ${PSQL_USER}@${PSQL_HOST}:${PSQL_PORT}/${PSQL_DB}"

export PGPASSWORD="$PSQL_PASSWORD"
PSQL_ARGS=(-h "$PSQL_HOST" -p "$PSQL_PORT" -U "$PSQL_USER" -d "$PSQL_DB")

if [ $# -eq 0 ]; then
  exec psql "${PSQL_ARGS[@]}"
fi

exec psql "${PSQL_ARGS[@]}" -c "$*"
