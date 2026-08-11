---
name: Open Source Releases
description: MIT publication, repository readiness, Semantic Versioning, local AI changelog generation, and atomic GitHub releases.
type: decision
---

# Open Source Releases

CC Relay's public home is `https://github.com/Crowie-s-r-o/CC-Relay`. The August 12, 2026 publication state changes the project from a custom view-only license to the standard MIT License and introduces one guarded local release command.

> [!important]
> Real application and native-terminal validation has been performed only on macOS. Windows and Linux are explicitly unvalidated in the first README callout. Windows unit fixtures and packaging code do not justify a supported-platform claim.

## Public documentation contract

The root [[../README|README]] is the public front door. It leads with the platform warning, uses `docs/assets/cc-relay-overview.png` as its primary screenshot, explains the product loop and safety model, and documents setup, data, workflows, development, and releases. The selected image is the later `OnPaste.20260812-005444.png` attachment; the earlier screenshot was replaced and is not retained as a second repository asset.

[[../CONTRIBUTING|CONTRIBUTING]] documents focused changes, required verification, Conventional Commit signals, synthetic fixtures, and the rule that normal pull requests do not edit versions or the changelog. [[../SECURITY|SECURITY]] routes suspected vulnerabilities to GitHub's private advisory flow.

## Version and changelog contract

`package.json` is the application version source. `package-lock.json` must match both its top-level version and `packages[""]` version. The first heading in `CHANGELOG.md` must contain the same version and a compact set of supported sections: Added, Changed, Fixed, and Security.

The command is:

```bash
npm run release -- auto
```

It accepts `auto`, `patch`, `minor`, or `major`, plus `--provider codex|claude|auto` and `--dry-run`.

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
- Both run in a temporary directory and receive only bounded commit and changed-file data.
- The prompt labels every history string as untrusted data.
- Provider diagnostics stay buffered on successful generation, so the terminal never echoes the bounded source prompt.
- Deterministic code rejects unknown sections, non-text values, overlong items, empty results, duplicate facts, and more than eight bullets.
- Provider failure stops the release without a deterministic fake changelog.

This invocation follows the official Codex non-interactive pattern and reuses the user's saved CLI authentication. See [[daily-standup]] for the similar isolated provider pattern used inside the application.

## GitHub release handoff

Pushing `vX.Y.Z` starts `.github/workflows/build-desktop.yml`. The Ubuntu release job runs `release:check -- --tag`, extracts only the matching changelog body, downloads native artifacts, and publishes that body with the GitHub Release. GitHub's automatically generated notes are disabled so there is one canonical compact narrative.

`electron-builder.yml` now publishes to owner `Crowie-s-r-o`, repository `CC-Relay`. Builds produced before this move still contain the old publisher and need one manual installation to enter the new update lineage. See [[desktop-updates]] and [[product-naming]].

## Readiness audit

The public-release audit found and resolved these concrete issues:

- The former license contradicted the open-source goal. It was replaced with MIT everywhere current behavior is described.
- The updater still pointed to `patrikkelemen/relay`. Package metadata, builder metadata, documentation, and the Git remote contract now point to `Crowie-s-r-o/CC-Relay`.
- Four tracked `.idea` files were removed and `.idea/` is ignored.
- A tracked `undefined/asar-src` packaging snapshot duplicated stale application source. The complete generated tree was removed and `/undefined/` is ignored.
- `scripts/install-plugin.mjs` hard-coded one user's home directory. It now derives both locations from the operating-system home directory.
- One untracked real incident fixture contained a personal path and real UUIDs. The public fixture preserves the event shape with synthetic values.
- `public/app.js` contained literal NUL and SOH delimiter bytes. They are now source-safe `\u0000` and `\u0001` escapes with identical runtime strings.
- Compatible Electron, WebSocket, and transitive dependency updates reduced `npm audit` from five advisories to zero.
- The public lockfile uses default peer-dependency semantics, so clean GitHub runners include the optional Windows builder peers instead of inheriting a developer machine's legacy install preference.
- GitHub workflows use the current Node 24 action generations for checkout, Node setup, artifact transfer, and release publishing.
- Changelog headings use the release operator's local calendar date instead of rolling back a day near midnight through UTC conversion.
- Current-tree and full-history scans found no credential-shaped private keys, cloud keys, GitHub tokens, OpenAI keys, Anthropic keys, or Slack tokens.
- Real no-tools structured-output smoke tests passed for both Codex and Claude using the exact release invocation flags.
- The final complete suite passes 1,194 of 1,194 tests, including six focused release-tooling tests. JavaScript syntax checks, YAML parsing, release metadata checks, documentation link checks, and `git diff --check` also pass.

> [!note]
> The initial 0.1.0 changelog was written by AI from the verified project capabilities. Future entries are generated by `scripts/release.mjs` and accepted only after deterministic normalization and the release gates.

## Remaining operator work

- Enable GitHub private vulnerability reporting if the organization repository does not already expose it.
- Configure branch protection and require the macOS CI check after the first push.
- Add trusted Apple signing and notarization before presenting macOS artifacts as production-installable.
- Add trusted Windows signing only after real Windows end-to-end validation.
- Validate Linux localhost and terminal behavior before changing its platform status.

Related: [[licensing]], [[desktop-updates]], [[product-naming]], [[desktop-packaging-review]], [[diagnostics]]

#relay #open-source #release #semver #changelog #github #mit
