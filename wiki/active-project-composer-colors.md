---
name: Active Project Composer Colors
description: How the prompt composer inherits the selected project's deterministic identity color.
type: design
---

# Active Project Composer Colors

The prompt composer now carries the same collision-resolved `project-color-N` class as the selected
Launchpad project. `renderComposerProjectIdentity()` applies the class to `#task-form` whenever
projects render, including after active-project changes and project-list collision resolution.

Project identity controls these composer surfaces:

- Selected workflow, provider shell, and legacy terminal option
- Native select border and quiet surface tint
- Select and prompt focus treatment
- Effort progress, remaining rail tint, thumb, and selected marker
- The main task submission button

Claude keeps its orange glyph as provider identity. The selected provider shell uses the project
accent because it communicates which project owns the new work. Light mode uses the darker project
palette with white button ink. Dark mode uses the bright terminal palette with `#071021` button ink.

> [!important]
> Use `projectIdentityColorClass()` instead of hashing the active path directly. The visible project
> list resolves palette collisions, so the composer must use the same resolved class as the
> Launchpad card.

> [!note]
> The project class belongs on `#task-form`, not the whole workspace. This keeps queue task identity,
> header running identity, and modal-specific semantic colors independently scoped.

Regression coverage is in `test/project-colors.test.mjs`. See [[project-workspaces]],
[[dark-mode]], and [[interface-layout]].

#relay #ui #project-color #composer #dark-mode
