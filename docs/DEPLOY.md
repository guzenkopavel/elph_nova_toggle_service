# Deployment Guide

## Overview

The service is packaged as a Docker image with PostgreSQL as the database.
`docker-entrypoint.sh` runs DB migrations automatically on every container start,
so updates are applied without any manual steps.

---

## Quick Start (on your server)

### 1. Prerequisites on the server
- Docker ≥ 24 and Docker Compose v2 (`docker compose` command)
- Git (to pull updates)
- Open port 3000 (or whichever port you configure)

### 2. Clone the repo

```sh
git clone https://github.com/your-org/elph_nova_toggle_service.git
cd elph_nova_toggle_service
```

### 3. Configure environment

```sh
cp .env.example .env
```

Edit `.env` — the minimum required values:

```env
POSTGRES_PASSWORD=<strong random password>
ADMIN_COOKIE_SECRET=<output of: openssl rand -hex 32>
CORS_ALLOWED_ORIGINS=none   # or your client origins
```

### 4. Start

```sh
docker compose up -d
```

The app will be available at `http://your-server:3000`.
Admin UI: `http://your-server:3000/admin`.

### 5. Run sync-manifest (first deploy)

After the first deploy you must sync the feature manifest to the database:

```sh
docker compose exec app node dist/src/db/migrate.js   # already done at startup
docker compose exec app npm run sync-manifest           # seed feature definitions
```

Or if you prefer to run it outside the container:
```sh
DATABASE_URL=postgres://feature_config:<password>@your-server:5432/feature_config \
  npm run sync-manifest
```

---

## Updating the Service

```sh
git pull
docker compose build app
docker compose up -d app
```

Migrations run automatically when the container starts.
No downtime for migration-only updates if using a single-instance setup.

---

## Using a Pre-Built Image (CI/CD)

In `docker-compose.yml`, replace `build: .` with `image:`:

```yaml
app:
  image: ghcr.io/your-org/elph-nova-feature-config:latest
```

Push to GitHub Container Registry in your CI pipeline:

```sh
docker build -t ghcr.io/your-org/elph-nova-feature-config:latest .
docker push ghcr.io/your-org/elph-nova-feature-config:latest
```

On the server, update with:

```sh
docker compose pull app
docker compose up -d app
```

---

## Running Behind a Reverse Proxy (nginx / Caddy)

Set in `.env`:

```env
TRUST_PROXY=true
TRUSTED_PROXY_IPS=127.0.0.1
HOST_PORT=3000
```

Example Caddy config:

```
feature-config.example.com {
    reverse_proxy localhost:3000
}
```

Example nginx config:

```nginx
server {
    listen 80;
    server_name feature-config.example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Host $host;
    }
}
```

---

## Manifest Updates

The `manifest/` directory is mounted as a read-only volume.
To update feature definitions:

1. Edit `manifest/elph-nova-feature-manifest.json`
2. Run sync-manifest:
   ```sh
   docker compose exec app node -e "
     require('./dist/scripts/sync-manifest.js')
   "
   ```
   Or from outside the container if the manifest is accessible:
   ```sh
   npm run sync-manifest
   ```

---

## Health Checks

- **Liveness:** `GET /health/live` — returns 200 if the server is running
- **Readiness:** `GET /health/ready` — returns 200 if DB is reachable and manifest is loaded

Used by `docker compose` healthcheck and can be wired to an uptime monitor.

---

## Data Persistence

PostgreSQL data is stored in the `postgres_data` Docker named volume.
Back it up with:

```sh
docker compose exec db pg_dump -U feature_config feature_config > backup_$(date +%Y%m%d).sql
```

Restore:

```sh
cat backup_20260101.sql | docker compose exec -T db psql -U feature_config feature_config
```

---

## Environment Variables Reference

See `.env.example` for the full list with descriptions.

| Variable | Required | Notes |
|----------|----------|-------|
| `POSTGRES_PASSWORD` | Yes | DB password |
| `ADMIN_COOKIE_SECRET` | Yes | Min 32 chars; generate with `openssl rand -hex 32` |
| `CORS_ALLOWED_ORIGINS` | Yes | `none` or comma-separated origins |
| `SSO_JWKS_URI` | No | Leave empty for dev/internal; set for JWT verification |
| `TRUST_PROXY` | No | Enable only behind a trusted proxy |
| `ADMIN_ALLOWED_IPS` | No | IP allowlist for admin UI |

---

## Handoff Checklist

When handing off to another team for maintenance:

- [ ] Share the `.env` file (or hand off secrets via a vault)
- [ ] Provide access to the GitHub repository
- [ ] Confirm Docker and Docker Compose versions on the target server
- [ ] Run `docker compose up -d` and verify `/health/live` returns 200
- [ ] Run sync-manifest and verify admin UI shows the expected feature flags
- [ ] Document any custom `ADMIN_ALLOWED_IPS` or proxy configuration
