#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/agents44"
SERVICE_USER="agents44"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root or with sudo"
  exit 1
fi

if [ ! -d "$APP_DIR/venv" ]; then
  echo "Creating Python venv"
  python3 -m venv "$APP_DIR/venv"
  chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR/venv"
fi

echo "Installing Python dependencies"
"$APP_DIR/venv/bin/pip" install -r "$APP_DIR/backend/requirements.txt"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR/venv"

echo "Running database migrations"
cd "$APP_DIR/backend"
"$APP_DIR/venv/bin/alembic" upgrade head

if [ ! -s "$APP_DIR/.env" ]; then
  echo "ERROR: $APP_DIR/.env is missing or empty — configure secrets before deploy"
  exit 1
fi
if ! grep -q '^ANTHROPIC_API_KEY=.\+' "$APP_DIR/.env"; then
  echo "ERROR: ANTHROPIC_API_KEY is not set in $APP_DIR/.env — backend will not start"
  exit 1
fi

mkdir -p "$APP_DIR/logs"
chown "$SERVICE_USER:$SERVICE_USER" "$APP_DIR/logs"
chmod 775 "$APP_DIR/logs"

systemctl reset-failed agents44 2>/dev/null || true
systemctl start agents44
sleep 2

if ! systemctl is-active --quiet agents44; then
  echo "ERROR: agents44 failed to start — recent logs:"
  tail -n 20 "$APP_DIR/logs/error.log" 2>/dev/null || true
  tail -n 20 "$APP_DIR/logs/backend.log" 2>/dev/null || true
  journalctl -u agents44 -n 20 --no-pager 2>/dev/null || true
  exit 1
fi

echo "agents44 is active"
