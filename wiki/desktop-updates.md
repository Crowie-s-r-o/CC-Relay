---
name: Desktop Updates
description: Packaged Electron update checks, release artifacts, and graceful installation behavior.
type: architecture
---

# Desktop Updates

CC Relay checks for public `Crowie-s-r-o/CC-Relay` GitHub releases from packaged macOS and Windows builds. macOS DMG and Windows portable builds use the fixed latest-release API for manual discovery, while installed Windows NSIS builds use `electron-updater` for discovery, download, and installation. A sanitized, read-only update state crosses the embedded loopback status API so the renderer can show a compact release indicator; the renderer has no update control or privileged Electron surface.

## Runtime contract

The coordinator in `src/desktop-updater.mjs` is dependency-injected and has no direct Electron imports. `src/electron-main.mjs` supplies the GitHub release checker, the real `autoUpdater`, Electron `dialog`, the current app version, the main-window getter, and a graceful restart callback.

> [!important]
> Release discovery runs only when `app.isPackaged` is true and the platform is macOS or Windows. macOS DMG installations and Windows portable executables discover new versions but update manually from GitHub Releases. Only an installed Windows NSIS build starts `electron-updater` and offers in-app download and restart installation. Development launches through `npm run desktop` do not check.

> [!important]
> `electron-updater` 6.8.9 is CommonJS and defines `autoUpdater` through a runtime property getter. Electron's ESM loader does not expose that getter as a named export. `src/electron-main.mjs` must default-import the package and destructure `autoUpdater` from that default object. A named import passes a source syntax check but crashes the packaged app before startup.

The lifecycle starts once, after `BrowserWindow.loadURL()` succeeds. It schedules one delayed check and a recurring check every five minutes. The recurring timer is unreferenced so it cannot keep a test or process alive by itself, and an injected interval is capped at five minutes so callers cannot silently weaken the cadence. Checks remain overlap-safe and pause while a Windows download is active or installation is ready.

`src/desktop-release-discovery.mjs` requests GitHub's fixed latest stable release endpoint with a ten-second timeout, validates the tag as three-part SemVer, rejects drafts and prereleases, and constructs the trusted release URL locally. Numeric version comparison prevents equal or older releases from producing an indicator. This path does not depend on `latest-mac.yml`, a ZIP payload, or renderer networking.

Automatic download and automatic installation on quit are disabled. On installed Windows, an available update displays a window-modal **Download** or **Later** choice, and a downloaded update displays **Restart and install** or **Later**. Recurring discovery remembers the version already offered, so choosing **Later** does not reopen the same native prompt every five minutes; a genuinely newer version can prompt once. On macOS and Windows portable, discovery publishes the header indicator without starting `electron-updater` or showing a misleading native download prompt. No-update results, check failures, and download failures never show background error dialogs.

`createDesktopUpdater` publishes `unsupported`, `checking`, `current`, `available`, `downloading`, `downloaded`, `installing`, and `error` snapshots plus an `automaticUpdate` capability flag. Electron forwards those snapshots through `setDesktopUpdateState`; `/api/status.desktopUpdate` returns only normalized versions, the capability flag, bounded progress, and a URL restricted to this repository's GitHub Releases path. The header stays hidden unless a valid newer version is known. It then becomes a compact status button that shows download progress or marks the update ready. Activating it opens an in-app details dialog with the installed-to-latest version route, bounded progress, the five-minute cadence, and the trusted release link. Manual platforms say **Download vX.Y.Z** and explain DMG or portable installation; Windows NSIS keeps user-confirmed native download and restart prompts. The renderer remains read-only.

> [!note]
> The version route is the update dialog's visual signature: two compact release stations connected by one relay arrow. Light and dark themes share the same hierarchy, the dialog fits a 500 pixel viewport without page overflow, keyboard focus stays native to `<dialog>`, and progress motion is removed under `prefers-reduced-motion`.

The coordinator ignores overlapping checks, downloads, and prompts. It also skips prompts when the main window is absent or destroyed. This keeps updater events safe during startup and shutdown.

## Embedded server startup

