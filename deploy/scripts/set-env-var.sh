#!/usr/bin/env bash
# Set or update a single KEY=VALUE in a dotenv file.
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 FILE KEY VALUE" >&2
  exit 1
fi

FILE="$1"
KEY="$2"
VALUE="$3"

touch "$FILE"

if grep -q "^${KEY}=" "$FILE"; then
  sed -i "s|^${KEY}=.*|${KEY}=${VALUE}|" "$FILE"
else
  printf '%s=%s\n' "$KEY" "$VALUE" >> "$FILE"
fi
