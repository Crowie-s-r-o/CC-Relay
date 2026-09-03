---
name: Claude Composer Read Failure (namiru-ai-fc)
description: Claude Code 2.1.257 moved the /rc hint onto the working-directory row and started truncating the agent roster, so Relay's exact roster pattern refused a live follow-up before typing.
type: incident
tags:
  - relay
  - claude
  - terminal
  - composer
  - steering
  - continuation
  - safety
---

# Claude Composer Read Failure (namiru-ai-fc)

> [!important]
> Claude Code 2.1.257 draws the `/rc` hint RIGHT-ALIGNED on the working-directory row whenever that
> row is short enough for the terminal width, which puts the hint ABOVE the status row instead of
> below it, and it truncates a large background-agent roster with a `↓ N more` overflow row. The
> bounded roster extension added for [[claude-expanded-agent-panel-composer]] matched neither shape,
> so `classifyClaudeScreen()` again saw a status row while `claudeComposerContent()` returned
> `found: false`. Relay now anchors the roster on its `⏺ main` header, accepts both hint placements
> in either order, and accepts at most one trailing overflow row. Every other bound is unchanged.

## Incident evidence

On 2026-09-01 at 19:13:29.509 UTC, `relay-diagnostics.jsonl` recorded one
`task.claude.steer.failed` for task 1180 and session `namiru-ai-fc`
(thread `54aee069-c960-4bbb-8b05-f1ad6899cbcf`, Claude, model fable, xhigh effort):

- `deliveryUncertain: false`
- `submitAttempts: 0`
- `blockingComposerSubmitAttempts: 0`
- `composerStates: []`
- `CC Relay could not read the namiru-ai-fc Claude composer. Your live update was not sent.`

That combination is the same pre-injection signature as the August 21 incident: the update stopped
at the initial screen gate in `deliverActiveSteer()` without typing anything. The typed follow-up
was a short single-line message, so no prompt size or attachment path was involved.

The process was still live on `/dev/ttys010` in Terminal.app window `94880`. A read-only
`contents()` snapshot taken with the same JXA the executor uses reproduced the mismatch exactly, and
so did a second capture by an independent read-only scout. Sanitized tail, at 119 columns:

```text
✻ Waiting for 13 background agents to finish
                                                                     137878 tokens
───────────────────────────────────────────────────────────────────────────────────
❯
───────────────────────────────────────────────────────────────────────────────────
  dev@host:~/workspace/project-a  main  Fable 5.1  ctx:14%                       /rc
  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents
  ⏺ main
  ◯ lead-fullstack-engineer (+3)  Grepping email_fallback flow in index.ts    35m 16s · ↓ 190.4k tokens
  ◯ lead-fullstack-engineer (+1)  Reading isBookingLabel in the profile service 34m 49s · ↓ 189.2k tokens
  ◯ lead-fullstack-engineer       Grepping project-a CSS rules in styles.ts   34m 21s · ↓ 135.2k tokens
  ◯ lead-fullstack-engineer (+3)  Comparing indexable hero text in test_home.html 33m 51s · ↓ 155.2k tokens
  ◯ backend-api-security:backen…  Locating the firecrawl network policy       33m 21s · ↓ 179.4k tokens
  ↓ 2 more
```

Nine non-empty lines sit below the closing rule, against an ordinary bound of six. Fed through the
working-tree exports, that frame produced `{ classification: "composer", composer: { found: false } }`.

> [!note]
> The block above has its member descriptions and rule width trimmed so it fits this page. The exact
> 119-column geometry, including the non-breaking space after the caret, is preserved verbatim in
> `LIVE_TRUNCATED_AGENT_PANEL_CAPTURE` in `test/claude-terminal-executor.test.mjs`. Pattern work
> belongs against that fixture, never against this excerpt.

> [!note]
> This was not a stale packaged build. The composer section of the installed 0.2.27 asar is
> byte-identical to the working tree, and all three live Relay terminals resolve
> `~/.local/bin/claude` at 2.1.257. The `claude` on `PATH` is an unrelated 2.1.84 Homebrew shim and
> is never what a Relay terminal runs.

## Root cause

`isBoundedClaudeComposerChrome()` located the roster from the hint and rejected the frame on three
independent rules, any one of which was enough:

1. `CLAUDE_AGENT_PANEL_HINT_PATTERN` was `/^\/rc$/`, so a right-aligned `/rc` on the
   working-directory row never matched and `hintIndex` stayed `-1`.
2. The old code required `statusIndex < hintIndex`. The new layout puts the hint row FIRST and the
   status row second, so even a suffix-tolerant hint match would still have failed.
