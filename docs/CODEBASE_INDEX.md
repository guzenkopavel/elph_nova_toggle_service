# Codebase Index

Deeper index for `elph_nova_toggle_service`.

This repository is past the bootstrap stage. Tasks 1–8 are complete. The index now covers real source and test files as well as the agreed target zones that future implementation will fill.

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

Fastify app factory exported as `createApp(options?)`. `AppOptions` accepts optional `manifestRegistry` (adds its `readyCheck()` to the health list), `readyChecks` (extra injectable checks), and `publicOptions` (`PublicOptions` with `resolutionService`, numeric `productId`, and `tokenVerifier: TokenVerifier`). Conditionally registers the public plugin when `publicOptions` is present. Does not call `listen()`.

### `src/server.ts`

Process entry point. On startup: loads the manifest, builds `ManifestRegistry`, constructs `ManifestSyncService` and registers its `driftReadyCheck()`; resolves numeric `productId` via `upsertByName(env.DEFAULT_PRODUCT_ID)` (idempotent, handles first-run before sync-manifest); constructs `ConfigResolutionService` with `DefaultProductsRepository`, `DefaultDefinitionsRepository`, and `DefaultRulesRepository`; constructs `TokenVerifier` from env (`jwksUri`, `issuer`, `audience`, `jwksTimeoutMs`); passes `publicOptions` (including `tokenVerifier`) to `createApp`, then calls `listen()`. Exits with code 1 on any startup failure.

### `src/modules/manifest`

Implemented in Task 5. Four files:

- `schema.ts` — zod schemas for manifest JSON; exports `Manifest`, `ManifestFeature`, `ManifestProduct` types; validates `deliveryMode`, `sourcePriorityMode`, `defaultEntry`, and optional `payload` fields.
- `loader.ts` — `loadManifest(path)`: synchronous read, JSON parse, zod validation, SHA-256 hash of raw bytes, filter to `remoteCapable` features. Returns `{ manifest, hash, remoteCapableFeatures }`. Throws descriptive errors for file I/O, parse, and schema failures.
- `registry.ts` — `ManifestRegistry`: in-memory `Map` of `ManifestDefinition` records keyed by feature key. `load(features, hash)` replaces the map atomically. `readyCheck()` returns a health-check function that throws if `isLoaded` is false.
- `sync.ts` — `ManifestSyncService`: accepts `db`, `DefinitionsRepository`, and `ProductsRepository`. `sync(input)` runs fully inside a Knex transaction: upserts the product, upserts all incoming definitions, archives definitions no longer in the manifest, and updates the product's `manifest_hash`. `driftReadyCheck(productName, expectedHash)` returns a health-check function that queries the DB and throws if the stored hash differs.

### `src/config/env.ts`

Full stage-1 zod schema covering all service env variables (not just `NODE_ENV`/`PORT`). Added in Task 8: `SSO_JWKS_TIMEOUT_MS` (optional integer, default 3000 ms) and a `superRefine` cross-field check that requires both `SSO_ISSUER` and `SSO_AUDIENCE` to be present when `SSO_JWKS_URI` is set in staging or production. Throws at module load time on invalid values. Exports typed `Env` type and singleton `env` instance.

### `src/shared/logger.ts`

Pino logger factory. Configures redaction for sensitive field paths so they do not appear in log output.

### `src/modules/health/index.ts`

Fastify plugin registering two health routes:

- `GET /health/live` — always returns 200; confirms the process is running.
- `GET /health/ready` — accepts an injectable `ReadyCheck` array; returns 200 when all checks pass, 503 otherwise.

### `tests/app.test.ts`

Vitest suite covering `createApp`: instantiation without error, inject returning 404 on bare app, and clean `close()`.

### `tests/config/env.test.ts`

19 unit tests for `parseEnv`: missing required variables, invalid types, accepted defaults, and full valid input (original 8 cases); plus 11 new cases added in Task 8 covering `SSO_JWKS_TIMEOUT_MS` default value, explicit override, and the cross-field enforcement that rejects `SSO_JWKS_URI` in staging/production without `SSO_ISSUER` and `SSO_AUDIENCE`.

### `tests/health.test.ts`

7 integration tests for the health plugin: liveness always passes, readiness with no checks passes, readiness with a failing check returns 503, injectable check arrays behave correctly; 2 new tests verify that an unloaded `ManifestRegistry` causes 503 and a loaded one allows 200.

### `tests/modules/manifest/loader.test.ts`

Unit tests for `loadManifest`: missing file error, invalid JSON error, schema validation failures, successful parse with correct hash and `remoteCapable` filter, hash stability across calls.

### `tests/modules/manifest/registry.test.ts`

Unit tests for `ManifestRegistry`: initial `isLoaded` false, `load()` populates map and sets hash, `getAll()` / `getByKey()` / `hasKey()` correctness, `readyCheck()` throws before load and resolves after load.

### `tests/modules/manifest/sync.test.ts`

Integration tests for `ManifestSyncService` against in-memory SQLite: `sync()` upserts definitions, archives keys removed from manifest, updates product `manifest_hash`; `driftReadyCheck()` resolves when hashes match and throws when they differ.

### `src/modules/rules/repository.ts`

`RulesRepository` interface and `DefaultRulesRepository`. Existing methods: `create`, `update`, `disable`, `findById`, `listActiveByKey`. Added in Task 6: `listAllActive(productId, trx?)` — returns all active rules for a product across all feature keys, ordered by id ascending. Used by `ConfigResolutionService._loadParsedSnapshot` to load rules in a single query.

### `src/modules/config-resolution`

Implemented in Task 6. Three files:

