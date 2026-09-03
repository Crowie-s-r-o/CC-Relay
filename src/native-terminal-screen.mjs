import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const TERMINAL_SCREEN_TIMEOUT_MS = 5_000;
const TERMINAL_SCREEN_MAX_BUFFER = 2 * 1024 * 1024;
export const MAX_NATIVE_TERMINAL_SCREEN_CHARS = 250_000;

/*
 * Terminal.app owns the PTY used by Codex and Claude. A second terminal emulator cannot attach
 * to that same PTY without taking control away from Terminal.app, so Relay reads the exact visible
 * tab contents through Terminal's scripting interface. The window id, single-tab shape, and TTY
 * are checked inside the same Apple Event that reads the contents. A recycled or changed window
 * therefore yields no text from an unrelated terminal.
 */
const READ_NATIVE_TERMINAL_SCREEN_JXA = `function run(argv) {
  var result = { ok: false, reason: 'unreadable', text: '', busy: false };
  try {
    var windowId = parseInt(argv[0], 10);
    var expectedTty = String(argv[1] || '');
    var terminal = Application('Terminal');
    if (!terminal.running()) {
      result.reason = 'terminal-not-running';
      return JSON.stringify(result);
    }
    var window = terminal.windows.byId(windowId);
    var tabs = null;
    try { tabs = window.tabs(); } catch (error) { tabs = null; }
    if (!tabs || tabs.length !== 1) {
      result.reason = tabs && tabs.length > 1 ? 'multiple-tabs' : 'window-missing';
      return JSON.stringify(result);
    }
    var tty = null;
    try { tty = tabs[0].tty(); } catch (error) { tty = null; }
    if (typeof tty !== 'string' || tty !== expectedTty) {
      result.reason = 'tty-changed';
      return JSON.stringify(result);
    }
    var contents = null;
    try { contents = tabs[0].contents(); } catch (error) { contents = null; }
    if (typeof contents !== 'string') {
      result.reason = 'contents-unreadable';
      return JSON.stringify(result);
    }
    if (contents.length > ${MAX_NATIVE_TERMINAL_SCREEN_CHARS}) {
      contents = contents.slice(-${MAX_NATIVE_TERMINAL_SCREEN_CHARS});
    }
    try { result.busy = tabs[0].busy() === true; } catch (error) { result.busy = false; }
    result.ok = true;
    result.reason = 'read';
    result.text = contents;
    return JSON.stringify(result);
  } catch (error) {
    result.reason = 'window-missing';
    return JSON.stringify(result);
  }
}`;

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeTty(value) {
  const tty = typeof value === 'string' ? value.trim() : '';
  return tty.startsWith('/dev/') ? tty : '';
}

export function normalizeNativeTerminalText(value) {
  const text = typeof value === 'string'
    ? value.replaceAll('\0', '').replace(/\r\n?/g, '\n')
    : '';
  return text.length <= MAX_NATIVE_TERMINAL_SCREEN_CHARS
    ? text
    : text.slice(-MAX_NATIVE_TERMINAL_SCREEN_CHARS);
}

export class NativeTerminalScreenReader {
  constructor({ run = execFile, platform = process.platform } = {}) {
    this.run = run;
    this.platform = platform;
  }

  async read({ terminalWindowId, terminalTty } = {}) {
    if (this.platform !== 'darwin') {
      return { state: 'unsupported', reason: 'unsupported-platform', text: '', busy: false };
    }
    const windowId = positiveInteger(terminalWindowId);
    const tty = normalizeTty(terminalTty);
    if (!windowId || !tty) {
      return { state: 'unavailable', reason: 'identity-unverified', text: '', busy: false };
    }

    let stdout = '';
    try {
      ({ stdout = '' } = await this.run(
        'osascript',
        [
          '-l',
          'JavaScript',
          '-e',
          READ_NATIVE_TERMINAL_SCREEN_JXA,
          String(windowId),
          tty,
        ],
        { timeout: TERMINAL_SCREEN_TIMEOUT_MS, maxBuffer: TERMINAL_SCREEN_MAX_BUFFER },
      ));
    } catch (error) {
      return {
        state: 'unavailable',
        reason: error?.code === 'ETIMEDOUT' ? 'read-timeout' : 'read-failed',
        text: '',
        busy: false,
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(stdout || '{}');
    } catch {
      return { state: 'unavailable', reason: 'invalid-response', text: '', busy: false };
    }
    if (!parsed?.ok || typeof parsed.text !== 'string') {
      return {
        state: 'unavailable',
        reason: String(parsed?.reason || 'unreadable'),
        text: '',
        busy: false,
      };
    }
    return {
      state: 'live',
      reason: 'read',
      text: normalizeNativeTerminalText(parsed.text),
      busy: parsed.busy === true,
    };
  }
}
