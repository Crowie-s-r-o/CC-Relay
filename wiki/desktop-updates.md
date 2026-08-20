---
name: Desktop Updates
description: GitHub-backed packaged Electron updates, release artifacts, and graceful installation behavior.
type: architecture
---

# Desktop Updates

CC Relay checks for public `Crowie-s-r-o/CC-Relay` GitHub releases from packaged macOS and Windows builds. Signed macOS builds and installed Windows NSIS builds use `electron-updater` for discovery, background download, and installation. Windows portable builds use the fixed latest-release API for manual discovery. A sanitized, read-only update state crosses the embedded loopback status API so the renderer can show a compact release indicator; the renderer has no update control or privileged Electron surface.

## Runtime contract

The coordinator in `src/desktop-updater.mjs` is dependency-injected and has no direct Electron imports. `src/electron-main.mjs` supplies the GitHub release checker, the real `autoUpdater`, Electron `dialog`, the current app version, the main-window getter, and a graceful restart callback.

> [!important]
> Release discovery runs only when `app.isPackaged` is true and the platform is macOS or Windows. macOS and installed Windows NSIS builds start `electron-updater`. Windows portable executables discover new versions but update manually from GitHub Releases. Development launches through `npm run desktop` do not check.

> [!important]
> `electron-updater` 6.8.9 is CommonJS and defines `autoUpdater` through a runtime property getter. Electron's ESM loader does not expose that getter as a named export. `src/electron-main.mjs` must default-import the package and destructure `autoUpdater` from that default object. A named import passes a source syntax check but crashes the packaged app before startup.

The lifecycle starts once, after `BrowserWindow.loadURL()` succeeds. It schedules one delayed check and a recurring check every five minutes. The recurring timer is unreferenced so it cannot keep a test or process alive by itself, and an injected interval is capped at five minutes so callers cannot silently weaken the cadence. Checks remain overlap-safe and pause while a download or final installation handoff is active. After the operator accepts either installation choice, recurring checks continue while a long-running shutdown or ordinary process remains alive. A final check and any resulting download complete immediately before the native installer handoff.

`src/desktop-release-discovery.mjs` requests GitHub's fixed latest stable release endpoint with a ten-second timeout, validates the tag as three-part SemVer, rejects drafts and prereleases, and constructs the trusted release URL locally. Numeric version comparison prevents equal or older releases from producing an indicator. This manual path serves Windows portable builds and does not depend on updater feed metadata or renderer networking.

Automatic download and installation on normal quit are enabled for updater-capable builds. The coordinator keeps `electron-updater.autoDownload` disabled and calls `downloadUpdate()` itself, which is still automatic to the operator but lets Relay compare every offered release with the one already staged. Discovery starts the first download without interrupting active work. Once ready, a window-modal choice offers **Restart and install** or **Install on quit**. Either choice records one process-lifetime install intent instead of acknowledging only that exact version. **Restart and install** begins Relay shutdown immediately but does not freeze the target version while owned terminals are still closing. **Install on quit** leaves the process running normally. Duplicate, equal, and older offers keep the ready state without another download or prompt. A genuinely higher release downloads in the background, replaces the staged target, updates the renderer state, and inherits the existing install intent without reopening the native prompt. A failed refresh leaves the prior ready state visible, while a failed superseding download follows the normal automatic retry path. Final preparation makes one immediate retry before native handoff if its own superseding download fails. The intent is coordinator-local because process exit consumes it by installing the newest successfully downloaded release, so it requires no renderer storage or persistent settings file. `electron-updater.autoInstallOnAppQuit` remains enabled for the native installation handoff. Windows portable discovery publishes the header indicator without starting `electron-updater` or showing a misleading native prompt. No-update results, check failures, and download failures never show background error dialogs. When an automatic update is interrupted after a newer version is known, the recurring check retries it without operator action. The renderer describes that state as an automatic retry and keeps the official release link informational; it never tells an updater-capable build to install manually.

