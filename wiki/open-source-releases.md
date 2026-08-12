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

The root [[../README|README]] is the compact public front door. It leads with the platform warning, latest-release download, and `docs/assets/cc-relay-overview.png`, then keeps six numbered benefits, packaged setup, the product loop, a two-sentence safety model, development, contributing, and licensing concise. The selected image is the later `OnPaste.20260812-005444.png` attachment; the earlier screenshot was replaced and is not retained as a second repository asset.

> [!important]
> **August 12: the README no longer documents updates or release deployment.** The auto-update
> matrix lives in [[desktop-updates]] and the `npm run deploy` contract lives in this page, so the
> public front door does not repeat either. Safety collapsed to the caution callout plus one
> sentence on loopback binding, CLI-held credentials, local task data, and proven terminal
> ownership. **The loop** now sells the day-to-day experience: parallel projects, queue-on-capacity,
> completion sound and Launchpad notifications, colorized output with the Messages filter, and a
> fresh session per task that keeps context clean and can be continued later. Every claim there maps
> to shipped behavior in [[task-completion-alerts]], [[launchpad-completion-notifications]],
> [[claude-terminal-live-output]], and [[same-task-session-continuation]]; do not add a README claim
> without a wiki page behind it.

Release tooling asserts the README shape. `test/release-tooling.test.mjs` pins the platform warning,
download link, image order, the six benefit lead sentences in order, the disposable-terminal wording,
the MIT-retention sentence, and the **Get started** / **Development** split. `scripts/release-check.mjs`
pins the PolyForm license sentence and forbids the phrase "open source". Trim the README against those
checks, not around them.

> [!important]
> **Get started** is reserved for people running a packaged desktop release. It links to the latest GitHub Release, explains how to launch the macOS DMG or Windows Setup and Portable executables, and states the provider CLI prerequisite. Source checkout, Node.js, localhost, and Electron development commands belong only under **Development**.

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

`src/changelog-notes.mjs` owns the shared schema, normalization, section ordering, and Markdown formatting for deploy and [[daily-standup]]. Changes to those constraints must keep release and in-app output aligned.

This invocation follows the official Codex non-interactive pattern and reuses the user's saved CLI authentication. See [[daily-standup]] for the similar isolated provider pattern used inside the application.

## GitHub release handoff

Pushing `vX.Y.Z` starts `.github/workflows/build-desktop.yml`. The Ubuntu release job runs `release:check -- --tag`, extracts only the matching changelog body, downloads native artifacts, and publishes that body with the GitHub Release. GitHub's automatically generated notes are disabled so there is one canonical compact narrative.

The native jobs transfer only DMG, EXE, blockmap, and Windows `latest.yml` deliverables. Unpacked application trees, macOS ZIP packages, the unusable DMG-only `latest-mac.yml`, and builder diagnostics are excluded. NSIS and portable Windows targets have distinct `-Setup.exe` and `-Portable.exe` names, preventing one target from overwriting the other before publication. GitHub still adds its generated source-code ZIP and tarball to every release.

> [!note]
> Packaged macOS and Windows portable builds discover a newer stable version through GitHub's latest-release API, then link to the exact release for manual installation. This discovery is deliberately independent of electron-builder feed metadata. Only installed Windows NSIS builds consume `latest.yml` for automatic download and restart installation. See [[desktop-updates]].

`electron-builder.yml` now publishes to owner `Crowie-s-r-o`, repository `CC-Relay`. Installed Windows builds produced before this move still contain the old publisher and need one manual installation to enter the new update lineage. See [[desktop-updates]] and [[product-naming]].

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

## Commit attribution

Every commit in the published history is authored by the maintainer alone. Assistant co-author trailers must not reach the repository.

> [!warning]
> `Co-Authored-By: Claude ...` and `Claude-Session: ...` trailers originally came from the Claude Code harness, not from repository code. The harness setting `"includeCoAuthoredBy": false` in `~/.claude/settings.json` suppresses them at the source and overrides the assistant's own commit-message instructions. The repository now also rejects assistant attribution independently.

GitHub builds the repository's **Contributors** list from commits on the default branch, so a single trailer on one commit is enough to publish a second contributor identity. The sidebar is a cached view and can keep showing a removed contributor for hours after a corrective force push. Verify locally with `git log origin/main --format=%B | grep -i claude`, never by reloading the repository page.

`v0.2.1` was the one affected commit pair. `git filter-branch --msg-filter` over `HEAD~2..HEAD` stripped both trailer lines while preserving author and committer identity and timestamps, and `main` plus the tag were force pushed atomically.

### Permanent attribution guard

The repository protects both Claude and Codex attribution at several boundaries:

