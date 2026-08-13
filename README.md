# CC Relay

> [!WARNING]
> **Tested only on macOS. Windows and Linux have not been tested yet.** Their code paths and Windows packages are experimental, so please report what you find.

[![CI](https://github.com/Crowie-s-r-o/CC-Relay/actions/workflows/ci.yml/badge.svg)](https://github.com/Crowie-s-r-o/CC-Relay/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/Crowie-s-r-o/CC-Relay?label=latest)](https://github.com/Crowie-s-r-o/CC-Relay/releases/latest)
[![PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial-5b7cfa.svg)](LICENSE)

### [Download the latest version](https://github.com/Crowie-s-r-o/CC-Relay/releases/latest)

**Stop babysitting AI terminals.** CC Relay is a local command center for Codex and Claude Code. Queue work across projects, control concurrency, watch every task live, and let two providers challenge important plans. It uses your existing CLI subscriptions, not API keys.

![CC Relay orchestrating projects and AI tasks](docs/assets/cc-relay-overview.png)

## Why Relay

1. **Control provider concurrency.** Separate per-project limits for Codex and Claude, with terminals launched only when a task has every slot it needs.
2. **Use disposable terminals by default.** Each execution gets its own terminal that launches minimized by default and closes automatically when the work ends.
3. **Run many projects from one Launchpad.** Repositories, queues, limits, history, and task state in one place.
4. **Queue the next prompts now.** Add, reorder, or edit queued work while tasks run; Relay dispatches on capacity.
5. **Make important plans survive a challenge.** Plan council has one provider author a plan and the other review it critically.
6. **Plan smart, execute economically.** Turbo builds a dependency graph with a stronger model, then fans work out to faster Codex workers.

Also included: live execution, local SQLite history, artifacts, image attachments, provider usage bars, and diagnostics. See the [feature inventory](FEATURES.md).

## Get started

Grab the packaged app from the [latest GitHub Release](https://github.com/Crowie-s-r-o/CC-Relay/releases/latest):

- **macOS (tested):** open the `.dmg` and drag **CC Relay** to **Applications**.
- **Windows (experimental):** run the `-Setup.exe` installer, or the `-Portable.exe` file to skip installing.

Signed macOS builds and installed Windows builds then check the same GitHub repository for releases every five minutes. Updates download in the background and install when you restart or normally quit CC Relay. The Windows portable build remains a manual download. The first macOS release that contains the automatic updater still needs the normal DMG installation once.

No source checkout or Node.js needed. Before queueing work, sign in to at least one provider CLI: Codex with ChatGPT, or Claude Code with a Claude subscription.

## The loop

Pin as many repositories as you want, pick a provider, model, effort, and workflow, then queue the prompt (`Ctrl+Enter` sends it to the front). Relay runs as many tasks in parallel as you allow; anything over the limit waits in the queue and launches the moment a slot frees up.

While work runs:

- **Every project at once.** Several repositories can execute side by side, each with its own queue, limits, and history.
- **Hear and see the finish.** A sound plays when a task ends, and completed tasks stack up as notifications you can click through and review one by one.
- **Read the terminal fast.** Live output is colorized, and a filter narrows it to just the agent's own messages when you only want the reasoning and the result.
- **Fresh session per task.** Each execution starts a clean conversation, so context stays uncluttered and token use stays low, and you can continue any saved task later exactly where it left off.

| Workflow | Best for |
| --- | --- |
| Execute | One focused Codex or Claude task |
| Plan council | One provider writes the plan, the other tears it apart, the author revises |
| Forward-planning Turbo | A stronger model builds the dependency graph, fast Codex workers execute it |
| Planner | Reusable project plans released through the normal queue |

## Safety

> [!CAUTION]
> CC Relay can start writable AI sessions with unattended permission settings. Use it only with repositories, prompts, hooks, and machines you trust.

It binds to `127.0.0.1`, keeps provider credentials inside their CLIs, stores task data locally, and closes only terminals it can prove it owns.

## Development

Running from source requires Node.js 24+ and at least one authenticated provider CLI.

```bash
git clone https://github.com/Crowie-s-r-o/CC-Relay.git
cd CC-Relay
npm ci
npm start
```

Open [http://127.0.0.1:4768](http://127.0.0.1:4768), or use `npm run desktop` for the Electron shell. Before submitting a change, run `npm test` and `npm run release:check`. Native packages build on their target OS with `npm run desktop:build:mac` and `npm run desktop:build:win`; public installers still need trusted signing credentials.

## Contributing

Focused pull requests and real Windows or Linux reports are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately through [SECURITY.md](SECURITY.md).

## License

CC Relay is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE). You may use, modify, and redistribute it for permitted noncommercial purposes. Commercial or other business use requires prior written permission from Patrik Kelemen.

Copies previously received under MIT keep those MIT rights; PolyForm governs newly offered versions.

Bundled fonts retain their own OFL 1.1 terms; see [third-party notices](THIRD_PARTY_NOTICES.md).

Copyright (c) 2026 Patrik Kelemen.
