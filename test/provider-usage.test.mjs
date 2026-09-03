import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import {
  ClaudeUsageProbe,
  normalizeCodexUsage,
  parseClaudeUsageScreen,
  PROVIDER_USAGE_REFRESH_MS,
  ProviderUsageMonitor,
  stripTerminalControls,
} from '../src/provider-usage.mjs';

const CLAUDE_SCREEN = `
\u001b[2JCurrent session
1% used
Resets 12:30am (Europe/Bratislava)
Current week (all models)
72% used
Resets Aug 13 at 2pm (Europe/Bratislava)
Current week (Fable)
84% used
Resets Aug 13 at 2pm (Europe/Bratislava)
\u001b[HCurrent session
3% used
Resets 1:20am (Europe/Bratislava)
Current week (all models)
77% used
Resets Aug 13 at 1:59pm (Europe/Bratislava)
Current week (Fable 5 only)
87% used
Resets Aug 13 at 2pm (Europe/Bratislava)
`;

function fakeExpectProcess(screen, onScript = () => {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let script = '';
  child.stdin.setEncoding('utf8');
  child.stdin.on('data', (chunk) => {
    script += chunk;
  });
  child.stdin.on('finish', () => {
    onScript(script);
    queueMicrotask(() => {
      child.stdout.end(screen);
      child.stderr.end();
      child.emit('close', 0, null);
    });
  });
  child.kill = () => true;
  return child;
}

test('Claude usage parsing removes terminal controls and keeps the latest painted frame', () => {
  assert.equal(stripTerminalControls('\u001b[31mClaude\u001b[0m'), 'Claude');
  assert.deepEqual(parseClaudeUsageScreen(CLAUDE_SCREEN), {
    sourceStale: false,
    fableWeeklyUnavailable: false,
    fiveHour: {
      usedPercent: 3,
      resetsAt: null,
      resetLabel: '1:20am (Europe/Bratislava)',
    },
    weekly: {
      usedPercent: 77,
      resetsAt: null,
      resetLabel: 'Aug 13 at 1:59pm (Europe/Bratislava)',
    },
    fableWeekly: {
      usedPercent: 87,
      resetsAt: null,
      resetLabel: 'Aug 13 at 2pm (Europe/Bratislava)',
    },
  });
});

test('Claude usage parsing leaves Fable unavailable when its distinct allowance is absent', () => {
  const usage = parseClaudeUsageScreen(`
Current session
4% used
Resets 2am
Current week (all models)
51% used
Resets Friday
  `);
  assert.equal(usage.sourceStale, false);
  assert.equal(usage.fableWeeklyUnavailable, false);
  assert.equal(usage.fiveHour.usedPercent, 4);
  assert.equal(usage.weekly.usedPercent, 51);
  assert.equal(usage.fableWeekly, null);
});

test('Claude usage parsing reads standalone zero-percent Fable usage without inventing a reset', () => {
  const usage = parseClaudeUsageScreen(`
Current session
47% 47% used
Resets 4:50pm (Europe/Bratislava)
Current week (all models)
3% 3% used
Resets Sep 10 at 2pm (Europe/Bratislava)
Fable
You haven't used Fable yet
0% 0% used
  `);

  assert.equal(usage.sourceStale, false);
  assert.deepEqual(usage.fableWeekly, {
    usedPercent: 0,
    resetsAt: null,
    resetLabel: null,
  });
});

test('Claude usage parsing keeps the complete redraw after a delayed incremental repaint', () => {
  const usage = parseClaudeUsageScreen(`
Current session
3% used
Resets 6:10am (Europe/Bratislava)
Current week (all models)
80% used
Resets Aug 20 at 2pm (Europe/Bratislava)
Refreshing…
\u001b[GCurrent session
3% used
Resets 6:10am (Europe/Bratislava)
Current week (all models)
81% used
Resets Aug 20 at 2pm (Europe/Bratislava)
Current week (Fable)
71% used
Resets Aug 20 at 2pm (Europe/Bratislava)
`);

  assert.equal(usage.sourceStale, false);
  assert.equal(usage.fableWeeklyUnavailable, false);
  assert.equal(usage.weekly.usedPercent, 81);
  assert.equal(usage.fableWeekly.usedPercent, 71);
});

test('Claude usage parsing cannot leak a model-specific row from an older painted frame', () => {
  const usage = parseClaudeUsageScreen(`
\u001b[2JCurrent session
21% used
Resets 8:09pm (Europe/Bratislava)
Current week (all models)
47% used
Resets Aug 20 at 2pm (Europe/Bratislava)
Current week (Fable)
34% used
Resets Aug 20 at 1:59pm (Europe/Bratislava)
\u001b[HCurrent session
23% used
Resets 8:10pm (Europe/Bratislava)
Current week (all models)
48% used
Resets Aug 20 at 2pm (Europe/Bratislava)
`);

  assert.equal(usage.fiveHour.usedPercent, 23);
  assert.equal(usage.weekly.usedPercent, 48);
  assert.equal(usage.fableWeekly, null);
});

test('Claude usage parsing identifies an explicitly last-known CLI snapshot', () => {
  const usage = parseClaudeUsageScreen(`
Current session
23% used
Resets 8:10pm
Current week (all models)
48% used
Resets Aug 20 at 2pm
Showing last-known usage (could not refresh)
`);

  assert.equal(usage.sourceStale, true);
  assert.equal(usage.fableWeeklyUnavailable, true);
  assert.equal(usage.fableWeekly, null);
});

test('Claude usage parsing does not turn a rate-limited model breakdown into shared Fable usage', () => {
  const usage = parseClaudeUsageScreen(`
Current session
3% used
Resets 6:10am
Current week (all models)
80% used
Resets Aug 20 at 2pm
Per-model breakdown unavailable (rate limited, try again in a moment)
`);

  assert.equal(usage.sourceStale, true);
  assert.equal(usage.fableWeeklyUnavailable, true);
  assert.equal(usage.weekly.usedPercent, 80);
  assert.equal(usage.fableWeekly, null);
});

test('Claude usage probe runs the authenticated CLI in a private Expect terminal and reuses its session', async () => {
  const invocations = [];
  const scripts = [];
  const probe = new ClaudeUsageProbe({
    command: '/opt/relay/claude',
    cwd: '/tmp/relay-data',
    platform: 'darwin',
    sessionId: 'usage-session',
    spawnProcess: (command, args, options) => {
      invocations.push({ command, args, options });
      return fakeExpectProcess(CLAUDE_SCREEN, (script) => scripts.push(script));
    },
  });

  const first = await probe.read();
  const second = await probe.read();

  assert.equal(first.fableWeekly.usedPercent, 87);
  assert.equal(second.weekly.usedPercent, 77);
  assert.equal(invocations.length, 2);
  assert.equal(invocations[0].command, '/usr/bin/expect');
  assert.deepEqual(invocations[0].args.slice(0, 4), ['-f', '-', '38', '/opt/relay/claude']);
  assert.ok(invocations[0].args.includes('--safe-mode'));
  assert.deepEqual(invocations[0].args.slice(-2), ['--session-id', 'usage-session']);
  assert.deepEqual(invocations[1].args.slice(-2), ['--resume', 'usage-session']);
  assert.equal(invocations[0].options.cwd, '/tmp/relay-data');
  assert.equal(invocations[0].options.detached, true);
  assert.match(scripts[0], /spawn -noecho/);
  assert.match(scripts[0], /\/usage/);
  assert.match(scripts[0], /set refreshing 0[\s\S]*-re \{Refreshing\}[\s\S]*set timeout 22/);
  assert.ok(scripts[0].includes('-re {Current week \\(Fable[^)]*\\)}'));
  assert.match(scripts[0], /Fable\(\[ \\t\]\+\[0-9\.\]\+\)/);
  assert.match(scripts[0], /stty rows 60 columns 120[\s\S]*stty rows 61 columns 121/);
});

test('Claude usage probe reports unsupported platforms without spawning', async () => {
  let spawned = false;
  const probe = new ClaudeUsageProbe({
    platform: 'linux',
    spawnProcess: () => {
      spawned = true;
    },
  });
  await assert.rejects(probe.read(), (error) => error.code === 'unsupported_platform');
  assert.equal(spawned, false);
});

test('Codex usage normalization selects exact five-hour and seven-day Codex buckets', () => {
  const fiveHourResetsAt = 1_786_500_000;
  const weeklyResetsAt = 1_786_743_600;
  assert.deepEqual(normalizeCodexUsage({
    rateLimitsByLimitId: {
      codex: {
        primary: { usedPercent: 18.4, windowDurationMins: 300, resetsAt: fiveHourResetsAt },
        secondary: { usedPercent: 6, windowDurationMins: 10_080, resetsAt: weeklyResetsAt },
      },
      spark: {
        primary: { usedPercent: 91, windowDurationMins: 300, resetsAt: fiveHourResetsAt + 100 },
        secondary: { usedPercent: 92, windowDurationMins: 10_080, resetsAt: weeklyResetsAt + 100 },
      },
    },
  }), {
    fiveHour: { usedPercent: 18, resetsAt: fiveHourResetsAt, resetLabel: null },
    weekly: { usedPercent: 6, resetsAt: weeklyResetsAt, resetLabel: null },
  });

  assert.deepEqual(normalizeCodexUsage({
    rateLimits: {
      primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: fiveHourResetsAt },
      secondary: { usedPercent: 41.6, windowDurationMins: 10_080, resetsAt: weeklyResetsAt },
    },
  }), {
    fiveHour: { usedPercent: 25, resetsAt: fiveHourResetsAt, resetLabel: null },
    weekly: { usedPercent: 42, resetsAt: weeklyResetsAt, resetLabel: null },
  });

  assert.deepEqual(normalizeCodexUsage({
    rateLimitsByLimitId: {
      codex: {
        primary: { usedPercent: 55, windowDurationMins: 240 },
        secondary: { usedPercent: 8, windowDurationMins: 10_080, resetsAt: weeklyResetsAt },
      },
    },
  }), {
    fiveHour: null,
    weekly: { usedPercent: 8, resetsAt: weeklyResetsAt, resetLabel: null },
  });
});

