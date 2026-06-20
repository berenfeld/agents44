#!/usr/bin/env bash
# Idempotent VM infrastructure setup for agents.catch44.co.il.
# Installs system packages, PostgreSQL, nginx, systemd — not application code.
# Re-run safely after pulling repo updates that change deploy/ configs.
set -euo pipefail

APP_DIR="/opt/agents44"
WORKSPACE_DIR="$APP_DIR/workspace"
SERVICE_USER="agents44"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$DEPLOY_DIR/.." && pwd)"
ENV_FILE="$APP_DIR/.env"

read_env() {
  local key="$1" default="${2:-}"
  local line value
  line="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -1 || true)"
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

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root or with sudo"
  exit 1
fi

for required in \
  "$DEPLOY_DIR/systemd/agents44.service" \
  "$DEPLOY_DIR/nginx/agents.catch44.co.il.conf"; do
  if [ ! -f "$required" ]; then
    echo "Missing $required — scp the deploy/ directory before running install-server.sh"
    exit 1
  fi
done

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y \
  postgresql \
  nginx \
  python3 \
  python3-venv \
  python3-pip \
  certbot \
  python3-certbot-nginx \
  curl \
  unzip

if ! sudo -u "$SERVICE_USER" bash -lc 'command -v claude >/dev/null 2>&1'; then
  sudo -u "$SERVICE_USER" bash -lc 'curl -fsSL https://claude.ai/install.sh | bash' \
    || echo "Warning: Claude CLI install failed for $SERVICE_USER; install manually"
fi

id -u "$SERVICE_USER" >/dev/null 2>&1 || \
  useradd --system --create-home --home-dir "$APP_DIR" "$SERVICE_USER"

mkdir -p "$APP_DIR" "$APP_DIR/runtime" "$APP_DIR/logs" "$WORKSPACE_DIR/common_input"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR" "$WORKSPACE_DIR"
chmod 775 "$APP_DIR" "$APP_DIR/logs" "$WORKSPACE_DIR"

# Allow the admin SSH user (e.g. ubuntu) to rsync deploys into /opt/agents44
DEPLOY_USER="${SUDO_USER:-ubuntu}"
if id "$DEPLOY_USER" >/dev/null 2>&1; then
  usermod -aG "$SERVICE_USER" "$DEPLOY_USER" || true
fi

systemctl enable postgresql
systemctl start postgresql

if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$ROOT_DIR/.env.example" ]; then
    cp "$ROOT_DIR/.env.example" "$ENV_FILE"
  else
    touch "$ENV_FILE"
  fi
  chown "$SERVICE_USER:$SERVICE_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Created $ENV_FILE — set PSQL_PASSWORD, ANTHROPIC_API_KEY and other secrets before production use"
fi

PSQL_USER="$(read_env PSQL_USER agents44)"
PSQL_DB="$(read_env PSQL_DB agents44)"

if ! sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${PSQL_DB}'" | grep -q 1; then
  sudo -u postgres createdb -O "$PSQL_USER" -E UTF8 -l en_US.UTF-8 -T template0 "$PSQL_DB"
fi

bash "$SCRIPT_DIR/sync-psql-password.sh" "$ENV_FILE"

mkdir -p "$APP_DIR/deploy/systemd" "$APP_DIR/deploy/nginx" "$APP_DIR/deploy/scripts"
cp "$DEPLOY_DIR/systemd/agents44.service" "$APP_DIR/deploy/systemd/agents44.service"
cp "$DEPLOY_DIR/nginx/agents.catch44.co.il.conf" "$APP_DIR/deploy/nginx/agents.catch44.co.il.conf"
cp "$DEPLOY_DIR/nginx/agents.catch44.co.il.http-bootstrap.conf" "$APP_DIR/deploy/nginx/agents.catch44.co.il.http-bootstrap.conf"
cp "$DEPLOY_DIR/gunicorn.conf.py" "$APP_DIR/deploy/gunicorn.conf.py"
cp "$SCRIPT_DIR"/*.sh "$APP_DIR/deploy/scripts/"
chmod +x "$APP_DIR/deploy/scripts"/*.sh
[ -f "$ROOT_DIR/.env.example" ] && cp "$ROOT_DIR/.env.example" "$APP_DIR/.env.example"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR/deploy"
[ -f "$APP_DIR/.env.example" ] && chown "$SERVICE_USER:$SERVICE_USER" "$APP_DIR/.env.example"

cp "$DEPLOY_DIR/systemd/agents44.service" /etc/systemd/system/agents44.service

DOMAIN="agents.catch44.co.il"
CERTBOT_EMAIL="admin@catch44.co.il"
CERTBOT_WEBROOT="/var/www/certbot"
SSL_CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
NGINX_SITE="/etc/nginx/sites-available/agents.catch44.co.il"

mkdir -p "$CERTBOT_WEBROOT"

install_nginx_site() {
  cp "$1" "$NGINX_SITE"
  ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/agents.catch44.co.il
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl enable nginx
  systemctl reload nginx || systemctl restart nginx
}

if [ ! -f "$SSL_CERT" ]; then
  echo "No TLS certificate — bootstrapping HTTP for certbot"
  install_nginx_site "$DEPLOY_DIR/nginx/agents.catch44.co.il.http-bootstrap.conf"
  certbot certonly --webroot -w "$CERTBOT_WEBROOT" \
    -d "$DOMAIN" \
    --non-interactive --agree-tos -m "$CERTBOT_EMAIL"
fi

if [ ! -f /etc/letsencrypt/options-ssl-nginx.conf ] || [ ! -f /etc/letsencrypt/ssl-dhparams.pem ]; then
  certbot install --cert-name "$DOMAIN" --nginx || true
fi

install_nginx_site "$DEPLOY_DIR/nginx/agents.catch44.co.il.conf"

systemctl daemon-reload
systemctl enable agents44

if [ -x "$APP_DIR/venv/bin/gunicorn" ]; then
  systemctl restart agents44
else
  echo "Skipping agents44 restart — run GitHub Actions deploy or install app dependencies first"
fi

echo "Infrastructure install complete"