`createDesktopUpdater` publishes `unsupported`, `checking`, `current`, `available`, `downloading`, `downloaded`, `installing`, and `error` snapshots plus an `automaticUpdate` capability flag. Electron forwards those snapshots through `setDesktopUpdateState`; `/api/status.desktopUpdate` returns only normalized versions, the capability flag, bounded progress, and a URL restricted to this repository's GitHub Releases path. The header stays hidden unless a valid newer version is known. It then becomes a compact status button that shows background download progress, an automatic retry, or an update ready to install. Activating it opens an in-app details dialog with the installed-to-latest version route, bounded progress, the five-minute cadence, automatic install-on-quit copy, and the trusted release link. Automatic builds label that link **What's new in vX.Y.Z**. Manual platforms say **Download vX.Y.Z** and explain portable installation. The renderer remains read-only.

> [!note]
> The version route is the update dialog's visual signature: two compact release stations connected by one relay arrow. Light and dark themes share the same hierarchy, the dialog fits a 500 pixel viewport without page overflow, keyboard focus stays native to `<dialog>`, and progress motion is removed under `prefers-reduced-motion`.

The coordinator ignores overlapping checks, downloads, and prompts. It also skips prompts when the main window is absent or destroyed. This keeps updater events safe during startup and shutdown.

## Embedded server startup

The desktop process does not assume ports `4768` and `4769` are free. It appends `--relay-port 0` and `--relay-codex-port 0` before importing `src/server.mjs`. The operating system assigns available loopback ports, `serverReady` returns the actual HTTP URL, and Electron loads that URL. The shared Codex proxy updates its advertised endpoint after binding, so copied and launched Codex commands use the actual port.

Standalone `npm start` retains fixed ports `4768` and `4769`. This split allows a packaged CC Relay to open while a development CC Relay is coordinating active tasks without changing the browser and local CLI contract.

Desktop lifecycle events are written to `relay-diagnostics.jsonl` under `app.getPath('userData')`. Startup records the data root and log path before importing the server. Window creation, load success or failure, renderer loss, child-process exit, second-instance activation, updater start, and graceful shutdown are recorded. The `electron-updater` logger uses the same sink under the `desktop.updater.log` event, preserving native validation and installation errors that were previously visible only in a transient process console. A caught startup failure shows the same path in a native error box.

> [!important]
> A dynamic embedded port creates a different browser origin when the assigned port changes.
> Durable product state must therefore live under the stable desktop data root, not only in
> renderer `localStorage`. Completion review state follows this rule through the task SQLite
> database; version installation and restart cannot erase its Ready for review stack. See
> [[launchpad-completion-notifications]].

## Graceful installation

The immediate restart callback sets the existing Electron `quitting` guard before awaiting `relayShutdown`. In its `finally` path it asks the coordinator to finish any active check or download, performs one final release check, waits for a higher payload if found, and then calls `autoUpdater.quitAndInstall(false, true)`. The `false` argument keeps the normal visible installer behavior, while `true` restarts the app after installation. Nested `finally` blocks are required so a Relay shutdown or final-refresh error cannot strand an update that has already been downloaded. Because `quitting` is already set, Electron's `before-quit` handler does not attempt a second server shutdown. When the operator chooses **Install on quit**, the regular `before-quit` path completes the same Relay shutdown, asks the coordinator for the same final freshness pass, and only then lets `electron-updater` install the ready release.

The shared `relayShutdown` path also closes every native terminal launched by this CC Relay process before the backend and desktop process exit. It uses exact macOS Terminal window IDs and Windows process IDs, so an update restart does not leave CC Relay sessions running and does not close unrelated terminals. Normal application quit and update installation use the same cleanup contract.

> [!important]
> macOS releases have two distinct artifacts. The DMG remains the initial human-facing installer. The ZIP is the Squirrel.Mac updater payload and `latest-mac.yml` points the installed app to it. The GitHub Release must contain the DMG, ZIP, both blockmaps, and `latest-mac.yml` together; local deploy owns that upload. Removing the ZIP or feed metadata converts every installed macOS check into an updater error.

