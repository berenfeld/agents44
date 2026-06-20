#!/usr/bin/env bash
# Production backend logs in /opt/agents44/logs.
# Usage: logs-prod.sh [-f] [-n LINES]
set -euo pipefail

APP_DIR="/opt/agents44"
LOG_DIR="$APP_DIR/logs"
LINES=100
FOLLOW=0

usage() {
  echo "Usage: $0 [-f] [-n LINES]"
  echo "  -f         Follow log output (tail -f)"
  echo "  -n LINES   Number of recent lines to show (default: 100)"
  exit "${1:-0}"
}

while getopts "fn:h" opt; do
  case "$opt" in
    f) FOLLOW=1 ;;
    n) LINES="$OPTARG" ;;
    h) usage 0 ;;
    *) usage 1 ;;
  esac
done

shopt -s nullglob
log_files=("$LOG_DIR"/*.log)

if [ ${#log_files[@]} -eq 0 ]; then
  echo "No log files in $LOG_DIR"
  exit 1
fi

echo "Logs: ${log_files[*]}"

if [ "$FOLLOW" -eq 1 ]; then
  echo "Following backend logs (Ctrl+C to stop)..."
  exec tail -f "${log_files[@]}"
fi

tail -n "$LINES" "${log_files[@]}"
