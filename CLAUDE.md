# CC Relay redesign brief for Claude Code

## Your assignment

Redesign CC Relay into a polished, compact desktop operations interface for managing sequential Codex and Claude Code work.

The current UI is functional but visually accumulated. It was built feature by feature and now has too many competing panels, borders, labels, and controls. Preserve every working capability described below, but feel free to substantially restructure `public/index.html` and replace most of `public/style.css`.

Do not turn this into a generic SaaS dashboard. CC Relay is a local developer instrument. It should feel closer to a focused queue controller, build monitor, or studio console than an admin template.

Before editing:

1. Read this file completely.
2. Inspect `public/index.html`, `public/app.js`, and `public/style.css`.
3. Run `npm test` and keep the suite passing.
4. Form a short design direction covering layout, typography, color, density, and one recognizable signature element.
5. Review the direction for unnecessary decoration before implementing it.

## Product summary

CC Relay is a local task queue for subscription-authenticated Codex and Claude Code tools.

- It does not call OpenAI or Anthropic model APIs directly.
- It launches a fresh provider terminal only when queued work receives a project slot.
- It closes the exact CC Relay-owned native terminal when that work ends.
- It saves provider conversation IDs so an explicit continuation can relaunch and resume them.
- It keeps legacy discovery and selected-session routing only for tasks created by older CC Relay versions.
- It can execute through either Codex or Claude.
- It can run a three-stage, two-provider planning council.
- It stores tasks, events, plans, results, and local image attachments.
- It runs in a browser or as an Electron desktop app on macOS and Windows.

The primary user is a developer who may have several projects and AI sessions open at once. Their main questions are:

1. What is running now?
2. What runs next, and which project provider limit is it waiting for?
3. Which project, provider, model, and effort will receive this prompt?
4. What did the agent actually do?
5. Did the task finish, fail, retry, or require attention?

## Non-negotiable behavior

The redesign must preserve all of the following.

### Compact application header

The header currently shows:

- CC Relay online or unavailable state.
- Codex readiness.
- Claude readiness.
- Separate live Codex and Claude session counts.
- Queue state, pause state, waiting count, and running count.
- Current task ID and a short prompt preview.
- Pause or resume queue action.

Do not restore the old large four-card status rail. Status belongs in a compact header treatment.

### Favorite project launchpad

Users can:

- Pin favorite project folders.
- Remove pinned folders.
- Set separate maximum Codex and Claude instances from 1 through 8 for each project.
- Launch Codex in a project.
- Launch Claude in a project.
- Add a folder without launching it.
- Add a folder and immediately launch the selected provider.
- Open a native folder picker.

The macOS launcher uses Terminal.app. The Windows launcher opens `cmd.exe`. Pinned projects and provider limits persist in SQLite.

Current queued work does not require users to keep these manually launched terminals open. CC Relay allocates short-lived terminals from the selected project's provider limits, gives every native launch a unique ownership ID, and closes only that exact launch at the task's terminal outcome.

Interactive terminal launch commands intentionally use unrestricted flags:

```text
codex --dangerously-bypass-approvals-and-sandbox --remote ws://127.0.0.1:4769
claude --dangerously-skip-permissions
```

The UI must clearly warn that these commands disable protections and should be used only in trusted projects. This unrestricted choice applies to user-launched interactive terminals, not CC Relay-owned queued turns.

### Execute and optional Plan council

The composer exposes Execute and Forward-planning Turbo as its workflow choices. Plan council is an optional checkbox inside both workflows, not a separate workflow tab.

#### Execute

- Choose Codex or Claude through provider tabs with distinct icons.
- Show active and maximum instance counts for each provider.
- Choose the selected project and use its automatic provider pool.
- Choose a model.
- Choose reasoning effort.
- Remember model and effort independently for Codex and Claude while switching tabs.
- Send the prompt to the queue without requiring an open terminal or existing conversation.

Every fresh Execute task starts a new conversation. **Continue session** creates a linked queue task that waits for the same project's capacity, opens a new terminal, and resumes the saved conversation with `claude --resume <session-id>` or `codex resume <session-id>`. CC Relay permits only one queued or running owner of a saved conversation.

#### Plan council in Execute

Plan council requires two different providers and uses this fixed read-only route:

1. Claude Fable or Opus at max effort writes the first implementation plan.
2. Codex reviews the full brief and Claude draft in read-only mode.
3. Claude receives the brief, draft, and complete Codex critique, then writes the final revised plan.

