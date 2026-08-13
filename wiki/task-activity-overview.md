---
name: Task Activity Overview
description: Expanded runtime, plan-step, and sub-agent manifest at the top of the Task Activity terminal.
type: design
tags:
  - relay
  - ui
  - task-activity
  - plan
  - sub-agent
  - observability
---

# Task Activity Overview

Task Activity starts with an expanded execution manifest above the terminal filters. The compact summary keeps the existing counters, adds the task runtime as its first value, and opens into the current provider plan plus the task's sub-agent assignments.

> [!important]
> The manifest is expanded on first render. It uses a native `<details open>` disclosure, so the operator can select **Minimize** to return to the one-line counters. Relay updates only the disclosure's metrics and body, not the `<details>` node itself. A manual collapse therefore survives two-second task refreshes, while reloading the app restores the expanded default.

## Information hierarchy

The summary orders operational state before historical telemetry:

1. Live or final task duration
2. Current plan progress, when a provider published a plan
3. Active sub-agent count
4. Other active signals
5. Thinking, command, file, message, and error counts

The expanded body has two provider-neutral lanes:

- **Plan** shows the newest revised board, every visible step, its owner when supplied, and the explicit state **Complete**, **In progress**, **Pending**, or **Unfinished**.
- **Sub-agents** sorts live workers first and shows provider, role or model, assignment brief, lifecycle state, and elapsed time. Finished and failed workers remain visible as recorded work.

The current plan uses the same latest-event ordering as the compact plan metric. Older turn plans remain available in the complete activity log rather than being merged into a false combined plan. The top manifest draws at most 50 plan steps and 50 workers, adds an honest overflow row, and keeps the complete event log as the lossless channel.

## Lifecycle rules

Runtime and live worker durations update on the existing one-second duration tick. Frozen outcomes keep the timestamp of their recorded completion.

> [!important]
> A task that is no longer running may not leave a plan step or worker looking live. An `inProgress` step becomes **Unfinished**, and a worker whose final provider state is still running or backgrounded becomes **Unfinished** with its duration frozen at the task end. This mirrors [[provider-plan-and-goal-visibility]] and [[provider-sub-agent-visibility]].

Plan states, agent states, glyphs, and color all carry the same reading. Completed work is green, live work is cyan, pending work is muted, unfinished work is amber, and failed or interrupted work is red. Color is never the only state cue.

## Layout and safety

The overview stays inside the existing Tokyo Night terminal palette in both application themes. At wider inspector widths, plan and worker lanes can sit side by side. A 440px container rule stacks each row's state beneath its title, and the expanded body has a bounded 320px or 34vh scroll budget so the terminal remains usable. The component adds no animation and no new live region.

Provider-controlled step text, owners, worker names, roles, and briefs are escaped before interpolation and bounded in the overview. Longer evidence remains intact in the activity log and copied output.

## Implementation map

- `public/index.html` owns the stable, expanded-by-default disclosure.
- `public/task-activity-overview.js` builds the pure overview markup and updates duration nodes.
- `public/app.js` supplies folded event entries and refreshes the live clocks.
- `public/style.css` owns the terminal-native manifest, state cues, scroll bound, and compact container layout.
- `test/task-activity-overview.test.mjs` covers default expansion, current-plan selection, worker timing, terminal-state cleanup, escaping, duration refresh, and responsive styling.

## Verification

The dedicated overview suite passes 8 tests. The combined overview, plan, sub-agent, event-stream, and project-layout run passes 144 tests. The complete repository suite passes 1,470 tests, `npm run release:check` reports consistent v0.2.6 metadata, and `git diff --check` is clean.

> [!note]
> Live browser screenshot verification was unavailable in the August 13 non-interactive run because the browser runtime exposed no browser instance. Focused renderer, lifecycle, security, and responsive source-contract tests provide the verification for this pass.

See also [[interface-layout]], [[task-detail-modal-and-app-zoom]], [[provider-plan-and-goal-visibility]], and [[provider-sub-agent-visibility]].

#relay #ui #task-activity #plan #sub-agent #observability
