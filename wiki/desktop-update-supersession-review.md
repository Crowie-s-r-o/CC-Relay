---
name: Desktop Update Supersession Review
description: Adversarial ship review of silent higher-release adoption during deferred or pending desktop restart.
type: review
tags:
  - relay
  - desktop
  - updates
  - electron
  - review
---

# Desktop Update Supersession Review

## Executive Summary

**Ticket confidence: High**

The updater now preserves one accepted installation intent across release versions in the same desktop process. A staged release no longer freezes discovery. Equal and older offers are ignored, a higher offer is downloaded and becomes the new target without another prompt, and both normal quit and immediate restart perform a final freshness pass before native installation. The immediate path keeps checking while `relayShutdown` is still closing long-running owned terminals.

The adversarial pass found two concrete failure-path regressions before completion. First, an `update-downloaded` event followed by native staging failure left the version remembered, so the next same-version offer was incorrectly skipped. `handleAvailable()` now retries the same version when coordinator state is `error`. Second, a failed restart callback republished the original prompt's release metadata even after a higher release had superseded it. Recovery now publishes the newest accepted downloaded metadata. Focused regression tests cover both exact orders.

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | `createDesktopUpdater()` tracks the downloaded version separately from accepted install intent, compares stable versions numerically, suppresses duplicate prompts, and exposes `prepareToInstall()` as a final check and download barrier. |
| Regression risk (UI / backend / contracts) | Green | The status payload and renderer contract are unchanged. The visible dialog remains operator-opened and updates in place. `src/electron-main.mjs` calls the same graceful shutdown and native installer, with final preparation inserted before handoff. |
| Gap risk (edge cases, error handling, completeness) | Amber | The exact macOS Squirrel and Windows NSIS sequence has deterministic coordinator coverage and was traced through `electron-updater` 6.8.9, but no packaged vX to vY to vZ live installation was performed in this source task. |
| Code quality (maintainability as safety) | Green | One coordinator owns check, download, prompt, version, and intent state. In-flight promises provide explicit final barriers. No renderer privilege, persisted setting, migration, dependency, or environment variable was added. |
| Unit tests | Green | Tests cover same, lower, higher, duplicate, delayed, restart-pending, final-check, final-download retry, handoff failure, refresh failure, native-staging failure, active download, immediate install, absent window, and overlapping event paths. **Are there adequate UNIT tests? Yes.** |
| Performance & scalability | Green | State and comparisons are O(1). A deferred or pending install adds the existing five-minute feed request cadence plus one final request before exit, with one bounded second attempt only after failure. |

## Change Mapping

- `src/desktop-updater.mjs` owns release checks, downloads, prompt policy, state publication, retry, and final install preparation. It changed from version-scoped acknowledgement and updater-owned download to coordinator-owned automatic download plus one install intent.
- `src/electron-main.mjs` still owns Relay shutdown and native `quitAndInstall`. It now runs coordinator preparation after shutdown and before native handoff, both for **Restart and install** and normal quit.
- `test/desktop-updater.test.mjs` exercises coordinator event ordering, retry, supersession, and final barriers.
- `test/desktop-startup.test.mjs` pins both Electron handoff sites to `prepareToInstall()`.
- [[desktop-updates]] and [[hot]] record the durable runtime and operator contract.

The blast radius is limited to packaged macOS and installed Windows automatic updates. Windows portable manual discovery, the loopback API shape, renderer controls, release publication, task data, terminal ownership, authentication, permissions, and persistence are unchanged.

## Functional Execution Trace

### Deferred normal runtime

1. `checkForUpdates()` receives `update-available` for vY.
2. `handleAvailable()` calls `downloadUpdate()` automatically while `electron-updater.autoDownload` remains false.
3. `handleDownloaded()` publishes vY and shows the ready choice once.
4. **Install on quit** acknowledges installation intent, not vY alone.
5. Each five-minute check asks the feed again. vY or an older version is skipped without a download. vZ starts one download.
6. vZ `update-downloaded` replaces the published target and inherits the intent without another prompt.
7. Electron normal quit completes `relayShutdown`, awaits `prepareToInstall()`, then calls `app.quit()`. Native auto-install consumes the newest ready payload.

### Immediate restart delayed by terminals

