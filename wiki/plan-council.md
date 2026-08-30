---
name: Execute Plan Council
description: Persisted author, review, revision, artifact, resume, and execution contract.
type: architecture
---

# Execute Plan Council

Execute Plan council is a selectable, read-only planning pipeline. The composer offers **Claude first** and **Codex first**, with Claude first retained as the compatibility default:

1. The selected author receives the original user brief and every reference image, inspects the repository, and writes the first draft.
2. The other provider receives the original brief, the complete first draft, and the same references. It returns an adversarial review only.
3. The original author receives the brief, its first draft, the complete review, and the same references. It returns only the final implementation plan.

Each provider keeps an independent model and effort selection when the order changes. The HTTP boundary validates the selected order, provider-role alignment, and both provider settings. `capabilities.planCouncilProviderOrder` gates the new control. A current renderer paired with an older backend hides the order switch, restores Claude first, limits Claude to Fable or Opus at max effort, and sends the original compatible request.

In current automatic mode, the composer assigns the selected project rather than existing sessions. A new council reserves one Claude and one Codex project slot, launches one fresh CC Relay-owned terminal for each provider, binds both exact native launches, and closes both when the council ends. Before a retry launches anything, the pool reads the same `plan.json`, `draft.md`, and `review.md` checkpoint state as the runner. It reserves and launches only providers that still own unfinished stages. A saved draft plus review therefore launches only the original author. CC Relay drives every Claude-owned stage inside its terminal, starts the first process with the chosen model, effort, read-only plan permission mode, `Read`, `Glob`, `Grep`, and `AskUserQuestion`, types each stage prompt once, and reads completion from the session transcript. A question therefore remains visible and answerable in Terminal while the task stays running.

> [!important]
> The database predates selectable roles. `thread_id` remains the Codex council conversation and `author_thread_id` remains the Claude council conversation for both orders. `author_provider` and `reviewer_provider` define the actual roles. Do not make terminal allocation depend on the misleading legacy column name.

The automatic council's pending-provider reservation is capacity-managed. A new council, or a resume that still needs both providers, retains the atomic two-provider check. For example, with Codex max 3 and Claude max 1, one running disposable Codex task leaves enough room for a new council because the combined usage becomes Codex 2 and Claude 1. A revision-only resume needs just its author provider. The council remains globally serialized against another council or Turbo parent, but it can share its own project with disposable Execute and Planner breakdown tasks while all required provider limits fit. Legacy persistent councils retain the former project-draining FIFO barrier.

Existing persistent council rows retain explicit same-workspace Claude and Codex terminal assignments. The current renderer shows those controls only against a backend without disposable pool support.

The macOS council path is terminal-required. It does not fall back to `claude -p` when native terminal identity cannot be resolved or the stage prompt cannot be injected safely. The stage fails with nothing sent and can be resumed after the terminal problem is corrected. Windows and Linux retain the isolated `claude --print` council runner because CC Relay does not have a native terminal injection adapter on those platforms. The renderer distinguishes the paths through `capabilities.planCouncilTerminalExecution`.

The selected author's final response is the canonical deliverable. CC Relay writes it verbatim, apart from one trailing newline, to `<project-root>/.data/tasks/<task-id>/plan.md`, where `<project-root>` is the task's persisted `repo_path`. Every earlier stage now lands beside it as its own durable Markdown file: `draft.md` when the first draft completes and `review.md` when the independent review completes. CC Relay's own `.data/tasks/<task-id>/plan.json` keeps the same text as internal checkpoint state.

`plan.md` remains the single final deliverable, and a completed council still has no duplicate `result.md`. The two stage files supersede the former one-file wording: they are durable recovery state that happens to be readable, so a completed council leaves three project-local Markdown files.

> [!important]
> Final plan placement follows the task workspace, not CC Relay's installation or data directory. This keeps plans with the project they describe, including when CC Relay coordinates several projects.

## Checkpoints and recovery

CC Relay persists `plan.json` atomically before and after every stage. A manual retry reconstructs stage state from non-empty saved outputs:

