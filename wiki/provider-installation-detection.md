---
name: Provider Installation Detection
description: Automatic Codex and Claude CLI detection, conservative failure handling, and provider UI gating.
type: architecture
tags:
  - relay
  - providers
  - codex
  - claude
  - readiness
---

# Provider Installation Detection

Relay detects Codex and Claude independently in the background and exposes the result through `GET /api/status`. Each provider has separate installation and authentication state:

- `available: true` means the CLI executable answered its version probe.
- `authenticated: true` means the installed CLI also passed its authentication check.
- `pending: true` means the first probe has not finished.
- `reason: not_installed` is reserved for an executable-not-found failure.
- `reason: probe_failed` means the version check failed transiently or ambiguously.

> [!important]
> Only `not_installed` disables a provider. Pending and transiently failed probes remain neutral and retry automatically. This preserves the instant task-add and last-known-good rules in [[task-add-reliability]].

Codex version and login checks are intentionally separate. A successful `codex --version` followed by a failed `codex login status` remains installed and selectable, with a sign-in or authentication-check message. Claude follows the same installed-versus-authenticated distinction.

## Renderer behavior

In [[disposable-terminal-pools]] mode:

- A confirmed missing provider tab and its maximum-instance input are disabled.
- The tab says **Not installed**.
- An installed but signed-out provider remains enabled and says **Sign in required**.
- A pending or transiently failed probe says **Checking installation** and remains enabled.
- If the selected provider is confirmed missing and the other provider is installed, Relay selects the installed provider automatically.
- If both are missing, the selection stays stable while both provider choices are disabled.
- Direct Execute, Plan council, and Turbo submission are blocked only when one of their required CLIs is confirmed missing.
- Planner provider choices, reviewed-plan execution choices, and queued-task provider switching omit or disable confirmed missing alternatives.

Legacy live-terminal launch buttons use the same installation result.

## Refresh and activation

Claude refreshes its cached runtime status every 15 seconds. Codex refreshes every 30 seconds. The visible status snapshot refreshes while the app is open, so installing a CLI enables it without reloading the renderer.

When a later Codex probe becomes installed and authenticated, Relay starts or reconnects the shared Codex app-server and warms the model catalog. This covers installing or signing into Codex while Relay is already running.

## Files and coverage

- `src/codex-runtime-status.mjs`
- `src/claude-runtime-status.mjs`
- `src/server.mjs`
- `public/provider-availability.js`
- `public/app.js`
- `public/style.css`
- `test/codex-runtime-status.test.mjs`
- `test/claude-runtime-status.test.mjs`
- `test/provider-availability.test.mjs`
- `test/composer-workflows.test.mjs`

See [[disposable-terminal-pools]], [[task-add-reliability]], [[interface-layout]], and [[diagnostics]].

#relay #providers #codex #claude #readiness
