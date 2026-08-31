---
name: Claude Image Prompt Correlation
description: Claude rewrites image-bearing prompts before recording them, in both the transcript and the UserPromptSubmit hook, and the deterministic normalization CC Relay derives to keep the exact-prompt contract intact.
type: review
tags:
  - relay
  - claude
  - terminal
  - attachments
  - plan-council
---

# Claude Image Prompt Correlation

> [!important]
> An attachment-bearing prompt is never recorded as delivered. Claude Code's composer strips the
> image paths, collapses blank lines, and prefixes `[Image #N]` chips. **Both** evidence channels
> report that one rewritten form: the durable transcript record and the `UserPromptSubmit` hook
> payload are byte identical to each other and different from the delivered text. CC Relay now
> derives the observed complete forms and accepts them on both channels. Task 58 added one more
> deterministic form: every space immediately before `/` became a newline. The contract stays exact: a complete
> prompt, never a prefix, a suffix fragment, or a substring.

> [!important]
> **Chips are numbered per session, not per prompt.** Task 84 proved the derivation was wrong to
> assume a run always starts at `[Image #1]`. Its council revision stage went into the session that
> had already drafted with the same two image references, so Claude recorded
> `[Image #3] [Image #4]You are the original plan author ...`, and `[Image #5] [Image #6]...` after
> the user pressed Resume. Neither matched, the stage sat in unverified-submission for the full five
> minute `promptAcceptanceTimeoutMs`, and CC Relay declared it failed and closed both terminals
> **while the transcript shows Claude had already completed it**: the prompt was injected at
> `12:28:23Z`, the assistant finished a 28,701-character final plan at `12:32:23Z`, and CC Relay
> failed the stage at `12:33:16Z`. Correlation now validates the chip run instead of deriving it.

## Why this was urgent

[[claude-held-paste-multi-attempt-submit]] recorded this as an open risk and assumed the hook was
still a working correlation path for image prompts. That assumption is wrong. The hook carries the
same rewritten text as the transcript, so under the strict task 15 evidence contract an
image-bearing turn had **no** usable evidence source at all.

Every Plan council stage delivers `taskPrompt()` output that repeats the reference-image block, and
every Execute task with attachments carries one. Restarting CC Relay onto the strict contract
without this fix would have failed all of them at the five minute `promptAcceptanceTimeoutMs`,
after burning the full bounded submit schedule against a turn that had already submitted correctly.

## Evidence

### Live captured hook payload (decisive)

A throwaway Claude Code 2.1.220 session was driven over a private pty, never through Terminal.app,
so no live CC Relay window was touched. It ran with `--settings` pointing at a `UserPromptSubmit`
command hook that appended its raw stdin to a file, mirroring how `src/claude-hook-bridge.mjs`
registers hooks. The prompt was bracket-pasted and submitted with a separate Return, exactly as
`ClaudeTerminalExecutor` injects.

Delivered:

```text
reply with the word ok

Reference images are attached. Use the Read tool to inspect every image before working:
1. probe.png: /private/tmp/.../hookprobe/probe.png

filler line one
filler line two
```

Captured `UserPromptSubmit` payload `prompt` field:

```text
[Image #1]reply with the word ok
Reference images are attached. Use the Read tool to inspect every image before working:
1. probe.png:
filler line one
filler line two
```

The same session's transcript user record carried `text` and `image` blocks whose text was **byte
identical** to that hook payload. So the answer to "does the hook deliver raw or rewritten text" is
**rewritten**, and the two channels cannot disagree.

> [!note]
> Scope of that capture. The probe used a `type: command` hook because a command hook is the only
> kind whose stdin can be recorded locally; CC Relay registers `type: http` hooks. The result is
> transport independent: the rewrite happens in the composer, upstream of hook dispatch, and the
> probe's own transcript record agrees with its hook payload byte for byte while the three
> production transcripts show the identical transform. Nothing in the hook transport touches the
> `prompt` field.

### Production samples

Six independent CC Relay turns reproduce the observed transforms. Each was reconstructed by
running the real `taskPrompt()`, `authorPrompt()`, or `revisionPrompt()` against the stored task row
or plan record, then compared byte for byte with what Claude wrote.

