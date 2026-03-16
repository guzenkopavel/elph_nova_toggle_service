# Repository Map

Repository map for `elph_nova_toggle_service`.

Current state: Tasks 1–11 are complete. The files below reflect what exists now.

## Scope And Exclusions

Included:

- repo-local agent configuration
- backend workflow docs
- lightweight repo scripts
- future Node.js service implementation zones

Excluded from indexing by default:

- `.git`
- `node_modules`
- `dist`
- `coverage`
- `.turbo`
- `.next`
- `.cache`
- build artifacts and local DB files

## Root

- `.claude/agents`
  - project-level subagents for this repository
  - `README.md` explains the recommended chain and the single-writer rule
- `CLAUDE.md`
  - repo-local operating rules for terminal-first agents
- `docs`
  - recovered backend context, architecture notes, prompts, and repo guidance
- `scripts`
  - small helper scripts for repo navigation and indexing workflows

## `.claude/agents`

- `.claude/agents/README.md`
  - overview of the agent set and recommended baseline chain
- `.claude/agents/repo-navigator.md`
  - narrows task scope to a small set of relevant backend files
- `.claude/agents/module-boundary-guard.md`
  - recommends the correct placement across router, service, repository, manifest, shared, script, or view layers
- `.claude/agents/test-strategy-agent.md`
  - defines the minimum required test matrix for the scoped change before or during implementation
- `.claude/agents/implementation-agent.md`
  - the only writer for production code changes
- `.claude/agents/architecture-guard.md`
  - reviews layer boundaries and architectural fit
- `.claude/agents/async-runtime-guard.md`
  - reviews async control flow, request lifecycle, cache invalidation, and blocking risks
- `.claude/agents/api-contract-guard.md`
  - reviews public/admin HTTP contract behavior and compatibility
- `.claude/agents/auth-security-guard.md`
  - reviews token semantics, admin/public separation, and security-sensitive flows
- `.claude/agents/persistence-manifest-guard.md`
  - reviews migrations, repository changes, revision behavior, and manifest sync correctness
- `.claude/agents/verifier-agent.md`
  - selects the narrowest meaningful verification for the touched scope
- `.claude/agents/qa-scenario-agent.md`
  - runs live smoke scenarios against the local service, including admin UI and preview/public parity when relevant
- `.claude/agents/repo-indexer.md`
  - keeps the repository map aligned with the filesystem
- `.claude/agents/docs-sync-agent.md`
  - updates docs only when real rules or structure changed
- `.claude/agents/delivery-log-agent.md`
  - captures material rollout, stage-1, testing-baseline, and implementation-state deltas in one place
- `.claude/agents/deep-review-agent.md`
  - performs high-context review across code, architecture, request fit, rollout fit, and stage-1 backend history
- `.claude/agents/specification-writer.md`
  - writes feature/spec documents before implementation
- `.claude/agents/architecture-designer.md`
  - designs boundaries, flows, and integration points before coding
- `.claude/agents/implementation-planner.md`
  - turns approved design into a phased execution plan
- `.claude/agents/refactor-planner.md`
  - designs staged backend refactors safely
- `.claude/agents/bug-investigator.md`
  - reconstructs the real current behavior before fixing bugs

## `docs`

- `docs/FEATURE_CONFIG_SERVICE_CONTEXT.md`
  - recovered stage-1 backend context from the neighboring iOS repository
- `docs/PROJECT_ARCHITECTURE.md`
  - target service architecture and module responsibilities
- `docs/SERVER_IMPLEMENTATION_PLAN.md`
  - local companion implementation plan aligned with the stage-1 source plan
- `docs/SERVER_TEST_PLAN.md`
  - local testing strategy and mandatory verification workflow for agents
- `docs/REPO_MAP.md`
  - this file
- `docs/CODEBASE_INDEX.md`
  - deeper index of current docs, scripts, and planned backend zones
- `docs/MULTI_AGENT_GUIDE.md`
  - practical guide for multi-agent work in this repository, including deep review and delivery logging
