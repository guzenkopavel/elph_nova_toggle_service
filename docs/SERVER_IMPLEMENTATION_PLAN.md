# Server Implementation Plan

Local companion plan for implementing `Feature Config Service` in this repository.

Source of truth:

- `../elph-nova-ios/features/featuretoggles/stage-1/server-mvp-plan.md`

Use this file as the repo-local implementation guide for agents. If it diverges from the stage-1 source document, update the source document first.

## Core Rule

Each phase is complete only when both the implementation work and the relevant verification work are done.

## Recommended Phase Sequence

### Phase 0. Rollout and discovery assumptions

Goal:

- lock down standalone-first rollout,
- pre-login and post-login service discovery,
- admin exposure model,
- SSO claims and roles.

Testing gate:

- document the assumed environments and smoke entry points before runtime work starts.

### Phase 1. Service skeleton and test harness

Goal:

- bootstrap Fastify app,
- env validation,
- logging,
- health endpoints,
- Knex wiring,
- Docker baseline,
- CI entry commands.

Mandatory testing output:

- test runner baseline,
- app factory suitable for integration tests,
- env parsing tests,
- `health/live` and `health/ready` checks,
- repeatable local smoke commands.

### Phase 2. DB schema and manifest sync

Goal:

- schema creation,
- `sync-manifest`,
- manifest hash tracking,
- archived keys,
- readiness linked to synced manifest state.

Mandatory testing output:

- migration checks,
- manifest sync tests,
- drift/readiness tests,
- remote-capable filtering checks.

### Phase 3. Public API and resolution engine

Goal:

- `GET /api/v1/feature-config`,
- request context,
- audience/platform/version matching,
- compiled cache,
- full resolved response.

Mandatory testing output:

- resolution unit tests,
- public route integration tests,
- auth semantics tests,
- contract checks against `api.yaml`,
- live smoke for anonymous, authenticated, and invalid-token flows.

### Phase 4. Admin write path and audit trail

Goal:

- admin auth and RBAC,
- CRUD for rules,
- preview endpoint,
- revision growth,
- audit trail,
- cache invalidation.

Mandatory testing output:

- rule mutation integration tests,
- `expectedRevision` / `409` tests,
- audit and revision checks,
- cache invalidation tests,
- preview/public parity checks.

### Phase 5. Admin UI

Goal:

- features list,
- feature details,
- rule forms,
- preview,
- revisions history,
- CSRF-protected server-rendered flows.

Mandatory testing output:

- SSR page tests,
- form validation tests,
- admin UI smoke for the affected flow,
- browser automation via Playwright once available,
- fallback HTTP/HTML smoke only as a temporary bridge.

### Phase 6. Production hardening

Goal:

- rate limits,
- security headers,
- CORS allow-list,
- graceful shutdown,
- backup/restore confidence,
- multi-instance cache behavior,
- deployment/recovery docs.

Mandatory testing output:

- pre-release happy-path smoke,
- security-related checks,
- multi-instance cache invalidation smoke,
- deployment guide verification.

## Delivery Rule

The safest execution order remains:

1. phases 0-3 for stable read path,
2. phase 4 for safe mutations,
3. phase 5 for operational admin UI,
4. phase 6 before broader rollout.

## Definition Of Done

A phase is not done unless:

- implementation matches the stage-1 design,
- relevant tests were added or updated,
- targeted automated checks were run,
- required live smoke was run,
- residual gaps are explicitly called out.

