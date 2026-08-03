---
name: Dual Backend Ownership Guard
description: Cross-process terminal launch ownership in the shared configuration database, so two live CC Relay backends can no longer adopt or close each other's terminals.
type: architecture
tags:
  - relay
  - terminal
  - ownership
  - desktop
  - sqlite
---

# Dual Backend Ownership Guard

A packaged desktop CC Relay and a standalone `node src/server.mjs` can run at the same time. Both discover the same live sessions, because Codex discovery reads the shared app-server and Claude discovery reads `claude agents --json` for the whole machine. Launch ownership, however, used to live only in one process's memory.

The result was a fight over one native terminal.

| Time (UTC) | Process | Event |
| --- | --- | --- |
| 2026-08-03T11:20:57 | Desktop app | Launched and bound a Claude terminal for its own task 90. |
| 2026-08-03T11:21:02.278 | Standalone backend | `terminal.session.bound` with `ownershipSource: "runtime"`, then `terminal.recovery.completed` for launch `runtime-7276b3a0-…`, thread `eda117ec-…`, tty `/dev/ttys018`. |

Two processes then held a claim on one window. Whichever acted first could close a terminal the other still needed, which the user experiences as terminals randomly closing and reopening. [[resume-dispatch-audit]] recorded the same fight on July 30 and closed it with "run one backend at a time". Running both is normal here, so per-process ownership had to become cross-process aware.

## Where adoption happens

`ProjectLauncher.recoverConnectedTerminals()` in `src/project-launcher.mjs` is the only path that produces `ownershipSource: "runtime"`. It runs on every `GET /api/threads` poll, roughly every four seconds, for any discovered session this process has no owned launch for. `TerminalRuntimeResolver` proves the native window, and the launcher then tracks and binds it exactly like a launch it made itself.

Everything downstream trusts that record: `verifyTerminalForThread()`, `refreshTerminalRuntimeIdentity()`, terminal attention, `closeOwnedTerminal()`, and `DisposableTerminalPool.release()`.

## Registry

The registry lives in the per-user `relay-config.sqlite` described by [[shared-project-configuration]], the one file both backends already hold open. It adds two tables and changes nothing existing.

```sql
CREATE TABLE relay_backends (
  instance_id TEXT PRIMARY KEY,   -- one UUID per process run
  pid INTEGER NOT NULL,
  start_token TEXT,               -- `ps -p <pid> -o lstart=`, null where unavailable
  role TEXT,                      -- 'desktop' or 'localhost'
  data_root TEXT,
  started_at INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL
);

CREATE TABLE terminal_launch_owners (
  instance_id TEXT NOT NULL,
  launch_id TEXT NOT NULL,
  owner_pid INTEGER NOT NULL,
  provider TEXT NOT NULL,
  project_path TEXT,
  thread_id TEXT,                 -- null until the launch binds its conversation
  expected_thread_id TEXT,
  terminal_window_id INTEGER,
  terminal_process_id INTEGER,
  runtime_process_id INTEGER,
  terminal_tty TEXT,
  ownership_source TEXT,          -- 'launch' or 'runtime'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (instance_id, launch_id)
);
```

The launch row carries `owner_pid` for diagnostics and joins `relay_backends` on `instance_id` for the start token and heartbeat, so a heartbeat is one row update no matter how many terminals a backend owns. A launch row whose backend row is gone can never be verified again, so it is pruned rather than left to block adoption forever.

Ownership is written by the lifecycle methods, never by command construction:

| Launcher method | Registry effect |
| --- | --- |
| `trackOwnedTerminal()` | Insert the claim, including the native window, process, and tty already known. |
| `bindOwnedTerminal()` | Set `thread_id` once the exact provider session is proven. |
| `refreshTerminalRuntimeIdentity()` | Update `terminal_tty` and `runtime_process_id`. |
| `forgetTrackedTerminal()` | Delete the claim. |
| `closeOwnedTerminals()` | Delete every claim this process holds. |

`LaunchOwnershipRegistry.start()` runs from the `server.listen` callback, not at module load, so a start that fails on a busy port never leaves a claim another backend would have to time out. It inserts its backend row before its first `await`, because reading a start token spawns `ps` and `queue.start()` runs in the same tick: a launch recorded during that await would look like an orphan claim the other backend prunes and then adopts. The token is written by a follow-up update, and until it lands that backend is judged live by its heartbeat. `stop()` runs in `shutdown()` after the launcher has closed its own terminals.

