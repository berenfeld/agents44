# Agents44 Workforce Platform

Generic platform to run and monitor AI agents at `agents.catch44.co.il`.

## Stack

- **Frontend**: React + Vite (English UI)
- **Backend**: Python Flask + SQLAlchemy + APScheduler
- **Database**: PostgreSQL (UTF-8)
- **Agents**: Claude CLI subprocess with embedded MCP tools
- **Runtime**: one Ubuntu 24.04 Docker image (nginx + Flask + PostgreSQL) — same image locally and on AWS/ECR

## Environment

All configuration and secrets live in **one** dotenv file:

| Environment | Path |
|-------------|------|
| Local / Docker | `./.env` mounted at `/opt/agents44/.env` |

Copy `.env.example` to `./.env` and set values. `ANTHROPIC_API_KEY` is required for agent runs and for loading the model list at backend startup. Do not add `backend/.env`, `frontend/.env`, or `.env.local` files.

## Run (local = same image as AWS)

```bash
cp .env.example .env   # once; set ANTHROPIC_API_KEY and secrets
./start-dev.sh
```

That builds the Dockerfile image and starts it with Docker Compose. No host `npm` / `pip` / venv.

- UI: http://localhost/
- API: http://localhost/api
- Health: http://localhost/api/health

```bash
./logs-dev.sh    # container logs
./stop-dev.sh    # docker compose down
```

Or equivalently: `docker compose up --build`.

### Dev auth

- **Google Sign-In**: set `GOOGLE_CLIENT_ID` and add emails to `ALLOWED_EMAILS` in `system_params`
- **Dev login**: set `DEV_LOGIN_EMAIL` and `DEV_LOGIN_PASSWORD` in `.env`

## Project layout

- `backend/` — Flask API, agent runner, MCP server
- `frontend/` — React operator UI
- `Dockerfile` / `docker/` / `docker-compose.yml` — single runtime image
- `.workspace/` — workspace files (bind-mounted into the container)
- `scripts/git-version.sh` — `1.0.<commit-count>.<git-hash>`

## Deploy to AWS

See **[README.deployment.md](README.deployment.md)**. Coding conventions for agents: **[README.coding-guidelines.md](README.coding-guidelines.md)**.

GitHub Actions builds the same image on every push to `main` and pushes to Amazon ECR.

## GitHub Actions secrets

| Secret | Purpose |
|--------|---------|
| `AGENTS44_AWS_ACCESS_KEY_ID` | IAM user access key with ECR push permissions |
| `AGENTS44_AWS_SECRET_ACCESS_KEY` | IAM user secret key |
| `AGENTS44_AWS_REGION` | Optional; defaults to `eu-central-1` |
| `AGENTS44_ECR_REPOSITORY` | Repository name (`agents44`) or full URI |

## API overview

| Endpoint | Description |
|----------|-------------|
| `GET /api/departments` | List departments |
| `POST /api/departments` | Create department (creates workspace folders) |
| `DELETE /api/departments/{id}` | Delete department (fails if agents exist; keeps files) |
| `POST /api/departments/{id}/email` | Provision Gmail sending (address + Google app password) |
| `DELETE /api/departments/{id}/email` | Remove email sending (messages are kept) |
| `GET /api/agents` | List agents |
| `POST /api/agents` | Create agent |
| `POST /api/agents/{id}/trigger` | Manual run |
| `GET /api/runs` | Run history (tokens + cost) |
| `GET /api/models` | Supported Claude models |
| `GET /api/claude/conversations` | List Claude chat tabs (`?archived=true` for archived) |
| `POST /api/claude/conversations` | Create a chat tab |
| `POST /api/claude/conversations/{id}/messages` | Send a prompt in a tab |
| `POST /api/claude/conversations/{id}/archive` | Hide a tab (messages stay in the database) |
| `GET /api/whatsapp/conversations` | Operator WhatsApp inbox |
| `GET /api/emails` | Operator email log (`?agent_id=&address=&subject=&content=`) |
| `PATCH /api/emails/{id}` | Edit a stored email or set `sending_status` (`pending` / `canceled` / `sent` / `fail`) |
| `GET/POST/PUT/DELETE /api/files` | Workspace file CRUD (files only) |

All mutating API calls use `Content-Type: application/json`.

## Workspace layout

```
.workspace/                 # bind-mounted into the container
├── common_input/           # included in every agent prompt
└── {department}/
    ├── input/             # included for every agent in that department
    └── {agent_name}/
        ├── input/
        │   └── MEMORY.md   # created per agent; included in every prompt; write_memory MCP tool
        └── .runs/
            └── YYYYMMDD-HHMMSS-{run_id}/
                ├── prompt.txt
                ├── log.txt
                └── summary.md
```

## system_params keys (CAPITAL_LETTERS)

- `ALLOWED_EMAILS` — JSON array of allowed Google emails
- `NOTIFY_ON` — `all` | `failures` | `none`
- `MODEL_PRICING` — per-model USD per 1M tokens for cost estimates
- `CLAUDE_CLI_ARGS` — JSON array of extra Claude CLI flags
- `TIMEOUT_SIGTERM_GRACE_SECONDS` — seconds after timeout before SIGTERM (default 300)
- `TIMEOUT_SIGKILL_GRACE_SECONDS` — seconds after timeout before SIGKILL (default 600)
- `EMAIL_SEND_INTERVAL_SECONDS` — how often pending agent emails are retried (default 300)
- `EMAIL_SEND_GIVE_UP_SECONDS` — when a still-pending email is marked `fail` (default 86400)

MCP email tools (`send_email`, `list_emails`) require the agent's department to be provisioned with a Gmail address and Google app password (`POST /api/departments/{id}/email`). Every queued message is stored in `system_email_messages` (agents cannot read that table). The backend sends on a timer and immediately when a new message is queued.
