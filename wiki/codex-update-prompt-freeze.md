---
name: Codex Update Prompt Freeze
description: A pending Codex CLI release blocked every interactive relay terminal on an update prompt, so queued tasks never bound a session.
type: note
tags:
  - relay
  - codex
  - terminal
  - queue
---

# Codex Update Prompt Freeze

## Symptom

A CC Relay-owned Codex task reached a runnable queue position, CC Relay reserved capacity and opened a native terminal in the project directory, and then nothing else happened. The task stayed running forever with no output, no bound `thread_id`, and no error. The native terminal was visibly alive and showed:

```text
Update available! 0.146.1 -> 0.147.0
...
Press enter to continue
```

The same freeze hit fresh launches and `codex resume <conversation-id>` relaunches, user Launchpad launches and disposable pool launches alike. It also broke the connection helper: the command shown and copied there produced a terminal that never reached the `--remote` endpoint.

## Root cause

The Codex CLI shows the update notice as an interactive TUI screen that must be dismissed with Return **before** the session starts. `--remote` is dialed only after that screen is cleared, so the shared app-server never saw a client join, no provider session could be proven to belong to the launch, and the queue kept waiting on a binding that could not arrive. CC Relay had no way to answer the prompt: nothing types into that terminal until the session is bound, which is exactly what the prompt prevents.

> [!note]
> This is why the freeze looked intermittent rather than constant. Codex throttles its update check through `~/.codex/version.json`, which records `latest_version`, `last_checked_at`, and `dismissed_version`. Inside the throttle window no check runs and no prompt appears, so a run right after a dismissal looks completely healthy. Once the window lapses and a newer release is actually published, every subsequent interactive launch blocks again. Reproducing the bug therefore requires both a genuinely pending release and an expired `last_checked_at`, and a "it works on my machine" test proves nothing unless both hold.

## Fix

Every interactive Codex launch command CC Relay builds now ends with the config override `-c check_for_update_on_startup=false`. Verified behaviorally on codex-cli 0.146.1 with a real pty and a genuinely pending 0.147.0: with the flag the TUI opens straight into the composer, without it the prompt blocks.

Three sites, all appended at the end of the command so placement stays identical:

- `CODEX_RELAY_COMMAND` in `src/project-launcher.mjs`, the connection-helper display and copy string.
- `codexRelayCommand()` in `src/project-launcher.mjs`, which builds both the fresh `codex ...` form and the `codex resume <id> ...` form. It feeds `terminalCommand()` for user Launchpad launches and the disposable pool launch path, so both inherit the flag from one place. The shared `CODEX_UPDATE_PROMPT_OVERRIDE` constant keeps the two forms from drifting apart.
- `status().launchCommand` in `src/codex-app-server.mjs`, which the connection helper renders and `plugin/relay-queue/scripts/relayctl.mjs` prints. It imports `CODEX_UPDATE_PROMPT_OVERRIDE` rather than repeating the literal, so the two cannot drift. The import direction is one way: `project-launcher.mjs` is a leaf that never imports `codex-app-server.mjs`, so its private `SHARED_CODEX_ENDPOINT` copy stays deliberately duplicated to keep it that way.

Two fallbacks feed the same `#launch-command` element when `/api/threads` has not resolved or has failed, and both were updated to match. The static text in `public/index.html` covers first paint, and the JavaScript fallback in `public/app.js` replaces that text on every render, so a copy taken before the status response lands is not a flagless command. Fixing only the static text would have left the flagless string reachable, because the render always overwrites it.

The README connection-helper commands, which a user copies by hand rather than from the UI, carry the override too.

`--remote` takes exactly one value, so a trailing `-c` flag cannot be swallowed by it, and no code path compares a recorded command against a rebuilt one, so the suffix change is safe.

## `codex exec` is unaffected

The update prompt is a TUI screen. `codex exec` is non-interactive, never renders it, and never blocks on it. Non-interactive `codex exec` usages such as the standup generator deliberately keep their normal update check and were not touched. Only the interactive forms that CC Relay opens in a native terminal need the override.

## Related

- [[project-terminal-settings]] for the project-scoped launch and layout settings that surround these commands.
- [[disposable-terminal-pools]] for the capacity reservation, launch, binding, and cleanup sequence this freeze stalled at the binding step.
- [[codex-sandbox-isolation]] for why the same launches carry `--dangerously-bypass-approvals-and-sandbox`.
