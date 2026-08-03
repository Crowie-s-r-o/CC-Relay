---
name: Desktop Packaging Review
description: Adversarial review and packaged-runtime evidence for the electron-updater ESM interop fix.
type: review
---

# Desktop Packaging Review

## Executive Summary

**Ticket confidence: High**

The packaged macOS startup crash is fixed in `src/electron-main.mjs`. `electron-updater` 6.8.9 is CommonJS and creates `autoUpdater` with `Object.defineProperty`, so Electron's ESM named-export analysis does not expose it. Default-importing the package and reading `autoUpdater` from that object follows the CommonJS interop contract and preserves the same updater instance passed to `createDesktopUpdater`.

No UI, HTTP, database, task, permission, or renderer behavior changed. A signed arm64 package stayed alive through an isolated ten-second startup smoke test with empty stderr and no updater import exception.

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | The packaged `app.asar` contains the default import, the app stayed alive through startup, and the updater lifecycle still receives the real `autoUpdater`. |
| Regression risk (UI / backend / contracts) | Green | Only the Electron main-process import shape changed. Renderer, server, API, database, and updater coordinator contracts are unchanged. |
| Gap risk (edge cases, error handling, completeness) | Amber | The macOS arm64 artifact was exercised locally. A Windows packaged startup was not available on this host, although Node's CommonJS default-import contract and the package shape are platform-independent. |
| Code quality (maintainability as safety) | Green | The fix is local and matches the package's actual export descriptor without adding wrappers, configuration, or another dependency. |
| Unit tests | Green | All 698 unit tests pass, including all 10 updater lifecycle tests. The loader failure is a packaged-runtime integration boundary, covered here by the package and launch smoke checks. Adequate UNIT tests: Yes. |
| Performance & scalability (if applicable) | N-A | The change performs one module property read during Electron main-process startup and does not affect a repeated or load-sensitive path. |

## Change Mapping

`src/electron-main.mjs` owns Electron startup and dependency injection into `createDesktopUpdater`. It now default-imports `electron-updater` and destructures the runtime getter from the returned CommonJS exports object. Downstream updater configuration, events, prompts, graceful shutdown, and `quitAndInstall` calls are unchanged.

The blast radius is packaged Electron startup on macOS and Windows. The web server, renderer, preload permissions, localhost API, update feed schema, release metadata, and update eligibility rules are outside the behavioral change.

## Functional Execution Trace

1. Electron loads `src/electron-main.mjs` as ESM.
2. Its loader maps the CommonJS `electron-updater` module to a default exports object.
3. Reading `electronUpdater.autoUpdater` invokes the package's platform-specific getter and creates `MacUpdater` on macOS or `NsisUpdater` on Windows.
4. CC Relay injects that instance into `createDesktopUpdater`.
5. After `BrowserWindow.loadURL()` succeeds, `desktopUpdater.start()` applies the existing packaged-build eligibility and schedules the update check.

Null, empty, duplicate, out-of-order, authorization, and partial database cases do not enter this import boundary. If the dependency disappears or changes its default export contract, Electron startup fails loudly before the app is ready, matching the previous failure visibility. Updater network and prompt failures remain contained by `src/desktop-updater.mjs`.

## Regression Hunt

- Before the fix, development-oriented syntax checks passed but the packaged Electron ESM loader rejected the named export before application startup.
- After the fix, the package's runtime getter is read from its default CommonJS object and the app reaches its normal event loop.
- Updater initialization still occurs at module load, as it did before, so startup ordering and eligibility behavior do not change.
- The default import works for the same package on Windows because the getter selects its implementation from `process.platform` after import.

## Top 3 Risks

1. `src/electron-main.mjs` could accidentally return to a named import because there is no automated packaged-startup test in the normal unit suite.
2. Windows packaged startup was reasoned from the shared CommonJS export path but was not executed on this macOS host.
3. `npm run desktop:build:mac` has no cross-process lock. Two builds in one checkout can delete or replace `dist/mac-arm64/CC Relay.app` while the other signs it.

## Top Improvements

1. Add a release smoke job that launches each packaged app and fails on an early main-process exit.
2. Keep one builder per checkout or introduce a build wrapper that rejects a concurrent packaging process.
3. Run the equivalent packaged startup check on the Windows release runner.

## Verification Evidence

- `node --test test/desktop-updater.test.mjs`: 10 passed.
- `npm test`: 698 passed.
- `npm run desktop:build:mac`: completed when one builder owned `dist`.
- `codesign --verify --deep --strict`: valid on disk and satisfies its designated requirement.
- Packaged `app.asar`: contains the CommonJS default import and destructuring fix.
- ZIP integrity: no compressed-data errors.
- DMG integrity: checksum valid.
- Isolated packaged startup: alive after ten seconds, empty stdout and stderr, no uncaught exception.

> [!note]
> `spctl` rejection remains expected for this local Apple Development build because it is not notarized. See [[desktop-updates]] for the production signing and notarization contract.

## July 28 Dynamic Port Addendum

The later Dock-icon-without-window incident had a separate cause from the updater import. Development CC Relay already owned HTTP port `4768`. The packaged main process recorded `relay.listen.failed`, waited forever for a `listening` event that could no longer occur, never created a renderer, and retained the single-instance lock.

The desktop entry point now requests operating-system-assigned HTTP and Codex proxy ports, awaits the exported `serverReady` promise, and loads its returned URL. Standalone server launches keep their fixed endpoints. The main process also writes startup, bind, window, renderer, updater, and shutdown events to the normal structured diagnostics file.

Verification on July 28, 2026:

- All 738 repository tests passed.
- A collision probe kept development ports `4768` and `4769` occupied while another CC Relay bound HTTP `50210` and Codex proxy `50213`; `/api/status` reported Codex connected.
- `npm run desktop:build:mac` completed with one builder and no running output-bundle process.
- Strict code-signature verification passed.
- ZIP integrity and DMG checksum verification passed.
- The packaged `app.asar` contains both dynamic port flags, `serverReady`, and `desktop.window.load.completed`.
- The build-output app opened on HTTP `53950` and Codex proxy `53963`, created a renderer, loaded its window, and shut down cleanly.
- The identical app was installed at `/Applications/CC Relay.app`; its `app.asar` hash matches the build output.
- The installed app opened on HTTP `54567` and Codex proxy `54572`, retained a live renderer, reported Codex connected, and left the development listeners untouched.

See [[diagnostics]] for the event sequence and log location.

#relay #desktop #electron #packaging #review