- `docs/SERVER_AGENT_PROMPTS.md`
  - ready coordinator prompts for implementation, bugs, design, verification, and deep review work
- `docs/DELIVERY_CONTOUR.md`
  - delivery contour and service discovery contract: standalone URL, client baseURL discovery, admin access model, SSO role mapping, manifest artifact delivery, and smoke baseline for Tasks 2–12
- `docs/DELIVERY_CHANGELOG.md`
  - newest-first log of material stage-1, rollout, testing-baseline, and implementation-state deltas
- `docs/DOCUMENTATION_INDEX.md`
  - quick index of repository documentation
- `docs/README_DOCUMENTATION.md`
  - documentation entry point

## `scripts`

- `scripts/find-code.sh`
  - narrow repo search helper for agent workflows
- `scripts/find-unmapped-files.sh`
  - helper for repo-indexer to find files not yet mentioned in `docs/REPO_MAP.md`
- `scripts/sync-manifest.ts`
  - standalone CLI: loads manifest from `MANIFEST_PATH`, builds registry, runs `ManifestSyncService.sync()`, exits non-zero on failure
- `scripts/smoke-auth.sh`
  - shell smoke script covering the four auth scenarios: anonymous (no header → 200), authenticated (valid bearer → 200), invalid token (bad bearer → 401), and infra failure path
- `scripts/smoke-rollout.sh`
  - repeatable pre-release smoke matrix for health, public auth semantics, security headers, and admin contour checks against a running instance

## Root Config Files

- `.gitignore`
  - local ignore policy for runtime artifacts, local DB files, browser results, and dependency/build output
- `package.json`
  - npm manifest, dependency declarations, and npm scripts
- `package-lock.json`
  - npm lockfile pinning the exact dependency graph for local and CI installs
- `.env.example`
  - documented template of all supported environment variables
- `knexfile.ts`
  - Knex CLI entry point; exports named `development`, `test`, and `production` connection configs for migrations
- `tsconfig.json`
  - TypeScript compiler configuration (ES2022 target, CommonJS modules, strict mode)
- `vitest.config.ts`
  - Vitest test runner configuration; enables globals and sets up path aliases for the test suite

## `src`

- `src/app.ts`
  - Fastify app factory (`createApp`); registers `@fastify/cookie`, `@fastify/formbody`, `@fastify/view` (Nunjucks), and `@fastify/csrf-protection` for the admin UI; `AppOptions` includes optional `manifestRegistry`, `readyChecks`, `publicOptions` (`PublicOptions` with `resolutionService`, `productId`, and `tokenVerifier`), and `adminOptions` (`AdminOptions` with `service`, `verifier`, `productId`, and `registry`); conditionally registers the public plugin, the admin API plugin, and `adminUiPlugin` when their respective options are provided
- `src/server.ts`
  - process bootstrap: loads manifest, builds `ManifestRegistry`, registers drift check; resolves numeric `productId` via `upsertByName(env.DEFAULT_PRODUCT_ID)`; constructs `ConfigResolutionService` with three repositories; constructs `DefaultRevisionsRepository` and `AdminRulesService`; constructs `TokenVerifier` from env (`jwksUri`, `issuer`, `audience`, `jwksTimeoutMs`); passes `registry` into `adminOptions` so `adminUiPlugin` activates in production; passes both `publicOptions` and `adminOptions` to `createApp`, then calls `listen()`
- `src/config/env.ts`
  - full stage-1 zod schema for all env variables; includes `SSO_JWKS_TIMEOUT_MS` (default 3000 ms), `ADMIN_COOKIE_SECRET` (required in staging/production, used by `@fastify/csrf-protection`), and a `superRefine` cross-field check that requires `SSO_ISSUER` and `SSO_AUDIENCE` when `SSO_JWKS_URI` is set in staging/production; throws on invalid values
- `src/shared/logger.ts`
  - pino logger factory with redaction config for sensitive fields