The desktop process does not assume ports `4768` and `4769` are free. It appends `--relay-port 0` and `--relay-codex-port 0` before importing `src/server.mjs`. The operating system assigns available loopback ports, `serverReady` returns the actual HTTP URL, and Electron loads that URL. The shared Codex proxy updates its advertised endpoint after binding, so copied and launched Codex commands use the actual port.

Standalone `npm start` retains fixed ports `4768` and `4769`. This split allows a packaged CC Relay to open while a development CC Relay is coordinating active tasks without changing the browser and local CLI contract.

Desktop lifecycle events are written to `relay-diagnostics.jsonl` under `app.getPath('userData')`. Startup records the data root and log path before importing the server. Window creation, load success or failure, renderer loss, child-process exit, second-instance activation, updater start, and graceful shutdown are recorded. A caught startup failure shows the same path in a native error box.

## Graceful installation

The restart callback sets the existing Electron `quitting` guard before awaiting `relayShutdown`. It calls `autoUpdater.quitAndInstall(false, true)` from a `finally` block. The `false` argument keeps the normal visible installer behavior, while `true` restarts the app after installation. The `finally` is required so a CC Relay shutdown error cannot strand an update that has already been downloaded. Because `quitting` is already set, Electron's `before-quit` handler does not attempt a second server shutdown.

The shared `relayShutdown` path also closes every native terminal launched by this CC Relay process before the backend and desktop process exit. It uses exact macOS Terminal window IDs and Windows process IDs, so an update restart does not leave CC Relay sessions running and does not close unrelated terminals. Normal application quit and update installation use the same cleanup contract.

> [!note]
> macOS releases are DMG-only and update through a manual DMG download. `electron-updater` requires a ZIP payload for Squirrel.Mac, so removing the ZIP also means macOS must not start the automatic updater and fail against a feed with no compatible ZIP payload. Electron-builder 26.15.3 still writes a DMG-only `latest-mac.yml`, but the workflow deliberately does not publish that unusable feed.

> [!important]
> Version 0.2.3 exposed an eligibility split incorrectly. The coordinator's default rule had removed macOS from `electron-updater`, but `src/electron-main.mjs` supplied an explicit `isEligible` callback that still included Darwin and overrode the default. The live packaged app therefore requested the deliberately unpublished `latest-mac.yml`, entered `error` with `latestVersion: null`, and the header correctly hid a failure that knew no newer version. Keep release discovery eligibility separate from automatic-update eligibility. A DMG-only release must use the GitHub API path, never Squirrel.Mac.

## Release contract

The build configuration lives in [[../electron-builder.yml|electron-builder.yml]], the package metadata lives in [[../package.json|package.json]], and the native matrix plus GitHub release job live in [[../.github/workflows/build-desktop.yml|build-desktop.yml]]. The publisher is GitHub with owner `Crowie-s-r-o`, repository `CC-Relay`, and release type `release`.

> [!important]
> The product display name is `CC Relay`, but release artifact files stay hyphenated. macOS publishes `CC-Relay-${version}-${os}-${arch}.dmg`. Windows adds `-Setup` for NSIS and `-Portable` for the manual executable so two `.exe` targets cannot overwrite each other. A space in `artifactName` produces files with spaces while update metadata normalizes URLs to hyphens, leaving the feed pointed at missing files. Keep artifact names hyphenated and the bundle, DMG volume, menu, About item, and UI name spaced. See [[product-naming]].

> [!important]
> The native Crowie application icon comes from `build/icon.png`. Both `mac.icon` and `win.icon` point to that build resource, which electron-builder converts for the macOS bundle and Windows executables. `public/favicon.svg` controls only the renderer tab icon and cannot replace the Electron logo in the Dock, Finder, taskbar, or installed application.

> [!note]
> A native icon change is not hot-reloaded into an existing bundle. On July 28, 2026, the stale `dist/mac-arm64/CC Relay.app` still contained `electron.icns` after the favicon changed. A full macOS rebuild replaced it with `icon.icns`; the app bundle, ZIP, and DMG then carried the same icon hash, the DMG checksum passed, and strict code-signature verification passed. Rebuild and reopen the native app after changing `build/icon.png`.

