---
name: Claude Held Paste Multi Attempt Submit
description: Task 39 incident where one early guarded submit action was swallowed, and the bounded multi-attempt schedule that replaces it.
type: incident
tags:
  - relay
  - claude
  - terminal
  - plan-council
  - recovery
---

# Claude Held Paste Multi Attempt Submit

> [!important]
> The guarded submit action is no longer one-shot. A held paste now receives up to four separate
> submit actions, spaced with backoff inside one raised submission window. Every attempt re-proves
> the complete safety contract immediately before it is sent, and any submission evidence stops the
> schedule permanently. This supersedes the single-action rule described in
> [[claude-resumed-council-submit-review]], [[claude-fresh-council-submit-recovery]], and
> [[claude-continuation-compaction-recovery-review]]. The exact-prompt evidence contract itself is
> unchanged.

## Incident

Task 39, a Plan council on `/Users/patrikkelemen/WebstormProjects/Asora/src/Agreau`, failed its
Claude revision stage twice on July 30, 2026, for two unrelated reasons. This page covers only the
second one.

> [!warning]
> The first failure was not a submit problem. At `13:38:29.234Z` the council entered the revision
> stage and stopped 512 ms later at `13:38:29.746Z`, before anything was pasted. `relay-diagnostics.jsonl`
> records `terminal.recovery.native_inspection_failed` at `13:38:29.743Z`: one Terminal window with
> no describable tabs threw `TypeError: null is not an object (evaluating 'window.tabs().map')` and
> aborted the entire JXA window inventory, so terminal resolution returned nothing for every
> candidate. That defect and its fix belong to [[resume-dispatch-audit]].

The user then retried, which resumed from the preserved draft and Codex review checkpoints, so the
relaunch only had to deliver one revision prompt. That second attempt is the incident below.

Event history for the failing relaunch, taken from the task's rows in `relay.sqlite` and the same
`13:51:45Z` to `13:52:25Z` window of `relay-diagnostics.jsonl`:

| Time (UTC) | Event |
| --- | --- |
| 13:51:45.175 | Task started, disposable terminals launching |
| 13:51:56.992 | Claude and Codex council terminals ready |
| 13:51:58.725 | Claude terminal restarting with fable at max effort in read-only plan mode |
| 13:52:02.138 | Terminal ready with the selected settings |
| 13:52:02.761 | Revision turn starts, prompt pasted |
| 13:52:05.387 | One separate submit action sent |
| 13:52:24.433 | Plan council stopped at the failed stage |
| 13:52:25.657 | 2 disposable terminal instances closed |

The composer visibly held the paste as `[Image #3] [Image #4][Pasted text #5 +201 lines]` after that
submit action. A manual Return submits it instantly every time. The user reports this is the
dominant failure mode of resumed Claude council and continuation stages.

`~/.claude/projects/-Users-patrikkelemen-WebstormProjects-Asora-src-Agreau/85369a08-266b-477d-8450-318d7956fc18.jsonl`
proves nothing arrived. Its last content record is an `away_summary` at `13:33:46.930Z`. Everything
after it is untimestamped `bridge-session` and `permission-mode` bookkeeping written by the relaunch
itself. There is no user record, no trailing-space message, and no assistant activity. Neither the
paste's appended Return nor the separate submit action reached Claude.

## Root cause

The former defaults were `submitNudgeMs = 1_500`, `submissionTimeoutMs = 20_000`, and
`pollMs = 800`, and no caller overrode them: `ClaudeExecutionRunner` constructs
`ClaudeTerminalExecutor` with only `command`, `sessions`, `wait`, `resolveTerminal`,
`requestAttention`, and `hookBridge`. The observed timeline is exactly what those constants
produce.

1. Terminal delivers the bracketed paste and appends its Return in one Apple Event. Claude Code
   collapses a large paste into a composer widget and can swallow that Return. This part was
   already documented.
2. The single guarded nudge became due 1.5 seconds after injection and fired at 13:52:05.387, about
   2.6 seconds in. A 201-line paste whose text also contained image paths was still being converted
   into attachment chips, so the TUI swallowed this Return exactly like the first one.