> [!important]
> Version 0.2.3 exposed an eligibility split incorrectly. The coordinator's default rule had removed macOS from `electron-updater`, but `src/electron-main.mjs` supplied an explicit `isEligible` callback that still included Darwin and overrode the default. The live packaged app therefore requested the deliberately unpublished `latest-mac.yml`, entered `error` with `latestVersion: null`, and the header correctly hid a failure that knew no newer version. That historical failure remains evidence that runtime eligibility and published artifacts must change atomically. The current contract enables Darwin only because local deploy completes every release with the signed ZIP and `latest-mac.yml`.

> [!important]
> Squirrel.Mac requires a consistently code-signed application. Hosted GitHub runners do not own the continuity identity used by installed CC Relay builds, so the workflow must never publish their unsigned macOS output. `npm run deploy` builds the public arm64 DMG and ZIP on the maintainer Mac, verifies the app directory and the app extracted from the ZIP against the exact installed signature lineage, verifies the DMG and update metadata, and only then uploads the macOS feed.

> [!important]
> A new GitHub Release stays draft while its desktop assets are assembled. The hosted workflow uploads the Windows files to that draft, then local deploy uploads and verifies the signed macOS payloads before adding `latest-mac.yml`. It adds `mac-release.json` last and publishes only the complete draft. Drafts are not selected by GitHub's latest-release endpoint, so no installed updater can observe a feed whose payload is still uploading.

## Release contract

The build configuration lives in [[../electron-builder.yml|electron-builder.yml]], the package metadata lives in [[../package.json|package.json]], and the native matrix plus GitHub release job live in [[../.github/workflows/build-desktop.yml|build-desktop.yml]]. The publisher is GitHub with owner `Crowie-s-r-o`, repository `CC-Relay`, and release type `release`.

> [!important]
> The product display name is `CC Relay`, but release artifact files stay hyphenated. macOS publishes `CC-Relay-${version}-${os}-${arch}.dmg` and the matching `.zip`. Windows adds `-Setup` for NSIS and `-Portable` for the manual executable so two `.exe` targets cannot overwrite each other. A space in `artifactName` produces files with spaces while update metadata normalizes URLs to hyphens, leaving the feed pointed at missing files. Keep artifact names hyphenated and the bundle, DMG volume, menu, About item, and UI name spaced. See [[product-naming]].

> [!important]
> The native Crowie application icon comes from `build/icon.png`. Both `mac.icon` and `win.icon` point to that build resource, which electron-builder converts for the macOS bundle and Windows executables. `public/favicon.svg` controls only the renderer tab icon and cannot replace the Electron logo in the Dock, Finder, taskbar, or installed application.

> [!note]
> A native icon change is not hot-reloaded into an existing bundle. On July 28, 2026, the stale `dist/mac-arm64/CC Relay.app` still contained `electron.icns` after the favicon changed. A full macOS rebuild replaced it with `icon.icns`; the app bundle, ZIP, and DMG then carried the same icon hash, the DMG checksum passed, and strict code-signature verification passed. Rebuild and reopen the native app after changing `build/icon.png`.

Create a release from a clean `main` branch with:

```bash
npm run deploy
```

The local deploy command first recovers any validated local release suffix that GitHub has not published completely. It then infers or accepts the Semantic Versioning bump, requires an isolated Codex or Claude CLI to generate compact notes, updates both package manifests and `CHANGELOG.md`, runs metadata checks, all tests, and the dependency audit, builds and verifies the signed macOS artifacts, creates an annotated tag, then atomically pushes `main` and the tag. The resulting version contract remains:

```text
package.json version: 0.2.0
git tag:             v0.2.0
```

