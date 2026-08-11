---
name: Claude Steer Text Hold Reliability
description: A text-only live update to a running Claude session is typed into the composer and never submitted, because the literal multi-row rendering of a three line paste put the caret past the one-row composer depth bound and every guarded recovery pass classified it as unreadable.
type: incident
tags:
  - relay
  - claude
  - terminal
  - steering
  - continuation
  - review
---

# Claude Steer Text Hold Reliability

> [!important]
> A single-line follow-up message is a **three line paste**, because `taskPrompt()` appends the
> non-interactive notice after a blank line. Three lines never collapse, so Claude renders the text
> literally and word-wraps it over four or more composer rows. That puts the caret nine or more
> non-empty lines above the bottom of the screen, past the former `CLAUDE_COMPOSER_MAX_TAIL_DEPTH`
> of 8. `claudeComposerContent()` returned `found:false`, every guarded recovery pass classified
> `'unreadable'`, and an `'unreadable'` composer receives **no action by design**. The message was
> typed and then sat in the composer until the operator pressed Return by hand. The composer scan
> is now bounded by the **chrome below the closing rule**, which is small and stable, instead of by
> the caret depth, which grows with the content.

## Operator report

2026-08-07: "when I have a running Claude session and I send a follow-up message it should
immediately send it to terminal. often happens that it writes to terminal and does not send it.
this needs to be really reliable because it's the core feature."

## Evidence

### The installed desktop app was three defects behind

The running backend at diagnosis time was PID 71391,
`/Applications/CC Relay.app/Contents/MacOS/CC Relay`, started 2026-08-05 19:06 and still up. Its
`app.asar` is dated 2026-08-05 18:49. Extracted and diffed against the working tree, its
`src/claude-terminal-executor.mjs` carries `steerAcceptanceTimeoutMs = 25_000` and the **one-action**
`deliverActiveSteer`, that is, the code from **before** the August 5
[[claude-live-steer-held-paste-recovery|task 129 fix]]. Only one CC Relay backend was running, so
there was no dual-ownership confusion.

### The one recorded failure is the stale build, not the classifier

`relay-diagnostics.jsonl` in the packaged data root holds exactly one Claude steer on 2026-08-07:

| UTC time | Event | Detail |
| --- | --- | --- |
| 10:29:38.886 | `task.claude.steer.requested` | task 163, session `1758d94a`, `attachmentCount: 1` |
| 10:30:06.018 | `task.claude.steer.failed` | `deliveryUncertain: true`, "within **25 seconds**" |

The literal string "within 25 seconds" is the packaged build's bound and is impossible from the
working tree, which uses 80. The receiving transcript
(`1758d94a-5dcf-4689-9a90-30edbd40cf3a.jsonl`, read only) has **no** user record and **no**
`queue-operation` enqueue record for that text anywhere in the window; the only enqueue at
10:32:01 is an unrelated `<task-notification>`. So the update was typed and never accepted, with
one guarded action available and swallowed.

> [!note]
> Task 163 does **not** evidence the classifier defect. With one attachment `taskPrompt()` produces
> **six** lines, which is over the collapse threshold, so it rendered as a one-row chip exactly like
> task 129 and the depth bound never applied. That incident is explained entirely by the stale
> build.

### The classifier defect is derived, then measured

No text-only steer failure appears in the diagnostic log, so the second defect was found by reading
the code and then **measured on real frames**, not inferred. A private pty probe drove a throwaway
Claude Code **2.1.224** in a scratch directory, pasted a steer-shaped payload with a bracketed
paste, never pressed Return, and rendered the screen through a terminal emulator. Captured at 80
columns:

```text
────────────────────────────────────────────────────────────────────────────────
❯ also fix the spacing in the header

  CC Relay orchestrator notice: this is a non-interactive run and no answers
  can be provided. Do not ask questions, request approval, or wait for user
  input. Make reasonable assumptions and proceed autonomously. If progress is
  impossible, report the blocker and end the run.
────────────────────────────────────────────────────────────────────────────────
  user@host:/path
  ⏵⏵ bypass permissions on (shift+tab to cycle)
                                                                            /rc
```

