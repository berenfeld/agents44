# Agents44 Workforce Platform

Generic platform to run and monitor AI agents at `agents.catch44.co.il`.

## Stack

- **Frontend**: React + Vite (English UI)
- **Backend**: Python Flask + SQLAlchemy + APScheduler
- **Database**: PostgreSQL (UTF-8)
- **Agents**: Claude CLI subprocess with embedded MCP tools
- **Deploy (production)**: nginx + systemd + GitHub Actions

## Environment

All configuration and secrets live in **one** dotenv file:

| Environment | Path |
|-------------|------|
| Local dev | `./.env` (repository root) |
| Production VM | `/opt/agents44/.env` |

Copy `.env.example` to that path and set values. `ANTHROPIC_API_KEY` is required for agent runs and for loading the model list at backend startup (via the Anthropic Models API). Put the key in the project `.env` file — Flask and `./start-dev.sh` read that file; `~/.bashrc` does not apply to the backend process. In a terminal, run `set -a && source .env && set +a` before `claude` commands if you want the CLI to see the key. `MCP_PORT` defaults to `5001` (embedded MCP server on localhost, separate from the Flask API on `5000`). Do not add `backend/.env`, `frontend/.env`, or `.env.local` files — the backend, Alembic, Vite dev server, `start-dev.sh`, and systemd all read the same root file.

## Local development

No nginx locally. `./start-dev.sh` runs:

- **Frontend**: `npm start` (Vite on port 3000 with HMR; proxies `/api` to Flask)
- **Backend**: `flask run` with auto-reload when `FLASK_DEBUG=1` in `.env`
- **Database**: Postgres via Docker Compose

Dev settings (`FLASK_ENV`, `FLASK_DEBUG`, `FLASK_RUN_HOST`, `FLASK_RUN_PORT`, `RUNTIME_DIR`) live in the root `.env` file. Leave them unset on the production VM.

```bash
cp .env.example .env
./start-dev.sh
```

Starts the stack and then tails `.dev/flask.log` and `.dev/frontend.log` (Ctrl+C stops tail only; services keep running). To tail logs again later: `./logs-dev.sh`.

- Frontend: http://localhost:3000
- API: http://localhost:5000/api
- Health: http://localhost:5000/api/health

Stop everything:

```bash
./stop-dev.sh
```

Tail Flask and frontend logs:

```bash
./logs-dev.sh
```

### Dev auth

- **Google OAuth**: set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and add emails to `ALLOWED_EMAILS` in `system_params`
- **Dev login**: set `DEV_LOGIN_EMAIL` (non-empty enables dev login; e.g. `admin@catch44.co.il`) and `DEV_LOGIN_PASSWORD` in the project `.env`. Leave `DEV_LOGIN_EMAIL` empty in production unless you need password-based dev access.

## Project layout

- `backend/` — Flask API, agent runner, MCP server
- `frontend/` — React operator UI (Agents, Agents Runs, Agent Files)
- `.workspace/` — local dev files tree (gitignored; production uses `/opt/agents44/workspace`)
- `scripts/` — local/CI helpers (`git-version.sh`)
- `deploy/scripts/install-server.sh` — idempotent VM infrastructure install
- `deploy/scripts/stop-*.sh` / `start-*.sh` — stop/start backend and nginx on the VM
- `deploy/systemd/agents44.service` — systemd unit (copied to `/etc/systemd/system/`)
- `deploy/nginx/agents.catch44.co.il.conf` — nginx site config

## VM setup (agents.catch44.co.il)

See **[README.deployment.md](README.deployment.md)** for full production deployment docs.

1. Ubuntu 24 VM with DNS `agents.catch44.co.il` pointing to the host
2. SCP `deploy/` and `.env.example`, then run `sudo bash deploy/scripts/install-server.sh`
3. Fill `/opt/agents44/.env` with production secrets
4. Configure GitHub Actions secrets and push to `main` to deploy software
5. TLS is configured automatically by `deploy/scripts/install-server.sh` (certbot + HTTPS redirect)

## GitHub Actions secrets

| Secret | Purpose |
|--------|---------|
| `DEPLOY_HOST` | VM hostname or IP |
| `DEPLOY_USER` | SSH user with write access to `/opt/agents44` |
| `DEPLOY_SSH_KEY` | Private SSH key |

## API overview

| Endpoint | Description |
|----------|-------------|
| `GET /api/departments` | List departments |
| `POST /api/departments` | Create department (creates workspace folders) |
| `DELETE /api/departments/{id}` | Delete department (fails if agents exist; keeps files) |
| `GET /api/agents` | List agents |
| `POST /api/agents` | Create agent |
| `POST /api/agents/{id}/trigger` | Manual run |
| `GET /api/runs` | Run history (tokens + cost) |
| `GET /api/models` | Supported Claude models |
| `GET/POST/PUT/DELETE /api/files` | Workspace file CRUD (files only) |

All mutating API calls use `Content-Type: application/json`.

## Workspace layout

Local dev uses `./.workspace` in the repository root (created by `./start-dev.sh`, gitignored). Production uses `/opt/agents44/workspace`.

```
.workspace/                 # local dev only (./.workspace)
├── common_input/           # included in every agent prompt
├── {department}/input/     # included for agents in that department
└── {agent_name}/
    ├── input/              # included for this agent only
    └── .runs/
        └── YYYYMMDD-HHMMSS-{run_id}/   # per-run folder (sortable newest-first)
            ├── prompt.txt              # full calculated agent input
            ├── log.txt                 # Claude CLI stdout/stderr
            └── summary.md              # agent-written run summary (required)
```

Departments are managed in the **Departments** tab (not hardcoded). Creating a department creates `{department}/` and `{department}/input/` in the workspace.

## system_params keys (CAPITAL_LETTERS)

- `ALLOWED_EMAILS` — JSON array of allowed Google emails
- `NOTIFY_ON` — `all` | `failures` | `none`
- `MODEL_PRICING` — per-model USD per 1M tokens for cost estimates
- `CLAUDE_CLI_ARGS` — JSON array of extra Claude CLI flags appended to every agent run (default enables web search/fetch)
- `TIMEOUT_SIGTERM_GRACE_SECONDS` — seconds after an agent's configured timeout before SIGTERM (default 300)
- `TIMEOUT_SIGKILL_GRACE_SECONDS` — seconds after an agent's configured timeout before SIGKILL (default 600)