- A saved draft skips the author stage and resumes with the other provider's review.
- A saved draft and review skip both earlier stages and resume with the original author's revision.
- A completed task is not eligible for retry. If all provider output is checkpointed but the canonical `plan.md` write failed, Resume launches no provider and retries only final artifact persistence.

Each stage also persists its own Markdown file at the moment that stage completes, written atomically into the task's project folder next to `plan.md`. Placement always follows the task's `repo_path`, never CC Relay's own folders. Identical content is never rewritten, so repeated checkpoints cannot churn file modification times inside the user's repository.

Every persist runs in a fixed order: disowned stage files are deleted, then `plan.json` is written, then the stage files, then `plan.md`. Both halves of that order are load bearing.

Deletions come first because a stale stage file must never survive the record that disowns it. A fresh record beside an old `draft.md` is exactly the state a resume reads as a saved draft, and a hard process death between the two writes is enough to create it. Removing text the record does not hold cannot lose earned work, so this is the one part of the persist that is safe ahead of the checkpoint.

Every write into the user's project comes after the checkpoint, so a stage that just completed can never lose its text to a folder that refuses writes. A stage file write is therefore best effort. A refused write leaves the text safely checkpointed, records that stage file as absent so the panel cannot advertise a missing path, and backfills the file on the next persist or resume once the folder accepts writes. Only the final `plan.md` write still fails the task, which is exactly the behavior that existed before stage files.

`plan.json` stays the primary checkpoint and the stage files are its per-stage fallback:

- A stage whose `plan.json` field is empty, or whose record is missing, truncated, or unreadable, is restored from a non-empty `draft.md` or `review.md` and is not run again.
- A record that holds the stage text but has lost its file backfills that file on the next resume, which is how older councils gain their stage files.
- Text already in the record always wins. A stage file can fill a gap but never overrides the checkpoint.
- A stored record that no longer matches the task, an edited brief or a changed provider configuration, discards the record and its stage files together. They describe the previous request and are never resumed from.
- Discarding a plan removes its stage files with it, so an edited queued council can never resume onto a stale draft.

An unreadable `plan.json` no longer fails Task Activity or the Resume route. It reads as a missing checkpoint and recovery falls through to the stage files. A council record carries `stageArtifacts` with the two paths, and the draft and review disclosures show the file each stage was saved to.

Plan council failures never enter the queue's automatic retry loop. A provider or terminal failure marks the exact stage failed and waits for the user to fix the cause and press **Resume**. A disposable retry reconstructs completed stages before capacity checks or terminal launch. It launches no provider whose work is already checkpointed. When only revision remains, Relay opens a fresh conversation for the original author because the revision prompt already contains the full brief, draft, review, and references. This avoids loading a large failed draft conversation while preserving every earned stage. Legacy persistent councils can still be reassigned to live same-workspace sessions during resume. Claude stages require an authenticated Claude Code CLI.

A persisted provider ID is not assumed to be resumable. If a failed stage never created a Claude transcript, retry initializes that same council UUID with `--session-id`. If the unused or failed Codex council conversation never created a rollout, retry opens a fresh thread and persists its new ID. Present or unreadable provider state stays on the fail-closed resume path. This lets tasks 364 and 370 recover without weakening explicit Continue session continuity. See [[disposable-retry-conversation-initialization]].

A legacy selected Claude council terminal that is externally busy is a pre-dispatch state. The Plan council task remains persisted as queued with `started_at = null`, CC Relay records one waiting event, and no prompt is typed. An automatic new council has no selected terminal to become busy: it waits for one Claude and one Codex project slot, then launches both. A resumed council waits only for the providers in its unfinished stage set. Every automatic launch remains protected by pool ownership until exact cleanup.

Each active stage emits a heartbeat every 30 seconds. A stage that exceeds the one-hour safety limit is cancelled by exact task ID, records the failed stage, and can resume from its last checkpoint. This is a safety bound, not an automatic retry.

