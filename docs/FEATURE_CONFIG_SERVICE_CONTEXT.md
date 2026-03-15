# Feature Config Service Context

Recovered context for the backend implementation of Elph Nova feature toggles stage-1.

## Authoritative Sources

The primary source documents currently live in the neighboring iOS repository:

- `../elph-nova-ios/features/featuretoggles/stage-1/server-mvp-plan.md`
- `../elph-nova-ios/features/featuretoggles/stage-1/server-implementation-plan.md`
- `../elph-nova-ios/features/featuretoggles/stage-1/server-architecture.md`
- `../elph-nova-ios/features/featuretoggles/stage-1/server-spec.md`
- `../elph-nova-ios/features/featuretoggles/stage-1/api-contract.md`
- `../elph-nova-ios/features/featuretoggles/stage-1/server-deployment-guide.md`
- `../elph-nova-ios/features/featuretoggles/stage-1/server-test-plan.md`
- `../elph-nova-ios/features/featuretoggles/stage-1/api.yaml`
- `../elph-nova-ios/features/featuretoggles/stage-1/CLAUDE_CODE_IMPLEMENTATION_BRIEF.md`

Use those documents as the authority if any summary below drifts.

## Product Goal

Stage-1 delivers a standalone Node.js service that:

- stores server-side feature toggle rules,
- syncs feature definitions from the product manifest,
- returns a resolved `FeatureConfig` to clients,
- supports anonymous and authenticated requests,
- exposes a simple but safe admin interface,
- can run first as a standalone host and later behind a contour ingress without changing the API contract.

## Agreed Technical Baseline

- Runtime: Node.js 20 + TypeScript
- HTTP: Fastify
- DB: PostgreSQL
- Local dev DB: SQLite only
- Migrations/query layer: Knex
- JWT/JWKS: `jose`
- Validation: `zod`
- Admin UI: Fastify View + Nunjucks + HTMX
- Logging: `pino`
- Version matching: `semver`

## Core Functional Requirements

- Public API endpoint: `GET /api/v1/feature-config`
- Required request headers:
  - `Platform`
  - `AppName`
  - `AppVersion`
- Optional request header:
  - `Authorization: Bearer ...`
- Response:
  - monotonic `version`
  - root `ttl`
  - full resolved `features` map for all remote-capable keys

## Auth Semantics That Must Not Drift

- No `Authorization` header: anonymous config
- Valid bearer token: authenticated config
- Invalid, expired, or malformed token: `401`
- Token verification unavailable because of infrastructure/JWKS failure: `5xx`

Never silently downgrade a bad token to public config.

## Manifest-First Rules

- The manifest is the source of truth for keys, defaults, and payload schema.
- Only `remoteCapable` keys are imported into the backend.
- Admins do not create feature keys manually.
- Manifest sync is an explicit operator step, not hidden startup side effect.
- Manifest drift should affect readiness if the synced state is stale.

## Data Model Expectations

Stage-1 separates:

- `products`
- `feature_definitions`
- `feature_rules`
- `config_revisions`

Definitions come from the manifest, rules come from admin writes, and revisions are immutable history.

## Resolution Model

For each feature key:

1. start from the manifest default entry,
2. find the most specific active rule matching audience, platform, and app version,
3. replace the default entry with the selected rule if found,
4. emit the resolved feature entry in the response.

## Runtime And Cache Rules

- Public reads should serve from a compiled in-memory snapshot when the current revision is unchanged.
- Cache invalidation must follow successful admin mutations.
- Multi-instance deployment can poll the current revision; `LISTEN/NOTIFY` is optional for stage-1.

## Admin Write Rules

- Admin writes must include `expectedRevision`.
- If the underlying revision changed, the service must return `409 Conflict`.
- The admin UI is intentionally simple and server-rendered.
- The admin contour must stay separate from the public endpoint.

## Deployment Modes

- Local development:
  - loopback only,
  - SQLite or local PostgreSQL,
  - dev-only admin auth allowed only locally.
- Standalone rollout:
  - separate public HTTPS host,
  - PostgreSQL,
  - admin protected by SSH tunnel, VPN, or internal host.
- Contour rollout:
  - same service and same API,
  - different ingress topology only.

Конкретный URL, модель доступа к admin на test host, маппинг SSO claims (viewer/editor), и способ доставки manifest artifact зафиксированы в `docs/DELIVERY_CONTOUR.md`.

## Initial Target Repository Shape

The stage-1 documents align on this initial structure:

```text
feature-config-service/
├── src/
│   ├── app.ts
│   ├── server.ts
│   ├── config/
│   ├── db/
│   ├── modules/
│   ├── views/
│   └── shared/
├── scripts/
├── package.json
├── knexfile.ts
└── Dockerfile
```

The exact folder map adapted for this repository is documented in `docs/PROJECT_ARCHITECTURE.md` and `docs/REPO_MAP.md`.

## Phase Sequence From The Server Plan

1. Fix rollout assumptions and service discovery.
2. Build the service skeleton and infrastructure.
3. Implement DB schema and manifest sync.
4. Implement public read path and resolution.
5. Implement admin write path and revision flow.
6. Add admin UI.
7. Harden deployment, docs, and verification.

## Current Implementation State

