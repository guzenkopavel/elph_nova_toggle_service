# Project Architecture

Target architecture for the stage-1 Feature Config Service in this repository.

This is a service-oriented architecture document, not a replacement for the upstream product spec.

## Architecture Goals

- keep the public read path simple and stable,
- keep admin writes explicit and revision-safe,
- keep manifest definitions as the source of truth,
- isolate auth, resolution, persistence, and rendering concerns,
- make the standalone rollout easy without locking the service into a one-off topology.

## Target Runtime Layout

```text
src/
├── app.ts
├── server.ts
├── config/
│   └── env.ts
├── db/
│   ├── knex.ts
│   └── migrations/
├── modules/
│   ├── public/
│   ├── admin/
│   ├── auth/
│   ├── manifest/
│   ├── config-resolution/
│   ├── definitions/
│   ├── rules/
│   └── revisions/
├── views/
└── shared/
```

## Layer Responsibilities

### App Layer

- `app.ts`
  - create and wire the Fastify app
  - register plugins, routers, logging, and shared services
- `server.ts`
  - process bootstrap only
  - start HTTP listening

### Config Layer

- `src/config/env.ts`
  - parse and validate environment
  - expose a typed config object

### DB Layer

- `src/db/knex.ts`
  - own Knex setup only
- `src/db/migrations/*`
  - own schema evolution

### Public Module

- request headers and context extraction
- auth-state derivation
- contract-safe status codes
- response serialization for the public API

### Admin Module

- admin routes and forms
- optimistic concurrency via `expectedRevision`
- admin auth, RBAC, and audit context
- rendering of server-side pages and partials

### Auth Module

- JWT/JWKS validation
- distinction between anonymous, invalid token, and verification failure
- shared auth helpers without leaking auth policy into unrelated modules

### Manifest Module

- load and validate the product manifest
- import definitions into the DB
- track manifest hash and archive removed keys

### Config Resolution Module

- assemble the resolved snapshot from manifest defaults and active rules
- choose the most specific applicable rule via explicit specificity ordering
- detect ambiguous overlap between rules of equal specificity (used by admin write validation in Task 9)
- maintain compiled in-memory snapshots keyed by `productId:revision`; the cache stores `Promise<ParsedSnapshot>` to prevent cache stampede under concurrent requests
- JSON parsing is done once at snapshot build time, not per request
- `invalidateCache` must be called after a write transaction commits, never inside it

### Definition, Rule, Revision Modules

- repository-level storage access
- transaction-safe persistence helpers
- no HTTP or rendering concerns

### Views

- Nunjucks templates for the admin UI only
- no client-side SPA boundary by default

### Shared

- small, reusable cross-cutting utilities
- shared errors
- logging helpers
- security helpers that do not belong to one module

## Public Read Flow

1. Fastify route validates required headers.
2. Request context resolves platform, app version, and auth state.
3. Auth module verifies bearer token when present.
4. Config resolution service loads or reuses the compiled snapshot for the current revision.
5. Service resolves the full feature map.
6. Route returns the wire response defined by the API contract.

## Admin Write Flow

1. Admin route validates auth and payload.
2. Admin service checks `expectedRevision`.
3. Rule changes are written transactionally.
4. A new immutable revision row is recorded.
5. Product current revision advances.
6. Local compiled cache is invalidated or rebuilt.
7. UI returns either success or `409 Conflict` semantics for stale writes.

## Manifest Sync Flow

1. Operator or deploy workflow runs `sync-manifest`.
2. Manifest loader reads the bundled manifest artifact.
3. Only remote-capable keys are imported.
4. Definitions are upserted.
5. Removed keys are archived rather than silently deleted.
6. Product manifest hash is updated.
7. Readiness can use the manifest hash to detect drift.

## Boundaries That Must Stay Clear

- public route code should not own DB resolution logic,
- admin rendering should not leak into the public module,
- repositories should not decide HTTP status codes,
- auth verification failure should not be converted into audience fallback,
- manifest definitions should not be treated as ad hoc admin data,
- scripts should stay explicit operational entry points.

## Concurrency And Runtime Concerns

- keep request handlers non-blocking,
- avoid hidden shared mutable state outside cache/revision management,
- make cache rebuilds explicit and safe,
- keep transactions narrow around write operations,
- ensure the latest committed revision wins for read-path compilation.

## Verification Priorities

- API contract behavior
- auth semantics
- manifest sync correctness
- revision conflict handling
- cache invalidation and rebuild behavior
- migration safety

