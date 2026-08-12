# Changelog

All notable CC Relay changes are recorded here. Releases follow Semantic Versioning and are generated from Git history by the local AI-assisted deploy command.

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