Run through the shipped classifier, with the probe-only warning row removed so the frame matches a
normal operator terminal:

| Case | Caret depth | Pre-fix state | Post-fix state |
| --- | --- | --- | --- |
| one-line steer at 100 columns | 8 | `held` | `held` |
| one-line steer at 80 columns | 9 | **`unreadable`** | `held` |
| 400 character one-line steer at 80 columns | 14 | **`unreadable`** | `held` |
| two-line steer at 80 columns (collapses to a chip) | 5 | `held` | `held` |

Terminal.app's default window is **80 columns**, and the pass at 100 columns clears the old bound by
exactly one line. That is why the operator saw it "often" rather than always: the outcome depended
on window width and message length.

Three further facts the probe settled, each of which the fix depends on:

- Claude Code **word-wraps** the literal rendering and hard-splits only a token longer than the box.
- The composer grows one row per wrapped segment at these sizes; it does not cap or scroll.
- The chrome below the closing rule is **three** non-empty rows normally and four when Claude adds
  a warning row.

### Why the test suite did not catch it

`heldPasteFrame` in `test/claude-terminal-executor.test.mjs` rendered a one to three line paste as
**only its first non-empty line on a single row**. Every held-paste test therefore exercised a
one-row composer, which is the collapsed-chip geometry, and the literal multi-row geometry that
every text-only steer actually produces was never represented.

## Root cause

`CLAUDE_COMPOSER_MAX_TAIL_DEPTH = 8` bounded how far the caret may sit above the bottom of the
screen. It was calibrated on captures of a **collapsed** paste, whose body is one row. A literal
paste's body height is content-dependent and unbounded, so the bound rejected the real composer,
`claudeComposerContent()` returned `found:false`, and `claudeComposerState()` returned
`'unreadable'`. The recovery loop in `deliverActiveSteer()` acts only on a positive `'held'`
classification, so it correctly sent nothing, forever.

The invariant that actually holds is the inverse of the one that was coded: the body **above** the
closing rule grows with the content, while the chrome **below** it is small and stable.

## Fix contract

- `claudeComposerContent()` scans a larger composer-only window, `CLAUDE_COMPOSER_TAIL_LINES = 40`.
  Dialog classification keeps the tighter `CLAUDE_SCREEN_TAIL_LINES = 15` window, so quoted option
  rows deep in a transcript still cannot match a resume picker or trust dialog.
- A **boxed** composer is accepted when the last rule below the caret has at most
  `CLAUDE_COMPOSER_MAX_CHROME_LINES = 6` non-empty lines beneath it, **and** one of those lines below
  the caret matches `CLAUDE_COMPOSER_STATUS_ROW_PATTERNS`. The scan still runs bottom-up, so the
  lowest qualifying caret, which is the live composer, always wins. The status-row corroboration was
  added on 2026-08-07 after review: box edges alone are not proof, because a scrolled-up transcript
  can end on the same shape, a rule, a row starting with a plain `>` because it quotes an error,
  prose, a closing rule, and a few prose lines under it. That shape is not a composer and has no
  status row, and reading it as one answers `'junk'`, which on the opening-prompt path sends the
  clearing Ctrl+C into the real composer further down and destroys this turn's own held paste. The
  pre-change scan rejected it because it demanded the closing rule DIRECTLY below the caret or this
  same status row, so the corroboration restores the property the widened box scan dropped.
- An **unboxed** composer keeps the original conservative `CLAUDE_COMPOSER_MAX_TAIL_DEPTH` bound.
- The scan runs in **two passes**. The first accepts only a caret whose immediately preceding line
  is the composer's opening rule, which every captured 2.1.224 frame draws; the second falls back
  to the rule-free acceptance so no pre-existing rendering stops being recognized. This exists
  because `CLAUDE_COMPOSER_CARET_PATTERN` also matches a plain `>`, and once literal multi-row
  bodies became the recognized common shape a wrapped row starting with a quoted error, a markdown
  blockquote, or a diff marker would be taken as the caret. The extracted body would then be only
  the TAIL of the paste, which no longer contains the prompt's first line, so this turn's own held
  text classified as a foreign draft: silent end of recovery on the steer path, and a Ctrl+C clear
  of the just-pasted prompt on the opening-prompt path.