## Liveness rules

> [!important]
> Darwin 25 accepts `pgrep -t` and `pkill -t` and matches nothing, as recorded in [[terminal-close-review]]. No liveness rule here may depend on a TTY filter.

A foreign backend counts as LIVE when, in order:

1. `process.kill(pid, 0)` succeeds. `EPERM` counts as alive, `ESRCH` counts as dead.
2. Its start token still matches. The token is `ps -p <pid> -o lstart=` with whitespace collapsed, read the same way by every backend, and cached for five seconds per pid. A recycled identifier therefore reads as dead, so pid reuse cannot spoof a live owner.
3. Where no start token exists, on Windows or when `ps` fails, the heartbeat decides: a backend heartbeats every 15 seconds and counts as live for 90 seconds.

> [!important]
> Every `ps` token read pins `LC_ALL=C`, `LANG=C`, and `TZ=UTC`. `lstart` formats through the caller's locale and time zone, and a desktop app started from Finder inherits neither while a shell-launched backend usually exports both. Measured on Darwin 25.5.0, one live process reads as `Mon Aug 3 12:10:10 2026` pinned, `Mo. 3 Aug. 14:10:10 2026` under `de_DE`, and `Mon Aug 3 14:10:10 2026` with no locale but the local zone: different format and a different hour. A token mismatch outranks the heartbeat and means dead, so an unpinned read would make two live backends judge each other dead, silently disable this entire guard, and let `pruneDeadOwners()` delete the live owner's claims. The pinned environment is not a tidiness choice, it is what makes the token comparable at all.

A verified token outranks the heartbeat, so a busy or paused backend is never mistaken for a dead one. Only the `dualBackendDetected` status flag uses the cheaper synchronous rule of pid alive plus recent heartbeat, and that flag never authorizes a terminal action.

## Skip semantics

Before adopting, rebinding, or closing any launch the current process did not create in memory, the launcher consults the registry. A claim is foreign when its `instance_id` differs and it matches on any of, in order of precedence:

1. `thread_id` equals the conversation, reported as `conversation`.
2. `expected_thread_id` equals the conversation, reported as `expected-conversation`.
3. The native window, terminal process, runtime process, or tty matches, reported as `native-terminal`.
4. The claim has no `thread_id` yet, was created within the last 60 seconds, and its provider and project path match, reported as `pending-launch`. This is the cross-process form of the in-memory `pendingLaunchMatches()` exclusion, and it covers the seconds between a foreign launch and its binding.

> [!important]
> Rule 4 applies to adoption only. It identifies no particular terminal, just a provider and a project, so `verifyTerminalForThread()` and `closeTrackedTerminalNow()` pass `includePendingClaims: false` and respect only rules 1 through 3. Without that scoping, a foreign backend's binding window would make an unrelated terminal this process already adopted and proved briefly unverifiable and unclosable, which the user would read as a failed Close with the native-identity dialog.

> [!important]
> Rule 4 is the only rule with an age bound, and it needs one. The in-memory exclusion is naturally bounded because it lives in memory a process eventually forgets. A row is not: a launch whose native close failed is retained by `DisposableTerminalPool.release()` and never forgotten, so it would stay unbound while its backend keeps running and lock that provider and project for the other backend forever. The exact native identity of such a row still applies for as long as the row exists, which is the part that actually protects a real terminal.

| Guarded path | Behavior when a live foreign owner exists |
| --- | --- |
| `recoverConnectedTerminals()` | Skip the candidate, record `terminal.recovery.skipped_foreign_owner` with `foreignPid`, and never track or bind it. |
| `verifyTerminalForThread()` | Release the local adoption, record the same event with `stage: "verify"`, and answer false, so `TerminalCloseCoordinator` refuses the close. |
| `closeTrackedTerminalNow()` | Release the local adoption, record `terminal.close.skipped_foreign_owner`, and throw before any `osascript`, `kill`, or `taskkill.exe` runs. |

`TerminalCloseCoordinator.close()` calls `verifyTerminalForThread()` first, so a user closing a contested terminal from the interface normally reads the existing "The terminal process or native window changed" message. The close guard is the backstop for every other caller, including `DisposableTerminalPool.release()`, and its clearer "belongs to another running CC Relay backend" wording is what reaches an event log rather than that dialog.

