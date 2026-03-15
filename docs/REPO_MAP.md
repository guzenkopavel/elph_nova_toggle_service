# Repository Map

Repository map for `elph_nova_toggle_service`.

Current state: Tasks 1–5 are complete. The files below reflect what exists now, plus an explicitly marked target structure for the remaining service implementation.

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
  - practical guide for multi-agent work in this repository
- `docs/SERVER_AGENT_PROMPTS.md`
  - ready coordinator prompts for implementation, bugs, and design work
- `docs/DELIVERY_CONTOUR.md`
  - delivery contour and service discovery contract: standalone URL, client baseURL discovery, admin access model, SSO role mapping, manifest artifact delivery, and smoke baseline for Tasks 2–12
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

## Root Config Files

- `package.json`
  - npm manifest, dependency declarations, and npm scripts
- `.env.example`
  - documented template of all supported environment variables
- `knexfile.ts`
  - Knex CLI entry point; exports named `development`, `test`, and `production` connection configs for migrations

## `src`

- `src/app.ts`
  - Fastify app factory (`createApp`); accepts optional `manifestRegistry` in `AppOptions` and auto-registers its `readyCheck()` alongside any other injectable checks
- `src/server.ts`
  - process bootstrap: loads manifest, builds `ManifestRegistry`, registers drift check, calls `createApp` then `listen()`
- `src/config/env.ts`
  - full stage-1 zod schema for all env variables; throws on invalid values, uses defaults for optional keys
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
  - `RulesRepository` interface and `DefaultRulesRepository`; reads and writes `feature_rules` rows

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

## `tests`

- `tests/app.test.ts`
  - vitest suite: app instantiation, inject 404 on bare app, clean close
- `tests/config/env.test.ts`
  - 8 unit tests covering parseEnv validation branches (missing required vars, invalid types, defaults)
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

## Target Service Structure

The paths below are planned but not yet created. They represent the intended implementation layout for stage-1.

- `src/modules/public/*`
  - public API routing, schemas, request context, serialization
- `src/modules/admin/*`
  - admin routes, forms, services, and auth integration
- `src/modules/auth/*`
  - JWT/JWKS verification and auth helpers
- `src/modules/config-resolution/*`
  - rule specificity, compilation, and response assembly
- `src/views/*`
  - Nunjucks templates for the admin UI
- `src/shared/*`
  - shared errors, logging, security, and narrow utilities
