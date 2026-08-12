---
name: Source Release Readiness Review
description: Adversarial ship review for the first public CC Relay version, updater, deployment workflow, documentation, license, and desktop artifacts.
type: review
tags:
  - relay
  - release
  - review
  - security
  - desktop
---

# Source Release Readiness Review

## Executive Summary

CC Relay is ready to ship as pre-1.0 source-available software once the release tag and GitHub Actions jobs complete. The local release path is cohesive: `npm run deploy` owns SemVer, isolated AI changelog generation, metadata checks, all tests, dependency auditing, the release commit, annotated tag, and atomic GitHub push. The desktop updater exposes only normalized state and trusted `Crowie-s-r-o/CC-Relay` links to the loopback renderer.

The product claims in the README were traced to runtime code. Project-scoped provider limits, slot-gated fresh terminals, background launch, default cleanup, same-conversation continuation, isolated project queues, Plan council, and Turbo all have direct implementation and test evidence. See [[core-product-story]].

The release must remain candid about three boundaries: Windows and Linux are untested, GitHub-hosted artifacts do not yet have a configured Developer ID and notarization pipeline, and PolyForm Noncommercial is source-available rather than OSI open source.

## Quality Panel

| Area | State | Evidence |
| --- | --- | --- |
| Correctness | Green | Full suite passes 1,232 of 1,232; the focused updater, deploy, Claude, and Turbo group passes 241 of 241. |
| Security | Amber | Loopback-only server, trusted update URL normalization, no credential-shaped tracked secrets, and zero dependency advisories. Writable provider sessions still use unattended permissions by design. |
| Release integrity | Amber | Atomic branch and tag push, tag-to-version enforcement, packaged-only asset globs, and unique Windows artifact names are covered. Public signing and notarization credentials are not configured. |
| UX | Green | Compact README, selected overview image, top-level latest-release link, and visible update state were checked at desktop and compact widths in light and dark themes. |
| Platform coverage | Amber | Real macOS package build and signature verification pass. Windows has simulated tests only; Linux desktop packages are not produced. |
| Maintainability | Green | Release, updater normalization, UI presentation, and Turbo render signatures are separated into testable modules and documented in the wiki. |

## Top 3 Risks

1. **Public artifact trust.** The local macOS bundle signs successfully with an Apple Development identity, but the GitHub repository has no release secrets configured. CI artifacts can therefore lack Developer ID signing and notarization, which affects Gatekeeper trust and reliable automatic installation.
2. **Untested platforms.** Windows command shaping and packaging are extensively simulated, but no real-machine smoke run has occurred. Linux has no claimed desktop lifecycle support.
3. **License expectations.** PolyForm Noncommercial permits modification and redistribution for permitted noncommercial purposes but is not OSI open source. Copies previously received under MIT keep those rights. Public wording must remain source-available and must not imply retroactive withdrawal.

## Top Improvements

1. Add a documented Developer ID signing and Apple notarization setup for the release workflow, then verify update installation from one published version to the next.
2. Complete the first five release-gate items in [[windows-compatibility]] on a real Windows machine and attach the evidence to the release.
3. Enable repository secret scanning and push protection when the GitHub organization plan supports them, then add a protected release path after confirming it remains compatible with the atomic deploy command.

## Recommendation

**Ship with explicit pre-1.0 caveats.** The source, metadata, docs, tests, local package, and release automation are fit for the first public version. Treat GitHub Actions completion, exact asset inspection, and the latest-release link as the final release gate. Do not describe Windows, Linux, notarization, or unattended provider execution more strongly than the README does today.

## Confirmed Issues

- Public GitHub Actions signing and notarization credentials are absent.
- Windows and Linux have not been tested on their target operating systems.
- Linux desktop packages are not produced.
- The software intentionally starts writable provider sessions with broad unattended permissions.
- The current license is source-available and noncommercial, not OSI open source.

## Suspected Issues and Edge Cases

- macOS automatic installation may reject or fail on unsigned public CI artifacts even though update discovery and the visible release link still work.
- A delayed Claude Stop hook from an older prompt that crosses an entire accepted turn while background work remains pending could be treated as a newer boundary. This transport ordering is considered implausible and is documented in [[claude-stale-background-stop-hook]].
- A GitHub API outage, missing update metadata, or unavailable AI CLI fails the corresponding check or deployment rather than silently producing a release. This is safe but requires operator retry.
- AI release notes are schema-bound, length-bound, plain-text-only, and derived from bounded history, but factual emphasis is still model judgment. The deploy command prints the entry before committing yet does not pause for interactive approval.
- A first release has no prior tag, so AI notes are generated from the complete reachable history. The prompt input is bounded and treated as untrusted data.

## Regression Risks

- Changing the release artifact globs back to `dist/**` would publish unpacked application internals.
- Removing the distinct `Setup` and `Portable` Windows names would cause the two `.exe` targets to overwrite or collide.
- Moving the desktop update state into an unvalidated renderer payload would permit misleading external links.
- Reverting background launch or terminal-retention defaults would make the second core README claim false.
- Unscoped Turbo council CSS can change the Execute Plan council control because both surfaces share classes.

## Performance Risks

- Update state normalization and presentation are constant-size operations and add no polling loop beyond the existing status refresh.
- Turbo's render signature avoids rebuilding six controls on unchanged polling snapshots. Hash collisions are theoretically possible with a 32-bit fold, but only cause a stale render until an input changes again.
- Release builds sign many nested Electron resources and can take several minutes locally. This is build-time cost only.

## Test Gaps

- End-to-end update from one signed and notarized public macOS release to the next.
- Real Windows NSIS install, portable launch, terminal lifecycle, and updater behavior.
- Linux source-mode smoke run and any future desktop terminal lifecycle.
- GitHub-hosted release job and asset publication, which can only be proven after the tag is pushed.
- Manual assistive-technology pass for the compact update indicator and Turbo controls.

## Positive Improvements

- One command now creates a versioned, AI-documented, verified, atomic release.
- Update lifecycle state is queryable, normalized, visible, and restricted to the official GitHub repository.
- Release jobs publish only installer, archive, blockmap, and update metadata files.
- The README now prioritizes the six operator outcomes that distinguish Relay.
- License, package metadata, lockfile, README, and release checks agree on PolyForm Noncommercial 1.0.0.
- Bundled font copyright notices and byte-identical upstream OFL 1.1 terms are present in both source and desktop package inputs.
- The local macOS package builds, signs, and passes strict deep signature verification.

Related: [[desktop-updates]], [[open-source-releases]], [[licensing]], [[desktop-packaging-review]], [[core-product-story]]

#relay #release #review #security #desktop
