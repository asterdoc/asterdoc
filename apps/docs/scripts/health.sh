#!/usr/bin/env bash
# Check the public Worker health contract.

set -uo pipefail

URL="${ASTERDOC_DOCS_URL:-https://docs.asterdoc.com}/api/health"
body=$(curl -fsS --max-time 10 "$URL" 2>/dev/null) || {
  echo "❌ docs: ${URL} (unreachable)"
  exit 1
}

if [[ "$body" == *'"status":"ok"'* ]]; then
  echo "✅ docs: ${URL}"
  exit 0
fi

echo "❌ docs: ${URL} (unhealthy response)"
exit 1
