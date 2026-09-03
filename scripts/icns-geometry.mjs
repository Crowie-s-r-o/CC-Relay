// Apple's icns format pairs every image OSType with exactly one pixel size. A slot whose PNG
// payload does not carry that size makes AppKit, when the file is loaded directly, report
// fractional logical sizes for the 256px and larger representations and lose correct @2x pairing
// at every level, 16pt and 32pt included. This module is the portable validator for that
// contract: pure Node, no macOS tooling, so it runs in CI on every platform and pins the tracked
// build/icon.icns.
//
// Treat every icns buffer as untrusted input. Chunk lengths come from the file itself.

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ICNS_MAGIC = 'icns';
const ICNS_HEADER_BYTES = 8;
const CHUNK_HEADER_BYTES = 8;

// OSType -> required pixel size. This map says what a slot is measured against, not what the
// file must contain; ICNS_REQUIRED_PNG_SLOTS below carries that. `icp4`, `icp5`, and `icp6` are
// the legacy PNG-capable small slots: electron-builder emits them, Apple's `iconutil` does not.
// `ic04` and `ic05` normally hold raw ARGB rather than PNG, so on a real file they take the
// tolerated non-PNG path and never reach this map. All five stay listed so that a builder-derived
// icns, or a future `iconutil` that writes PNG into ic04 or ic05, is measured against the
// specification instead of being rejected as an unknown OSType carrying a PNG payload.
export const ICNS_PNG_SLOT_SIZES = Object.freeze({
  ic04: 16,
  ic05: 32,
  icp4: 16,
  icp5: 32,
  icp6: 64,
  ic07: 128,
  ic08: 256,
  ic09: 512,
  ic10: 1024,
  ic11: 32,
  ic12: 64,
  ic13: 256,
  ic14: 512,
});

// The slots `iconutil -c icns` produces from a complete ten-entry iconset. 16pt and 32pt reach
// macOS through the `ic04` and `ic05` raw-ARGB entries instead of PNG slots, so they are not
// required here.
export const ICNS_REQUIRED_PNG_SLOTS = Object.freeze([
  'ic07',
  'ic08',
  'ic09',
  'ic10',
  'ic11',
  'ic12',
  'ic13',
  'ic14',
]);

function isPngPayload(payload) {
  return payload.length >= 24
    && payload.subarray(0, 8).equals(PNG_SIGNATURE)
    && payload.toString('ascii', 12, 16) === 'IHDR';
}

/**
 * Reads a PNG's IHDR dimensions, or null when the buffer is not a readable PNG. Shared with the
 * macOS generator so it can refuse a source image that `sips` would silently upscale.
 */
export function readPngSize(buffer) {
  if (!Buffer.isBuffer(buffer) || !isPngPayload(buffer)) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * Splits an icns container into its chunks without interpreting the payloads.
 * Throws on any structural damage rather than guessing at a recovery.
 */
export function readIcnsChunks(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('icns input must be a Buffer.');
  if (buffer.length < ICNS_HEADER_BYTES) throw new Error('icns file is shorter than its header.');

  const magic = buffer.toString('ascii', 0, 4);
  if (magic !== ICNS_MAGIC) {
    throw new Error(`icns file must start with the "${ICNS_MAGIC}" magic, found "${magic}".`);
  }

  const headerLength = buffer.readUInt32BE(4);
  if (headerLength !== buffer.length) {
    throw new Error(
      `icns header declares ${headerLength} bytes but the file is ${buffer.length} bytes.`,
    );
  }

  const chunks = [];
  let offset = ICNS_HEADER_BYTES;
  while (offset < buffer.length) {
    if (offset + CHUNK_HEADER_BYTES > buffer.length) {
      throw new Error(`icns chunk header at offset ${offset} runs past the end of the file.`);
    }
    const type = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32BE(offset + 4);
    if (length < CHUNK_HEADER_BYTES) {
      throw new Error(`icns chunk "${type}" declares an impossible length of ${length} bytes.`);
    }
    if (offset + length > buffer.length) {
      throw new Error(`icns chunk "${type}" declares ${length} bytes but runs past the end of the file.`);
    }
    chunks.push({
      type,
      offset,
      length,
      payload: buffer.subarray(offset + CHUNK_HEADER_BYTES, offset + length),
    });
    offset += length;
  }

  if (chunks.length === 0) throw new Error('icns file contains no chunks.');
  return chunks;
}

/**
 * Describes each chunk as either a measurable PNG slot or a tolerated non-PNG entry
 * (`ic04` and `ic05` raw ARGB, the `info` bplist, a table of contents).
 */
export function describeIcnsGeometry(buffer) {
  const entries = readIcnsChunks(buffer).map((chunk) => {
    if (!isPngPayload(chunk.payload)) {
      return { type: chunk.type, kind: 'other', bytes: chunk.payload.length };
    }
    return {
      type: chunk.type,
      kind: 'png',
      bytes: chunk.payload.length,
      width: chunk.payload.readUInt32BE(16),
      height: chunk.payload.readUInt32BE(20),
      requiredSize: ICNS_PNG_SLOT_SIZES[chunk.type] ?? null,
    };
  });
  return { fileLength: buffer.length, entries };
}

/**
 * Fails when any PNG slot disagrees with the OSType size map, when a PNG slot is not square,
 * when an unknown OSType carries a PNG payload, when a required slot is absent, or when a
 * required slot is present but carries something other than a readable PNG.
 * Non-PNG entries in slots that are not required are tolerated on purpose.
 */
export function assertIcnsGeometry(buffer) {
  const { entries } = describeIcnsGeometry(buffer);
  const problems = [];
  const pngSlots = new Set();
  const presentSlots = new Set();

  for (const entry of entries) {
    presentSlots.add(entry.type);
    if (entry.kind !== 'png') continue;
    pngSlots.add(entry.type);
    if (entry.requiredSize === null) {
      problems.push(`unknown OSType "${entry.type}" carries a PNG payload`);
      continue;
    }
    if (entry.width !== entry.height) {
      problems.push(`${entry.type} PNG is ${entry.width}x${entry.height} instead of square`);
      continue;
    }
    if (entry.width !== entry.requiredSize) {
      problems.push(
        `${entry.type} PNG is ${entry.width}x${entry.height} but the icns specification requires `
        + `${entry.requiredSize}x${entry.requiredSize}`,
      );
    }
  }

  for (const slot of ICNS_REQUIRED_PNG_SLOTS) {
    if (pngSlots.has(slot)) continue;
    // A slot that exists but holds something unreadable is a different defect from an absent one.
    // A legacy JPEG 2000 entry, or a PNG truncated below its own IHDR, must not be reported as
    // missing: the verdict would be right and the diagnosis would send the reader to the wrong file.
    problems.push(presentSlots.has(slot)
      ? `required PNG slot ${slot} is present but does not carry a readable PNG payload`
      : `required PNG slot ${slot} is missing`);
  }

  if (problems.length > 0) {
    throw new Error(`icns geometry is not specification conforming: ${problems.join('; ')}.`);
  }
  return entries;
}

/** Human-readable chunk table used by the generator's own output. */
export function formatIcnsGeometry(buffer) {
  const { fileLength, entries } = describeIcnsGeometry(buffer);
  const lines = [`icns file length ${fileLength} bytes`];
  for (const entry of entries) {
    lines.push(entry.kind === 'png'
      ? `  ${entry.type}  ${entry.width}x${entry.height}  required ${entry.requiredSize}  ${entry.bytes} bytes`
      : `  ${entry.type}  non-PNG entry (tolerated)  ${entry.bytes} bytes`);
  }
  return lines.join('\n');
}
