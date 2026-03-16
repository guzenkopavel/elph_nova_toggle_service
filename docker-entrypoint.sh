#!/bin/sh
set -e

echo "[entrypoint] Running database migrations..."
node dist/src/db/migrate.js

echo "[entrypoint] Starting server..."
exec node dist/src/server.js
