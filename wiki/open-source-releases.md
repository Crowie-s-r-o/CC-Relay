---
name: Source-Available Releases
description: PolyForm Noncommercial publication, repository readiness, Semantic Versioning, local AI changelog generation, and atomic GitHub releases.
type: decision
---

# Source-Available Releases

CC Relay's public home is `https://github.com/Crowie-s-r-o/CC-Relay`. The current publication state uses the PolyForm Noncommercial License 1.0.0 and one guarded local deploy command. The historical page filename remains unchanged so existing wiki links stay valid.

> [!important]
> Real application and native-terminal validation has been performed only on macOS. Windows and Linux are explicitly unvalidated in the first README callout. Windows unit fixtures and packaging code do not justify a supported-platform claim.

## Public documentation contract

The root [[../README|README]] is the compact public front door. It leads with the platform warning, latest-release download, and `docs/assets/cc-relay-overview.png`, then keeps the product loop, safety model, setup, updates, development, and release operation concise. The selected image is the later `OnPaste.20260812-005444.png` attachment; the earlier screenshot was replaced and is not retained as a second repository asset.

[[../CONTRIBUTING|CONTRIBUTING]] documents focused changes, required verification, Conventional Commit signals, synthetic fixtures, and the rule that normal pull requests do not edit versions or the changelog. [[../SECURITY|SECURITY]] routes suspected vulnerabilities to GitHub's private advisory flow.

## Version and changelog contract

`package.json` is the application version source. `package-lock.json` must match both its top-level version and `packages[""]` version. The first heading in `CHANGELOG.md` must contain the same version and a compact set of supported sections: Added, Changed, Fixed, and Security.

The command is:

```bash
npm run deploy
```

It defaults to `auto` and accepts `auto`, `patch`, `minor`, or `major`, plus `--provider codex|claude|auto` and `--dry-run`.

Automatic version intent is deterministic:

| Commit evidence | Bump |
| --- | --- |
| `type!:` or `BREAKING CHANGE:` | major |
| `feat:` | minor |
| every other commit set | patch |

## Release sequence

1. Require a clean `main` branch and the expected `origin` repository.
2. Fetch `origin/main` and tags, then require the remote branch to be an ancestor of local `HEAD`.
3. Require the latest reachable SemVer tag to match the package version.
4. Collect commits and changed-file evidence since the latest tag.
5. Generate structured release notes through an isolated local subscription CLI.
6. Normalize the notes to one to eight short, deduplicated facts.
7. Update `package.json`, `package-lock.json`, and `CHANGELOG.md` together.
8. Run `release:check`, the complete test suite, and `npm audit --audit-level=high`.
9. Create `chore(release): vX.Y.Z` and an annotated `vX.Y.Z` tag.
10. Push `main` and the tag with one atomic Git operation.

The version files are restored if a gate fails before the release commit. If the commit and tag are valid but GitHub rejects the push, they remain locally so the operator can retry the exact atomic push without regenerating notes or changing the version.

## AI generation boundary

Release notes require AI on every release, but no API key or project environment variable is introduced.

- Codex is attempted first by default through `codex exec` with an ephemeral session, ignored repository rules, disabled tools, read-only sandboxing, and an output JSON Schema.
- Claude is the fallback through non-persistent print mode, no tools, strict empty MCP configuration, plan permissions, and the same output schema.
- Both run in a temporary directory and receive only bounded commit and changed-file data. At most the newest 100 commits are included, with an explicit omitted count when a release range is larger.
- The prompt labels every history string as untrusted data.
- Provider diagnostics stay buffered on successful generation, so the terminal never echoes the bounded source prompt.
- Deterministic code rejects unknown sections, non-text values, control characters, links, HTML, overlong items, empty results, duplicate facts, and more than eight bullets.
- Provider failure stops the release without a deterministic fake changelog.

This invocation follows the official Codex non-interactive pattern and reuses the user's saved CLI authentication. See [[daily-standup]] for the similar isolated provider pattern used inside the application.

## GitHub release handoff