test('provider usage monitor deduplicates refreshes and preserves last-known values on failure', async () => {
  let shouldFail = false;
  let claudeReads = 0;
  let codexReads = 0;
  const changes = [];
  const monitor = new ProviderUsageMonitor({
    now: () => Date.parse('2026-08-12T21:00:00Z'),
    readClaude: async () => {
      claudeReads += 1;
      if (shouldFail) throw new Error('offline');
      return {
        fiveHour: { usedPercent: 3, resetsAt: null, resetLabel: '1:20am' },
        weekly: { usedPercent: 77, resetsAt: null, resetLabel: 'tomorrow' },
        fableWeekly: { usedPercent: 87, resetsAt: null, resetLabel: 'tomorrow' },
      };
    },
    readCodex: async () => {
      codexReads += 1;
      if (shouldFail) throw new Error('offline');
      return {
        fiveHour: { usedPercent: 18, resetsAt: 1_786_500_000, resetLabel: null },
        weekly: { usedPercent: 6, resetsAt: 1_786_743_600, resetLabel: null },
      };
    },
  });
  monitor.on('changed', (state) => changes.push(state));

  const first = monitor.refresh();
  assert.equal(monitor.refresh(), first);
  const ready = await first;
  assert.equal(claudeReads, 1);
  assert.equal(codexReads, 1);
  assert.equal(ready.claude.status, 'ready');
  assert.equal(ready.codex.status, 'ready');
  assert.equal(ready.claude.checkedAt, '2026-08-12T21:00:00.000Z');
  assert.equal(changes.length, 1);

  shouldFail = true;
  const stale = await monitor.refresh();
  assert.equal(stale.claude.status, 'stale');
  assert.equal(stale.codex.status, 'stale');
  assert.equal(stale.claude.fableWeekly.usedPercent, 87);
  assert.equal(stale.codex.fiveHour.usedPercent, 18);
  assert.equal(stale.codex.weekly.usedPercent, 6);
  assert.equal(changes.length, 2);

  stale.claude.weekly.usedPercent = 0;
  assert.equal(monitor.current().claude.weekly.usedPercent, 77);
});

