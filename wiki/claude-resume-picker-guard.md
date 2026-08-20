---
name: Claude Resume Picker Guard
description: Task 39 fourth failure mode, the Claude Code 2.1.220 large-session resume picker, and the screen-state gate that now protects every typed prompt.
type: incident
tags:
  - relay
  - claude
  - terminal
  - plan-council
  - recovery
---

# Claude Resume Picker Guard

> [!important]
> CC Relay no longer types into a Claude terminal on session status alone. Before any paste, the
> exact owned Terminal.app viewport is read and classified. A known blocking dialog is answered
> deliberately, an unknown one fails closed with an excerpt, and only a positively detected
> composer receives the prompt. During the guarded submit schedule, every separate Return first
> verifies on screen that the held paste is still there, and a provably lost paste is re-injected
> once. This closes the July 30, 2026 task 39 resume failure and the residual risk that
> [[claude-held-paste-multi-attempt-submit]] explicitly predicted: a Claude Code composer change
> broke the assumptions behind blind typing.

## Incident

Task 39's Plan council was resumed roughly five hours after its author conversation was created.
The revision stage relaunched the exact owned terminal with `claude --permission-mode plan
--resume 85369a08-... --model fable --effort max --tools Read,Glob,Grep,AskUserQuestion
--add-dir ...`. Claude Code 2.1.220 did not open the composer. It showed a blocking picker:

```
  This session is 3h 6m old and 187.2k tokens.

  Resuming the full session will consume a substantial portion of your usage limits. We recommend
  resuming from a summary.

  ❯ 1. Resume from summary (recommended)
    2. Resume full session as-is
    3. Don't ask me again

  Enter to confirm · Esc to cancel
```

CC Relay's readiness signal was only `claude agents --json`, and the session registers there as
idle while the picker is displayed. Readiness was declared 2 seconds after relaunch, the 201-line
revision prompt was bracketed-pasted into the picker, and the Return that Terminal `do script`
appends confirmed the highlighted default option 1. That ran a 2.5 minute compaction (the
PreCompact and PostCompact hooks fired, and the existing compaction suspension in `watchTurn`
worked exactly as designed). The paste itself was swallowed with zero trace. After compaction the
composer held only stray junk, all four guarded submit Returns fired on that empty composer, and
the turn failed at the 80 second idle submission window with zero evidence. The failure report was
accurate; the paste it was guarding had been destroyed before the first attempt.

## Ground truth (pty probe against the real 2.1.220 binary, plus live JXA captures)

- The picker's gate, decompiled from the shipped binary: remote feature flag `tengu_gleaming_fair`
  must be on, user config `resumeReturnDismissed` must be absent, the session's last real record
  must be older than 70 minutes (`CLAUDE_CODE_RESUME_THRESHOLD_MINUTES`), and the estimated tokens
  must exceed 100k (`CLAUDE_CODE_RESUME_TOKEN_THRESHOLD`). The token estimate is the trailing
  assistant record's `input + cache_creation + cache_read + output` token sum.
- Option values: `compact` executes `/compact`, `continue` is a pure no-op full resume, `never`
  writes `resumeReturnDismissed: true` into `~/.claude.json`. Esc dismisses to the composer and
  persists nothing.
- The single ASCII digit `2` selects and confirms "Resume full session as-is" in one keystroke.
  Down-arrow moves the pointer; the appended Return then confirms.
- A bracketed paste sent at the live picker is swallowed with zero trace regardless of content;
  digits inside a paste are inert. The composer is empty afterwards. This reproduced the incident
  exactly.
- A bracketed paste of 4 or more lines collapses in the composer to `[Pasted text #N +M lines]`
  with `M` equal to line count minus 1; 1 to 3 line pastes render literally. Image-bearing prompts
  show `[Image #N]` chips before the placeholder.
