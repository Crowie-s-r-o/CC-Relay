---
name: Daily Standup
description: How CC Relay turns completed saved conversations into a date-selected changelog with the same categories and validation as deploy.
type: architecture
tags:
  - relay
  - standup
  - ai
  - changelog
  - tasks
  - history
---

# Daily Standup

The Task queue heading exposes **Standup** beside Queue and History. Opening the modal does not start AI. The date is intentionally blank, and selecting a local calendar day starts one generation run.

Standup has one output contract. It synthesizes completed work into the same nonempty sections used by [[open-source-releases|deploy]]:

- **Added** for new capabilities.
- **Changed** for improvements and behavior changes.
- **Fixed** for resolved defects.
- **Security** for material security hardening.

There is no length or output-type selector. The former All tasks, Short, Standard, and Detailed modes and the Tasks or Blockers structure are retired. The browser no longer reads or writes `relay.standupLength`.

> [!important]
> Standup generation uses a fresh isolated headless Codex or Claude CLI process in an empty temporary directory. It never types into, resumes, or consumes a task terminal.

## Project, scope, and date rules

Standup follows the selected Launchpad:

- Every CC Relay in the selected project contributes eligible tasks.
- Exact resolved project paths are enforced again by `POST /api/standup/generate`.
- With no selected project, the Standup button remains disabled.
- A refreshed renderer requires both `capabilities.aiStandupGeneration` and `capabilities.aiStandupChangelog`.

The dedicated `aiStandupChangelog` capability is a mixed-version guard. A new renderer does not send the categorized request to an older backend, and an old renderer does not silently request a retired length mode from the new backend.

Only tasks with status `complete` are eligible. Failed, queued, running, interrupted, and cancelled rows are excluded because a changelog records confirmed outcomes, not unresolved attempts. A task belongs to the day of its latest terminal outcome. `finished_at` is authoritative, with `created_at` retained only as a compatibility fallback.

The browser sends the selected local interval as `[local midnight, next local midnight)`. The backend accepts a 22 through 26 hour interval so normal daylight-saving transitions remain valid.

See [[task-history]] for the shared project-wide visibility invariant.

## Conversation source

The browser sends the project, a null Relay id, selected provider, date label, and ISO day boundaries. It never sends task text as authority.

The backend reloads source data from SQLite:

1. `database.listTaskPrompts(task.id)` returns the original request and every recorded same-task follow-up.
2. `database.listTaskResponses(task.id)` extracts completed Codex agent messages and saved Claude messages in event order.
3. The latest task result is added when no matching response event exists.
4. The final result is included separately as the authoritative outcome.

This keeps generation grounded in actual saved conversations, including the one-task, one-conversation continuation history described in [[same-task-session-continuation]].

## Shared changelog contract

`src/changelog-notes.mjs` is the shared deterministic boundary for Standup and `scripts/deploy.mjs`. Both use the same section order, JSON Schema, sentence limit, deduplication, plain-text validation, and Markdown formatter.

The provider must return exactly this structured shape:

```json
{
  "added": [],
  "changed": [],
  "fixed": [],
  "security": []
}
```

Deterministic normalization then enforces:

- one or more usable facts, with no item-count limit;
- one plain sentence of at most 180 characters per fact;
- global case-insensitive deduplication across sections;
- no control characters, links, Markdown links, or HTML;
- a final period when the sentence has no terminal punctuation;
- canonical Added, Changed, Fixed, Security ordering;
- omission of empty sections; and
- `###` headings with `- ` Markdown bullets.

The prompt asks for every distinct confirmed fact supported by the evidence and explicitly states that there is no item-count limit. Related tasks, retries, and follow-ups are synthesized instead of being emitted mechanically. A request or attempt is omitted unless a saved response or final outcome confirms it as completed.

> [!important]
> Standup must not fail because the provider returned more than eight facts or more than four facts in one section. Item-count constraints are absent from both the provider JSON Schema and deterministic normalization. The 180-character per-fact and 2 MB provider-output safety bounds remain.