Bootstrap is complete. The repository has:

- repo-local agent rules and subagent definitions,
- implementation and testing guides,
- coordinator prompts and workflow guidance,
- lightweight repo tooling for agent navigation and indexing.

Task 2 (runtime skeleton) is done: `src/app.ts`, `src/server.ts`, `src/config/env.ts`, `tests/app.test.ts`, `package.json`, `tsconfig.json`, and `vitest.config.ts` exist.

Task 3 (env/logging/health/lifecycle) is done: `src/config/env.ts` is expanded to the full stage-1 schema (all env vars including `LOG_LEVEL`, `TRUST_PROXY`, `DATABASE_URL`, `MANIFEST_PATH`, `DEFAULT_PRODUCT_ID`, `FEATURE_CONFIG_PUBLIC_BASE_URL`, `FEATURE_CONFIG_ADMIN_BASE_URL`, SSO vars, admin vars, `DEV_ADMIN_PASSWORD`, and `CORS_ALLOWED_ORIGINS`), health endpoints and process lifecycle scaffold are in place.

Task 4 (Knex, migrations, persistence foundation) is done: `knexfile.ts`, `src/db/knex.ts`, `src/db/transaction.ts`, four migrations (`products`, `feature_definitions`, `feature_rules`, `config_revisions`), and repository implementations for all four modules (`products`, `definitions`, `rules`, `revisions`) are in place. 27 migration and repository tests cover the persistence layer.

Task 5 (Manifest loader, registry, sync-manifest) is done: `src/modules/manifest/schema.ts` (zod manifest validation), `src/modules/manifest/loader.ts` (`loadManifest()` — synchronous file read, SHA-256 hash of raw JSON bytes, `remoteCapable` filter), `src/modules/manifest/registry.ts` (`ManifestRegistry` in-memory map, `readyCheck()` that fails with 503 if not loaded), `src/modules/manifest/sync.ts` (`ManifestSyncService.sync()` transactional upsert/archive, `driftReadyCheck()` that fails with 503 if `manifest_hash` in DB differs from current file hash), and `scripts/sync-manifest.ts` (standalone CLI operator entry point). `src/app.ts` `AppOptions` now accepts `manifestRegistry?: ManifestRegistry`; `src/server.ts` loads the manifest file, populates the registry, and registers the drift ready check at startup. The real iOS manifest contributes 25 `remoteCapable` keys. `sync-manifest` must be run after migrations and before starting the service; it requires `DATABASE_URL` and `MANIFEST_PATH` env vars.

Task 6 (Resolution engine, specificity, compiled cache) is done: `src/modules/config-resolution/types.ts` defines `AuthState`, `Platform`, `RequestContext`, `ResolvedEntry`, and `ParsedSnapshot`. `src/modules/config-resolution/specificity.ts` implements `ruleMatchesContext`, `computeSpecificity`, `selectBestRule`, `doRulesOverlap`, and `detectAmbiguousOverlap`. `src/modules/config-resolution/service.ts` is `ConfigResolutionService` with a Promise-based cache keyed by `productId:revision` (prevents cache stampede under concurrent requests), `invalidateCache`, and `rebuildSnapshot`; JSON parsing is done once at snapshot build time rather than per request. `src/modules/rules/repository.ts` gained `listAllActive(productId)` with `ORDER BY id ASC`. `invalidateCache` must be called after a write transaction commits, not inside it. `detectAmbiguousOverlap` is exposed for use in admin write validation (Task 9). 119 tests pass. No HTTP routes were added in Task 6; that is Task 7.

Task 7 (Public API, request context, wire response) is done: `src/modules/public/index.ts` is a Fastify plugin that registers `GET /api/v1/feature-config` with header validation for `Platform`, `AppName`, and `AppVersion` and sets `Cache-Control: no-store`. `src/modules/public/schemas.ts` defines the request and response shapes. The anonymous path is fully operational: absence of `Authorization` sets `authState='anonymous'`, calls `resolveConfig`, and returns the full features map in wire format (`version`, `ttl`, `features`). Server startup resolves the product via `upsertByName(env.DEFAULT_PRODUCT_ID)` and constructs `ConfigResolutionService`; the `driftReadyCheck` call was fixed to use the string product name rather than a numeric id. Live smoke confirmed a 25-key features response with `version:0` and `ttl:3600` derived from manifest defaults.

Task 8 (Client token verification, bearer auth semantics) is done: `src/modules/auth/token-verifier.ts` exports `createTokenVerifier`, `TokenVerifier`, `TokenInvalidError` (mapped to `401`), and `InfraError` (mapped to `503`); built on `jose` JWKS. The four auth scenarios — no token (anonymous), valid token (authenticated), invalid/expired/malformed token (`401`), JWKS/infra failure (`503`) — are all explicitly handled with no silent downgrade path. `SSO_JWKS_TIMEOUT_MS` (default 3000 ms) was added to env. A `superRefine` cross-field check enforces that `SSO_ISSUER` and `SSO_AUDIENCE` are present in staging and production. The public route stub was replaced with a real `verify()` call wired to the correct error mapping. 154 tests pass; typecheck is clean. Live smoke verified all four scenarios.

The remaining `src/` zones listed in the target structure are still to be built.