3. `submitNudged` latched permanently. No further recovery was possible.
4. The deadline then became `submitNudgedAt + max(pollMs, submissionTimeoutMs - submitNudgeMs)`,
   that is `13:52:05.387 + 18.5s = 13:52:23.887`, and the next poll tick failed the task at
   13:52:24.433.

The single early attempt is the defect. The trailing-space helper itself is sound: task 364's live
recovery called the production `submitHeldTerminalPaste` by hand, minutes after the paste, and the
transcript appeared immediately. See [[claude-fresh-council-submit-recovery]]. That is direct
evidence against the competing theory that typing a space before Return inherently swallows it, and
direct evidence for timing being the only broken variable.

## New attempt policy

`ClaudeTerminalExecutor.watchTurn()` now runs a bounded schedule instead of a latch.

- First attempt no earlier than `submitNudgeMs` after injection, so a large paste has time to
  settle, while an ordinary small prompt still recovers within seconds.
- Up to `maxSubmitAttempts` attempts per turn, ever. The counter is never reset by busy status,
  compaction, transcript growth, or a skipped attempt.
- Gaps grow: `submitRetryMs + submitRetryBackoffMs * (attempt - 1)`, measured from the moment the
  previous action completed, not from when it was dispatched.
- An attempt is refused unless `submitConfirmMs` of the submission window still remains. Attempts
  are recovery, never a way to extend the deadline.
- The window counts only idle time with no submission evidence. Busy status and compaction suspend
  it, because they are precisely the states in which pressing Return is forbidden.

> [!warning]
> The suspended clock is load bearing, not a refinement. A first draft of this change measured the
> window on wall time and was caught in review: task 15's own compaction ran about 79 seconds, so a
> compaction ending anywhere between `submissionTimeoutMs - submitConfirmMs` and `submissionTimeoutMs`
> left no room for a single attempt and then failed the turn on the very next poll, with the
> continuation still visibly held in the composer and zero submit actions sent. Ending between 50 and
> 63 seconds truncated the schedule to one attempt. The old
> `submitNudgedAt + max(pollMs, submissionTimeoutMs - submitNudgeMs)` deadline protected exactly this
> class, which is why [[claude-resumed-council-submit-review]] introduced it. Any future change to
> this window must keep busy and compaction outside it.

The deadline is therefore `submissionElapsedMs > submissionTimeoutMs`, where `submissionElapsedMs`
accumulates once per watcher iteration and only while the session is neither busy nor compacting.
Gaps between attempts deliberately stay on wall time: busy status is the same signal a landed Return
would produce, so time spent busy is time the previous action already had to prove itself, and a
busy-to-idle transition with still no evidence is immediately eligible again.

The unconditional five-minute `promptAcceptanceTimeoutMs` ceiling remains the outer bound and is
measured on wall time from injection, so a session that reports busy forever still releases its task
and its project slot. That ceiling, not the submission window, is what bounds the worst case.

Every attempt independently re-proves all of the following immediately before the Apple Event, in
this order:

1. The turn is still uncorrelated: no `UserPromptSubmit` hook match and no exact transcript prompt
   anchor.
2. The exact terminal identity re-verifies through `verifyTerminalIdentity`.
3. The transcript is drained, and uncorrelated growth gets its quiet parsing interval first.
4. The transcript state permits the action: present and unchanged, or positively absent for a
   conversation that was fresh at turn start. Unreadable always suppresses, forever.
5. A fresh `readConnectedSession` reports idle. The loop level `busy` flag can be a stale sample, so
   this fresh read is the authority.
6. Compaction is not in progress.
7. No `AskUserQuestion` is pending. This is structurally guaranteed, since a pending question can
   only be recorded after submission evidence exists, which already ends the schedule.
8. The task is not cancelled.

### Why more than one action is safe

Each attempt fires only while there is still zero submission evidence and the session is idle. If a
previous action actually submitted, evidence appears well inside one gap: the `UserPromptSubmit`
hook lands within a second or two, the transcript anchor follows, and the session goes busy. Any one
of those permanently ends the schedule.

Correlation is re-checked once more immediately before the Apple Event, after the fresh session
read. That read is an `await`, and a `UserPromptSubmit` hook can land inside it once every other
guard has already passed.

