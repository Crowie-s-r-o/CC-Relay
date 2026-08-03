---
name: Claude Fable Reviewed Plan Execution Incident
description: Task 58 exposed a macOS Fish startup race and an unrecognized Claude image-prompt slash rewrite.
type: incident
tags:
  - relay
  - claude
  - fable
  - terminal
  - attachments
  - reviewed-plan
---

# Claude Fable Reviewed Plan Execution Incident

> [!important]
> Rebuild and relaunch the desktop app before retrying Task 58. The installed app that ran the
> incident predates both fixes. Do not restart CC Relay while another task is active.

## Incident

Desktop Task 58 was created by executing the reviewed plan from Plan council Task 39 with Claude
Fable at xhigh effort. It was a normal disposable Execute task, not a failing Plan council stage.
The task had one image and a 30,423-character saved prompt.

Two independent failures occurred:

1. Three fresh Claude terminals timed out before Claude started. The command remained visibly held
   at the Fish prompt. A fourth identical launch connected.
2. Claude accepted the implementation prompt and wrote tool and assistant records, but CC Relay
   did not recognize the exact prompt in the transcript. It waited five minutes and failed the
   task as delivery-uncertain.

## Root cause 1: provider command raced Fish startup

`ProjectLauncher` previously created a new Terminal.app window and supplied the real provider
command in the same `do script` call. Terminal appends Return to that command. With the user's Fish
startup configuration still busy, the Return could be consumed while the command text remained at
the new shell prompt.

The long initial Claude command includes token-scoped live-hook settings. Its length made the race
easy to reproduce, but Fable itself was not involved.

Live reproduction on the incident machine:

- Old one-step launch: 3 of 5 long harmless commands were still held after four seconds.
- Guarded two-step prototype: 5 of 5 commands executed.
- Patched production `ProjectLauncher`: 3 of 3 hook-sized harmless commands executed and each exact
  test window was closed through owned-launch cleanup.

### Decision

macOS provider launch now:

1. Opens an empty tab with `do script ""`.
2. Captures the exact owning window before any provider command is sent.
3. Waits for that exact tab's `busy` property to clear, proving the empty no-op reached the shell.
4. Sends the provider command to that exact tab.

The wait is bounded to ten seconds. If the shell does not become ready, CC Relay sends no provider
command, returns `shell_not_ready` with the exact owned launch, skips session discovery, and lets
the disposable pool close that exact terminal. The same guard protects Claude and Codex launches.

## Root cause 2: Claude rewrote spaces before slash characters

Task 58's Claude transcript proves the prompt was accepted:

- Delivered prompt length: 30,901 characters.
- Recorded text length after the known image rewrite: 30,746 characters.
- The transcript contains the complete user prompt, tool calls, two background-agent launches, and
  an assistant stop response.

The existing [[claude-image-prompt-correlation]] normalization produced a candidate of the same
30,746-character length, but four characters differed. Claude changed every space immediately
before `/` into a newline:

- `View Input / View Output`
- ``GET /api/...``
- ``PUT /api/...``
- ``POST /api/...``

This deterministic rewrite was absent from the earlier image-prompt captures, so neither the
transcript nor `UserPromptSubmit` could satisfy the full-prompt comparison.

### Decision

`attachmentRewrittenPrompts()` now emits both complete candidates after the established image-path,
blank-line, and chip transformations:

- spaces before slash characters retained
- every space before a slash replaced by a newline

This remains attachment-gated. Text-only prompts receive no new candidate. Matching still requires
the complete prompt, and a partial slash conversion remains invalid.

The saved production prompt and Task 58 transcript now produce `exactFullPromptMatch: true`.

## Files

- `src/project-launcher.mjs`
- `src/terminal-launch-coordinator.mjs`
- `src/claude-transcript-tail.mjs`
- `test/project-launcher.test.mjs`
- `test/terminal-launch-coordinator.test.mjs`
- `test/claude-terminal-executor.test.mjs`

## Verification

- Focused terminal, pool, runner, and prompt-correlation suites: 232 passed.
- Full repository suite: 910 passed.
- `git diff --check`: clean.
- Live guarded Terminal launch smoke: 3 of 3 hook-sized commands executed.
- Production Task 58 prompt replay: exact full-prompt match confirmed.

## Task 61 activation audit

Task 61 retried the same reviewed-plan execution at `2026-07-30T21:52:21Z`, after the source
fixes were written, but it still ran the old packaged backend:

