---
name: Disposable Retry Conversation Initialization
description: Recovery contract for failed disposable tasks whose saved provider ID never produced a transcript or rollout.
type: incident
tags:
  - relay
  - retry
  - claude
  - codex
  - plan-council
  - terminal
---

# Disposable Retry Conversation Initialization

## Incident

Tasks 364 and 370 on July 28, 2026 exposed the same lifecycle gap.

- Task 364 was an Execute Plan council in Agreau. Its first disposable Claude author terminal bound UUID `e6ec1606-19a2-4833-b37f-21e6bebdbd63`, but the draft paste never started and Claude wrote no transcript. Its disposable Codex reviewer also bound before the draft stage, so reviewer thread `019fa902-8a22-7752-8e05-a93576115179` never wrote a rollout.
- Task 370 was a direct Claude Execute task in CC Relay. It bound UUID `295b0089-afa2-4bcc-a914-cfc69f6f01c8`, but its first prompt also produced no transcript.
- Exact terminal cleanup closed each failed launch. The task rows correctly retained their provider IDs for retry.
- Retry treated every retained ID as an established conversation. It launched Claude with `--resume`, Claude reported `No conversation found with session ID`, terminal binding timed out, and the task failed before its runner started.

The fault was not stale session discovery. CC Relay persisted provider identity at terminal binding, before the provider had necessarily persisted its first turn. A saved ID therefore means "this terminal was bound", not always "this conversation is resumable".

> [!important]
> A manual retry may recreate work that never established provider context. An explicit Continue session may not. Continue must fail rather than silently replace missing conversation history with blank context.

## Corrected contract

Before a disposable manual retry relaunches a saved provider ID, the pool inspects the provider's durable conversation file.

| Provider state | Manual retry | Continue session |
| --- | --- | --- |
| Claude transcript is present | `claude --resume <id>` | `claude --resume <id>` |
| Claude transcript is positively absent | `claude --session-id <same-id>` | Keep `--resume` and fail closed |
| Claude transcript state is unreadable or unknown | Keep `--resume` and fail closed | Keep `--resume` and fail closed |
| Codex rollout is present | `codex resume <id>` | `codex resume <id>` |
| Codex rollout is positively absent | Start a fresh Codex thread and persist its new ID | Keep `codex resume <id>` and fail closed |
| Codex rollout state is unreadable or unknown | Keep `codex resume <id>` and fail closed | Keep `codex resume <id>` and fail closed |

Claude supports first-turn initialization with a caller-supplied UUID, so retry preserves the saved ID. Codex has no equivalent fresh-thread command with a caller-supplied ID. A retry with no rollout opens an ordinary fresh Codex terminal through the existing exact launch reservation, then persists the new bound thread ID.

This is safe because positive absence proves that provider context was never established. Direct retry sends the original task prompt again. Plan council and Turbo prompts are self-contained, and their existing artifact checkpoints still decide which stage actually runs. If a durable provider file exists, or CC Relay cannot inspect it reliably, CC Relay preserves the resume path.

## Implementation

- `src/disposable-terminal-pool.mjs`
  - Classifies Claude transcripts under `~/.claude/projects`.
  - Classifies active and archived Codex rollouts under the `codexHome` reported by the shared app-server, with the normal `~/.codex` location as startup fallback.
  - Selects initialize, fresh, or resume launch behavior before calling the launch coordinator.
  - Records a queue event when retry must initialize or replace an empty provider conversation.
  - Never applies empty-conversation recovery to `sessionFollowUp`.
- `src/project-launcher.mjs`
  - Accepts `initializeThreadId` only for Claude.
  - Launches `--session-id <saved-id>` while retaining a distinct native launch ID for ownership and cleanup.
- `src/server.mjs`
  - Supplies the shared app-server's reported Codex home to rollout inspection without introducing a new environment variable.
- `test/disposable-terminal-pool.test.mjs`
  - Covers present, missing, empty, and unreadable provider state.
  - Covers direct Claude retry, two-provider Plan council retry, explicit Claude and Codex continuation, and unknown-state fail-closed behavior.
- `test/project-launcher.test.mjs` and `test/terminal-launch-coordinator.test.mjs`
  - Prove same-UUID Claude initialization command construction and exact native launch binding.

All 753 repository tests passed after both provider corrections.

## Operational recovery

The backend process must restart before it can use this logic. Let current work finish, restart CC Relay, then manually retry tasks 364 and 370. Retrying against the older process repeats the invalid resume commands.

> [!warning]
> The `/Applications/CC Relay.app` build produced while this incident fix was in progress contains the Claude initialization correction but not the later Codex no-rollout correction. Quit that desktop instance, rebuild it once more from the final source, then relaunch it before testing a desktop-owned Plan council retry. The long-running local `node src/server.mjs` instance only needs a restart after its active tasks finish.

See [[disposable-terminal-pools]], [[plan-council]], [[claude-fresh-session-review]], [[codex-disposable-resume-review]], and [[automatic-retry-safety]].

#relay #retry #claude #codex #plan-council #incident
