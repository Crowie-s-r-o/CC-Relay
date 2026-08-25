---
name: Terminal Conversation Filters
description: Combined and role-specific Task Activity filters, canonical prompt display, live counts, and message-row presentation.
type: implementation
tags:
  - relay
  - terminal
  - messages
  - filters
  - renderer
---

# Terminal Conversation Filters

Task Activity exposes six counted views: **All**, **Highlights**, **Commands**, **Conversation**, **My messages**, and **AI messages**. All remains the default. The conversation views use exact message roles, not broad provider-event categories.

## Role contract

- **Conversation** is the chronological union of My messages and AI messages. It excludes commands, provider lifecycle notices, input requests, plans, and other broad message-category events.
- **My messages** contains `userMessage` items and the canonical prompt records returned by `listTaskPrompts()`.
- **AI messages** contains Codex `agentMessage`, older `agent_message` records, Claude `claude/message`, and compatible legacy `result` entries.
- Claude progress, session state, input requests, plan rows, and background completion notices are not AI messages even though older event grouping may place some of them in the internal broad `messages` category.
- Every filter button shows its current grouped-signal count. The compact status segment names the active view and its total.

> [!important]
> Do not classify every event whose kind is `claude` as an AI message. That kind also carries terminal lifecycle and operator-attention records. `eventEntryMessageRole()` is the strict role boundary.

## Canonical prompt display

`mergePromptMessages()` combines the persisted prompt history with provider events for rendering only. It performs two jobs:

1. It inserts a display-only `userMessage` for a canonical prompt that the provider did not echo, including the original Claude request.
2. When Codex echoes a delivered prompt with the Relay non-interactive notice appended, it replaces only the rendered clone with the canonical user-authored text.

The original event array and database rows are never rewritten. Matching prompt events are deduplicated, copy-log output uses the canonical text, and raw provider-event counts remain separately available in the status title.

## Visual and interaction contract

- Every message row has a speaker, role chip, status, timestamp, and elapsed time when available.
- User messages use the terminal teal channel and monospace body text. AI messages retain the Codex or Claude provider accent and Markdown rendering.
- User text remains escaped plain text. AI Markdown keeps the safe shared renderer from [[terminal-markdown]].
- Filtering preserves each entry's original signal number instead of renumbering the result set.
- Conversation reports the sum of the two strict role counts and copies only those visible message rows.
- The filter rail scrolls horizontally inside narrow task inspectors, while **Copy log** stays fixed and reachable.
- The metrics strip reports sent messages and AI messages separately.

## Assistant finality contract

The message status describes answer finality, not transport completion.

- Codex `agentMessage` items are **final** only for the explicit `final_answer` phase. Completed
  `commentary` items remain **update**, even though the queue historically stores every completed
  agent message under the broad `result` event kind.
- Claude `MessageDisplay.final` becomes `liveFinal` in Relay and means only that one streamed
  message batch has ended. It must never make a running-task update read as **final**.
- A Claude response becomes **final** when the settled task's exact result matches that message.
  This also covers retained sessions after a turn returns to the open state.
- Unstructured legacy `result` rows and phased legacy Codex final messages retain their historical
  final status.

> [!important]
> Never use Claude `liveFinal` or the event row's `kind: result` alone as answer-final evidence.
> Both fields describe storage or streaming mechanics that also occur on progress commentary.

## Conversation union verification

The August 25 addition proves that Conversation retains user and assistant entries in original
signal order while excluding commands and provider lifecycle records. Renderer coverage pins the
button, summed count, status summary, empty state, accessible live count, and six-control rail.
The focused set passes 119 checks, the complete repository passes 1,675 tests, and
`release:check` is green for v0.2.22. Live browser capture was unavailable in the verification
runtime, so responsive behavior remains source-contract tested rather than screenshot verified.

## Files and coverage

- `public/event-stream.js`: prompt merge, strict message roles, answer-final status, counts, and
  role filters.
- `public/app.js`: prompt-history integration, message presentation, stable numbering, elapsed metadata, empty states, and copy labels.
- `public/index.html` and `public/style.css`: counted controls and the duplex message-channel treatment.
- `src/database.mjs` and `src/relay-prompt.mjs`: canonical cleanup of Relay's delivery-only instruction when prompt history is read.
- `test/event-stream.test.mjs`: deduplication, missing provider echoes, role separation, Claude
  notice exclusion, and provider-specific finality.
- `test/database.test.mjs` and `test/relay-prompt.test.mjs`: delivery-notice stripping without rewriting stored events.
- `test/terminal-conversation-filters.test.mjs`: renderer wiring, responsive rail, role styling, and stable signal numbering.

See [[terminal-conversation-filters-review]], [[task-activity-overview]], [[claude-terminal-live-output]], [[session-tasks]], and [[interface-layout]].

#relay #terminal #messages #filters #renderer
