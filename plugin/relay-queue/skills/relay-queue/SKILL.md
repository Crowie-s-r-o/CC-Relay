---
name: relay-queue
description: Manage the local Relay sequential Codex task queue. Use when the user asks to list, add, pause, resume, retry, cancel, or inspect queued Codex tasks. Do not use for directly implementing the queued task in the current thread.
---

# Relay Queue

Use the bundled `scripts/relayctl.mjs` command helper to communicate with the Relay server at `http://127.0.0.1:4768`.

## Resolve the helper

This skill is stored at `skills/relay-queue/SKILL.md`. Resolve the helper at `scripts/relayctl.mjs` relative to the plugin root that contains this skill. Use the absolute installed skill path shown to you by Codex to compute that plugin root. Do not search unrelated directories.

## Commands

```bash
node <plugin-root>/scripts/relayctl.mjs status
node <plugin-root>/scripts/relayctl.mjs connect
node <plugin-root>/scripts/relayctl.mjs list
node <plugin-root>/scripts/relayctl.mjs threads
node <plugin-root>/scripts/relayctl.mjs add --thread <thread-id> --prompt "Complete task prompt"
node <plugin-root>/scripts/relayctl.mjs pause
node <plugin-root>/scripts/relayctl.mjs resume
node <plugin-root>/scripts/relayctl.mjs retry <task-id>
node <plugin-root>/scripts/relayctl.mjs cancel <task-id>
```

## Workflow

1. Run `status` before changing the queue.
2. If Relay is not running, tell the user to run `npm start` in `/Users/patrikkelemen/WebstormProjects/dual-agent-orchestrator`.
3. Run `connect` if the user needs the command for opening a Relay-connected Codex terminal.
4. Run `threads` before `add` and use a thread ID returned by Relay. Relay lists only terminals connected through its shared app-server.
5. For `add`, require a complete standalone prompt. Relay derives the display label from the prompt.
6. Confirm the returned task ID and queue state.
7. Relay runs tasks sequentially. Do not start another Codex process yourself.

Do not read or modify Codex authentication files. Relay uses the existing official CLI login.
