# Codebase Index

Deeper index for `elph_nova_toggle_service`.

This repository is past the bootstrap stage. Tasks 1–12 are complete. The index now covers real source and test files as well as the agreed target zones that future implementation will fill.

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
- admin UI browser automation expectations

### `docs/MULTI_AGENT_GUIDE.md`

Practical coordination guide for multi-agent work:

- single-writer rule
- recommended agent compositions
- implementation, bug, design, verification, and deep review workflows
- when to use delivery logging for material stage-1 or rollout deltas

### `docs/SERVER_AGENT_PROMPTS.md`

Ready-to-use coordinator prompts for:

- implementation workflow
- bug investigation workflow
- specification/design workflow
- verification and QA workflow
- deep review workflow

### `docs/DELIVERY_CONTOUR.md`

Delivery contour and service discovery contract:

- standalone public URL and HTTPS requirements
- client baseURL discovery (pre-login, post-login, contour transition)
- admin access model for test host (SSH tunnel as default, separate admin-host as upgrade path)
- SSO claims and server-side role mapping (viewer/editor)
- manifest artifact delivery method (volume mount vs baked image)
- deployment baseline table and pre-release smoke checklist for Tasks 2–12

### `docs/DELIVERY_CHANGELOG.md`

Newest-first log for material backend delivery deltas:

- multi-agent workflow changes
- rollout or admin exposure model changes
- testing-baseline or verification-model changes
- implementation-state milestones that should be visible in one place

## 2. Current Source and Test Files

### `src/app.ts`

