import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

export const PROVIDER_USAGE_REFRESH_MS = 30_000;
const CLAUDE_USAGE_TIMEOUT_MS = 40_000;
const FIVE_HOUR_MINUTES = 5 * 60;
const WEEK_MINUTES = 7 * 24 * 60;
const MAX_SCREEN_BYTES = 256 * 1_024;
const EXPECT_USAGE_SCRIPT = String.raw`
set timeout [lindex $argv 0]
set argv [lrange $argv 1 end]
log_user 1
spawn -noecho {*}$argv
expect {
  -re {Enter y/n:} {
    send -- "y\r"
    exp_continue
  }
  -re {[\r\n]\$\x1b} {
    send -- "/usage\r"
  }
  timeout { exit 124 }
  eof { exit 125 }
}
expect {
  -re {Current week \(all models\)} {
    # Claude first paints a persisted snapshot and can take more than fifteen seconds to finish
    # the live request. Consume that initial paint through its Refreshing marker before accepting
    # a later Fable row or Usage credits section as completion.
    set timeout 2
    set refreshing 0
    expect {
      -re {Refreshing} { set refreshing 1 }
      timeout {}
      eof { exit 125 }
    }
    if {$refreshing} {
      set timeout 22
      expect {
        -re {Current week \(Fable[^)]*\)} {}
        -re {[\r\n][ \t]*Fable([ \t]+[0-9.]+)?([ \t]+only)?[ \t]*[\r\n]} {}
        -re {Usage credits} {}
        -re {Showing last-known usage|Could not refresh usage data|Per-model breakdown unavailable|Usage endpoint is rate limited|Failed to load usage data} {}
        timeout {}
        eof { exit 125 }
      }
    }
    # Ink can update only the changed percentages, leaving their labels earlier in the byte
    # stream. Resizing the private pseudo-terminal makes it emit one final complete frame.
    catch {stty rows 60 columns 120 < $spawn_out(slave,name)}
    after 100
    catch {stty rows 61 columns 121 < $spawn_out(slave,name)}
    after 500
    send -- "\033"
  }
  timeout { exit 124 }
  eof { exit 125 }
}
set timeout 5
expect {
  -re {[\r\n]\$\x1b} {
    send -- "/exit\r"
    exp_continue
  }
  eof { exit 0 }
  timeout { exit 124 }
}
`;

function finitePercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(100, Math.max(0, Math.round(number)));
}

function finiteTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Claude's screen-reader mode still carries terminal cursor and title controls. Remove those
// controls without flattening newlines, because the Usage dialog's labels, percentages, and
// reset copy are deliberately parsed as adjacent rows.
export function stripTerminalControls(value) {
  return String(value || '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[()][A-Za-z0-9]/g, '')
    .replace(/\u001b[78=>]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

function lastClaudeWindowMatching(screen, labelSource, acceptsLabel = () => true) {
  const pattern = new RegExp(
    `(${labelSource})\\s+(?:\\d{1,3}(?:\\.\\d+)?%\\s+)?(\\d{1,3}(?:\\.\\d+)?)%\\s+used\\s+Resets\\s+([^\\r\\n]+)`,
    'gi',
  );
  let latest = null;
  for (const match of screen.matchAll(pattern)) {
    if (!acceptsLabel(match[1].replace(/\\s+/g, ' ').trim())) continue;
    const usedPercent = finitePercent(match[2]);
    if (usedPercent === null) continue;
    latest = {
      usedPercent,
      resetsAt: null,
      resetLabel: match[3].replace(/\s+/g, ' ').trim().slice(0, 120) || null,
    };
  }
  return latest;
}

function lastClaudeWindow(screen, label) {
  return lastClaudeWindowMatching(screen, escapeRegExp(label));
}

function lastClaudeFableWindow(screen) {
  const legacy = lastClaudeWindowMatching(
    screen,
    'Current week \\([^\\r\\n)]+\\)',
    (label) => /^Current week \(Fable(?:\s+\d+(?:\.\d+)*)?(?:\s+only)?\)$/i.test(label),
  );
  const legacyIndex = screen.toLowerCase().lastIndexOf('current week (fable');
  const labelPattern = /(?:^|[\r\n])[ \t]*Fable(?:[ \t]+\d+(?:\.\d+)*)?(?:[ \t]+only)?[ \t]*(?=\r?(?:\n|$))/gi;
  let standalone = null;
  for (const match of screen.matchAll(labelPattern)) {
    const followingLines = screen
      .slice(match.index + match[0].length)
      .split(/\r?\n/)
      .slice(0, 8)
      .join('\n');
    const usedMatch = followingLines.match(
      /(?:\d{1,3}(?:\.\d+)?%\s+)?(\d{1,3}(?:\.\d+)?)%\s+used/i,
    );
    const usedPercent = finitePercent(usedMatch?.[1]);
    if (usedPercent === null) continue;
    const resetMatch = followingLines.match(/Resets\s+([^\r\n]+)/i);
    standalone = {
      index: match.index,
      window: {
        usedPercent,
        resetsAt: null,
        resetLabel: resetMatch?.[1]?.replace(/\s+/g, ' ').trim().slice(0, 120) || null,
      },
    };
  }
  return standalone && standalone.index > legacyIndex ? standalone.window : legacy;
}

function latestClaudeUsageFrame(screen) {
  const frames = [...screen.matchAll(/Current session/gi)];
  const latest = frames.at(-1);
  return latest ? screen.slice(latest.index) : screen;
}

// `/usage` first paints a cached snapshot and then replaces it with a fresh one. Parse all rows
// from only the final complete frame. Selecting the last match independently for each row lets an
// optional model-specific row leak forward from an older frame after Claude removes it.
export function parseClaudeUsageScreen(value) {
  const screen = stripTerminalControls(value);
  const frame = latestClaudeUsageFrame(screen);
  const weekly = lastClaudeWindow(frame, 'Current week (all models)');
  const fableWeekly = lastClaudeFableWindow(frame);
  const sourceStale = /Showing last-known usage|Could not refresh usage data|Per-model breakdown unavailable|Usage endpoint is rate limited|Failed to load usage data|Refreshing/i.test(frame);
  const fableWeeklyUnavailable = sourceStale && !fableWeekly;
  return {
    sourceStale,
    fableWeeklyUnavailable,
    fiveHour: lastClaudeWindow(frame, 'Current session'),
    weekly,
    // Fable is a distinct allowance. A missing row is unknown, while the current standalone
    // Fable section can explicitly report zero without a reset timestamp.
    fableWeekly,
  };
}

function codexWindow(snapshot, durationMinutes, { allowLonger = false } = {}) {
  const windows = [snapshot?.primary, snapshot?.secondary]
    .filter((window) => window && typeof window === 'object');
  return windows.find((window) => Number(window.windowDurationMins) === durationMinutes)
    || (allowLonger
      ? windows.find((window) => Number(window.windowDurationMins) >= durationMinutes)
      : null)
    || null;
}

function normalizeCodexWindow(window) {
  const usedPercent = finitePercent(window?.usedPercent);
  return usedPercent === null
    ? null
    : {
      usedPercent,
      resetsAt: finiteTimestamp(window?.resetsAt),
      resetLabel: null,
    };
}

export function normalizeCodexUsage(value) {
  const byId = value?.rateLimitsByLimitId;
  const snapshot = byId && typeof byId === 'object' && byId.codex
    ? byId.codex
    : value?.rateLimits;
  return {
    fiveHour: normalizeCodexWindow(codexWindow(snapshot, FIVE_HOUR_MINUTES)),
    weekly: normalizeCodexWindow(codexWindow(snapshot, WEEK_MINUTES, { allowLonger: true })),
  };
}

function terminateProcessGroup(child) {
  if (!child) return;
  if (Number.isInteger(child.pid)) {
    try {
      process.kill(-child.pid, 'SIGTERM');
      return;
    } catch {}
  }
  try {
    child.kill('SIGTERM');
  } catch {}
}

export class ClaudeUsageProbeError extends Error {
  constructor(message, code = 'probe_failed') {
    super(message);
    this.name = 'ClaudeUsageProbeError';
    this.code = code;
  }
}

// Claude does not expose the model-specific Fable allowance through `auth status` or status-line
// JSON. Its own `/usage` dialog is the supported authenticated surface that contains all three
// requested bars. macOS Expect supplies a private pseudo-terminal so that dialog can be read
// without opening a native Terminal window or moving OAuth credentials into CC Relay.
export class ClaudeUsageProbe {
  constructor({
    command = 'claude',
    cwd = process.cwd(),
    platform = process.platform,
    expectCommand = '/usr/bin/expect',
    spawnProcess = spawn,
    timeoutMs = CLAUDE_USAGE_TIMEOUT_MS,
    sessionId = randomUUID(),
  } = {}) {
    this.command = command;
    this.cwd = cwd;
    this.platform = platform;
    this.expectCommand = expectCommand;
    this.spawnProcess = spawnProcess;
    this.timeoutMs = timeoutMs;
    this.sessionId = sessionId;
    this.hasSession = false;
    this.child = null;
    this.cancelCurrent = null;
  }

  read() {
    if (this.platform !== 'darwin') {
      return Promise.reject(new ClaudeUsageProbeError(
        'Claude usage monitoring currently requires the macOS pseudo-terminal bridge.',
        'unsupported_platform',
      ));
    }
    if (this.child) {
      return Promise.reject(new ClaudeUsageProbeError('A Claude usage probe is already running.', 'probe_busy'));
    }

    return new Promise((resolve, reject) => {
      const resumed = this.hasSession;
      const sessionArgs = resumed
        ? ['--resume', this.sessionId]
        : ['--session-id', this.sessionId];
      const expectTimeoutSeconds = Math.max(5, Math.floor(this.timeoutMs / 1_000) - 2);
      const args = [
        '-f',
        '-',
        String(expectTimeoutSeconds),
        this.command,
        '--safe-mode',
        '--ax-screen-reader',
        '--no-chrome',
        '--name',
        'CC Relay usage monitor',
        ...sessionArgs,
      ];
      let child;
      try {
        child = this.spawnProcess(this.expectCommand, args, {
          cwd: this.cwd,
          detached: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error) {
        reject(new ClaudeUsageProbeError(`Claude usage probe could not start: ${error.message}`));
        return;
      }
      this.child = child;

      let buffer = '';
      let settled = false;
      let timeoutTimer = null;
      const consume = (chunk) => {
        buffer = `${buffer}${String(chunk || '')}`.slice(-MAX_SCREEN_BYTES);
      };
      const finish = (error = null, result = null) => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        this.child = null;
        this.cancelCurrent = null;
        if (error) reject(error);
        else resolve(result);
      };

      child.stdout?.setEncoding?.('utf8');
      child.stderr?.setEncoding?.('utf8');
      child.stdout?.on?.('data', consume);
      // Expect and Claude startup failures can include local paths. Capture only for parsing and
      // return a generic error rather than exposing the raw pseudo-terminal stream.
      child.stderr?.on?.('data', consume);
      child.stdin?.on?.('error', () => {});
      child.stdin?.end?.(EXPECT_USAGE_SCRIPT);
      child.once?.('error', (error) => {
        terminateProcessGroup(child);
        finish(new ClaudeUsageProbeError(`Claude usage probe failed to start: ${error.message}`));
      });
      child.once?.('close', (code, signal) => {
        const result = parseClaudeUsageScreen(buffer);
        if (result.fiveHour || result.weekly || result.fableWeekly) {
          this.hasSession = true;
          finish(null, result);
          return;
        }
        if (resumed) {
          this.hasSession = false;
          this.sessionId = randomUUID();
        }
        const suffix = signal ? ` after ${signal}` : ` with code ${code}`;
        finish(new ClaudeUsageProbeError(`Claude usage probe stopped${suffix}.`));
      });

      timeoutTimer = setTimeout(() => {
        terminateProcessGroup(child);
        finish(new ClaudeUsageProbeError('Claude usage probe timed out.', 'probe_timeout'));
      }, this.timeoutMs);
      timeoutTimer.unref?.();
      this.cancelCurrent = () => {
        terminateProcessGroup(child);
        finish(new ClaudeUsageProbeError('Claude usage probe was cancelled.', 'probe_cancelled'));
      };
    });
  }

  cancel() {
    this.cancelCurrent?.();
  }
}

function emptyClaudeState() {
  return {
    status: 'checking',
    checkedAt: null,
    fiveHour: null,
    weekly: null,
    fableWeekly: null,
  };
}

function emptyCodexState() {
  return {
    status: 'checking',
    checkedAt: null,
    fiveHour: null,
    weekly: null,
  };
}

function hasUsage(provider) {
  return Boolean(provider?.fiveHour || provider?.weekly || provider?.fableWeekly);
}

function safeClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class ProviderUsageMonitor extends EventEmitter {
  constructor({
    readClaude,
    readCodex,
    cancelClaude = () => {},
    now = Date.now,
    refreshMs = PROVIDER_USAGE_REFRESH_MS,
  } = {}) {
    super();
    this.readClaude = readClaude;
    this.readCodex = readCodex;
    this.cancelClaude = cancelClaude;
    this.now = now;
    this.refreshMs = refreshMs;
    this.state = {
      claude: emptyClaudeState(),
      codex: emptyCodexState(),
    };
    this.pending = null;
    this.timer = null;
  }

  current() {
    return safeClone(this.state);
  }

  async refreshProvider(provider, read) {
    const previous = this.state[provider];
    if (typeof read !== 'function') {
      this.state[provider] = {
        ...previous,
        status: hasUsage(previous) ? 'stale' : 'unavailable',
      };
      return;
    }
    try {
      const value = await read();
      const { sourceStale = false, ...sample } = value && typeof value === 'object' ? value : {};
      if (
        sample.fableWeeklyUnavailable === true
        && !sample.fableWeekly
      ) {
        sample.fableWeekly = previous.fableWeekly && previous.fableWeekly.shared !== true
          ? previous.fableWeekly
          : {
            resetsAt: null,
            resetLabel: null,
            unavailable: true,
          };
      }
      // A CLI-declared stale frame is older than the last successful sample. Keep every value
      // from that successful sample instead of allowing the provider's cache to move backward.
      if (sourceStale && previous.checkedAt && hasUsage(previous)) {
        this.state[provider] = {
          ...previous,
          ...(sample.fableWeeklyUnavailable === true
            ? { fableWeeklyUnavailable: true }
            : {}),
          status: 'stale',
        };
        if (sample.fableWeeklyUnavailable === true && previous.fableWeekly?.shared === true) {
          this.state[provider].fableWeekly = sample.fableWeekly;
        }
        return;
      }
      if (!hasUsage(sample)) {
        this.state[provider] = {
          ...previous,
          status: hasUsage(previous) ? 'stale' : 'unavailable',
        };
        return;
      }
      this.state[provider] = {
        ...previous,
        ...sample,
        status: sourceStale ? 'stale' : 'ready',
        checkedAt: sourceStale ? previous.checkedAt : new Date(this.now()).toISOString(),
      };
    } catch {
      this.state[provider] = {
        ...previous,
        status: hasUsage(previous) ? 'stale' : 'unavailable',
      };
    }
  }

  refresh() {
    if (this.pending) return this.pending;
    const before = JSON.stringify(this.state);
    this.pending = Promise.all([
      this.refreshProvider('claude', this.readClaude),
      this.refreshProvider('codex', this.readCodex),
    ]).then(() => {
      if (JSON.stringify(this.state) !== before) this.emit('changed', this.current());
      return this.current();
    }).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  start() {
    if (this.timer) return this;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.refreshMs);
    this.timer.unref?.();
    return this;
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.cancelClaude();
  }
}
