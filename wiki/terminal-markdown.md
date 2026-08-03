---
name: Terminal Markdown
description: Safe Markdown rendering for Codex and Claude response messages in Task Activity.
type: implementation
tags:
  - relay
  - terminal
  - markdown
  - renderer
---

# Terminal Markdown

> [!note]
> Task Activity renders provider response text as Markdown while preserving terminal telemetry and copied logs as plain text.

## Renderer contract

`public/app.js` sends both Codex `agentMessage` items and streamed Claude `claude/message` events through `renderMarkdown()` from `public/markdown.js`. Grouped Claude deltas use the combined message text, so an updating response and its final state share the same rendering path.

The renderer escapes model output before adding supported markup. Raw HTML cannot create elements or scripts. The supported document structure includes headings, unordered and ordered lists, paragraphs, blockquotes, inline code, bold text, and fenced code blocks.

Terminal styling is scoped under `.events-section .terminal-markdown` in `public/style.css`. This overrides the light Result-panel palette with the existing Tokyo Night terminal colors and keeps fenced code scrollable.

## Deliberate boundaries

- Command output, tool output, patches, errors, queue messages, and protocol notes remain escaped verbatim text.
- `eventCopyText()` continues to copy the original plain response, including its Markdown source.
- The separate Result panel continues to use the same renderer and its existing light document styles.
- No third-party Markdown runtime or new dependency was added.

## Verification

- `test/terminal-markdown.test.mjs` covers lists, inline code, fenced code, raw HTML escaping, provider-message wiring, terminal styles, and the unchanged command-output path.
- `test/ai-message-emphasis.test.mjs` preserves the existing response emphasis contract.
- Full suite on July 29, 2026: 812 tests passed.

See [[claude-terminal-live-output]], [[claude-terminal-visibility]], [[renderer-performance]], and [[interface-layout]].

#relay #terminal #markdown #renderer
