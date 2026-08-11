---
name: Claude Fable Model Restoration Review
description: Review of the correction that restores Fable 5 after it was incorrectly treated as retired.
type: review
tags:
  - relay
  - claude
  - fable
  - review
  - models
---

# Claude Fable Model Restoration Review

## Outcome

**Ship.** Fable is again selectable and remains Fable through every execution boundary.

> [!warning]
> The earlier review on this page reached the wrong conclusion because it inferred model retirement from a launch that also displayed an unrelated startup-hook error. The live Claude Code `2.1.226` `/model` picker is direct counter-evidence and supersedes that conclusion.

## Evidence

| Area | Result | Evidence |
| --- | --- | --- |
| Catalog | Pass | Backend and fallback catalogs expose `default`, `opus`, `fable`, `sonnet`, and `haiku`. |
| Browser state | Pass | Saved Fable stays Fable. Legacy `best` becomes Fable. |
| Backend validation | Pass | `fable` validates directly and `best` resolves through Fable's compatibility alias. |
| Native launch | Pass | Terminal settings produce `--model fable`. |
| Headless execution | Pass | Direct and read-only Claude runners produce `--model fable`. |
| Workflows | Pass | Plan council and Turbo normalize to Fable and validate provider-specific effort. |
| Regression suite | Pass | 1,115 of 1,115 tests pass. |

## Non-obvious compatibility choice

Relay no longer displays the synthetic `best` choice because Claude's current picker does not list it. Existing `best` values remain runnable by mapping them to Fable. This avoids duplicate Fable choices without changing historical task rows.

## Regression risks

- A stale backend may still return both `best` and `fable`. The renderer keeps only Fable.
- A stale backend may return only `best`. The renderer presents that entry as Fable.
- A saved selection may already have been converted to Opus by the short-lived incorrect build. Relay cannot infer that the operator previously meant Fable, but all tasks still stored as `fable` now remain intact.

## Falsified idea

> [!note]
> Falsified: Fable was a retired alias that should route to Opus. Claude Code `2.1.226` names Fable 5 as a current selectable model and runs with it active.

See [[claude-current-model-routing]], [[claude-launch-settings]], and [[hot]].

#relay #claude #fable #review #models