| Sample | Shape | Result |
| --- | --- | --- |
| Plan council author, 2026-07-30T13:13:50Z, session `ca15cbad` | 1 attachment path referenced twice | exact, 4332 chars |
| Plan council author, task 39, 13:22:36Z, session `85369a08` | 1 attachment path referenced twice | exact, 4354 chars |
| Direct Execute, task 41, 13:55:40Z, session `44823b7a` | 3 distinct attachment paths | exact, 675 chars |
| Reviewed-plan Execute, task 58, 21:28:22Z, session `37f54b2e` | 1 attachment and 4 space-before-slash occurrences | exact, 30746 chars |
| Council revision, task 84, 2026-07-31T12:28:23Z, session `096214a6` | 1 path referenced twice, chips `#3` `#4`, slash conversion | exact, 27577 chars |
| The same prompt after Resume, task 84, 12:34:48Z, same session | identical bytes, chips `#5` `#6` | exact, 27577 chars |

The council samples reference one file twice because `authorPrompt()` and `revisionPrompt()` append
their own reference block and `taskPrompt()` then appends a second one. Claude emitted **two** chips
for that single file, which is how the rule below was pinned to occurrences rather than unique paths.

Task 84 was replayed through the real builder chain
(`revisionPrompt()` over the stored `plan.json` brief, draft, and review, then the terminal
executor's `taskPrompt()` wrapper and `sanitizeInjectedPrompt()`): 27,828 delivered characters
against 27,577 recorded. Stripping the leading chip run from both recorded records leaves 27,556
characters that are **byte identical** to the derived body, on the slash-converted reading. The chip
numbers were the only difference, on both attempts.

> [!note]
> The cumulative numbering had already been observed and written down without being recognized.
> [[claude-held-paste-multi-attempt-submit]] records task 39's revision stage holding
> `[Image #3] [Image #4][Pasted text #5 +201 lines]` in the composer, while the same page's draft
> stage record begins at `[Image #1] [Image #2]`. Same session, second stage, chips continuing from
> where the first stage stopped. That page was reasoning about a held paste, so the indices were
> quoted as incidental detail. They were the rule.

### What is not evidence

- `relay-diagnostics.jsonl` contains no hook payloads. CC Relay hooks are `type: http` and their
  bodies are never persisted.
- Transcript `hook_*` attachment records only cover `type: command` hooks and carry stdout and
  stderr, never the payload delivered on stdin.
- The one global `UserPromptSubmit` command hook on this machine,
  `~/.claude/hooks/obsidian-wiki-prompt.sh`, explicitly discards stdin.

That is why the controlled capture was necessary.

## The exact normalization

`attachmentRewrittenPromptForms(prompt, attachmentPaths)` in `src/claude-transcript-tail.mjs`
derives the expected recorded form. It works from the task's own known attachment paths, so it never
has to guess Claude's path detector and is extension agnostic for free.

1. **Path removal.** Every occurrence of a known attachment path is removed, together with one
   immediately preceding space when there is one. `1. image.png: /abs/01.png` becomes
   `1. image.png:` with no trailing space. Paths containing spaces, such as
   `/Users/.../Application Support/...`, are handled because the known path is matched literally.
2. **Blank line collapse.** Runs of two or more newlines collapse to a single newline. This is
   scoped to image-bearing prompts: text-only prompts preserve blank lines. Literal tabs are the
   one separately proven terminal transport exception described in [[claude-tab-prompt-correlation]].
3. **Chip prefix.** One `[Image #N]` chip per removed **occurrence**, joined by single spaces and
   concatenated directly onto the rewritten text with no separator. The indices are strictly
   consecutive ascending integers, and the run starts wherever the **session** had reached, which is
   any integer `>= 1`. `[Image #1] [Image #2]You are the author ...` is one member of that family,
   not the rule. Only the count is contractual, because it is the one thing derivable from the
   prompt CC Relay delivered.
4. **Slash boundary.** Claude may replace every space immediately before `/` with a newline. Task
   58 applied this to prose and API paths alike, and task 84 reproduced it across a 27 KB prompt.
   CC Relay emits both the retained-space and all-newline forms. A hybrid that converts only some
   occurrences is rejected.

Two readings of rule 2 are emitted and deduplicated: collapse `\n{2,}` to `\n`, and drop empty
lines. No sample contains a whitespace-only line, so they cannot be told apart, and both remain
complete transforms of the whole prompt. Derivation runs on `sanitizeInjectedPrompt()` output with
line endings normalized first, so it mirrors the text that was actually injected.

The function returns `chipCount: 0` and no bodies when no known attachment path occurs in the
prompt. That gate keeps text-only correlation out of the attachment rewrite path. Text-only prompts
accept only their complete raw or exact tab-expanded terminal transport form.

### How rule 3 is enforced

Because the start index is not derivable, `submittedRewrittenPromptMatches(value, forms)` matches
rather than compares. It anchors on the body first, which is what keeps the whole thing exact:

1. Require the candidate to end with one derived body, byte for byte.
2. Take everything before it as the prefix, and require the prefix to end with exactly `chipCount`
   chips that begin at the start of the candidate or immediately after a newline.
3. Require those indices to be strictly consecutive and to start at `1` or higher. The pattern reads
   `[1-9]\d*`, so `[Image #0]` and a zero-padded `[Image #01]` are rejected without a second check.
4. Refuse an **empty body**. The body is what identifies the turn, and once the start index stopped
   being contractual an empty one would degenerate into "any record ending in a newline and one
   chip", which is not evidence of anything. A prompt consisting solely of attachment paths
   therefore derives no anchor at all, exactly like a text-only prompt. No current builder can
   produce one, because `taskPrompt()` always appends the reference list and the non-interactive
   notice; the refusal exists so a future call site cannot create a worthless anchor. It is enforced
   in both places: the derivation drops whitespace-only bodies and reports `chipCount: 0`, and the
   matcher skips an empty expectation in case a caller assembles a `forms` value itself.

The chip run is therefore only ever validated, never searched for, and the two accepted shapes stay
exactly the two raw correlation accepts: `chips + body`, and hook-injected context followed by a
newline and then `chips + body`. A longer run cannot satisfy a shorter expectation, because its
trailing chips are preceded by `] ` rather than by the text start or a newline.

`attachmentRewrittenPrompts()` still renders the canonical start-at-one strings. That is the form
this page and the tests quote; live correlation must not compare against it.

### The rejected alternative: deriving the exact start

The obvious fix is to compute the true start by counting image blocks already recorded in the
session transcript, then expect exactly `[Image #k+1] ... [Image #k+K]`. It was rejected:

- **Compaction** rewrites the transcript. A compacted session keeps a summary, not the original
  image turns, so a replayed count is wrong in whichever direction compaction happened to fall.
- **Sidechains** are excluded from correlation elsewhere, but sub-agent turns can carry images, and
  whether the composer's counter advances for them is unobserved. Guessing here fails closed on a
  turn that actually succeeded, which is precisely the bug being fixed.
- **Manual user turns** are legitimate. CC Relay does not own the terminal's history: a user who
  drops an image into the same session between two CC Relay stages shifts every later index.
- It buys nothing. The count is what proves the prompt is complete; the start proves only which
  turn of the session it was, which correlation does not need and cannot verify.

Validating consecutiveness keeps the property that matters (a complete, unambiguous rewrite of this
exact prompt) without depending on session history CC Relay cannot reconstruct.

## Why the contract stays strict

Nothing was loosened to a substring, prefix, or suffix.

- The derived form is a complete deterministic transform of the entire delivered prompt. Matching it
  requires the whole prompt, exactly as raw matching does.
- Raw equality is still checked first, so the reported evidence value always names the form that
  actually arrived.
- Every existing negative stays negative: compact summaries, tool results, `/compact`, truncated
  text, and unrelated prompts. Half-rewritten forms are rejected too, so chips without path removal,
  or path removal without chips, prove nothing.
- The only new theoretical collision is a different prompt that differs from this one **solely** in
  runs of blank lines. That is not a class the task 15 contract exists to defend against, and it
  cannot be produced by compaction, tool output, or a foreign turn.
- Accepting any chip start adds no collision either. Two prompts whose bodies are byte identical
  after the complete transform are the same prompt; the chip run only says which turn of the session
  carried it. A rewritten record that is not this prompt still fails on the body, and the steering
  channel uses the same helper, so a live update is held to the same rule.

## Diagnostics

`claude/started` keeps `promptSubmissionEvidence`, now with four values, so the rewrite path is
observable live rather than inferred:

| Value | Meaning |
| --- | --- |
| `transcript-prompt` | Durable transcript record matched the delivered text exactly |
| `transcript-anchor-normalized` | Durable transcript record matched the derived rewritten form |
| `user-prompt-hook` | `UserPromptSubmit` matched the delivered text exactly |
| `user-prompt-hook-normalized` | `UserPromptSubmit` matched the derived rewritten form |

For an image-bearing turn only the two normalized values can ever appear. Seeing a raw value there
would mean Claude changed its composer behavior and this page needs revisiting.

## Residual risk

- **Partial chip conversion.** If Claude ever converted some referenced paths and left others as
  text, that hybrid matches neither the raw prompt nor the fully rewritten form, and the turn would
  fail at `promptAcceptanceTimeoutMs`. Not engineered around: CC Relay only ever references image
  files it just wrote, so every reference is a real readable file and all of them convert. Named
  here so the next reader knows it was considered.
- **Composer rule drift.** These rules are pinned to Claude Code 2.1.220. A future build could
  change chip formatting or stop collapsing blank lines. The failure mode is loud and safe: an image
  turn stops producing evidence and fails closed, exactly as it did before this fix. Re-run the pty
  capture described above to re-derive the rules.
- **Non-image attachments.** Only image paths are converted. Nothing else in the delivered prompt is
  known to be rewritten.

## Tests

In `test/claude-terminal-executor.test.mjs`:

- `attachmentRewrittenPrompts reproduces the recorded chip form for one, two, and three image references`
  asserts the production shapes for one image, one image referenced twice, and three distinct
  images, asserts the captured live hook payload literally, and asserts that the delivered text
  matches none of them.
- `attachmentRewrittenPrompts is extension agnostic because it only removes known attachment paths`
  covers `.webp` and `.jpeg`, and an unrelated absolute path that is not an attachment.
- `attachmentRewrittenPrompts leaves text-only prompts without attachment rewrite forms` asserts no
  attachment rewrite is produced without an attachment reference, and that a blank-line-collapsed
  text-only prompt is rejected.
- `the rewritten prompt anchor still rejects a different, truncated, or half-rewritten prompt`
  covers a different prompt with the same image, two truncations, a compact summary, a tool result,
  and both half-rewritten forms.
- `an image prompt Claude rewrote into chips still anchors the turn on the durable transcript`
  drives a full turn whose only evidence is the rewritten transcript record, and asserts
  `transcript-anchor-normalized` with zero guarded submit actions.
- `a rewritten UserPromptSubmit hook stops every further guarded submit action` asserts
  `user-prompt-hook-normalized` and exactly one submit action.
- `a text-only turn is unaffected: a rewritten-looking prompt never anchors it` asserts a text-only
  turn still fails when the hook reports a blank-line-collapsed prompt.
- `attachmentRewrittenPrompts reproduces Task 58 newline-before-slash normalization` pins the four
  character rewrite class and rejects a partial conversion.
- `a Task 58-style slash-normalized image prompt anchors the durable transcript` proves the
  complete rewritten record starts and completes the watched turn without a guarded submit.
- `a session-cumulative chip run anchors the same prompt at any start index` covers starts 1, 2, 3,
  8, 17, and 204, plus the task 84 council shape (two chips starting at three, with slash
  conversion) and its post-Resume `#5` `#6` form. It also asserts the regression directly: both
  forms fail against the derived start-at-one strings, which is what left task 84 unverified.
- `the cumulative chip rule keeps every rejection the start-at-one rule made` walks the whole
  negative battery through the new matcher: wrong chip count in both directions, gapped, repeated,
  and descending runs, a start below one, a zero-padded index, chips without path removal, path
  removal without chips, a partial slash conversion, two truncations, a different prompt with the
  same image, a compact summary, a tool result, and a text-only prompt that has no chip count.
- `a task 84 cumulative chip run anchors the turn on the durable transcript` drives the full council
  revision turn and asserts `transcript-anchor-normalized` with zero guarded submit actions.
- `a cumulative UserPromptSubmit hook stops every further guarded submit action` asserts
  `user-prompt-hook-normalized` and exactly one submit action for a hook payload numbered from four.
- `a text-only turn is never anchored by a cumulative-looking chip run` asserts a text-only turn
  still fails when the hook reports a chip-prefixed, blank-line-collapsed prompt.
- `a prompt that is nothing but attachment paths derives no anchor at all` pins the empty-body
  refusal on four bare-path shapes and on a hand-assembled `forms` value, and asserts that one
  surviving character is enough to anchor again, so the guard is scoped to the empty case.
- `a running terminal turn accepts an exact live update without creating another task` records its
  steer prompt with a cumulative run, which is what pins the steering channel under this rule.

Full suite: 947 tests passing, 148 of them in `test/claude-terminal-executor.test.mjs`. The count
keeps moving while the redesign adds coverage.

## Files

- `src/claude-transcript-tail.mjs`
- `src/claude-terminal-executor.mjs`
- `test/claude-terminal-executor.test.mjs`

See [[claude-held-paste-multi-attempt-submit]],
[[claude-continuation-compaction-recovery-review]], [[claude-terminal-input]], [[plan-council]],
[[claude-fable-reviewed-plan-execution]], and [[hot]].

#relay #claude #terminal #attachments #plan-council