`requestTerminalAttentionNow()` is deliberately not guarded. Raising and centering a window is not destructive, and it already refuses any terminal whose live native identity does not match. If it ever gains a destructive step, it needs the same check.

Only an adoption is ever released this way. A launch this process started natively is proven its own by the native launch itself, so `ownershipSource: "launch"` is never surrendered.

Two backends can poll discovery in the same instant. Adoption therefore checks twice: once before it writes its claim, and once after, with `precedingLaunchId`. The second check only yields to a claim written earlier, using `created_at` with `instance_id` as the tie-break, so exactly one of two racing backends yields instead of both or neither.

## Degradation

The registry is advisory. Every read and write is isolated, and any failure falls back to the previous single-process behavior:

- A missing, locked, read-only, or older shared database means `foreignOwner()` answers null, so adoption, recovery, and cleanup behave exactly as before.
- The first failure of each operation is recorded once as `launch.registry.failed`, and a failed call inside the launcher is recorded as `terminal.ownership.registry_failed`. Neither ever propagates into a launch or a cleanup.
- A launcher built without a registry, which is every unit test and any embedder, keeps the historical behavior with no guard at all.
- Single-backend crash recovery is unchanged. A dead owner's rows are pruned at the next start and treated as dead by the guard in the meantime, so a restarted backend still adopts and cleans up the terminals its predecessor left behind.
- One accepted false positive, on adoption only: while a backend is binding a launch in project P, the other backend skips adoption of an unrelated terminal a user launched by hand in P. `recoveryRetryAt` was already set to 15 seconds before the resolve, so that session takes roughly 15 to 19 seconds to become owned instead of 4. It is bounded and self-healing, and the alternative is the terminal fight this page exists to end. Verification and closing are not affected, because rule 4 is scoped out of both.

## Known limitation

The native identity rules have no age bound, deliberately. A claim whose native close failed is retained by `DisposableTerminalPool.release()` rather than forgotten, because that terminal may genuinely still be open, and the claim keeps protecting it. If the operating system later recycles that window identifier, tty, or process identifier for a different terminal, the other backend will decline to adopt the new one for as long as the owning backend lives.

No time bound fixes this safely. A backend legitimately owns one terminal for the whole length of a long task without ever refreshing its identity, so treating an old, never-refreshed row as stale would hand exactly those terminals back to the other process and reopen the original defect. The correct fix is narrower and belongs to cleanup: drop the claim once the terminal is proven gone. Until then, an over-cautious skip is the safe direction to fail, and `terminal.recovery.skipped_foreign_owner` names the foreign pid in diagnostics so this is recognizable rather than mysterious.

## Status exposure

`GET /api/status` reports `capabilities.crossProcessLaunchOwnership` and `dualBackendDetected`. The flag is true when another backend is heartbeating and its identifier is still taken. Terminal ownership is correct either way; the flag exists only so the interface can say so later. No renderer work was built for it.

## Coverage

`test/launch-ownership-registry.test.mjs` proves the live-foreign-owner skip with its diagnostics event and foreign pid, adoption of a dead owner's launch, adoption despite a stale heartbeat when the process is gone, a reused identifier with a mismatched start token treated as dead, the pending foreign launch exclusion, its 60 second bound, and its scoping out of verification and closing, the pinned `LC_ALL`, `LANG`, and `TZ` on every token read through both the exported helper and the registry's own reader, the token-free heartbeat liveness rule in both directions across a real `heartbeat()` call, degradation on a throwing registry and on a closed database, the close and verify guards, that a backend never blocks itself, the earlier-claim tie-break, dual backend detection, and additive migration of an older shared configuration database that an older backend then reopens unharmed. Process liveness is faked in every test; no test inspects a real CC Relay process and none launches a terminal.

## Implementation

- `src/launch-ownership-registry.mjs`
- `src/project-launcher.mjs`
- `src/server.mjs`
- `test/launch-ownership-registry.test.mjs`

See [[resume-dispatch-audit]], [[disposable-terminal-pools]], [[shared-project-configuration]], [[terminal-close-review]], and [[diagnostics]].

#relay #terminal #ownership #desktop #sqlite
