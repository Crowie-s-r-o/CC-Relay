---
name: Claude Expanded Agent Panel Composer
description: A live Claude follow-up failed before typing because the expanded background-agent roster pushed the real composer past Relay's ordinary chrome-depth bound.
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

# Claude Expanded Agent Panel Composer

> [!important]
> Claude Code 2.1.238 can render an expanded background-agent roster below its normal composer
> chrome. Relay task 1003 showed four member rows, leaving eight non-empty rows beneath the
> composer's closing rule. The ordinary safety bound is six, so `classifyClaudeScreen()` correctly
> saw Claude's status row while `claudeComposerContent()` still returned `found: false`. Three live
> follow-up attempts failed before typing anything. Relay now accepts only a bounded, exact agent
> roster extension while retaining the six-line rule for every other screen shape.

## Incident evidence

On 2026-08-21, diagnostics recorded three failures for task 1003 and session `agreau-58` at
14:02:19, 14:02:43, and 14:02:48 UTC. Every record had:

- `deliveryUncertain: false`
- `submitAttempts: 0`
- `blockingComposerSubmitAttempts: 0`
- `composerStates: []`
- `CC Relay could not read the agreau-58 Claude composer. Your live update was not sent.`

This combination proves the update stopped at the initial screen gate before injection or any
submit action. The still-live process was attached to `/dev/ttys010` in one exact Terminal.app
window. A read-only `contents()` snapshot reproduced the mismatch:

```text
────────────────────────────────────────
❯
────────────────────────────────────────
dev@host:~/workspace  branch  Fable 5  ctx:...
⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents
/rc
⏺ main
◯ worker ... 8m 54s · ↓ 347.1k tokens
◯ worker ... 8m 44s · ↓ 329.3k tokens
◯ worker ... 8m 12s · ↓ 90.0k tokens
◯ worker ... 1m 22s · ↓ 55.9k tokens
```

The real closing rule had eight non-empty lines beneath it. Before the correction, the same live
frame produced `{ classification: "composer", composer: { found: false } }`.

## Root cause

The six-line `CLAUDE_COMPOSER_MAX_CHROME_LINES` limit was calibrated on the working-directory row,
permission row, `/rc` hint, `main` row, and one warning margin. The static `main` row was already in
the older captured fixture, but active worker rows were not. An expanded roster therefore looked
like arbitrary transcript output beneath a quoted composer and failed closed.

This is the residual drift risk documented in [[claude-steer-text-hold-reliability]] becoming real.
The refusal was safe, but it made the core follow-up path unavailable whenever enough background
agents were visible.

## Fix contract

`src/claude-terminal-executor.mjs` keeps the general six-line bound unchanged. A deeper boxed
composer is accepted only when all of these conditions hold:

1. A known Claude composer status row appears before an exact `/rc` line.
2. The next non-empty line is `⏺ main`.
3. Every remaining row is a measured `◯` member row with a duration and downward token count.
4. The roster has at least one and at most twelve member rows.
5. The fixed chrome through `main` still fits within the ordinary six-line bound.

The status-row corroboration for a boxed composer now searches only chrome below its closing rule.
Prompt body text can no longer satisfy that check by merely containing text such as
`shift+tab to cycle`.

> [!note]
> Simply raising the ordinary bound from six to eight was rejected. It would make unrelated text
> beneath a composer-shaped transcript block eligible. Tests prove that one malformed roster row
> or a roster beyond the separate cap still returns `found: false`.

## Verification

- The sanitized regression fixture preserves the exact composer and four-member panel geometry.
- The positive test proves the frame exceeds the ordinary bound and reads as an empty composer.
- Negative tests reject unrelated tail text and thirteen member rows.
- The focused Claude terminal suite passes 207 of 207 tests.
- The complete repository suite passes 1,653 of 1,653 tests.
- A second read-only pass against the same live Terminal.app window produced
  `{ classification: "composer", composer: { found: true, text: "" }, state: "empty" }`.

## Rollout and residual risk

The running packaged backend predates this source correction. Do not restart it while task-owned
terminals are active. Rebuild or install the corrected desktop app, then restart Relay after active
work drains before retrying the follow-up.

A future Claude build that changes `/rc`, `⏺ main`, the member glyph, or the duration/token layout
will fail closed again. Capture that exact live frame before extending the pattern. More than twelve
visible member rows also fail closed by design.

## Files

- `src/claude-terminal-executor.mjs`
- `test/claude-terminal-executor.test.mjs`
- `wiki/claude-expanded-agent-panel-composer.md`
- `wiki/claude-steer-text-hold-reliability.md`
- `wiki/index.md`
- `wiki/hot.md`

See [[claude-live-steering-review]], [[claude-steer-delivery-evidence]],
[[same-task-session-continuation]], and [[diagnostics]].

#relay #claude #terminal #composer #steering #continuation #incident
