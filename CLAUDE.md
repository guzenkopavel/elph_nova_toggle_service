# Claude Code Guide for elph_nova_toggle_service

This file defines repo-local rules for Claude Code and other terminal-first agents working in this repository.

If a model default conflicts with this file, the current repository structure, or the recovered stage-1 server context, prefer the local project context.

## Quick Context

- This repository is intended for the Node.js backend side of Elph Nova feature toggles stage-1.
- The authoritative design context was recovered from the neighboring iOS repository and summarized in:
  - `docs/FEATURE_CONFIG_SERVICE_CONTEXT.md`
  - `docs/PROJECT_ARCHITECTURE.md`
  - `docs/REPO_MAP.md`
- The original source documents still live in `../elph-nova-ios/features/featuretoggles/stage-1/`.

## Stack Baseline

Unless the user explicitly changes direction, prefer the agreed stage-1 stack:

- Node.js 20 + TypeScript
- Fastify
- Knex
- PostgreSQL in staging/production
- SQLite only for local development and smoke tests
- `jose` for JWT/JWKS validation
- `zod` for env and payload validation
- Nunjucks + HTMX for the admin UI
- `pino` for logging
- `semver` for app version matching
- `vitest` for unit/integration tests
- `fastify.inject()` for route-level integration checks
- `Playwright` for admin UI browser smoke once the admin UI exists

## What Matters More Than Generic Defaults

Do not optimize for generic backend fashion if it conflicts with the service plan.

- Do not turn invalid bearer tokens into anonymous/public config.
- Do not hardcode feature keys in server code.
- Do not allow creating new feature keys manually through admin flows.
- Do not merge manifest definitions and admin rules into one storage concept.
- Do not skip the explicit `sync-manifest` step by hiding sync in app startup.
- Do not build a SPA admin frontend unless the task explicitly changes the MVP direction.
- Do not return only rule overrides from the public API. Return the full resolved config.
- Do not mix admin-only logic into the public read path.
- Do not introduce generic repository/service/factory layers "for future use" without immediate value.
- Do not silently bypass revision checks on write flows.
- Do not use JSON-file or in-memory storage as a production solution.
- Do not make broad refactors when a narrow change inside the current module is safer.
- Do not run `git commit`, tags, or any publishing step unless the user explicitly asks.

## Stage-1 Invariants

These rules should be preserved unless the user explicitly asks to change the product architecture:

- Manifest-first:
  - The manifest is the source of truth for keys, defaults, and payload schema.
  - Only `remoteCapable` keys belong to this service.
- Public API semantics:
  - No `Authorization` header means anonymous config.
  - Valid bearer token means authenticated config.
  - Invalid, expired, or malformed bearer token means `401`.
  - Token verification infrastructure failure means `5xx`.
- Resolution semantics:
  - Responses must contain the complete resolved map of all remote-capable keys.
  - Manifest default is the baseline when no rule matches.
  - The most specific applicable rule wins.
- Persistence semantics:
  - Keep manifest definitions, admin rules, and immutable revisions as separate concerns.
  - Successful admin mutations must advance a monotonic revision.
  - Write flows must use `expectedRevision` and surface `409 Conflict` on stale writes.
- Runtime semantics:
  - The read path should prefer compiled in-memory snapshots keyed by revision.
  - Admin writes must invalidate or rebuild the local compiled cache.
- Admin contour:
  - Keep admin access separate from the public API path.
  - Prefer server-rendered admin pages and simple forms over a separate frontend project.

## How To Start Each Task

1. Narrow scope before editing.
2. Read only the smallest relevant set of files and docs.
3. Preserve the agreed service invariants above.
4. Make the smallest correct production-ready change.
5. Run the narrowest relevant verification.
6. Update docs only if they would otherwise become inaccurate.

## Testing Rules

Testing is part of implementation, not a later cleanup phase.

- A behavior change is incomplete without automated tests or an explicit reason why automated coverage is not yet possible.
- If public API behavior changes, run targeted tests and a live smoke of the affected endpoint.
- If auth behavior changes, verify anonymous, valid-token, and invalid-token paths separately.
- If manifest sync, migrations, revisions, or cache logic change, run integration-level checks rather than only unit tests.
- If the admin UI changes, the affected flow must be exercised through the UI:
  - prefer `Playwright` once it exists in the repository;
  - before that, use HTTP-level form submit and HTML assertions as a temporary fallback.
- When preview exists, verify preview/public parity for the same input parameters.
- Final task reporting must state what was tested, what was smoke-checked live, and what remains unverified.

## Bug Workflow

For bug work, investigate before patching.

- Start from concrete symptoms: endpoint, status code, feature key, revision behavior, cache path, migration name, admin action, or log fragment.
- Reconstruct the real request or mutation flow:
  - router
  - auth
  - validation
  - service
  - repository
  - cache
  - DB transaction
  - response mapping
- Check stale revision handling, cache invalidation, JWT validation, manifest drift, version matching, and admin/public boundary mistakes.
- Prefer the smallest fix that fits the existing architecture.

## Repository Zones

Current repository structure and intended runtime structure are indexed in `docs/REPO_MAP.md`.

Planned implementation zones:

- `src/config` for env/runtime configuration
- `src/db` for Knex and migrations
- `src/modules/public` for public API
- `src/modules/admin` for admin routes and admin services
- `src/modules/auth` for client/admin auth integration
- `src/modules/manifest` for manifest loading and sync
- `src/modules/config-resolution` for resolution and compiled snapshots
- `src/modules/definitions`, `src/modules/rules`, `src/modules/revisions` for persistence boundaries
- `src/views` for Nunjucks templates
- `src/shared` for shared errors, logging, and security helpers
- `scripts` for repo and service operational scripts

## Placement Rules

Prefer these boundaries:

- Router files:
  - HTTP schema, request parsing, response shape, status codes.
  - No business resolution logic beyond orchestration.
- Service files:
  - resolution logic, write orchestration, revision handling, cache invalidation.
- Repository files:
  - SQL/Knex access, transactions, storage mapping.
- `manifest` module:
  - manifest parsing, validation, synchronization.
- `shared`:
  - only cross-cutting utilities that are truly shared.
- `scripts`:
  - explicit operator workflows such as manifest sync or repo tooling.

## Validation And Security Rules

- Validate env, request payloads, and admin form inputs explicitly.
- Keep auth semantics precise; distinguish anonymous from invalid token.
- Prefer explicit status handling over catch-all fallbacks.
- Never leak admin-only behavior through public routes.
- Keep payload validation aligned with manifest schema.
- Treat app version matching as server behavior, not as a client assumption.

## Verification Rules

Prefer the narrowest correct verification:

- targeted unit tests for the touched module
- migration checks when DB schema changes
- route-level smoke checks when HTTP contract changes
- admin UI smoke when admin pages or forms change
- preview/public parity checks when preview or resolution behavior changes
- script-level verification for operational scripts
- typecheck/build only when it adds signal for the changed scope

If verification cannot run, explain why and what remains unverified.

## Documentation Rules

Keep the following docs aligned with reality when changes affect them:

- `CLAUDE.md`
- `docs/FEATURE_CONFIG_SERVICE_CONTEXT.md`
- `docs/PROJECT_ARCHITECTURE.md`
- `docs/REPO_MAP.md`
- `docs/CODEBASE_INDEX.md`
- `docs/SERVER_IMPLEMENTATION_PLAN.md`
- `docs/SERVER_TEST_PLAN.md`
- `docs/MULTI_AGENT_GUIDE.md`
- `docs/SERVER_AGENT_PROMPTS.md`