- `src/modules/health/index.ts`
  - Fastify health plugin; registers GET /health/live (always 200) and GET /health/ready (200/503 with injectable ReadyCheck array)

## `src/db`

- `src/db/knex.ts`
  - Knex instance factory and process-scoped singleton; selects SQLite for test/dev, PostgreSQL for production
- `src/db/transaction.ts`
  - `withTransaction` helper; wraps a callback in a Knex transaction with automatic commit/rollback

## `src/db/migrations`

- `src/db/migrations/001_create_products.ts`
  - creates the `products` table (id, slug, name, timestamps)
- `src/db/migrations/002_create_feature_definitions.ts`
  - creates the `feature_definitions` table (key, product_id, default value, payload schema, remote_capable flag)
- `src/db/migrations/003_create_feature_rules.ts`
  - creates the `feature_rules` table (definition_id, conditions, override value, priority, timestamps)
- `src/db/migrations/004_create_config_revisions.ts`
  - creates the `config_revisions` table (product_id, monotonic revision counter, snapshot, timestamps)

## `src/modules/products`

- `src/modules/products/repository.ts`
  - `ProductsRepository` interface and `DefaultProductsRepository`; CRUD over the `products` table

## `src/modules/definitions`

- `src/modules/definitions/repository.ts`
  - `DefinitionsRepository` interface and `DefaultDefinitionsRepository`; reads and writes `feature_definitions` rows

## `src/modules/rules`

- `src/modules/rules/repository.ts`
  - `RulesRepository` interface and `DefaultRulesRepository`; reads and writes `feature_rules` rows; `listAllActive(productId)` added in Task 6 to return all active rules across all feature keys for a product (used by the resolution service)

## `src/modules/revisions`

- `src/modules/revisions/repository.ts`
  - `RevisionsRepository` interface and `DefaultRevisionsRepository`; advances the monotonic revision and stores config snapshots

## `src/modules/manifest`

- `src/modules/manifest/schema.ts`
  - zod schemas for manifest validation; exports `Manifest`, `ManifestFeature`, `ManifestProduct` types
- `src/modules/manifest/loader.ts`
  - `loadManifest(path)`: synchronous file read, JSON parse, zod validation, SHA-256 hash, `remoteCapable` filter; returns `LoadManifestResult`
- `src/modules/manifest/registry.ts`
  - `ManifestRegistry`: in-memory map of `remoteCapable` definitions keyed by feature key; exposes `load()`, `getAll()`, `getByKey()`, `hasKey()`, `readyCheck()`
- `src/modules/manifest/sync.ts`
  - `ManifestSyncService`: fully transactional `sync()` upserts active definitions and archives removed keys; `driftReadyCheck()` verifies DB hash matches loaded manifest hash at startup

## `src/modules/dependencies`

- `src/modules/dependencies/repository.ts`
  - `DependenciesRepository` interface and `DefaultDependenciesRepository`; CRUD over the `flag_dependencies` table: `add`, `remove`, `findById`, `listByProduct`, `findEdge`
- `src/modules/dependencies/cycle.ts`
  - `wouldCreateCycle(edges, parentKey, childKey)`: pure function that builds an adjacency map from existing edges and runs a DFS to detect whether adding the proposed edge would introduce a cycle

## `src/modules/config-resolution`

- `src/modules/config-resolution/types.ts`
  - shared domain types: `AuthState`, `Platform`, `RequestContext` (auth state + platform + app version), `ResolvedEntry` (feature value shape), `CompiledSnapshot` (full resolved map for a product at a given revision with TTL)
- `src/modules/config-resolution/specificity.ts`
  - rule matching and specificity scoring logic: `ruleMatchesContext` (audience, platform, semver range checks), `computeSpecificity` (score = authScore×100 + platformScore×10 + versionBoundCount), `selectBestRule` (highest-score winner; narrower range wins ties), `doRulesOverlap` (semver range intersection test), `detectAmbiguousOverlap` (finds same-audience+same-platform rules with overlapping version ranges)
