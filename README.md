# CC Relay

> [!WARNING]
> CC Relay has been tested only on macOS. Windows and Linux have not been validated yet. Their code paths are experimental, so expect rough edges and please report what you find.

[![CI](https://github.com/Crowie-s-r-o/CC-Relay/actions/workflows/ci.yml/badge.svg)](https://github.com/Crowie-s-r-o/CC-Relay/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-5b7cfa.svg)](LICENSE)
[![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-3c873a.svg)](https://nodejs.org/)

Stop babysitting one AI terminal at a time.

CC Relay is a local control plane for Codex and Claude Code. Queue work across projects, run independent tasks in parallel, inspect every live command, keep conversations alive, and send important plans through a two-provider review loop. It uses the provider CLIs you already authenticate with and never calls the OpenAI or Anthropic APIs directly.

![CC Relay running multiple projects and AI tasks](docs/assets/cc-relay-overview.png)

## Why CC Relay

AI coding tools are excellent inside one terminal. Real development rarely stays inside one terminal.

CC Relay gives you one place to manage the larger system:

- Pin multiple repositories in a project Launchpad.
- Queue prompts before another task finishes.
- Set separate Codex and Claude concurrency limits per project.
- Launch a fresh provider terminal only when work receives a slot.
- Follow commands, tools, messages, file changes, errors, and reasoning summaries live.
- Continue the same saved conversation without creating a second task.
- Keep selected terminal sessions open for hands-on follow-up work.
- Run a reviewed Plan council with one provider authoring and the other challenging it.
- Use Forward-planning Turbo to turn one request into a dependency graph and dispatch ready work across multiple Codex workers.
- Attach local PNG, JPEG, and WebP reference images.
- Keep task state, history, artifacts, and configuration on your machine.

The complete feature inventory lives in [FEATURES.md](FEATURES.md).

## Quick start

### Requirements

- macOS for the currently validated experience.
- Node.js 24 or newer.
- Codex CLI 0.144.5 or newer, installed and signed in with ChatGPT.
- Claude Code CLI 2.1.218 or newer, installed and signed in with a Claude subscription if you want Claude execution or Plan council.

At least one provider must be installed and authenticated.

### Run the local app

```bash
git clone https://github.com/Crowie-s-r-o/CC-Relay.git
cd CC-Relay
npm ci
npm start
```

Open [http://127.0.0.1:4768](http://127.0.0.1:4768), pin a project folder, choose Codex or Claude, and queue your first prompt.

CC Relay listens only on `127.0.0.1`. It requires no API keys and no project environment variables.

### Run the desktop app

```bash
npm run desktop
```

The Electron app embeds the same loopback server. It stores its task database and artifacts in the operating system's per-user application-data directory while sharing pinned-project configuration with the standalone localhost app.

## The basic loop

1. Select a project in the Launchpad.
2. Choose Execute or Forward-planning Turbo.
3. Pick Codex or Claude, a model, and a reasoning effort.
4. Add an optional task name, prompt, and reference images.
5. Queue the work or use `Ctrl+Enter` to prioritize it.
6. CC Relay waits for project capacity, opens an owned terminal, binds the exact provider conversation, and starts the turn.
7. Task Activity streams the execution trace and final response.
8. CC Relay closes only the terminal it owns, unless terminal retention is enabled.

Each project keeps its own queue order, pause state, provider limits, terminal layout, history, and in-progress composer draft.

## How it works

| Layer | Responsibility |
| --- | --- |
| Browser or Electron UI | Launchpad, composer, queue, history, Planner, and live Task Activity |
| Loopback Node.js server | Validation, local routes, provider status, and graceful shutdown |
| SQLite stores | Tasks, events, plans, settings, queue positions, and continuation history |
| Scheduler | Project-scoped FIFO ordering, provider capacity, retries, and workflow ownership |
| Native terminal coordinator | Opens, binds, lays out, retains, and closes only exact CC Relay-owned terminals |
| Codex and Claude CLIs | Execute turns using the user's existing subscription authentication |

Codex traffic runs through a local WebSocket proxy that binds a launched terminal to its exact conversation. Claude sessions are discovered through `claude agents --json`; on macOS, CC Relay drives the exact owned Terminal.app tab and mirrors the conversation transcript and hooks into Task Activity.

New tasks use disposable terminal ownership. A provider conversation ID is saved before execution, so **Continue session** can later reopen or reuse that exact conversation under the original task. Older persistent task records keep their previous routing behavior for compatibility.

## Workflows

### Execute

Execute sends one task to the selected provider. Independent tasks can run concurrently within the selected project's Codex and Claude limits. Manual retries can change provider, model, and effort while preserving the task's history.

### Plan council

Enable Plan council inside Execute when a request deserves a reviewed implementation plan:

1. The selected first provider inspects the project and writes a read-only plan.
2. The other provider independently reviews the brief, references, and draft.
3. The first provider revises the plan into one final deliverable.

The checkpoint stays in CC Relay's task artifacts. The final plan is also written to the selected project at `.data/tasks/<task-id>/plan.md`, ready for explicit execution.

### Forward-planning Turbo

Turbo asks a Codex planner to create a validated dependency graph, then dispatches dependency-ready packages across a disposable Codex worker fleet. An optional Codex and Claude council can review the graph before execution starts.

### Planner

Planner stores reusable project plans, breaks them into dependency-aware steps, and releases ready steps through the same queue instead of maintaining a second scheduler.

## Safety model

> [!CAUTION]
> CC Relay can launch Codex with approval bypass and Claude with permission checks disabled for writable work. Use it only with repositories, prompts, hooks, and local machines you trust.

Important boundaries:

- The HTTP server and Codex proxy bind to loopback only.
- Provider credentials remain owned by the installed provider CLIs.
- Reference images stay on disk and are passed as local files.
- Planning stages are explicitly read-only.
- Writable Codex turns use explicit full workspace access and unattended approval settings.
- Terminal actions re-resolve live process, conversation, TTY, and native window identity before acting.
- CC Relay never intentionally closes a terminal it did not launch or explicitly adopt.
- `.data/`, logs, SQLite databases, build output, and IDE state are ignored by Git.

## Local data

Standalone task data lives under the checkout:

```text
.data/
  relay.sqlite
  relay-diagnostics.jsonl
  tasks/<task-id>/
    task.md
    events.jsonl
    attachments/
    plan.json
    result.md
    error.txt
```

Shared Launchpad configuration uses the compatibility directory name `dual-agent-orchestrator`:

```text
macOS:  ~/Library/Application Support/dual-agent-orchestrator/relay-config.sqlite
Windows: ~/AppData/Roaming/dual-agent-orchestrator/relay-config.sqlite
Linux:  ~/.config/dual-agent-orchestrator/relay-config.sqlite
```

Renaming that directory would make existing projects and settings appear missing, so the legacy name is intentional.

## Platform status

| Platform | Status | Notes |
| --- | --- | --- |
| macOS | Tested | Current development and real terminal validation use Terminal.app on macOS. |
| Windows | Not yet tested | Native launcher, path handling, NSIS, portable packaging, and updater code exist, but need real end-to-end validation. |
| Linux | Not yet tested | The localhost server may be useful, but terminal lifecycle and desktop behavior have not been validated. |

Windows and Linux help is especially welcome. Please include the operating system version, Node.js version, provider CLI versions, and relevant diagnostic excerpt in a bug report.

## Development

```bash
npm ci
npm test
npm run release:check
```

The test suite covers queue invariants, task ownership, continuation, terminal identity, Windows command shaping, renderer state, planning workflows, updater behavior, and release metadata. Passing simulated Windows tests does not replace real Windows validation.

Native development and package builds:

```bash
npm run desktop
npm run desktop:build:mac
npm run desktop:build:win
```

Build each production artifact on its native operating system. Public macOS distribution needs Apple signing and notarization. Public Windows installation needs a trusted code-signing certificate. Credentials must never be committed to this repository.

## Releases

CC Relay uses Semantic Versioning, annotated Git tags, a compact AI-written changelog, and an atomic GitHub push.

```bash
npm run release -- auto
```

The release command:

1. Requires a clean `main` branch and a configured `origin`.
2. Fetches `origin/main` and release tags, then rejects divergent history.
3. Reads commits since the latest `vX.Y.Z` tag.
4. Infers `major`, `minor`, or `patch` from Conventional Commit messages when `auto` is used.
5. Runs an isolated, no-tools Codex CLI turn to create compact release notes, with Claude CLI as the automatic fallback.
6. Updates `package.json`, `package-lock.json`, and `CHANGELOG.md` together.
7. Runs the release metadata check, full test suite, and dependency audit.
8. Creates `chore(release): vX.Y.Z` plus an annotated `vX.Y.Z` tag.
9. Pushes `main` and the tag to GitHub atomically.

No AI API key is needed. Release notes use an authenticated local Codex or Claude subscription CLI. A release stops without changing files if neither provider can produce valid notes.

Choose the bump explicitly when commit history does not communicate intent:

```bash
npm run release -- patch
npm run release -- minor --provider claude
npm run release -- major --provider codex
npm run release -- auto --dry-run
```

Automatic bump rules:

| Commit signal | Version bump |
| --- | --- |
| `BREAKING CHANGE:` or `type!:` | Major |
| `feat:` | Minor |
| Everything else | Patch |

Pushing the tag starts `.github/workflows/build-desktop.yml`. GitHub verifies that the tag, package manifests, and changelog agree, builds native artifacts, and publishes the matching AI-written changelog entry as the GitHub Release body.

See [CHANGELOG.md](CHANGELOG.md) and [the release architecture notes](wiki/open-source-releases.md).

## Codex queue plugin

The repository includes a personal Codex plugin in `plugin/relay-queue` for inspecting and managing the local queue from Codex:

```bash
npm run plugin:install
```

Start a new Codex thread after installation, then invoke `$relay-queue:relay-queue`.

## Contributing

Issues, focused pull requests, macOS regression reports, and real Windows or Linux validation are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md). Please report suspected vulnerabilities through the private process in [SECURITY.md](SECURITY.md), not a public issue.

## License

CC Relay is open-source software released under the [MIT License](LICENSE).

Copyright (c) 2026 Patrik Kelemen.
