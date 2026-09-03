---
name: macOS DMG Presentation
description: Branded Finder layout and helper-file-free packaging for the CC Relay disk image.
type: architecture
---

# macOS DMG Presentation

CC Relay's macOS disk image uses Finder's native background color instead of a raster background file. The configuration lives in [[../electron-builder.yml|electron-builder.yml]]:

- `dmg.backgroundColor` is `#e8eaef`, a cool graphite tint derived from the monochrome Crowie identity.
- `dmg.icon` is `null`, which disables the mounted-volume icon.
- The volume title is `CC Relay`.
- The Finder window is 640 by 380 points.
- CC Relay and Applications use 96-point icons centered at x positions 160 and 480.

This produces a quiet branded install surface while keeping CC Relay and Applications as the only volume entries apart from Finder's `.DS_Store`.

> [!important]
> Do not replace `backgroundColor` with `background` unless a visible helper file is acceptable. `dmg-builder` copies raster artwork to the volume root as `.background.tiff`. Finder reveals that file when the user enables hidden-file display.

> [!important]
> Keep `dmg.icon: null` if the volume root must stay clean. Allowing the default DMG icon creates `.VolumeIcon.icns`, which Finder also reveals when hidden-file display is enabled. The application itself uses the tracked `build/icon.icns` through the separate `mac.icon` setting described in [[macos-app-icon]] and [[desktop-updates]].

## Validation

The July 28, 2026 arm64 build was validated with:

- focused packaging tests in `test/desktop-icon.test.mjs`
- a successful signed app build
- a DMG checksum verification
- strict recursive code-signature verification
- a mounted volume listing containing only `.DS_Store`, `CC Relay.app`, and the Applications link
- a real Finder inspection with hidden-file display enabled, showing only CC Relay and Applications

The rebuilt artifact is `dist/CC-Relay-0.1.0-mac-arm64.dmg`.

See [[desktop-packaging-review]] for broader packaged-runtime checks and [[desktop-updates]] for the release and signing contract.

#relay #desktop #macos #dmg #packaging #design
