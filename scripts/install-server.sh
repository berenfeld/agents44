#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/agents44"
WORKSPACE_DIR="/var/lib/agents44/workspace"
SERVICE_USER="agents44"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root or with sudo"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y postgresql nginx python3 python3-venv python3-pip certbot python3-certbot-nginx curl git

if ! command -v claude >/dev/null 2>&1; then
  curl -fsSL https://claude.ai/install.sh | bash || echo "Warning: Claude CLI install failed; install manually"
fi

id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$APP_DIR" "$SERVICE_USER"
mkdir -p "$APP_DIR" "$WORKSPACE_DIR" "$APP_DIR/runtime"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR" "$WORKSPACE_DIR"

sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='agents44'" | grep -q 1 || \
  sudo -u postgres createuser agents44
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='agents44'" | grep -q 1 || \
  sudo -u postgres createdb -O agents44 -E UTF8 -l en_US.UTF-8 -T template0 agents44 || true

python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install -r "$APP_DIR/backend/requirements.txt"

ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  cp "$APP_DIR/.env.example" "$ENV_FILE"
  echo "Created $ENV_FILE — set ANTHROPIC_API_KEY and other secrets before production use"
fi

sudo -u "$SERVICE_USER" bash -c "cd $APP_DIR/backend && $APP_DIR/venv/bin/alembic upgrade head"

mkdir -p "$WORKSPACE_DIR/common_input"
chown -R "$SERVICE_USER:$SERVICE_USER" "$WORKSPACE_DIR"

cat > /etc/systemd/system/agents44.service <<EOF
[Unit]
Description=Agents44 Flask API
After=network.target postgresql.service

[Service]
User=$SERVICE_USER
WorkingDirectory=$APP_DIR/backend
EnvironmentFile=$ENV_FILE
Environment=RUNTIME_DIR=$APP_DIR/runtime
Environment=WORKSPACE_PATH=$WORKSPACE_DIR
ExecStart=$APP_DIR/venv/bin/gunicorn -b 127.0.0.1:5000 wsgi:app
Restart=always

[Install]
WantedBy=multi-user.target
EOF

cp "$APP_DIR/deploy/nginx/agents.catch44.co.il.conf" /etc/nginx/sites-available/agents.catch44.co.il
ln -sf /etc/nginx/sites-available/agents.catch44.co.il /etc/nginx/sites-enabled/agents.catch44.co.il
nginx -t
systemctl daemon-reload
systemctl enable agents44
systemctl restart agents44
systemctl reload nginx

echo "Install complete"
