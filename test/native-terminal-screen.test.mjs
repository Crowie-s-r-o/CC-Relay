import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_NATIVE_TERMINAL_SCREEN_CHARS,
  NativeTerminalScreenReader,
  normalizeNativeTerminalText,
} from '../src/native-terminal-screen.mjs';

test('native terminal reader verifies one exact Terminal.app window and tty in the read script', async () => {
  let invocation = null;
  const reader = new NativeTerminalScreenReader({
    platform: 'darwin',
    run: async (file, args, options) => {
      invocation = { file, args, options };
      return {
        stdout: JSON.stringify({
          ok: true,
          reason: 'read',
          text: 'first\r\nsecond\0',
          busy: true,
        }),
      };
    },
  });

  assert.deepEqual(await reader.read({
    terminalWindowId: 812,
    terminalTty: '/dev/ttys042',
  }), {
    state: 'live',
    reason: 'read',
    text: 'first\nsecond',
    busy: true,
  });
  assert.equal(invocation.file, 'osascript');
  assert.deepEqual(invocation.args.slice(-2), ['812', '/dev/ttys042']);
  assert.match(invocation.args[3], /tabs\.length !== 1/);
  assert.match(invocation.args[3], /tty !== expectedTty/);
  assert.match(invocation.args[3], /tabs\[0\]\.contents\(\)/);
  assert.match(
    invocation.args[3],
    new RegExp(`contents\\.length > ${MAX_NATIVE_TERMINAL_SCREEN_CHARS}`),
  );
  assert.ok(invocation.options.timeout > 0);
  assert.ok(invocation.options.maxBuffer > 0);
});

test('native terminal reader fails closed before AppleScript when identity is incomplete', async () => {
  let calls = 0;
  const reader = new NativeTerminalScreenReader({
    platform: 'darwin',
    run: async () => {
      calls += 1;
      return { stdout: '{}' };
    },
  });

  assert.equal((await reader.read({ terminalWindowId: 12, terminalTty: '' })).reason, 'identity-unverified');
  assert.equal((await reader.read({ terminalWindowId: 0, terminalTty: '/dev/ttys001' })).reason, 'identity-unverified');
  assert.equal(calls, 0);
});

test('native terminal reader reports platform and scripting failures without terminal text', async () => {
  const unsupported = new NativeTerminalScreenReader({ platform: 'linux' });
  assert.deepEqual(await unsupported.read({
    terminalWindowId: 4,
    terminalTty: '/dev/pts/2',
  }), {
    state: 'unsupported',
    reason: 'unsupported-platform',
    text: '',
    busy: false,
  });

  const changed = new NativeTerminalScreenReader({
    platform: 'darwin',
    run: async () => ({ stdout: JSON.stringify({ ok: false, reason: 'tty-changed' }) }),
  });
  assert.deepEqual(await changed.read({
    terminalWindowId: 4,
    terminalTty: '/dev/ttys002',
  }), {
    state: 'unavailable',
    reason: 'tty-changed',
    text: '',
    busy: false,
  });
});

test('native terminal text is bounded from the tail of the visible screen', () => {
  const text = `discard${'x'.repeat(MAX_NATIVE_TERMINAL_SCREEN_CHARS)}tail`;
  const normalized = normalizeNativeTerminalText(text);
  assert.equal(normalized.length, MAX_NATIVE_TERMINAL_SCREEN_CHARS);
  assert.ok(normalized.endsWith('tail'));
  assert.ok(!normalized.startsWith('discard'));
});
