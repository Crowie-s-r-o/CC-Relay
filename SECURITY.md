# Security policy

## Supported versions

CC Relay is pre-1.0 software. Security fixes are made on the current `main` branch and included in the next release. Older releases are not maintained as separate support lines.

## Report a vulnerability

Use GitHub's private vulnerability reporting flow for this repository:

[Report a vulnerability privately](https://github.com/Crowie-s-r-o/CC-Relay/security/advisories/new)

Please include the affected version or commit, operating system, provider CLI versions, reproduction steps, impact, and any suggested mitigation. Remove credentials, conversation content, private paths, and unrelated local data from evidence.

Do not open a public issue until the maintainers have investigated and coordinated disclosure.

## Security-sensitive areas

Reports involving these boundaries are especially useful:

- Loopback HTTP or WebSocket access control.
- Path traversal or task artifact containment.
- Prompt, transcript, or terminal escape injection.
- Cross-project task or session isolation.
- Native terminal ownership, targeting, retention, or cleanup.
- Provider process identity and conversation binding.
- SQLite integrity or unintended local-data exposure.
- Desktop update origin, artifact integrity, signing, or installation behavior.
- Secrets or private data included in source, fixtures, logs, or release artifacts.
