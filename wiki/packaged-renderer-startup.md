---
name: Packaged Renderer Startup
description: Empty-profile renderer initialization guards for provider tabs, model controls, and automatic terminal pools.
type: diagnosis
tags:
  - relay
  - electron
  - renderer
  - packaging
  - providers
---

# Packaged Renderer Startup

The packaged application could open its window while leaving the composer at its static HTML placeholders:

- Codex stayed at **Checking**.
- Claude stayed at **Not connected** and could not be selected.
- Model stayed at **Loading available models**.
- Effort stayed at its empty initial slider.

This was a renderer initialization failure, not a Claude installation or model-catalog failure. The packaged diagnostics proved that Claude 2.1.220 was resolved and the backend became ready. The browser console identified the first exception in `renderProviderTabs()`.

## Root cause

`public/app.js` intentionally paints once before the first `GET /api/status` response. At that point `state.status` is `null`. An empty desktop profile also has no saved active project.

`sameProjectPath()` normalizes a missing path to an empty string, so two missing paths compare equal. Two renderer branches treated that equality as proof that nested terminal-pool data existed:

1. `renderProviderTabs()` compared the missing status pool path with the missing active project, then read `state.status.terminalPool`.
2. After the first fix, the packaged Electron click test found the sibling path in `renderAutomaticTerminalPool()`. It compared a missing pool path with a missing selected project, then read `state.status.terminalPool.active`.

The development browser usually had `relay.activeProjectPath` in local storage, which made the comparisons false and masked both defects. A fresh packaged profile exposed them reliably.

## Resolution

Both branches now retain the optional `terminalPool` value and require the owning objects to exist before comparing paths or reading pool state:

- Provider tabs require a terminal-pool object before using its project match.
- Automatic terminal controls require both a terminal-pool object and a selected project before reading active counts.

> [!important]
> A normalized path comparison is not an existence check. Never use equality between optional paths as proof that the objects holding those paths exist.

## Verification

- `node --check public/app.js`
- `npm test`: 754 passed
- `npm run desktop:build:mac`
- Packaged `app.asar` inspected for both guards
- Strict code-signature verification passed
- ZIP integrity passed
- DMG checksum verification passed
- The exact signed `dist/mac-arm64/CC Relay.app` was launched with a fresh isolated user-data directory and inspected through Electron CDP
- A full renderer reload started with no active project, populated seven Codex models and six effort levels, selected Claude on click, populated six Claude models and five effort levels, and recorded zero renderer exceptions

The real packaged Electron pass was essential. It found the second exception after the first source-level repair and prevented shipping a partial fix.

## Plan council initial-paint regression

On 2026-07-29, the provider-order refactor left one obsolete model-normalization block in `renderPlanControls()`. The function had already replaced its former `models` local with `codexModels` and `claudeModels`, but the old block still evaluated `models.find(...)`. The first synchronous paint therefore threw `ReferenceError: models is not defined` before the initial `Promise.all()` could start.

This single exception explained both visible symptoms:

- Status and model requests never started.
- `capabilities.disposableTerminalPools` remained unknown, so the Codex and Claude provider tabs stayed hidden.
- The static legacy terminal controls remained visible even though the live backend advertised automatic terminal pools.

The obsolete block was removed because `syncPlanCouncilSettings()` already normalizes both provider models before rendering. `test/composer-workflows.test.mjs` now scopes the `renderPlanControls()` source and rejects a bare `models` lookup or legacy `settings.reviewerModel` normalization.

> [!important]
> Every function called before the initial `Promise.all()` is part of the renderer startup boundary. A synchronous exception in `renderProviderTabs()`, `renderExecutionControls()`, `renderPlanControls()`, `renderTurboControls()`, attachment rendering, or submit-state rendering prevents all initial API loading, which can make current capabilities look like an intentional legacy UI.

Verification for this regression:

- `node --check public/app.js`
- Focused renderer and Plan council tests: 52 passed
- Complete `npm test`: 780 passed
- Live `GET /api/status` confirmed automatic terminal pools and authenticated Codex and Claude CLIs
- Live `/app.js` confirmed the corrected function was being served

## Files

- `public/app.js`
- `test/composer-workflows.test.mjs`
- `dist/mac-arm64/CC Relay.app`
- `dist/CC-Relay-0.1.0-mac-arm64.zip`
- `dist/CC-Relay-0.1.0-mac-arm64.dmg`

See [[desktop-packaging-review]], [[desktop-updates]], [[provider-installation-detection]], and [[interface-layout]].

#relay #electron #renderer #packaging #providers
