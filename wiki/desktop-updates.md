---
name: Desktop Updates
description: Packaged Electron update checks, release artifacts, and graceful installation behavior.
type: architecture
---

# Desktop Updates

CC Relay uses `electron-updater` with the GitHub publisher configured for `Crowie-s-r-o/CC-Relay`. The updater is deliberately an Electron-main-process concern. The localhost server, renderer, preload surface, and task API do not expose update controls or update state.

## Runtime contract

The coordinator in `src/desktop-updater.mjs` is dependency-injected and has no direct Electron imports. `src/electron-main.mjs` supplies the real `autoUpdater`, Electron `dialog`, the current app version, the main-window getter, and a graceful restart callback.

> [!important]
> Update checks run only when `app.isPackaged` is true and the runtime is either macOS or an installed Windows NSIS build. Development launches through `npm run desktop` do not check. The Windows portable executable is intentionally excluded and must be updated by downloading a newer portable artifact.

> [!important]
> `electron-updater` 6.8.9 is CommonJS and defines `autoUpdater` through a runtime property getter. Electron's ESM loader does not expose that getter as a named export. `src/electron-main.mjs` must default-import the package and destructure `autoUpdater` from that default object. A named import passes a source syntax check but crashes the packaged app before startup.

The lifecycle starts once, after `BrowserWindow.loadURL()` succeeds, and schedules one delayed `checkForUpdates()` call. Automatic download and automatic installation on quit are disabled. An available update displays a window-modal **Download** or **Later** choice. A downloaded update displays **Restart and install** or **Later**. No-update results, check failures, and download failures never show background error dialogs.

The coordinator ignores overlapping checks, downloads, and prompts. It also skips prompts when the main window is absent or destroyed. This keeps updater events safe during startup and shutdown.

## Embedded server startup

The desktop process does not assume ports `4768` and `4769` are free. It appends `--relay-port 0` and `--relay-codex-port 0` before importing `src/server.mjs`. The operating system assigns available loopback ports, `serverReady` returns the actual HTTP URL, and Electron loads that URL. The shared Codex proxy updates its advertised endpoint after binding, so copied and launched Codex commands use the actual port.

Standalone `npm start` retains fixed ports `4768` and `4769`. This split allows a packaged CC Relay to open while a development CC Relay is coordinating active tasks without changing the browser and local CLI contract.

Desktop lifecycle events are written to `relay-diagnostics.jsonl` under `app.getPath('userData')`. Startup records the data root and log path before importing the server. Window creation, load success or failure, renderer loss, child-process exit, second-instance activation, updater start, and graceful shutdown are recorded. A caught startup failure shows the same path in a native error box.

## Graceful installation

The restart callback sets the existing Electron `quitting` guard before awaiting `relayShutdown`. It calls `autoUpdater.quitAndInstall(false, true)` from a `finally` block. The `false` argument keeps the normal visible installer behavior, while `true` restarts the app after installation. The `finally` is required so a CC Relay shutdown error cannot strand an update that has already been downloaded. Because `quitting` is already set, Electron's `before-quit` handler does not attempt a second server shutdown.

The shared `relayShutdown` path also closes every native terminal launched by this CC Relay process before the backend and desktop process exit. It uses exact macOS Terminal window IDs and Windows process IDs, so an update restart does not leave CC Relay sessions running and does not close unrelated terminals. Normal application quit and update installation use the same cleanup contract.

> [!note]
> macOS installation only works for signed and notarized release builds. A locally built unsigned app can check or download only when the update feed is reachable, but macOS Gatekeeper will reject an unsigned release update.

## Release contract

The build configuration lives in [[../electron-builder.yml|electron-builder.yml]], the package metadata lives in [[../package.json|package.json]], and the native matrix plus GitHub release job live in [[../.github/workflows/build-desktop.yml|build-desktop.yml]]. The publisher is GitHub with owner `Crowie-s-r-o`, repository `CC-Relay`, and release type `release`.

> [!important]
> The product display name is `CC Relay`, but release artifact files use the hyphenated `CC-Relay-${version}-${os}-${arch}.${ext}` form. A space in `artifactName` produces files with spaces while `latest-mac.yml` normalizes its URLs to hyphens, leaving the update feed pointed at missing files. Keep the artifact name hyphenated and the bundle, DMG volume, menu, About item, and UI name spaced. See [[product-naming]].

> [!important]
> The native Crowie application icon comes from `build/icon.png`. Both `mac.icon` and `win.icon` point to that build resource, which electron-builder converts for the macOS bundle and Windows executables. `public/favicon.svg` controls only the renderer tab icon and cannot replace the Electron logo in the Dock, Finder, taskbar, or installed application.

