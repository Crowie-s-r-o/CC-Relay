---
name: CC Relay Product Naming
description: Product display naming, release artifact naming, and stable compatibility identifiers.
type: architecture
---

# CC Relay Product Naming

The complete user-facing product name is **CC Relay**.

## Display contract

- `package.json` uses npm name `cc-relay` and product name `CC Relay`.
- `electron-builder.yml` uses `productName: CC Relay`.
- macOS bundle display name, executable, application menu, About item, helper applications, and DMG volume use `CC Relay`.
- `src/electron-main.mjs` calls `app.setName('CC Relay')` before Electron creates its default macOS menu.
- The native window, browser title, in-app heading, update prompts, diagnostics, generated provider notices, user-facing messages, documentation, and numbered terminal labels use `CC Relay`.
- GitHub Actions uploads use the machine-safe `cc-relay-<runner-os>` name.

> [!important]
> macOS releases publish only `CC-Relay-${version}-${os}-${arch}.dmg`. Windows NSIS and portable files append `-Setup` and `-Portable` so their shared `.exe` extension cannot collide. When `artifactName` contained a space, electron-builder emitted files with spaces but normalized update-feed URLs to hyphens. The explicit hyphenated forms keep artifact names and feed URLs identical.

## Compatibility contract

The rename does not change identifiers that would disconnect an installation from its saved state or update lineage:

- bundle identifier `com.relay.queue`
- command-line flags and local protocol names beginning with `relay`
- existing application-data directory `dual-agent-orchestrator`
- database filenames, API fields, CSS classes, and source-code symbols

`src/electron-main.mjs` explicitly maps Electron `userData` to the established application-data directory before assigning the display name. It creates the directory for a new installation. Existing projects, task history, settings, diagnostics, and updater state therefore remain visible after the rename. See [[shared-project-configuration]] and [[desktop-updates]].

The public source-available repository and updater publisher moved from `patrikkelemen/relay` to `Crowie-s-r-o/CC-Relay` on August 12, 2026. A desktop build embeds its publisher at package time, so an older build that still points to the former repository needs one manual install of a new release before it can follow the new update feed.

## Verification

The July 28, 2026 macOS arm64 verification build was written to `dist/cc-relay-verification` because the active orchestrator was running from the old standard output bundle.

- all 770 repository tests passed
- `CC Relay.app` was signed and passed strict recursive code-signature verification
- `CFBundleDisplayName`, `CFBundleName`, and `CFBundleExecutable` were `CC Relay`
- packaged `package.json` contained npm name `cc-relay` and product name `CC Relay`
- packaged Electron startup contained `app.setName(PRODUCT_NAME)`
- the DMG checksum and ZIP integrity passed
- every `latest-mac.yml` artifact URL resolved to an identically named local file

> [!note]
> The old standard `dist/mac-arm64/Relay.app` was not replaced while it was running. After that process exits, a normal `npm run desktop:build:mac` can refresh the standard output directory safely.

#cc-relay #desktop #electron #packaging #branding #compatibility
