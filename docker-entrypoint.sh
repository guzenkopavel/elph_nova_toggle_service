#!/bin/sh
set -e

echo "[entrypoint] Running database migrations..."
node_modules/.bin/tsx src/db/migrate.ts

echo "[entrypoint] Starting server..."
exec node dist/src/server.js
