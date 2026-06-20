# Deployment — agents.catch44.co.il

Production VM for the Agents44 platform. **Infrastructure** is installed once via `deploy/scripts/install-server.sh`; **application code** is deployed by GitHub Actions on every push to `main`.

## Server

| Item | Value |
|------|-------|
| Hostname | `agents.catch44.co.il` |
| IP | `51.102.214.244` |
| OS | Ubuntu 24.04 LTS |
| SSH user | `ubuntu` |
| SSH key (admin) | `~/.ssh/catch44.co.il-access` |
| App root | `/opt/agents44` |
| Workspace | `/opt/agents44/workspace` |
| Service user | `agents44` |
| Backend unit | `agents44.service` |
| TLS | Let's Encrypt via certbot |

## What runs where

| Layer | Managed by | Location |
|-------|------------|----------|
| PostgreSQL, nginx, systemd, certbot, Claude CLI | `deploy/scripts/install-server.sh` | system packages + `/etc/` |
| systemd unit template | repo | `deploy/systemd/agents44.service` → `/etc/systemd/system/` |
| nginx site template | repo | `deploy/nginx/agents.catch44.co.il.conf` → `/etc/nginx/sites-available/` |
| Python venv, pip deps, DB migrations, frontend build | GitHub Actions (zip packages + `deploy/scripts/`) | `/opt/agents44/` |
| Secrets & config | manual (once) | `/opt/agents44/.env` |

## First-time infrastructure setup

Only the bootstrap files are copied to the VM — **not** the full repository:

```bash
BOOT=/tmp/agents44-install
HOST=ubuntu@agents.catch44.co.il
KEY=~/.ssh/catch44.co.il-access

ssh -i "$KEY" "$HOST" "mkdir -p $BOOT"
scp -i "$KEY" -r deploy/ "$HOST:$BOOT/"
scp -i "$KEY" .env.example "$HOST:$BOOT/"

ssh -i "$KEY" "$HOST" "chmod +x $BOOT/deploy/scripts/install-server.sh && sudo bash $BOOT/deploy/scripts/install-server.sh"
```

The script is **idempotent** — safe to re-run after changing `deploy/` configs or the install script itself.

### What the install script does

- Installs: PostgreSQL, nginx, Python 3, certbot, curl, unzip
- Installs Claude CLI for the `agents44` service user
- Creates `agents44` system user, `/opt/agents44`, `/opt/agents44/workspace`
- Creates PostgreSQL role/database from `PSQL_*` vars in `.env` (via `sync-psql-password.sh`)
- Adds the SSH deploy user (`ubuntu`) to the `agents44` group for rsync writes
- Copies deploy configs into `/opt/agents44/deploy/` and installs them to `/etc/`
- Obtains TLS certificate via certbot (webroot) and configures nginx for HTTPS-only with HTTP→HTTPS redirect
- Creates `/opt/agents44/.env` from `.env.example` if missing
- Enables `postgresql`, `nginx`, `agents44` systemd units
- Does **not** install Python packages, run migrations, or deploy frontend/backend code

### TLS

Handled automatically by `deploy/scripts/install-server.sh`:

1. Serves a temporary HTTP-only nginx config for ACME challenges
2. Runs `certbot certonly --webroot` to obtain a Let's Encrypt certificate
3. Installs the HTTPS nginx config (`deploy/nginx/agents.catch44.co.il.conf`) with HTTP→HTTPS redirect

Certbot auto-renewal uses the same webroot path (`/var/www/certbot`); the HTTP server block keeps `/.well-known/acme-challenge/` open for renewals.

## Production `.env`

Edit `/opt/agents44/.env` on the server **before the first app deploy** (rsync will never overwrite this file):

```bash
ssh -i "$KEY" "$HOST" 'sudo -u agents44 nano /opt/agents44/.env'
```

Required production settings (remove all dev-only keys):

```dotenv
PSQL_HOST=localhost
PSQL_PORT=5432
PSQL_DB=agents44
PSQL_USER=agents44
PSQL_PASSWORD=<random-password>
FLASK_SECRET_KEY=<random-secret>
WORKSPACE_PATH=/opt/agents44/workspace
RUNTIME_DIR=/opt/agents44/runtime
LOG_DIR=/opt/agents44/logs
FRONTEND_URL=https://agents.catch44.co.il
OAUTH_REDIRECT_URI=https://agents.catch44.co.il/api/auth/callback

ANTHROPIC_API_KEY=<key>
GOOGLE_CLIENT_ID=<id>
GOOGLE_CLIENT_SECRET=<secret>
SMTP_APP_PASSWORD=<app-password>
```

