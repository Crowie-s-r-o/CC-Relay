#!/usr/bin/env node

// Rebuilds build/icon.icns from build/icon.png with Apple's own iconset pipeline.
//
// electron-builder derives its own icns when `mac.icon` points at a PNG, and 26.15.3 writes
// `ic13` at 512 pixels and `ic14` at 1024 pixels. The specification requires 256 and 512. Loaded
// directly, AppKit then reports fractional logical sizes for the 256px and larger representations
// and loses @2x pairing at every level, 16pt and 32pt included. `sips` plus `iconutil` produce a
// conforming file, so the repository ships the icns itself.
//
// macOS only, and deliberately not part of `npm test`: the suite must stay portable.
// See wiki/macos-app-icon.md.

import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertIcnsGeometry, formatIcnsGeometry, readPngSize } from './icns-geometry.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(projectRoot, 'build/icon.png');
const outputPath = resolve(projectRoot, 'build/icon.icns');
const SOURCE_PIXELS = 1024;

// The ten canonical iconset entries. `iconutil` maps these to ic07/ic08/ic09/ic10 and the
// ic11/ic12/ic13/ic14 retina slots, and adds the ic04/ic05 raw-ARGB entries itself. It never
// emits the icp4, icp5, or icp6 PNG slots at all: 16pt and 32pt reach macOS through the ic04 and
// ic05 raw-ARGB entries, and the iconset's 64-pixel `icon_32x32@2x.png` member is mapped to ic12
// rather than to icp6. All of that is correct `iconutil` output.
const ICONSET_ENTRIES = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png'],
];

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error?.code === 'ENOENT') {
    throw new Error(`${command} is not available. This script needs the macOS command line tools.`);
  }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    const detail = output.split(/\r?\n/).filter(Boolean).at(-1);
    throw new Error(detail || `${command} exited with status ${result.status}.`);
  }
  return `${result.stdout || ''}`.trim();
}

// `sips -z 1024 1024` upscales a smaller source without complaining, and the geometry validator
// would still pass because every slot would carry its required pixel size. Only the source can
// catch that, so refuse anything but a real 1024 pixel PNG before any resampling happens.
function assertSourceGeometry() {
  const size = readPngSize(readFileSync(sourcePath));
  if (!size) {
    throw new Error(`${sourcePath} is not a readable PNG.`);
  }
  if (size.width !== SOURCE_PIXELS || size.height !== SOURCE_PIXELS) {
    throw new Error(
      `${sourcePath} is ${size.width}x${size.height}, but the icon source must be `
      + `${SOURCE_PIXELS}x${SOURCE_PIXELS} so that sips only ever downsamples it.`,
    );
  }
}

function main() {
  if (process.platform !== 'darwin') {
    throw new Error('build/icon.icns can only be regenerated on macOS, where sips and iconutil exist.');
  }
  if (!existsSync(sourcePath)) {
    throw new Error(`Missing icon source ${sourcePath}.`);
  }
  assertSourceGeometry();

  const workRoot = mkdtempSync(join(tmpdir(), 'cc-relay-icon-'));
  try {
    // iconutil only accepts a directory whose name ends in .iconset.
    const iconsetPath = join(workRoot, 'icon.iconset');
    mkdirSync(iconsetPath);
    for (const [pixels, name] of ICONSET_ENTRIES) {
      run('/usr/bin/sips', [
        '-s', 'format', 'png',
        '-z', String(pixels), String(pixels),
        sourcePath,
        '--out', join(iconsetPath, name),
      ]);
    }

    const candidatePath = join(workRoot, 'icon.icns');
    run('/usr/bin/iconutil', ['-c', 'icns', iconsetPath, '-o', candidatePath]);

    // Validate before writing: a rejected candidate must never replace a good tracked icon.
    const candidate = readFileSync(candidatePath);
    assertIcnsGeometry(candidate);

    // Write through a sibling temp file and rename into place. A copy interrupted part way would
    // otherwise leave a truncated binary at a tracked path, where it is easy to commit unnoticed.
    // The temp file is a sibling on purpose: rename is only atomic within one filesystem.
    const stagingPath = `${outputPath}.${process.pid}.tmp`;
    try {
      writeFileSync(stagingPath, candidate);
      renameSync(stagingPath, outputPath);
    } catch (error) {
      rmSync(stagingPath, { force: true });
      throw error;
    }

    console.log(formatIcnsGeometry(candidate));
    console.log(`Wrote ${outputPath} from ${sourcePath}.`);
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