- `/Applications/CC Relay.app/Contents/Resources/app.asar` was built at 23:25 local time.
- `src/project-launcher.mjs` received the shell-ready fix at 23:36, and the incident source and
  prompt-correlation work finished at 23:42.
- The installed app process started at 23:51 from the 23:25 bundle.
- Task 61's `terminal.launch.dispatched` diagnostic has no `shellReady` property. The current
  launcher always records that property, so this is direct execution-path proof rather than an
  inference from file timestamps.

The Task 61 Claude transcript also proves that no further correlation rule is missing. Its delivered
prompt was 30,901 characters. Claude recorded a 30,746-character user prompt at
`2026-07-30T21:52:40.284Z`, and the current `attachmentRewrittenPrompts()` candidates match that
record exactly. The stale backend declared the composer empty and re-injected at 21:52:41, then
timed out because it could not recognize the already accepted turn. A current build accepts that
first record.

The screenshot attached to the follow-up report is from launch
`58083d80-d992-4242-89c1-ced2bed41ea9`, an earlier Task 62 attempt at 22:05. The long hook-bearing
Claude command is visibly held at the Fish prompt and that launch timed out. The next fresh launch
connected, which is consistent with the intermittent one-step startup race. The installed bundle
used for both attempts predates the two-step shell-ready barrier.

> [!warning]
> A standalone `node src/server.mjs` process from July 29 was also running beside the packaged app.
> Terminal ownership is process-local, so after active tasks finish, run only one CC Relay backend.
> Rebuilding the desktop app is required; reopening the old installed bundle cannot load repository
> source changes.

## Recovery

Task 58 failed at `2026-07-30T21:33:15Z` and its disposable terminal was closed exactly. Its Claude
conversation transcript exists, so manual retry after rebuilding CC Relay will resume the saved
conversation rather than initialize an empty UUID. The target repository may contain partial work
from the interrupted background agents; the retried provider must inspect the current tree before
continuing.

## Task 61 bundle audit, confirmed by extraction

A second pass extracted `app.asar` directly and compared every packed module against the working
tree. Exactly three files differ, and all three are the previous session's fixes:

- `src/claude-transcript-tail.mjs` (working tree 23:42:10), the slash-boundary normalization.
- `src/project-launcher.mjs` (23:36:34), the two-step shell-ready barrier.
- `src/terminal-launch-coordinator.mjs` (23:36:34), the launch-reservation release.

Every other packed `src/` module, and all of `public/`, is byte identical to the working tree. That
narrows the stale-bundle claim from a timestamp inference to an exact inventory, and it means
relaunching does not also swap in unrelated in-flight work.

Replaying the real record through both versions settles which change was load bearing. Against the
transcript record `45035695-34ef-4938-8df2-013a0a7a8bfb`, the packaged
`attachmentRewrittenPrompts()` derives one candidate and matches `false`; the working-tree version
derives two and its slash-converted candidate matches `true` at 30,745 of 30,745 normalized bytes,
with zero differing lines. The prompt contains five space-before-slash boundaries and the transcript
converted all five, including the `.data/tasks/39/plan.md` reference and three `/api/...` paths.

So the correlation fix alone explains Task 61. The launcher barrier and the reservation release were
not involved: the events show the terminal came up cleanly (ready 21:52:27Z, relaunch 21:52:28Z,
ready with fable at xhigh 21:52:31Z).

> [!warning]
> Task 61 was not a task that quietly did nothing. Claude accepted the prompt and worked. Its
> transcript runs to `21:56:49.957Z`, spawned two sub-agents under
> `11c1a817-f3d8-4624-9bfc-f261458eb2ad/subagents/`, and its last assistant message reads
> "Team is up and running". CC Relay declared the task failed at `21:57:33Z` and closed the terminal
> one second later, destroying live work. Treat an unverified prompt as possibly running, never as
> provably lost.

The two-backend question is closed for this incident: the standalone `node src/server.mjs` holds
`/Users/patrikkelemen/WebstormProjects/relay/.data/relay.sqlite`, a different database from the
packaged app's `dual-agent-orchestrator/relay.sqlite`, so it could not have driven Task 61.

## Hardening: an empty composer is not proof of a lost paste

The correlation fix removes this specific trigger, but the decision it fed remains ambiguous by
construction. A successful submit and a swallowed paste leave the *same* empty composer, so the
recovery at `21:52:41.901Z` re-pasted a 30k prompt into a session that was already working.