> [!important]
> Deploy does not stop at the push. It requires the exact Apple Development continuity identity and readable GitHub CLI access before changing a release, polls the GitHub REST API for the exact workflow run by tag and head SHA, waits for its Windows draft handoff to succeed, then uploads the already verified local macOS artifacts with `gh release upload`. Payloads are uploaded and confirmed as `state: uploaded` with exact byte sizes before `latest-mac.yml`; `mac-release.json` is the final completion marker. Only then does deploy publish the draft. The command exits non-zero if any stage fails. There is no push-and-stop mode because a tag without its signed macOS feed is an incomplete release.

> [!important]
> A rerun after a rejected or partial push compares reachable local tags with complete stable GitHub
> Releases, validates the unpublished suffix, and publishes it oldest first. Starting at v0.2.15,
> completeness requires the signed DMG, ZIP, both blockmaps, `latest-mac.yml`, and
> `mac-release.json`. A missing marker keeps the tag pending. Recovery rebuilds an older tag inside a
> temporary detached worktree, resumes its exact workflow watch, uploads its verified macOS files,
> and cleans the worktree before advancing to the next version.

> [!important]
> The desktop build workflow runs `npm test` on the macOS matrix entry only. CC Relay is validated on macOS, and the suite simulates Windows paths, shims, and `cmd.exe` invocation from POSIX, so 75 of those cases fail on a real Windows runner. The hosted macOS job remains packaging validation but uploads nothing. The Windows job uploads the NSIS and portable artifacts, and the release job stages those files in a draft before local deploy adds the signed macOS set and publishes it. Because the release job declares `needs: build`, any red matrix job prevents the Windows handoff.

The release job rejects any tag, package, lockfile, changelog, publisher, or Windows target-name mismatch before staging artifacts. It extracts the matching AI-written changelog entry as the draft GitHub Release body. Hosted builds stage only Windows packaged deliverables from `dist/`; unpacked application directories and builder diagnostics never become release assets. Local deploy owns every public macOS deliverable and the final publication step. The expected feed metadata and artifacts are:

| Platform | Update metadata | Installable artifacts |
| --- | --- | --- |
| macOS | `latest-mac.yml` plus ZIP blockmap data | DMG for first install, ZIP for automatic updates |
| Windows NSIS | `latest.yml` plus NSIS blockmaps | NSIS installer |
| Windows portable | no automatic feed use | portable executable for manual download |

> [!important]
> Keep `latest-mac.yml`, `latest.yml`, desktop ZIP, blockmaps, DMG, NSIS, portable executable, and `mac-release.json` in the GitHub release. The installed updaters need their metadata and update payloads, and can use blockmap data for differential downloads. The manifest is the release-completeness marker and records the exact signing lineage, sizes, and SHA-512 digests verified locally. GitHub adds its own source-code ZIP and tarball automatically; those are not desktop packages and cannot replace the desktop ZIP.

Signing credentials are not stored in the repository. The current personal macOS update lineage uses `Apple Development: Patrik Kelemen (SSUH7T22L8)`, team `7TNPY5FX2F`, from the maintainer's local keychain. The verifier pins its designated requirement so a missing, ad hoc, or different signature fails before the release commit. Notarization remains unconfigured, and a future Developer ID transition needs an explicit bridge plan because changing lineage can strand already installed builds. Production Windows NSIS releases still need a trusted code-signing certificate.

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
- `.github/workflows/build-desktop.yml`: native build matrix, tag/version guard, Windows artifact upload, and the first GitHub release handoff.
- `scripts/deploy.mjs`: clean-tree checks, ordered pending-release recovery, version selection, isolated AI generation, verification, local signed macOS build, commit, tag, atomic push, Windows workflow watch, and verified macOS upload.
- `scripts/mac-release.mjs`: exact host and identity preflight, app and updater ZIP signature verification, DMG and feed verification, and `mac-release.json` generation.
- `scripts/release-core.mjs`: deterministic SemVer, release-tag normalization and recovery selection, signed macOS artifact naming and completeness, changelog normalization, formatting, extraction helpers, and workflow-run publication decisions.
- `scripts/release-check.mjs` and `scripts/release-notes.mjs`: CI metadata enforcement and GitHub Release body extraction.
- `CHANGELOG.md`: canonical compact release history.
- `package.json` and `package-lock.json`: app version and `electron-updater` dependency.

