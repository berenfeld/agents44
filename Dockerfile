# syntax=docker/dockerfile:1.7
# Single-image Agents44 stack on Ubuntu 24.04 (same as local/dev).
# Users: root (frontend/npm + Python venv/gunicorn/nginx), psql (PostgreSQL).
#
# Layer order (stable → volatile) so code commits only rebuild late layers:
#   1) OS / Node / Python tooling
#   2) dependency manifests (package-lock, requirements.txt)
#   3) installed deps (npm ci, pip)
#   4) app source / frontend build / runtime COPY of code
#   5) APP_VERSION (changes every CI commit) — must stay last
#
# APP_VERSION is declared globally, then re-declared only in stages that need it.
# Docker does not carry ARG across FROM boundaries.

ARG APP_VERSION=dev

FROM ubuntu:24.04 AS base
SHELL ["/bin/bash", "-c"]
ENV DEBIAN_FRONTEND=noninteractive \
    LANG=en_US.UTF-8 \
    LC_ALL=en_US.UTF-8 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        locales \
    && locale-gen en_US.UTF-8 \
    && rm -rf /var/lib/apt/lists/*

# --- frontend: root + npm (Node 22, matching local) ---
FROM base AS frontend-deps
ARG NODE_MAJOR=22
RUN apt-get update \
    && apt-get install -y --no-install-recommends gnupg \
    && curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/agents44/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

FROM frontend-deps AS frontend-build
# Copy source before APP_VERSION so version bumps do not invalidate the COPY cache.
COPY frontend/ ./
ARG APP_VERSION
ENV REACT_APP_API_URL=/api \
    REACT_APP_VERSION=${APP_VERSION}
RUN npm run validate \
    && npm run build

# --- backend: root + Python venv ---
FROM base AS python-deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-venv \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/agents44
RUN python3 -m venv /opt/agents44/venv
COPY backend/requirements.txt /opt/agents44/backend/requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    /opt/agents44/venv/bin/pip install --upgrade pip \
    && /opt/agents44/venv/bin/pip install -r /opt/agents44/backend/requirements.txt

# --- runtime: nginx + gunicorn + postgres in one image ---
FROM base AS runtime
ENV PGDATA=/var/lib/psql/data \
    PATH=/root/.local/bin:/opt/agents44/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Heavy OS packages + Claude CLI — must not depend on APP_VERSION
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        nginx \
        postgresql-common \
        python3 \
        python3-venv \
        tini \
        unzip \
        xz-utils \
    && sed -ri 's/^#?create_main_cluster.*/create_main_cluster = false/' /etc/postgresql-common/createcluster.conf \
    && apt-get install -y --no-install-recommends postgresql postgresql-contrib \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default \
    && groupadd --system psql \
    && useradd --system --gid psql --home-dir /var/lib/psql --create-home --shell /bin/bash psql \
    && mkdir -p /var/lib/psql/data /var/run/postgresql \
    && chown -R psql:psql /var/lib/psql /var/run/postgresql \
    && chmod 775 /var/run/postgresql \
    && curl -fsSL https://claude.ai/install.sh | bash \
    && command -v claude

# Dependency artifacts (change only when lockfiles / requirements change)
COPY --from=python-deps /opt/agents44/venv /opt/agents44/venv
COPY --from=frontend-build /opt/agents44/frontend/dist /opt/agents44/frontend/dist

# App code + container config (change on most commits — keep late)
COPY backend/app /opt/agents44/backend/app
COPY backend/alembic /opt/agents44/backend/alembic
COPY backend/alembic.ini /opt/agents44/backend/alembic.ini
COPY backend/wsgi.py /opt/agents44/backend/wsgi.py
COPY backend/scripts /opt/agents44/backend/scripts
COPY backend/requirements.txt /opt/agents44/backend/requirements.txt
COPY docker /opt/agents44/docker
COPY docker/nginx.conf /etc/nginx/nginx.conf

RUN chmod +x /opt/agents44/docker/entrypoint.sh \
    && mkdir -p /opt/agents44/workspace/common_input /opt/agents44/runtime /opt/agents44/logs

# Version last: CI changes this every push; only these tiny layers rebuild.
ARG APP_VERSION
ENV APP_VERSION=${APP_VERSION} \
    REACT_APP_VERSION=${APP_VERSION}

WORKDIR /opt/agents44
EXPOSE 80
VOLUME ["/var/lib/psql/data", "/opt/agents44/workspace", "/opt/agents44/logs", "/opt/agents44/runtime"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
    CMD curl -fsS http://127.0.0.1/api/health || exit 1
STOPSIGNAL SIGTERM
# tini is PID 1 (reaps zombies / forwards signals) — not a shell.
# The app entrypoint always runs under bash.
ENTRYPOINT ["/usr/bin/tini", "--", "/bin/bash", "/opt/agents44/docker/entrypoint.sh"]