Do **not** set `FLASK_ENV`, `FLASK_DEBUG`, `FLASK_RUN_HOST`, or `FLASK_RUN_PORT` on production.

After changing `PSQL_PASSWORD` in `.env`, sync it to PostgreSQL:

```bash
ssh -i "$KEY" "$HOST" 'sudo bash /opt/agents44/deploy/scripts/sync-psql-password.sh'
```

Also add `https://agents.catch44.co.il/api/auth/callback` as an authorized redirect URI in Google Cloud Console.

## GitHub Actions deploy

Workflow: `.github/workflows/deploy.yml` — triggers on push to `main`.

### Repository secrets

| Secret | Value |
|--------|-------|
| `DEPLOY_HOST` | `agents.catch44.co.il` |
| `DEPLOY_USER` | `ubuntu` |
| `DEPLOY_SSH_KEY` | Private key with SSH access to the VM (paste full PEM contents) |

### Deploy steps (automatic)

1. **Build** — `npm ci`, lint, `npm run build`; zip `frontend/dist` → `dist/frontend.zip`; zip `backend/` → `dist/backend.zip`
2. **Upload** — SCP `frontend.zip`, `backend.zip`, and full `deploy/` to `/tmp/agents44-deploy/`
3. **Stop** — `stop-backend.sh`, then `stop-frontend.sh`
4. **Install deploy** — sync `deploy/` to `/opt/agents44/deploy/`
5. **Deploy frontend** — unzip `frontend.zip` → `/opt/agents44/frontend/dist`
6. **Deploy backend** — unzip `backend.zip` → `/opt/agents44/backend`
7. **Start** — `start-backend.sh`, then `start-frontend.sh`

Server state **not** touched by deploy: `/opt/agents44/.env`, `/opt/agents44/venv/`, `/opt/agents44/runtime/`, `/opt/agents44/workspace/`, `/opt/agents44/logs/`.

### Manual deploy trigger

Push to `main`, or re-run the **Deploy** workflow from the GitHub Actions tab.

## Operations

### Service status

```bash
ssh -i "$KEY" "$HOST" 'systemctl status agents44 nginx postgresql'
```

### Logs

Backend logs are written to `/opt/agents44/logs/`:

| File | Source |
|------|--------|
| `error.log` | Gunicorn + all app stderr (API req/res, errors, tracebacks) |
| `access.log` | Gunicorn HTTP access |

```bash
ssh -i "$KEY" "$HOST" 'bash /opt/agents44/deploy/scripts/logs-prod.sh'
ssh -i "$KEY" "$HOST" 'bash /opt/agents44/deploy/scripts/logs-prod.sh -f'
ssh -i "$KEY" "$HOST" 'bash /opt/agents44/deploy/scripts/logs-prod.sh -n 200'
```

### Stop / start services

Scripts live on the VM at `/opt/agents44/deploy/scripts/` (updated on each deploy):

```bash
ssh -i "$KEY" "$HOST" 'sudo bash /opt/agents44/deploy/scripts/stop-backend.sh'
ssh -i "$KEY" "$HOST" 'sudo bash /opt/agents44/deploy/scripts/start-backend.sh'
ssh -i "$KEY" "$HOST" 'sudo bash /opt/agents44/deploy/scripts/stop-frontend.sh'
ssh -i "$KEY" "$HOST" 'sudo bash /opt/agents44/deploy/scripts/start-frontend.sh'
```

| Script | Action |
|--------|--------|
| `stop-backend.sh` | stop `agents44` systemd unit |
| `start-backend.sh` | pip install, migrate, start `agents44` |
| `stop-frontend.sh` | stop nginx |
| `start-frontend.sh` | start/reload nginx |

### Restart after config change

```bash
ssh -i "$KEY" "$HOST" 'sudo systemctl restart agents44'
```

### Re-apply infrastructure (nginx/systemd/package updates)

Re-scp bootstrap files and re-run install script (see above). Or after a code deploy, from the server:

```bash
sudo bash /opt/agents44/deploy/scripts/install-server.sh
```

### Database

```bash
ssh -i "$KEY" "$HOST" 'sudo -u postgres psql -d agents44'
```

## Current status

| Component | Status |
|-----------|--------|
| PostgreSQL | installed, running |
| nginx | installed, running, TLS enabled |
| agents44.service | enabled; starts after first GitHub deploy |
| Application code | awaiting first push to `main` with secrets configured |
| `/opt/agents44/.env` | created from template — **secrets must be filled in** |

## URLs

| URL | Purpose |
|-----|---------|
| https://agents.catch44.co.il | Frontend UI |
| https://agents.catch44.co.il/api/health | API health check |
| https://agents.catch44.co.il/api/auth/callback | Google OAuth callback |
