---
name: Execute Plan Council Provider Order Review
description: Adversarial ship review for selectable Claude-first and Codex-first Execute Council routes.
type: review
---

# Execute Plan Council Provider Order Review

## Executive Summary

**Ticket confidence: High**

Execute Plan Council now supports Claude-first and Codex-first routes. The first provider drafts and revises, while the other provider reviews. Provider-specific model and effort settings survive order changes. The implementation preserves the existing terminal reservation and database layout, validates the route at the HTTP boundary, keeps older frontend and backend pairings on the original Claude-first contract, and adds symmetric runner coverage.

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | `public/plan-council-state.js` derives role settings from provider settings; `src/plan-council-config.mjs` validates both orders; `src/plan-council-runner.mjs` dispatches draft, review, and revision through the selected providers. |
| Regression risk (UI / backend / contracts) | Green | `capabilities.planCouncilProviderOrder` gates the switch. Older backends receive Claude first with Fable or Opus at max effort. Existing requests without an order retain Claude first. |
| Gap risk (edge cases, error handling, completeness) | Green | Malformed order, role mismatch, missing model, unsupported effort, empty provider output, stage failure, resume, timeout, and busy legacy Claude terminal paths are validated or covered. |
| Code quality (maintainability as safety) | Green | Provider role selection is centralized in state normalization and runner helpers. Terminal-column compatibility is documented next to allocation code and in [[plan-council]]. |
| Unit tests | Green | New unit tests cover state normalization, request construction, server-side config validation, both execution orders, provider-specific models, default effort, stage metadata, visibility gating, and compatibility defaults. The full `npm test` suite passes all 780 tests. |
| Performance & scalability (if applicable) | Green | The change adds constant-time catalog lookup and role routing. Provider reservations remain one Claude and one Codex slot, so scheduling complexity and capacity are unchanged. |

## Top 3 Risks

1. Legacy column names can invite a future role-based allocation bug. `thread_id` is still Codex and `author_thread_id` is still Claude for both orders. The implementation documents and tests this invariant in `src/disposable-terminal-pool.mjs` and [[plan-council]].
2. A mixed-version renderer could send unsupported Claude settings to an older backend. `planCouncilProviderOrder` prevents this by hiding the order control and restoring the older Fable or Opus plus max-effort contract.
3. A provider could accidentally revise on the reviewer's conversation. `providerThread()` and `roleSettings()` in `src/plan-council-runner.mjs` are separate, and the Codex-first test proves the call order and exact model, effort, and conversation for all three stages.

## Top Improvements

- No blocking improvement remains for this scope.
- If task storage receives a future schema migration, rename `author_thread_*` to provider-neutral Claude council fields to remove the legacy naming trap.

> [!note]
> A review pass found that selecting model-default effort initially snapped back to high during rerender. The normalizer now preserves an explicit empty effort, and `test/plan-council-state.test.mjs` protects it.

> [!note]
> The Execute **Starts with** row is intentionally hidden until **Use Plan council for this prompt** is checked, and it remains hidden against a backend without `capabilities.planCouncilProviderOrder`. When visible, its Codex-first and Claude-first selections use the same provider accents as the Forward-planning control. `test/composer-workflows.test.mjs` protects the visibility gate and shared styling contract.

See [[plan-council]], [[turbo-plan-council]], and [[task-history]].

#relay #plan-council #review #compatibility
