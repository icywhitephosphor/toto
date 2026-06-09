#!/usr/bin/env bash
# Deploy TOTO WC-2026 on the VPS. Run from /opt/toto as the deploy user.
# Prerequisites (one-time): see DEPLOY.md (DNS A-record, /opt/toto/.env, BotFather).
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -f .env ]; then
  echo "ERROR: .env not found in $(pwd). Create it first (see DEPLOY.md)." >&2
  exit 1
fi

DOMAIN="${DOMAIN:-toto.icywhitephosphor.tech}"

echo "==> git pull"
git pull --ff-only origin main

echo "==> build images"
docker compose build

echo "==> up (db -> migrate+seed -> app -> worker -> caddy)"
# The one-shot 'migrate' service applies migrations + seed before app/worker start.
docker compose up -d

echo "==> status"
docker compose ps

echo "==> waiting for HTTPS health (Caddy may need a moment for the first certificate)"
for i in $(seq 1 30); do
  if curl -fsS "https://${DOMAIN}/api/health" >/dev/null 2>&1; then
    echo "OK: https://${DOMAIN}/api/health is healthy"
    exit 0
  fi
  sleep 3
done

echo "WARN: HTTPS health not green yet. Recent app logs:" >&2
docker compose logs --tail=60 app caddy
exit 1