- `types.ts` — shared domain types: `AuthState` (`'anonymous' | 'authenticated'`), `Platform`, `RequestContext` (authState + platform + appVersion), `ResolvedEntry` (open object with required `isEnabled`), `CompiledSnapshot` (productId, revision, ttl, and full `features` map).
- `specificity.ts` — stateless rule-matching and scoring functions. `ruleMatchesContext` checks audience, platform, and semver range inclusion (null min treated as 0.0.0, null max as 99999.0.0). `computeSpecificity` produces a three-digit integer score (authScore×100 + platformScore×10 + versionBoundCount). `selectBestRule` picks the highest-scoring matching rule; ties broken by narrower semver range width. `doRulesOverlap` tests whether two rules' version ranges intersect. `detectAmbiguousOverlap` returns all same-audience+same-platform pairs whose ranges overlap.
- `service.ts` — `ConfigResolutionService`. Constructor takes `ProductsRepository`, `DefinitionsRepository`, and `RulesRepository`. `buildRawSnapshot(productId)` fetches the current revision, checks the Promise-keyed cache (`productId:revision`), and if absent loads definitions + rules from DB, parses all `entry_json` fields once, and stores the result as a shared Promise (prevents cache stampede; failed loads remove their cache entry). `resolveConfig(productId, ctx)` calls `buildRawSnapshot` then runs `selectBestRule` per feature key, falling back to the manifest default when no rule matches, and returns a `CompiledSnapshot`. `invalidateCache(productId)` removes all cache entries whose key starts with the product prefix. `rebuildSnapshot` invalidates then reloads.

### `src/modules/auth`

Implemented in Task 8. One file:

- `token-verifier.ts` — `TokenVerifier` interface with a single `verify(authHeader: string | undefined): Promise<AuthState>` method. `createTokenVerifier(options)` factory wires `jose` remote JWKS verification with configurable `issuer`, `audience`, and `jwksTimeoutDuration`. Error classes: `TokenInvalidError` (always maps to 401) and `InfraError` (always maps to 503). Four-scenario discrimination: no header → `'anonymous'`; valid bearer → `'authenticated'` with decoded claims; invalid/expired/malformed bearer → `TokenInvalidError`; JWKS/network failure → `InfraError`. The type does not bleed `jose` details into callers.

### `src/modules/public`

Implemented in Task 7; updated in Task 8. Two files:

- `schemas.ts` — Fastify JSON Schema constants: `featureConfigHeaders` (required: `platform` enum `ios|android|web|desktop`, `appname`, `appversion`; optional: `authorization`) and `featureConfigResponse200` (required: `version` integer, `ttl` integer, `features` object with `additionalProperties` entries requiring `isEnabled`).
- `index.ts` — Fastify async plugin (`publicPlugin`). Options: `resolutionService: ConfigResolutionService`, `productId: number`, and `tokenVerifier: TokenVerifier`. Registers `GET /api/v1/feature-config`. Request handling: calls `tokenVerifier.verify()` on the Authorization header; maps `TokenInvalidError` → 401 and `InfraError` → 503; builds `RequestContext` with the resolved `AuthState`; calls `resolutionService.resolveConfig(productId, ctx)`; returns 200 with `{ version, ttl, features }` and `Cache-Control: no-store`.

### `tests/modules/config-resolution/specificity.test.ts`

32 unit tests covering all five exported functions in `specificity.ts`: audience-only matching, platform-only matching, semver range boundary behavior (inclusive min/max, null bounds), `computeSpecificity` score values for every dimension combination, `selectBestRule` with ties and tiebreaking, `doRulesOverlap` adjacent and overlapping ranges, and `detectAmbiguousOverlap` with clean and conflicting rule sets.

### `tests/modules/config-resolution/service.test.ts`

15 integration tests for `ConfigResolutionService` against an in-memory SQLite database. Covers: concurrent `buildRawSnapshot` calls sharing a single Promise, cache hit on repeated calls, cache-entry cleanup after a failed load, `invalidateCache` forcing a fresh DB read, `rebuildSnapshot` producing updated data, `resolveConfig` returning manifest defaults when no rule matches, and `resolveConfig` selecting the correct rule override for authenticated/platform/version contexts.

### `tests/modules/auth/token-verifier.test.ts`

10 unit tests (TV-1 through TV-10) for `TokenVerifier`. Covers: anonymous path when no Authorization header is present; authenticated path when a valid bearer token is passed; `TokenInvalidError` for expired tokens, malformed tokens, wrong audience, and wrong issuer; `InfraError` when JWKS endpoint is unreachable or returns a network error; and the mock verifier shape used as a test double by public route tests.

### `tests/modules/public/feature-config.test.ts`

14 route integration tests via `fastify.inject()` against an in-memory SQLite instance with two seeded feature definitions. Groups: A (header validation — missing or invalid Platform, missing AppName, missing AppVersion all return 400), B (successful 200 — features map returned, `ttl` matches product value, all seeded keys present, `isEnabled` field present, `Cache-Control: no-store` set), C (auth scenarios — C1 no header → 200 anonymous, C2 valid bearer → 200 authenticated, C3 invalid bearer → 401, C4 expired bearer → 401, C5 JWKS/infra failure → 503; all route tests pass a mock verifier), D (internal error — unknown `productId` wired at app construction returns 500).

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

### `scripts/smoke-auth.sh`

Shell smoke script for the four auth scenarios:

- anonymous request (no Authorization header) — expects 200
- authenticated request (valid bearer token) — expects 200
- invalid token — expects 401
- infra failure path — documents the expected 503 surface

## 4. Planned Runtime Zones

These sections describe the implementation areas expected to appear in Tasks 8–12.

### `src/db`

- Knex initialization
- migration entry points
- DB-specific helpers

### `src/modules/admin`

Expected responsibilities:

- admin routes and forms
- revision-safe mutations
- audit metadata
- preview and revision history screens

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
