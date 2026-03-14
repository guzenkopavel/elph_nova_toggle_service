# Multi-Agent Guide for elph_nova_toggle_service

Practical guide for working in multi-agent mode in this repository.

Date: March 2026

Before using the agent set, read:

- `../CLAUDE.md`
- `./FEATURE_CONFIG_SERVICE_CONTEXT.md`
- `./PROJECT_ARCHITECTURE.md`
- `./SERVER_IMPLEMENTATION_PLAN.md`
- `./SERVER_TEST_PLAN.md`
- `./REPO_MAP.md`
- `./SERVER_AGENT_PROMPTS.md`

Project-level subagents for this repository are stored in:

- `../.claude/agents`

## Why Multi-Agent Matters Here

This repository has a backend-specific mixed context:

- HTTP contract correctness
- SSO/JWKS token validation
- manifest-first data model
- admin/public boundary separation
- cache and revision invalidation
- DB migrations and operational scripts
- server-rendered admin UI instead of a separate frontend
- the need to test both API behavior and live admin flows

One general-purpose agent often tries to solve all of that at once and then:

- expands scope too far,
- mixes router, service, and repository concerns,
- misses auth semantics,
- forgets manifest sync invariants,
- breaks HTTP compatibility,
- verifies too broadly or not enough.

Multi-agent mode is useful here for the same reason as in the iOS repository:

- one agent writes code,
- the others narrow scope, review risky dimensions, verify, and keep docs accurate.

## Main Principle

### Single-Writer Rule

Only one agent writes production code at a time: `implementation-agent`.

Other agents may:

- analyze,
- review,
- verify,
- recommend,
- plan,
- investigate.

### No-Commit Rule

No agent should run `git commit` or any publishing action unless the user explicitly asks.

### Narrow-Scope Rule

Do not use one "super-agent" to search, design, implement, review, verify, and sync docs all at once.

This repository works better when each role stays narrow and explicit.

## Recommended Agent Sets

### Minimal Working Set

Use for most implementation tasks:

1. `repo-navigator`
2. `test-strategy-agent`
3. `implementation-agent`
4. `architecture-guard`
5. `async-runtime-guard`
6. `verifier-agent`
7. `qa-scenario-agent`

### Recommended Main Set

Best day-to-day baseline:

1. `repo-navigator`
2. optional `module-boundary-guard`
3. `test-strategy-agent`
4. `implementation-agent`
5. `architecture-guard`
6. `async-runtime-guard`
7. `api-contract-guard`
8. `auth-security-guard`
9. `persistence-manifest-guard`
10. `verifier-agent`
11. `qa-scenario-agent`
12. optional `repo-indexer`
13. optional `docs-sync-agent`

### Extended Set

For major features, large backend changes, or refactors:

1. `repo-navigator`
2. `module-boundary-guard`
3. `specification-writer`
4. `architecture-designer`
5. `implementation-planner`
6. `test-strategy-agent`
7. optional `refactor-planner`
8. `implementation-agent`
9. relevant review guards
10. `verifier-agent`
11. `qa-scenario-agent`
12. `repo-indexer`
13. `docs-sync-agent`

## Four Working Modes

## 1. Implementation Mode

Use when the task requires real code changes.

Baseline chain:

- `repo-navigator`
- optional `module-boundary-guard`
- `test-strategy-agent`
- `implementation-agent`
- relevant review guards
- `verifier-agent`
- `qa-scenario-agent`
- optional `repo-indexer`
- optional `docs-sync-agent`

Suggested guard usage:

- always: `architecture-guard`
- always for runtime code: `async-runtime-guard`
- when routes or schemas change: `api-contract-guard`
- when auth/admin/security changes: `auth-security-guard`
- when DB, manifest, revisions, or caching change: `persistence-manifest-guard`

Implementation mode rule:

- no non-trivial backend task is done until both automated verification and live smoke for the changed flow have been completed.

## 2. Specification / Design Mode

Use when the task is not yet about production code:

- new feature spec
- architecture design
- implementation plan
- rollout plan
- refactor design

Baseline chain:

- `repo-navigator`
- optional `module-boundary-guard`
- `specification-writer`
- `architecture-designer`
- `implementation-planner`
- optional `test-strategy-agent`
- optional `refactor-planner`
- optional `docs-sync-agent`

By default, this mode should not write production code unless the user explicitly changes direction.

## 3. Bug Investigation Mode

Use when the symptom is known but the root cause is not:

- wrong status code
- stale config behavior
- unexpected cache usage
- broken manifest sync
- auth regression
- incorrect audience/platform/version matching

Baseline chain:

- `repo-navigator`
- optional `module-boundary-guard`
- `bug-investigator`
- `test-strategy-agent` if a real fix is going to be implemented
- if a real fix is needed: `implementation-agent`
- relevant guards
- `verifier-agent` if code changed
- `qa-scenario-agent` if runtime behavior changed
- optional `repo-indexer`
- optional `docs-sync-agent`

Do not jump into code before reconstructing the real current flow.

## 4. Verification / QA Mode

Use when the main task is to validate an existing implementation, prepare for rollout, or prove that a recent change works end to end.

Baseline chain:

- `repo-navigator`
- `test-strategy-agent`
- `verifier-agent`
- `qa-scenario-agent`
- optional relevant guards if the validation discovers suspicious behavior

Use this mode for:

- pre-release smoke,
- admin UI validation,
- preview/public parity checks,
- targeted regression verification,
- handoff confidence before rollout.

## Role Summary

### `repo-navigator`

Find the smallest correct subsystem and file set.

### `module-boundary-guard`

Recommend whether logic belongs in a router, service, repository, manifest module, shared utility, view, or script.

### `implementation-agent`

Single writer for code changes.

### `test-strategy-agent`

Defines the minimum required unit, integration, contract, admin UI, and runtime smoke coverage for the scoped change.

### `architecture-guard`

Protect layer boundaries and architectural fit.

### `async-runtime-guard`

Protect request lifecycle, async control flow, cache invalidation, and event-loop safety.

### `api-contract-guard`

Protect HTTP contract behavior and response semantics.

### `auth-security-guard`

Protect token semantics, admin/public separation, and security-sensitive behavior.

### `persistence-manifest-guard`

Protect migrations, manifest sync, revisions, and persistence correctness.

### `verifier-agent`

Run the narrowest meaningful checks.

### `qa-scenario-agent`

Run live smoke scenarios against the local service and the affected public/admin flows.

### Planning Agents

- `specification-writer`
- `architecture-designer`
- `implementation-planner`
- `refactor-planner`

### Support Agents

- `bug-investigator`
- `test-strategy-agent`
- `qa-scenario-agent`
- `repo-indexer`
- `docs-sync-agent`

## Practical Workflow Notes

- Start with a narrow scope even if the repository is still small.
- Keep the public API path and admin path mentally separate.
- If a task touches auth semantics, treat it as high risk even if the code change is small.
- If a task touches manifest sync or migrations, review persistence behavior before assuming the change is safe.
- If a task touches admin UI, preview, or write flows, require live smoke in addition to automated tests.
- If a task changes docs or structure, keep the map and prompt docs aligned so the next agent starts with accurate context.