> [!note]
> A resumed Claude stage can hit Claude Code's large-session resume picker (session over 70 minutes inactive and over 100k tokens). CC Relay detects the picker on the exact terminal screen, selects Resume full session as-is, and types the stage prompt only into a positively verified composer, with the held paste re-verified on screen before every separate submit action. See [[claude-resume-picker-guard]].

## Final plan execution

A completed task always displays the canonical project-local file path in its final-plan panel. CC Relay does not modify the target project's `.gitignore`, so that repository's own ignore policy determines whether `.data/` appears in Git status. A current backend also exposes an **Open plan.md** link. Against an older backend the same row remains visible and says **Restart to open** instead of sending a request to a missing route.

Completed councils promote implementation as visible step **04**, immediately after the three-stage council rail and before the long draft, review, and final-plan content. The task header also exposes a primary **Execute plan** shortcut. Activating the shortcut scrolls to the step and moves keyboard focus to its enabled execution button, or to the panel when execution is unavailable so the reason is announced.

The step contains a provider selector in automatic mode. Choosing Codex or Claude creates a linked disposable task in the source project and uses that provider's model and effort settings. The legacy compatibility path continues listing opened same-workspace Relays and revalidates a selected session.

Execution creates a normal linked Execute task. The executor receives:

- The complete original user request
- The complete final reviewed plan
- The canonical `plan.md` path
- Copies of every original reference image
- The selected CC Relay's provider, model, and effort settings

The source Plan council task remains immutable and can be used again. Execution never starts automatically when planning completes. Cross-workspace execution is rejected because the reviewed repository context and attachment paths belong to the source workspace.

> [!important]
> Keep the handoff visible before the long plan body. Completion is a review checkpoint, not a dead end and not permission to auto-run. The primary shortcut and step 04 must lead to the same explicit, same-workspace execution control.

Older completed council records are upgraded lazily when opened. CC Relay writes the final-only Markdown to the source project's canonical path, records that path in `plan.json`, and removes the former CC Relay-local `plan.md` plus any stale duplicate `result.md`.

Task 194 was repaired through the same canonical writer on July 21, 2026. Its draft and review remain in `plan.json`; `plan.md` now equals only `finalPlan`, and the duplicate `result.md` was removed.

## Authentication and compatibility

`claude auth status --json` can return useful signed-out JSON with exit code 1. CC Relay preserves that state. Run `claude auth login`; the composer detects successful sign-in automatically. Restarting CC Relay does not authenticate Claude.

The renderer gates provider order, terminal-driven council execution, checkpoint resume, plan artifacts, and reviewed-plan execution on separate backend capabilities. New static assets shown against an older backend preserve the Claude-first route and legacy headless council UI and do not send `authorThreadId`. After a current macOS backend advertises `planCouncilTerminalExecution`, the Claude council selector becomes required and only CC Relay-owned same-workspace Claude terminals appear in it.

## Incident record

Task 1148 completed its Claude draft and Codex review, then failed before Claude accepted the final revision prompt. The two project files were valid recovery checkpoints, not partial final output. Resume correctly preserved both stages, but terminal preparation still opened both providers and restored the large Claude draft conversation. Applying Plan settings restarted that restored process, and the large revision paste disappeared from the composer without creating a transcript turn.

The correction makes terminal preparation call the runner's checkpoint inspector before capacity or launch decisions. With `draft.md` and `review.md` present, only the author provider is required. The revision uses a fresh author conversation because its prompt is self-contained, and the completed reviewer is never launched. Plan-mode Claude settings now travel on the first process command, which removes the extra restart at this handoff. Regression tests cover both Claude-first and Codex-first revision resumes from stage files alone.

The former runner recreated council state and automatically retried every five seconds. Task 130 launched Claude 520 times, including 50 completed drafts that were discarded after a disconnected Codex review. Task 184 launched Claude 78 times while OAuth was expired. The current state machine removes that retry path and surfaces the precise provider error.

See [[diagnostics]], [[task-history]], [[interface-layout]], and [[plan-council-review]].

#relay #plan-council #artifacts #recovery
