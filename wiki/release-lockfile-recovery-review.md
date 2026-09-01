---
name: Release Lockfile Recovery Review
description: Adversarial ship review of strict npm lock protection and immutable-tag GitHub Actions recovery after the v0.2.30 failure.
type: review
---

# Release Lockfile Recovery Review

### Executive Summary

**Ticket confidence: High**

The v0.2.30 failure is explained by exact evidence: commit `cd716ae` removed 195 lockfile lines
covering 13 packages, the local npm configuration reported `legacy-peer-deps=true`, and hosted npm
11.16 rejected the resulting lock before either desktop package could build. The repair restores the
same peer graph present in v0.2.29 and prevents a developer-level npm preference from changing project
lock semantics again.

The recovery design keeps the release tag immutable. GitHub executes the current workflow definition,
validates an existing annotated `vX.Y.Z` target, and then checks out that target in every build and
release job. `scripts/deploy.mjs` ignores the earlier failed run only after it successfully requests a
new recovery run. Local signed macOS artifacts are still built from the tag in a disposable worktree.
No renderer, server, database, updater runtime, or application package source changed.

### Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | `.npmrc`, `scripts/release-check.mjs`, and the strict `npm ci` dry run close the original lockfile path. `.github/workflows/build-desktop.yml` and `ensureReleaseRecoveryWorkflow()` preserve tag identity through recovery. |
| Regression risk (UI / backend / contracts) | Green | The blast radius is release tooling only. The full 1,787-test application suite passes after an actual strict clean install. |
| Gap risk (edge cases, error handling, completeness) | Amber | The workflow expressions and scripts are unit-evaluated and YAML-parsed, but only a real GitHub dispatch can prove the hosted handoff. This is the required post-commit mitigation. |
| Code quality (maintainability as safety) | Green | Recovery is explicit, one malformed tag is named in one bounded set, inputs are stable-tag validated, and same-tag workflow runs are serialized. |
| Unit tests | Green | Sixteen focused release-tooling tests cover lock peers, annotated-tag validation, run selection, stale-run exclusion, publication state, and static orchestration contracts. |
| Performance & scalability (if applicable) | Green | One small target job and one bounded 100-run REST read per 20-second publication poll are insignificant beside native packaging. Same-tag concurrency is serialized. |

### Top 3 Risks

1. `.github/workflows/build-desktop.yml` depends on GitHub's hosted expression and action behavior.
   Local YAML and embedded-script tests cannot replace one real recovery dispatch.
2. `PEER_LOCK_REPAIR_TAGS` in `scripts/deploy.mjs` intentionally names only `v0.2.30`. A different
   historical malformed lock must fail loudly and receive its own reviewed repair rule.
3. `releaseWorkflowRuns()` reads the newest 100 runs. An old failed tag can fall outside that window,
   but recovery then dispatches a new named run, so the old run is not needed for progress.

### Top Improvements

1. Complete one real `v0.2.30` recovery dispatch and verify the Windows draft plus final stable assets.
2. Keep dependency-update CI on strict `npm ci` so the project `.npmrc` and restored peer closure are
   exercised before another merge.
3. Remove the v0.2.30 repair exception only after historical recovery is no longer operationally
   necessary; never rewrite the tag merely to simplify the code.

### Recommendation

**Ship with Mitigations.** Commit and push the reviewed release-tooling fix, then use
`npm run deploy -- --recover-only` as the end-to-end hosted verification. Stop and keep the release
draft or pending if any target, build, asset, or signature check fails.

---

### Confirmed Issues

- The first review pass found that `scripts/release-check.mjs` accepted a file containing both
  `legacy-peer-deps=false` and a later conflicting value. It now requires the trimmed `.npmrc` to be
  exactly one setting.
- The first review pass found that two manual recovery dispatches could update the same draft
  concurrently. The workflow now serializes by target tag with `cancel-in-progress: false`.
- Recover-only dry runs printed the terminal no-write message twice. The caller now relies on the
  existing recovery message and adds no duplicate.

### Suspected Issues & Edge Cases

- A recovery run already in progress is watched rather than duplicated. If it later fails, deploy
  exits nonzero; the next explicit recover-only invocation dispatches the current workflow again.
- A missing or unreadable Actions run list causes a recovery dispatch attempt. GitHub CLI failure is
  loud, and no release assets are published before a successful Windows draft exists.
- A lightweight tag, branch name, prerelease, empty input, or injected shell text fails in the target
  job before checkout. Shell steps consume only the validated stable-tag output.
- A second queued recovery for the same tag waits. If the first publishes completely, the later
  release-state check leaves the live updater assets untouched.

### Regression Risks

- Normal tag pushes now add a target-validation job and explicitly run strict peer resolution. A
  missing or lightweight tag fails earlier and more clearly than before.
- Workflow run selection now accepts a specifically named recovery dispatch whose run SHA is `main`,
  while normal tag selection still requires the original tag SHA and branch. An unrelated dispatch,
  CI run, tag, or SHA cannot satisfy the watch.
- `--recover-only` changes only what happens after the pending suffix is complete. Default deploy
  behavior still proceeds to newer commits, preserving the existing automation contract.
- Application runtime behavior, public updater feed contents, database state, and renderer contracts
  are unchanged.

### Performance Risks

Run selection is O(100) per poll and release asset checks remain bounded by GitHub's release asset
list. Packaging and upload dominate runtime. The new target job makes one tag-ref API request. No
application hot path changed.

### Test Gaps

The unit suite cannot execute GitHub-hosted Windows packaging, create the draft through
`softprops/action-gh-release`, or prove authenticated local publication. Those are integration gates,
not unit-testable branches, and recover-only performs them before completion.

**Are there adequate UNIT tests? Yes.** The pure selection and publication decisions, embedded target
validator, lock invariants, workflow shape, tag checkout, recovery repair, stale-run boundary, and
recover-only wiring are covered. Remaining uncertainty belongs to the hosted integration.

### Positive Improvements

- The project, not a user's global npm preference, now owns peer-dependency semantics.
- Release metadata checking names the missing builder peer before a tag is created.
- Deploy performs a strict clean-install proof before release mutation.
- Failed tagged workflows can adopt corrected orchestration without moving the tag or building
  application source from `main`.
- Same-tag recovery is serialized, retryable, and bounded by the existing draft-first publication
  contract from [[open-source-releases]] and [[desktop-updates]].

Related: [[open-source-releases]], [[desktop-updates]], [[desktop-packaging-review]], [[source-release-readiness-review]]

#relay #release #review #github-actions #npm #lockfile #recovery
