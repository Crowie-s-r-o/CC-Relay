---
name: Saved Quick Skills
description: One-click direct Execute presets beside push-to-talk in the task composer.
type: feature
tags:
  - relay
  - composer
  - skills
  - terminal
---

# Saved quick skills

The task composer has a compact saved-skill strip directly below the prompt. When push-to-talk is
available, each surface receives exactly half of the row. When browser audio is unavailable, the
saved-skill surface uses the full row. The controls remain 40 pixels high at the 400 pixel minimum
Composer width and at the 480 pixel responsive breakpoint.

**Deploy check** is the first saved skill. Its exact label and prompt live in
`public/quick-skills.js`. The visible button lives in `public/index.html`. Keep the IDs identical so
`quickSkillById()` can fail closed if markup and the catalog drift.

## Dispatch contract

Clicking a saved skill calls the same guarded task submission path as the normal task form, with
these deliberate overrides:

- The workflow must be direct Execute without Plan council.
- The active project and selected provider, model, and effort remain authoritative.
- The request uses `runNow: true`.
- The saved label becomes the task name when task naming is supported.
- The saved prompt is sent exactly as cataloged.
- Composer task references and image attachments are not appended.
- The task name, prompt draft, references, and images already in the composer are not cleared.
- The global submission-intent guard still deduplicates an ambiguous retry.

> [!important]
> Do not implement a saved skill by copying its prompt into the required textarea and calling
> `requestSubmit()`. Native form validation blocks an empty textarea before the saved prompt can be
> applied, and a successful ordinary submission clears the operator's unrelated draft. Call
> `submitComposerTask()` with the cataloged skill instead.

The button is disabled while another submission owns the composer, when no project is selected,
when the selected provider CLI is confirmed missing, and in Plan council or Forward-planning
Turbo. Its visible context and accessible label identify the selected target and effort before
dispatch.

## Visual contract

The row uses the existing graphite control surfaces and active project accent. The saved action has
a small `>_` command mark, its plain-language name, and a compact `Run now / provider / effort`
signature. Focus remains visible, disabled state remains readable, and both light and dark themes
have explicit surfaces.

An isolated paused queue verified the one-click request without launching a provider terminal. The
created task used the exact Deploy check prompt, Codex, `gpt-5.6-sol`, high effort, no attachments,
and queue position zero. Synthetic name and prompt drafts remained unchanged. Browser checks at
1600 by 1000 and 480 by 900 found equal columns and no horizontal overflow in light and dark themes.

## Files and coverage

- `public/quick-skills.js`
- `public/index.html`
- `public/app.js`
- `public/style.css`
- `test/quick-skills.test.mjs`
- `test/composer-workflows.test.mjs`

See [[interface-layout]], [[push-to-talk-voice-input]], and [[project-terminal-settings]].

#relay #composer #skills #terminal
