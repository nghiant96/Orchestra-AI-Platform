#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/opt/ai-coding-system"
DEFAULT_WORKDIR="${AI_SYSTEM_WORKDIR:-/workspace}"
SERVER_MODE="${AI_SYSTEM_SERVER_MODE:-false}"

run_server() {
  exec node --import tsx "${APP_ROOT}/ai-system/server.ts"
}

if [[ $# -eq 0 ]]; then
  if [[ -n "${PORT:-}" || "${SERVER_MODE}" == "true" ]]; then
    run_server
  fi

  exec node --import tsx "${APP_ROOT}/ai-system/cli.ts" --help
fi

if [[ "${1}" == "server" ]]; then
  run_server
fi

if [[ "${1}" == "--help" || "${1}" == "-h" ]]; then
  exec node --import tsx "${APP_ROOT}/ai-system/cli.ts" "$@"
fi

if [[ "${1}" == "--cwd" ]]; then
  exec node --import tsx "${APP_ROOT}/ai-system/cli.ts" "$@"
fi

exec node --import tsx "${APP_ROOT}/ai-system/cli.ts" --cwd "${DEFAULT_WORKDIR}" "$@"
