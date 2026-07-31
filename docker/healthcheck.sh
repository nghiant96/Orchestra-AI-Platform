#!/usr/bin/env bash
set -euo pipefail

# Only server mode has a port worth probing. In CLI mode the container is a
# short-lived command, so report healthy rather than failing a container that
# was never meant to listen.
if [[ -z "${PORT:-}" && "${AI_SYSTEM_SERVER_MODE:-false}" != "true" ]]; then
  exit 0
fi

PORT="${PORT:-3927}"
URL="http://127.0.0.1:${PORT}/health"

# /health sits behind auth, so send the server token when one is configured.
# Any answer other than a transport failure means the process is up and
# serving — 401 still proves liveness.
if [[ -n "${AI_SYSTEM_SERVER_TOKEN:-}" ]]; then
  status=$(curl --silent --show-error --max-time 4 --output /dev/null --write-out '%{http_code}' \
    --header "Authorization: Bearer ${AI_SYSTEM_SERVER_TOKEN}" "${URL}")
else
  status=$(curl --silent --show-error --max-time 4 --output /dev/null --write-out '%{http_code}' "${URL}")
fi

if [[ "${status}" == "200" ]]; then
  exit 0
fi

echo "health probe returned HTTP ${status}" >&2
exit 1
