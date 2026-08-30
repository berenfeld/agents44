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
# Playwright for agents (Python). Pin matches Chromium baked in the runtime stage.
# Bump both together. Agents using their own venv should pip-install this same version.
RUN --mount=type=cache,target=/root/.cache/pip \
    /opt/agents44/venv/bin/pip install playwright==1.62.0

# --- runtime: nginx + gunicorn + postgres in one image ---
FROM base AS runtime
ENV PGDATA=/var/lib/psql/data \
    PATH=/root/.local/bin:/opt/agents44/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    IS_SANDBOX=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Heavy OS packages + Claude CLI — must not depend on APP_VERSION.
# python3.12-venv + pip: agents create their own venvs (`ensurepip` is skipped without them).
# Playwright Ubuntu 24.04 (noble-x64) OS deps — exact lists from
# https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/registry/nativeDeps.ts
# (tools + chromium + firefox + webkit). Agents can `playwright install` any browser
# without `playwright install-deps`.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        nginx \
        postgresql-common \
        python3 \
        python3-pip \
        python3-venv \
        python3.12-venv \
        tini \
        unzip \
        xz-utils \
        xvfb \
        fonts-freefont-ttf \
        fonts-ipafont-gothic \
        fonts-liberation \
        fonts-noto-color-emoji \
        fonts-tlwg-loma-otf \
        fonts-unifont \
        fonts-wqy-zenhei \
        libfontconfig1 \
        libfreetype6 \
        xfonts-cyrillic \
        xfonts-scalable \
        libasound2t64 \
        libatk-bridge2.0-0t64 \
        libatk1.0-0t64 \
        libatspi2.0-0t64 \
        libcairo2 \
        libcups2t64 \
        libdbus-1-3 \
        libdrm2 \
        libgbm1 \
        libglib2.0-0t64 \
        libnspr4 \
        libnss3 \
        libpango-1.0-0 \
        libx11-6 \
        libxcb1 \
        libxcomposite1 \
        libxdamage1 \
        libxext6 \
        libxfixes3 \
        libxkbcommon0 \
        libxrandr2 \
        libavcodec60 \
        libcairo-gobject2 \
        libgdk-pixbuf-2.0-0 \
        libgtk-3-0t64 \
        libpangocairo-1.0-0 \
        libx11-xcb1 \
        libxcb-shm0 \
        libxcursor1 \
        libxi6 \
        libxrender1 \
        gstreamer1.0-libav \
        gstreamer1.0-plugins-bad \
        gstreamer1.0-plugins-base \
        gstreamer1.0-plugins-good \
        libatomic1 \
        libavif16 \
        libenchant-2-2 \
        libepoxy0 \
        libevent-2.1-7t64 \
        libflite1 \
        libgles2 \
        libgstreamer-gl1.0-0 \
        libgstreamer-plugins-bad1.0-0 \
        libgstreamer-plugins-base1.0-0 \
        libgstreamer1.0-0 \
        libgtk-4-1 \
        libharfbuzz-icu0 \
        libharfbuzz0b \
        libhyphen0 \
        libicu74 \
        libjpeg-turbo8 \
        liblcms2-2 \
        libmanette-0.2-0 \
        libopus0 \
        libpng16-16t64 \
        libsecret-1-0 \
        libvpx9 \
        libwayland-client0 \
        libwayland-egl1 \
        libwayland-server0 \
        libwebp7 \
        libwebpdemux2 \
        libwoff1 \
        libx264-164 \
        libxml2 \
        libxslt1.1 \
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
# Chromium for Python Playwright (PLAYWRIGHT_BROWSERS_PATH). Version-locked to
# playwright==1.62.0 in python-deps. Agent venvs with that version reuse this tree.
RUN mkdir -p /ms-playwright \
    && /opt/agents44/venv/bin/playwright install chromium \
    && chmod -R 755 /ms-playwright
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
