# Codebase Index

Deeper index for `elph_nova_toggle_service`.

This repository is past the bootstrap stage. Task 2 delivered the initial Node.js service skeleton. The index now covers real source and test files as well as the agreed target zones that future implementation will fill.

## 1. Current Operational Docs

### `CLAUDE.md`

Repo-local operating contract for agents:

- stack baseline
- stage-1 invariants
- placement rules
- verification and documentation rules

### `docs/FEATURE_CONFIG_SERVICE_CONTEXT.md`

Recovered source-of-truth summary for the backend:

- stack decisions
- API semantics
- data model expectations
- deployment modes
- phase sequence

### `docs/PROJECT_ARCHITECTURE.md`

Target backend boundaries:

- app bootstrap
- config/env
- DB
- public/admin/auth modules
- manifest sync
- config resolution
- repository boundaries

### `docs/SERVER_IMPLEMENTATION_PLAN.md`

Local implementation companion:

- phase sequence
- per-phase testing gates
- definition of done for implementation work

### `docs/SERVER_TEST_PLAN.md`

Local testing companion:

- mandatory agent testing workflow
- recommended tooling
- minimum test matrix
- admin UI smoke expectations

### `docs/MULTI_AGENT_GUIDE.md`

Practical coordination guide for multi-agent work:

- single-writer rule
- recommended agent compositions
- implementation, bug, and design workflows

### `docs/SERVER_AGENT_PROMPTS.md`

Ready-to-use coordinator prompts for:

- implementation workflow
- bug investigation workflow
- specification/design workflow
- verification and QA workflow

### `docs/DELIVERY_CONTOUR.md`

Delivery contour and service discovery contract:

- standalone public URL and HTTPS requirements
- client baseURL discovery (pre-login, post-login, contour transition)
- admin access model for test host (SSH tunnel as default, separate admin-host as upgrade path)
- SSO claims and server-side role mapping (viewer/editor)
- manifest artifact delivery method (volume mount vs baked image)
- deployment baseline table and pre-release smoke checklist for Tasks 2–12

## 2. Current Source and Test Files

### `src/app.ts`

Fastify app factory exported as `createApp(options?)`. Accepts optional logger config. Registers plugins and modules (placeholder in Task 2). Does not call `listen()`.

### `src/server.ts`

Process entry point. Calls `createApp()`, reads `env.PORT`, calls `listen()`. Exits with code 1 on startup failure.

### `src/config/env.ts`

Full stage-1 zod schema covering all service env variables (not just `NODE_ENV`/`PORT`). Throws at module load time on invalid values. Exports typed `Env` type and singleton `env` instance.

### `src/shared/logger.ts`

Pino logger factory. Configures redaction for sensitive field paths so they do not appear in log output.

### `src/modules/health/index.ts`

Fastify plugin registering two health routes:

- `GET /health/live` — always returns 200; confirms the process is running.
- `GET /health/ready` — accepts an injectable `ReadyCheck` array; returns 200 when all checks pass, 503 otherwise.

### `tests/app.test.ts`

Vitest suite covering `createApp`: instantiation without error, inject returning 404 on bare app, and clean `close()`.

### `tests/config/env.test.ts`

8 unit tests for `parseEnv`: missing required variables, invalid types, accepted defaults, and full valid input.

### `tests/health.test.ts`

5 integration tests for the health plugin: liveness always passes, readiness with no checks passes, readiness with a failing check returns 503, and injectable check arrays behave correctly.

## 3. Current Tooling Scripts

### `scripts/find-code.sh`

Purpose:

- narrow search scope
- reduce noise from build and cache folders
- support `repo-navigator` and similar workflows

Expected modes:

- `paths <pattern>`
- `text <pattern>`

### `scripts/find-unmapped-files.sh`

Purpose:

- compare actual files with `docs/REPO_MAP.md`
- support `repo-indexer`

## 4. Planned Runtime Zones

These sections describe the implementation areas expected to appear in Tasks 3–12.

### `src/db`

- Knex initialization
- migration entry points
- DB-specific helpers

### `src/modules/public`

Expected responsibilities:

- required header parsing
- request context building
- public response contract
- status code semantics

### `src/modules/admin`

Expected responsibilities:

- admin routes and forms
- revision-safe mutations
- audit metadata
- preview and revision history screens

### `src/modules/auth`

Expected responsibilities:

- bearer token verification
- JWKS interaction and caching
- admin identity integration

### `src/modules/manifest`

Expected responsibilities:

- manifest loading
- hash calculation
- sync step orchestration
- remote-capable key filtering

### `src/modules/config-resolution`

Expected responsibilities:

- rule specificity ordering
- full config assembly
- compiled snapshot cache

### `src/modules/definitions`

- manifest-backed feature definitions persistence

### `src/modules/rules`

- admin-authored rule persistence

### `src/modules/revisions`

- immutable revision and audit history persistence

### `src/views`

- server-rendered Nunjucks templates only

### `src/shared`

- truly shared helpers only
- no dumping ground for misplaced business logic

## 5. Primary Backend Risks To Watch

- auth downgrade bugs
- manifest drift
- public/admin boundary leakage
- stale revision writes
- cache invalidation bugs
- schema drift between manifest, DB, and HTTP response
- under-tested admin UI flows
- preview/public mismatch
