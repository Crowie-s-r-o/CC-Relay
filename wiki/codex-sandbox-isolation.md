---
name: Codex Sandbox Isolation
description: Prevent read-only planning turns from leaking into later writable Execute turns on the same Codex session.
type: architecture
---

# Codex Sandbox Isolation

Relay launches owned Codex terminals with `--dangerously-bypass-approvals-and-sandbox`. Normal Execute work must therefore receive full filesystem access, while Plan council reviews and Turbo planning must remain deliberately read-only.

## Failure

Codex app-server treats `turn/start.sandboxPolicy` as an override for the current turn and subsequent turns. Relay previously sent an explicit `readOnly` policy for planning, but omitted `sandboxPolicy` for normal Execute work. Resuming the thread with the legacy `sandbox: workspace-write` field did not reset the active policy in the observed Codex 0.145.0 session.

The result was sticky read-only state:

1. A Relay-owned terminal began with `danger-full-access`.
2. A planning turn changed the session to `read-only`.
3. Later ordinary Execute tasks logged `readOnly: false`.
4. Their rollout `turn_context` still recorded `sandbox_policy.type = read-only`.
5. Patch commands were rejected with writing blocked by the read-only sandbox.

Tasks 283 and 291 reproduced the failure on the same Documi thread. This proves the composer and task mode were not selecting read-only execution. The previous planning turn had contaminated later turns.

## Required dispatch contract

Every Codex turn must carry an explicit policy at both protocol boundaries:

| Relay stage | `thread/resume.sandbox` | `turn/start.sandboxPolicy` |
| --- | --- | --- |
| Normal Execute, follow-up, or Turbo worker | `danger-full-access` | `{ type: "dangerFullAccess" }` |
| Plan council review or Turbo planning | `read-only` | `{ type: "readOnly", networkAccess: false }` |

> [!important]
> Never omit `turn/start.sandboxPolicy` for a writable turn. Omission means inheritance, not a reset.

> [!note]
> The full-access value matches the native Relay launch command and existing terminal behavior. This change adds no environment variable and does not weaken planning stages.

## Verification

`test/codex-app-server.test.mjs` runs a read-only review followed by a normal Execute turn on the same fake connected thread. It asserts that the second resume and turn both switch back to full access. The ordinary Execute test also asserts the explicit policy.

The source change requires a normal Relay backend restart. Static browser refreshes cannot replace the in-memory Codex app-server client.

See [[project-workspaces]], [[plan-council]], [[turbo-execution]], and [[diagnostics]].

#relay #codex #sandbox #permissions #execution
