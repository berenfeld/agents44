#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root or with sudo"
  exit 1
fi

systemctl stop agents44 2>/dev/null || true
echo "agents44 stopped"
