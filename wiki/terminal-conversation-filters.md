---
name: Terminal Conversation Filters
description: Role-specific Task Activity filters, canonical prompt display, live counts, and message-row presentation.
type: implementation
tags:
  - relay
  - terminal
  - messages
  - filters
  - renderer
---

# Terminal Conversation Filters

Task Activity exposes five counted views: **All**, **Highlights**, **Commands**, **My messages**, and **AI messages**. All remains the default. The message views are exact conversation roles, not broad provider-event categories.

## Role contract

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
- The filter rail scrolls horizontally inside narrow task inspectors, while **Copy log** stays fixed and reachable.
- The metrics strip reports sent messages and AI messages separately.

## Files and coverage

- `public/event-stream.js`: prompt merge, strict message roles, counts, and role filters.
- `public/app.js`: prompt-history integration, message presentation, stable numbering, elapsed metadata, empty states, and copy labels.
- `public/index.html` and `public/style.css`: counted controls and the duplex message-channel treatment.
- `src/database.mjs` and `src/relay-prompt.mjs`: canonical cleanup of Relay's delivery-only instruction when prompt history is read.
- `test/event-stream.test.mjs`: deduplication, missing provider echoes, role separation, and Claude notice exclusion.
- `test/database.test.mjs` and `test/relay-prompt.test.mjs`: delivery-notice stripping without rewriting stored events.
- `test/terminal-conversation-filters.test.mjs`: renderer wiring, responsive rail, role styling, and stable signal numbering.

See [[terminal-conversation-filters-review]], [[task-activity-overview]], [[claude-terminal-live-output]], [[session-tasks]], and [[interface-layout]].

#relay #terminal #messages #filters #renderer
