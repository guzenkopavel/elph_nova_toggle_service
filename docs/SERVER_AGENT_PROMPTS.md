# Backend Agent Prompts

Ready coordinator prompts for terminal-first agents working in `elph_nova_toggle_service`.

Date: March 2026

Before using these prompts, read:

- `../CLAUDE.md`
- `./FEATURE_CONFIG_SERVICE_CONTEXT.md`
- `./PROJECT_ARCHITECTURE.md`
- `./SERVER_IMPLEMENTATION_PLAN.md`
- `./SERVER_TEST_PLAN.md`
- `./DELIVERY_CONTOUR.md`
- `./DELIVERY_CHANGELOG.md`
- `./REPO_MAP.md`

This repository follows the same multi-agent philosophy as `elph-nova-ios`, but adapted for a Node.js service.

## Five Main Branches

1. Implementation
2. Bugs
3. Specification and design
4. Verification and QA
5. Deep review

## Branch 1. Implementation

Use this branch when the task is already about production code: routes, services, auth, DB, manifest sync, admin UI, scripts, or infrastructure wiring.

### Baseline Coordinator Prompt

```text
Work in the `elph_nova_toggle_service` repository as the coordinator for the backend implementation workflow.

Use project subagents from `.claude/agents` if they are available.

Use these agents as needed:
- `repo-navigator`
- `module-boundary-guard`
- `test-strategy-agent`
- `implementation-agent`
- `architecture-guard`
- `async-runtime-guard`
- `api-contract-guard`
- `auth-security-guard`
- `persistence-manifest-guard`
- `verifier-agent`
- `qa-scenario-agent`
- `repo-indexer`
- `docs-sync-agent`
- `delivery-log-agent`

Main rules:
- production code is written only by `implementation-agent`;
- nobody runs `git commit` unless the user explicitly asks;
- preserve the stage-1 backend invariants from `CLAUDE.md` and `docs/FEATURE_CONFIG_SERVICE_CONTEXT.md`;
- treat tests and live smoke as part of implementation, not as optional follow-up;
- if the root cause is unclear, switch to the bug workflow instead of patching on guesswork.

My task:
<insert task>

Workflow:
1. Call `repo-navigator`:
- narrow the task to one subsystem;
- use `CLAUDE.md`, `docs/REPO_MAP.md`, and `docs/CODEBASE_INDEX.md` if needed;
- find up to 8 relevant files;
- name nearby zones that should not be touched.

2. If placement is unclear, call `module-boundary-guard`.

3. Call `test-strategy-agent`:
- define the minimum required test matrix for the change;
- identify whether unit, integration, contract, admin UI browser automation, and runtime smoke are required;
- explicitly call out preview/public parity checks when relevant.

4. Pass the scoped task to the single writer `implementation-agent`.

5. During implementation preserve these backend rules:
- manifest-first definitions;
- no silent invalid-token downgrade to anonymous config;
- full resolved response instead of override-only response;
- `expectedRevision` and `409 Conflict` on stale writes;
- public/admin boundary separation;
- server-rendered admin UI by default;
- explicit cache invalidation or rebuild after writes;
- narrow repository/service/router responsibilities;
- code and tests must be updated together for behavior changes.
- if automated tests for the changed flow do not exist yet, add them in the same task whenever feasible.

6. After changes run the relevant guards:
- always `architecture-guard`;
- `async-runtime-guard` for request lifecycle, async, cache, or service logic;
- `api-contract-guard` if routes, schemas, status codes, headers, or response shape changed;
- `auth-security-guard` if auth, admin access, security, or token semantics changed;
- `persistence-manifest-guard` if migrations, repos, revisions, manifest sync, or cache compilation changed.

7. Then call `verifier-agent` and run only the narrowest relevant automated verification.

8. Then call `qa-scenario-agent`:
- start the local service or test environment if runtime behavior changed;
- smoke the affected public/admin flow end to end;
- if admin UI exists and was touched, exercise the real UI flow;
- verify preview/public parity when applicable.
- prefer repeatable automation for these scenarios, not permanent manual smoke.

9. If new files or folders were added, call `repo-indexer`.

10. If project rules, structure, or docs became stale, call `docs-sync-agent`.

11. If the task materially changed rollout shape, delivery contour, security semantics, testing baseline, or implementation state, call `delivery-log-agent`.

Response format:
1. Scope
2. Plan
3. Implementation
4. Review
5. Verification
6. Risks
```

### Short Version

```text
Work in `elph_nova_toggle_service` using the backend implementation workflow.

Task:
<insert task>

Start with `repo-navigator`, optionally use `module-boundary-guard`, then hand the scoped change to the single writer `implementation-agent`.

After implementation:
- run `test-strategy-agent` before or during the change to define coverage;
- run `architecture-guard` and `async-runtime-guard`;
- add `api-contract-guard`, `auth-security-guard`, and `persistence-manifest-guard` when relevant;
- run `verifier-agent`;
- run `qa-scenario-agent` for live smoke when runtime behavior changed;
- use `repo-indexer` if files were added;
- use `docs-sync-agent` if rules or structure changed.
- use `delivery-log-agent` if a material stage-1 or rollout delta should be visible in one place.

Preserve manifest-first behavior, exact auth semantics, full resolved config responses, revision-safe writes, public/admin separation, testing-first implementation, repeatable automation for critical flows, and no commits unless explicitly requested.
```

