---
name: Release Audit Gate and Transitive Advisories
description: How the deploy audit gate fails on electron-builder transitive advisories and the lockfile-only repair that clears it.
type: note
tags: [release, security, dependencies]
---

# Release Audit Gate and Transitive Advisories

> [!important]
> `npm run deploy` runs `npm audit --audit-level=high` as its last release gate
> (`scripts/deploy.mjs`). A single high advisory anywhere in the installed tree, including
> build-only devDependency subtrees, aborts the release with `Deploy failed: npm exited with status 1`.

## September 3 failure

The deploy stopped after a green 1,812-test run with two advisories:

| Package | Severity | Path |
| --- | --- | --- |
| `fast-uri` 3.1.5 | high | `electron-builder > app-builder-lib > ajv` |
| `@xmldom/xmldom` 0.8.13 | moderate | `electron-builder > app-builder-lib > plist` |

Only the high `fast-uri` finding actually tripped the `--audit-level=high` gate. Both packages are
reached exclusively through the `electron-builder` devDependency, so neither ships inside the runtime
or the packaged desktop app; the risk is confined to the packaging host.

## Repair

`npm audit fix` was sufficient. It moved `fast-uri` to 3.1.7 and `@xmldom/xmldom` to 0.8.15 by
rewriting six lockfile entries. `package.json` was not touched, `electron-builder` stayed on 26.15.3,
and no application source changed.

Verification after the fix:

- `npm ci --dry-run --ignore-scripts --legacy-peer-deps=false` clean (the strict lock gate from
  [[release-lockfile-recovery-review]])
- `npm run release:check` consistent for v0.2.30
- `npm test` 1,812 pass, 0 fail
- `npm audit --audit-level=high` 0 vulnerabilities
- `git diff --check` clean
- `npx electron-builder --version` still resolves 26.15.3

## Rule for next time

> [!note]
> When the audit gate fails on a transitive devDependency, prefer the lockfile-only `npm audit fix`.
> Check `npm ls <package>` first to confirm the advisory is build-only. Do not bump
> `electron-builder` itself, and do not touch versions or `CHANGELOG.md`: those belong to
> `npm run deploy`. See [[open-source-releases]].