test('provider usage monitor marks CLI-retained values stale without replacing a newer sample', async () => {
  let sourceStale = false;
  let now = Date.parse('2026-08-17T13:45:00Z');
  const monitor = new ProviderUsageMonitor({
    now: () => now,
    readClaude: async () => ({
      sourceStale,
      fiveHour: { usedPercent: sourceStale ? 22 : 21, resetLabel: '8:10pm' },
      weekly: { usedPercent: 48, resetLabel: 'Thursday' },
      fableWeekly: { usedPercent: 48, resetLabel: 'Thursday', shared: true },
    }),
  });

  const ready = await monitor.refresh();
  assert.equal(ready.claude.status, 'ready');
  assert.equal(ready.claude.checkedAt, '2026-08-17T13:45:00.000Z');

  sourceStale = true;
  now += 30_000;
  const stale = await monitor.refresh();
  assert.equal(stale.claude.status, 'stale');
  assert.equal(stale.claude.checkedAt, '2026-08-17T13:45:00.000Z');
  assert.equal(stale.claude.fiveHour.usedPercent, 21);
});

test('provider usage monitor preserves only a real Fable value when its breakdown cannot refresh', async () => {
  let refreshFailed = false;
  let now = Date.parse('2026-08-18T01:00:00Z');
  const monitor = new ProviderUsageMonitor({
    now: () => now,
    readClaude: async () => refreshFailed
      ? {
        sourceStale: true,
        fableWeeklyUnavailable: true,
        fiveHour: { usedPercent: 3, resetLabel: '6:10am' },
        weekly: { usedPercent: 80, resetLabel: 'Thursday' },
        fableWeekly: null,
      }
      : {
        sourceStale: false,
        fableWeeklyUnavailable: false,
        fiveHour: { usedPercent: 3, resetLabel: '6:10am' },
        weekly: { usedPercent: 81, resetLabel: 'Thursday' },
        fableWeekly: { usedPercent: 71, resetLabel: 'Thursday' },
      },
  });

  const ready = await monitor.refresh();
  assert.equal(ready.claude.fableWeekly.usedPercent, 71);

  refreshFailed = true;
  now += 30_000;
  const stale = await monitor.refresh();
  assert.equal(stale.claude.status, 'stale');
  assert.equal(stale.claude.weekly.usedPercent, 81);
  assert.equal(stale.claude.fableWeekly.usedPercent, 71);
  assert.equal(stale.claude.fableWeeklyUnavailable, true);
  assert.equal(stale.claude.checkedAt, '2026-08-18T01:00:00.000Z');
});

