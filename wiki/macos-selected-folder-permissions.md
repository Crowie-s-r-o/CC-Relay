---
name: macOS Selected Folder Permissions
description: Why macOS attributes protected-folder prompts to CC Relay and why project selection is not an operating-system filesystem boundary.
type: diagnosis
tags:
  - relay
  - macos
  - permissions
  - sandbox
---

# macOS Selected Folder Permissions

> [!important]
> Selecting a Launchpad project currently chooses Relay's working directory and routing scope. It does not confine Relay, Codex, or Claude to that directory at the operating-system level.

## Verified package state

The installed 0.2.6 application at `/Applications/CC Relay.app` was inspected on August 13, 2026. Its signed entitlements include Electron hardened-runtime allowances, but not `com.apple.security.app-sandbox` or `com.apple.security.files.user-selected.read-write`. The package configuration in `electron-builder.yml` also has no App Sandbox entitlement file.

The current saved projects and recent native launch diagnostics all point below `~/WebstormProjects`. There were no saved projects in Documents, Music, iCloud Drive, or CloudStorage, and the live Relay process had no open files in those locations at inspection time. This rules out the saved Launchpad list as the direct explanation for the observed Documents prompt, although it cannot reconstruct a completed filesystem access.

## Likely prompt trigger

`ProjectLauncher.chooseFolder()` opens the macOS chooser by spawning `osascript` and evaluating AppleScript `choose folder`. It returns only the selected POSIX path. Relay then calls `realpathSync()` and `statSync()` on that path in its own process.

Apple documents that an app receives implicit consent when the selected URL is returned to that app through its `NSOpenPanel`. The current handoff instead gives the selected URL to the `osascript` process and gives Relay a plain string. Relay's later direct probe can therefore be treated as access without implied consent and macOS can show a protected-folder TCC prompt attributed to CC Relay. The generic prompt is also consistent with the installed `Info.plist`, which has no custom Documents folder usage description.

> [!note]
> This diagnosis is an inference from the source, Apple file-access rules, the live signature, and the saved project data. The user's TCC database was not readable without broader privacy authorization, so the historical responsible-access record could not be queried directly.

## Execution boundary

Normal Codex launches use `--dangerously-bypass-approvals-and-sandbox`, normal Claude launches use `--dangerously-skip-permissions`, and direct Codex turns receive `dangerFullAccess`. The providers also need their own state under `~/.codex` and `~/.claude`, while Relay stores application data in `~/Library/Application Support/dual-agent-orchestrator`.

Consequently, replacing the AppleScript picker with an application-owned native open panel would repair the user-consent handoff and should prevent unrelated protected-folder prompts caused by selection. It would not, by itself, enforce a selected-project-only execution boundary.

## Requirements for a complete fix

1. Present the directory chooser as a CC Relay-owned native `NSOpenPanel` and retain the selected URL or a security-scoped bookmark for later launches.
2. Define the unavoidable non-project storage explicitly, limited to Relay application data and provider-owned state.
3. Remove full-access provider launch policies for ordinary work and apply a project-scoped execution policy to every direct, continuation, council, and Turbo path.
4. Prove that Terminal-mediated provider launches cannot escape that policy. Sandboxing only the Electron main process does not constrain a command that Terminal.app launches outside that sandbox.
5. Add packaged macOS tests for Documents, Music, iCloud Drive, an ordinary home folder, restart persistence, denial, and an attempted read outside the selected project.

> [!warning]
> Simply adding `com.apple.security.app-sandbox` will break current behavior. Apple restricts a sandboxed app from executing programs outside its bundle, while Relay currently discovers and starts separately installed Codex and Claude binaries and controls Terminal.app through Apple Events. The execution architecture and entitlements must be designed together.

## Primary references

- [Apple: Accessing files from the macOS App Sandbox](https://developer.apple.com/documentation/Security/accessing-files-from-the-macos-app-sandbox)
- [Apple: NSDocumentsFolderUsageDescription](https://developer.apple.com/documentation/bundleresources/information-property-list/nsdocumentsfolderusagedescription)
- [Apple: NSOpenPanel](https://developer.apple.com/documentation/appkit/nsopenpanel)
- [Electron: dialog](https://www.electronjs.org/docs/latest/api/dialog)

Related: [[project-workspaces]], [[codex-sandbox-isolation]], [[claude-launch-settings]], [[desktop-packaging-review]], [[diagnostics]]
