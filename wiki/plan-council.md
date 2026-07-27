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

In current automatic mode, the composer assigns the selected project rather than existing sessions. The queue reserves one Claude and one Codex project slot, launches a fresh Relay-owned Claude author terminal and a fresh Codex reviewer terminal, binds both exact native launches, and closes both when the council ends. Relay drives the Claude draft and revision inside its terminal, restores the same Claude UUID with the chosen model and max effort, enables read-only plan permission mode with `Read`, `Glob`, `Grep`, and `AskUserQuestion`, types each stage prompt once, and reads completion from the session transcript. A question therefore remains visible and answerable in Terminal while the task stays running.

Existing persistent council rows retain the former explicit same-workspace author and reviewer assignments. The current renderer shows those controls only against a backend without disposable pool support.

The macOS council path is terminal-required. It does not fall back to `claude -p` when native terminal identity cannot be resolved or the stage prompt cannot be injected safely. The stage fails with nothing sent and can be resumed after the terminal problem is corrected. Windows and Linux retain the isolated `claude --print` council runner because Relay does not have a native terminal injection adapter on those platforms. The renderer distinguishes the paths through `capabilities.planCouncilTerminalExecution`.

The final Claude response is the canonical deliverable. Relay writes it verbatim, apart from one trailing newline, to `<project-root>/.data/tasks/<task-id>/plan.md`, where `<project-root>` is the task's persisted `repo_path`. Draft and review text remain in Relay's own `.data/tasks/<task-id>/plan.json` as internal checkpoint state. A completed council has one Markdown deliverable and no duplicate `result.md`.

> [!important]
> Final plan placement follows the task workspace, not Relay's installation or data directory. This keeps plans with the project they describe, including when Relay coordinates several projects.

## Checkpoints and recovery

Relay persists `plan.json` atomically before and after every stage. A manual retry reconstructs stage state from non-empty saved outputs:

- A saved draft skips the author stage and resumes with Codex review.
- A saved draft and review skip both earlier stages and resume with Claude revision.
- A completed final plan is not eligible for retry.

Plan council failures never enter the queue's automatic retry loop. A provider or terminal failure marks the exact stage failed and waits for the user to fix the cause and press **Resume**. A disposable retry launches new terminals and resumes the persisted Claude and Codex conversation IDs, while completed stage checkpoints remain skipped. Legacy persistent councils can still be reassigned to live same-workspace sessions during resume. Claude stages require an authenticated Claude Code CLI.

A legacy selected Claude author terminal that is externally busy is a pre-dispatch state. The Plan council task remains persisted as queued with `started_at = null`, Relay records one waiting event, and no prompt is typed. An automatic council has no selected terminal to become busy: it waits for one Claude and one Codex project slot, then launches both. Every automatic launch remains protected by pool ownership until exact cleanup.

Each active stage emits a heartbeat every 30 seconds. A stage that exceeds the one-hour safety limit is cancelled by exact task ID, records the failed stage, and can resume from its last checkpoint. This is a safety bound, not an automatic retry.

## Final plan execution

A completed task always displays the canonical project-local file path in its final-plan panel. Relay does not modify the target project's `.gitignore`, so that repository's own ignore policy determines whether `.data/` appears in Git status. A current backend also exposes an **Open plan.md** link. Against an older backend the same row remains visible and says **Restart to open** instead of sending a request to a missing route.

Completed councils promote implementation as visible step **04**, immediately after the three-stage council rail and before the long draft, review, and final-plan content. The task header also exposes a primary **Execute plan** shortcut. Activating the shortcut scrolls to the step and moves keyboard focus to its enabled execution button, or to the panel when execution is unavailable so the reason is announced.

The step contains a provider selector in automatic mode. Choosing Codex or Claude creates a linked disposable task in the source project and uses that provider's model and effort settings. The legacy compatibility path continues listing opened same-workspace Relays and revalidates a selected session.

Execution creates a normal linked Execute task. The executor receives:

- The complete original user request
- The complete final reviewed plan
- The canonical `plan.md` path
- Copies of every original reference image
- The selected Relay's provider, model, and effort settings

The source Plan council task remains immutable and can be used again. Execution never starts automatically when planning completes. Cross-workspace execution is rejected because the reviewed repository context and attachment paths belong to the source workspace.

> [!important]
> Keep the handoff visible before the long plan body. Completion is a review checkpoint, not a dead end and not permission to auto-run. The primary shortcut and step 04 must lead to the same explicit, same-workspace execution control.

Older completed council records are upgraded lazily when opened. Relay writes the final-only Markdown to the source project's canonical path, records that path in `plan.json`, and removes the former Relay-local `plan.md` plus any stale duplicate `result.md`.

Task 194 was repaired through the same canonical writer on July 21, 2026. Its draft and review remain in `plan.json`; `plan.md` now equals only `finalPlan`, and the duplicate `result.md` was removed.

## Authentication and compatibility

`claude auth status --json` can return useful signed-out JSON with exit code 1. Relay preserves that state. Run `claude auth login`; the composer detects successful sign-in automatically. Restarting Relay does not authenticate Claude.

The renderer gates terminal-driven council execution, checkpoint resume, plan artifacts, and reviewed-plan execution on separate backend capabilities. New static assets shown against an older backend preserve the legacy headless council UI and do not send `authorThreadId`. After a current macOS backend advertises `planCouncilTerminalExecution`, the Claude author selector becomes required and only Relay-owned same-workspace Claude terminals appear in it.

## Incident record

The former runner recreated council state and automatically retried every five seconds. Task 130 launched Claude 520 times, including 50 completed drafts that were discarded after a disconnected Codex review. Task 184 launched Claude 78 times while OAuth was expired. The current state machine removes that retry path and surfaces the precise provider error.

See [[diagnostics]], [[task-history]], [[interface-layout]], and [[plan-council-review]].

#relay #plan-council #artifacts #recovery