Create a release from a clean `main` branch with:

```bash
npm run deploy
```

The local deploy command infers or accepts the Semantic Versioning bump, requires an isolated Codex or Claude CLI to generate compact notes, updates both package manifests and `CHANGELOG.md`, runs metadata checks, all tests, and the dependency audit, creates an annotated tag, then atomically pushes `main` and the tag. The resulting version contract remains:

```text
package.json version: 0.2.0
git tag:             v0.2.0
```

> [!important]
> Deploy does not stop at the push. It polls the GitHub REST API through the maintainer's `gh` credential, selects the desktop build run for the pushed tag by head SHA plus tag head branch, and exits non-zero with the failing run URL when GitHub publishes no release. Silence after a successful push used to mean the release page stayed empty; `npm run deploy` is now the only command a maintainer needs, and its exit status is the truth about whether a release exists. `--no-watch` returns the old push-and-stop behavior, and an unavailable or unauthenticated `gh` degrades to a printed release URL rather than a hard failure.

> [!important]
> The desktop build workflow runs `npm test` on the macOS matrix entry only. CC Relay is validated on macOS, and the suite simulates Windows paths, shims, and `cmd.exe` invocation from POSIX, so 75 of those cases fail on a real Windows runner. Because the release job declares `needs: build`, a red Windows job silently skipped publication: that is exactly why `v0.2.0` was tagged and pushed with no GitHub Release. The Windows job remains packaging verification. Do not paper over a red job with `continue-on-error`; `fail_on_unmatched_files: true` would then trip on the missing installer.

The release job rejects any tag, package, lockfile, changelog, publisher, or Windows target-name mismatch before downloading or publishing artifacts. It extracts the matching AI-written changelog entry as the GitHub Release body. Native builds upload only packaged deliverables from `dist/`; unpacked application directories and builder diagnostics never become release assets. The expected feed metadata and artifacts are:

| Platform | Update metadata | Installable artifacts |
| --- | --- | --- |
| macOS | none; manual update | DMG |
| Windows NSIS | `latest.yml` plus NSIS blockmaps | NSIS installer |
| Windows portable | no automatic feed use | portable executable for manual download |

> [!important]
> Keep `latest.yml`, blockmaps, DMG, NSIS, and portable artifacts in the GitHub release. The installed Windows updater needs its metadata and blockmap to calculate and download differential updates. The DMG and portable executable are manual downloads. GitHub adds its own source-code ZIP and tarball automatically; those are not desktop packages.

Signing credentials are not stored in the repository. Production macOS releases need Apple Developer signing and notarization. Production Windows NSIS releases need a trusted code-signing certificate. Local directory builds and unsigned CI builds are useful for packaging validation but are not suitable for public update installation.

## Files involved

- `src/desktop-updater.mjs`: Electron-independent lifecycle coordinator and manual prompt policy.
- `src/desktop-release-discovery.mjs`: fixed GitHub latest-release request, stable version validation, and numeric version comparison.
- `src/desktop-update-status.mjs`: pure normalization for versions, progress, states, and trusted release URLs.
- `src/electron-main.mjs`: packaged-build eligibility, delayed startup, and graceful install handoff.
- `src/server-options.mjs`: fixed standalone defaults plus validated desktop port flags.
- `src/server.mjs`: explicit readiness promise, actual bound HTTP endpoint, and sanitized desktop update status.
- `public/desktop-update-state.js`: pure header and dialog copy, version, progress, and trusted-link presentation.
- `public/index.html`, `public/app.js`, and `public/style.css`: accessible update trigger, details dialog, responsive route, and light and dark presentation.
- `src/codex-app-server.mjs`: actual shared proxy endpoint advertisement after dynamic binding.
- `src/diagnostics.mjs`: bounded JSONL persistence shared by Electron and the backend.
- `build/icon.png`: 1024px transparent Crowie source used for native application icons and the development Dock icon.
- `electron-builder.yml`: native targets, artifact names, update metadata generation, and GitHub publisher.
- `.github/workflows/build-desktop.yml`: native build matrix, tag/version guard, artifact upload, and GitHub release publishing.
- `scripts/deploy.mjs`: clean-tree checks, version selection, isolated AI generation, verification, commit, tag, atomic push, and the GitHub Release watch that fails loudly when publication does not happen.
- `scripts/release-core.mjs`: deterministic SemVer, changelog normalization, formatting, extraction helpers, and the pure workflow-run selection and publication-status decisions that deploy polls with.
- `scripts/release-check.mjs` and `scripts/release-notes.mjs`: CI metadata enforcement and GitHub Release body extraction.
- `CHANGELOG.md`: canonical compact release history.
- `package.json` and `package-lock.json`: app version and `electron-updater` dependency.

