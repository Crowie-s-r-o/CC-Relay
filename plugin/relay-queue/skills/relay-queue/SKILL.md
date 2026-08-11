---
name: relay-queue
description: Manage the local CC Relay sequential Codex task queue. Use when the user asks to list, add, name, rename, pause, resume, retry, cancel, or inspect queued Codex tasks. Do not use for directly implementing the queued task in the current thread.
---

# CC Relay Queue

Use the bundled `scripts/relayctl.mjs` command helper to communicate with the CC Relay server at `http://127.0.0.1:4768`.

## Resolve the helper

This skill is stored at `skills/relay-queue/SKILL.md`. Resolve the helper at `scripts/relayctl.mjs` relative to the plugin root that contains this skill. Use the absolute installed skill path shown to you by Codex to compute that plugin root. Do not search unrelated directories.

## Commands

```bash
node <plugin-root>/scripts/relayctl.mjs status
node <plugin-root>/scripts/relayctl.mjs connect
node <plugin-root>/scripts/relayctl.mjs list
node <plugin-root>/scripts/relayctl.mjs threads
node <plugin-root>/scripts/relayctl.mjs add --thread <thread-id> --name "Short task name" --prompt "Complete task prompt"
node <plugin-root>/scripts/relayctl.mjs rename <task-id> --name "New task name"
node <plugin-root>/scripts/relayctl.mjs pause
node <plugin-root>/scripts/relayctl.mjs resume
node <plugin-root>/scripts/relayctl.mjs retry <task-id>
node <plugin-root>/scripts/relayctl.mjs cancel <task-id>
```

## Workflow

1. Run `status` before changing the queue.
2. If CC Relay is not running, tell the user to run `npm start` from their CC Relay checkout.
3. Run `connect` if the user needs the command for opening a CC Relay-connected Codex terminal.
4. Run `threads` before `add` and use a thread ID returned by CC Relay. CC Relay lists only terminals connected through its shared app-server.
5. For `add`, require a complete standalone prompt. `--name` is optional; CC Relay derives the display name from the prompt when it is omitted.
6. `rename` is allowed only while the task is still queued and preserves its prompt, routing, and position.
7. Confirm the returned task ID, name, and queue state.
8. CC Relay runs tasks sequentially. Do not start another Codex process yourself.

Do not read or modify Codex authentication files. CC Relay uses the existing official CLI login.