The API returns the categorized arrays plus `standup` and `copyText`. Both text fields contain the same ready-to-paste changelog Markdown. The browser reconstructs clipboard text from the normalized arrays, so provider formatting cannot alter headings or bullet markers.

## Provider isolation

Provider isolation is deliberate:

- Codex runs with `exec`, `--ephemeral`, ignored user config and rules, disabled shell execution features, a read-only sandbox, JSONL output, an output schema, and an empty temporary working directory.
- Claude runs with no session persistence, no Chrome, no setting sources, no slash commands, an empty strict MCP configuration, an empty tool list, plan permissions, a JSON Schema, and JSON output.
- The normal non-interactive Relay notice is appended after the complete generated prompt even if historical data contains a copy of that notice.
- Temporary working directories and schema files are removed after success, failure, timeout, or cancellation.
- A standup run never creates a queue task, resumes a task conversation, or writes a history row.

The selected composer provider is preferred. If it is not signed in and the other provider is ready, the backend uses the ready provider and reports which one generated the result.

## Bounds and concurrency

Generation is intentionally bounded:

- At most the latest 40 eligible completed tasks are sent to the model.
- For each included task, the original and latest five prompts plus the latest six assistant responses are retained.
- Individual text and the complete recorded-work source are progressively shortened to keep the source under 120,000 characters.
- Provider stdout is capped at 2 MB.
- A provider run times out after 120 seconds.
- Each normalized fact is capped at 180 characters, but the number of facts and facts per section is not capped.
- Only one standup generation may run at a time. A concurrent request receives HTTP 409.

No standup is cached or persisted. **Regenerate changelog** always starts a fresh isolated synthesis from current saved data.

## Interface

The modal provides:

- a single workday control with no output options;
- a visible provider route explaining that a fresh isolated CLI process is used;
- a disabled date control and skeleton ledger while AI is working;
- a clear empty state when no completed work exists;
- an inline failure state with **Retry**;
- **Regenerate changelog** after success;
- only populated Added, Changed, Fixed, and Security sections with counts;
- actual provider and source-coverage metadata; and
- **Copy changelog**, which writes categorized Markdown headings and bullet points.

Every generated sentence enters the DOM through `escapeHtml`. Clipboard failure stays inside the modal and leaves the generated changelog visible.

## API response

`POST /api/standup/generate` returns:

```json
{
  "standup": "### Added\n\n- Added categorized daily standups.\n\n### Fixed\n\n- Fixed local-day selection.",
  "copyText": "### Added\n\n- Added categorized daily standups.\n\n### Fixed\n\n- Fixed local-day selection.",
  "added": [
    "Added categorized daily standups."
  ],
  "changed": [],
  "fixed": [
    "Fixed local-day selection."
  ],
  "security": [],
  "provider": "codex",
  "date": "2026-08-12",
  "taskCount": 4,
  "includedTaskCount": 4,
  "promptCount": 6,
  "responseCount": 7
}
```

The endpoint validates the pinned project, optional Relay id length, provider, local-day interval, eligible completed source tasks, provider readiness, and global generation slot before returning normalized structured output.

## Files and verification

- `src/changelog-notes.mjs`
- `src/standup-generator.mjs`
- `src/database.mjs`
- `src/server.mjs`
- `scripts/release-core.mjs`
- `public/standup-summary.js`
- `public/app.js`
- `public/index.html`
- `public/style.css`
- `test/standup-generator.test.mjs`
- `test/standup-summary.test.mjs`
- `test/standup-ui.test.mjs`
- `test/release-tooling.test.mjs`

Focused tests cover local dates, daylight-saving day lengths, exact project and Relay filtering, completed-status filtering, prompt and response history, source bounds, prompt-injection framing, category semantics, unlimited item counts, shared deploy validation, cross-section deduplication, ready-to-paste Markdown, date-gated UI wiring, mixed-version capability gating, structured Codex and Claude output, process isolation, timeouts, provider fallback, and concurrency.

See [[daily-standup-review]] for the historical review of the retired length-configurable implementation.

#relay #standup #ai #changelog #tasks #history
