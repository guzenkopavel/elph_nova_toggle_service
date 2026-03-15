# Codebase Index

Deeper index for `elph_nova_toggle_service`.

This repository is past the bootstrap stage. Tasks 2–5 are complete. The index now covers real source and test files as well as the agreed target zones that future implementation will fill.

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

Fastify app factory exported as `createApp(options?)`. `AppOptions` now includes an optional `manifestRegistry` field; when provided, the registry's `readyCheck()` is automatically added to the health ready-check list alongside any other injectable checks. Does not call `listen()`.

### `src/server.ts`

Process entry point. On startup: loads the manifest file, builds `ManifestRegistry`, constructs `ManifestSyncService` and registers its `driftReadyCheck()`, then calls `createApp()` and `listen()`. Exits with code 1 on any startup failure.

### `src/modules/manifest`

Implemented in Task 5. Four files:

- `schema.ts` — zod schemas for manifest JSON; exports `Manifest`, `ManifestFeature`, `ManifestProduct` types; validates `deliveryMode`, `sourcePriorityMode`, `defaultEntry`, and optional `payload` fields.
- `loader.ts` — `loadManifest(path)`: synchronous read, JSON parse, zod validation, SHA-256 hash of raw bytes, filter to `remoteCapable` features. Returns `{ manifest, hash, remoteCapableFeatures }`. Throws descriptive errors for file I/O, parse, and schema failures.
- `registry.ts` — `ManifestRegistry`: in-memory `Map` of `ManifestDefinition` records keyed by feature key. `load(features, hash)` replaces the map atomically. `readyCheck()` returns a health-check function that throws if `isLoaded` is false.
- `sync.ts` — `ManifestSyncService`: accepts `db`, `DefinitionsRepository`, and `ProductsRepository`. `sync(input)` runs fully inside a Knex transaction: upserts the product, upserts all incoming definitions, archives definitions no longer in the manifest, and updates the product's `manifest_hash`. `driftReadyCheck(productName, expectedHash)` returns a health-check function that queries the DB and throws if the stored hash differs.

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

7 integration tests for the health plugin: liveness always passes, readiness with no checks passes, readiness with a failing check returns 503, injectable check arrays behave correctly; 2 new tests verify that an unloaded `ManifestRegistry` causes 503 and a loaded one allows 200.

### `tests/modules/manifest/loader.test.ts`

Unit tests for `loadManifest`: missing file error, invalid JSON error, schema validation failures, successful parse with correct hash and `remoteCapable` filter, hash stability across calls.

### `tests/modules/manifest/registry.test.ts`

Unit tests for `ManifestRegistry`: initial `isLoaded` false, `load()` populates map and sets hash, `getAll()` / `getByKey()` / `hasKey()` correctness, `readyCheck()` throws before load and resolves after load.

### `tests/modules/manifest/sync.test.ts`

Integration tests for `ManifestSyncService` against in-memory SQLite: `sync()` upserts definitions, archives keys removed from manifest, updates product `manifest_hash`; `driftReadyCheck()` resolves when hashes match and throws when they differ.

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

### `scripts/sync-manifest.ts`

Standalone operator CLI for manifest synchronization:

- reads `MANIFEST_PATH` from env
- calls `loadManifest()`, builds `ManifestRegistry`, runs `ManifestSyncService.sync()` in a transaction
- logs upserted/archived counts and the manifest hash
- exits non-zero on any failure; must be run before service startup

## 4. Planned Runtime Zones

These sections describe the implementation areas expected to appear in Tasks 6–12.

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
