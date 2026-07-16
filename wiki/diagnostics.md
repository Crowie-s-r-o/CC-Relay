---
name: Relay Diagnostics
description: Persistent launch, proxy, discovery, enqueue, and Codex turn logging.
type: operations
---

# Relay Diagnostics

Relay writes structured JSONL diagnostics to `relay-diagnostics.jsonl` in the same data directory as `relay.sqlite`. Desktop builds therefore use Electron's per-user application data directory, while `npm start` writes under `.data/`.

The log records:

- Native terminal launch request and dispatch
- Shared proxy startup and client connection lifecycle
- Thread create, resume, join, discovery, and disconnection
- Task enqueue validation and rejection
- App-server requests, responses, failures, and timeouts
- Waiting for an active thread to become idle
- Thread resume, turn start, completion, and failure
- Queue task status changes

Prompts and model responses are intentionally excluded. IDs, workspace paths, status, provider, model, effort, and errors are included because they are necessary to diagnose terminal handoff failures.

The connection panel includes **Copy diagnostics**, which copies the latest 500 structured entries. The same data is available from `GET /api/diagnostics?limit=500`.

The file is capped operationally: after it exceeds 5 MB, Relay retains approximately the newest 2 MB. API reads inspect at most the newest 1 MB instead of loading the entire file.

> [!important]
> Diagnostics can contain local workspace paths and session identifiers. Review them before sharing outside the machine.

## Files

- `src/diagnostics.mjs`
- `src/server.mjs`
- `src/project-launcher.mjs`
- `src/websocket-proxy.mjs`
- `src/codex-app-server.mjs`
- `test/diagnostics.test.mjs`

#relay #diagnostics #terminal #codex #logging