The configuration must expose:

- Claude author model: Fable or Opus.
- Claude effort: fixed to max.
- Codex reviewer model.
- Codex reviewer effort.
- Claude readiness.
- The selected project's Claude and Codex pool capacity.

The task activity view must nicely preview:

- Live three-stage progress.
- Author and reviewer configuration.
- Expandable Claude draft.
- Expandable Codex review.
- Prominent formatted final revised plan.
- Failure or waiting state for an incomplete council.

CC Relay persists its checkpoint record and result under CC Relay's task artifacts. The final reviewed plan is written to `<project-root>/.data/tasks/<task-id>/plan.md`, never to a CC Relay project folder when the plan belongs to another project.

### Automatic terminal pools and legacy session selection

On a backend with `capabilities.disposableTerminalPools`, the left composer panel shows the selected project's maximum Codex and Claude instances instead of a live terminal picker. A new task has no `thread_id` until CC Relay launches and binds its provider terminal.

Capacity is project-local and provider-specific. Direct Execute and Planner work require one slot for the chosen provider. Plan council atomically requires one Claude and one Codex slot. Turbo requires one Codex planner plus its configured worker count, and also one Claude slot when its terminal council is enabled.

When a task reaches a runnable queue position, CC Relay must:

1. Reserve the complete required capacity before launching.
2. Start a fresh native terminal in the exact project directory.
3. Bind only the provider session proven to belong to that unique native launch.
4. Persist the conversation ID before running the task.
5. Close that exact CC Relay-owned launch after completion, failure, cancellation, or interruption.

Existing persistent task rows retain their selected sessions for compatibility. Only that compatibility UI lists live Codex sessions from CC Relay's shared app-server and Claude sessions from `claude agents --json`.

### Connection helper and terminal launch

The connection helper must retain:

- Current provider-specific terminal command.
- Copy command action.
- Launch terminal action.
- Native folder selection before launch.
- Unrestricted-access warning.
- Capability state that displays `Restart CC Relay to launch` when an older backend is still running.

These manual launch controls are project tools and a legacy compatibility path. They are not how current queued tasks acquire terminals.

### Prompt composer

The prompt composer must preserve:

- Enter submits the task.
- Shift+Enter inserts a new line.
- IME composition does not accidentally submit.
- Mode-specific placeholder and label.
- Clear disabled and validation states.
- No separate task title field.
- No repository path field. Workspace comes from the selected Launchpad project.

Adding a new task must not switch the activity panel away from the task the user is currently inspecting. When there is no explicit selection, the running task should be selected automatically.

### Image attachments

Users can attach up to 99 PNG, JPEG, or WebP images.

- Maximum 5 MB per image.
- Maximum 20 MB total.
- Choose through the file picker.
- Drag and drop.
- Paste from the clipboard anywhere inside the composer.
- Preserve normal text-only paste.
- Preview attachments before sending.
- Remove attachments before sending.
- Show attachment count and file size.
- Show persisted images in task detail.
- Open a full image safely through task-scoped routes.

The composer should state whether images go to the selected Execute provider or both Plan council providers.

### Sequential task queue

The queue must preserve:

- Per-project Codex and Claude capacity limits, with independent work allowed across projects.
- At most one queued or running disposable task per saved conversation ID.
- Atomic capacity for Plan council and Turbo so a partially launched fleet cannot strand a task.
- Independently scrollable task list.
- Fixed queue heading and controls.
- Automatic refresh.
- Manual refresh.
- Pause and resume.
- Running, queued, complete, failed, cancelled, and interrupted states.
- Task number, provider, mode, model, effort, prompt excerpt, workspace, and image count.
- Running duration that updates every second.
- Stable completed duration.
- Drag-and-drop reorder for queued tasks only.
- Move up and Move down buttons for accessible reordering.
- Checkbox selection and the contextual parallel bundle bar for eligible legacy persistent Codex tasks only.
- Clear selected-task state.
- Cancel, retry, and delete actions where valid.

Eligible genuine failures remain visible for five seconds and then automatically requeue at the end of the waiting list, up to the configured retry limit. User cancellations and shutdown interruptions do not automatically retry.

Users can select at least two eligible legacy queued tasks and replace them with one Codex task sent to the currently selected Codex terminal. Disposable tasks never expose this destructive replacement flow. New work uses a higher project Codex limit or Forward-planning Turbo for concurrency.

### Task activity and results

The activity panel must handle:

