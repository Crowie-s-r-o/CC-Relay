---
name: Desktop Update Discovery Review
description: Adversarial ship review of manual release discovery for DMG-only macOS and portable Windows builds.
type: review
tags:
  - relay
  - desktop
  - updates
  - release
  - review
---

# Desktop Update Discovery Review

## Executive Summary

**Ticket confidence: High**

The update indicator failure is reproduced and fixed at the actual boundary. Version 0.2.3 on macOS started `electron-updater`, requested the deliberately unpublished `latest-mac.yml`, and reached `error` before it learned that v0.2.4 existed. Release discovery is now independent of installation: packaged macOS and Windows portable builds read the fixed GitHub latest stable release endpoint, while installed Windows NSIS alone retains `electron-updater` download and restart handling.

The normal path, invalid metadata, HTTP failure, version boundaries, overlapping checks, repeated checks, manual-platform copy, API normalization, renderer visibility, Windows update flow, and release packaging contract are covered. A real request resolved 0.2.3 to v0.2.4 with the exact trusted release URL. The full suite passes 1,436 of 1,436, `npm run release:check` passes, and `git diff --check` passes.

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | `createWindow()` starts `createDesktopUpdater()` only after server and renderer readiness. `checkForUpdates()` selects either the GitHub checker or Windows updater, and `desktopUpdatePresentation()` renders the resulting additive capability correctly. |
| Regression risk (UI / backend / contracts) | Green | The Windows NSIS event and prompt path is unchanged behind `automaticUpdate: true`; macOS and portable builds never configure updater events. The loopback state adds one normalized boolean and older consumers can ignore it. |
| Gap risk (edge cases, error handling, completeness) | Amber | An initial GitHub outage leaves the indicator hidden because no trustworthy newer version is known. The five-minute retry recovers automatically, and a later outage preserves an already known update. |
| Code quality (maintainability as safety) | Green | `desktop-release-discovery.mjs` owns fixed-endpoint networking and numeric comparison. Platform policy remains explicit in `electron-main.mjs`; the coordinator contains no Electron import. |
| Unit tests | Green | Dedicated tests cover numeric ordering, API validation, HTTP failure, platform eligibility, manual discovery, current and older versions, retained known state after failure, UI copy, state normalization, and the existing Windows lifecycle. |
| Performance & scalability | Green | One small public GitHub request runs after startup and every five minutes. Work and state are constant-size, checks are overlap-safe, and the timer is unreferenced. |

## Top 3 Risks

1. `createGitHubReleaseChecker()` uses GitHub's unauthenticated public API. Extended network failure or rate limiting delays discovery until a later five-minute retry.
2. Version 0.2.3 cannot receive this source fix automatically. The operator must install one later DMG manually before future packaged builds can show manual update discovery.
3. No fresh packaged Electron bundle was installed over the running application during this task. The exact module and coordinator were exercised against the live GitHub release, but the final native UI still needs the next normal release build.

## Top Improvements

1. Add one packaged macOS release smoke that waits for the header indicator against a controlled latest-release response.
2. Persist a bounded `desktop.update.check_failed` diagnostic without exposing remote response data, so an initial hidden failure is visible to support.
3. Consider conditional GitHub requests if release discovery traffic ever approaches public API limits.

## Recommendation

**Ship**

## Confirmed Issues

No remaining ship blocker was found. The confirmed 0.2.3 Darwin eligibility defect is fixed by separating release discovery eligibility from automatic-update eligibility.

## Suspected Issues & Edge Cases

- GitHub can answer 403 or be unavailable. The initial check stays hidden rather than claiming an update; recurring checks retry. A known newer version remains visible after a later failure.
- Three-part stable SemVer is intentional. A malformed, draft, or prerelease response fails closed and cannot construct a release link.
- A response older than the installed version publishes `current`, which avoids a false downgrade indicator during release rollback or mirror inconsistency.

## Regression Risks

- Installed Windows NSIS still configures `autoDownload = false`, prompts before download, reports progress, and uses graceful restart installation.
- Development launches remain unsupported and schedule no check.
- macOS and Windows portable builds change from no useful signal to a read-only manual download signal. They do not gain installation authority.
- The status API contract gains `automaticUpdate`; version, progress, state, and trusted-URL normalization remain unchanged.

## Performance Risks

The new path is O(1) in time and memory. At the five-minute cadence one continuously running packaged manual-update app makes twelve small requests per hour. The ten-second abort bounds a stalled request, and `checkInFlight` prevents overlap.

## Test Gaps

- No end-to-end packaged macOS test observes the real header through Electron after a GitHub response.
- No proxy, captive-portal, or GitHub rate-limit response was exercised through a packaged app.
- Real Windows NSIS behavior remains outside this macOS-validated repository's target-machine coverage.

## Positive Improvements

- Update discovery no longer depends on an installer feed format.
- Trusted release links are constructed locally from validated stable versions.
- Manual platforms receive accurate download copy and no misleading native **Download** prompt.
- A transient refresh failure cannot erase an update already shown to the operator.

Related: [[desktop-updates]], [[open-source-releases]], [[desktop-packaging-review]]

#relay #desktop #updates #release #review
