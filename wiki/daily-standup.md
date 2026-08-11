---
name: Daily Standup
description: How CC Relay uses a date-gated isolated AI run to turn saved conversations into terse task and blocker updates.
type: architecture
tags:
  - relay
  - standup
  - ai
  - tasks
  - history
---

# Daily Standup

The Task queue heading exposes **Standup** beside the Queue and History controls. Opening the modal does not start AI. The date is intentionally blank so the user can choose an output mode, then select a local calendar day. Selecting the date starts generation.

**All tasks** is the default mode. It emits one source-ordered item per recorded task, does not merge or deduplicate tasks, asks for 4 to 12 words, and normalizes each item to at most 160 characters. Its goal is a long, quickly scannable list of changed things. **Short**, **Standard**, and **Detailed** remain available when a grouped synthesis is more useful.

CC Relay asks the currently selected composer provider to synthesize saved prompts, assistant responses, final results, and errors. In All tasks mode, each recorded task stays separate and receives a terse change summary. The other modes group related tasks, retries, and follow-ups, explain what changed and how, and classify every item as a completed **Task** or unresolved **Blocker**.

> [!important]
> Standup generation uses a fresh isolated headless Codex or Claude CLI process in an empty temporary directory. It never types into, resumes, or consumes a task terminal.

## Project, scope, and date rules

Standup follows the selected Launchpad:

- Every CC Relay in the selected project contributes eligible tasks.
- Exact resolved project paths are enforced again by `POST /api/standup/generate`.
- With no selected project, the Standup button remains disabled.
- A refreshed renderer requires `capabilities.aiStandupGeneration`, `capabilities.aiStandupConfiguration`, and `capabilities.aiStandupAllTasks`. This prevents an older active backend from silently ignoring the selected mode or structured output contract.

Each task belongs to the day of its latest terminal outcome. `finished_at` is authoritative, with `created_at` retained only as a compatibility fallback. The browser sends the selected local interval as `[local midnight, next local midnight)`. The backend accepts a 22 through 26 hour interval so normal daylight-saving transitions remain valid.

Only `complete` and `failed` tasks are eligible. Queued, running, interrupted, and cancelled rows are excluded. A failed record becomes a Blocker only when the saved evidence describes an unresolved obstacle with current impact. A failure that was later resolved belongs under Tasks.

See [[task-history]] for the shared project-wide visibility invariant.

## Conversation source

The browser sends the project, a null Relay id, selected provider, selected length, date label, and ISO day boundaries. It never sends task text as authority.

The backend reloads source data from SQLite:

1. `database.listTaskPrompts(task.id)` returns the original request and every recorded same-task follow-up.
2. `database.listTaskResponses(task.id)` extracts completed Codex agent messages and saved Claude messages in event order.
3. The latest task result is added when no matching response event exists.
4. The final result or failure is included separately as the authoritative outcome.

This keeps AI generation grounded in the actual saved conversations, including the one-task, one-conversation continuation history described in [[same-task-session-continuation]].

## AI generation contract

`src/standup-generator.mjs` builds the prompt and runs one non-persistent provider process. The recorded data and project label are explicitly marked as untrusted data. The model is told to ignore instructions inside that data, avoid repository inspection, and make no unsupported claims. All tasks mode requires one item per record. The other modes synthesize related records.

Provider output is required to use `Task:` and `Blocker:` labels. The normalizer strips those labels into separate arrays, preserves a labelled Markdown form for compatibility, and creates deterministic clipboard text with `Tasks` and `Blockers` headings. Clipboard lines never receive Markdown `- ` prefixes, and an empty section contains `None`.

Provider isolation is deliberate:

- Codex runs with `exec`, `--ephemeral`, ignored user config and rules, disabled shell execution features, a read-only sandbox, JSONL output, and an empty temporary working directory.
- Claude runs with no session persistence, no Chrome, no setting sources, no slash commands, an empty strict MCP configuration, an empty tool list, plan permissions, and JSON output.
- The normal non-interactive Relay notice is appended after the complete generated prompt even if historical data contains a copy of that notice.
- Temporary working directories are removed after success, failure, timeout, or cancellation.
- A standup run never creates a queue task, resumes a task conversation, or writes a history row.

