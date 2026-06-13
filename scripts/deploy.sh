#!/usr/bin/env bash
# Deploy TOTO WC-2026 on the VPS. Run from /opt/toto as the deploy user.
# Prerequisites (one-time): see DEPLOY.md (DNS A-record, /opt/toto/.env, BotFather).
set -euo pipefail

# Use the classic builder path (no buildx/bake dependency, no extra Hub frontend pull).
export COMPOSE_BAKE=false
export DOCKER_BUILDKIT=1

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -f .env ]; then
  echo "ERROR: .env not found in $(pwd). Create it first (see DEPLOY.md)." >&2
  exit 1
fi

DOMAIN="${DOMAIN:-toto.icywhitephosphor.tech}"

echo "==> git pull"
git pull --ff-only origin main

echo "==> build images (GIT_SHA cache-bust so new source always ships)"
docker compose build --build-arg GIT_SHA="$(git rev-parse HEAD)"

echo "==> up db + caddy + run migrate/seed (ordering)"
docker compose up -d

echo "==> force-recreate app + worker onto the freshly built image"
# Without --force-recreate, compose may keep the old container even after a rebuild.
docker compose up -d --force-recreate --no-deps app worker

echo "==> reload caddy config (graceful; applies Caddyfile changes without dropping connections)"
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile || true

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
