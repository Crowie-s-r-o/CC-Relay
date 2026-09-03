---
name: Daily Standup
description: How CC Relay turns dated completed executions into a changelog and grounded follow-up answers.
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

The Task queue heading exposes **Standup** beside Queue and History. Opening the modal does not start AI. The modal also exposes an optional **Default custom prompt** saved on the selected Launchpad. The range can be one or two consecutive local calendar days. The start date is intentionally blank, and selecting it saves any prompt edit before starting one generation run. A two-day range includes the selected date and the following date; its latest allowed start is yesterday so the complete range ends today. After a changelog is generated, the same modal exposes a dated question ledger for grounded follow-up questions.

> [!note]
> The range selector defaults to one day. Changing it after selecting a date starts a fresh generation, and changing from one day to two days clamps a current-day start to yesterday. This keeps future dates out of the source interval.

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
- A refreshed renderer requires `capabilities.aiStandupGeneration`, `capabilities.aiStandupChangelog`, and `capabilities.aiStandupStartDate` for generation.
- The two-day option appears only with `capabilities.aiStandupTwoDayRange`; an older backend retains the one-day flow.
- The default prompt editor appears only with `capabilities.projectStandupPrompt`.

The dedicated `aiStandupChangelog` capability is a mixed-version guard. A new renderer does not send the categorized request to an older backend, and an old renderer does not silently request a retired length mode from the new backend.

`aiStandupStartDate` separately guards the date-attribution contract. It prevents refreshed renderer assets from preselecting tasks by start time while an older backend still filters the same request by completion time.

`aiStandupTwoDayRange` guards the wider request window. Without it, the renderer hides the range selector and sends the established one-day interval, so refreshed static assets cannot send a two-day request to a backend that still rejects it.

`projectStandupPrompt` is an additive mixed-version guard. A refreshed renderer paired with an older backend keeps normal Standup generation available but hides the unsupported prompt editor instead of issuing a failing save request.

Tasks with an attempt ledger are eligible when they contain a successful execution in the selected range, even if a later retry or follow-up changed the task's current status. Legacy tasks without attempt outcomes still require status `complete`. New completions persist their outcome with the attempt, while legacy null outcomes are backfilled once from matching `relay/task-attempt-finished` events during database startup. Each successful attempt belongs to the local calendar day containing that attempt's `started_at`, while its `finished_at` remains available to answer when it completed. A reused task can therefore contribute confirmed work on several different days when later follow-ups actually ran. Failed, cancelled, interrupted, queued, and running attempts remain contextual evidence and are never counted as completed Standup work.

For legacy completed rows without an attempt ledger, task `started_at` remains the compatibility fallback, with `created_at` used only when that start is absent. Work crossing midnight belongs to the day execution started, but both timestamps are supplied to Q&A so an answer can explain that it completed the next day.

The browser sends the selected local interval with an exclusive end. One day is `[local midnight, next local midnight)`; two days end at local midnight after the following date. The backend accepts 22 through 26 elapsed hours for one day and 46 through 50 elapsed hours for two days so normal daylight-saving transitions remain valid. Durations between or beyond those bounds fail closed.

See [[task-history]] for the shared project-wide visibility invariant.

## Conversation source

The browser sends the project, a null Relay id, selected provider, start and inclusive end date labels, and ISO range boundaries. It never sends task text or the custom prompt as generation authority.

The backend reloads source data from SQLite:

1. The pinned project row contributes `standup_custom_prompt`, defaulting to an empty string.
2. `database.taskAttemptsMap()` contributes every attempt start, completion, and recorded outcome.
3. The selected local window marks only successful executions whose starts fall inside the range as `selectedForRange`.
4. `database.listTaskPrompts(task.id)` returns the original request and every recorded same-task follow-up, each with its saved time.
5. `database.listTaskResponses(task.id)` extracts completed Codex agent messages and saved Claude messages in event order, each with its saved time.
6. The latest task result is added when no matching response event exists.
7. The final result is included separately as the authoritative latest outcome.

This keeps generation grounded in actual saved conversations, including the one-task, one-conversation continuation history described in [[same-task-session-continuation]], while keeping each execution on the day it actually ran.

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

An optional project prompt can refine emphasis, terminology, or exclusions. It is operator-authored guidance, capped at 4,000 characters, and placed before the recorded-work boundary. The prompt explicitly keeps the JSON output shape, evidence grounding, category definitions, and security rules authoritative over project guidance.

> [!important]
> `POST /api/standup/generate` always reads the saved prompt from the exact pinned project row. Do not accept a browser-submitted custom prompt on the generation route, because that would weaken project isolation and allow an unsaved or stale draft to target the wrong Launchpad.

> [!important]
> Standup must not fail because the provider returned more than eight facts or more than four facts in one section. Item-count constraints are absent from both the provider JSON Schema and deterministic normalization. The 180-character per-fact and 2 MB provider-output safety bounds remain.

The API returns the categorized arrays plus `standup` and `copyText`. Both text fields contain the same ready-to-paste changelog Markdown. The browser reconstructs clipboard text from the normalized arrays, so provider formatting cannot alter headings or bullet markers.

The Copy action also writes an escaped `text/html` clipboard representation with bold category labels and semantic lists. Rich chat composers use that representation instead of showing literal `###` and `-` markers, while plain-text destinations retain the canonical Markdown fallback. If the richer Clipboard API is unavailable or rejects the write, the browser retries with `writeText`.

## Provider isolation

Provider isolation is deliberate:

- Codex runs with `exec`, `--ephemeral`, ignored user config and rules, disabled shell execution features, a read-only sandbox, JSONL output, an output schema, and an empty temporary working directory.
- Claude runs with no session persistence, no Chrome, no setting sources, no slash commands, an empty strict MCP configuration, an empty tool list, plan permissions, a JSON Schema, and JSON output.
- The normal non-interactive Relay notice is appended after the complete generated prompt even if historical data contains a copy of that notice.
- Temporary working directories and schema files are removed after success, failure, timeout, or cancellation.
- A changelog or follow-up run never creates a queue task, resumes a task conversation, or writes a history row.

The selected composer provider is preferred. If it is not signed in and the other provider is ready, the backend uses the ready provider and reports which one generated the result. Every follow-up question starts another fresh isolated process. Bounded prior questions and answers are sent only to resolve conversational references; the dated SQLite evidence remains authoritative.

## Follow-up question contract

`POST /api/standup/follow-up` reloads the selected project, local-day boundaries, eligible executions, prompts, responses, project guidance, and task outcomes from SQLite for every question. The browser sends the latest question and up to eight prior user or assistant messages. Those messages are explicitly framed as untrusted conversational context and cannot replace the saved work source.

The provider returns one schema-validated object:

```json
{
  "answer": "The follow-up execution started on Wednesday, September 2 and completed five minutes later."
}
```

Answers may use short plain-text lists. They must identify exact selected calendar dates when the question asks what ran on a day, use execution starts rather than task creation or message dates for attribution, distinguish completion time when relevant, and state what evidence is missing rather than guess. Every execution carries its ISO timestamps plus preformatted system-local timestamps and the named local time zone, so operator-facing answers prefer the same local clock used by task cards. The deterministic boundary rejects empty answers and answers longer than 8,000 characters.

> [!important]
> Prior Q&A and the displayed changelog help resolve phrases such as "that fix," but they are not evidence. A follow-up answer must remain supportable by the reloaded dated task records.

## Bounds and concurrency

Generation is intentionally bounded:

- At most the latest 40 eligible completed tasks are sent to the model.
- For each included task, the original and latest five prompts plus the latest six assistant responses are retained.
- Up to 20 execution records per task are retained, while selected executions are preserved ahead of unrelated history where possible.
- Individual text and the complete recorded-work source are progressively shortened to keep the source under 120,000 characters.
- The saved project prompt is trimmed, strips null bytes, and is capped at 4,000 characters.
- Provider stdout is capped at 2 MB.
- A provider run times out after 120 seconds.
- A follow-up question is capped at 4,000 characters, prior conversation is capped at eight messages, and an answer is capped at 8,000 characters.
- Each normalized fact is capped at 180 characters, but the number of facts and facts per section is not capped.
- Only one standup generation may run at a time. A concurrent request receives HTTP 409.

No generated Standup or follow-up conversation is cached or persisted. The optional default prompt is durable project configuration. **Regenerate changelog** clears the in-modal Q&A and starts a fresh isolated synthesis from current saved data.

## Interface

The modal provides:

- an execution start date plus a one-day or two-day range control, with no output options;
- a project-specific default custom prompt editor with explicit save feedback;
- a visible provider route explaining that a fresh isolated CLI process is used;
- a disabled date control and skeleton ledger while AI is working;
- a clear empty state when no completed work exists;
- an inline failure state with **Retry**;
- **Regenerate changelog** after success;
- only populated Added, Changed, Fixed, and Security sections with counts;
- actual provider and source-coverage metadata; and
- **Copy changelog**, which writes chat-friendly rich formatting with categorized Markdown as its plain-text fallback;
- three one-click dated questions plus a keyboard-friendly free-text question field; and
- a numbered in-modal answer ledger stamped with the selected date range.

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
  "customPromptApplied": true,
  "date": "2026-08-12",
  "dateEnd": "2026-08-13",
  "dayCount": 2,
  "taskCount": 4,
  "executionCount": 5,
  "includedTaskCount": 4,
  "promptCount": 6,
  "responseCount": 7
}
```

The endpoint validates the pinned project, optional Relay id length, provider, one-day or two-day local interval, eligible completed source tasks, provider readiness, and global generation slot before returning normalized structured output. `customPromptApplied` records whether that exact run used saved project guidance, so a concurrent shared-config edit cannot make the completion note describe the wrong input. `PATCH /api/projects/:id/standup-prompt` separately validates and saves the 4,000-character project prompt.

Both Standup routes derive their returned `date` and `dateEnd` from the validated local midnight boundaries and reject conflicting browser labels. Both return `executionCount` separately from `taskCount`, because one reused task can have more than one successful execution in the selected range. `GET /api/tasks` exposes only successful `execution_starts` needed for client-side date gating; detailed attempt outcomes remain server-side source evidence.

## Files and verification

- `src/changelog-notes.mjs`
- `src/project-config-store.mjs`
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

Focused tests cover local dates, one-day and two-day daylight-saving lengths, two-day exclusive boundaries, attempt-level attribution across reused follow-up days, failed-attempt exclusion, completion timestamps, creation-time compatibility fallback, exact project and Relay filtering, completed-status filtering, prompt and response history, source bounds, project-prompt bounds and precedence, legacy project-table migration, project isolation, prompt-injection framing, category semantics, unlimited item counts, shared deploy validation, cross-section deduplication, ready-to-paste Markdown, escaped rich-chat clipboard HTML and its plain-text fallback, dated Q&A wiring, follow-up context and answer bounds, mixed-version capability gating, structured Codex and Claude output, process isolation, timeouts, provider fallback, and concurrency.

See [[daily-standup-review]] for the historical review of the retired length-configurable implementation.

#relay #standup #ai #changelog #tasks #history