1. **Restart and install** acknowledges install intent and begins `relayShutdown` without changing coordinator state to final `installing`.
2. The prompt lock is released, so higher downloaded events can be accepted while terminal cleanup is still active.
3. Recurring checks may replace vY with vZ during that wait.
4. After shutdown, `prepareToInstall()` awaits any active check or download, runs one final check, awaits a resulting higher download, and publishes `installing`.
5. Nested `finally` blocks invoke `autoUpdater.quitAndInstall(false, true)` even if Relay shutdown or final preparation reports an error.

### Failure and ordering boundaries

- A refresh error while a deferred payload is ready preserves `downloaded` state and the existing target.
- A download or native staging error publishes `error`; the same version is then eligible for retry.
- A stale lower `update-downloaded` event cannot replace a higher downloaded version.
- Check, download, prompt, and final installation overlap guards remain bounded and process-local.
- Null or malformed feed versions cannot originate from `electron-updater`, which validates SemVer before `update-available`. Manual portable discovery retains its existing strict three-part validation.
- There is no authorization boundary, database write, or user-controlled URL added by this change.

## Top 3 Risks

1. `src/desktop-updater.mjs`, `prepareToInstall()`: a release that becomes public after the final check is outside the process's observable window. The newest successfully downloaded version remains the only safe install target.
2. `node_modules/electron-updater/out/MacUpdater.js` and `BaseUpdater.js`: unit doubles cannot prove native Squirrel or NSIS replacement on a real packaged host. The installed 6.8.9 source confirms manual `downloadUpdate()` still enters native auto-install, but a packaged three-version smoke remains useful.
3. The intent is intentionally process-local. An already-running older CC Relay build that contains the paused-downloaded defect cannot hot-load this fix and may still take the intermediate update once.

## Top Improvements

1. Run a packaged macOS smoke with controlled vX, vY, and vZ feeds, delaying Relay shutdown until vZ is staged, then verify the relaunched bundle is vZ.
2. Run the equivalent installed Windows NSIS smoke on the unvalidated Windows target.
3. Add a bounded diagnostic event naming the final selected version immediately before `quitAndInstall` if support needs a simpler operator trace than the existing updater logs.

## Recommendation

**Ship**

Verification evidence: 24 of 24 coordinator tests, 39 of 39 focused desktop update tests, and 1,628 of 1,628 repository tests pass. `npm run release:check` is green for v0.2.18, `git diff --check` passes, and the final added-line character audit reports zero em dash lines.

## Confirmed Issues

No confirmed issue remains. The same-version retry gap and stale recovery-metadata gap found during review were fixed and regression-tested before this recommendation.

## Suspected Issues & Edge Cases

- If a higher release is discovered but its download fails, Relay retains normal retry behavior. Native installation may use the prior successfully staged release because installing an incomplete higher payload would be unsafe.
- If the release changes after the final freshness request has completed, that later publication is discovered by the next application run. No finite client-side check can close that external race completely.
- Closing every application window manually during an already-running immediate shutdown still follows Electron's existing `quitting` guard. This ticket does not change window-close ownership.

## Regression Risks

- Before: `electron-updater.autoDownload` downloaded every available offer. After: Relay calls `downloadUpdate()` immediately for the first or a higher offer. Operator-visible automatic download remains unchanged, while equal ready versions no longer redownload every five minutes.
- Before: immediate restart published `installing` before Relay shutdown, permanently blocking checks. After: final `installing` begins only after shutdown and freshness preparation complete.
- Before: normal quit relied only on native auto-install. After: it performs a coordinator freshness pass first, then uses the same native auto-install hook.
- Manual Windows portable discovery never configures the updater and is unaffected.

## Performance Risks

The recurring path performs one constant-size release metadata request every five minutes only after install intent exists, matching the normal running cadence. Final preparation adds one request and at most one release download in the normal case, with one bounded second check and download attempt after failure. Memory remains constant with one check promise, one download promise, two version or intent fields, and the existing state snapshot.

## Test Gaps

- No real packaged macOS three-version supersession was installed during this task.
- No real Windows NSIS installation was available on this macOS-validated repository.
- Unit tests do not simulate a publication arriving after the final check because that is intentionally the next-run boundary.

## Positive Improvements

- One operator decision now survives a higher release without another interruption.
- Long terminal shutdowns become useful time for release freshness instead of freezing the older target.
- Same and older offers cost no repeated payload download.
- Final installation waits for active updater work and one last feed result, with one bounded retry for a transient superseding-download failure.
- Persistent updater diagnostics distinguish refresh preservation, supersession, stale events, and native retry.

Related: [[desktop-updates]], [[desktop-packaging-review]], [[open-source-releases]]

#relay #desktop #updates #electron #review
