# Feature Config Service Context

Recovered context for the backend implementation of Elph Nova feature toggles stage-1.

## Authoritative Sources

The primary source documents currently live in the neighboring iOS repository:

- `../elph-nova-ios/features/featuretoggles/stage-1/server-mvp-plan.md`
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

## What This Repository Is Setting Up First

Before production code starts, this repository now needs:

- repo-local agent rules,
- project subagents for implementation, review, investigation, and planning,
- repo-local implementation and testing guides,
- coordinator prompts and workflow guidance,
- lightweight repo tooling for agent navigation and indexing.
