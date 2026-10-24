#!/usr/bin/env bash
# Runs on the EC2 host from inside an extracted release directory.
# Installs deps, runs migrations, switches traffic, health-checks, and rolls back on failure.
# Usage: deploy.sh <release-id>
set -euo pipefail

APP_NAME="teleconsultation"
APP_DIR="$HOME/$APP_NAME"
RELEASE="$1"
RELEASE_DIR="$APP_DIR/releases/$RELEASE"
CURRENT_LINK="$APP_DIR/current"
KEEP_RELEASES=5

cd "$RELEASE_DIR"
ln -sf "$APP_DIR/shared/.env" .env

PORT="$(grep -E '^PORT=' .env | cut -d= -f2- | tr -d '"' || true)"
PORT="${PORT:-8082}"

echo "==> Installing dependencies"
npm ci --no-audit --no-fund

echo "==> Running database migrations"
npx prisma migrate deploy

echo "==> Pruning dev dependencies"
npm prune --omit=dev --no-audit --no-fund

PREVIOUS="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"

start_app() {
  ln -sfn "$1" "$CURRENT_LINK"
  pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
  pm2 start "$1/ecosystem.config.cjs" --env production
  pm2 save
}

healthy() {
  for _ in $(seq 1 15); do
    if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

echo "==> Starting release $RELEASE"
start_app "$RELEASE_DIR"

if healthy; then
  echo "==> Health check passed"
else
  echo "!! Health check failed, recent logs:"
  pm2 logs "$APP_NAME" --lines 50 --nostream || true
  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ]; then
    echo "!! Rolling back to $(basename "$PREVIOUS")"
    start_app "$PREVIOUS"
  fi
  exit 1
fi

echo "==> Removing old releases (keeping $KEEP_RELEASES)"
cd "$APP_DIR/releases"
ls -1t | tail -n +"$((KEEP_RELEASES + 1))" | xargs -r rm -rf