The selected composer provider is preferred. If it is not signed in and the other provider is ready, the backend uses the ready provider and reports which one generated the result.

## Bounds and concurrency

Generation is intentionally bounded:

- At most the latest 40 eligible tasks are sent to the model. The modal states when it used only the latest subset.
- For each included task, the original and latest five prompts plus the latest six assistant responses are retained.
- Individual text and the complete recorded-work source are progressively shortened to keep the source under 120,000 characters.
- Provider stdout is capped at 2 MB.
- A provider run times out after 120 seconds.
- All tasks accepts up to 40 items, preserves repeated entries, and caps each item at 160 characters.
- Short targets two or three items and accepts at most 4.
- Standard targets four through six items and accepts at most 8.
- Detailed targets seven through ten items and accepts at most 16.
- Short, Standard, and Detailed items are capped at 1,200 characters. All tasks items are capped at 160. Complete normalized output is capped at 12,000 characters.
- Only one standup generation may run at a time. A concurrent request receives HTTP 409.

No standup is cached or persisted. **Regenerate** always starts a fresh isolated synthesis from the current saved data.

## Interface

Opening Standup clears the date and performs no provider call. All tasks is selected when no saved preference exists. The user can choose another mode, then selecting a date generates that day. The modal provides:

- a visible provider route explaining that a fresh isolated CLI process is used instead of a task terminal;
- a disabled date control and skeleton ledger while AI is working;
- a clear empty state when no finished work exists;
- an inline failure state with **Retry**;
- **Regenerate** after success;
- separate Tasks and Blockers sections with independent counts;
- actual provider, selected length, and source coverage metadata;
- **Copy standup**, which writes plain sectioned text without bullet prefixes.

Changing length after a result clears the stale result and enables an explicit new generation. It does not silently start another provider run. All generated item text enters the DOM through `escapeHtml`. Clipboard failure stays inside the modal and leaves the generated list visible.

## API response

`POST /api/standup/generate` returns:

```json
{
  "standup": "- Task: Added terse All tasks standups.",
  "copyText": "Tasks\nAdded terse All tasks standups.\n\nBlockers\nNone",
  "tasks": [
    "Added terse All tasks standups."
  ],
  "blockers": [],
  "provider": "codex",
  "date": "2026-07-29",
  "length": "all",
  "taskCount": 4,
  "includedTaskCount": 4,
  "promptCount": 6,
  "responseCount": 7
}
```

The endpoint validates the pinned project, optional Relay id length, provider, output-mode enum, local-day interval, eligible source tasks, provider readiness, and global generation slot before returning normalized structured output. The additive `aiStandupAllTasks` capability prevents a refreshed renderer from sending the new default to an older backend that cannot enforce it.

## Files and verification

- `src/standup-generator.mjs`
- `src/database.mjs`
- `src/server.mjs`
- `public/standup-summary.js`
- `public/app.js`
- `public/index.html`
- `public/style.css`
- `test/standup-generator.test.mjs`
- `test/standup-summary.test.mjs`
- `test/standup-ui.test.mjs`
- `test/database.test.mjs`

Focused tests cover local dates, DST day lengths, exact project and Relay filtering, status filtering, prompt and response history, source bounds, prompt-injection framing, mode validation and limits, All tasks ordering and duplicate preservation, per-item shortening, task and blocker normalization, prefix-free clipboard text, date-gated UI wiring, mixed-version capability gating, Codex and Claude process flags, timeouts, provider fallback, and concurrency. The complete 1,117-test repository suite passes.

The in-app browser was not connected during the final pass, so computed layout, focus behavior, and the native clipboard permission interaction remain manual verification items.

See [[daily-standup-review]] for the adversarial review.

#relay #standup #ai #tasks #history