- One Ctrl+C with composer text clears it. One Ctrl+C on an empty composer shows only a transient
  `Press Ctrl-C again to exit` hint, and a second press inside that window exits Claude. Empty and
  whitespace-only submits fire no hook and start no turn.
- Terminal.app JXA `tab.contents()` returns the rendered viewport only, plain text, which is what
  makes bounded tail classification safe.
- A second blocking dialog with identical chrome exists for untrusted folders, matching
  `Yes, I trust this folder` and `No, exit`.
- The composer caret is `❯` (U+276F), the same glyph the picker uses for its selected row, so
  dialog detection must run before composer detection.

## The guard

All in `src/claude-terminal-executor.mjs`, all constants exported and frame-tested.

1. **Screen-state gate before typing, fail closed.** An injectable `readScreen` (defensive JXA,
   never throws) feeds `classifyClaudeScreen`, which examines the last 15 viewport lines:
   `resume-picker`, `trust-dialog`, `composer`, or `unknown`. The gate runs inside
   `relaunchForTask`'s ready loop and again in `runTurn` before the injection offset is captured,
   so picker bookkeeping records always land before the offset. Dialog detection requires two or
   more line-anchored numbered option rows, the `Enter to confirm` footer, and the U+276F pointer
   on at least one matched row (the pointer requirement narrows, but does not eliminate, the
   false positive from a byte-verbatim quoted dialog in the replayed transcript; the bounded
   consequence is two stray keystrokes and a fail-closed error). An unknown screen polls to the
   deadline and fails non-retryably with a sanitized excerpt. The exact legacy or current folder
   trust dialog is approved once for the task-selected workspace; every other prompt remains
   unknown and receives no key. A snapshot failure degrades to the pre-change readiness behavior,
   announced once per turn as `screen-unverified`, because the gate must never become a new failure
   source. See [[claude-folder-trust-startup]] for the earlier pre-discovery gate.
2. **Picker resolution.** The digit `2` is sent (its appended Return lands on the now-empty
   composer, a verified no-op), the screen is re-read after `screenSettleMs`, and a still-present
   picker gets one down-arrow fallback. At most `maxResumePickerResolutions` (2) resolutions per
   turn, shared across all gates. Never a bare Return at a picker, never `1`, never `3`; CC Relay
   must never write the user's global `resumeReturnDismissed` preference. Resolution always
   chooses the full session: exact context fidelity is the point of resuming a council or
   continuation, and the summary path is the one that destroyed task 39.
3. **Residue normalization.** A confirmed composer with visible content receives one spaced
   Ctrl+C; if the re-snapshot still shows content, the turn fails closed without pasting. This is
   what removes the leftover junk photographed in the incident. `composerClearSpacingMs` (5000)
   is enforced in code across every clear site, so two Ctrl+C can never land inside Claude's
   exit-hint window.
4. **Held-paste verification and bounded re-arm.** Before each guarded submit Return, the screen
   is read: the expected `[Pasted text #N +M lines]` placeholder (count computed from the exact
   prompt, tolerating image chips) or the literal first line for short prompts means the Return is
   sent as before; a confirmed empty composer means the paste is provably lost and the full prompt
   is re-injected, at most `maxPromptReinjections` (1) per turn, with the attempt schedule's next
   gap reset; foreign text means one spaced clear, then re-arm if cleared. A resume picker or
   trust dialog appearing after the paste is handled without consuming a submit attempt.
5. **The `junkUnproven` latch.** Once a snapshot positively shows foreign text, no Return may be
   sent until a readable snapshot proves the composer is empty or holds our paste. An unreadable
   re-snapshot after the clear skips the attempt and keeps the schedule alive instead of falling
   through to a blind Return that could submit foreign text. The submission window still bounds
   the turn, so a permanently unreadable screen cannot wedge it.
6. **Fail-open after injection, deliberately.** A readable but unrecognized composer at submit
   time keeps today's blind Return, because refusing everything unclassifiable there would turn a
   recoverable held paste into a guaranteed dead task. Only the junk latch overrides this.
