---
name: Task Conversation Search
description: Project-scoped full-text search across every saved task command and assistant response.
type: architecture
---

# Task Conversation Search

The Task queue panel has one search rail above Queue and History. It searches the complete saved conversation for every task in the selected Launchpad project, regardless of the active day, week, or month in History.

The canonical search corpus contains:

- The persisted operator-written task name. A prompt-derived fallback title is omitted because the same text already exists as the original command.
- The original task command from `tasks.prompt`.
- Every accepted Relay follow-up or steering command recognized by the same markers as prompt history.
- Every completed Codex agent message and saved Claude message recognized by response history.
- The final task result and recorded error as response fallbacks.

> [!important]
> Search must use canonical conversation extraction, not raw event messages or raw JSON payload text. Raw event data contains tools, status noise, internal metadata, and untrusted fields that are not operator commands or assistant responses.

## Matching and ranking

`src/task-search.mjs` normalizes Unicode with NFKD, removes combining marks, folds case, and treats punctuation as word boundaries. This makes `resume`, `Résumé`, and punctuation-separated code names searchable with the same terms. A query accepts up to 200 characters and twelve unique terms. Quoted phrases stay one normalized term. Every term must exist somewhere in the task, but terms may be split between a command and a response.

Results rank exact task numbers first, then exact or complete task-name matches, command evidence, and response evidence. The strongest matching entry supplies a bounded excerpt and exact highlight ranges. The API returns at most 200 ranked rows plus the total match count so the renderer remains bounded.

> [!note]
> The search is evaluated on request from one project-scoped document set. It does not add an FTS virtual table, duplicate prompts into browser storage, or enlarge the normal `/api/tasks` snapshot. This keeps SQLite as the source of truth and avoids making every two-second task refresh carry complete response history.

## UI contract

`GET /api/tasks/search?projectPath=...&query=...` is advertised by `capabilities.taskFullTextSearch`. A newer renderer disables the control and asks for a restart against an older backend instead of calling a missing route.

The renderer debounces input by 180 milliseconds. Slash focuses and selects the search field when no form control or dialog owns the key. Escape clears the query, and Enter runs the current query immediately. The query is session-only and is not stored in local storage.

While a query is active:

- Date filtering and the History statistics ledger are suspended, but the chosen Queue or History preference is preserved for when search clears.
- Results keep backend relevance order and show the matching source label plus safely escaped highlighted evidence.
- Cards remain keyboard-selectable and open normal Task Activity.
- Queue reorder, assignment, drag targets, and parallel-batch selection are hidden so a relevance-ranked subset cannot mutate execution order.
- Project switching reruns the same query inside the new exact project boundary.
- Creating or navigating directly to a task clears search so the selected task cannot be hidden by the previous query.

> [!important]
> Search highlighting must split and escape the original excerpt before adding `<mark>`. Never interpolate provider or task text into result markup without escaping it.

## Verification

`test/task-search.test.mjs` covers normalization, phrases, cross-field matching, relevance, task-number lookup, canonical database extraction, project isolation, rank preservation, and escaped highlights. `test/task-search-ui.test.mjs` covers route and capability wiring, all-date behavior, read-only filtered cards, responsive styling, dark mode, and reduced motion. The complete Node suite passes 1,442 tests.

See [[task-history]], [[stable-text-selection]], and [[renderer-performance]].

#relay #search #tasks #history #ui
