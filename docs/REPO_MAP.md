# Repository Map

Repository map for `elph_nova_toggle_service`.

Current state: this repository is being bootstrapped. The files below reflect what exists now, plus an explicitly marked target structure for the upcoming service implementation.

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
- `docs/DOCUMENTATION_INDEX.md`
  - quick index of repository documentation
- `docs/README_DOCUMENTATION.md`
  - documentation entry point

## `scripts`

- `scripts/find-code.sh`
  - narrow repo search helper for agent workflows
- `scripts/find-unmapped-files.sh`
  - helper for repo-indexer to find files not yet mentioned in `docs/REPO_MAP.md`

## Target Service Structure

These paths do not necessarily exist yet. They are the intended implementation layout for stage-1.

- `src/app.ts`
  - Fastify app construction and high-level wiring
- `src/server.ts`
  - process bootstrap and HTTP start
- `src/config/env.ts`
  - typed env parsing and validation
- `src/db/knex.ts`
  - Knex setup
- `src/db/migrations/*`
  - schema migrations
- `src/modules/public/*`
  - public API routing, schemas, request context, serialization
- `src/modules/admin/*`
  - admin routes, forms, services, and auth integration
- `src/modules/auth/*`
  - JWT/JWKS verification and auth helpers
- `src/modules/manifest/*`
  - manifest loading, registry, and sync logic
- `src/modules/config-resolution/*`
  - rule specificity, compilation, and response assembly
- `src/modules/definitions/*`
  - definition persistence
- `src/modules/rules/*`
  - rule persistence
- `src/modules/revisions/*`
  - revision persistence and audit history
- `src/views/*`
  - Nunjucks templates for the admin UI
- `src/shared/*`
  - shared errors, logging, security, and narrow utilities
