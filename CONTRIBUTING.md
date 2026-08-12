# Contributing to CC Relay

Thanks for helping make local AI orchestration safer and more useful.

CC Relay is currently validated only on macOS. Focused Windows and Linux reports are especially valuable, but please describe unverified behavior honestly and do not mark a platform supported from unit tests alone.

## Set up the project

```bash
git clone https://github.com/Crowie-s-r-o/CC-Relay.git
cd CC-Relay
npm ci
npm test
npm run release:check
```

Run the localhost application with `npm start` or the Electron development shell with `npm run desktop`.

## Contribution license

By submitting a contribution, you confirm that you have the right to provide it and agree that it may be distributed under the repository's [PolyForm Noncommercial License 1.0.0](LICENSE). If an employer or another party may own the work, resolve that permission before submitting it.

## Before opening a pull request

- Keep a change focused on one clear outcome.
- Add or update tests for changed behavior and important failure paths.
- Run `npm test` and `npm run release:check`.
- Run `npm audit --audit-level=high` when dependencies or the lockfile change.
- Update README, FEATURES, or wiki context when public behavior or a lasting engineering contract changes.
- Never commit `.data`, SQLite files, diagnostics, provider transcripts, credentials, signing material, or private project artifacts.
- Use synthetic paths, project names, session IDs, and task content in fixtures.

## Commit messages

The deploy command derives version intent from Conventional Commit headers:

```text
feat(queue): add project capacity controls
fix(terminal): preserve exact launch ownership
docs: explain the release workflow
feat(api)!: replace the task event contract
```

Use `BREAKING CHANGE:` in the commit body or `!` in the header for an incompatible change. Maintainers can still choose an explicit release bump when history needs correction.

## Pull requests

Include:

- What changed and why.
- The important execution or ownership path affected.
- Verification performed.
- Remaining platform or live-environment gaps.
- Screenshots for visible interface changes.

Keep generated build output out of commits. Do not include a version bump or edit the changelog for an ordinary pull request; the deploy command owns those files.

## Security issues

Do not disclose a suspected vulnerability in a public issue. Follow [SECURITY.md](SECURITY.md).
