#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/opt/ai-coding-system"
DEFAULT_WORKDIR="${AI_SYSTEM_WORKDIR:-/workspace}"
SERVER_MODE="${AI_SYSTEM_SERVER_MODE:-false}"

# The image ships compiled JavaScript; the TypeScript toolchain is not present
# in the runtime stage.
SERVER_ENTRY="${APP_ROOT}/dist/ai-system/server.js"
CLI_ENTRY="${APP_ROOT}/dist/ai-system/cli.js"

run_server() {
  # exec keeps the server as tini's direct child, so SIGTERM reaches its
  # shutdown handler instead of terminating this shell.
  exec node "${SERVER_ENTRY}"
}

if [[ $# -eq 0 ]]; then
  if [[ -n "${PORT:-}" || "${SERVER_MODE}" == "true" ]]; then
    run_server
  fi

  exec node "${CLI_ENTRY}" --help
fi

if [[ "${1}" == "server" ]]; then
  run_server
fi

if [[ "${1}" == "--help" || "${1}" == "-h" ]]; then
  exec node "${CLI_ENTRY}" "$@"
fi

if [[ "${1}" == "--cwd" ]]; then
  exec node "${CLI_ENTRY}" "$@"
fi

exec node "${CLI_ENTRY}" --cwd "${DEFAULT_WORKDIR}" "$@"
