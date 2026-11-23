#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${DATA_DIR:-/app/data}"
export DB_PATH="${DATA_DIR}/jobs.db"
export INTERNAL_SYNC_SECRET="${INTERNAL_SYNC_SECRET:-jobops-internal-d1-sync}"

mkdir -p "${DATA_DIR}/pdfs" "${DATA_DIR}/cloudflare-cookies"

cd /app/orchestrator

echo "[entrypoint] Running database migrations..."
npx tsx src/server/db/migrate.ts

echo "[entrypoint] Starting orchestrator..."
exec npm run start