The worst case is therefore one stray whitespace character visible in an already-empty composer, not
a duplicated turn. Compare that to the old behavior, whose worst case was a guaranteed dead task
after a single swallowed Return. Repeated actions also cannot corrupt the delivered prompt, because
prompt correlation compares with trailing whitespace removed, so `prompt`, `prompt ` and
`prompt  ` all match the same expected value.

> [!warning]
> That safety argument holds only for evidence CC Relay can observe. It assumes Claude never accepts
> a paste silently, that is without a `UserPromptSubmit` hook, without a transcript prompt record,
> and without reporting busy. If a future Claude composer rule breaks that assumption, attempts fire
> against a live invisible turn, and a Return can take the default option of a pending
> `AskUserQuestion` selector. This is not a new failure mode, but this change multiplies its surface
> by four: one action became up to four. The mitigations are unchanged and unproven against a future
> composer: the fresh idle read, the transcript state gate, and the exhaustion bound. Treat a Claude
> Code upgrade that changes paste or submit handling as a reason to re-verify this page's live
> behavior, not as a routine version bump.

Two failure modes stay exactly as before:

- A submit action that throws still fails the turn non-retryably. An unknown Apple Event outcome
  means an unknown composer state, so no further action is attempted.
- Failure after the schedule is exhausted is non-retryable and now names how many actions were
  sent: `... and sent 3 separate submit actions, but the Claude session still never started the
  turn.`

One deliberate softening: a transient failure to re-resolve the exact terminal no longer ends the
turn at the first occurrence. It sends nothing, keeps the schedule intact, and re-verifies at the
next attempt. Three consecutive resolution failures reach the same non-retryable error the single
attempt used to raise immediately. A proven identity mismatch or a missing session still fails at
once.

## Defaults

| Option | Default | Meaning |
| --- | --- | --- |
| `submissionTimeoutMs` | 80000 | Window from injection in which submission evidence must appear |
| `submitNudgeMs` | 6000 | Delay before the first guarded action |
| `maxSubmitAttempts` | 4 | Hard cap on guarded actions per turn |
| `submitRetryMs` | 9000 | Base gap between actions |
| `submitRetryBackoffMs` | 3000 | Added to each subsequent gap |
| `submitConfirmMs` | 15000 | Window that must remain before an action is allowed |

The window is idle time, not wall time. Busy status and compaction suspend it, so these numbers
describe a composer that is sitting still with unsubmitted text in it.

Actions land near 6, 15, 27, and 42 seconds after injection, leaving 38 seconds of the window to
confirm the last one. All values remain constructor overridable, and the test suite keeps its own
short deterministic values with an injected clock.

The window grew from 20 to 80 seconds. A genuinely dead paste therefore holds one Claude slot, or
one Claude plus one Codex slot for a council, about 60 seconds longer than before. That is the
whole cost of the change, and it stays well inside the separate five-minute
`promptAcceptanceTimeoutMs` ceiling, so no new interaction with that bound exists.

## Diagnostics

- `claude/progress` with `deliveryState: 'submit-attempt'` carries `submitAttempt` and
  `submitAttemptLimit`, and its message reads `... so it sent one separate submit action (attempt 2
  of 4).` Recovery is now visible while it happens.
- `claude/started` carries `promptSubmissionEvidence` (`user-prompt-hook`, `transcript-prompt`, or
  since [[claude-image-prompt-correlation]] their `-normalized` counterparts for a rewritten image
  prompt) plus `submitAttempts`, the number of guarded actions that had been sent when the evidence
  arrived. `submitAttempts: 0` means Claude accepted the pasted Return with no help.

Busy status is deliberately not an evidence value. It never ends the submission wait, and naming it
as evidence is exactly the confusion that caused task 341.

## Rejected: splitting the paste from its Return

Terminal's `do script` always appends a Return, so injection cannot be split by simply withholding
one. Two real variants exist, and both were rejected.

- Paste, settle, then send a blind `" "` action. That is an unguarded Return. Sent early enough it
  can select a highlighted `AskUserQuestion` option, which is precisely the state the guarded
  contract exists to protect. A guarded attempt at 6 seconds does the same work with full evidence
  checks.