Fastify app factory exported as `createApp(options?)`. `AppOptions` accepts optional `manifestRegistry` (adds its `readyCheck()` to the health list), `readyChecks` (extra injectable checks), `publicOptions` (`PublicOptions` with `resolutionService`, numeric `productId`, and `tokenVerifier: TokenVerifier`), and `adminOptions` (`AdminOptions` with `service: AdminRulesService`, `verifier: TokenVerifier`, and `productId: number`). Conditionally registers the public plugin when `publicOptions` is present and the admin plugin when `adminOptions` is present. Added in Task 11: also registers `adminUiPlugin` when `adminOptions` is present; registers `@fastify/view` (Nunjucks, pointing at `src/views/`), `@fastify/form-body`, `@fastify/cookie`, and `@fastify/csrf-protection` before the UI plugin; includes a startup assertion that `fastify.csrfProtection` is defined. Added in Task 12: registers `@fastify/helmet` globally (security headers: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`; CSP disabled globally — admin templates manage their own); registers `@fastify/rate-limit` scoped to public plugin (max `RATE_LIMIT_PUBLIC_MAX`, default 300/min) and to admin plugin (max `RATE_LIMIT_ADMIN_MAX`, default 100/min), both disabled when `NODE_ENV=test`; registers `@fastify/cors` scoped to public plugin only, using `CORS_ALLOWED_ORIGINS` env var; passes `trustProxy` to the Fastify constructor from the `TRUST_PROXY` env var. Does not call `listen()`.

### `src/server.ts`

Process entry point. On startup: loads the manifest, builds `ManifestRegistry`, constructs `ManifestSyncService` and registers its `driftReadyCheck()`; resolves numeric `productId` via `upsertByName(env.DEFAULT_PRODUCT_ID)` (idempotent, handles first-run before sync-manifest); constructs `ConfigResolutionService` with `DefaultProductsRepository`, `DefaultDefinitionsRepository`, and `DefaultRulesRepository`; constructs `DefaultRevisionsRepository` and `AdminRulesService`; constructs `TokenVerifier` from env (`jwksUri`, `issuer`, `audience`, `jwksTimeoutMs`); passes both `publicOptions` and `adminOptions` (sharing the same `tokenVerifier`) to `createApp`, then calls `listen()`. Added in Task 12: graceful shutdown — registers `SIGTERM` and `SIGINT` handlers that call `app.close()`, then `db.destroy()`, then `process.exit(0)`; a 10-second watchdog forces `process.exit(1)` if the shutdown sequence stalls. Exits with code 1 on any startup failure.

### `src/modules/manifest`

Implemented in Task 5. Four files:

- `schema.ts` — zod schemas for manifest JSON; exports `Manifest`, `ManifestFeature`, `ManifestProduct` types; validates `deliveryMode`, `sourcePriorityMode`, `defaultEntry`, and optional `payload` fields.
- `loader.ts` — `loadManifest(path)`: synchronous read, JSON parse, zod validation, SHA-256 hash of raw bytes, filter to `remoteCapable` features. Returns `{ manifest, hash, remoteCapableFeatures }`. Throws descriptive errors for file I/O, parse, and schema failures.
- `registry.ts` — `ManifestRegistry`: in-memory `Map` of `ManifestDefinition` records keyed by feature key. `load(features, hash)` replaces the map atomically. `readyCheck()` returns a health-check function that throws if `isLoaded` is false.
- `sync.ts` — `ManifestSyncService`: accepts `db`, `DefinitionsRepository`, and `ProductsRepository`. `sync(input)` runs fully inside a Knex transaction: upserts the product, upserts all incoming definitions, archives definitions no longer in the manifest, and updates the product's `manifest_hash`. `driftReadyCheck(productName, expectedHash)` returns a health-check function that queries the DB and throws if the stored hash differs.

### `src/config/env.ts`

Full stage-1 zod schema covering all service env variables (not just `NODE_ENV`/`PORT`). Added in Task 8: `SSO_JWKS_TIMEOUT_MS` (optional integer, default 3000 ms) and a `superRefine` cross-field check that requires both `SSO_ISSUER` and `SSO_AUDIENCE` to be present when `SSO_JWKS_URI` is set in staging or production. Added in Task 11: `ADMIN_COOKIE_SECRET` (required string in staging/production; used to sign CSRF cookies via `@fastify/cookie`). Added in Task 12: `RATE_LIMIT_PUBLIC_MAX` (optional integer, default 300), `RATE_LIMIT_ADMIN_MAX` (optional integer, default 100), `TRUST_PROXY` (optional boolean, default false), `TRUSTED_PROXY_IPS` (required string when `TRUST_PROXY=true` in staging/production), `CORS_ALLOWED_ORIGINS` (required string in staging/production). Throws at module load time on invalid values. Exports typed `Env` type and singleton `env` instance.

### `src/shared/logger.ts`

Pino logger factory. Configures redaction for sensitive field paths so they do not appear in log output.

### `src/modules/health/index.ts`

Fastify plugin registering two health routes:

- `GET /health/live` — always returns 200; confirms the process is running.
- `GET /health/ready` — accepts an injectable `ReadyCheck` array; returns 200 when all checks pass, 503 otherwise.

### `tests/app.test.ts`

Vitest suite covering `createApp`: instantiation without error, inject returning 404 on bare app, and clean `close()`.

### `tests/config/env.test.ts`

Unit tests for `parseEnv`: missing required variables, invalid types, accepted defaults, and full valid input (original 8 cases); plus 11 cases added in Task 8 covering `SSO_JWKS_TIMEOUT_MS` default value, explicit override, and the cross-field enforcement that rejects `SSO_JWKS_URI` in staging/production without `SSO_ISSUER` and `SSO_AUDIENCE`; plus cases added in Task 12 covering `RATE_LIMIT_PUBLIC_MAX`, `RATE_LIMIT_ADMIN_MAX`, `TRUST_PROXY`, `TRUSTED_PROXY_IPS` conditional requirement, and `CORS_ALLOWED_ORIGINS` conditional requirement.

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

### `src/modules/dependencies/repository.ts`

`DependenciesRepository` interface and `DefaultDependenciesRepository`. Interface methods: `add(dep, trx?)`, `remove(id, trx?)`, `findById(id)`, `listByProduct(productId)`, `findEdge(productId, parentKey, childKey)`. `DefaultDependenciesRepository` implements all methods over the `flag_dependencies` table using Knex. Used by `AdminRulesService` for dependency add/remove flows.

### `src/modules/dependencies/cycle.ts`

`wouldCreateCycle(edges, parentKey, childKey)`: pure stateless function. Builds an adjacency map from the provided edge list and runs a DFS starting from `childKey` to detect whether there is already a path back to `parentKey`. Returns `true` if adding the edge would create a cycle, `false` otherwise. No DB access; called before the transactional insert in `AdminRulesService.addDependency`.

### `src/db/migrations/005_create_flag_dependencies.ts`

Migration that creates the `flag_dependencies` table: `id` (auto-increment primary key), `product_id` (FK to `products`), `parent_feature_key`, `child_feature_key`, `reason` (nullable text), `created_at` timestamp. Unique constraint on `(product_id, parent_feature_key, child_feature_key)` prevents duplicate edges and serves as the PostgreSQL safety net against concurrent duplicate inserts.

### `src/modules/config-resolution`

Implemented in Task 6. Three files:

- `types.ts` — shared domain types: `AuthState` (`'anonymous' | 'authenticated'`), `Platform`, `RequestContext` (authState + platform + appVersion), `ResolvedEntry` (open object with required `isEnabled`), `CompiledSnapshot` (productId, revision, ttl, and full `features` map).
- `specificity.ts` — stateless rule-matching and scoring functions. `ruleMatchesContext` checks audience, platform, and semver range inclusion (null min treated as 0.0.0, null max as 99999.0.0). `computeSpecificity` produces a three-digit integer score (authScore×100 + platformScore×10 + versionBoundCount). `selectBestRule` picks the highest-scoring matching rule; ties broken by narrower semver range width. `doRulesOverlap` tests whether two rules' version ranges intersect. `detectAmbiguousOverlap` returns all same-audience+same-platform pairs whose ranges overlap.
- `service.ts` — `ConfigResolutionService`. Constructor takes `ProductsRepository`, `DefinitionsRepository`, and `RulesRepository`. `buildRawSnapshot(productId)` fetches the current revision, checks the Promise-keyed cache (`productId:revision`), and if absent loads definitions + rules from DB, parses all `entry_json` fields once, and stores the result as a shared Promise (prevents cache stampede; failed loads remove their cache entry). `resolveConfig(productId, ctx)` calls `buildRawSnapshot` then runs `selectBestRule` per feature key, falling back to the manifest default when no rule matches, and returns a `CompiledSnapshot`. `invalidateCache(productId)` removes all cache entries whose key starts with the product prefix. `rebuildSnapshot` invalidates then reloads.

### `src/modules/auth`

Implemented in Task 8; updated in Task 9. One file:

- `token-verifier.ts` — `TokenVerifier` interface with a single `verify(authHeader: string | undefined): Promise<AuthResult>` method. `AuthResult` carries `state`, optional `sub`, and optional `roles?: string[]` (extracted from the JWT `roles` claim on authenticated results; used by the admin RBAC hook). `createTokenVerifier(options)` factory wires `jose` remote JWKS verification with configurable `issuer`, `audience`, and `jwksTimeoutDuration`. Error classes: `TokenInvalidError` (always maps to 401) and `InfraError` (always maps to 503). Four-scenario discrimination: no header → `'anonymous'`; valid bearer → `'authenticated'` with decoded claims; invalid/expired/malformed bearer → `TokenInvalidError`; JWKS/network failure → `InfraError`. The type does not bleed `jose` details into callers.

### `src/modules/public`

Implemented in Task 7; updated in Task 8. Two files:

- `schemas.ts` — Fastify JSON Schema constants: `featureConfigHeaders` (required: `platform` enum `ios|android|web|desktop`, `appname`, `appversion`; optional: `authorization`) and `featureConfigResponse200` (required: `version` integer, `ttl` integer, `features` object with `additionalProperties` entries requiring `isEnabled`).
- `index.ts` — Fastify async plugin (`publicPlugin`). Options: `resolutionService: ConfigResolutionService`, `productId: number`, and `tokenVerifier: TokenVerifier`. Registers `GET /api/v1/feature-config`. Request handling: calls `tokenVerifier.verify()` on the Authorization header; maps `TokenInvalidError` → 401 and `InfraError` → 503; builds `RequestContext` with the resolved `AuthState`; calls `resolutionService.resolveConfig(productId, ctx)`; returns 200 with `{ version, ttl, features }` and `Cache-Control: no-store`.

### `src/modules/admin`

Implemented in Task 9; extended in Tasks 10 and 11. Five files:

- `auth.ts` — `makeAdminAuthHook(verifier, requiredRole)` returns a Fastify `preHandler` function. Calls `verifier.verify()` on the Authorization header; maps `TokenInvalidError` → 401 and `InfraError` → 503; anonymous result → 401. Role check: `ROLE_VIEWER` is satisfied by either `feature-toggle-viewer` or `feature-toggle-editor`; `ROLE_EDITOR` requires `feature-toggle-editor` only. Attaches `request.adminRole` (the highest granted role) and `request.adminSub` (JWT `sub`) on success. Augments `FastifyRequest` with these two fields via module declaration merging.
- `service.ts` — `AdminRulesService` orchestrates all admin write flows. Constructor takes `db`, `ManifestRegistry`, `RulesRepository`, `ProductsRepository`, `RevisionsRepository`, and `ConfigResolutionService`. `createRule` validates registry key, non-empty reason, `entry_json` fields against manifest payload schema, and ambiguous overlap; then wraps `rulesRepo.create` + `productsRepo.updateRevision` + `revisionsRepo.insert` in a single transaction and calls `invalidateCache`. `updateRule` and `disableRule` follow the same pattern with their respective repository calls. `listRules` delegates to `listAllActive`. `getRule` throws `NotFoundError` when absent. All three mutation methods surface stale `expectedRevision` as `ConflictError`. Added in Task 10: `previewConfig(productId, ctx)` delegates to `ConfigResolutionService.resolveConfig`; `listRevisions(productId, limit)` delegates to `RevisionsRepository.listByProduct`. Domain error classes exported: `ValidationError`, `ConflictError`, `NotFoundError`. Added in Task 11: `getCurrentRevision(productId)` returns the current revision number for the product; used by the UI plugin to populate forms without a separate `productsRepo` dependency.
- `routes.ts` — Fastify async plugin (`adminPlugin`) with `AdminPluginOptions` (`service`, `verifier`, `productId`). Registers five routes under `/admin/api/rules`: `GET /` and `GET /:id` require `ROLE_VIEWER`; `POST /`, `PATCH /:id`, and `DELETE /:id` require `ROLE_EDITOR`. Zod schemas validate request bodies on all mutations (`createRuleBodySchema`, `updateRuleBodySchema`, `disableRuleBodySchema`). `handleServiceError` maps `ValidationError` → 400, `NotFoundError` → 404, `ConflictError` → 409; unrecognised errors are re-thrown to Fastify. Added in Task 10: `GET /admin/api/preview` (viewer auth required; accepts platform, audience, appVersion query parameters; returns the full resolved config for that context) and `GET /admin/api/revisions` (viewer auth required; accepts optional `limit` 1–200, default 50; returns the recent revision audit trail for the product).
- `ui.ts` — Added in Task 11. Fastify async plugin (`adminUiPlugin`) registered in `app.ts` when `adminOptions` is present. Requires `@fastify/view` (Nunjucks), `@fastify/form-body`, `@fastify/csrf-protection`, and `@fastify/cookie` (signed cookies; `ADMIN_COOKIE_SECRET` env var required in staging/production). Read routes (viewer auth): `GET /admin/features`, `GET /admin/features/:key`, `GET /admin/features/:key/rules/new`, `GET /admin/features/:key/rules/:id/edit`, `GET /admin/preview`, `GET /admin/preview/partial` (HTMX partial), `GET /admin/revisions`. Write routes (editor auth + CSRF token check): `POST /admin/features/:key/rules` (create), `POST /admin/features/:key/rules/:id` (update), `POST /admin/features/:key/rules/:id/disable` (disable), `POST /admin/features/:key/quick-toggle` (quick toggle). All write routes re-render the originating form with validation or conflict errors rather than letting Fastify produce a JSON 4xx. URL path params passed into raw HTML strings are escaped via `escapeHtml()`. Re-render responses carry an explicit `.code(200)`.
- `csrf.ts` — Added in Task 11. Thin wrapper exporting `verifyCsrfToken(request, reply)` used by write route handlers. Startup assertion in `app.ts` checks that `fastify.csrfProtection` is defined after plugin registration.

### `tests/modules/config-resolution/specificity.test.ts`

32 unit tests covering all five exported functions in `specificity.ts`: audience-only matching, platform-only matching, semver range boundary behavior (inclusive min/max, null bounds), `computeSpecificity` score values for every dimension combination, `selectBestRule` with ties and tiebreaking, `doRulesOverlap` adjacent and overlapping ranges, and `detectAmbiguousOverlap` with clean and conflicting rule sets.

### `tests/modules/config-resolution/service.test.ts`

15 integration tests for `ConfigResolutionService` against an in-memory SQLite database. Covers: concurrent `buildRawSnapshot` calls sharing a single Promise, cache hit on repeated calls, cache-entry cleanup after a failed load, `invalidateCache` forcing a fresh DB read, `rebuildSnapshot` producing updated data, `resolveConfig` returning manifest defaults when no rule matches, and `resolveConfig` selecting the correct rule override for authenticated/platform/version contexts.

### `tests/modules/auth/token-verifier.test.ts`

10 unit tests (TV-1 through TV-10) for `TokenVerifier`. Covers: anonymous path when no Authorization header is present; authenticated path when a valid bearer token is passed; `TokenInvalidError` for expired tokens, malformed tokens, wrong audience, and wrong issuer; `InfraError` when JWKS endpoint is unreachable or returns a network error; and the mock verifier shape used as a test double by public route tests.

### `tests/modules/public/feature-config.test.ts`

14 route integration tests via `fastify.inject()` against an in-memory SQLite instance with two seeded feature definitions. Groups: A (header validation — missing or invalid Platform, missing AppName, missing AppVersion all return 400), B (successful 200 — features map returned, `ttl` matches product value, all seeded keys present, `isEnabled` field present, `Cache-Control: no-store` set), C (auth scenarios — C1 no header → 200 anonymous, C2 valid bearer → 200 authenticated, C3 invalid bearer → 401, C4 expired bearer → 401, C5 JWKS/infra failure → 503; all route tests pass a mock verifier), D (internal error — unknown `productId` wired at app construction returns 500).

### `tests/modules/admin/service.test.ts`

10 unit tests (U1–U10) for `AdminRulesService` using vitest mocks for all repositories and a real in-memory SQLite instance wired through `withTransaction`. U1: unknown feature key → `ValidationError`. U2: empty reason → `ValidationError`. U3: `updateRevision` rejection → `ConflictError`. U4: successful create returns the rule and calls `invalidateCache`. U5: inactive rule → `NotFoundError` on update. U6: rule belonging to a different product → `NotFoundError` on update. U7: successful update returns updated row and calls `invalidateCache`. U8: already-inactive rule → `NotFoundError` on disable. U9: successful disable calls `rulesRepo.disable` and `invalidateCache`. U10: unknown field in `entry_json` when manifest schema defines fields → `ValidationError`.

### `tests/modules/admin/routes.test.ts`

Route integration tests via `fastify.inject()` against an in-memory SQLite instance with two seeded feature definitions (`chat`, `video_call`). Test groups: H (H1–H8, auth boundary enforcement across all HTTP verbs and role levels), V (V1–V10, service-level validation surfaced through HTTP status codes: 400 for bad input, 404 for missing resources, 409 for stale revision and ambiguous overlap), ZB (ZB1–ZB5, zod request-body schema enforcement before the service is reached), CI1 (resolution cache is invalidated after a successful write and the list endpoint immediately reflects the new rule), B1 (full create → get → update → disable CRUD round-trip; rule absent from list after disable), S1 (`changedBy` in the revision record is the JWT `sub` field, not the role label string).

### `tests/modules/admin/preview-parity.test.ts`

Added in Task 10. 6 PAR tests (PAR1–PAR6) verifying that `GET /admin/api/preview` and `GET /api/v1/feature-config` produce identical resolved output for equivalent request contexts: anonymous context, authenticated context, platform-specific override, app-version-bounded rule, no-matching-rule fallback to manifest default, and multi-key snapshot consistency.

### `tests/modules/admin/ui.test.ts`

Added in Task 11. 22 inject tests via `fastify.inject()` covering the server-rendered UI plugin: HTML route rendering (UI-H1–H7 — features list, feature detail, new-rule form, edit-rule form, preview page, preview partial, revisions page), create/update/disable/quick-toggle POST handlers (UI-C1–C4), form validation error paths (UI-V1–V3), CSRF rejection (UI-R1–R4), and quick-toggle behavior (UI-QT1–QT2). Session/cookie paths (UI-S1–S2) cover signed-cookie round-trip for CSRF state.

### `tests/modules/hardening/rate-limit.test.ts`

Added in Task 12. 4 tests (RL1–RL4) verifying per-contour rate limiting behaviour via `fastify.inject()`: RL1 public contour allows requests up to `RATE_LIMIT_PUBLIC_MAX` and returns 429 on the next request; RL2 admin contour limits at `RATE_LIMIT_ADMIN_MAX`; RL3 rate limits are disabled when `NODE_ENV=test` (header absent, requests never throttled); RL4 public and admin counters are independent.

### `tests/modules/hardening/security-headers.test.ts`

Added in Task 12. 5 tests (SH1–SH5) asserting that `@fastify/helmet` response headers are present on every route: SH1 `X-Content-Type-Options: nosniff`; SH2 `X-Frame-Options: SAMEORIGIN`; SH3 `Referrer-Policy` set; SH4 no `Content-Security-Policy` header globally (CSP disabled at app level); SH5 headers present on both public and admin responses.

### `tests/modules/hardening/cors.test.ts`

Added in Task 12. 6 tests (CORS1–CORS6) for `@fastify/cors` scoped to the public plugin: CORS1 allowed origin receives `Access-Control-Allow-Origin`; CORS2 disallowed origin receives no CORS header; CORS3 `OPTIONS` preflight returns 204 for allowed origin; CORS4 admin routes do not expose CORS headers regardless of origin; CORS5 multiple origins in `CORS_ALLOWED_ORIGINS` (comma-separated) are each accepted; CORS6 missing `CORS_ALLOWED_ORIGINS` in staging/production fails env validation.

### `tests/e2e/admin-ui.spec.ts`

Added in Task 11. 9 Playwright end-to-end tests (E2E-1 through E2E-9) exercising the admin UI in a real browser against a local service instance: E2E-1 features list loads, E2E-2 feature detail renders active rules, E2E-3 create rule form submits successfully, E2E-4 validation errors display on bad input, E2E-5 edit rule form pre-fills existing values, E2E-6 update rule commits change, E2E-7 disable rule removes it from the list, E2E-8 quick-toggle flips enabled state, E2E-9 stale conflict path shows a 409 message without data loss.

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

### `scripts/smoke-rollout.sh`

Added in Task 12. Repeatable pre-release smoke matrix covering 7 scenarios against a running service instance: health live (200), health ready (200), anonymous config (200 with features map), invalid token (401), token verification infra failure (503), security headers present on public response, admin endpoint without auth (401), `Cache-Control: no-store` on public config response. Invocable via `npm run smoke:rollout`. Exits non-zero on any failed assertion.

### `src/views`

Added in Task 11. Nunjucks templates for the server-rendered admin UI. One template per admin page: features list, feature detail, new-rule form, edit-rule form, preview page, preview partial (HTMX target), and revisions page. Templates receive all data from route handlers; no business logic lives here. HTMX is used only for the preview partial refresh.

## 4. Implemented Runtime Zones

All stage-1 implementation zones are complete. Key locations for reference:

### `src/db`

- Knex initialization
- migration entry points
- DB-specific helpers

### `src/modules/definitions`

- manifest-backed feature definitions persistence

### `src/modules/rules`

- admin-authored rule persistence

### `src/modules/revisions`

- immutable revision and audit history persistence

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
