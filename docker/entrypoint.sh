#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/opt/ai-coding-system"
DEFAULT_WORKDIR="${AI_SYSTEM_WORKDIR:-/workspace}"
SERVER_MODE="${AI_SYSTEM_SERVER_MODE:-false}"

run_server() {
  exec node "${APP_ROOT}/ai-system/server.js"
}

if [[ $# -eq 0 ]]; then
  if [[ -n "${PORT:-}" || "${SERVER_MODE}" == "true" ]]; then
    run_server
  fi

  exec node "${APP_ROOT}/ai-system/cli.js" --help
fi

if [[ "${1}" == "server" ]]; then
  run_server
fi

if [[ "${1}" == "--help" || "${1}" == "-h" ]]; then
  exec node "${APP_ROOT}/ai-system/cli.js" "$@"
fi

if [[ "${1}" == "--cwd" ]]; then
  exec node "${APP_ROOT}/ai-system/cli.js" "$@"
fi

exec node "${APP_ROOT}/ai-system/cli.js" --cwd "${DEFAULT_WORKDIR}" "$@"