- `AGENTS.md` and `CLAUDE.md` forbid assistants from changing the configured human identity or adding credit and session trailers.
- `.githooks/commit-msg` calls `scripts/check-commit-attribution.mjs` before a commit is created. `npm run hooks:install` enables it through the repository-local `core.hooksPath`; this clone has it enabled.
- `npm run attribution:check` scans reachable history for assistant authors, committers, credit trailers, and session trailers while allowing ordinary commit prose about Claude and Codex.
- CI uses a full checkout and runs the history scan. `npm run deploy` runs the same gate before creating a release commit.

> [!note]
> After the rewritten branch, tag, GitHub API, and pull-request refs were verified, the temporary `backup/pre-claude-trailer-strip` branch and `refs/original/refs/heads/main` were deleted. No named local ref contains the old attributed commit. The repository-wide test suite passes 1,239 of 1,239 tests with the guard installed.

### The sidebar keeps its own contributor record

Removing the trailer from git does not immediately clear the **Contributors** box, and reloading is not a test of anything. GitHub keeps three separate views of the same fact and they update at different speeds:

| Source | Behavior after a history rewrite |
| --- | --- |
| `gh api repos/OWNER/REPO/contributors` | Correct within minutes. |
| `https://github.com/OWNER/REPO/graphs/contributors-data` | Returns `202` while it recomputes, then `200` with the corrected set. Polling it forces the recompute. |
| `https://github.com/OWNER/REPO/_sidebar` | The record the overview sidebar actually renders. Returns `contributors.contributorCount` and a login list, answers `cache-control: no-cache`, and keeps the removed identity long after the other two are corrected. |

The overview page loads that sidebar through a deferred fetch, so the identity is absent from the anonymous page HTML and cannot be found by grepping it. Poll the endpoint directly instead:

```bash
curl -s -H 'Accept: application/json' https://github.com/OWNER/REPO/_sidebar \
  | python3 -c 'import json,sys; d=json.load(sys.stdin)["contributors"]; print(d["contributorCount"], [c["login"] for c in d["contributors"]])'
```

The `Accept` header is required. Without it the endpoint answers with an HTML fragment, and a browser user agent gets HTML even with the header.

Because it answers `no-cache`, a cache-busting query string, a hard reload, and a private window all still show the stale set. That is the point: the staleness is backend state, not an HTTP or browser cache, so nothing done from the client side moves it. Pushes to the default branch did not clear it either. Only GitHub's own recount does, with Support as the escalation if it outlives a day, since no public API purges the record.

Orphaned pre-rewrite commits also stay reachable on GitHub by SHA. They are invisible to the contributor computation but they are not deleted, and only GitHub Support can garbage collect them.

> [!important]
> GitHub Support ticket [#4656799](https://support.github.com/ticket/personal/0/4656799) was opened under `Crowie s.r.o.` after a repeat audit showed the sidebar still wrong. At submission time the REST contributors API returned only `pkelemen`, the recomputed contributor graph returned only `pkelemen` with 20 commits, the only branch and both tags were clean, and all five closed pull request refs were clean. The ticket asks GitHub to purge or recalculate the sidebar record and, if possible, garbage collect orphaned commit `844fdb999532e43ba9d12ebb12d585bd11346673`. GitHub's guided Support analysis stated that there is no self-service purge and that contributor displays can take about 24 hours to refresh after a history rewrite. The ticket is open pending GitHub action.

### Rewriting released history moves the tag too

`releaseTags()` in `scripts/deploy.mjs` selects candidates with `git tag --merged HEAD`. A rewritten `main` orphans any tag that still points at the pre-rewrite commit, so the newest release tag stops being an ancestor, `latestTag` falls back to the previous version, and the next `npm run deploy` dies on `Latest tag vX does not match package version vY`. Leaving the tag behind is not a cosmetic choice; it breaks the release command.

Move the tag with `--tag-name-filter cat` and push both refs together:

```bash
git push --atomic --force-with-lease=refs/heads/main:<old-sha> \
  origin refs/heads/main:refs/heads/main +refs/tags/v0.2.1:refs/tags/v0.2.1
```

Accept the consequence: `build-desktop.yml` triggers on `v*` tag pushes, so moving a release tag re-runs the whole macOS and Windows build. `softprops/action-gh-release` updates the existing release in place rather than failing, so the rerun republishes identical artifacts and repoints the release at the rewritten commit. Take a local backup branch before any rewrite of published history.

## Remaining operator work

- Configure branch protection and require the macOS CI check after the first push.
- Add trusted Apple signing and notarization before presenting macOS artifacts as production-installable.
- Add trusted Windows signing only after real Windows end-to-end validation.
- Validate Linux localhost and terminal behavior before changing its platform status.

Related: [[licensing]], [[desktop-updates]], [[product-naming]], [[desktop-packaging-review]], [[diagnostics]]

#relay #git-history #attribution #source-available #noncommercial #release #semver #changelog #github #polyform