- Send `ESC[200~` plus the text without the closing marker, so the appended newline lands inside
  paste mode, then send `ESC[201~` in a second event whose appended newline becomes the submitting
  Return. This leaves the TUI in bracketed-paste mode between two Apple Events. If the second event
  is delayed or fails, the user's manual Return, the escape hatch that actually recovered tasks 15,
  341, 364, and 370, inserts a literal newline instead of submitting. That trades a recoverable
  failure for an unrecoverable one.

The happy path therefore still relies on the Return that Terminal appends to the paste, and the
bounded schedule is the recovery when that Return is swallowed.

## Resolved: image attachments break the transcript anchor

> [!important]
> Closed on July 30, 2026 by [[claude-image-prompt-correlation]], which also corrects one claim
> below. The `UserPromptSubmit` hook is **not** a working correlation path for an image-bearing
> prompt. A captured live hook payload from Claude Code 2.1.220 proved its `prompt` field is byte
> identical to the rewritten transcript record, so under the strict evidence contract an image turn
> had no usable evidence at all, not one path. The draft stage survived only because the build
> running that day predates the strict contract. CC Relay now derives the exact rewritten form from
> the task's own attachment paths and accepts it on both channels, without loosening the contract.

Task 39's own successful draft stage exposes a separate defect that this change does not fix.

`taskPrompt()` appends `1. image.png: /absolute/path.png` lines for reference images. Claude Code
converts those paths into attachment chips at submit time. The draft stage's first top-level user
record therefore reads `[Image #1] [Image #2]You are the author ...` with `text`, `image`, `image`
blocks, and the paths removed from the body. That text can never equal the delivered prompt, so
`isSubmittedPromptRecord` cannot correlate it and `transcriptCorrelated` stays false for the whole
turn.

The draft stage still completed, but not because the hook rescued the correlation. The build running
that day predates the strict exact-prompt contract, and its `Stop` hook supplied the final response.
This page originally read that outcome as proof that the hook remained a working correlation path
for image prompts. [[claude-image-prompt-correlation]] disproved it with a captured live payload:
the hook reports the same rewritten text as the transcript, so before that fix an image-bearing turn
had **no** usable evidence on either channel and would have burned the entire bounded schedule
against a turn that had already submitted correctly, then failed at `promptAcceptanceTimeoutMs`.
Both fixes therefore have to be live together, which they are, since both ship on the same restart.

It was not fixed here on purpose, because loosening `submittedPromptMatches` would weaken the
exact-prompt contract from [[claude-continuation-compaction-recovery-review]]. The separate fix
avoids that: instead of relaxing the comparison, it derives the exact rewritten prompt Claude
records and requires a complete match against that. See [[claude-image-prompt-correlation]] for the
captured evidence, the three normalization rules, and the four evidence values.

## Resolved follow-up: the predicted composer-change risk fired the same day

> [!important]
> The warning above, that a Claude Code composer change could break the blind-typing assumptions,
> materialized on July 30, 2026: Claude Code 2.1.220's large-session resume picker swallowed a
> resumed council's entire paste before this schedule could guard it, and all four attempts fired
> on an empty composer. The executor now reads the exact owned terminal viewport before typing and
> before every separate submit action, answers the picker deliberately, verifies the held paste
> placeholder on screen, and re-injects a provably lost paste once. See
> [[claude-resume-picker-guard]].

## Files

- `src/claude-terminal-executor.mjs`
- `test/claude-terminal-executor.test.mjs`

## Deployment

Restart CC Relay before validating. A Node process does not reload changed ESM modules, and task 370
was already lost once to exactly that skew. The build running during this incident is older still:
its progress message read `CC Relay saw no evidence that the pasted turn had started`, wording that
predates the current source, although the timing constants it used are provably identical because
the failure reproduces the observed tick exactly.

See [[resume-dispatch-audit]] for task 39's first, unrelated failure in the same stage, plus
[[claude-resumed-council-submit-review]], [[claude-fresh-council-submit-recovery]],
[[claude-continuation-compaction-recovery-review]], [[claude-terminal-input]],
[[claude-terminal-submit-review]], [[plan-council]], and [[hot]].

#relay #claude #terminal #plan-council #incident
