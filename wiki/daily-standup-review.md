---
name: Daily Standup Review
description: Adversarial safety review of the date-gated, length-configurable, classified AI standup feature.
type: review
tags:
  - relay
  - standup
  - ai
  - review
---

# Daily Standup Review

> [!note]
> This review records the original three-mode implementation. The current default is the terse **All tasks** mode documented in [[daily-standup]].

## Executive Summary

**Ticket confidence: Medium**

The feature satisfies the expanded acceptance criteria. Opening Standup performs no provider call, selecting a date is the generation trigger, Short, Standard, and Detailed are enforced by both prompt targets and normalization limits, and generated output is split into completed Tasks and unresolved Blockers. Clipboard output uses plain sectioned text with no Markdown hyphen prefixes.

Generation uses one fresh isolated headless process for the selected composer provider, with ready-provider fallback, and never touches a task terminal. Real Codex and Claude smoke runs passed under the new classification contract, and all 810 repository tests pass. Confidence remains Medium because the browser-control surface was unavailable, so the rendered modal and native clipboard permission path could not be exercised interactively.

## Quality Panel (RAG)

| Area | Rating | Evidence |
|---|---|---|
| Functional correctness | Green | `openStandup()` leaves the date blank and never calls generation. The date `change` handler calls `generateStandup()`, which posts the length and local-day window. `validateStandupLength()`, `buildStandupPrompt()`, and `normalizeStandupOutput()` enforce the requested size and Task or Blocker structure. Real Codex and Claude runs returned both classes correctly. |
| Regression risk (UI / backend / contracts) | Green | Additive `aiStandupGeneration` and `aiStandupConfiguration` capability checks prevent a refreshed renderer from calling a previous backend that would ignore length. The response keeps labelled `standup` Markdown for older clients and adds structured arrays plus `copyText`. No database schema or queue transition changed. |
| Gap risk (edge cases, error handling, completeness) | Amber | The live browser surface and clipboard permission flow were unavailable. Very large days and long conversations are intentionally truncated, so unusual source volume can omit older context. |
| Code quality (maintainability as safety) | Green | Date selection, length validation, prompt construction, classification, copy formatting, process lifecycle, limits, and provider selection are isolated in pure helpers or one runner class. Errors are bounded and surfaced; diagnostics exclude prompt and response bodies. |
| Unit tests | Green | Focused tests cover date gating, all length limits, Task and Blocker classification, prefix-free copy text, DST ranges, exact filtering, grounding, both provider contracts, fallback, concurrency, and timeout. The complete 810-test suite passes. |
| Performance & scalability (if applicable) | Amber | Selection scans the task list once. Conversation loading is bounded to 40 tasks but performs per-task prompt and response event queries. This is acceptable for expected daily volume but remains an N+1 pattern over potentially long event histories. |

**Are there adequate UNIT tests? Yes.** Pure selection, date boundaries, length validation and caps, prompt source, security framing, provider invocation, Task and Blocker parsing, prefix-free copy formatting, concurrency, timeout, database response history, capability gating, and renderer wiring all have direct coverage. The remaining gap is interactive integration QA, not a missing core unit case.

## Top 3 Risks

1. **No interactive browser and clipboard pass.** `renderStandup()` and `copyStandup()` in `public/app.js` are source-tested, but date picker behavior, focus, computed layout, and clipboard permission feedback were not exercised in a browser.
2. **Bounded source can omit older context.** `boundedSource()` in `src/standup-generator.mjs` keeps the latest 40 tasks and a bounded prompt and response history for each task. The UI discloses task-level truncation, but not every per-message truncation.
3. **Provider CLI contracts can drift.** `StandupGenerator.runProvider()` depends on current Codex and Claude command flags and JSON shapes. This review caught and removed Claude's obsolete `--safe-mode` flag by running the resolved real binary. Future CLI changes will surface as a retryable modal error, but compatibility still needs release-time smoke checks.

## Top Improvements

1. Run desktop and narrow-width browser checks when browser control is available, including blank initial date, length selection, date-triggered loading, separate sections, keyboard focus, Escape, backdrop close, Retry, Regenerate, and clipboard success.
2. If daily task volume grows materially, add a database query specialized for project, thread, status, and outcome range, then fetch prompt and response events in batches.
3. Add a small source-coverage disclosure for omitted prompts or responses if users regularly continue one task for more than six turns.

