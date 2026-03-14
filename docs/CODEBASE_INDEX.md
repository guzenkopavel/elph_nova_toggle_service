# Codebase Index

Deeper index for `elph_nova_toggle_service`.

This repository is still at the bootstrap stage, so the current index covers both real files and the agreed target zones that future implementation will fill.

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

## 2. Current Tooling Scripts

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

## 3. Planned Runtime Zones

These sections describe the implementation areas expected to appear next.

### `src/config`

- typed env config
- deployment-sensitive feature flags
- parse-once validation

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

## 4. Primary Backend Risks To Watch

- auth downgrade bugs
- manifest drift
- public/admin boundary leakage
- stale revision writes
- cache invalidation bugs
- schema drift between manifest, DB, and HTTP response
- under-tested admin UI flows
- preview/public mismatch