Pushing `vX.Y.Z` starts `.github/workflows/build-desktop.yml`. The Ubuntu release job runs `release:check -- --tag`, extracts only the matching changelog body, downloads native artifacts, and publishes that body with the GitHub Release. GitHub's automatically generated notes are disabled so there is one canonical compact narrative.

The native jobs transfer only DMG, ZIP, EXE, blockmap, and `latest*.yml` deliverables. Unpacked application trees and builder diagnostics are excluded. NSIS and portable Windows targets have distinct `-Setup.exe` and `-Portable.exe` names, preventing one target from overwriting the other before publication.

`electron-builder.yml` now publishes to owner `Crowie-s-r-o`, repository `CC-Relay`. Builds produced before this move still contain the old publisher and need one manual installation to enter the new update lineage. See [[desktop-updates]] and [[product-naming]].

## Readiness audit

The public-release audit found and resolved these concrete issues:

- The brief MIT publication state was superseded by PolyForm Noncommercial 1.0.0. Current public wording says source-available, permits noncommercial modification and redistribution, and requires separate written permission for business use.
- The updater still pointed to `patrikkelemen/relay`. Package metadata, builder metadata, documentation, and the Git remote contract now point to `Crowie-s-r-o/CC-Relay`.
- Four tracked `.idea` files were removed and `.idea/` is ignored.
- A tracked `undefined/asar-src` packaging snapshot duplicated stale application source. The complete generated tree was removed and `/undefined/` is ignored.
- `scripts/install-plugin.mjs` hard-coded one user's home directory. It now derives both locations from the operating-system home directory.
- One untracked real incident fixture contained a personal path and real UUIDs. The public fixture preserves the event shape with synthetic values.
- The three bundled webfonts had no repository notices. Instrument Sans, JetBrains Mono, and Source Serif 4 now have upstream copyright attribution and complete OFL 1.1 texts. Desktop packages include those files, the project license, and the third-party notice index.
- `public/app.js` contained literal NUL and SOH delimiter bytes. They are now source-safe `\u0000` and `\u0001` escapes with identical runtime strings.
- Compatible Electron, WebSocket, and transitive dependency updates reduced `npm audit` from five advisories to zero.
- The public lockfile uses default peer-dependency semantics, so clean GitHub runners include the optional Windows builder peers instead of inheriting a developer machine's legacy install preference.
- An isolated clean install with default peer-dependency semantics completed with zero advisories and included the Windows builder peer used by GitHub Actions.
- GitHub workflows use the current Node 24 action generations for checkout, Node setup, artifact transfer, and release publishing.
- Changelog headings use the release operator's local calendar date instead of rolling back a day near midnight through UTC conversion.
- Current-tree and full-history scans found no credential-shaped private keys, cloud keys, GitHub tokens, OpenAI keys, Anthropic keys, or Slack tokens.
- GitHub private vulnerability reporting is enabled, and the repository recognizes `SECURITY.md` as its security policy.
- Real no-tools structured-output smoke tests passed for both Codex and Claude using the exact release invocation flags.
- The final complete suite passes 1,232 of 1,232 tests. The focused updater, deploy, Claude boundary, and Turbo panel group passes 241 of 241, including nine deploy-tooling tests. JavaScript syntax checks, YAML parsing, release metadata checks, documentation link checks, and `git diff --check` also pass.
- A clean macOS arm64 build produced DMG, ZIP, blockmaps, and update metadata. Strict deep code-sign verification, DMG checksum verification, ZIP integrity, and an exact packed `src/` plus `public/` comparison pass. The local identity is Apple Development, and notarization is not configured.

> [!note]
> The initial 0.1.0 changelog was written by AI from the verified project capabilities. Future entries are generated by `scripts/deploy.mjs` and accepted only after deterministic normalization and the release gates.

## Remaining operator work

- Configure branch protection and require the macOS CI check after the first push.
- Add trusted Apple signing and notarization before presenting macOS artifacts as production-installable.
- Add trusted Windows signing only after real Windows end-to-end validation.
- Validate Linux localhost and terminal behavior before changing its platform status.

Related: [[licensing]], [[desktop-updates]], [[product-naming]], [[desktop-packaging-review]], [[diagnostics]]

#relay #source-available #noncommercial #release #semver #changelog #github #polyform