7. **Heartbeat honesty.** While no submission evidence exists, the busy heartbeat says Claude is
   busy before accepting the prompt instead of claiming the turn is running.

New constructor options: `readScreen`, `sendKeys`, `screenSettleMs` 1500,
`maxResumePickerResolutions` 2, `maxTrustDialogResolutions` 1,
`maxPromptReinjections` 1, `composerClearSpacingMs` 5000, and
`relaunchTimeoutMs` raised 20000 to 30000 to cover picker resolution plus a large full-session
load. New `claude/progress` deliveryStates include `resume-picker-resolved`,
`folder-trust-approved`, `composer-cleared`, `re-injected`, and `screen-unverified`. Nothing
outside the executor consumes `deliveryState`, so no renderer change was needed.

## Verification

- 128 executor tests (99 before), 878 total repository tests, all green, verified independently
  by the adversarial reviewer.
- The shipped classifier was executed against all 36 real pty frames captured from the live
  2.1.220 binary at 100x40, 60x30, and 44x30, including mixed resolution sequences, with zero
  misclassifications, re-run after the pointer tightening with unchanged results.
- The shipped `READ_SCREEN_JXA` was executed read-only under real JXA on Darwin 25.5.0: a valid
  window returns contents, a missing window and a non-numeric id return a structured failure,
  never a throw.
- The literal task 39 replay is pinned as a test: paste swallowed by a late picker, resolution
  without consuming an attempt, single re-arm, correlation with `submitAttempts: 0`.
- Adversarial review verdict: Ship. One confirmed issue found in review (the junk-then-unreadable
  blind Return) was closed by the latch; the reviewer judged the latch strictly safer than their
  own suggested fail-closed alternative.

## Known bounded risks, accepted

- A user who scrolls an owned terminal up hides its composer from the viewport read; the
  pre-injection gate then fails closed after the readiness timeout with a message naming the fix.
- A byte-verbatim quoted dialog including the pointer line in the last 15 rendered lines can
  still trigger at most two stray resolution keystrokes and a loud fail-closed error.
- A foreign collapsed paste whose line count matches this prompt's within the placeholder
  tolerance would be submitted and then fail loudly on prompt correlation, the pre-existing
  identity ambiguity of the placeholder rendering.
- If Claude ever accepts a paste with all three evidence channels silent, one re-injection can
  duplicate held text; a duplicate turn additionally requires the evidence to stay silent through
  the next gap, the same residual assumption [[claude-held-paste-multi-attempt-submit]] already
  names.

## Falsified ideas

- Any CLI flag, settings.json key, or supported switch to suppress the picker: none exists in
  2.1.220. The internal env thresholds work but are undocumented, and this repository forbids
  adding environment variables.
- Matching picker text anywhere on screen: the picker renders below the replayed transcript, so
  substring matching would false-positive on conversations that quote it, including this wiki.
- Verifying a held paste by its prompt text: impossible for 4 or more lines, the composer shows
  only the collapse placeholder.
- A single fail-closed rule everywhere: before injection it is safe, after injection it would
  convert recoverable holds into guaranteed dead tasks.

## Files

- `src/claude-terminal-executor.mjs`
- `test/claude-terminal-executor.test.mjs`

## Deployment

Restart CC Relay to activate: finish active tasks, restart the standalone `node src/server.mjs`,
and quit and rebuild the packaged desktop app if used. Run only one backend at a time. Then retry
task 39's Resume council; the picker will be answered with the full session and the revision
prompt verified on screen before every submit action.

See [[claude-held-paste-multi-attempt-submit]], [[resume-dispatch-audit]],
[[claude-image-prompt-correlation]], [[claude-continuation-compaction-recovery-review]],
[[plan-council]], [[disposable-terminal-pools]], and [[hot]].

#relay #claude #terminal #plan-council #incident
