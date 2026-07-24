# Relay

Relay is a local, sequential AI task queue for subscription-authenticated Codex and Claude Code sessions. It discovers live sessions, sends queued prompts into the selected conversation, and can run a read-only planning council across both providers. Relay does not call the OpenAI or Anthropic APIs directly.

The source is publicly visible so developers can inspect how Relay interacts with authenticated Codex and Claude sessions and local task data. Public visibility does not grant permission to use or copy the code. See [License](#license).

## What it does

- Persists tasks and state in local SQLite.
- Lists connected Codex terminals and live Claude Code sessions instead of asking for repository paths.
- Closes an idle Codex or Claude terminal only after verifying its exact native identity. On macOS, existing one-tab Terminal sessions can be recovered through their live process and TTY without targeting unrelated windows.
- Supports provider-specific model and reasoning effort selection.
- Runs exactly one Relay task at a time across all agents.
- Bundles selected queued tasks into one Claude command that delegates the numbered list to parallel sub-agents.
- Waits five seconds after a genuine task failure, then automatically requeues the same task.
- Refreshes visible queue, retry, task detail, and terminal state automatically every two seconds as a fallback to live updates.
- Automatically starts the next queued task.
- Reorders waiting tasks with drag and drop or Move up and Move down buttons.
- Shows live elapsed time on running task cards and total execution time on finished cards.
- Builds reviewed plans through a Claude author, Codex reviewer, and Claude revision loop.
- Attaches local reference images to Execute and Plan council tasks.
- Groups raw AI events into a live terminal panel with command output, tool calls, file changes, messages, filters, follow mode, and copyable logs.
- Continues direct Codex or Claude tasks from the live terminal panel without changing sessions, models, or effort.
- Supports pause, resume, cancel, retry, and delete.
- Stores task prompts, JSONL events, results, and errors under `.data/tasks/`.
- Includes a personal Codex plugin skill for managing the queue from Codex.

## Requirements

- Node.js 24 or newer.
- Codex CLI 0.144.5 or newer, installed and signed in with ChatGPT.
- At least one connected Codex terminal or open Claude Code session.
- Claude Code CLI 2.1.211 or newer, installed and signed in with a Claude subscription for Claude execution and Plan council.

## Run

The following development instructions are for the copyright holder and people who have received separate written permission. The view-only source license does not grant permission to run Relay.

```bash
npm start
```

Open [http://127.0.0.1:4768](http://127.0.0.1:4768).

The server only listens on `127.0.0.1`. No environment variables are required.

## Desktop builds

Relay can run as an Electron desktop application on macOS and Windows. The packaged app starts the same localhost server internally and stores its SQLite database and task artifacts in the operating system's per-user application-data directory.

```bash
npm run desktop
npm run desktop:build:mac
npm run desktop:build:win
```

macOS builds produce DMG and ZIP artifacts. Windows builds produce an NSIS installer and a portable executable. Build each release on its native operating system. The GitHub Actions workflow at `.github/workflows/build-desktop.yml` runs tests and uploads both platform artifacts when a `v*` tag is pushed or the workflow is started manually.

Local and CI builds work without signing credentials, but public distribution should add an Apple Developer signing and notarization identity for macOS and a trusted code-signing certificate for Windows. Those credentials are intentionally not stored in this repository.

### Desktop updates and releases

Packaged Relay builds check GitHub for updates once shortly after the desktop window finishes loading. The check is enabled only for packaged macOS builds and installed Windows NSIS builds. `npm run desktop` never checks for updates, and the Windows portable executable remains a manual-download build because it has no installer-managed update path.

When a release is available, Relay shows the current and available versions and waits for an explicit **Download** choice. After the download completes, it offers **Restart and install** or **Later**. Background no-update results and check or download failures stay out of the user's way and are logged only. Restarting first shuts down Relay's embedded server so SQLite and active task state close through the normal graceful-shutdown path.

Releases are created by pushing a matching version tag such as `v0.2.0`. The tag must match the `version` field in `package.json`; the GitHub Actions release job verifies this before publishing. The native macOS and Windows build jobs upload their complete `dist/` directories, and the release job publishes those files to the GitHub release. Expected update metadata and artifacts are:

- macOS: `latest-mac.yml`, DMG, ZIP, and their blockmaps.
- Windows: `latest.yml`, NSIS installer, portable executable, and installer blockmaps.

macOS update installation requires signed and notarized release builds. Windows installed updates require a trusted signed NSIS build. Portable Windows artifacts remain manual-download only. See [desktop update notes](wiki/desktop-updates.md) for the implementation contract and troubleshooting checklist.

The desktop project picker uses the macOS folder dialog or Windows Forms folder dialog. Terminal launching uses Terminal.app on macOS and a new `cmd.exe` window on Windows. Codex and Claude must be installed and authenticated on the target computer.

In another terminal, start Codex through Relay's shared server:

```bash
codex --dangerously-bypass-approvals-and-sandbox --cd . --remote ws://127.0.0.1:4769
```

To reconnect an existing Codex conversation, pass its session ID:

```bash
codex --dangerously-bypass-approvals-and-sandbox --cd . resume --remote ws://127.0.0.1:4769 <session-id>
```

An already-running plain `codex` process cannot be attached retroactively. Restart it with `--remote` so Relay and the terminal share the same app-server.

To connect Claude Code with unrestricted permissions, start it in the project you want to work on:

```bash
claude --dangerously-skip-permissions
```

Relay discovers live interactive and background Claude sessions through the official `claude agents --json` command. No special launcher, API key, or credential access is required.

> **Danger:** These interactive launch commands disable Codex sandboxing and approvals or Claude permission checks. Use them only in projects and environments you fully trust. This setting applies to terminals you copy or launch from Relay. Queued Relay turns keep their guarded execution policies.

## How sessions and tasks work

Relay starts one persistent local Codex app-server on port `4770`. A localhost WebSocket proxy on `ws://127.0.0.1:4769` forwards terminal traffic and records which thread each live client joined. Relay lists only terminals that are currently connected, joins the selected thread for a queued turn, streams events, and releases its own subscription when the turn ends.

For Claude, Relay asks the official CLI for its active agent list. It records only session metadata returned by that command: session ID, name, process, workspace, kind, and busy state. Relay waits for a busy session to become idle, then runs `claude -p --resume <session-id>` with streaming JSON output, the selected model and effort, and guarded Auto permission mode. The turn reuses the selected conversation context and is appended to the same Claude transcript.

Direct Claude tasks run concurrently on different session IDs and sequentially within one session. With **Use an idle Relay when available** enabled, Relay can route a normal Claude submission to another unassigned idle Claude session in the same workspace. Restart Relay after upgrading so the renderer can detect the parallel Claude scheduler capability.

Claude does not expose Codex's local app-server protocol. The existing interactive Claude terminal does not redraw a turn produced by a second headless resume process. Relay's Terminal output panel is the live view, and the turn remains part of the same conversation when it is next resumed. This follows Claude Code's supported session behavior without terminal keystroke injection or private protocol access.

The selected thread keeps its own working directory and conversation history. There is no repository path field in Relay.

### Project launchpad

Pin favorite project folders in the top launchpad. Project cards are workspaces: selecting one scopes the visible sessions, queue, running state, and parallel Claude controls to that folder. Each card has separate Codex and Claude launch buttons. Codex opens a new unrestricted Terminal session connected to Relay; Claude opens an unrestricted CLI session. When a project card is active, **Launch terminal** reuses that folder without showing the folder picker and selects the new session as soon as it connects. **Pin folder** uses the native macOS folder picker, while **Add and launch** pins the folder and immediately opens the provider selected in Execute mode. Relay validates and resolves the chosen directory before launching a fixed command. It does not accept free-form terminal commands.

Each project has its own queue order, pause state, and FIFO barriers. A Plan council or other exclusive task in one project does not block eligible direct Codex work in another project. Provider-wide exclusive tasks are still serialized when they require the same shared runner.

Pinned projects are stored in Relay's local SQLite database. The launcher currently targets macOS Terminal.app and requires a Relay restart after upgrading from a version without this backend capability.

For Codex, Relay starts queued turns with workspace-write sandboxing and an unattended `never` approval policy. Codex can edit files and run commands inside the selected thread workspace. Network access and operations outside the workspace remain subject to Codex policy. Relay never uses the full-access bypass flag.

Relay disables login-shell semantics for task commands. This avoids loading interactive shell startup files in unattended runs while preserving the inherited process environment.

Queued Codex prompts and answers appear live in the selected terminal as well as Relay. Both providers wait for a selected busy session to become idle before starting. Avoid entering another prompt in that session while a Relay task is running.

The composer has Execute and Forward-planning Turbo workflows. Execute has separate provider, session, model, and effort controls, plus an optional Plan council checkbox for creating a reviewed read-only plan instead of direct execution. Forward-planning Turbo has its own optional council pass before workers start. Codex choices come from the local app-server model catalog. Claude choices use supported official CLI aliases. Both are validated again when the task is queued. Press Enter in the prompt to add the task to the queue. Press Shift+Enter to insert a new line.

## Terminal output

Relay turns the raw provider event protocol into a readable execution trace. Start and completion records for the same item are paired into one signal. Command cards show the command, working directory, duration, exit state, and expandable captured output. File edits, connected tools, web searches, images, AI messages, queue state, and errors each have distinct treatments.

Highlights is the default view and removes low-value protocol noise such as empty reasoning and message transport events. Commands, Messages, and All filters remain available. Follow mode stays pinned to new activity until you scroll away, and Copy log copies the current filtered view. Raw events are still preserved in SQLite and `events.jsonl`.

## Optional Plan council

Plan council is enabled from Execute when a prompt needs a reviewed plan rather than direct execution. It requires two different providers and currently uses this fixed read-only route:

1. Claude Fable or Opus at max effort inspects the selected Codex workspace and writes a first implementation plan.
2. Codex independently reviews the draft in the selected connected terminal with the chosen Codex model and effort.
3. Claude receives the draft and Codex review, then returns a final revised plan.

Claude runs through the official `claude` CLI with its existing subscription login. Codex runs through Relay's shared app-server with its existing ChatGPT login. Both planning agents are restricted to read-only work.

The activity panel shows live stage progress, the expandable first draft and review, and a formatted final plan. Relay saves the same council record as `plan.json` and a readable combined `plan.md` file.

## Image attachments

Choose, drop, or paste up to 99 PNG, JPEG, or WebP images in the composer. Each image may be up to 5 MB and the task may contain up to 20 MB total. Relay validates the declared type and file signature before it stores anything.

Images are written under the task artifact directory before the task can start. Codex Execute tasks send them as native local image inputs. Claude Execute and both Claude Plan council stages receive local paths with a scoped attachment directory and explicit instructions to inspect them through Read. The Codex review receives native local image inputs. The task activity panel shows the persisted image contact sheet and opens full images through a task-scoped local route.

Relay never converts image attachments into remote URLs and never calls an image or model API directly. The official Codex and Claude Code processes read the local files using their existing subscription authentication.

## Queue ordering

Only tasks with `queued` status can move. Drag a queued card above or below another queued card, or use its arrow buttons. Running, completed, failed, cancelled, and interrupted tasks stay fixed. Relay validates the full queued task set before applying a reorder so stale browser state cannot silently overwrite newer queue changes.

## Parallel Claude batches

Select two or more waiting task cards and choose **Run in parallel**. Relay replaces them with one Codex task sent to the currently selected Codex terminal. Its prompt preserves the original tasks as an ordered numbered list and instructs Codex to delegate independent items to sub-agents concurrently, verify the combined result, and return one consolidated summary.

### Forward-planning turbo

Turbo uses the selected Codex terminal as a read-only planner and dispatches its validated JSON dependency graph across other Codex terminals connected to the same workspace. Choose the planner and worker models, efforts, and worker count in the composer. Relay starts dependency-ready tasks concurrently and reuses workers until the graph is complete. Defaults prefer Sol high for planning and Luna high for execution with three workers.

All selected tasks must belong to the chosen Claude session's workspace. Existing image attachments are copied into the combined task before the original task artifacts are removed. The normal 99-image and 20 MB total limits still apply.

## Personal Codex plugin

The source plugin is in `plugin/relay-queue`. Sync and install it into the personal Codex marketplace with:

```bash
npm run plugin:install
```

Start a new Codex thread after installation. Invoke the skill as `$relay-queue:relay-queue` when you want Codex to inspect connected terminals or manage queue items.

## Local data

```text
.data/
  relay.sqlite
  tasks/<task-id>/
    task.md
    events.jsonl
    attachments/
      01.png
      02.jpg
    plan.json
    plan.md
    result.md
    error.txt
```

The `.data` directory is ignored by Git.

## License

Relay is source-available for inspection only. It is not open-source software.

Copyright (c) 2026 Patrik Kelemen. All rights reserved. You may read the source as displayed by an authorized repository host, but you may not use, run, copy, download, modify, redistribute, incorporate, or derive another project from it without prior written permission.

See [LICENSE](LICENSE) for the complete terms. Contact the copyright holder for a separate commercial, evaluation, or development license.
