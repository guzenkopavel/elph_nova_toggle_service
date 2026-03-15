# Server Test Plan

Local test strategy for `Feature Config Service`.

Source of truth:

- `../elph-nova-ios/features/featuretoggles/stage-1/server-test-plan.md`

Use this file as the repo-local testing workflow for agents. If the strategy changes materially, update the stage-1 source document as well.

## Why This Exists

This service has several failure modes that are easy to miss if testing stops at unit level:

- invalid token incorrectly downgraded to anonymous config,
- preview not matching the real public response,
- manifest drift hidden until rollout,
- stale admin writes silently overwriting newer changes,
- admin UI rendering correctly but posting incorrect mutations.

Because of that, agent-driven implementation here must include both automated checks and live smoke verification.

Target state:

- public API is covered by repeatable automated tests,
- admin write path is covered by repeatable automated tests,
- admin UI critical flows are covered by repeatable browser automation,
- the agent can run the verification chain itself before handoff.

## Mandatory Agent Workflow

### 1. Define the test surface before editing

For every non-trivial task, decide which of these are required:

- unit tests,
- integration tests,
- contract checks,
- admin UI browser automation,
- runtime/deployment smoke.

### 2. Change code and tests together

If behavior changes, tests should be added or updated in the same task.

### 3. Run targeted automated checks

Prefer the narrowest meaningful set:

- unit tests for pure logic,
- route integration for HTTP behavior,
- repository/integration checks for DB behavior,
- contract checks when wire behavior changes.

### 4. Run live smoke for runtime changes

If the task changes:

- public API,
- auth behavior,
- manifest sync,
- admin mutation flow,
- admin UI,
- revision or cache behavior,

then the local service or test environment should be exercised directly.

### 5. Exercise the admin flow through the UI

When admin pages exist, do not stop at service-level assertions.

Preferred path:

- `Playwright` browser automation.

Temporary fallback until Playwright exists:

- HTTP-level form submit,
- HTML assertions,
- redirect/status checks,
- public API cross-check after mutation.

That fallback is temporary only. Final verification for implemented admin flows should live as repeatable automated browser tests.

### 6. Verify preview/public parity

Whenever preview or resolution behavior is touched, verify that preview and public API produce the same resolved output for equivalent inputs.

### 7. Report coverage explicitly

Final reporting should state:

- which commands ran,
- which live scenarios were exercised,
- what remains unverified.

## Recommended Testing Stack

- `vitest`
- `fastify.inject()`
- ephemeral PostgreSQL for integration checks
- `testcontainers` or a dedicated compose test DB
- `Playwright` for repeatable admin UI browser automation
- `curl` or equivalent for simple runtime smoke
- repeatable end-to-end API/admin scenario automation before rollout

## Minimum Test Matrix

### Env and bootstrap

- env parsing
- health endpoints
- readiness transitions

### Migrations and DB

- clean migration run
- repeated migration run
- basic integrity constraints

### Manifest sync

- import remote-capable keys only
- archive removed keys
- update manifest hash
- readiness on drift

### Resolution engine

- defaults without override
- audience/platform/version matching
- specificity ordering
- full resolved response

### Auth

- anonymous
- valid token
- invalid token -> `401`
- verifier/JWKS failure -> `5xx`

### Public API

- required headers
- response shape
- `version`
- `ttl`
- cache-control behavior

### Admin write path

- RBAC
- validation
- `expectedRevision`
- audit trail
- revision growth
- cache invalidation

### Admin UI

- feature list renders
- feature details render
- rule form submit works
- invalid form path shows validation errors
- revisions visible
- stale edit flow handled

### Runtime smoke

- restart without manifest drift
- preview/public parity
- core happy path before rollout

## Done Criteria For A Tested Change

- tests added or updated
- targeted automated checks run
- live smoke run when the task affects runtime behavior
- admin UI automated tests run when admin flows change
- critical affected flow is not left on manual-only verification if automation can be added now
- explicit note of remaining gaps
