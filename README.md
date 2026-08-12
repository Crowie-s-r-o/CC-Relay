# CC Relay

> [!WARNING]
> **Tested only on macOS. Windows and Linux have not been tested yet.** Their code paths and Windows packages are experimental, so please report what you find.

[![CI](https://github.com/Crowie-s-r-o/CC-Relay/actions/workflows/ci.yml/badge.svg)](https://github.com/Crowie-s-r-o/CC-Relay/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/Crowie-s-r-o/CC-Relay?label=latest)](https://github.com/Crowie-s-r-o/CC-Relay/releases/latest)
[![PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial-5b7cfa.svg)](LICENSE)

### [Download the latest version](https://github.com/Crowie-s-r-o/CC-Relay/releases/latest)

**Stop babysitting AI terminals.** CC Relay is a local command center for Codex and Claude Code. Queue work across projects, control concurrency, watch every task live, continue saved conversations, and let two providers challenge important plans. It uses your existing CLI subscriptions, not API keys.

![CC Relay orchestrating projects and AI tasks](docs/assets/cc-relay-overview.png)

## Why Relay

1. **Control provider concurrency.** Set separate per-project limits for Codex and Claude. Relay launches fresh provider terminals only when the whole task has the slots it needs.
2. **Use disposable terminals by default.** Each task execution gets its own terminal. On macOS it launches minimized by default and closes automatically when the work ends. A finished direct task can use **Continue session** to relaunch the same saved conversation, while optional terminal retention is one click away.
3. **Run many projects from one Launchpad.** Keep each repository, queue, limits, history, and task state together without managing ten permanent terminal windows.
4. **Queue the next prompts now.** Add, reorder, edit, or switch queued work while current tasks are still running. Relay dispatches it when the matching provider has capacity.
5. **Make important plans survive a challenge.** Plan council lets one provider author a plan, the other review it critically, and the author revise it into an implementation-ready result.
6. **Plan smart, execute economically.** Forward-planning Turbo uses a stronger model to build a dependency graph, then fans the work out to faster, lower-cost Codex workers.
7. **See subscription runway at a glance.** Four compact header bars track Claude's current session, all-model weekly, and Fable weekly usage alongside Codex weekly usage.

You also get live execution, local SQLite history, artifacts, image attachments, diagnostics, loopback-only networking, and exact terminal ownership checks. See the full [feature inventory](FEATURES.md).

## Get started

Download CC Relay from the [latest GitHub Release](https://github.com/Crowie-s-r-o/CC-Relay/releases/latest), then run the packaged app:

- **macOS (tested):** Download the `.dmg`, open it, drag **CC Relay** to **Applications**, and launch the app.
- **Windows (experimental):** Download and run the `-Setup.exe` installer. To run CC Relay without installing it, download and execute the `-Portable.exe` file instead.

Linux desktop packages are not currently produced. The desktop builds do not require a source checkout or Node.js. Before queueing work, install and sign in to at least one provider CLI: Codex with ChatGPT or Claude Code with a Claude subscription.

## The loop

1. Pin a repository in the Launchpad.
2. Choose a provider, model, effort, and optional workflow.
3. Queue the prompt. `Ctrl+Enter` sends it to the front.
4. CC Relay waits for capacity, launches an owned terminal, and binds the exact conversation.
5. Follow execution in Task Activity, then continue or retry without losing history.

| Workflow | Best for |
| --- | --- |
| Execute | One focused Codex or Claude task |
| Plan council | A reviewed, implementation-ready plan |
| Forward-planning Turbo | A dependency graph dispatched across Codex workers |
| Planner | Reusable project plans released through the normal queue |

## Updates

Installed Windows NSIS builds check this public repository for a newer GitHub Release after launch and every five minutes after that. When one exists, CC Relay shows the version in its header, opens a release-details modal from that signal, and asks before downloading or restarting. macOS DMG installations and Windows portable builds update manually from the [latest release](https://github.com/Crowie-s-r-o/CC-Relay/releases/latest).

Installed Windows builds created before the move to `Crowie-s-r-o/CC-Relay` need one manual install from the new repository before automatic checks can follow this release line.

## Safety

> [!CAUTION]
> CC Relay can start writable AI sessions with unattended permission settings. Use it only with repositories, prompts, hooks, and machines you trust.

The app binds to `127.0.0.1`, keeps provider credentials inside their CLIs, stores task data locally, and closes only terminals whose live identity and ownership it can prove. No project environment variables or AI API keys are required.

## Development

Running CC Relay from source is the development path. It requires Node.js 24+ and at least one authenticated provider CLI.

```bash
git clone https://github.com/Crowie-s-r-o/CC-Relay.git
cd CC-Relay
npm ci
npm start
```

Open [http://127.0.0.1:4768](http://127.0.0.1:4768). To run the Electron development shell instead, use `npm run desktop`.

Before submitting a change, run:

```bash
npm test
npm run release:check
```

Native packages are built on their target operating systems:

```bash
npm run desktop:build:mac
npm run desktop:build:win
```

Public macOS and Windows installers still need trusted signing credentials. Passing simulated Windows tests is not proof of real Windows support.

## Deploy a release

From a clean `main` branch:

```bash
npm run deploy
```

That single command infers the Semantic Versioning bump from Conventional Commits, generates a compact AI changelog with Codex or Claude, updates both package manifests and `CHANGELOG.md`, runs release checks, all tests, and the dependency audit, creates the release commit and annotated tag, then atomically pushes both to GitHub. The tag triggers native builds and publishes the GitHub Release.

Override the inferred bump or AI provider when needed:

```bash
npm run deploy -- patch
npm run deploy -- minor --provider claude
npm run deploy -- major --provider codex
npm run deploy -- auto --dry-run
```

Read the [changelog](CHANGELOG.md), [release architecture](wiki/open-source-releases.md), and [desktop update contract](wiki/desktop-updates.md).

## Contributing

Focused pull requests and real Windows or Linux reports are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately through [SECURITY.md](SECURITY.md).

## License

CC Relay is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE). You may use, modify, and redistribute it for permitted noncommercial purposes. Commercial or other business use requires prior written permission from Patrik Kelemen.

Copies previously received under MIT keep those MIT rights; PolyForm governs newly offered versions.

Bundled fonts retain their own OFL 1.1 terms; see [third-party notices](THIRD_PARTY_NOTICES.md).

Copyright (c) 2026 Patrik Kelemen.