No renderer IPC, preload permission, writable update route, or environment variable is required for updates. The existing `PORTABLE_EXECUTABLE_FILE` marker is read only to identify the Windows portable runtime; CC Relay does not create or mutate it.

## August 14, 2026 validation

The local v0.2.11 macOS arm64 build produced the DMG, desktop ZIP, both blockmaps, and `latest-mac.yml`. The feed lists the ZIP first and selects it as `path`; its embedded `app-update.yml` points to `Crowie-s-r-o/CC-Relay`. The ZIP passes a complete archive integrity check. The unpacked app passes strict deep code-sign verification with `Apple Development: Patrik Kelemen (SSUH7T22L8)` and team `7TNPY5FX2F`. Notarization remains unconfigured.

The focused updater, status, renderer, startup, icon, release-discovery, and release-tooling set passes 48 of 48 tests. The complete suite passes 1,543 of 1,543 tests, `npm run release:check` passes for v0.2.11, and `git diff --check` is clean.

> [!important]
> The public v0.2.11 GitHub Release predates this contract and contains a DMG, its blockmap, Windows packages, and `latest.yml`, but no desktop ZIP or `latest-mac.yml`. It cannot bootstrap automatic macOS updates. The first release containing this implementation still requires one manual DMG installation. A later signed release is the first end-to-end updater proof.

## August 17, 2026 automatic retry correction

The installed v0.2.13 application downloaded the public v0.2.14 desktop ZIP and then entered the updater error state. The installed app has an Apple Development signature with team `7TNPY5FX2F`, while the cached public v0.2.14 ZIP contains no `_CodeSignature/CodeResources`. That replacement is not compatible with Squirrel.Mac's consistent-signature requirement. The repository also has no Actions signing secrets configured.

The former error presentation reused the retired manual-update fallback: **The update needs a hand**, a manual-install instruction, and a release button presented as the resolution. Current automatic builds instead show **Retrying vX.Y.Z**, explain that Relay will retry in the background, and label the external link **What's new in vX.Y.Z**. A focused coordinator test proves the next recurring interval calls `checkForUpdates()` after an updater error without operator action. Windows portable remains the only current manual-download path.

> [!warning]
> The public v0.2.14 ZIP remains unsigned and cannot be repaired by retrying either installation choice. The signed-release contract begins with v0.2.15; the next release must pass that contract before it is considered complete.

## August 18, 2026 signed release repair

The live incident proved that both native choices reached the updater handoff. **Restart and install** shut down and reopened CC Relay, and **Install on quit** installed during the later normal quit. Both attempts returned to v0.2.13 because Squirrel.Mac rejected the same unsigned v0.2.14 payload. The buttons did not need another installation path.

The release boundary now prevents recurrence:

1. `npm run deploy` runs only on macOS arm64 and requires the exact local continuity identity before any release mutation.
2. It builds the DMG, ZIP, blockmaps, and `latest-mac.yml` locally after all release gates pass.
3. `scripts/mac-release.mjs` strictly verifies the build app and the app extracted from the updater ZIP, including bundle ID, team, authority, designated requirement, and bundle version. It also verifies the DMG, feed path, feed SHA-512, and every required file.
4. The verifier writes `mac-release.json` with the frozen identity and artifact hashes. Starting at v0.2.15, a stable release without that marker remains pending.
5. GitHub Actions stages only the Windows artifacts in a draft. Deploy waits for that exact run to succeed, uploads the verified macOS set, confirms every required asset through the release API, then publishes the complete draft.

Recovery follows the same rule. If the tag is already pushed or the Windows-only release already exists, rerunning deploy builds the tagged source in an isolated temporary worktree and completes the missing signed macOS handoff. It never treats a partial v0.2.15 or later release as finished.

