# Delivery Changelog

Material backend delivery and stage-1 deltas for `elph_nova_toggle_service`.

Use newest-first entries. Summarize what changed, why it matters, where the source of truth now lives, and what follow-up remains.

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