- Empty selection.
- Direct Execute task.
- Plan council task.
- Prompt.
- Result or error.
- Reference image contact sheet.
- Task actions.
- Task metadata.
- Live terminal output.

Long content must remain readable without forcing the whole application into an uncontrolled page scroll.

### Terminal output console

This is not a raw event table. CC Relay groups low-level events into readable signals.

The console must preserve:

- Grouping item start and completion into one signal.
- Highlights, Commands, Messages, and All filters.
- Copy filtered log.
- Follow live toggle.
- Automatic follow until the user scrolls away.
- Session state.
- Counts for commands, file changes, messages, errors, and active operations.
- Provider identity for Codex, Claude, CC Relay, and Plan council.
- Running, success, warning, and error states.
- Numbered visible signals.
- Command text.
- Working directory.
- Duration and exit code.
- Expandable captured output.
- File paths and patches.
- Connected-tool name, arguments, and result.
- Web search and image inspection signals.
- AI messages and final response signals.
- Queue lifecycle messages.
- Useful empty states.
- Reduced-motion support for live animation.

Do not make every event equally loud. Commands, failures, file changes, and final messages need stronger hierarchy than protocol or queue noise.

### Refresh behavior

- Server-sent events provide immediate updates.
- A two-second visible-page refresh repairs missed events.
- Hidden pages do not poll.
- Concurrent refresh requests are deduplicated.
- Claude and Codex session discovery refreshes every four seconds.

Do not introduce visible flicker, reset scroll position, or steal focus during refresh.

### Desktop application

The same frontend runs in Electron 43.

- macOS target: DMG and ZIP.
- Windows target: NSIS and portable executable.
- Minimum desktop window: 1040 by 700.
- External HTTP links open in the system browser.
- Browser content has no Node integration.
- Packaged data lives in Electron's per-user application-data directory.
- The app is single-instance.

The redesign must work in the packaged desktop window as well as a normal browser.

## Accessibility requirements

Preserve or improve:

- Semantic buttons instead of clickable generic elements.
- Visible keyboard focus.
- Execute and Forward-planning Turbo mode tab semantics.
- Codex and Claude provider tab semantics.
- Legacy session radiogroup behavior.
- Left, Right, Home, and End navigation where currently supported.
- Keyboard queue reordering controls.
- Accessible names for icon-only actions.
- `aria-live` for task and terminal updates without excessive announcements.
- Sufficient contrast.
- `prefers-reduced-motion` behavior.
- Usability at 1180, 720, and 420 pixel breakpoints.

## Technical boundaries

### Frontend stack

The frontend is intentionally dependency-light:

- `public/index.html`: document structure.
- `public/style.css`: all visual styling and responsive behavior.
- `public/app.js`: state, API calls, event handling, rendering, and interactions.
- `public/event-stream.js`: event grouping, categories, filtering, and telemetry.
- `public/task-time.js`: duration labels.
- `public/clipboard-images.js`: clipboard image extraction.

Do not introduce React, Vue, a bundler, Tailwind, or a component framework merely for the redesign. A new dependency needs a strong functional reason.

You may restructure HTML and CSS substantially. Preserve every DOM ID referenced by `public/app.js`, or update the JavaScript reference and all affected behavior deliberately. Search before removing any class or ID.

Do not change backend behavior as part of a visual redesign unless a UI requirement is impossible without a narrow API adjustment.

### Important backend files

- `src/server.mjs`: local HTTP API, static assets, server-sent events, and provider validation.
- `src/queue.mjs`: per-project pool scheduling, legacy per-session routing, automatic retry, pause, cancellation, and shutdown.
- `src/disposable-terminal-pool.mjs`: capacity reservation, fresh or resumed native launches, provider binding, and exact cleanup.
- `src/codex-app-server.mjs`: shared Codex connection and task turns.
- `src/claude-session-registry.mjs`: live Claude session discovery.
- `src/claude-execution-runner.mjs`: direct Claude task execution.
- `src/plan-council-runner.mjs`: Claude draft, Codex review, Claude revision.
- `src/database.mjs`: SQLite tasks, events, settings, and pinned projects.
- `src/artifacts.mjs`: task files, images, plans, results, and errors.
- `src/project-launcher.mjs`: macOS and Windows project selection and terminal launch.
- `src/electron-main.mjs`: desktop application lifecycle.

### API contracts used by the UI