- A composer taller than the scan window fails closed as `'unreadable'`, never as `'empty'`.
- The anchor containment test gains a whitespace-stripped fallback, gated on
  `CLAUDE_COMPOSER_MIN_STRIPPED_ANCHOR_CHARS = 24`, so a hard-wrapped long token cannot produce a
  false `'junk'`. The fallback is not a shortened comparison: it requires the composer to reproduce
  the **entire** anchor with whitespace ignored, and the anchor is this prompt's first non-empty
  line, whitespace collapsed, capped at `CLAUDE_COMPOSER_ANCHOR_CHARS = 40` and therefore the WHOLE
  first line whenever that line is shorter than forty characters. Ignoring whitespace is what makes
  it weaker, so a stripped anchor under 24 characters is refused outright rather than compared: such
  an anchor is mostly spaces once stripped and degenerates towards the empty string, which every
  composer contains. A refused turn falls back to the clear and re-inject path, which still delivers
  the exact prompt.
- An **inconclusive** read no longer consumes a slot of the action schedule. `'unreadable'` is
  re-read on a short `steerRecheckMs = 1_500` gap, bounded by `steerRecheckLimit = 8`, and the
  action backoff is driven by actions actually sent rather than by loop passes.
- `composerStates` records the ordered classification of every recovery pass and is reported on both
  the success result and the failure diagnostic, alongside the existing `submitAttempts`.

Nothing about the bounds changed: the backend acceptance bound is still 80 seconds, the renderer
still waits 120 seconds, and the action cap is still four.

### Preserved fail-closed invariants

Every one of these is pinned by a test and was verified by reversing it:

- An `'unreadable'` composer still receives **no** action, ever.
- A definite foreign draft (`'junk'`) still stops the schedule immediately with zero actions.
- An empty composer after an action still receives no second Return when evidence is absent.
- A queued update still confirms from its exact enqueue record with zero actions.
- The prompt is never re-typed or re-pasted, and `deliveryUncertain` is never auto-resent.

## Tests

New in `test/claude-terminal-executor.test.mjs`:

- `a text-only live steer is recognized in its captured multi-row composer frame` pins the captured
  2.1.224 frame, asserts the caret really does sit past the old depth bound, and keeps the foreign
  prompt negative and the empty-composer reading intact.
- `the composer scan is bounded by the chrome below its closing rule` pins the new negatives: a
  replayed caret with too much below its rule, a composer taller than the scan window, and the
  blast-radius invariant that widening the scan cannot make a frame newly read `'empty'` and so
  cannot reach `runTurn`'s prompt re-injection. Blank rows are filtered out of the tail before
  classification, so even an all-blank composer body collapses to the shallow shape the old bound
  already accepted.
- `a wrapped row that begins with a quote marker is not mistaken for the caret` proves the hazard
  is present in the frame before asserting that the whole paste is still extracted from the real
  caret, and keeps the foreign-prompt negative.
- `a text-only live update held in its literal multi-row form receives a guarded submit` is the
  operator's case at 80 columns.
- `a long single-line live update hard-wrapped across the composer still recovers` proves the wrap
  really splits the anchor before asserting recovery.
- `a text-only live update collapsed under a cumulative paste counter recovers` covers the chip form
  with a non-1 counter and keeps the line-count negative.
- `an unreadable first read does not consume a guarded submit attempt` sizes the backoff as a large
  fraction of the window so the pre-fix schedule would be retired with zero actions.
- `an unreadable composer alone never presses Return and stays bounded`.
- `a foreign draft in the composer still receives zero guarded submit actions`.

Added on 2026-08-07 by the review hardening:

- `a scrolled quote block shaped like the composer box is unreadable, never a foreign draft` builds
  the transcript shape the review probed, asserts every structural feature of the composer box is
  present in it and that no status row is, then pins `found:false`, `'unknown'`, `'unreadable'`, and
  a steer schedule with zero actions whose every recorded classification is `'unreadable'`.
- `a short whitespace-heavy anchor is refused by the stripped comparison floor` pins the negative
  side of the stripped fallback. It proves the same prompt IS recoverable when rendered normally,
  then proves the plain comparison fails and the stripped comparison would succeed on the mangled
  frame, so the floor is the only thing refusing it, and asserts `'junk'` with zero actions.

