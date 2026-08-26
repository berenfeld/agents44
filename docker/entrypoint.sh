#!/bin/bash
set -euo pipefail

APP_DIR="/opt/agents44"
ENV_FILE="$APP_DIR/.env"
PGDATA="${PGDATA:-/var/lib/psql/data}"
PG_RUN="/var/run/postgresql"
PG_BIN="$(ls -d /usr/lib/postgresql/*/bin | sort | tail -1)"

export PATH="/root/.local/bin:${PG_BIN}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export LANG="${LANG:-en_US.UTF-8}"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

# Container layout always wins over host-relative paths from a mounted .env
export WORKSPACE_PATH="$APP_DIR/workspace"
export RUNTIME_DIR="$APP_DIR/runtime"
export LOG_DIR="$APP_DIR/logs"
export PSQL_HOST=localhost
export PSQL_PORT=5432

if [ -z "${REACT_APP_VERSION:-}" ]; then
  export REACT_APP_VERSION="${APP_VERSION:-dev}"
fi

: "${PSQL_HOST:=localhost}"
: "${PSQL_PORT:=5432}"
: "${PSQL_DB:=agents44}"
: "${PSQL_USER:=agents44}"
: "${PSQL_PASSWORD:=agents44}"

mkdir -p "$WORKSPACE_PATH/common_input" "$RUNTIME_DIR" "$LOG_DIR" "$PG_RUN" "$(dirname "$PGDATA")"
chown psql:psql "$PG_RUN"
chmod 775 "$PG_RUN"

escape_sql_literal() {
  printf '%s' "$1" | sed "s/'/''/g"
}

init_postgres() {
  mkdir -p "$PGDATA"
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "Initializing PostgreSQL data directory as user psql"
    chown -R psql:psql "$(dirname "$PGDATA")"
    runuser -u psql -- "$PG_BIN/initdb" \
      -D "$PGDATA" \
      --encoding=UTF8 \
      --locale=en_US.UTF-8 \
      --auth-local=peer \
      --auth-host=scram-sha-256
  fi
  chown -R psql:psql "$(dirname "$PGDATA")"
  chmod 700 "$PGDATA"
}

psql_as_psql() {
  runuser -u psql -- env PGDATABASE=postgres "$PG_BIN/psql" -d postgres -v ON_ERROR_STOP=1 "$@"
}

ensure_app_role() {
  local password_sql
  password_sql="$(escape_sql_literal "$PSQL_PASSWORD")"
  if ! psql_as_psql -tAc "SELECT 1 FROM pg_database WHERE datname='psql'" | grep -q 1; then
    psql_as_psql -c "CREATE DATABASE psql OWNER psql;"
  fi
  if ! psql_as_psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${PSQL_USER}'" | grep -q 1; then
    psql_as_psql -c "CREATE ROLE \"${PSQL_USER}\" LOGIN SUPERUSER PASSWORD '${password_sql}';"
  else
    psql_as_psql -c "ALTER ROLE \"${PSQL_USER}\" WITH LOGIN SUPERUSER PASSWORD '${password_sql}';"
  fi
  if ! psql_as_psql -tAc "SELECT 1 FROM pg_database WHERE datname='${PSQL_DB}'" | grep -q 1; then
    psql_as_psql -c "CREATE DATABASE \"${PSQL_DB}\" OWNER \"${PSQL_USER}\" ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' TEMPLATE template0;"
  fi
}

wait_for_postgres() {
  local i
  for i in $(seq 1 60); do
    if runuser -u psql -- "$PG_BIN/pg_isready" -d postgres -q; then
      return 0
    fi
    sleep 1
  done
  echo "ERROR: PostgreSQL did not become ready" >&2
  return 1
}

PG_PID=""
GUNICORN_PID=""
NGINX_PID=""
SHUTTING_DOWN=0

shutdown() {
  SHUTTING_DOWN=1
  echo "Shutting down"
  if [ -n "$NGINX_PID" ] && kill -0 "$NGINX_PID" 2>/dev/null; then
    nginx -s quit || kill -TERM "$NGINX_PID" || true
  fi
  if [ -n "$GUNICORN_PID" ] && kill -0 "$GUNICORN_PID" 2>/dev/null; then
    kill -TERM "$GUNICORN_PID" || true
  fi
  if [ -n "$PG_PID" ] && kill -0 "$PG_PID" 2>/dev/null; then
    runuser -u psql -- "$PG_BIN/pg_ctl" -D "$PGDATA" -m fast stop || kill -TERM "$PG_PID" || true
  fi
  wait || true
}

trap shutdown SIGTERM SIGINT

init_postgres
runuser -u psql -- "$PG_BIN/postgres" \
  -D "$PGDATA" \
  -c config_file=/opt/agents44/docker/postgresql.conf &
PG_PID=$!
wait_for_postgres
ensure_app_role

echo "Running database migrations"
cd "$APP_DIR/backend"
"$APP_DIR/venv/bin/alembic" upgrade head

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "WARNING: ANTHROPIC_API_KEY is not set — agent runs will fail"
fi

echo "Starting gunicorn"
cd "$APP_DIR/backend"
"$APP_DIR/venv/bin/gunicorn" -c "$APP_DIR/docker/gunicorn.conf.py" wsgi:app &
GUNICORN_PID=$!

echo "Starting nginx"
nginx -g 'daemon off;' &
NGINX_PID=$!

echo "Agents44 is up (nginx :80, API 127.0.0.1:5000, postgres as psql)"

wait -n || true
if [ "$SHUTTING_DOWN" -eq 1 ]; then
  exit 0
fi
echo "A process exited — stopping container"
shutdown
exit 1
