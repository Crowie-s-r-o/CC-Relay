---
name: Terminal Conversation Filters Review
description: Adversarial ship review for counted role filters and duplex terminal messages.
type: review
tags:
  - relay
  - terminal
  - review
  - filters
---

# Terminal Conversation Filters Review

## Executive Summary

**Recommendation: Ship. Confidence: high.** The implementation separates user-authored and provider-authored messages at an explicit role boundary, preserves the existing broad activity views, and renders canonical prompt text without mutating provider evidence. The extra review found three prompt-history defects, all fixed before completion: Relay's delivery-only instruction could leak into saved prompt history, paired start and completion events could disagree on canonical text, and an older backend fallback prompt was normalized for the prompt panel but not passed to Task Activity.

## Quality Panel

| Area | Rating | Evidence |
| --- | --- | --- |
| Correctness | Green | Strict role tests cover Codex, Claude, older `agent_message`, legacy `result`, paired events, missing echoes, and malformed collections. |
| Security | Green | User text is escaped as plain text. AI text continues through the shared safe Markdown renderer. Provider events and database rows are not rewritten. |
| Reliability | Green | Prompt history is normalized once, synthetic IDs are stable, filtered rows retain source signal numbers, and live refresh uses the same saved prompt set. |
| Accessibility | Green | Native buttons retain pressed state, count badges are hidden from duplicate announcement, dynamic labels include counts, and focus styles remain visible. |
| Performance | Amber | The provider event window is bounded, but unmatched canonical prompt lookup is `O(events * prompts)`. Normal task conversations keep this small. |
| Maintainability | Green | Role classification and counts live in `event-stream.js`; display, copy, and database cleanup each have focused coverage. |

## Top 3 Risks

1. A future provider message item type will stay out of **AI messages** until it is added to the strict whitelist. This is safer than admitting lifecycle noise, but requires deliberate schema maintenance.
2. Very long same-task conversations can increase prompt matching work on each refresh. Provider events remain capped at 500, which bounds one side of the comparison.
3. The horizontally scrolling filter rail hides its scrollbar. Keyboard focus still scrolls controls into view, but discoverability on a very narrow pointer-only viewport depends on the clipped next control.

## Top Improvements

1. Add a provider-contract fixture whenever Codex or Claude introduces a new assistant message schema.
2. If real sessions grow to thousands of prompts, index canonical prompts by normalized delivered text before matching.
3. Add a visual regression capture for narrow and standard task inspectors when an automated browser is available.

## Recommendation

Ship the change. No confirmed issue remains open, the user and AI filters fail closed around exact message roles, and all review findings have regression coverage.

## Confirmed Issues

- Fixed: Codex live-steer text stored the appended Relay orchestration notice in prompt history. `withoutRelayNonInteractiveInstruction()` now removes only the exact delivery suffix while reading canonical user text.
- Fixed: paired `item/started` and `item/completed` records could canonicalize only the first phase, allowing the raw notice to reappear through the completed item. Item correlation now canonicalizes both phases.
- Fixed: Task Activity received the raw API prompt list instead of `normalizeTaskPrompts()` output, so an older backend with no prompt list could omit the original request. The normalized history is now the single display input.

## Suspected Issues & Edge Cases

- Repeated identical prompts are matched in recorded order. Stable item IDs keep paired phases attached to the same canonical prompt.
- Prompts with missing timestamps fall back to deterministic original-first or append ordering.
- A message consisting only of Relay's exact orchestration instruction normalizes to empty text. Relay does not accept that as a user-authored continuation in normal operation.

## Regression Risks

- The old broad internal `messages` category remains available for compatibility, while the visible controls use the stricter role filters.
- User messages intentionally render as escaped plain text, so Markdown-like user input is shown exactly as authored.
- Two message metrics replace the former combined message metric, slightly increasing the minimum comfortable strip width. The existing metrics overflow behavior handles narrow panels.

## Performance Risks

Prompt merging clones only matching user events and inserts missing display-only prompts. Grouping and rendering still rebuild on refresh as required by the live-plan freshness contract. The only new nonlinear work is canonical prompt matching, bounded on the event side by the existing 500-event API window.

## Test Gaps

- No live browser screenshot was captured because this run had no controllable browser instance.
- Screen-reader announcement order is verified structurally, not with an assistive-technology integration run.
- Provider fixtures cover known schemas, not future protocol variants.

## Positive Improvements

- Operators can isolate either side of the conversation with one click and see exact counts before filtering.
- The original request now appears consistently for Claude and older task records.
- Speaker, role, state, time, and elapsed metadata make message rows easier to scan.
- Copy output reflects the active filter and uses canonical user-authored text.
- Signal numbering remains stable across filters, which makes cross-view references reliable.

See [[terminal-conversation-filters]], [[terminal-markdown]], and [[task-activity-overview]].

#relay #terminal #review #filters
