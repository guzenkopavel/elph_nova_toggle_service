# Project Subagents

This directory contains project-level subagents for `elph_nova_toggle_service`.

These agents are meant to be used from the main conversation, which acts as the coordinator.

Recommended baseline:

1. `repo-navigator`
2. `test-strategy-agent`
3. `implementation-agent`
4. `architecture-guard`
5. `async-runtime-guard`
6. `verifier-agent`
7. `qa-scenario-agent`

Recommended backend baseline:

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

Important rules:

- `implementation-agent` is the single writer.
- Other agents analyze, review, verify, or recommend.
- No agent should run `git commit` unless the user explicitly asks.

Planning and design agents:

- `specification-writer`
- `architecture-designer`
- `implementation-planner`
- `refactor-planner`
- `test-strategy-agent`

Bug investigation agent:

- `bug-investigator`

Support agents:

- `qa-scenario-agent`
- `repo-indexer`
- `docs-sync-agent`

See also:

- `docs/MULTI_AGENT_GUIDE.md`
- `docs/SERVER_AGENT_PROMPTS.md`
- `CLAUDE.md`
