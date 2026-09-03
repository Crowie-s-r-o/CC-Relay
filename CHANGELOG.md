# Changelog

All notable CC Relay changes are recorded here. Releases follow Semantic Versioning and are generated from Git history by the local AI-assisted deploy command.

## [0.2.31] - 2026-09-03

### Added

- Standup now supports question-and-answer interactions.
- Release recovery evidence and guidance for transitive audit advisories are now documented.

### Changed

- Application memory use is now bounded.
- Claude follow-up handling is more robust.

### Fixed

- Tagged release workflows can recover from previous failures.

### Security

- Build-only transitive dependencies were updated to clear a high-severity audit advisory without changing application source.

## [0.2.30] - 2026-09-01

### Added

- Daily token telemetry is now available.
- Conversation metrics are now tracked.
- Conversation cards now include previews.

### Changed

- The Electron development dependency was updated.

## [0.2.29] - 2026-09-01

### Added

- Daily token telemetry provides visibility into token usage.
- Conversation metrics provide insight into relay activity.
- Card previews provide richer at-a-glance context.

## [0.2.28] - 2026-08-31

### Added

- Claude tab-expanded prompts are now accepted.

### Security

- Diagnostics now protect sensitive prompt data.

## [0.2.27] - 2026-08-30

### Added

- OpenCode reasoning is now exposed in the relay.

### Fixed

- Token throughput now remains accurate.

## [0.2.26] - 2026-08-26

### Added

- OpenCode reasoning is now visible through the relay.

### Fixed

- Token throughput reporting now remains accurate for OpenCode responses.

## [0.2.25] - 2026-08-26

### Added

- Push-to-talk shortcuts are now configurable.

### Fixed

- Token throughput reporting is now corrected.

## [0.2.24] - 2026-08-25

### Added

- Added OpenCode headless execution support.
- Added native token-throughput monitoring.
- Added local push-to-talk dictation with configurable shortcuts.

## [0.2.23] - 2026-08-25

### Changed

- Turbo now starts fresh planning for each prompt and uses one execution session.

## [0.2.22] - 2026-08-23

### Changed

- Status bar now keeps the full model name and effort visible.
- Relay and follow controls have been removed from the status bar.

## [0.2.21] - 2026-08-21

### Added

- Release briefs are now shown in the app.
- Claude panels can now be expanded.

## [0.2.20] - 2026-08-21

### Added

- Standups now cover two days.
- Provider usage now shows remaining runway.
- Task activity filters show live message counts.

### Changed

- Task activity now separates user messages from AI messages.

### Security

- Claude folder trust is now handled safely during startup.

## [0.2.19] - 2026-08-20

### Added

- Desktop sends now show explicit progress.

### Changed

- Desktop updates now follow newer releases when an update is superseded.

## [0.2.18] - 2026-08-20

### Added

- Tasks can now be starred.
- Tasks can now be renamed inline.
- Standup prompts are now available.

### Changed

- Releases are now atomic.

## [0.2.17] - 2026-08-19

### Added

- Task details now include exact task diffs.
- Tasks now support references.

### Fixed

- Image merging is now race-safe.

## [0.2.16] - 2026-08-18

### Changed

- Standups now attribute tasks to their start dates instead of their completion dates.

## [0.2.15] - 2026-08-18

### Added

- The relay now requires an additional verification pass.

### Changed

- Desktop updater retries are more robust.
- Install-on-quit tracking is improved.
- The splash screen uses updated branding.

### Fixed

- The relay no longer falls back to Fable.

## [0.2.14] - 2026-08-17

### Changed

- The monitor now keeps Codex goals active and preserves manually started sessions.

## [0.2.13] - 2026-08-14

### Changed

- Provider usage now refreshes every minute.
- Startup has been streamlined.

### Fixed

- Expired usage reset times are now clamped.

## [0.2.12] - 2026-08-14

### Changed

- Completion reviews now persist across sessions.
- macOS desktop updates now run automatically.
- Display controls are unified for a more consistent interface.
- Desktop zoom and title-bar state now stay synchronized.

## [0.2.11] - 2026-08-13

### Changed

- Relayed tasks must stop any processes they start.

## [0.2.10] - 2026-08-13

### Fixed

- Unpublished releases are now recovered in the correct order.
- Stale task windows are now ignored during task difference capture.

## [0.2.9] - 2026-08-13

### Added

- Completion speech can be configured with selectable content and word limits.
- Per-task Git diffs are available in Relay.

## [0.2.8] - 2026-08-13

### Changed

- Expanded desktop update documentation with atomic push failure and GitHub permission troubleshooting guidance.

## [0.2.7] - 2026-08-13

### Added

- Added task search.
- Added a task activity overview.
- Added safeguards for Claude execution and terminal workflows.

### Security

- Removed localhost task import.

## [0.2.6] - 2026-08-13

### Changed

- Release notes and standup changelogs now include every distinct confirmed fact without item-count limits.
- Release tooling, standup documentation, and related tests now reflect unlimited changelog items.

## [0.2.5] - 2026-08-12

### Added

- Desktop users can manually check for available releases.

### Changed

- Adding projects now uses a simpler workflow.
- Desktop update status and discovery feedback are clearer.

## [0.2.4] - 2026-08-12

### Added

- AI standups can now produce schema-validated, categorized changelog notes.

### Changed

- Standups are standardized as changelogs with more stable composer controls.
- Terminal settings have been redesigned.

### Fixed

- Claude live steering timing is more reliable.

## [0.2.3] - 2026-08-12

### Added

- Added provider usage monitoring.
- Added branded startup and About experiences.
- Added layout copying and desktop zoom controls.
- Added DMG release support.

### Changed

- Improved the desktop update experience.

## [0.2.2] - 2026-08-12

### Added

- Provider plans and goals are now visible in the app.

### Changed

- Desktop release handling is improved.

### Fixed

- Claude recovery is safer.
- Assistant-generated contributor attribution is blocked from commits.

## [0.2.1] - 2026-08-12

### Added

- Deploy now watches the tag build and confirms that a release was published.
- The new --no-watch option preserves push-and-stop deployment behavior.

### Changed

- Automated tests now run on macOS, while Windows remains a packaging check.

### Fixed

- Tagged desktop builds no longer skip release publishing because of Windows test failures.
- Deploy now fails with build details when no release is published, or prints the release URL when GitHub CLI is unavailable.

## [0.2.0] - 2026-08-12

### Added

- Added desktop update status and controls for managing application updates.
- Added completion alerts, task detail views, app zoom, and durable interface preferences.
- Added Claude model selection, background sub-agent completion handling, and recovery support.
- Added open-source release documentation, contribution guidance, security policy, and third-party notices.

### Changed

- Updated desktop build and CI workflows for cross-platform packaging and current action runtimes.
- Release tooling now preserves local dates and produces more compact output.

### Fixed

- Fixed terminal cleanup when native terminal slots disappear.
- Removed accidentally packaged source files from an invalid output path.

## [0.1.0] - 2026-08-12

### Added

- Coordinate project-scoped Codex and Claude queues with configurable provider capacity, live activity, saved history, and exact conversation continuation.
- Build reviewed implementation plans through Plan council and dispatch dependency-ready work through Forward-planning Turbo.
- Run as a loopback web app or packaged Electron desktop app with local SQLite state, reference images, terminal retention, and update support.
- Manage the local queue from Codex through the bundled personal plugin.

### Security

- Keep provider authentication inside the installed CLIs and bind application traffic to loopback interfaces.
- Verify exact live process, conversation, TTY, and native-window ownership before terminal control or cleanup.
