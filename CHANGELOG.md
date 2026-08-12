# Changelog

All notable CC Relay changes are recorded here. Releases follow Semantic Versioning and are generated from Git history by the local AI-assisted deploy command.

## [0.1.0] - 2026-08-12

### Added

- Coordinate project-scoped Codex and Claude queues with configurable provider capacity, live activity, saved history, and exact conversation continuation.
- Build reviewed implementation plans through Plan council and dispatch dependency-ready work through Forward-planning Turbo.
- Run as a loopback web app or packaged Electron desktop app with local SQLite state, reference images, terminal retention, and update support.
- Manage the local queue from Codex through the bundled personal plugin.

### Security

- Keep provider authentication inside the installed CLIs and bind application traffic to loopback interfaces.
- Verify exact live process, conversation, TTY, and native-window ownership before terminal control or cleanup.