- `src/modules/config-resolution/service.ts`
  - `ConfigResolutionService`: `buildRawSnapshot` (loads definitions and rules from DB, parses all JSON once, stores result as a Promise keyed by `productId:revision` to prevent cache stampede), `resolveConfig` (returns a full `CompiledSnapshot` for a `RequestContext` using `selectBestRule` per feature key), `invalidateCache` (removes all cached entries for a product by prefix scan), `rebuildSnapshot` (invalidate then reload)

## `src/modules/auth`

- `src/modules/auth/token-verifier.ts`
  - `TokenVerifier` interface with a single async `verify(authHeader)` method returning `AuthResult`; `AuthResult` includes `state`, optional `sub`, and optional `roles?: string[]` (extracted from JWT payload on authenticated results); `createTokenVerifier` factory wiring `jose` JWKS verification with configurable `issuer`, `audience`, and `jwksTimeoutDuration`; `TokenInvalidError` (maps to 401) and `InfraError` (maps to 503) error classes; four-scenario discrimination: no header → anonymous, valid bearer → authenticated with decoded claims, invalid/expired/malformed bearer → `TokenInvalidError`, JWKS/network failure → `InfraError`

## `src/modules/public`

- `src/modules/public/schemas.ts`
  - Fastify JSON Schema objects for the public route: `featureConfigHeaders` (Platform enum, AppName, AppVersion required; Authorization optional) and `featureConfigResponse200` (version integer, ttl integer, features map with required `isEnabled` per entry)
- `src/modules/public/index.ts`
  - Fastify plugin (`publicPlugin`) registering `GET /api/v1/feature-config`; accepts `resolutionService`, `productId`, and `tokenVerifier` as plugin options; calls `tokenVerifier.verify()` on the Authorization header and maps `TokenInvalidError` to 401 and `InfraError` to 503; builds `RequestContext` with the resolved `AuthState`; calls `resolveConfig`; sets `Cache-Control: no-store` on 200 responses

## `src/modules/admin`

- `src/modules/admin/auth.ts`
  - `makeAdminAuthHook(verifier, requiredRole)`: returns a Fastify `preHandler` that enforces RBAC; anonymous → 401, `TokenInvalidError` → 401, `InfraError` → 503, wrong role → 403; attaches `adminRole` and `adminSub` to the request on success; exports `ROLE_VIEWER` (`feature-toggle-viewer`), `ROLE_EDITOR` (`feature-toggle-editor`), and `AdminRole` type; viewer permission is satisfied by either role, editor permission requires `ROLE_EDITOR` only
- `src/modules/admin/service.ts`
  - `AdminRulesService`: eight methods — `createRule`, `updateRule`, `disableRule`, `listRules`, `getRule`, `previewConfig` (resolves a full config snapshot for a given `RequestContext` without going through the public route), `listRevisions` (returns the most recent revision rows for a product, limit configurable), `getCurrentRevision(productId)` (returns the current monotonic revision number for use by the admin UI); each write validates registry key presence, non-empty reason, `entry_json` fields against manifest payload schema, and ambiguous overlap via `detectAmbiguousOverlap`; all mutations run inside `withTransaction` (mutate rule → `updateRevision` → `insertRevision`) and call `invalidateCache` on success; `ConflictError` surfaces stale `expectedRevision` as 409; domain error classes: `ValidationError`, `ConflictError`, `NotFoundError`
- `src/modules/admin/routes.ts`
  - Fastify plugin (`adminPlugin`) registering seven routes: five under `/admin/api/rules` (`GET /` list ROLE_VIEWER, `GET /:id` single ROLE_VIEWER, `POST /` create ROLE_EDITOR → 201, `PATCH /:id` update ROLE_EDITOR → 200, `DELETE /:id` disable ROLE_EDITOR → 200) plus `GET /admin/api/preview` (ROLE_VIEWER, zod query: platform/appVersion/audience → full resolved config) and `GET /admin/api/revisions` (ROLE_VIEWER, zod query: limit → revision list); zod body/query validation on all routes; `handleServiceError` maps `ValidationError` → 400, `NotFoundError` → 404, `ConflictError` → 409; `AdminPluginOptions` accepts `service`, `verifier`, and `productId`
