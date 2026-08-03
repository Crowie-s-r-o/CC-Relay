---
name: Turbo Plan Council
description: Selectable Codex and Claude author-review routes for Forward-planning Turbo graphs.
type: architecture
---

# Turbo Plan Council

The optional Forward-planning council is a selectable two-step route. It supports Codex author then Claude reviewer, or Claude author then Codex reviewer. The first provider produces the version-1 execution graph and the second independently checks and corrects it in read-only mode. Execute exposes the existing three-stage reviewed-plan route behind its own optional checkbox. Plan council is not a standalone composer category.

The Forward-planning **Planning route** does not disappear when this council is off. Its collapsed state is the ordinary one-model Codex planner, including selectable model and effort controls. The council checkbox expands that same route with Claude and the review order rather than enabling planning itself. This keeps council optional in both the request contract and the visible control hierarchy.

`TurboPlanCouncilReviewer` accepts both Claude draft and Claude review requests through one explicit FIFO queue. Claude stages are globally serialized. Codex stages use the selected planner CC Relay and are tracked independently, so the CC Relay is reserved only while Codex owns the active author or reviewer stage.

Both prompts require JSON only and repeat the graph schema, worker count, original objective, repository context, and attachment paths. Reviewer prompts also include the exact first-provider graph. Every result is parsed before the stage resolves, preserving `text` and `finalResponse` compatibility while exposing the parsed `plan`.

Cancellation is parent scoped. Queued requests reject with `cancelled: true`; active cancellation delegates to ClaudeRunner and queue progression waits for its settled promise. Synchronous runner errors are handled like asynchronous failures so the next queued review always gets a chance to start.

The HTTP boundary validates both supported orders, provider-role alignment, authenticated Claude availability, and author and reviewer model-effort pairs against their provider catalogs. Omitted or disabled council defaults to Codex then Claude without requiring Claude. The normalized object is stored inside `turbo_json.council`; diagnostics record only route and settings, never prompts or graph content.

`src/server.mjs` constructs one `TurboPlanCouncilReviewer` around the shared `claudeRunner` and injects it into `TurboRunner`. The `/api/status` capability map exposes `turboPlanCouncil: true` alongside the existing `planCouncil` capability. Standalone `mode=plan` validation and its Claude-author to Codex-review route remain unchanged.

`TurboRunner` persists `planning`, `reviewing`, and compact per-role audit metadata, and only marks the graph `ready` after the second provider's JSON passes `parseTurboPlan`. Ready-plan reuse requires matching order, author settings, reviewer settings, and a completed council status. Disabled Turbo tasks continue to use the original planner-to-ready path.

`test/turbo-council-integration.test.mjs` proves the Codex-first path with real database, artifact, queue, RelayRunner, TurboRunner, and reviewer instances. `test/turbo-runner.test.mjs` separately proves Claude-first authoring, Codex correction, selected model routing, and execution of the corrected graph.

See [[turbo-execution]] and `test/turbo-plan-council.test.mjs`.

#relay #turbo #council #claude #codex