test('provider usage monitor cannot regress fresh weekly and Fable values with an older stale frame', async () => {
  let staleFrame = false;
  const monitor = new ProviderUsageMonitor({
    readClaude: async () => staleFrame
      ? {
        sourceStale: true,
        fableWeeklyUnavailable: true,
        fiveHour: { usedPercent: 47, resetLabel: '4:50pm' },
        weekly: { usedPercent: 2, resetLabel: 'Sep 10 at 2pm' },
        fableWeekly: null,
      }
      : {
        sourceStale: false,
        fableWeeklyUnavailable: false,
        fiveHour: { usedPercent: 47, resetLabel: '4:50pm' },
        weekly: { usedPercent: 3, resetLabel: 'Sep 10 at 2pm' },
        fableWeekly: { usedPercent: 0, resetLabel: null },
      },
  });

  const ready = await monitor.refresh();
  assert.equal(ready.claude.weekly.usedPercent, 3);
  assert.equal(ready.claude.fableWeekly.usedPercent, 0);

  staleFrame = true;
  const stale = await monitor.refresh();
  assert.equal(stale.claude.status, 'stale');
  assert.equal(stale.claude.weekly.usedPercent, 3);
  assert.equal(stale.claude.fableWeekly.usedPercent, 0);
});

test('provider usage monitor emits a mixed-version-safe unavailable Fable window without a real value', async () => {
  const monitor = new ProviderUsageMonitor({
    readClaude: async () => ({
      sourceStale: true,
      fableWeeklyUnavailable: true,
      fiveHour: { usedPercent: 3, resetLabel: '6:10am' },
      weekly: { usedPercent: 80, resetLabel: 'Thursday' },
      fableWeekly: null,
    }),
  });

  const stale = await monitor.refresh();
  assert.equal(stale.claude.status, 'stale');
  assert.deepEqual(stale.claude.fableWeekly, {
    resetsAt: null,
    resetLabel: null,
    unavailable: true,
  });
});

test('provider usage monitor samples providers every thirty seconds by default', () => {
  const monitor = new ProviderUsageMonitor();
  assert.equal(PROVIDER_USAGE_REFRESH_MS, 30_000);
  assert.equal(monitor.refreshMs, 30_000);
});
