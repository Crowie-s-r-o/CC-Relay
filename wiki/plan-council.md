---
name: Execute Plan Council
description: Persisted author, review, revision, artifact, resume, and execution contract.
type: architecture
---

# Execute Plan Council

Execute Plan council is a fixed, read-only planning pipeline:

1. Claude receives the original user brief and every reference image, inspects the repository, and writes the first draft.
2. Codex receives the original brief, the complete first draft, and the same references. It returns an adversarial review only.
3. Claude receives the original brief, its first draft, the complete Codex review, and the same references. It returns only the final implementation plan.

The final Claude response is the canonical deliverable. Relay writes it verbatim, apart from one trailing newline, to `.data/tasks/<task-id>/plan.md`. Draft and review text remain in `.data/tasks/<task-id>/plan.json` only as internal checkpoint state. A completed council has one Markdown deliverable and no duplicate `result.md`.

## Checkpoints and recovery

Relay persists `plan.json` atomically before and after every stage. A manual retry reconstructs stage state from non-empty saved outputs:

- A saved draft skips the author stage and resumes with Codex review.
- A saved draft and review skip both earlier stages and resume with Claude revision.
- A completed final plan is not eligible for retry.

Plan council failures never enter the queue's automatic retry loop. A provider or terminal failure marks the exact stage failed and waits for the user to fix the cause and press **Resume**. A reviewer can be moved to another connected Codex Relay in the same workspace during resume. Claude stages still require an authenticated Claude Code CLI.

Each active stage emits a heartbeat every 30 seconds. A stage that exceeds the one-hour safety limit is cancelled by exact task ID, records the failed stage, and can resume from its last checkpoint. This is a safety bound, not an automatic retry.

## Final plan execution

A completed task always displays the canonical file path in its final-plan panel. `.data/` is listed in `.gitignore`, so development artifacts remain local and cannot appear as normal Git changes. A current backend also exposes an **Open plan.md** link. Against an older backend the same row remains visible and says **Restart to open** instead of sending a request to a missing route.

The final-plan panel contains an **Execute reviewed plan** control. Its selector lists every currently opened Codex and Claude Relay whose workspace matches the source task. It defaults to the currently selected eligible Relay, remembers an explicit choice for that plan, and falls back to the first eligible opened Relay if the preferred session disconnects. The button names both provider and Relay before queueing the task. A stale or disconnected selection is revalidated by the server.

Execution creates a normal linked Execute task. The executor receives:

- The complete original user request
- The complete final reviewed plan
- The canonical `plan.md` path
- Copies of every original reference image
- The selected Relay's provider, model, and effort settings

The source Plan council task remains immutable and can be used again. Execution never starts automatically when planning completes. Cross-workspace execution is rejected because the reviewed repository context and attachment paths belong to the source workspace.

Older completed version 1 council records are upgraded lazily when opened. Relay rewrites their `plan.md` to contain only `finalPlan`, records the canonical path in `plan.json`, and removes any stale duplicate `result.md`.

Task 194 was repaired through the same canonical writer on July 21, 2026. Its draft and review remain in `plan.json`; `plan.md` now equals only `finalPlan`, and the duplicate `result.md` was removed.

## Authentication and compatibility

`claude auth status --json` can return useful signed-out JSON with exit code 1. Relay preserves that state. Run `claude auth login`; the composer detects successful sign-in automatically. Restarting Relay does not authenticate Claude.

The renderer gates checkpoint resume, plan artifacts, and reviewed-plan execution on separate backend capabilities. New static assets shown against an older backend remain disabled with a restart explanation instead of calling unsupported or unsafe routes.

## Incident record

The former runner recreated council state and automatically retried every five seconds. Task 130 launched Claude 520 times, including 50 completed drafts that were discarded after a disconnected Codex review. Task 184 launched Claude 78 times while OAuth was expired. The current state machine removes that retry path and surfaces the precise provider error.

See [[diagnostics]], [[task-history]], [[interface-layout]], and [[plan-council-review]].

#relay #plan-council #artifacts #recovery