## Branch 2. Bugs

Use this branch when the symptom is known but the real cause is not yet proven.

### Baseline Coordinator Prompt

```text
Work in the `elph_nova_toggle_service` repository as the coordinator for the backend bug investigation workflow.

Use project subagents from `.claude/agents` if they are available.

Use these agents as needed:
- `repo-navigator`
- `module-boundary-guard`
- `bug-investigator`
- `test-strategy-agent`
- `implementation-agent` only if a real fix is needed after investigation
- `architecture-guard`
- `async-runtime-guard`
- `api-contract-guard`
- `auth-security-guard`
- `persistence-manifest-guard`
- `verifier-agent`
- `qa-scenario-agent`
- `repo-indexer`
- `docs-sync-agent`
- `delivery-log-agent`

Main rules:
- investigate first, then code;
- do not fix the bug based on the first plausible hypothesis;
- if the user asks only for investigation, stop at diagnosis and targeted fix proposal;
- nobody runs `git commit` unless the user explicitly asks.

My task:
<insert task>

Workflow:
1. Call `repo-navigator`:
- identify the correct subsystem;
- list up to 8 relevant files;
- name nearby risky zones that should not be touched.

2. If placement or ownership is unclear, call `module-boundary-guard`.

3. Call `bug-investigator`:
- start from concrete symptom keywords like endpoint path, status code, feature key, revision, cache key, migration name, admin action, or log fragment;
- reconstruct the current router -> auth -> validation -> service -> repository -> cache -> DB flow;
- check token handling, manifest drift, version matching, transaction boundaries, cache invalidation, and public/admin separation when relevant;
- name the most likely failure modes;
- choose the most probable root cause or clearly state the top hypotheses;
- propose the smallest fix surface that fits the current architecture.

4. If the user requested investigation only, stop at diagnosis.

5. If a real fix is needed:
- call `test-strategy-agent` to define the required coverage;
- pass the scoped result to `implementation-agent`.

6. After the fix, run the relevant guards, then `verifier-agent`, then `qa-scenario-agent` if runtime behavior changed.

7. If the task added files, call `repo-indexer`.

8. If the fix changed real stage-1 behavior, rollout assumptions, testing baseline, or implementation state, call `delivery-log-agent`.

Response format:
1. Scope
2. Diagnosis
3. Plan
4. Implementation
5. Review
6. Verification
7. Risks
```

### Short Version

```text
Work in `elph_nova_toggle_service` using the backend bug workflow.

Task:
<insert task>

Start with `repo-navigator`, then always use `bug-investigator`. Reconstruct the real current flow, list the most likely failure modes, and define the minimal safe fix surface before any production edits.

If a fix is required, only then hand the scoped task to `implementation-agent`, run the relevant guards, and finish with `verifier-agent`.

Do not patch on guesswork, define the required automated test coverage before implementing the fix, use `delivery-log-agent` if the fix changes material stage-1 behavior or rollout assumptions, and do not commit unless explicitly requested.
```

## Branch 3. Specification And Design

Use this branch when production code is not the goal yet: feature spec, architecture, rollout plan, or implementation planning.

### Baseline Coordinator Prompt

```text
Work in the `elph_nova_toggle_service` repository as the coordinator for the backend specification/design workflow.

Use project subagents from `.claude/agents` if they are available.

Use these agents as needed:
- `repo-navigator`
- `module-boundary-guard`
- `specification-writer`
- `architecture-designer`
- `implementation-planner`
- `test-strategy-agent`
- `refactor-planner`
- `repo-indexer`
- `docs-sync-agent`
- `delivery-log-agent`

Main rules:
- do not write production code by default;
- anchor the design in the recovered stage-1 backend context, not in generic backend ideals;
- preserve the service invariants unless the user explicitly wants to change them;
- nobody runs `git commit` unless the user explicitly asks.

My task:
<insert task>

Workflow:
1. Call `repo-navigator` and narrow the scope.
2. If placement is unclear, call `module-boundary-guard`.
3. Use planning agents as appropriate:
- `specification-writer` for goal, scope, requirements, non-goals, and acceptance criteria;
- `architecture-designer` for module boundaries, flow, interfaces, cache/auth/persistence behavior, and deployment shape;
- `implementation-planner` for phased execution with per-phase verification gates;
- `test-strategy-agent` for required testing layers and rollout confidence checks;
- `refactor-planner` for staged refactor or migration design.
4. Do not switch to production coding unless the user explicitly changes mode.
5. If the result should live in the repo, update docs and use `docs-sync-agent` when helpful.
6. If the design materially changes rollout, delivery contour, defaults, security assumptions, testing baseline, or implementation state, call `delivery-log-agent`.

Response format:
1. Scope
2. Goal / Current Context
3. Spec or Target Design
4. Plan / Phases
5. Risks / Open Questions
```

