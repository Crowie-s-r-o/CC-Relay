---
name: Claude Current Model Routing
description: Fable 5 remains a supported Claude Code model and Relay preserves it across selection, validation, and execution.
type: architecture
tags:
  - relay
  - claude
  - fable
  - models
  - compatibility
---

# Claude Current Model Routing

> [!important]
> Claude Code `2.1.226` lists Fable 5 in its live `/model` picker. Relay must expose `fable` as a first-class model and must never rewrite a selected Fable task to Opus.

## Corrected diagnosis

An earlier August 10 investigation incorrectly classified `fable` as retired after a Relay-owned Claude launch showed a `SessionStart:startup hook error`. The model was not the failure. The operator's follow-up screenshot proves the same Claude Code `2.1.226` installation is running Fable 5 from `~/.claude/settings.json`, and its model picker lists:

1. Default
2. Opus
3. Fable
4. Sonnet
5. Haiku

The startup-hook warning is separate from model availability. Relay's newest-binary resolution remains correct and unchanged. See [[claude-launch-settings]] and [[claude-terminal-live-output]].

## Current contract

Relay's Claude catalog exposes `default`, `opus`, `fable`, `sonnet`, and `haiku` in the same order as the live Claude picker.

- `fable` validates as `fable`.
- Browser composer history preserves saved `fable` selections.
- Native terminal launches emit `--model fable`.
- Direct headless execution emits `--model fable`.
- Read-only Claude planning stages emit `--model fable`.
- Execute Plan council and Turbo council use Fable as their preferred Claude model.

`best` is an older Relay-only compatibility value. It maps to `fable`, not Opus. A current renderer talking to an older backend removes the duplicate `best` choice while preserving the backend's Fable entry. If that older catalog contains only `best`, the renderer presents it as Fable.

Historical tasks and artifacts are not rewritten.

## Files

- `src/model-catalog.mjs`
- `src/claude-launch-settings.mjs`
- `src/claude-execution-runner.mjs`
- `src/claude-runner.mjs`
- `public/claude-model-selection.js`
- `public/project-composer-state.js`
- `public/plan-council-state.js`
- `public/turbo-council-state.js`
- `public/app.js`
- focused model, runner, composer, Plan council, and Turbo tests

## Verification

- Claude Code `2.1.226` live picker screenshot shows Fable 5.
- Focused routing and workflow tests pass.
- The complete default suite passes all 1,115 tests.
- JavaScript syntax checks and `git diff --check` pass.
- The rebuilt arm64 app passes strict code-signature verification.
- The rebuilt DMG passes `hdiutil verify`, the ZIP passes its integrity test, and the packaged `app.asar` contains Fable in both backend and renderer catalogs.

Build artifacts:

- `dist/CC-Relay-0.1.0-mac-arm64.dmg`
- `dist/CC-Relay-0.1.0-mac-arm64.zip`

Rebuild and restart CC Relay to load the corrected backend catalog and renderer bundle.

See [[claude-current-model-routing-review]], [[claude-fable-reviewed-plan-execution]], and [[hot]].

#relay #claude #fable #models #compatibility