## Recommendation

**Ship with Mitigations.** Core behavior, isolation, and provider compatibility are proven. Complete the interactive browser and clipboard pass when that surface is available, and retain real provider smoke checks during CLI upgrades.

## Confirmed Issues

No confirmed issue remains.

The combined adversarial passes found three concrete defects and fixed all three:

- The installed Claude binary rejected the inherited `--safe-mode` flag. The standup runner now uses supported no-tools, no-settings, no-MCP isolation flags, and the resolved real Claude binary completed successfully.
- A new reduced-motion block became the last such CSS block and broke the Planner regression contract. The final block now preserves both Planner and Standup reduced-motion behavior, and the full suite passes.
- The first length-configurable renderer reused `aiStandupGeneration` alone. A previous standup backend could therefore accept the new request but ignore `length`. The additive `aiStandupConfiguration` gate now disables Standup with a restart instruction until the active backend can enforce the new contract.

## Suspected Issues & Edge Cases

- LLM wording is nondeterministic. The prompt strongly requires grouping and grounded what-plus-how bullets, but a model can still choose different phrasing on regeneration.
- The classifier accepts unlabelled legacy bullets as Tasks for compatibility. Current prompts require exact `Task:` and `Blocker:` labels, and real provider smoke checks honored them.
- A same-task continuation is assigned to its latest `finished_at` day and includes earlier prompts and responses as context. This matches the existing one-task continuation contract but is not a per-turn historical ledger.
- Closing the modal does not cancel an active provider run. Reopening shows that run's eventual result, while the global slot prevents duplicate generation.
- If the preferred provider becomes unusable after readiness probing, the current request fails visibly instead of starting a second provider and potentially doubling latency.

## Regression Risks

- Before the latest refinement, opening the modal immediately generated the current date and returned one flat Markdown list.
- After, opening is inert, date selection starts the request, length is explicit, and results render in separate Tasks and Blockers sections.
- Standup now requires both standup capabilities and an authenticated Codex or Claude CLI, then performs one explicit isolated request.
- Older running backends disable the action with a restart explanation instead of calling an unknown endpoint.
- Queue ordering, task statuses, task results, history rows, session ids, and browser storage are unchanged by generation.
- `listTaskResponses()` is additive to `RelayDatabase` and does not alter existing event persistence.

## Performance Risks

Task selection is O(T) over stored tasks. Source hydration is capped at 40 tasks and performs two event-history reads plus task lookups per included task, so query count is O(min(D, 40)) while scanned event payload is proportional to those tasks' complete histories. Prompt construction and normalization are bounded by 120,000 source characters, 2 MB provider output, 4, 8, or 16 accepted items by requested length, and 12,000 final characters.

Only one provider process may generate a standup at once. This prevents local process fan-out but means simultaneous clients receive HTTP 409 and must retry after the active run finishes.

## Test Gaps

- No browser screenshot, computed-layout inspection, or narrow-width interaction was possible.
- Clipboard permission success and rejection were not executed in a browser.
- The production HTTP route was exercised manually against a seeded temporary server, but there is no automated black-box server test with a fake provider binary.
- There is no compatibility matrix for older provider CLI releases. Current resolved Codex and Claude binaries were both tested directly.

## Positive Improvements

- Output is AI-synthesized from real conversation evidence rather than task-title heuristics.
- Opening the modal is side-effect free, and changing length after a result requires an explicit regeneration.
- Tasks and unresolved Blockers are structurally separate through the prompt, backend response, UI, and clipboard format.
- Clipboard output is derived locally from normalized arrays, so provider formatting cannot reintroduce Markdown hyphen prefixes.
- Prompt and response history remains server-authoritative; the browser cannot inject alternate task content into the request.
- Historical text is marked untrusted, provider tools are disabled, and execution uses an empty temporary workspace.
- Generation is ephemeral, bounded, cancellable during shutdown, and excluded from queue history.
- Output is normalized to copy-ready bullets and escaped before DOM insertion.
- Project, Relay, status, and local-day boundaries are independently validated on the server.
- Diagnostics record provider, duration, source counts, and failures without storing conversation text.

#relay #standup #ai #review