3. Five member rows were followed by `↓ 2 more` for thirteen live agents. That row is not a member
   row, so `members.every()` was false.

Two other live frames captured the same minute prove the drift is width-dependent rather than a
clean version cutover. One long working-directory row wrapped `/rc` onto its own line below the
status row and read correctly under the old pattern, and a five-line chrome frame never reached the
roster branch at all. The same Claude build therefore produces both layouts, which is why the defect
presents as "Claude follow-ups fail often" rather than "always".

## Fix contract

`src/claude-terminal-executor.mjs` keeps `CLAUDE_COMPOSER_MAX_CHROME_LINES` at six and the roster
cap at twelve. A deeper boxed composer is accepted only when all of these hold:

1. A `⏺ main` panel header appears in the chrome below the closing rule, and its index plus one
   still fits inside the ordinary six-line bound. Anchoring on the header, not on the hint, is what
   makes both hint placements readable.
2. The fixed chrome ABOVE that header contains a known composer status row and the `/rc` hint, in
   either order. The hint matches its own line or a right-aligned trailing token, which demands at
   least two spaces before it, so prose such as `then run /rc` can never satisfy it.
3. Every row after the header is a measured `◯` member row, except that the LAST row may be a single
   `↓ N more` overflow row.
4. There is at least one and at most twelve member rows. The overflow row is a summary, so it never
   counts toward that cap and never substitutes for a member.

The failure message for this exact branch now carries the same bounded, sanitized screen excerpt the
neighbouring "is not showing Claude's message composer" branch already reported, so the next chrome
drift is self-diagnosing from `relay-diagnostics.jsonl` alone.

> [!warning]
> Making the hint optional was rejected. Every captured frame has it, and nothing in the evidence
> demands the looser bound. A future build that drops `/rc`, renames `⏺ main`, changes the `◯`
> member glyph or its duration and token layout, or shows more than twelve member rows will fail
> closed again. Capture that exact live frame before extending the pattern.

## Verification

- Three real frames captured read-only from live Terminal.app tabs are preserved as sanitized
  fixtures, with column positions, the non-breaking space after the caret, and the roster geometry
  intact.
- The positive test proves the task 1180 frame exceeds the ordinary bound, that its hint is a
  trailing token of the working-directory row drawn above the status row, and that it now reads as
  an empty composer.
- A second positive covers the full twelve-member roster plus its overflow row.
- Negative tests reject unrelated text in place of the overflow row, text after the overflow row,
  two overflow rows, a malformed count, a panel built only from overflow rows, a hint that is merely
  prose, a thirteenth member, and a `⏺ main` header pushed below the fixed-chrome bound.
- Reverting the correction in an isolated copy of the tree fails exactly the two new positive tests
  and leaves the negatives passing, which proves they test the fix rather than the fixture.
- The focused Claude terminal suite passes 215 of 215 tests.
- The complete repository suite passes 1,790 of 1,790 tests, and `npm run release:check` is clean.

## Rollout and residual risk

> [!important]
> The running packaged backend predates this source correction, and relaunching it is not enough.
> The desktop app must be REBUILT and REINSTALLED before a live follow-up uses the corrected gate.
> Do not restart it while task-owned terminals are active.

`composerStates` deliberately stays `[]` for a failure raised at this pre-injection gate. That empty
array is the meaningful reading that nothing was typed and that no recovery pass ever classified the
composer, and it is unchanged by this work. The sanitized excerpt now carried in the error string is
the diagnostic payload for this branch.

`task.claude.steer.failed` is written only to `relay-diagnostics.jsonl` through
`recordDiagnostic()` in `src/claude-execution-runner.mjs`. It never reaches the `events` table, so
these failures are invisible in task history and in any count derived from the database. The
diagnostics file also self-truncates at 5 MB down to its last 2 MB, so an incident older than that
window is unrecoverable. Both are why this incident had exactly one surviving record despite the
reported frequency.

## Files

- `src/claude-terminal-executor.mjs`
- `test/claude-terminal-executor.test.mjs`
- `wiki/claude-composer-read-failure-namiru.md`
- `wiki/claude-expanded-agent-panel-composer.md`
- `wiki/index.md`
- `wiki/hot.md`

See [[claude-expanded-agent-panel-composer]], [[claude-live-steer-outbox]],
[[claude-steer-text-hold-reliability]], [[claude-steer-delivery-evidence]],
[[claude-live-steering-review]], and [[diagnostics]].

#relay #claude #terminal #composer #steering #continuation #incident