### Short Version

```text
Work in `elph_nova_toggle_service` using the backend specification/design workflow.

Task:
<insert task>

Start with `repo-navigator`, optionally use `module-boundary-guard`, then use `specification-writer`, `architecture-designer`, `implementation-planner`, and `refactor-planner` as needed.

Do not write production code by default. Keep the work grounded in the stage-1 backend plan, include the required testing strategy, update docs if the resulting design should live in the repository, and use `delivery-log-agent` when a material stage-1 delta should be visible in one place.
```

## Branch 4. Verification And QA

Use this branch when the main goal is to validate behavior, prepare for rollout, or check that a recent implementation really works end to end.

### Baseline Coordinator Prompt

```text
Work in the `elph_nova_toggle_service` repository as the coordinator for backend verification and QA workflow.

Use project subagents from `.claude/agents` if they are available.

Use these agents as needed:
- `repo-navigator`
- `test-strategy-agent`
- `verifier-agent`
- `qa-scenario-agent`
- relevant guards only if the verification uncovers suspicious behavior
- `docs-sync-agent` if the discovered workflow shows stale docs
- `delivery-log-agent` if the verification changes rollout or handoff assumptions

Main rules:
- verification is not just unit tests; include live smoke when runtime behavior matters;
- if admin UI exists and is affected, exercise the real admin flow;
- prefer repeatable automation for API/admin scenarios and use manual fallback only when the suite is not yet present;
- explicitly report verified vs unverified areas;
- nobody runs `git commit` unless the user explicitly asks.

My task:
<insert task>

Workflow:
1. Call `repo-navigator` and narrow the affected subsystem.
2. Call `test-strategy-agent` and define the exact checks needed.
3. Call `verifier-agent` for automated verification.
4. Call `qa-scenario-agent` for live smoke:
- public API;
- auth flows;
- admin UI;
- preview/public parity;
- rollout-critical happy path.
5. If the verification reveals likely bugs, either stop with findings or switch to the bug workflow.

Response format:
1. Scope
2. Verification plan
3. Automated checks
4. Live smoke
5. Findings or confidence statement
6. Residual risk
```

### Short Version

```text
Work in `elph_nova_toggle_service` using the verification/QA workflow.

Task:
<insert task>

Start with `repo-navigator`, then `test-strategy-agent`, then run `verifier-agent` for automated checks and `qa-scenario-agent` for live smoke of the affected flows, including admin UI and preview/public parity when relevant.

Report exactly what was verified and what remains unverified. If verification changes rollout or handoff assumptions, sync docs and use `delivery-log-agent`.
```

## Branch 5. Deep Review

Use this branch when the task is not to write code, but to assess whether a change or proposed solution is actually sound across code, architecture, request fit, rollout fit, and stage-1 backend history.

### Baseline Coordinator Prompt

```text
Work in the `elph_nova_toggle_service` repository as the coordinator for backend deep review workflow.

Use project subagents from `.claude/agents` if they are available.

Use these agents as needed:
- `repo-navigator`
- `module-boundary-guard`
- `deep-review-agent`
- `architecture-guard`
- `async-runtime-guard`
- `api-contract-guard`
- `auth-security-guard`
- `persistence-manifest-guard`
- `verifier-agent`

Main rules:
- do not write production code by default;
- do not form findings until the surrounding backend and stage-1 context has been raised;
- review not only the local code, but also request-fit, rollout-fit, testing-fit, and consistency with `docs/FEATURE_CONFIG_SERVICE_CONTEXT.md`, `docs/DELIVERY_CONTOUR.md`, and relevant stage-1 source docs;
- nobody runs `git commit` unless the user explicitly asks.

My task:
<insert task>

Workflow:
1. Call `repo-navigator` and narrow the scope.
2. If placement or subsystem ownership is unclear, call `module-boundary-guard`.
3. Call `deep-review-agent`:
- raise the backend and stage-1 context;
- identify what changed or what is being proposed;
- assess code-fit, architecture-fit, solution-fit, request-fit, and rollout-fit;
- check whether the solution contradicts source-of-truth docs or delivery assumptions;
- call out hidden regressions, verification gaps, or unnecessary complexity.
4. Then add narrow review guards by risk:
- `architecture-guard`
- `async-runtime-guard`
- `api-contract-guard`
- `auth-security-guard`
- `persistence-manifest-guard`
5. If needed, run `verifier-agent` to confirm whether targeted verification is sufficient.

Response format:
1. Scope
2. Context Reviewed
3. What Changed
4. Findings
5. Open Questions / Assumptions
6. Residual Risks
```

### Short Version

```text
Work in `elph_nova_toggle_service` using the backend deep review workflow.

Task:
<insert task>

Start with `repo-navigator`, then `deep-review-agent`. Raise the backend context, rollout assumptions, and relevant stage-1 docs before forming findings.

After that, run the narrow guards that match the risk area and use `verifier-agent` only if the review must confirm targeted verification.

Review not only local code quality, but also request-fit, architecture-fit, rollout-fit, and consistency with the stage-1 source-of-truth.
```
