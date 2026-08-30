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
- **AI messages** contains Codex `agentMessage`, older `agent_message` records, Claude `claude/message`, OpenCode `opencode/message`, and compatible legacy `result` entries.
- Provider progress, session state, input requests, plan rows, native token telemetry, and background completion notices are not AI messages even though older event grouping may place some of them in the internal broad `messages` category.
- Every filter button shows its current grouped-signal count. The compact status segment names the active view and its total.

> [!important]
> Do not classify every provider event as an AI message. Provider kinds also carry terminal lifecycle, token telemetry, and operator-attention records. `eventEntryMessageRole()` is the strict role boundary.

## Prompt reconciliation

`mergePromptMessages()` combines the persisted prompt history with provider events for rendering only. It performs three jobs:

1. It inserts a display-only `userMessage` for a canonical prompt that the provider did not echo, including the original Claude request.
2. For an original request, it can replace a Codex echo carrying the Relay non-interactive notice with the canonical user-authored text.
3. A completed follow-up's `relay-follow-up-*` event is a provisional display fallback. If a later, distinct provider user-message item matches that prompt before the next follow-up receipt, the merge suppresses the provisional event and keeps the provider event as the one visible message. Decorated echoes retain the Relay notice because that is the payload delivered to the terminal. Historical exact-text echoes and the earlier `Relay orchestrator notice:` prefix reconcile through the same boundary.

The original event array and database rows are never rewritten. Matching prompt events are deduplicated, copy-log output follows the one selected display event, and raw provider-event counts remain separately available in the status title.

> [!important]
> A `relay-follow-up-*` item records accepted Relay dispatch, not provider delivery. Keep it visible only when the provider supplies no user-message echo. Never stack it beside the later terminal-delivered item.

## Visual and interaction contract

- Every message row has a speaker, role chip, status, timestamp, and elapsed time when available.
- User messages use the terminal teal channel and monospace body text. AI messages retain the Codex, Claude, or OpenCode provider accent and Markdown rendering.
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
- `test/event-stream.test.mjs`: provisional follow-up receipt replacement, decorated and historical
  exact provider echoes, missing provider echoes, role separation, Claude notice exclusion, and
  provider-specific finality.
- `test/database.test.mjs` and `test/relay-prompt.test.mjs`: delivery-notice stripping without rewriting stored events.
- `test/terminal-conversation-filters.test.mjs`: renderer wiring, responsive rail, role styling, and stable signal numbering.

See [[terminal-conversation-filters-review]], [[task-activity-overview]], [[claude-terminal-live-output]], [[session-tasks]], and [[interface-layout]].

#relay #terminal #messages #filters #renderer
