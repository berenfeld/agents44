#!/bin/bash
# Stop an Agents44 container started by lightsail-start.sh.
# Usage: lightsail-stop.sh <name>
#   Volumes are kept (Postgres/workspace/logs/runtime).
set -euo pipefail

NAME="${1:-}"

if [ -z "$NAME" ]; then
  echo "Usage: $0 <name>" >&2
  echo "  Example: $0 tase44" >&2
  exit 1
fi

if ! [[ "$NAME" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]]; then
  echo "Invalid name: use letters, numbers, _ or - (must start alphanumeric)" >&2
  exit 1
fi

CONTAINER="agents44-${NAME}"

if ! docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "No container named ${CONTAINER}"
  exit 0
fi

echo "Stopping ${CONTAINER}..."
docker stop "$CONTAINER" >/dev/null
docker rm "$CONTAINER" >/dev/null
echo "Stopped and removed ${CONTAINER} (volumes kept: agents44_${NAME}_*)"
echo "Start again / upgrade: ./lightsail-start.sh ${NAME}"
