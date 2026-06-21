#!/usr/bin/env bash
# Sync PostgreSQL role password from PSQL_* vars in .env.
set -euo pipefail

APP_DIR="/opt/agents44"
ENV_FILE="${1:-$APP_DIR/.env}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root or with sudo"
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE"
  exit 1
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

escape_sql_literal() {
  printf '%s' "$1" | sed "s/'/''/g"
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

SQL_PASSWORD="$(escape_sql_literal "$PSQL_PASSWORD")"

if ! sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${PSQL_USER}'" | grep -q 1; then
  sudo -u postgres createuser "$PSQL_USER"
fi

sudo -u postgres psql -c "ALTER USER \"${PSQL_USER}\" WITH PASSWORD '${SQL_PASSWORD}' SUPERUSER;"

PGPASSWORD="$PSQL_PASSWORD" psql -h "$PSQL_HOST" -p "$PSQL_PORT" -U "$PSQL_USER" -d "$PSQL_DB" -c 'SELECT 1 AS ok;' -t

echo "PostgreSQL password synced for user ${PSQL_USER}"
