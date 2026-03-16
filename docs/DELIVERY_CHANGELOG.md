# Delivery Changelog

Material backend delivery and stage-1 deltas for `elph_nova_toggle_service`.

Use newest-first entries. Summarize what changed, why it matters, where the source of truth now lives, and what follow-up remains.

---

## 2026-03-16

### Stage-2: Flag Dependency Tree (commit 1c89cbe)

- What changed:
  - Added `flag_dependencies` table (migration 005) with parent→child edges, optional reason, unique constraint.
  - `DefaultDependenciesRepository` with add/remove/findById/listByProduct/findEdge.
  - `wouldCreateCycle` pure DFS helper in `src/modules/dependencies/cycle.ts`.
  - `AdminRulesService`: `addDependency` / `removeDependency` / `listDependencies` with revision bumps and cache invalidation.
  - `ConfigResolutionService`: `applyDependencyPropagation` using Kahn's topological sort (AND semantics); cycle safety-net logs and skips without crashing.
  - Admin API: `GET/POST /admin/api/dependencies`, `DELETE /admin/api/dependencies/:id` (viewer read / editor write).
  - Admin UI: Dependencies section on feature detail page (parent/child edge tables + add form), dependency count column on features list.
  - Playwright E2E: E2E-DEP-1 through E2E-DEP-5 added to `admin-ui.spec.ts`.
- Why it matters:
  - Enables operators to declare that feature B requires feature A — if A is disabled, B is automatically disabled at resolution time without additional rule creation.
  - AND semantics: child is disabled if ANY declared parent is disabled.
- Follow-up:
  - iOS/client side spec for dependency semantics not yet written (H1).
  - TOCTOU race in cycle detection under PostgreSQL multi-instance acknowledged; mitigated by unique constraint + resolution-time safety-net (H4).
  - CSP hardening for admin UI remains open (M3).

### Security and correctness hardening (CRITICAL→LOW findings)

- What changed:
  - C1: `ManifestSyncService.sync()` now calls `resolutionService.invalidateCache()` after transaction commits (optional injected dependency).
  - C2: Archiving a key during sync now deletes orphaned `flag_dependencies` edges referencing that key; `SyncManifestResult` includes `orphanedEdgesRemoved`.
  - C3: `addDependency` now double-checks both keys against `feature_definitions` in the DB (status=active) after registry checks to guard against registry/DB divergence.
  - H3: `applyDependencyPropagation` cycle warning now uses an injected `warn` function (defaults to `console.warn`) — passed from `server.ts` as `logger.warn`.
  - M1: `makeAdminAuthHook` now rejects authenticated tokens that have no `sub` claim with HTTP 401; `request.adminSub` assignment drops the `?? 'unknown'` fallback.
  - M4: `removeDependency` now accepts and records an optional `reason`; API schema and UI form updated.
  - M6: `disableRule` now stores `{"is_active":false}` as `new_value_json` (semantic) instead of repeating `entry_json`.
  - L1: `getRule` now takes `productId` and verifies ownership before returning.
  - L2: `GET /admin/api/dependencies` now has a `try/catch` wrapping the handler.
  - L3: `reason` field on `POST /admin/api/dependencies` validated with `.min(1)` when provided.
  - L5: `GET /admin` redirect now uses `viewerHtmlHook` (HTML error pages) instead of the plain JSON auth hook.
  - L6: `AdminRulesService.depsRepo` is now a required constructor parameter; all `if (!this.depsRepo)` guards removed.
  - L7: New `describe('Dependency propagation', ...)` block in `tests/modules/config-resolution/service.test.ts` covering PROP-1 through PROP-7.
  - L8: New DEP-13 test verifying viewer cannot DELETE a dependency edge.
  - Manifest sync tests: added tests for `invalidateCache` call and orphan edge cleanup.
  - Auth tests: added M1 test verifying authenticated token without sub returns 401.
- Why it matters:
  - Closes critical gaps around cache coherence, orphaned dependency data, and auth security.
  - Makes `depsRepo` required, removing dead code paths and simplifying maintenance.
- Follow-up:
  - C3 DB validation adds one extra DB query per `addDependency` call — acceptable for low-frequency admin writes.
  - Playwright E2E coverage for dependency removal with reason field not yet added.

---

## 2026-03-15

### Multi-agent workflow aligned with elph-nova-ios improvements

- What changed:
  - added `deep-review-agent` for high-context review beyond narrow guard checks;
  - added `delivery-log-agent` for material stage-1 and rollout deltas;
  - expanded the backend coordinator model with a dedicated Deep Review branch while keeping the backend-specific Verification/QA branch;
  - updated local multi-agent docs and prompts so material delivery/stage-1 changes should be logged explicitly instead of disappearing across many files.
- Why it matters:
  - the backend agent workflow now mirrors the stronger coordination model from `elph-nova-ios` while staying adapted for Node.js service work, rollout concerns, and automation-first QA.
- Source of truth:
  - `docs/MULTI_AGENT_GUIDE.md`
  - `docs/SERVER_AGENT_PROMPTS.md`
  - `.claude/agents/README.md`
  - `docs/DELIVERY_CONTOUR.md`
- Follow-up:
  - when rollout, security, defaults, or testing assumptions change materially, update this changelog together with the relevant stage-1 source docs.