The updater now sends its internal logger to persistent desktop diagnostics. A future native rejection is recorded as `desktop.updater.log` in `relay-diagnostics.jsonl`, alongside startup and graceful-shutdown events.

Validation rebuilt v0.2.14 from the current source and passed the new verifier against the signed app directory, the application extracted from the ZIP, the DMG, both blockmaps, and `latest-mac.yml`. This local build is proof of the repaired pipeline, not a replacement for the already published unsigned v0.2.14 asset. The complete repository suite passes 1,577 of 1,577 tests, `release:check`, attribution checking, YAML parsing, dependency audit, and `git diff --check` all pass, and the audit reports zero vulnerabilities.

## August 19, 2026 atomic release visibility

The v0.2.16 application discovered v0.2.17 at `2026-08-18T22:40:57Z` and immediately received HTTP 404 for `CC-Relay-0.2.17-mac-arm64.zip`. Persistent updater diagnostics proved a publication race:

1. GitHub published the stable release at `22:40:12Z`.
2. Local deploy began all macOS uploads together at `22:40:29Z`.
3. The small `latest-mac.yml` asset finished at `22:40:30Z` and advertised the ZIP.
4. The 119 MB ZIP did not finish until `22:41:10Z`.
5. The app checked inside that 40-second gap, so both the differential request and its full-download fallback received 404.

This was not a signature or Squirrel.Mac installation rejection. The unchanged five-minute retry started at `22:45:56Z`, downloaded the now-available ZIP, passed native handoff, and reached ready state at `22:46:03Z`.

The release boundary now prevents the gap. The hosted workflow creates or resumes a draft release and leaves an already complete published release unchanged during a workflow rerun. Local deploy can find authenticated drafts through the release listing, uploads the DMG, ZIP, and blockmaps first, requires every asset to report `state: uploaded` with the verified byte size, uploads `latest-mac.yml` second, uploads `mac-release.json` last, and then publishes the draft. Recovery from an older partial public release removes any feed and completion marker before replacing payloads. A draft or an asset still in GitHub's upload state cannot count as a complete release.

The 45 focused updater and release checks pass, the complete repository suite passes 1,613 of 1,613 tests, `release:check` is green for v0.2.17, workflow YAML and JavaScript syntax checks pass, the live v0.2.17 ZIP responds with HTTP 200, and `git diff --check` is clean.

## August 20, 2026 deferred update supersession

A long-running v0.2.16 process had already downloaded v0.2.17 and the operator had accepted installation before v0.2.18 became public. The coordinator paused all checks in `downloaded`, and the immediate path changed to `installing` before waiting for Relay shutdown, so neither path could learn about v0.2.18 before exit. Restarting therefore installed v0.2.17, after which the newly launched app discovered v0.2.18 and showed the ready prompt again. The release artifacts and five-minute cadence were healthy; the defect was the version-scoped install policy.

Relay now treats either installation choice as one intent for the newest release that becomes ready during the same desktop process. The five-minute check continues while a requested restart is waiting on terminal shutdown and after **Install on quit** is selected. The coordinator skips an equal or older offer, automatically downloads a higher offer, publishes the higher ready version, and suppresses another prompt. Immediately before exit, Electron requests one final check and waits for its download. A failed supersession check retains the already-ready release, and active work remains overlap-safe.

> [!important]
> `electron-updater.autoDownload` stays disabled intentionally. Relay invokes `downloadUpdate()` immediately for the first or a higher eligible release. This preserves automatic background delivery while preventing the library from redownloading the same staged release on every five-minute comparison. Native `autoInstallOnAppQuit` remains enabled.

The coordinator suite covers initial automatic download, deferred recurring discovery, same-version suppression, silent higher-version replacement during both ordinary runtime and a pending restart, final pre-install freshness, stale lower downloaded events, refresh-failure preservation, same-version recovery after native staging failure, and active-download exclusion. The Electron startup contract pins final preparation into immediate restart and normal quit.