- `GET /api/status`
- `GET /api/threads`
- `GET /api/models?provider=<codex|claude>`
- `GET /api/tasks`
- `POST /api/tasks`
- `GET /api/tasks/:id`
- `POST /api/tasks/:id/cancel`
- `POST /api/tasks/:id/retry`
- `DELETE /api/tasks/:id`
- `POST /api/queue/pause`
- `POST /api/queue/resume`
- `POST /api/queue/reorder`
- `POST /api/tasks/parallel-codex`
- `GET /api/projects`
- `POST /api/projects/choose`
- `POST /api/projects/:id/launch`
- `DELETE /api/projects/:id`
- `GET /api/events`

## Current design problems to solve

- Too many nested borders and small labels compete for attention.
- The composer contains many decisions before the prompt, so selection needs progressive clarity.
- Project launching must remain visible without consuming excessive vertical space.
- The queue and activity panel need a stronger master-detail relationship.
- Status is compact now, but it can become illegible if treated as four tiny cards.
- Session cards contain useful metadata but can become repetitive.
- Plan council needs to read as a real exchange among agents, not a generic stepper.
- Terminal output is information-rich and should scan quickly during a live run.
- Errors and automatic retry countdown need an unmistakable but calm treatment.
- The interface should use the available desktop width without feeling like three unrelated columns.
- Mobile and narrow desktop layouts must preserve action priority.

## Design latitude

You may change:

- Overall grid and panel proportions.
- Header organization.
- Project launchpad presentation.
- Typography, color, spacing, borders, shadows, and radii.
- Session card layout.
- Queue card layout.
- Activity and terminal composition.
- Responsive stacking order.
- Copy, labels, and empty-state language when meaning remains accurate.
- Motion used for meaningful state transitions.

Avoid:

- Generic dashboard cards with decorative metrics.
- Gratuitous gradients.
- Excessive rounded pills.
- Huge headings that waste desktop space.
- Tiny text used only to fit too much information.
- Making all surfaces dark.
- Hiding critical actions behind hover-only controls.
- Provider color as the only status cue.
- Decorative animation on continuously updating regions.

## Suggested redesign process

1. Audit the rendered information hierarchy and identify the five most frequent user actions.
2. Propose one clear desktop layout and one narrow layout before editing.
3. Define a small token system for background, surface, text, muted text, line, Codex, Claude, success, warning, and failure.
4. Choose distinct display, body, and utility typography roles using locally available or safely loaded fonts.
5. Implement the global shell first.
6. Implement composer and session selection.
7. Implement queue and activity master-detail behavior.
8. Implement Plan council and terminal output as specialized surfaces.
9. Verify every interactive state, not only the empty screenshot.
10. Remove one decorative device before finishing.

## Verification checklist

Run:

```bash
npm test
node --check public/app.js
npm run desktop
```

Then verify manually:

- Execute with Codex selected.
- Execute with Claude selected.
- No connected sessions.
- Multiple connected sessions.
- Plan council configuration and preview.
- Model and effort switching.
- Enter and Shift+Enter behavior.
- File chooser, drag-and-drop, and clipboard image paste.
- Six-image limit and error state.
- Empty, short, and long queues.
- Queue drag reorder and arrow reorder.
- Multi-select queued tasks and create a parallel Claude batch.
- Running duration.
- Failure and automatic retry state.
- Pause and resume.
- Adding a task while inspecting another task.
- Long result text.
- Long command output and patches.
- Event filters, Copy log, and Follow live.
- Project pin, unpin, and provider launch.
- Disabled launcher on an older backend capability response.
- Keyboard navigation and focus visibility.
- 1180, 720, and 420 pixel widths.
- Electron window at its minimum size.

Do not declare the redesign complete with failing tests, broken provider selection, missing live refresh, or placeholder-only states.

## Repository rules

- Never add environment variables without explicit approval.
- Never read, copy, or proxy Codex or Claude credential files.
- Keep authentication owned by the official CLIs.
- Preserve local-only server binding on `127.0.0.1`.
- Do not weaken CC Relay-owned queue or Plan council safety policies.
- Do not add an API-priced model integration.
- Do not use em dash characters in repository text.
- Preserve user changes outside the redesign scope.
- Use `apply_patch` for deliberate source edits.
- Run the complete test suite before handoff.

## Definition of done

The redesign is complete when CC Relay has a coherent visual identity, the main operating state is understandable within a few seconds, every function above remains discoverable and usable, long-running task output is comfortable to monitor, and all automated and manual verification passes in both browser and Electron layouts.
