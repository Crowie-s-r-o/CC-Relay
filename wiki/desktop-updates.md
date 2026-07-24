---
name: Desktop Updates
description: Packaged Electron update checks, release artifacts, and graceful installation behavior.
type: architecture
---

# Desktop Updates

Relay uses `electron-updater` with the GitHub publisher configured for `patrikkelemen/relay`. The updater is deliberately an Electron-main-process concern. The localhost server, renderer, preload surface, and task API do not expose update controls or update state.

## Runtime contract

The coordinator in `src/desktop-updater.mjs` is dependency-injected and has no direct Electron imports. `src/electron-main.mjs` supplies the real `autoUpdater`, Electron `dialog`, the current app version, the main-window getter, and a graceful restart callback.

> [!important]
> Update checks run only when `app.isPackaged` is true and the runtime is either macOS or an installed Windows NSIS build. Development launches through `npm run desktop` do not check. The Windows portable executable is intentionally excluded and must be updated by downloading a newer portable artifact.

The lifecycle starts once, after `BrowserWindow.loadURL()` succeeds, and schedules one delayed `checkForUpdates()` call. Automatic download and automatic installation on quit are disabled. An available update displays a window-modal **Download** or **Later** choice. A downloaded update displays **Restart and install** or **Later**. No-update results, check failures, and download failures never show background error dialogs.

The coordinator ignores overlapping checks, downloads, and prompts. It also skips prompts when the main window is absent or destroyed. This keeps updater events safe during startup and shutdown.

## Graceful installation

The restart callback sets the existing Electron `quitting` guard before awaiting `relayShutdown`. It calls `autoUpdater.quitAndInstall(false, true)` from a `finally` block. The `false` argument keeps the normal visible installer behavior, while `true` restarts the app after installation. The `finally` is required so a Relay shutdown error cannot strand an update that has already been downloaded. Because `quitting` is already set, Electron's `before-quit` handler does not attempt a second server shutdown.

The shared `relayShutdown` path also closes every native terminal launched by this Relay process before the backend and desktop process exit. It uses exact macOS Terminal window IDs and Windows process IDs, so an update restart does not leave Relay sessions running and does not close unrelated terminals. Normal application quit and update installation use the same cleanup contract.

> [!note]
> macOS installation only works for signed and notarized release builds. A locally built unsigned app can check or download only when the update feed is reachable, but macOS Gatekeeper will reject an unsigned release update.

## Release contract

The build configuration lives in [[../electron-builder.yml|electron-builder.yml]], the package metadata lives in [[../package.json|package.json]], and the native matrix plus GitHub release job live in [[../.github/workflows/build-desktop.yml|build-desktop.yml]]. The publisher is GitHub with owner `patrikkelemen`, repository `relay`, and release type `release`.

Create a release by pushing a tag whose version exactly matches `package.json`, for example:

```text
package.json version: 0.2.0
git tag:             v0.2.0
```

The release job rejects a mismatch before downloading or publishing artifacts. Each native build uploads its complete `dist/` directory, and the release job attaches those files to the tag release. The expected feed metadata and artifacts are:

| Platform | Update metadata | Installable artifacts |
| --- | --- | --- |
| macOS | `latest-mac.yml` plus DMG and ZIP blockmaps | DMG and ZIP |
| Windows NSIS | `latest.yml` plus NSIS blockmaps | NSIS installer |
| Windows portable | no automatic feed use | portable executable for manual download |

> [!important]
> Keep `latest-mac.yml`, `latest.yml`, blockmaps, DMG, ZIP, NSIS, and portable artifacts in the GitHub release. The updater needs the metadata and blockmaps to calculate and download differential updates. The portable executable is distributed in the release but is not an automatic-update target.

Signing credentials are not stored in the repository. Production macOS releases need Apple Developer signing and notarization. Production Windows NSIS releases need a trusted code-signing certificate. Local directory builds and unsigned CI builds are useful for packaging validation but are not suitable for public update installation.

## Files involved

- `src/desktop-updater.mjs`: Electron-independent lifecycle coordinator and manual prompt policy.
- `src/electron-main.mjs`: packaged-build eligibility, delayed startup, and graceful install handoff.
- `electron-builder.yml`: native targets, artifact names, update metadata generation, and GitHub publisher.
- `.github/workflows/build-desktop.yml`: native build matrix, tag/version guard, artifact upload, and GitHub release publishing.
- `package.json` and `package-lock.json`: app version and `electron-updater` dependency.

No renderer IPC, preload permission, localhost route, or environment variable is required for updates. The existing `PORTABLE_EXECUTABLE_FILE` marker is read only to identify the Windows portable runtime; Relay does not create or mutate it.

## Troubleshooting

- **No check during development:** expected. Use a packaged build; `npm run desktop` is intentionally ineligible.
- **Portable Windows build does not update:** expected. Download the latest portable artifact manually or install the NSIS build for automatic updates.
- **No update after a tag:** confirm the tag is `vX.Y.Z`, the package version is `X.Y.Z`, and the GitHub release contains the platform's `latest-*.yml`, blockmaps, and installers.
- **macOS update will not install:** verify the release is signed and notarized and that the app was distributed from a compatible release channel.
- **Update prompt appears without a window:** expected during teardown. The coordinator logs the condition and does not attempt a non-modal prompt.
- **SQLite or active tasks look interrupted after restart:** inspect the normal Relay shutdown diagnostics. The updater invokes the same `relayShutdown` callback used by Electron `before-quit` before installing.

See [[project-workspaces]] for the embedded server lifecycle and [[diagnostics]] for local shutdown and launch diagnostics.

#relay #desktop #updates #electron #release