Verification on August 20, 2026: all 24 coordinator tests pass, the 39-test updater, startup, status, presentation, and release-discovery set passes, all 1,628 repository tests pass, `npm run release:check` confirms v0.2.18 metadata, `git diff --check` is clean, and the final added-line audit contains no em dash characters.

## Troubleshooting

- **No check during development:** expected. Use a packaged build; `npm run desktop` is intentionally ineligible.
- **No header indicator:** expected in development, while the packaged app is current, while its check is still running, or when GitHub release discovery is unavailable. A valid newer version is required before the link appears on macOS, Windows NSIS, and Windows portable builds.
- **Portable Windows build does not update:** expected. Download the latest portable artifact manually or install the NSIS build for automatic updates.
- **No update after a tag:** confirm the tag is `vX.Y.Z`, the package version is `X.Y.Z`, and a stable GitHub Release exists. macOS requires `latest-mac.yml`, the desktop ZIP, and a compatible code signature. Windows automatic installation requires `latest.yml`, its blockmap, and the NSIS installer.
- **The tag is pushed but the Releases page is empty:** expected publicly while the hosted workflow and local deploy are still assembling the draft. If deploy has stopped, inspect the exact workflow run and the local deploy error it named. A failed build leaves no usable handoff. Re-running the unchanged tag workflow cannot apply a source fix that is absent from that tag, so release the fix under the next version instead of retagging.
- **The atomic push fails with `Permission ... denied` and HTTP 403:** GitHub authenticated the named HTTPS user but that identity lacks effective write permission. The commit author and committer do not select the GitHub account used for a push; the credential-helper identity named in the remote error is authoritative. Confirm the active identity with `gh auth status -h github.com` and the repository grant with `gh repo view Crowie-s-r-o/CC-Relay --json viewerPermission`. A `READ` result requires the organization or repository owner to restore a direct or team `Write` grant. If GitHub already shows that grant, refresh the GitHub CLI credential and its organization SSO authorization. Do not recreate tags or push only the newest one. Rerun `npm run deploy`; it validates and publishes every pending release in order, skips completed releases on another retry, and continues with a new release only after the backlog is published. See [[open-source-releases]].
- **An older macOS build still asks for a DMG:** expected once. Install the first release containing the automatic updater manually. Later signed releases use the GitHub updater feed.
- **An automatic build says Retrying:** Relay will run another check on its five-minute cadence. Inspect `desktop.updater.log` first. A payload 404 can recover after publication finishes, while a signature rejection repeats until a compatible release is published. New releases remain draft until every updater payload is complete, preventing the v0.2.17 visibility race.
- **Packaged startup reports that the `autoUpdater` named export is missing:** inspect `src/electron-main.mjs` and keep the CommonJS default-import interop described above.
- **Signing reports that `CC Relay.app` could not be found, or packaging reports `ENOTEMPTY` for `dist/mac-arm64`:** confirm that only one `electron-builder` process is running and that no app is running from the output bundle. Concurrent builds share and replace the same `dist/mac-arm64` directory, so one build can remove the bundle while another signs it.
- **Dock icon but no window:** inspect `relay-diagnostics.jsonl` for the `desktop.start.*`, `desktop.server.*`, `relay.listen.*`, and `desktop.window.*` sequence. Current builds use dynamic embedded ports and reject startup failures instead of waiting forever.
- **Update prompt appears without a window:** expected during teardown. The coordinator logs the condition and does not attempt a non-modal prompt.
- **SQLite or active tasks look interrupted after restart:** inspect the normal CC Relay shutdown diagnostics. The updater invokes the same `relayShutdown` callback used by Electron `before-quit` before installing.

See [[desktop-packaging-review]] for the July 27, 2026 packaged-runtime validation, [[project-workspaces]] for the embedded server lifecycle, and [[diagnostics]] for local shutdown and launch diagnostics.

#relay #desktop #updates #electron #release
