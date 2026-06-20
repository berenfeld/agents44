#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root or with sudo"
  exit 1
fi

nginx -t
systemctl start nginx 2>/dev/null || systemctl reload nginx

if ! systemctl is-active --quiet nginx; then
  echo "ERROR: nginx failed to start"
  exit 1
fi

echo "nginx is active"