`heldPasteFrame` now renders a one to three line paste faithfully, word-wrapped across every row it
needs, so the whole existing suite exercises the real geometry.

### Mutation checks

Each ran against a scratch copy of `src` and `test`, never the working tree.

| Mutation | Killed by |
| --- | --- |
| Restore the raw caret depth bound and the tight tail window | 5 tests, including the captured-frame pin and the 80 column recovery test |
| Remove the whitespace-stripped anchor fallback | the hard-wrapped test only |
| Restore the loop-pass backoff and drop the fast recheck | the inconclusive-read test only |
| Drop the opening-rule first pass | the quote-marker test only |
| Treat an unreadable composer as held | the inconclusive-read test and the unreadable-alone test |
| Never stop on a foreign draft | the foreign-draft test |
| Drop the boxed status-row corroboration (2026-08-07) | the scrolled-quote-block test only |
| Lower `CLAUDE_COMPOSER_MIN_STRIPPED_ANCHOR_CHARS` from 24 to 1 (2026-08-07) | the short-anchor floor test only |

The first mutation initially **survived** the main recovery test, because the default fixture width
of 98 columns lands the caret at depth exactly 8 and clears the old bound. The test now builds its
frame at 78 columns and asserts the caret depth exceeds the bound, so it cannot silently stop
exercising the defect.

Full suite: **1100 of 1100 passing**, up from the 1089 baseline by the nine tests above plus the two
review-hardening tests added on 2026-08-07. The floor mutation is the one that matters most here: at
1098 tests the floor could be lowered from 24 to 1 with the whole suite still green, which is why it
now has a test of its own.

## Residual risk

- **The desktop app must be rebuilt.** None of this reaches the operator until the packaged app is
  rebuilt and relaunched. The installed build additionally lacks the entire August 5 multi-attempt
  recovery, so it will keep failing at 25 seconds after one action until it is replaced.
- **`CLAUDE_COMPOSER_MAX_CHROME_LINES` is a measured constant.** A future Claude Code that adds
  several chrome rows below the closing rule would push the composer back out of recognition. The
  failure is closed: `'unreadable'`, no action, a held message and an uncertain report.
- **A composer taller than 40 rows** fails closed for the same reason. Reachable only from a very
  long single-line message in a tall window.
- **The status-row corroboration narrows `classifyClaudeScreen` too.** A composer box drawn with no
  status row from `CLAUDE_COMPOSER_STATUS_ROW_PATTERNS` anywhere below the caret is now `'unknown'`
  rather than `'composer'`, so CC Relay refuses to type instead of typing. The family is an any-of
  list precisely because the row swaps content by state and is believed to cover every state, and a
  future Claude Code that renders the composer with none of them would degrade to a refusal with an
  excerpt, never to a wrong keystroke.
- **The pty capture is 2.1.224 at 80 and 100 columns.** Narrower widths and future versions are
  covered by the structural rule rather than by capture, and drift fails closed.
- **The whitespace-stripped fallback is a genuine, if small, loosening.** A foreign draft would have
  to reproduce the entire anchor ignoring whitespace, which is this prompt's first non-empty line up
  to forty characters and the whole first line when that line is shorter. Below 24 stripped
  characters the comparison is refused outright instead of weakened further, so the loosening never
  reaches a short anchor that is mostly whitespace. The alternative was a false `'junk'`, which on
  the opening-prompt path triggers a Ctrl+C clear of our own held paste.
- **`recoveryCheck` is now only a loop counter.** It no longer drives spacing; the backoff follows
  `submitAttempts`. Left in place because it reads naturally in the exit condition.

## Files

- `src/claude-terminal-executor.mjs`
- `src/claude-execution-runner.mjs`
- `test/claude-terminal-executor.test.mjs`

See [[claude-live-steer-held-paste-recovery]], [[claude-steer-delivery-evidence]],
[[claude-live-steering-review]], [[claude-image-prompt-correlation]], and
[[claude-held-paste-multi-attempt-submit]].

#relay #claude #terminal #steering #continuation #incident