- `src/modules/admin/ui-routes.ts`
  - Fastify plugin (`adminUiPlugin`) serving server-rendered admin UI pages and POST form handlers; registers CSRF token endpoint, feature list, feature detail, create/edit/delete rule, preview context selector, and revision log routes; uses `@fastify/view` (Nunjucks), `@fastify/csrf-protection`, and HTMX partial responses; `AdminUiPluginOptions` accepts `service`, `verifier`, `productId`, and `registry`

## `tests/modules/config-resolution`

- `tests/modules/config-resolution/specificity.test.ts`
  - 32 unit tests covering `ruleMatchesContext`, `computeSpecificity`, `selectBestRule`, `doRulesOverlap`, and `detectAmbiguousOverlap`; exercises all dimension combinations and tie-break paths
- `tests/modules/config-resolution/service.test.ts`
  - 15 integration tests for `ConfigResolutionService` against an in-memory SQLite instance; covers cache sharing, cache invalidation, failed-load cleanup, default fallback, rule override selection, and `rebuildSnapshot`

## `tests`

- `tests/app.test.ts`
  - vitest suite: app instantiation, inject 404 on bare app, clean close
- `tests/config/env.test.ts`
  - 19 unit tests covering parseEnv validation branches (missing required vars, invalid types, defaults) plus 11 new cases for `SSO_JWKS_TIMEOUT_MS` default and cross-field SSO enforcement
- `tests/health.test.ts`
  - 7 integration tests for /health/live and /health/ready routes; includes 2 new manifest registry ready-check cases (unloaded → 503, loaded → 200)
- `tests/db/migrations.test.ts`
  - migration correctness and idempotency tests: up/down round-trip for all four migrations against an in-memory SQLite instance
- `tests/db/repositories.test.ts`
  - integration tests for all four repository implementations and the `withTransaction` helper against an in-memory SQLite instance
- `tests/modules/manifest/loader.test.ts`
  - unit tests for `loadManifest`: missing file, invalid JSON, schema violations, valid manifest parsing, hash stability, remoteCapable filter
- `tests/modules/manifest/registry.test.ts`
  - unit tests for `ManifestRegistry`: initial state, `load()` / `getAll()` / `getByKey()` / `hasKey()`, `readyCheck()` pass/fail
- `tests/modules/manifest/sync.test.ts`
  - integration tests for `ManifestSyncService.sync()`: upsert, archive of removed keys, hash update, `driftReadyCheck()` pass/fail
- `tests/modules/auth/token-verifier.test.ts`
  - 10 unit tests (TV-1 through TV-10) covering `TokenVerifier`: anonymous path (no header), authenticated path with valid token, `TokenInvalidError` for expired/malformed/invalid-audience tokens, `InfraError` for JWKS network failure, and mock verifier contract used by all public route tests
- `tests/modules/public/feature-config.test.ts`
  - 14 route integration tests via `fastify.inject()`: 4 header-validation cases (missing/invalid Platform, missing AppName, missing AppVersion → 400), 4 successful 200 cases (features map present, Cache-Control header, all seeded keys returned, `isEnabled` field present), 5 auth cases (C1 updated anonymous → 200, C2 valid bearer → 200 authenticated, C3 invalid bearer → 401, C4 expired bearer → 401, C5 infra failure → 503), 1 internal error case (unknown productId → 500)

## `tests/modules/admin`

- `tests/modules/admin/service.test.ts`
  - 10 unit tests (U1–U10) for `AdminRulesService` using mocked repositories and a real in-memory SQLite instance; covers unknown feature key → `ValidationError`, empty reason → `ValidationError`, revision conflict → `ConflictError`, successful create with cache invalidation, inactive rule → `NotFoundError`, cross-product rule access → `NotFoundError`, successful update with cache invalidation, already-inactive disable → `NotFoundError`, successful disable with cache invalidation, and unknown `entry_json` field against manifest schema → `ValidationError`
