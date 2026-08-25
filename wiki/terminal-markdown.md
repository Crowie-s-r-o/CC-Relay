---
name: Terminal Markdown
description: Safe Markdown rendering for Codex, Claude, and OpenCode response messages in Task Activity.
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

`public/app.js` sends Codex `agentMessage` items, streamed Claude `claude/message` events, and OpenCode `opencode/message` records through `renderMarkdown()` from `public/markdown.js`. Grouped provider deltas use the combined message text, so an updating response and its final state share the same rendering path.

The renderer escapes model output before adding supported markup. Raw HTML cannot create elements or scripts. The supported document structure includes headings, unordered and ordered lists, paragraphs, blockquotes, inline code, bold text, fenced code blocks, and pipe tables with optional column alignment.

Pipe tables require a Markdown delimiter row with at least three hyphens per column. This keeps ordinary prose containing `|` characters as prose. Cells support the same escaped inline markup as paragraphs, escaped pipes remain inside their cell, and pipes inside inline code do not split columns. Missing body cells render empty and extra cells are ignored to preserve the declared header shape.

Tables render as semantic `table`, `thead`, `tbody`, `th`, and `td` elements inside a keyboard-focusable horizontal scroll region. The shared document style provides borders, header contrast, alternating rows, wrapping, and a visible focus ring. Task Activity adds Tokyo Night colors, while light and dark Result, plan, and session surfaces inherit the shared table treatment.

Terminal styling is scoped under `.events-section .terminal-markdown` in `public/style.css`. This overrides the light Result-panel palette with the existing Tokyo Night terminal colors and keeps fenced code scrollable.

## Deliberate boundaries

- Command output, tool output, patches, errors, queue messages, and protocol notes remain escaped verbatim text.
- `eventCopyText()` continues to copy the original plain response, including its Markdown source.
- The separate Result panel continues to use the same renderer and its existing light document styles.
- No third-party Markdown runtime or new dependency was added.

## Verification

- `test/terminal-markdown.test.mjs` covers lists, inline code, fenced code, raw HTML escaping, pipe-table parsing and safety, provider-message wiring, terminal styles, and the unchanged command-output path.
- `test/result-markdown.test.mjs` covers table-free preview text so task summaries do not expose delimiter-row noise.
- Browser checks on August 12, 2026 covered the terminal table treatment at 1460 by 900 and 480 by 760. Both widths had zero page overflow and zero browser warnings or errors.
- `test/ai-message-emphasis.test.mjs` preserves the existing response emphasis contract.
- Full suite on August 12, 2026: 1,375 tests passed, and `npm run release:check` passed.
- Full suite on July 29, 2026: 812 tests passed.

See [[terminal-conversation-filters]], [[claude-terminal-live-output]], [[claude-terminal-visibility]], [[renderer-performance]], and [[interface-layout]].

#relay #terminal #markdown #renderer
