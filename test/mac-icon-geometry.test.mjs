import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ICNS_PNG_SLOT_SIZES,
  ICNS_REQUIRED_PNG_SLOTS,
  assertIcnsGeometry,
  describeIcnsGeometry,
  readIcnsChunks,
} from '../scripts/icns-geometry.mjs';

// Pure Node on purpose. This runs on Windows and Linux CI, where sips, iconutil, and AppKit do
// not exist, and it is the regression pin for build/icon.icns: an electron-builder derivation
// writes ic13 at 512 and ic14 at 1024 pixels and fails here.

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const iconPath = join(projectRoot, 'build', 'icon.icns');
const icon = readFileSync(iconPath);

function rebuildIcns(chunks) {
  const bodies = chunks.map(({ type, payload }) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(payload.length + 8, 4);
    return Buffer.concat([header, payload]);
  });
  const body = Buffer.concat(bodies);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}

// The validator reads a PNG header and never decodes pixels, so a 24-byte stub is a faithful
// stand-in for a real image when the point of the case is the declared geometry.
function syntheticPng(pixels) {
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png, 0);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 4, 'ascii');
  png.writeUInt32BE(pixels, 16);
  png.writeUInt32BE(pixels, 20);
  return png;
}

test('the tracked macOS icns is a well formed icns container', () => {
  assert.equal(icon.toString('ascii', 0, 4), 'icns');
  assert.equal(icon.readUInt32BE(4), icon.length);

  const chunks = readIcnsChunks(icon);
  assert.ok(chunks.length > 0);
  // Every chunk length accounts for its own eight-byte header, so the chunks tile the file exactly.
  assert.equal(chunks.reduce((total, chunk) => total + chunk.length, 8), icon.length);
});

test('every PNG slot in the macOS icns carries the pixel size its OSType requires', () => {
  const { entries } = describeIcnsGeometry(icon);
  const pngEntries = entries.filter((entry) => entry.kind === 'png');
  assert.ok(pngEntries.length >= ICNS_REQUIRED_PNG_SLOTS.length);

  for (const entry of pngEntries) {
    const required = ICNS_PNG_SLOT_SIZES[entry.type];
    assert.ok(required, `unknown PNG OSType ${entry.type}`);
    assert.equal(entry.width, entry.height, `${entry.type} PNG is not square`);
    assert.equal(entry.width, required, `${entry.type} PNG must be ${required} pixels wide`);
  }

  assert.doesNotThrow(() => assertIcnsGeometry(icon));
});

test('the macOS icns carries every required slot and tolerates the non-PNG entries', () => {
  const { entries } = describeIcnsGeometry(icon);
  const pngSlots = new Set(entries.filter((entry) => entry.kind === 'png').map((entry) => entry.type));
  for (const slot of ICNS_REQUIRED_PNG_SLOTS) {
    assert.ok(pngSlots.has(slot), `missing required PNG slot ${slot}`);
  }

  // iconutil adds ic04 and ic05 raw-ARGB entries plus an info bplist, and may add a table of
  // contents. Those are normal output, so tolerate the set rather than fingerprinting one release.
  const tolerated = entries.filter((entry) => entry.kind !== 'png').map((entry) => entry.type);
  for (const type of tolerated) {
    assert.ok(['ic04', 'ic05', 'info', 'TOC '].includes(type), `unexpected non-PNG entry ${type}`);
  }
  // 16pt and 32pt reach macOS through the raw-ARGB entries instead of icp4 and icp5 PNG slots.
  assert.ok(tolerated.includes('ic04'));
  assert.ok(tolerated.includes('ic05'));
});

test('the icns validator rejects the electron-builder retina sizes it exists to catch', () => {
  const chunks = readIcnsChunks(icon);
  const oversized = chunks.find((chunk) => chunk.type === 'ic14').payload;
  const defective = rebuildIcns(chunks.map((chunk) => (
    // Reproduce the electron-builder 26.15.3 defect: ic13 holding the 512 pixel image.
    chunk.type === 'ic13' ? { type: 'ic13', payload: oversized } : chunk
  )));

  assert.throws(() => assertIcnsGeometry(defective), /ic13 PNG is 512x512 but .* requires 256x256/);
});

test('the icns validator rejects a truncated header and a missing required slot', () => {
  const shortHeader = Buffer.from(icon);
  shortHeader.writeUInt32BE(icon.length - 1, 4);
  assert.throws(() => readIcnsChunks(shortHeader), /header declares/);

  const chunks = readIcnsChunks(icon);
  const withoutRetina = rebuildIcns(chunks.filter((chunk) => chunk.type !== 'ic11'));
  assert.throws(() => assertIcnsGeometry(withoutRetina), /required PNG slot ic11 is missing/);
});

test('ic04 and ic05 are measured against the specification if they ever carry a PNG', () => {
  // Today Apple writes raw ARGB into these slots, so they take the tolerated non-PNG path. If a
  // future iconutil writes PNG there, the diagnosis must be the wrong pixel size rather than
  // "unknown OSType carries a PNG payload", which would send the reader hunting a corrupt file.
  const chunks = readIcnsChunks(icon);
  const rewrite = (pixels) => rebuildIcns(chunks.map((chunk) => (
    chunk.type === 'ic04' ? { type: 'ic04', payload: syntheticPng(pixels) } : chunk
  )));

  assert.throws(() => assertIcnsGeometry(rewrite(32)), /ic04 PNG is 32x32 but .* requires 16x16/);
  assert.doesNotThrow(() => assertIcnsGeometry(rewrite(16)));
});

test('a required slot present with a non-PNG payload is not reported as missing', () => {
  // A legacy JPEG 2000 entry, or a PNG truncated below its own IHDR, leaves the OSType present.
  // The verdict is the same either way; only the wording tells the reader where to look.
  const chunks = readIcnsChunks(icon);
  const unreadable = rebuildIcns(chunks.map((chunk) => (
    chunk.type === 'ic11' ? { type: 'ic11', payload: Buffer.alloc(16, 7) } : chunk
  )));

  assert.throws(
    () => assertIcnsGeometry(unreadable),
    /required PNG slot ic11 is present but does not carry a readable PNG payload/,
  );
  assert.throws(() => assertIcnsGeometry(unreadable), (error) => !/is missing/.test(error.message));
});