> [!note]
> A native icon change is not hot-reloaded into an existing bundle. On July 28, 2026, the stale `dist/mac-arm64/CC Relay.app` still contained `electron.icns` after the favicon changed. A full macOS rebuild replaced it with `icon.icns`; the app bundle, ZIP, and DMG then carried the same icon hash, the DMG checksum passed, and strict code-signature verification passed. Rebuild and reopen the native app after changing `build/icon.png`.

Create a release from a clean `main` branch with:

```bash
npm run release -- auto
```

The local release command infers or accepts the Semantic Versioning bump, requires an isolated Codex or Claude CLI to generate compact notes, updates both package manifests and `CHANGELOG.md`, runs metadata checks, all tests, and the dependency audit, creates an annotated tag, then atomically pushes `main` and the tag. The resulting version contract remains:

```text
package.json version: 0.2.0
git tag:             v0.2.0
```

The release job rejects any tag, package, lockfile, changelog, or publisher mismatch before downloading or publishing artifacts. It extracts the matching AI-written changelog entry as the GitHub Release body. Each native build uploads its complete `dist/` directory, and the release job attaches those files to the tag release. The expected feed metadata and artifacts are:

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
- `src/server-options.mjs`: fixed standalone defaults plus validated desktop port flags.
- `src/server.mjs`: explicit readiness promise and actual bound HTTP endpoint.
- `src/codex-app-server.mjs`: actual shared proxy endpoint advertisement after dynamic binding.
- `src/diagnostics.mjs`: bounded JSONL persistence shared by Electron and the backend.
- `build/icon.png`: 1024px transparent Crowie source used for native application icons and the development Dock icon.
- `electron-builder.yml`: native targets, artifact names, update metadata generation, and GitHub publisher.
- `.github/workflows/build-desktop.yml`: native build matrix, tag/version guard, artifact upload, and GitHub release publishing.
- `scripts/release.mjs`: clean-tree checks, version selection, isolated AI generation, verification, commit, tag, and atomic push.
- `scripts/release-core.mjs`: deterministic SemVer, changelog normalization, formatting, and extraction helpers.
- `scripts/release-check.mjs` and `scripts/release-notes.mjs`: CI metadata enforcement and GitHub Release body extraction.
- `CHANGELOG.md`: canonical compact release history.
- `package.json` and `package-lock.json`: app version and `electron-updater` dependency.

No renderer IPC, preload permission, localhost route, or environment variable is required for updates. The existing `PORTABLE_EXECUTABLE_FILE` marker is read only to identify the Windows portable runtime; CC Relay does not create or mutate it.

## Troubleshooting

- **No check during development:** expected. Use a packaged build; `npm run desktop` is intentionally ineligible.
- **Portable Windows build does not update:** expected. Download the latest portable artifact manually or install the NSIS build for automatic updates.
- **No update after a tag:** confirm the tag is `vX.Y.Z`, the package version is `X.Y.Z`, and the GitHub release contains the platform's `latest-*.yml`, blockmaps, and installers.
- **macOS update will not install:** verify the release is signed and notarized and that the app was distributed from a compatible release channel.
- **Packaged startup reports that the `autoUpdater` named export is missing:** inspect `src/electron-main.mjs` and keep the CommonJS default-import interop described above.
- **Signing reports that `CC Relay.app` could not be found, or packaging reports `ENOTEMPTY` for `dist/mac-arm64`:** confirm that only one `electron-builder` process is running and that no app is running from the output bundle. Concurrent builds share and replace the same `dist/mac-arm64` directory, so one build can remove the bundle while another signs it.
- **Dock icon but no window:** inspect `relay-diagnostics.jsonl` for the `desktop.start.*`, `desktop.server.*`, `relay.listen.*`, and `desktop.window.*` sequence. Current builds use dynamic embedded ports and reject startup failures instead of waiting forever.
- **Update prompt appears without a window:** expected during teardown. The coordinator logs the condition and does not attempt a non-modal prompt.
- **SQLite or active tasks look interrupted after restart:** inspect the normal CC Relay shutdown diagnostics. The updater invokes the same `relayShutdown` callback used by Electron `before-quit` before installing.

See [[desktop-packaging-review]] for the July 27, 2026 packaged-runtime validation, [[project-workspaces]] for the embedded server lifecycle, and [[diagnostics]] for local shutdown and launch diagnostics.

#relay #desktop #updates #electron #release
