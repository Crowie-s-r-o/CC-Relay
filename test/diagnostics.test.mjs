import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DiagnosticLog } from '../src/diagnostics.mjs';

test('diagnostics persist structured entries and return a bounded tail', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-diagnostics-'));
  try {
    const log = new DiagnosticLog(join(directory, 'relay-diagnostics.jsonl'));
    log.write('terminal.launch.requested', { provider: 'codex', threadId: undefined });
    log.write('proxy.thread.joined', { threadId: 'thread-one' });

    const entries = log.tail(1);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].event, 'proxy.thread.joined');
    assert.equal(entries[0].threadId, 'thread-one');
    assert.ok(entries[0].timestamp);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