- `tests/modules/admin/routes.test.ts`
  - route integration tests via `fastify.inject()` against an in-memory SQLite instance; groups: H (H1–H8, auth boundary), V (V1–V10, validation), ZB (ZB1–ZB5, zod schema), CI1 (cache invalidation), B1 (full CRUD round-trip), S1 (`changedBy` is JWT `sub`); extended in Task 10 with PR1–PR13 (preview endpoint: auth, query validation, resolution correctness) and RV1–RV8 (revisions endpoint: auth, limit param, ordering, empty list)
- `tests/modules/admin/preview-parity.test.ts`
  - 6 PAR parity tests (PAR1–PAR6) verifying that `GET /admin/api/preview` and `GET /api/v1/feature-config` return identical `version`, `ttl`, and `features` for matched inputs; covers baseline no-rule case, rule matching anonymous ios, authenticated android, anonymous audience isolation, cross-platform divergence, and revision advancement after a write

## `src/views`

- `src/views/layout.njk`
  - base Nunjucks layout with shared navigation, title block, and HTMX script include
- `src/views/features.njk`
  - admin page listing all remote-capable feature definitions for a product
- `src/views/feature.njk`
  - admin page showing feature detail (metadata, default value) and its active rules list
- `src/views/rule-form.njk`
  - create/edit rule form; renders in create or edit mode depending on `editMode` context variable
- `src/views/preview.njk`
  - preview context selector page; submits via HTMX to load resolved config inline
- `src/views/preview-partial.njk`
  - HTMX partial rendered in response to the preview form submission; shows resolved feature table or error message
- `src/views/revisions.njk`
  - revision audit log page listing recent config revisions with timestamps and changedBy
- `src/views/error.njk`
  - generic error page rendered by the admin UI error handler; displays statusCode and message

## `tests/modules/admin` (continued)

- `tests/modules/admin/ui-routes.test.ts`
  - 22 `fastify.inject()` tests (groups UI-H auth boundary, UI-C CSRF, UI-V validation, UI-R rule CRUD pages, UI-QT preview query, UI-S service error mapping) for `adminUiPlugin` against an in-memory SQLite instance

## `tests/modules/hardening`

- `tests/modules/hardening/helpers.ts`
  - shared helpers for hardening-focused integration tests, including app bootstrap with env overrides and request helpers
- `tests/modules/hardening/rate-limit.test.ts`
  - integration tests for public/admin rate limiting and per-contour limits
- `tests/modules/hardening/security-headers.test.ts`
  - integration tests for `@fastify/helmet` response headers on public and admin routes
- `tests/modules/hardening/cors.test.ts`
  - integration tests for `@fastify/cors` behavior on the public contour and its absence on admin routes

## `tests/e2e`

- `tests/e2e/admin-ui.spec.ts`
  - 9 Playwright E2E tests (E2E-1 through E2E-9) covering admin UI navigation, rule create/edit/delete flows, and preview page resolution via a real Chromium browser
- `tests/e2e/server-helper.ts`
  - `startE2EServer` / `E2EServer`: spins up a full `createApp` instance against an in-memory SQLite DB with seeded manifest data for Playwright tests; exports `EDITOR_TOKEN` constant
- `tests/e2e/global-setup.ts`
  - Playwright global setup: starts the E2E server and stores the instance on `globalThis` for teardown access
- `tests/e2e/global-teardown.ts`
  - Playwright global teardown: stops the E2E server started by `global-setup.ts`

## Root Config Files (continued)

- `playwright.config.ts`
  - Playwright configuration: `testDir` set to `tests/e2e`, chromium project, `baseURL` at `http://127.0.0.1:3099`, wires `global-setup.ts` and `global-teardown.ts`

## Target Service Structure

The paths below are planned but not yet created. They represent the intended implementation layout for stage-1.

- `src/shared/*`
  - shared errors, logging, security, and narrow utilities