`src/claude-terminal-executor.mjs` now latches `unmatchedSubmissionObserved` when a top-level user
prompt record lands after this turn's injection offset that no derived form matches. The transcript
reader already starts at `injectionOffset`, so every record it sees is post-paste by construction.
`isMeta` excludes Claude's own `[Image: source: ...]` annotation, which rides along with a submit
rather than being one, `isSidechain` excludes sub-agent traffic, and Claude's `/compact` bookkeeping
record does not count as a task submission.

While that flag is set, every automatic recovery action is blocked, including re-paste, Return,
resume-picker input, and composer clearing. The executor drains the transcript again after awaited
session and screen reads, immediately before the action gate. This closes the race where a durable
submission could arrive during the screen read after the loop's earlier drain. The turn announces
`unverified-submission` once and can still end unverified, which is deliberate: failing without a
duplicate send is strictly better than running a long prompt twice. Its timeout now says the turn
may actually be running instead of also claiming that Claude never started it.

This never grants submission evidence. An unmatched record is only permission to stop, never proof
the exact prompt arrived, so the [[claude-image-prompt-correlation]] exactness contract is unchanged.

### Both evidence channels latch, not just the transcript

Code review found the remaining double-send path: the durable record is not the earliest signal.
`UserPromptSubmit` fires first, and in this class of failure it carries the same unmodelled
rewritten text the record will carry seconds later. An unmatched hook payload used to be dropped
silently, so a hook at T+1 with the JSONL still unflushed at T+8, sampled against a stale idle
status, would have re-pasted anyway.

`consumeHook` now latches on the same terms as the record path: `!promptSubmitted`, a non-empty
prompt, and not `/compact`. The existing `agent_id` guard is this channel's equivalent of
`isSidechain`, and steering cannot reach the latch because a steer is acknowledged only while
`promptSubmitted` is already true.

One pre-existing expectation moved as a direct consequence. A text-only turn whose hook reports a
blank-line-collapsed prompt still never *anchors* the turn, which is what that contract has always
meant, but its closing guidance no longer says the terminal may be holding unsubmitted text. A
`UserPromptSubmit` for this session with no `agent_id` means Claude submitted something, so the old
wording invited a duplicate run of a turn that may already be live.

Every guard in the latch is now pinned by a mutation-checked fixture: removing the hook latch, the
`/compact` exclusion, the `isMeta` exclusion, or the `isSidechain` exclusion each turns a test red.
Dropping the `/compact` exclusion also breaks the pre-existing task 15 compaction contract, which
independently confirms the alignment.

Verification after the hook-channel latch: all 142 executor tests pass, as does the full repository
suite (925 tests when this landed, a total that keeps moving while the interface redesign adds its
own coverage).
The regression suite includes the production empty-composer timeline, Claude's `isMeta` image
annotation, sidechain user traffic, automatic compaction, an unmatched submission that arrives
during the awaited screen read while the composer still appears to hold text, an unmatched
`UserPromptSubmit` hook that lands before the durable record flushes, and a `/compact` hook that
must not latch.

## Activation build

The verified source was packaged on July 31 at 00:35 local time:

- `dist/CC-Relay-0.1.0-mac-arm64.dmg`
  - SHA-256 `13f5dfbef10bff4bcf017878b762766e075c0caddbb1a32737cbd23bb477bd2b`
- `dist/CC-Relay-0.1.0-mac-arm64.zip`
  - SHA-256 `cf2e81db6f78c1128b96c232e5dfe4891bbf9261da1a8930beea2d4f252e29be`

The DMG checksum, ZIP integrity, and deep code-sign verification pass. All 76 packed `src/` and
`public/` files are byte identical to the tested working tree, including the four launch and
prompt-delivery modules. Electron Builder applied only its normal `package.json` production
transform, removing development scripts and development dependencies.

The new app was not copied over `/Applications/CC Relay.app` and the old process was not restarted,
because active queue tasks were still running. Finish those tasks first, quit the old app, install
the DMG, and make sure the separate `node src/server.mjs` development backend is not also running.

See [[disposable-terminal-pools]], [[claude-terminal-visibility]],
[[claude-image-prompt-correlation]], [[claude-held-paste-multi-attempt-submit]],
[[claude-resume-picker-guard]], and [[plan-council]].

#relay #claude #fable #terminal #attachments #incident
