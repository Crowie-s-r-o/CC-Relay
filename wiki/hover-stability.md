---
name: Hover Stability
description: Selectable task and project cards must keep fixed geometry under the pointer.
type: decision
---

# Hover Stability

Task cards, header running-task cards, and Launchpad project cards are selection surfaces. Hover may change color or border color, but it must not translate, scale, or gain hover-only elevation.

> [!important]
> Pointer targets must remain fixed from pointer entry through click. Even a small translation can move a compact card away from the pointer and make selection feel intermittent.

The old base `.task-card:hover` rule translated queue cards two pixels to the right. The compact `.header-running-task:hover` rule lifted running tasks by one pixel. Task cards, running tasks, and unselected Launchpad project cards also gained hover-only shadows that made them appear to lift. These effects were removed in `public/style.css`.

`test/hover-stability.test.mjs` protects the three selectable surfaces from hover transforms and hover-only elevation.

See [[project-workspaces]], [[compact-interface-density]], and [[interface-layout]].

#ui #interaction #accessibility
