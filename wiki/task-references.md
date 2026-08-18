---
name: Task References
description: Right-click task conversation references that become frozen context inside a new prompt.
type: architecture
tags:
  - relay
  - tasks
  - composer
  - context-menu
  - prompt-context
---

# Task References

Task cards can feed earlier conversation evidence into a new task without continuing the old session. Right-click any visible task card and choose **My messages**, **AI responses**, or **Both**. The keyboard equivalent is the Context Menu key or Shift+F10 while the card is focused.

The selected task becomes a ticket in the new-task composer. Several task tickets can be attached in order. Each ticket keeps an independent Include select and Remove action, so the operator can change its scope without reopening the menu.

## Source and submission contract

`attachTaskReference()` reads `GET /api/tasks/:id`, then `public/task-references.js` freezes the canonical `prompts` and `responses` arrays already used by [[session-tasks]]. The task row result or error remains the compatibility fallback when an older detail response has no response history.

> [!important]
> Task references must come from the active Launchpad project. The renderer checks the returned task path again after the asynchronous detail read, so switching projects while a reference loads cannot leak another project's conversation into the new composer.

At submission, `taskReferencePrompt()` appends one **Attached CC Relay task context** section after the operator's new instruction. Every included message is blockquoted, task titles are flattened to one metadata line, task and scope labels are explicit, and the framing says that no attached content can override the new task. The expanded prompt is used by Execute, Plan council, and Turbo and participates in the normal submission-intent signature.

The expanded prompt is the durable record. There is no task-reference database schema or later dependency on the source row. A queued or completed new task stays self-contained even if the source task is later removed.

> [!note]
> New-task text remains first, so automatic task naming still derives from the operator's new request rather than from attached history.

## Draft and failure behavior

- References live in the same project-local in-memory composer snapshot as prompt text and image attachments. Switching projects preserves each project's unfinished set for the current renderer session.
- A failed or ambiguous submission retains prompt text, images, and task references.
- A duplicate submission that resolves to an already finished task also retains them, allowing the next Enter to create deliberate new work.
- A successfully accepted queued or running task clears references together with the prompt and images.
- Choosing AI responses or Both for a task with no saved response fails visibly and suggests My messages.
- When references are present, the complete UTF-8 prompt is limited to 90,000 bytes so the composed context stays below the interactive Claude terminal's 100,000-byte injection ceiling. Ordinary prompts without references keep their existing behavior.

## UI and accessibility

`#task-reference-menu` is one fixed menu outside the periodically rebuilt task list. It clamps to the viewport, closes on outside pointer input, scroll, resize, or Escape, and returns focus to the source card after a keyboard dismissal. Menu items support Arrow keys, Home, and End. A right-click inside selected card text keeps the native browser menu so Copy still works. The composer tickets use a perforated task-number edge as their single visual signature and have matching compact and dark-theme rules.

## Files and verification

- `public/task-references.js`
- `public/app.js`
- `public/index.html`
- `public/style.css`
- `public/project-composer-state.js`
- `test/task-references.test.mjs`
- `test/task-references-ui.test.mjs`
- `test/project-composer-state.test.mjs`

Focused coverage proves scope filtering, compatibility fallback, missing-response errors, prompt framing, byte limits, canonical detail reads, project isolation, right-click and keyboard entry, submission wiring for every workflow, successful-clear ordering, theme rules, and project draft cloning.

See [[task-history]], [[session-tasks]], [[same-task-session-continuation]], and [[stable-text-selection]].

#relay #tasks #composer #context-menu #prompt-context