No renderer IPC, preload permission, writable update route, or environment variable is required for updates. The existing `PORTABLE_EXECUTABLE_FILE` marker is read only to identify the Windows portable runtime; CC Relay does not create or mutate it.

## Troubleshooting

- **No check during development:** expected. Use a packaged build; `npm run desktop` is intentionally ineligible.
- **No header indicator:** expected in development, while the packaged app is current, while its check is still running, or when GitHub release discovery is unavailable. A valid newer version is required before the link appears on macOS, Windows NSIS, and Windows portable builds.
- **Portable Windows build does not update:** expected. Download the latest portable artifact manually or install the NSIS build for automatic updates.
- **No update after a tag:** confirm the tag is `vX.Y.Z`, the package version is `X.Y.Z`, and a stable GitHub Release exists. Windows automatic installation additionally requires `latest.yml`, its blockmap, and the NSIS installer. macOS discovery does not require `latest-mac.yml`.
- **The tag is pushed but the Releases page is empty:** the desktop build workflow failed, so `needs: build` skipped the release job. Open the run that deploy names in its failure message. A tag whose run already failed cannot be recovered by re-running the workflow, because the dispatch uses the workflow file at that ref; release the fix under the next version instead of retagging.
- **The atomic push fails with `Permission ... denied` and HTTP 403:** GitHub authenticated the named HTTPS user but that identity lacks effective write permission. The commit author and committer do not select the GitHub account used for a push; the credential-helper identity named in the remote error is authoritative. Confirm the active identity with `gh auth status -h github.com` and the repository grant with `gh repo view Crowie-s-r-o/CC-Relay --json viewerPermission`. A `READ` result requires the organization or repository owner to restore a direct or team `Write` grant. If GitHub already shows that grant, refresh the GitHub CLI credential and its organization SSO authorization before retrying. Atomic push failure leaves both the remote branch and tag unchanged, while the verified local release commit and annotated tag remain available for the exact retry documented by `deploy`.
- **macOS needs an update:** download the latest DMG from GitHub Releases and replace the installed application manually.
- **Packaged startup reports that the `autoUpdater` named export is missing:** inspect `src/electron-main.mjs` and keep the CommonJS default-import interop described above.
- **Signing reports that `CC Relay.app` could not be found, or packaging reports `ENOTEMPTY` for `dist/mac-arm64`:** confirm that only one `electron-builder` process is running and that no app is running from the output bundle. Concurrent builds share and replace the same `dist/mac-arm64` directory, so one build can remove the bundle while another signs it.
- **Dock icon but no window:** inspect `relay-diagnostics.jsonl` for the `desktop.start.*`, `desktop.server.*`, `relay.listen.*`, and `desktop.window.*` sequence. Current builds use dynamic embedded ports and reject startup failures instead of waiting forever.
- **Update prompt appears without a window:** expected during teardown. The coordinator logs the condition and does not attempt a non-modal prompt.
- **SQLite or active tasks look interrupted after restart:** inspect the normal CC Relay shutdown diagnostics. The updater invokes the same `relayShutdown` callback used by Electron `before-quit` before installing.

See [[desktop-packaging-review]] for the July 27, 2026 packaged-runtime validation, [[project-workspaces]] for the embedded server lifecycle, and [[diagnostics]] for local shutdown and launch diagnostics.

#relay #desktop #updates #electron #release
