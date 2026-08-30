#!/bin/bash
# Generate random strong secrets for PostgreSQL, Flask, and dev login.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PSQL_USER="${PSQL_USER:-agents44}"
PSQL_DB="${PSQL_DB:-agents44}"
PSQL_HOST="${PSQL_HOST:-localhost}"
PSQL_PORT="${PSQL_PORT:-5432}"

generate_password() {
  local length="${1:-32}"
  local value=""
  while [ "${#value}" -lt "$length" ]; do
    value+=$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9')
  done
  printf '%s' "${value:0:length}"
}

PSQL_PASSWORD="$(generate_password 32)"
FLASK_SECRET_KEY="$(openssl rand -hex 32)"
DEV_LOGIN_PASSWORD="$(generate_password 32)"

cat <<EOF
# Strong passwords for agents44 — $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Copy into ${ROOT}/.env (local) or ~/.agents/<name>/.env (Lightsail).

PSQL_HOST=${PSQL_HOST}
PSQL_PORT=${PSQL_PORT}
PSQL_DB=${PSQL_DB}
PSQL_USER=${PSQL_USER}
PSQL_PASSWORD=${PSQL_PASSWORD}
FLASK_SECRET_KEY=${FLASK_SECRET_KEY}
DEV_LOGIN_PASSWORD=${DEV_LOGIN_PASSWORD}
EOF
