---
name: claude-fresh-session-paste-buffering
description: Why tasks 91 and 92 doubled their opening prompts on 2026-08-03, and why compaction bookkeeping froze the retry.
type: incident
tags: [claude, terminal-executor, paste, latch, compaction]
---

# Fresh-session paste buffering and the bookkeeping latch (tasks 91 and 92)

> [!important]
> Two distinct defects, both proven from real transcripts and the desktop events table on 2026-08-03. Neither is the stale-process story from earlier that day: both failures ran on the freshly built desktop bundle (app.asar 15:34 local, launched 16:08 local). See [[claude-launch-settings]] for that earlier diagnosis.

## Defect A: an empty composer on a starting session is buffered stdin, not a lost paste

Task 92 (fresh session `84ca0eff`, Agreau, 2 images, 65,966-char prompt) timeline, all times UTC:

1. `14:43:51` disposable terminal ready; `14:43:52` launch verified, not restarted (first command carried model, effort, `--settings`).
2. `14:43:53.088` CC Relay pasted the prompt. The paste carries its own appended Return.
3. `14:44:00.654` one screen read classified the composer as **empty**. The executor declared the held paste lost and pasted the exact same prompt again.
4. `14:44:11.157` Claude durably recorded **one** submitted user prompt: 132,976 chars, the task prompt **twice** (duplicate seam at offset 66,509), **four** image parts. Copy 1 prefixed `[Image #1] [Image #2]`, copy 2 began `[Image #4] [Image #5]`; the missing `#3` and `#6` were the two `[Pasted text]` placeholders, because Claude numbers image chips and paste widgets from one shared counter. Two paste widgets were submitted together by the buffered appended Returns; no separate submit action ever fired.
5. The unmatched-record latch correctly froze recovery; the unconditional five minute `promptAcceptanceTimeoutMs` failed the task at `14:48:53` and the pool closed the terminal while Claude was 4.5 minutes into real work on the doubled brief.

Mechanism: a freshly launched `claude` TUI renders its composer box before its input loop consumes stdin. SessionStart hooks on this machine emit roughly 77KB and delay input processing well past seven seconds. A bracketed paste sent in that window sits in the PTY buffer, invisible to the viewport scrape, and is **not lost**. When the input loop starts, every buffered paste flushes in together. Task 91 attempts 1 (`12:26:10`, chips `#1 #2` plus four image parts) and 2 (`12:34:42`, chips `#6 #7`) show the identical doubling under the previous desktop build, so the hole predates the August 3 changes; the queued-paste latch added that day only covers the busy-session `queue-operation: enqueue` variant, and a starting session writes no such record.

The control: task 94 (`15:07:41` paste) hit the same first check at about eight seconds, but its composer read **held**, so one guarded Return landed and verification completed 95ms later. The only difference between success and catastrophic doubling was whether the TUI had consumed the paste before the first screen read.

## Defect B: slash-command bookkeeping latches recovery off after a resume compaction

Task 91 attempt 3 (`14:25:49`, resume of the 3MB session `a0c55566`) timeline:

1. The large-conversation resume dialog appeared; CC Relay answered it (Resume full session as-is). A compaction ran `14:26:00` to `14:27:31` anyway; CC Relay pasted at `14:26:00.620` right as it began.
2. After compaction, Claude Code 2.1.220 flushed these records past the injection offset (file order, not timestamp order): the `isCompactSummary` summary, an `isMeta` caveat record, and two **`isMeta`-absent** user records beginning `<command-name>/compact</command-name>` and `<local-command-stdout>`.
3. `userPromptRecordText` only dropped tool results and `isCompactSummary`; the latch in the executor excludes only literal `/compact`, `isMeta`, and `isSidechain`. The two bookkeeping records passed every check, latched `unmatchedSubmissionObserved`, and recovery froze before the held paste was ever submitted.
4. The task failed 81 seconds after compaction ended (the 80 second submission window, which pauses during busy and compacting states) with the "could not match to this task" error. Both files carried comments claiming slash-command bookkeeping was already dropped; the code never dropped it.

This defect blocks every retry that resumes a large session, which is exactly what a manual retry of task 91 or 92 does.

## Fixes landed 2026-08-03, adversarial verdict Ship, full suite 1014 of 1014

- **Fix A** (`src/claude-terminal-executor.mjs`): re-injection at an empty composer now requires positive loss evidence: `pasteSeenHeld || pickerResolvedAfterPaste || composerClearProven || compactionObserved`. A never-seen paste with no dialog and no compaction is buffered stdin; the executor waits in the new one-time `paste-unconsumed` state instead of re-delivering. Two review rounds mattered: the first predicate used the shared `pickerResolutions` counter, and the reviewer executed a proof of concept showing a picker answered BEFORE injection (task 91 attempt 3 did exactly that at 14:25:58.510) still licensed a doubling re-paste on a resumed session whose post-picker load buffers stdin. The final latch (`pickerResolvedAfterPaste`) is set only by the post-injection guarded-schedule resolution; the shared counter still drives the `maxResumePickerResolutions` bound. The genuinely dead paste (an inject that reported success but delivered nothing) now ends in the existing explicit manual-retry failure instead of being rescued by a blind re-paste, the accepted trade for never doubling again. Executor tests 169 of 169.
- **Fix B** (`src/claude-transcript-tail.mjs`): `userPromptRecordText` returns empty for records whose trimmed text starts with `<command-name>`, `<local-command-stdout>`, `<local-command-stderr>`, or `<local-command-caveat>`, making the long-standing comment true. The stderr marker is anticipatory hardening: a failing slash command would write it `isMeta`-absent and recreate the freeze byte for byte. Returned bytes are never trimmed, so exact-equality and suffix correlation are unchanged. Accepted narrow residual: a task prompt literally OPENING with one of the markers loses the transcript channel and correlates only through the `UserPromptSubmit` hook. Bookkeeping tests 9 of 9.

Residuals judged non-blocking by review: the seconds-wide stale `compact_boundary` flush race (unobserved across 27 real Agreau transcripts; hardening option is a timestamp floor, which would deliberately change the timestamp-free-boundary test pin), and the marker-prefixed-prompt hook-only correlation above.

## Operational state, same day

- The stale July 29 standalone `node src/server.mjs` (pid 22097) was still running with zero queued or running tasks and was stopped gracefully at about 15:25 UTC. It predated every July 30 to August 3 fix and had already runtime-adopted a desktop launch at 11:21 UTC. With it gone, only the desktop backend runs. The cross-process launch-ownership guard still arms only when every running backend carries the registry code, so restart any standalone from the current tree only. See [[dual-backend-ownership-guard]].
- The running desktop app predates Fixes A and B. **Quit and rebuild the desktop app after live tasks finish, then retry tasks 91 and 92.** Their retries resume large sessions and need Fix B to survive the resume compaction.

## Follow-up worth doing (not landed)

- Failure-close destroys live work: task 92's terminal was closed one second after an error message telling the user to check that terminal, wiping 4.5 minutes of active work. When the turn is provably running at failure time, retaining the window (like the Keep task terminals open path) would preserve the work while still releasing the task. Tracked as a policy change, deliberately not bundled with these fixes.
- A SessionStart hook in the CC Relay `--settings` set would give the executor a positive input-loop-ready signal for fresh launches, removing the guesswork about when the first paste may be sent.

Related: [[claude-image-prompt-correlation]], [[claude-steer-delivery-evidence]], [[claude-resume-picker-guard]], [[claude-held-paste-multi-attempt-submit]], [[disposable-terminal-pools]].
