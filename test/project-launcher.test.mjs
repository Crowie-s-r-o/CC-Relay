import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  CODEX_RELAY_COMMAND,
  CLAUDE_RELAY_COMMAND,
  ProjectLauncher,
  centeredWindowBounds,
  claudeRelayCommand,
  cmdQuote,
  codexRelayCommand,
  firstAvailableGridSlot,
  gridBounds,
  normalizeMacTerminalWindowBounds,
  normalizeTerminalLayout,
  shellQuote,
  terminalCommand,
  terminalProcessIds,
  validateProjectPath,
  windowsTerminalProcessMissing,
} from '../src/project-launcher.mjs';
import { TerminalRuntimeResolver } from '../src/terminal-runtime-resolver.mjs';

test('terminal grids validate dimensions and calculate stable cells', () => {
  const layout = normalizeTerminalLayout({ enabled: true, columns: 3, rows: 2, display: 1 });
  assert.deepEqual(layout, { enabled: true, columns: 3, rows: 2, display: 1 });
  assert.deepEqual(gridBounds({ x: 100, y: 40, width: 1000, height: 600 }, layout, 5), {
    left: 766,
    top: 340,
    right: 1100,
    bottom: 640,
  });
  assert.equal(normalizeTerminalLayout({ enabled: false }), null);
  assert.throws(() => normalizeTerminalLayout({ enabled: true, columns: 9, rows: 3 }), /1 to 8/);
});

test('terminal grids reuse the first cell freed by a closed window', () => {
  const display = { x: 0, y: 25, width: 1200, height: 900 };
  const layout = { enabled: true, columns: 3, rows: 2, display: 0 };
  const windows = [
    gridBounds(display, layout, 0),
    gridBounds(display, layout, 2),
    gridBounds(display, layout, 3),
  ];
  assert.equal(firstAvailableGridSlot(display, layout, windows), 1);
});

test('macOS Terminal window rectangles normalize from JXA and legacy array shapes', () => {
  assert.deepEqual(
    normalizeMacTerminalWindowBounds({ x: 20, y: 30, width: 1172, height: 762 }),
    { left: 20, top: 30, right: 1192, bottom: 792 },
  );
  assert.deepEqual(
    normalizeMacTerminalWindowBounds([0, 30, 1706, 473]),
    { left: 0, top: 30, right: 1706, bottom: 473 },
  );
  assert.equal(normalizeMacTerminalWindowBounds({}), null);
});

test('macOS display coordinates use the primary screen top for Terminal bounds', async () => {
  let displayScript = '';
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    run: async (_file, args) => {
      displayScript = args.at(-1);
      return { stdout: '[]' };
    },
  });
  assert.deepEqual(await launcher.listDisplays(), []);
  assert.match(displayScript, /const primaryFrame = \$\.NSScreen\.mainScreen\.frame;/);
  assert.match(displayScript, /terminalCoordinateTop - frame\.origin\.y - frame\.size\.height/);
  assert.doesNotMatch(displayScript, /Math\.max/);
});

test('terminal attention preserves window size and centers it on its current display', () => {
  assert.deepEqual(centeredWindowBounds([
    { name: 'Built-in', x: 0, y: 25, width: 1200, height: 900, primary: true },
    { name: 'Studio Display', x: 1200, y: 25, width: 1600, height: 900, primary: false },
  ], {
    left: 1300,
    top: 100,
    right: 2100,
    bottom: 700,
  }), {
    left: 1600,
    top: 175,
    right: 2400,
    bottom: 775,
  });
});

test('project launcher validates folders and builds fixed provider commands', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay project-'));
  try {
    const project = validateProjectPath(directory);
    assert.equal(project.name, directory.split('/').at(-1));
    assert.match(CODEX_RELAY_COMMAND, /--cd \./);
    // Both interactive Codex forms must end with the update-prompt override, or the launched TUI
    // stops on "Update available" before it dials --remote and the task never binds a session.
    assert.match(CODEX_RELAY_COMMAND, /-c check_for_update_on_startup=false$/);
    assert.match(codexRelayCommand(project.path), /-c check_for_update_on_startup=false$/);
    assert.equal(
      terminalCommand(project.path, 'codex'),
      `cd ${shellQuote(project.path)} && ${codexRelayCommand(project.path)}`,
    );
    assert.equal(terminalCommand(project.path, 'claude'), `cd ${shellQuote(project.path)} && ${CLAUDE_RELAY_COMMAND}`);
    assert.equal(
      terminalCommand(project.path, 'claude', { resumeThreadId: 'claude-conversation' }),
      `cd ${shellQuote(project.path)} && claude --dangerously-skip-permissions --resume 'claude-conversation'`,
    );
    assert.equal(
      terminalCommand(project.path, 'claude', { claudeSessionId: 'empty-claude-session' }),
      `cd ${shellQuote(project.path)} && claude --dangerously-skip-permissions --session-id 'empty-claude-session'`,
    );
    assert.equal(
      terminalCommand(project.path, 'claude', {
        claudeSessionId: 'hooked-claude-session',
        claudeSettings: {
          hooks: {
            Stop: [{
              hooks: [{ type: 'http', url: 'http://127.0.0.1:58925/hook', timeout: 1 }],
            }],
          },
        },
      }),
      `cd ${shellQuote(project.path)} && claude --dangerously-skip-permissions --session-id 'hooked-claude-session' --settings '{"hooks":{"Stop":[{"hooks":[{"type":"http","url":"http://127.0.0.1:58925/hook","timeout":1}]}]}}'`,
    );
    assert.equal(
      terminalCommand(project.path, 'codex', { resumeThreadId: 'codex-conversation' }),
      `cd ${shellQuote(project.path)} && codex resume 'codex-conversation' --dangerously-bypass-approvals-and-sandbox --cd ${shellQuote(project.path)} --remote ws://127.0.0.1:4769 -c check_for_update_on_startup=false`,
    );
    assert.throws(() => terminalCommand(directory, 'custom'), /Unsupported AI provider/);
    assert.throws(() => validateProjectPath('relative'), /absolute/);

    // The bare default stays unquoted; a resolved absolute path is quoted and pinned.
    assert.equal(claudeRelayCommand(), CLAUDE_RELAY_COMMAND);
    assert.equal(
      claudeRelayCommand(null, shellQuote, '/Users/tester/.local/bin/claude'),
      "'/Users/tester/.local/bin/claude' --dangerously-skip-permissions",
    );
    assert.equal(
      terminalCommand(project.path, 'claude', { claudeBinary: '/Users/tester/.local/bin/claude' }),
      `cd ${shellQuote(project.path)} && '/Users/tester/.local/bin/claude' --dangerously-skip-permissions`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('project launcher can initialize a saved Claude UUID without resuming it', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-initialize-claude-'));
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    createId: () => 'fresh-native-launch',
    run: async () => ({ stdout: '501\n' }),
  });
  try {
    const result = await launcher.launch(
      directory,
      'claude',
      null,
      { initializeThreadId: 'saved-empty-session' },
    );
    assert.equal(result.launchId, 'fresh-native-launch');
    assert.equal(result.expectedThreadId, 'saved-empty-session');
    assert.match(
      result.command,
      /claude --dangerously-skip-permissions --session-id 'saved-empty-session'$/,
    );
    assert.doesNotMatch(result.command, /--resume/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('project launcher opens Terminal with a quoted project command', async () => {
  const directory = mkdtempSync(join(tmpdir(), "relay's-project-"));
  const calls = [];
  const reservedWorkspaces = [];
  const lifecycle = [];
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    createId: () => 'launch-codex',
    run: async (...args) => {
      lifecycle.push('terminal');
      calls.push(args);
      return { stdout: '501\n' };
    },
    ensureCodexReady: async () => lifecycle.push('ready'),
    reserveCodexLaunch: (workspace, launchId) => {
      lifecycle.push('reserved');
      reservedWorkspaces.push([workspace, launchId]);
      return { endpoint: 'ws://127.0.0.1:54321', cancel: () => {} };
    },
  });
  try {
    const result = await launcher.launch(directory, 'codex');
    assert.equal(result.provider, 'codex');
    assert.equal(calls[0][0], 'osascript');
    assert.match(calls[0][1][1], /tell application "Terminal"/);
    assert.match(calls[0][1][1], /--remote ws:\/\/127\.0\.0\.1:54321/);
    const script = calls[0][1][1];
    const tabCreation = script.indexOf('set launchedTab to do script ""');
    const shellReadyWait = script.indexOf('repeat with shellPoll');
    const commandSubmission = script.lastIndexOf('do script ');
    assert.ok(tabCreation >= 0);
    assert.ok(shellReadyWait > tabCreation);
    assert.ok(commandSubmission > shellReadyWait);
    assert.match(script, /if not \(busy of launchedTab\) then/);
    assert.match(script, /if shellReady then\ndo script .* in launchedTab/);
    assert.ok(result.command.includes(`--cd ${shellQuote(result.path)}`));
    assert.deepEqual(reservedWorkspaces, [[result.path, 'launch-codex']]);
    assert.deepEqual(lifecycle, ['ready', 'reserved', 'terminal']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('project launcher reports an exact owned window when the macOS shell never becomes ready', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-shell-not-ready-'));
  const diagnostics = [];
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    createId: () => 'shell-timeout-launch',
    diagnostic: (...args) => diagnostics.push(args),
    run: async () => ({ stdout: '777|false\n' }),
  });
  try {
    const result = await launcher.launch(directory, 'claude');
    assert.equal(result.launchId, 'shell-timeout-launch');
    assert.equal(result.terminalWindowId, 777);
    assert.equal(result.connectionStatus, 'shell_not_ready');
    assert.match(result.bindingError, /terminal shell did not become ready/);
    assert.deepEqual(launcher.terminalForLaunch(result.launchId), {
      launchId: 'shell-timeout-launch',
      threadId: null,
      provider: 'claude',
      path: result.path,
    });
    assert.equal(
      diagnostics.find(([event]) => event === 'terminal.launch.dispatched')?.[1]?.shellReady,
      false,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('project launcher can open a terminal in the background', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-background-'));
  const calls = [];
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    run: async (...args) => {
      calls.push(args);
      return { stdout: '' };
    },
  });
  try {
    await launcher.launch(directory, 'claude', { enabled: false, background: true });
    const script = calls[0][1][1];
    assert.doesNotMatch(script, /\nactivate\n/);
    assert.match(script, /set launchedWindow to first window whose selected tab is launchedTab/);
    assert.match(script, /set miniaturized of launchedWindow to true/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('macOS shutdown closes only Terminal windows launched by CC Relay', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-owned-terminals-'));
  const calls = [];
  let nextWindowId = 410;
  // One snapshot enumerates the TTY before SIGKILL, then two empty observations drain it.
  const processSnapshots = ['700\n701\n', '', '', '702\n', '', ''];
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    run: async (...args) => {
      calls.push(args);
      if (args[0] === 'osascript' && args[1][1].includes('do script')) return { stdout: `${nextWindowId++}\n` };
      if (args[0] === 'osascript' && args[1][1].includes('return tty')) return { stdout: `ttys${nextWindowId}\n` };
      if (args[0] === 'ps' && args[1][0] === '-t') return { stdout: processSnapshots.shift() ?? '' };
      return { stdout: '' };
    },
  });
  try {
    const first = await launcher.launch(directory, 'codex');
    const second = await launcher.launch(directory, 'claude');
    assert.equal(first.terminalWindowId, 410);
    assert.equal(second.terminalWindowId, 411);

    const closed = await launcher.closeOwnedTerminals();
    assert.deepEqual(closed, { windowCount: 2, processCount: 0 });
    const killCalls = calls.filter(([command]) => command === 'kill');
    assert.deepEqual(killCalls.map(([, args]) => args), [
      ['-9', '700', '701'],
      ['-9', '702'],
    ]);
    assert.deepEqual(
      calls.filter(([command, args]) => command === 'ps' && args[0] === '-t').map(([, args]) => args)[0],
      ['-t', 'ttys412', '-o', 'pid='],
    );
    assert.equal(calls.some(([command]) => command === 'pgrep' || command === 'pkill'), false);
    const closeScripts = calls
      .filter(([command, args]) => command === 'osascript' && args[1].includes('then close window id'))
      .map(([, args]) => args[1]);
    assert.match(closeScripts[0], /window id 410/);
    assert.match(closeScripts[1], /window id 411/);
    assert.ok(closeScripts.every((script) => !script.includes('close every window')));

    const secondClose = await launcher.closeOwnedTerminals();
    assert.deepEqual(secondClose, { windowCount: 0, processCount: 0 });
    await assert.rejects(() => launcher.launch(directory, 'codex'), /CC Relay is closing/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('one bound CC Relay terminal can be closed without touching other owned windows', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-close-one-'));
  const calls = [];
  const launchIds = ['launch-codex', 'launch-claude'];
  let nextWindowId = 510;
  const processSnapshots = ['811\n', '', ''];
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    createId: () => launchIds.shift(),
    run: async (...args) => {
      calls.push(args);
      if (args[0] === 'osascript' && args[1][1].includes('do script')) return { stdout: `${nextWindowId++}\n` };
      if (args[0] === 'osascript' && args[1][1].includes('return tty')) return { stdout: 'ttys050\n' };
      if (args[0] === 'ps' && args[1][0] === '-t') return { stdout: processSnapshots.shift() ?? '' };
      return { stdout: '' };
    },
  });
  try {
    const codex = await launcher.launch(directory, 'codex');
    const claude = await launcher.launch(directory, 'claude');
    launcher.bindOwnedTerminal(codex.launchId, {
      id: 'codex-thread', provider: 'codex', cwd: directory,
    });
    launcher.bindOwnedTerminal(claude.launchId, {
      id: 'claude-thread', provider: 'claude', cwd: directory,
    });

    assert.deepEqual(launcher.terminalForThread('codex-thread'), {
      launchId: 'launch-codex',
      threadId: 'codex-thread',
      provider: 'codex',
      path: codex.path,
    });
    assert.deepEqual(launcher.terminalForLaunch('launch-codex'), {
      launchId: 'launch-codex',
      threadId: 'codex-thread',
      provider: 'codex',
      path: codex.path,
    });
    const closed = await launcher.closeOwnedTerminal('codex-thread');
    assert.equal(closed.threadId, 'codex-thread');
    assert.equal(launcher.terminalForThread('codex-thread'), null);
    assert.equal(launcher.terminalForLaunch('launch-codex'), null);
    assert.equal(launcher.terminalForThread('claude-thread').launchId, 'launch-claude');
    const closeOneScript = calls.at(-1)[1][1];
    assert.match(closeOneScript, /close window id 510/);
    assert.doesNotMatch(closeOneScript, /511/);
    assert.deepEqual(
      calls.find(([command]) => command === 'kill').slice(0, 2),
      ['kill', ['-9', '811']],
    );
    // One enumeration before SIGKILL plus two consecutive empty drain observations.
    assert.equal(calls.filter(([command, args]) => (
      command === 'ps' && args[0] === '-t' && args[1] === 'ttys050' && args[2] === '-o' && args[3] === 'pid='
    )).length, 3);
    assert.equal(calls.some(([command]) => command === 'pgrep' || command === 'pkill'), false);

    const shutdown = await launcher.closeOwnedTerminals();
    assert.deepEqual(shutdown, { windowCount: 1, processCount: 0 });
    assert.match(calls.at(-1)[1][1], /window id 511/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('retained launches survive CC Relay shutdown and remain explicitly closable beforehand', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-retained-terminals-'));
  const calls = [];
  const launcher = new ProjectLauncher({
    platform: 'win32',
    run: async (...args) => {
      calls.push(args);
      return { stdout: '' };
    },
  });
  const path = validateProjectPath(directory).path;
  try {
    launcher.trackOwnedTerminal({
      launchId: 'retained-close',
      provider: 'codex',
      path,
      terminalProcessId: 801,
    });
    launcher.bindOwnedTerminal('retained-close', {
      id: 'retained-close-thread',
      provider: 'codex',
      cwd: directory,
    });
    launcher.retainOwnedLaunch('retained-close');
    await launcher.closeOwnedTerminal('retained-close-thread');

    launcher.trackOwnedTerminal({
      launchId: 'retained-shutdown',
      provider: 'claude',
      path,
      terminalProcessId: 802,
    });
    launcher.bindOwnedTerminal('retained-shutdown', {
      id: 'retained-shutdown-thread',
      provider: 'claude',
      cwd: directory,
    });
    launcher.retainOwnedLaunch('retained-shutdown');

    assert.deepEqual(await launcher.closeOwnedTerminals(), { windowCount: 0, processCount: 0 });
    assert.deepEqual(
      calls.filter(([command]) => command === 'taskkill.exe').map(([, args]) => args),
      [['/PID', '801', '/T', '/F']],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('macOS terminal close does not close the window when its exact TTY cannot be killed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-close-kill-failure-'));
  const calls = [];
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    createId: () => 'launch-kill-failure',
    run: async (command, args) => {
      calls.push([command, args]);
      if (command === 'osascript' && args[1].includes('do script')) return { stdout: '520\n' };
      if (command === 'osascript' && args[1].includes('return tty')) return { stdout: '/dev/ttys052\n' };
      if (command === 'ps' && args[0] === '-t') return { stdout: '820\n821\n' };
      if (command === 'kill') throw Object.assign(new Error('operation not permitted'), { code: 2 });
      return { stdout: '' };
    },
  });
  try {
    const launched = await launcher.launch(directory, 'codex');
    launcher.bindOwnedTerminal(launched.launchId, {
      id: 'kill-failure-thread', provider: 'codex', cwd: directory,
    });

    await assert.rejects(
      () => launcher.closeOwnedTerminal('kill-failure-thread'),
      /Could not close the terminal: operation not permitted/,
    );
    assert.equal(launcher.terminalForThread('kill-failure-thread').launchId, launched.launchId);
    const killCalls = calls.filter(([command]) => command === 'kill');
    assert.equal(killCalls.length, 1);
    assert.deepEqual(killCalls[0][1], ['-9', '820', '821']);
    assert.equal(calls.filter(([command, args]) => (
      command === 'osascript' && args[1].includes('then close window id')
    )).length, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('macOS terminal close treats an already empty exact TTY as terminated', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-close-empty-tty-'));
  const calls = [];
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    createId: () => 'launch-empty-tty',
    run: async (command, args) => {
      calls.push([command, args]);
      if (command === 'osascript' && args[1].includes('do script')) return { stdout: '521\n' };
      if (command === 'osascript' && args[1].includes('return tty')) return { stdout: '/dev/ttys053\n' };
      // ps reports an empty TTY through exit code 1 with no output on the standard stream.
      if (command === 'ps' && args[0] === '-t') {
        throw Object.assign(new Error('ps: no processes'), { code: 1, stdout: '' });
      }
      return { stdout: '' };
    },
  });
  try {
    const launched = await launcher.launch(directory, 'claude');
    launcher.bindOwnedTerminal(launched.launchId, {
      id: 'empty-tty-thread', provider: 'claude', cwd: directory,
    });

    await launcher.closeOwnedTerminal('empty-tty-thread');
    assert.equal(launcher.terminalForThread('empty-tty-thread'), null);
    assert.equal(calls.filter(([command]) => command === 'kill').length, 0);
    assert.equal(calls.filter(([command, args]) => (
      command === 'osascript' && args[1].includes('then close window id 521')
    )).length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('macOS terminal close waits for the exact TTY process table to drain', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-close-drain-'));
  const calls = [];
  // Enumeration, a process that survives one poll, then two consecutive empty observations.
  const processSnapshots = ['440\n441\n', '440\n', '', ''];
  let currentTime = 0;
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    createId: () => 'launch-drain',
    now: () => currentTime,
    delay: async (ms) => { currentTime += ms; },
    run: async (command, args) => {
      calls.push([command, args]);
      if (command === 'osascript' && args[1].includes('do script')) return { stdout: '522\n' };
      if (command === 'osascript' && args[1].includes('return tty')) return { stdout: '/dev/ttys054\n' };
      if (command === 'ps' && args[0] === '-t') return { stdout: processSnapshots.shift() };
      return { stdout: '' };
    },
  });
  try {
    const launched = await launcher.launch(directory, 'codex');
    launcher.bindOwnedTerminal(launched.launchId, {
      id: 'drain-thread', provider: 'codex', cwd: directory,
    });

    await launcher.closeOwnedTerminal('drain-thread');

    const closeIndex = calls.findIndex(([command, args]) => (
      command === 'osascript' && args[1].includes('then close window id 522')
    ));
    const processChecks = calls.filter(([command, args]) => command === 'ps' && args[0] === '-t');
    const finalProcessCheck = calls.findLastIndex(([command, args]) => command === 'ps' && args[0] === '-t');
    assert.equal(processChecks.length, 4);
    assert.deepEqual(
      calls.filter(([command]) => command === 'kill').map(([, args]) => args),
      [['-9', '440', '441']],
    );
    assert.ok(closeIndex > finalProcessCheck);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('macOS terminal close stays open when the exact TTY does not drain', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-close-drain-timeout-'));
  const calls = [];
  const diagnostics = [];
  let currentTime = 0;
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    createId: () => 'launch-drain-timeout',
    now: () => currentTime,
    delay: async (ms) => { currentTime += ms; },
    diagnostic: (event, details) => diagnostics.push({ event, details }),
    run: async (command, args) => {
      calls.push([command, args]);
      if (command === 'osascript' && args[1].includes('do script')) return { stdout: '523\n' };
      if (command === 'osascript' && args[1].includes('return tty')) return { stdout: '/dev/ttys055\n' };
      if (command === 'ps' && args[0] === '-t') return { stdout: '550\n' };
      return { stdout: '' };
    },
  });
  try {
    const launched = await launcher.launch(directory, 'claude');
    launcher.bindOwnedTerminal(launched.launchId, {
      id: 'drain-timeout-thread', provider: 'claude', cwd: directory,
    });

    await assert.rejects(
      () => launcher.closeOwnedTerminal('drain-timeout-thread'),
      /Processes on terminal ttys055 did not exit after SIGKILL/,
    );
    assert.equal(launcher.terminalForThread('drain-timeout-thread').launchId, launched.launchId);
    assert.deepEqual(
      calls.filter(([command]) => command === 'kill').map(([, args]) => args),
      [['-9', '550']],
    );
    assert.equal(
      diagnostics.some(({ event, details }) => (
        event === 'terminal.close.failed'
        && details.threadId === 'drain-timeout-thread'
        && /did not exit after SIGKILL/.test(details.error)
      )),
      true,
    );
    assert.equal(
      diagnostics.some(({ event }) => event === 'terminal.close.completed'),
      false,
    );
    assert.equal(calls.some(([command, args]) => (
      command === 'osascript' && args[1].includes('then close window id 523')
    )), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('macOS terminal close enumerates the exact TTY with ps and kills those exact processes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-close-ps-enumeration-'));
  const calls = [];
  // ps right-aligns identifiers, so the second line carries leading whitespace on purpose.
  const processSnapshots = ['611\n 612\n613\n', '', ''];
  let currentTime = 0;
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    createId: () => 'launch-ps-enumeration',
    now: () => currentTime,
    delay: async (ms) => { currentTime += ms; },
    run: async (command, args) => {
      calls.push([command, args]);
      if (command === 'osascript' && args[1].includes('do script')) return { stdout: '524\n' };
      if (command === 'osascript' && args[1].includes('return tty')) return { stdout: '/dev/ttys056\n' };
      if (command === 'ps' && args[0] === '-t') return { stdout: processSnapshots.shift() ?? '' };
      return { stdout: '' };
    },
  });
  try {
    const launched = await launcher.launch(directory, 'codex');
    launcher.bindOwnedTerminal(launched.launchId, {
      id: 'ps-enumeration-thread', provider: 'codex', cwd: directory,
    });
    const closeStart = calls.length;

    await launcher.closeOwnedTerminal('ps-enumeration-thread');

    const sequence = calls.slice(closeStart);
    assert.deepEqual(
      sequence.map(([command]) => command),
      ['osascript', 'ps', 'kill', 'ps', 'ps', 'osascript'],
    );
    assert.match(sequence[0][1][1], /tty of first tab of targetWindow/);
    assert.deepEqual(sequence[1][1], ['-t', 'ttys056', '-o', 'pid=']);
    // The kill step must receive the enumerated identifiers. A mechanism that silently
    // matches nothing, as pgrep and pkill -t do on Darwin 25, fails this assertion instead
    // of reporting a vacuous success.
    assert.deepEqual(sequence[2][1], ['-9', '611', '612', '613']);
    assert.equal(sequence[2][1].every((argument) => typeof argument === 'string'), true);
    assert.deepEqual(sequence[3][1], ['-t', 'ttys056', '-o', 'pid=']);
    assert.deepEqual(sequence[4][1], ['-t', 'ttys056', '-o', 'pid=']);
    assert.match(sequence[5][1][1], /close window id 524/);
    assert.equal(calls.some(([command]) => command === 'pgrep' || command === 'pkill'), false);
    assert.equal(launcher.terminalForThread('ps-enumeration-thread'), null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('macOS terminal close fails closed when the exact TTY process table stays unreadable', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-close-unreadable-'));
  const calls = [];
  let currentTime = 0;
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    createId: () => 'launch-unreadable',
    now: () => currentTime,
    delay: async (ms) => { currentTime += ms; },
    run: async (command, args) => {
      calls.push([command, args]);
      if (command === 'osascript' && args[1].includes('do script')) return { stdout: '525\n' };
      if (command === 'osascript' && args[1].includes('return tty')) return { stdout: '/dev/ttys057\n' };
      // Output that carries no usable identifier must never count as a drained TTY.
      if (command === 'ps' && args[0] === '-t') {
        throw Object.assign(new Error('ps failed'), { code: 1, stdout: 'unreadable process table\n' });
      }
      return { stdout: '' };
    },
  });
  try {
    const launched = await launcher.launch(directory, 'claude');
    launcher.bindOwnedTerminal(launched.launchId, {
      id: 'unreadable-thread', provider: 'claude', cwd: directory,
    });

    await assert.rejects(
      () => launcher.closeOwnedTerminal('unreadable-thread'),
      /Processes on terminal ttys057 did not exit after SIGKILL/,
    );
    assert.equal(launcher.terminalForThread('unreadable-thread').launchId, launched.launchId);
    assert.equal(calls.some(([command, args]) => (
      command === 'osascript' && args[1].includes('then close window id 525')
    )), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('macOS terminal close rethrows an unexpected process enumeration failure', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-close-ps-failure-'));
  const calls = [];
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    createId: () => 'launch-ps-failure',
    run: async (command, args) => {
      calls.push([command, args]);
      if (command === 'osascript' && args[1].includes('do script')) return { stdout: '526\n' };
      if (command === 'osascript' && args[1].includes('return tty')) return { stdout: '/dev/ttys058\n' };
      if (command === 'ps' && args[0] === '-t') {
        throw Object.assign(new Error('ps: command not found'), { code: 127 });
      }
      return { stdout: '' };
    },
  });
  try {
    const launched = await launcher.launch(directory, 'codex');
    launcher.bindOwnedTerminal(launched.launchId, {
      id: 'ps-failure-thread', provider: 'codex', cwd: directory,
    });

    await assert.rejects(
      () => launcher.closeOwnedTerminal('ps-failure-thread'),
      /Could not close the terminal: ps: command not found/,
    );
    assert.equal(launcher.terminalForThread('ps-failure-thread').launchId, launched.launchId);
    assert.equal(calls.some(([command]) => command === 'kill'), false);
    assert.equal(calls.some(([command, args]) => (
      command === 'osascript' && args[1].includes('then close window id 526')
    )), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('terminal process identifiers ignore blank, padded, and non-numeric ps output', () => {
  assert.deepEqual(terminalProcessIds('  501\n502\n\n'), ['501', '502']);
  assert.deepEqual(terminalProcessIds('28236\n28246\n30848\n'), ['28236', '28246', '30848']);
  assert.deepEqual(terminalProcessIds(''), []);
  assert.deepEqual(terminalProcessIds('ttys040\n'), []);
  assert.deepEqual(terminalProcessIds(null), []);
});

test('terminal ownership binding rejects mismatched and duplicate sessions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-bind-terminal-'));
  const otherDirectory = mkdtempSync(join(tmpdir(), 'relay-bind-other-'));
  const launchIds = ['launch-one', 'launch-two'];
  let nextWindowId = 610;
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    createId: () => launchIds.shift(),
    run: async (_file, args) => ({ stdout: args[1].includes('do script') ? `${nextWindowId++}\n` : '' }),
  });
  try {
    const first = await launcher.launch(directory, 'codex');
    const second = await launcher.launch(directory, 'codex');
    assert.throws(() => launcher.bindOwnedTerminal(first.launchId, {
      id: 'wrong-provider', provider: 'claude', cwd: directory,
    }), /does not match/);
    assert.throws(() => launcher.bindOwnedTerminal(first.launchId, {
      id: 'wrong-project', provider: 'codex', cwd: otherDirectory,
    }), /does not match/);

    launcher.bindOwnedTerminal(first.launchId, {
      id: 'shared-thread', provider: 'codex', cwd: directory,
    });
    assert.throws(() => launcher.bindOwnedTerminal(second.launchId, {
      id: 'shared-thread', provider: 'codex', cwd: directory,
    }), /already bound/);
    await assert.rejects(() => launcher.closeOwnedTerminal('not-owned'), /could not verify an exact native terminal/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(otherDirectory, { recursive: true, force: true });
  }
});

test('input attention re-verifies, centers, restores, fronts, and sounds the exact macOS terminal', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-terminal-attention-'));
  const calls = [];
  const diagnostics = [];
  const thread = {
    id: 'claude-needs-input',
    provider: 'claude',
    cwd: directory,
    source: 'Claude interactive',
    pid: 951,
  };
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    diagnostic: (event, details) => diagnostics.push({ event, details }),
    runtimeResolver: {
      resolve: async (threads) => {
        assert.deepEqual(threads, [thread]);
        return [{
          threadId: thread.id,
          provider: 'claude',
          path: directory,
          runtimeProcessId: 951,
          terminalWindowId: 760,
          terminalTty: '/dev/ttys060',
        }];
      },
    },
    run: async (command, args, options) => {
      calls.push([command, args, options]);
      if (args[0] === '-l') {
        return {
          stdout: JSON.stringify([
            { name: 'Built-in', x: 0, y: 25, width: 1200, height: 900, primary: true },
            { name: 'Studio Display', x: 1200, y: 25, width: 1600, height: 900, primary: false },
          ]),
        };
      }
      if (args[1].includes('set windowBounds to bounds of targetWindow')) {
        return { stdout: '1300,100,2100,700\n' };
      }
      return { stdout: '' };
    },
  });
  try {
    const path = validateProjectPath(directory).path;
    launcher.trackOwnedTerminal({
      launchId: 'attention-launch',
      provider: 'claude',
      path,
      terminalWindowId: 760,
    });
    launcher.bindOwnedTerminal('attention-launch', thread);

    assert.equal(await launcher.requestTerminalAttention(thread), true);
    const inspectScript = calls.find(([, args]) => (
      args[0] === '-e' && args[1].includes('set windowBounds to bounds of targetWindow')
    ))[1][1];
    assert.match(inspectScript, /exists window id 760/);
    assert.match(inspectScript, /\/dev\/ttys060/);

    const attentionScript = calls.find(([, args]) => (
      args[0] === '-e' && args[1].includes('set frontmost of targetWindow to true')
    ))[1][1];
    assert.match(attentionScript, /set bounds of targetWindow to \{1600, 175, 2400, 775\}/);
    assert.match(attentionScript, /set miniaturized of targetWindow to false/);
    assert.match(attentionScript, /set index of targetWindow to 1/);
    assert.match(attentionScript, /activate/);
    assert.match(attentionScript, /beep 1/);
    assert.equal(
      diagnostics.some(({ event, details }) => (
        event === 'terminal.attention.completed'
        && details.threadId === thread.id
        && details.terminalWindowId === 760
      )),
      true,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('input attention leaves every terminal untouched when live identity does not match ownership', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-terminal-attention-mismatch-'));
  const calls = [];
  const diagnostics = [];
  const thread = {
    id: 'codex-needs-input',
    provider: 'codex',
    cwd: directory,
  };
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    diagnostic: (event, details) => diagnostics.push({ event, details }),
    runtimeResolver: {
      resolve: async () => [{
        threadId: thread.id,
        provider: 'codex',
        path: directory,
        runtimeProcessId: 952,
        terminalWindowId: 999,
        terminalTty: '/dev/ttys099',
      }],
    },
    run: async (...args) => {
      calls.push(args);
      return { stdout: '' };
    },
  });
  try {
    launcher.trackOwnedTerminal({
      launchId: 'attention-mismatch-launch',
      provider: 'codex',
      path: validateProjectPath(directory).path,
      terminalWindowId: 761,
    });
    launcher.bindOwnedTerminal('attention-mismatch-launch', thread);

    assert.equal(await launcher.requestTerminalAttention(thread), false);
    assert.equal(calls.length, 0);
    assert.equal(
      diagnostics.some(({ event, details }) => (
        event === 'terminal.attention.skipped'
        && details.reason === 'identity-unverified'
      )),
      true,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('runtime-recovered terminal ownership supports explicit close with TTY revalidation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-runtime-terminal-'));
  const calls = [];
  const processSnapshots = ['930\n', '', ''];
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    createId: () => 'recovered-one',
    runtimeResolver: {
      resolve: async () => [{
        threadId: 'existing-claude',
        provider: 'claude',
        path: directory,
        runtimeProcessId: 901,
        terminalWindowId: 710,
        terminalTty: '/dev/ttys020',
      }],
    },
    run: async (command, args, options) => {
      calls.push([command, args, options]);
      if (command === 'ps' && args[0] === '-p') return { stdout: 'ttys020\n' };
      if (command === 'ps' && args[0] === '-t') return { stdout: processSnapshots.shift() ?? '' };
      if (command === 'osascript' && args[1].includes('return tty')) return { stdout: '/dev/ttys020\n' };
      return { stdout: '' };
    },
  });
  const thread = {
    id: 'existing-claude',
    provider: 'claude',
    cwd: directory,
    source: 'Claude interactive',
    pid: 901,
  };
  try {
    const canonicalDirectory = validateProjectPath(directory).path;
    assert.deepEqual(await launcher.recoverConnectedTerminals([thread]), [{
      launchId: 'runtime-recovered-one',
      threadId: 'existing-claude',
      provider: 'claude',
      path: canonicalDirectory,
    }]);
    assert.equal(launcher.ownedTerminalWindowIds.size, 0);
    assert.equal(await launcher.verifyTerminalForThread(thread), true);

    await launcher.closeOwnedTerminal('existing-claude');
    const inspectScript = calls.find(([command, args]) => (
      command === 'osascript' && args[1].includes('return tty')
    ))[1][1];
    assert.match(inspectScript, /exists window id 710/);
    assert.match(inspectScript, /count of tabs of targetWindow/);
    assert.match(inspectScript, /tty of first tab of targetWindow/);
    assert.match(inspectScript, /\/dev\/ttys020/);
    assert.deepEqual(calls.find(([command, args]) => command === 'ps' && args[0] === '-t').slice(0, 2), [
      'ps', ['-t', 'ttys020', '-o', 'pid='],
    ]);
    assert.deepEqual(calls.find(([command]) => command === 'kill').slice(0, 2), [
      'kill', ['-9', '930'],
    ]);
    assert.equal(calls.some(([command]) => command === 'pgrep' || command === 'pkill'), false);
    assert.match(calls.at(-1)[1][1], /close window id 710/);
    assert.equal(launcher.terminalForThread('existing-claude'), null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('runtime ownership is discarded when the same session moves to another terminal', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-runtime-moved-'));
  let resolution = 0;
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    createId: () => 'recovered-moved',
    runtimeResolver: {
      resolve: async () => {
        resolution += 1;
        return [{
          threadId: 'moved-claude',
          provider: 'claude',
          path: directory,
          runtimeProcessId: resolution === 1 ? 910 : 911,
          terminalWindowId: resolution === 1 ? 720 : 721,
          terminalTty: resolution === 1 ? '/dev/ttys030' : '/dev/ttys031',
        }];
      },
    },
  });
  const thread = {
    id: 'moved-claude',
    provider: 'claude',
    cwd: directory,
    source: 'Claude interactive',
    pid: 910,
  };
  try {
    await launcher.recoverConnectedTerminals([thread]);
    assert.equal(await launcher.verifyTerminalForThread(thread), false);
    assert.equal(launcher.terminalForThread(thread.id), null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('runtime recovery does not steal a terminal while its owned launch is still binding', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-runtime-pending-launch-'));
  let resolutions = 0;
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    runtimeResolver: {
      resolve: async () => {
        resolutions += 1;
        return [];
      },
    },
  });
  try {
    const path = validateProjectPath(directory).path;
    launcher.trackOwnedTerminal({
      launchId: 'pending-launch',
      provider: 'codex',
      path,
      terminalWindowId: 725,
    });

    assert.deepEqual(await launcher.recoverConnectedTerminals([{
      id: 'joining-thread',
      provider: 'codex',
      cwd: directory,
    }]), []);
    assert.equal(resolutions, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an intentionally closed session cannot be recovered from its draining connection', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-runtime-close-grace-'));
  let clock = 1_000;
  let resolutions = 0;
  const launcher = new ProjectLauncher({
    platform: 'win32',
    now: () => clock,
    recoveryRetryMs: 5_000,
    createId: () => 'recovered-after-grace',
    runtimeResolver: {
      resolve: async (threads) => {
        resolutions += 1;
        return threads.map((thread) => ({
          threadId: thread.id,
          provider: thread.provider,
          path: thread.cwd,
          terminalProcessId: 902,
        }));
      },
    },
    run: async () => ({ stdout: '' }),
  });
  const thread = {
    id: 'closed-conversation',
    provider: 'codex',
    cwd: directory,
  };
  try {
    const path = validateProjectPath(directory).path;
    launcher.trackOwnedTerminal({
      launchId: 'closed-launch',
      provider: 'codex',
      path,
      terminalProcessId: 901,
    });
    launcher.bindOwnedTerminal('closed-launch', thread);
    await launcher.closeOwnedLaunch('closed-launch');

    assert.deepEqual(await launcher.recoverConnectedTerminals([thread]), []);
    assert.equal(resolutions, 0);

    clock += 5_001;
    assert.equal((await launcher.recoverConnectedTerminals([thread])).length, 1);
    assert.equal(resolutions, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an unbound resumed launch suppresses recovery by its expected conversation ID', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-runtime-unbound-resume-'));
  let resolutions = 0;
  const launcher = new ProjectLauncher({
    platform: 'win32',
    recoveryRetryMs: 5_000,
    runtimeResolver: {
      resolve: async () => {
        resolutions += 1;
        return [];
      },
    },
    run: async () => ({ stdout: '' }),
  });
  const thread = {
    id: 'expected-resume-conversation',
    provider: 'codex',
    cwd: directory,
  };
  try {
    launcher.trackOwnedTerminal({
      launchId: 'unbound-resume-launch',
      provider: 'codex',
      path: validateProjectPath(directory).path,
      terminalProcessId: 903,
      expectedThreadId: thread.id,
    });
    await launcher.closeOwnedLaunch('unbound-resume-launch');

    assert.deepEqual(await launcher.recoverConnectedTerminals([thread]), []);
    assert.equal(resolutions, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('terminal ownership refreshes a relaunched Claude pid only in the same window and tty', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-runtime-refresh-'));
  const calls = [];
  const diagnostics = [];
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    diagnostic: (event, details) => diagnostics.push({ event, details }),
    run: async (command, args, options) => {
      calls.push([command, args, options]);
      if (command === 'ps' && args[0] === '-p') return { stdout: 'ttys040\n' };
      if (command === 'ps' && args[0] === '-t') return { stdout: '' };
      if (command === 'osascript' && args[1].includes('return tty')) return { stdout: '/dev/ttys040\n' };
      return { stdout: '' };
    },
  });
  try {
    const canonicalDirectory = validateProjectPath(directory).path;
    launcher.trackOwnedTerminal({
      launchId: 'relaunched-claude',
      provider: 'claude',
      path: canonicalDirectory,
      terminalWindowId: 730,
      terminalTty: '/dev/ttys040',
      runtimeProcessId: 920,
    });
    launcher.bindOwnedTerminal('relaunched-claude', {
      id: 'relaunched-thread',
      provider: 'claude',
      cwd: directory,
    });

    assert.equal(launcher.refreshTerminalRuntimeIdentity('relaunched-thread', {
      terminalWindowId: 731,
      terminalTty: '/dev/ttys041',
      runtimeProcessId: 921,
    }), false);
    assert.equal(launcher.refreshTerminalRuntimeIdentity('relaunched-thread', {
      terminalWindowId: 730,
      terminalTty: '/dev/ttys040',
      runtimeProcessId: 922,
    }), true);

    await launcher.closeOwnedTerminal('relaunched-thread');
    assert.deepEqual(calls.find(([command, args]) => command === 'ps' && args[0] === '-p').slice(0, 2), [
      'ps', ['-p', '922', '-o', 'tty='],
    ]);
    assert.equal(
      diagnostics.some(({ event, details }) => (
        event === 'terminal.process.refreshed'
        && details.previousRuntimeProcessId === 920
        && details.runtimeProcessId === 922
      )),
      true,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('runtime verification keeps ownership when a session restarts in the same window and tty', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-runtime-same-terminal-'));
  let resolution = 0;
  const diagnostics = [];
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    createId: () => 'same-terminal',
    diagnostic: (event, details) => diagnostics.push({ event, details }),
    runtimeResolver: {
      resolve: async () => {
        resolution += 1;
        return [{
          threadId: 'same-terminal-claude',
          provider: 'claude',
          path: directory,
          runtimeProcessId: resolution === 1 ? 930 : 931,
          terminalWindowId: 740,
          terminalTty: '/dev/ttys050',
        }];
      },
    },
  });
  const thread = {
    id: 'same-terminal-claude',
    provider: 'claude',
    cwd: directory,
    source: 'Claude interactive',
    pid: 930,
  };
  try {
    await launcher.recoverConnectedTerminals([thread]);
    assert.equal(await launcher.verifyTerminalForThread({ ...thread, pid: 931 }), true);
    assert.notEqual(launcher.terminalForThread(thread.id), null);
    assert.equal(
      diagnostics.some(({ event, details }) => (
        event === 'terminal.recovery.process_refreshed'
        && details.previousRuntimeProcessId === 930
        && details.runtimeProcessId === 931
      )),
      true,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('runtime-recovered terminals are not closed implicitly during CC Relay shutdown', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-runtime-shutdown-'));
  const calls = [];
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    createId: () => 'recovered-two',
    runtimeResolver: {
      resolve: async () => [{
        threadId: 'manual-codex',
        provider: 'codex',
        path: directory,
        runtimeProcessId: 902,
        terminalWindowId: 711,
        terminalTty: '/dev/ttys021',
      }],
    },
    run: async (...args) => {
      calls.push(args);
      return { stdout: '' };
    },
  });
  try {
    await launcher.recoverConnectedTerminals([{
      id: 'manual-codex', provider: 'codex', cwd: directory,
    }]);
    assert.deepEqual(await launcher.closeOwnedTerminals(), { windowCount: 0, processCount: 0 });
    assert.equal(calls.length, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('project launcher does not open a Codex terminal until the shared endpoint is ready', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-not-ready-'));
  let terminalDispatched = false;
  let workspaceReserved = false;
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    run: async () => { terminalDispatched = true; },
    ensureCodexReady: async () => { throw new Error('Codex endpoint unavailable'); },
    reserveCodexLaunch: () => {
      workspaceReserved = true;
      return () => {};
    },
  });
  try {
    await assert.rejects(() => launcher.launch(directory, 'codex'), /Codex endpoint unavailable/);
    assert.equal(terminalDispatched, false);
    assert.equal(workspaceReserved, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('project launcher advances mixed Codex and Claude windows through one shared grid', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-grid-'));
  const calls = [];
  let inspectionCount = 0;
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    run: async (...args) => {
      calls.push(args);
      if (args[1][0] === '-l' && args[1].at(-1).includes('NSScreen')) {
        return { stdout: JSON.stringify([{ name: 'Studio Display', x: 0, y: 25, width: 1200, height: 900, primary: true }]) };
      }
      if (args[1][0] === '-l') {
        inspectionCount += 1;
        return {
          stdout: inspectionCount === 1
            ? '[]'
            : JSON.stringify([{ x: 0, y: 25, width: 400, height: 300 }]),
        };
      }
      return { stdout: '' };
    },
  });
  try {
    const layout = { enabled: true, columns: 3, rows: 3, display: 0 };
    const first = await launcher.launch(directory, 'codex', layout);
    const second = await launcher.launch(directory, 'claude', layout);
    assert.equal(first.slot, 0);
    assert.equal(second.slot, 1);
    assert.deepEqual(first.bounds, { left: 0, top: 25, right: 400, bottom: 325 });
    assert.equal(second.provider, 'claude');
    assert.match(second.command, /dangerously-skip-permissions --session-id/);
    assert.match(calls[2][1][1], /set launchedTab to do script/);
    assert.match(calls[2][1][1], /set launchedWindow to first window whose selected tab is launchedTab/);
    assert.match(calls[2][1][1], /set launchedWindowId to id of launchedWindow/);
    assert.match(calls[2][1][1], /set bounds of window id launchedWindowId to \{0, 25, 400, 325\}/);
    assert.match(calls[5][1][1], /set bounds of window id launchedWindowId to \{400, 25, 800, 325\}/);
    assert.match(calls[5][1][1], /delay 0\.4/);
    assert.match(calls[5][1][1], /dangerously-skip-permissions/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('project launcher serializes concurrent launches so each window reserves a different cell', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-concurrent-grid-'));
  const placedBounds = [];
  let visibleWindows = [];
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    run: async (_file, args) => {
      if (args[0] === '-l' && args.at(-1).includes('NSScreen')) {
        return { stdout: JSON.stringify([{ name: 'Studio Display', x: 0, y: 25, width: 1200, height: 900, primary: true }]) };
      }
      if (args[0] === '-l') return { stdout: JSON.stringify(visibleWindows) };
      const match = args[1].match(/set bounds of window id launchedWindowId to \{(\d+), (\d+), (\d+), (\d+)\}/);
      assert.ok(match);
      const bounds = {
        left: Number(match[1]),
        top: Number(match[2]),
        right: Number(match[3]),
        bottom: Number(match[4]),
      };
      placedBounds.push(bounds);
      visibleWindows = [...visibleWindows, bounds];
      return { stdout: '' };
    },
  });
  try {
    const layout = { enabled: true, columns: 3, rows: 1, display: 0 };
    const launches = await Promise.all([
      launcher.launch(directory, 'codex', layout),
      launcher.launch(directory, 'claude', layout),
      launcher.launch(directory, 'codex', layout),
    ]);
    assert.deepEqual(launches.map(({ slot }) => slot), [0, 1, 2]);
    assert.deepEqual(placedBounds.map(({ left }) => left), [0, 400, 800]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native folder picker treats user cancellation as a normal result', async () => {
  const error = new Error('User canceled.');
  error.code = 1;
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    run: async () => { throw error; },
  });
  assert.equal(await launcher.chooseFolder(), null);
});

test('project launcher cancels a Codex workspace reservation when terminal dispatch fails', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-failed-launch-'));
  let cancelled = false;
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    run: async () => { throw new Error('Terminal unavailable'); },
    reserveCodexLaunch: () => () => { cancelled = true; },
  });
  try {
    await assert.rejects(() => launcher.launch(directory, 'codex'), /Terminal unavailable/);
    assert.equal(cancelled, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Windows launcher uses native PowerShell picker and opens cmd in the project', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-windows-'));
  const calls = [];
  const launcher = new ProjectLauncher({
    platform: 'win32',
    run: async (...args) => {
      calls.push(args);
      return { stdout: `${directory}\r\n` };
    },
  });
  try {
    assert.equal((await launcher.chooseFolder()).name, directory.split('/').at(-1));
    const result = await launcher.launch(directory, 'claude');
    assert.match(result.command, new RegExp(`^${CLAUDE_RELAY_COMMAND} --session-id \\"[0-9a-f-]+\\"$`));
    assert.equal(calls[0][0], 'powershell.exe');
    assert.match(calls[0][1].at(-1), /FolderBrowserDialog/);
    assert.match(calls[1][1].at(-1), /Start-Process -FilePath 'cmd\.exe'/);
    assert.match(calls[1][1].at(-1), /dangerously-skip-permissions/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('project launcher pins the resolved claude binary in the macOS launch command', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-pinned-claude-'));
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    claudeBinary: '/Users/tester/.local/bin/claude',
    run: async () => ({ stdout: '17\n' }),
  });
  try {
    const result = await launcher.launch(directory, 'claude');
    assert.match(
      result.command,
      /&& '\/Users\/tester\/\.local\/bin\/claude' --dangerously-skip-permissions --session-id '[0-9a-f-]+'$/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

const LAUNCH_HOOK_SETTINGS = {
  hooks: {
    Stop: [{
      hooks: [{ type: 'http', url: 'http://127.0.0.1:58925/hook', timeout: 1 }],
    }],
  },
};

// Model and effort ride on the FIRST launch command, before the settings JSON, so the terminal a
// user watches opens already configured instead of opening, being killed, and reopening.
test('a task-owned Claude launch command carries model and effort for fresh, resumed, and initialized sessions', () => {
  assert.equal(
    claudeRelayCommand('fresh-session', shellQuote, 'claude', null, null, { model: 'opus', effort: 'max' }),
    "claude --dangerously-skip-permissions --session-id 'fresh-session' --model 'opus' --effort 'max'",
  );
  assert.equal(
    claudeRelayCommand(null, shellQuote, 'claude', 'saved-conversation', null, { model: 'fable', effort: 'high' }),
    "claude --dangerously-skip-permissions --resume 'saved-conversation' --model 'fable' --effort 'high'",
  );
  // The initialize case (a saved UUID whose conversation never materialized) keeps --session-id.
  assert.equal(
    claudeRelayCommand('saved-uuid', shellQuote, 'claude', null, LAUNCH_HOOK_SETTINGS, { model: 'opus', effort: null }),
    `claude --dangerously-skip-permissions --session-id 'saved-uuid' --model 'opus' --settings ${shellQuote(JSON.stringify(LAUNCH_HOOK_SETTINGS))}`,
  );
  // Effort alone is a valid selection: the account default model plus an explicit effort.
  assert.equal(
    claudeRelayCommand('fresh-session', shellQuote, 'claude', null, null, { model: null, effort: 'max' }),
    "claude --dangerously-skip-permissions --session-id 'fresh-session' --effort 'max'",
  );
  // An interactive Launchpad launch passes nothing and is byte-identical to before.
  assert.equal(claudeRelayCommand('fresh-session'), "claude --dangerously-skip-permissions --session-id 'fresh-session'");
  assert.equal(
    terminalCommand('/', 'claude', {
      claudeSessionId: 'fresh-session',
      claudeLaunchSettings: { model: 'opus', effort: 'max' },
    }),
    "cd '/' && claude --dangerously-skip-permissions --session-id 'fresh-session' --model 'opus' --effort 'max'",
  );
});

// The relaunch command emits --permission-mode INSTEAD of --dangerously-skip-permissions. Wiring
// a council stage through this builder without that exclusion would send both, so it refuses.
test('a Claude launch command refuses plan-mode settings instead of emitting conflicting flags', () => {
  assert.throws(
    () => claudeRelayCommand('s', shellQuote, 'claude', null, null, { model: 'fable', permissionMode: 'plan' }),
    /model and effort only/,
  );
  assert.throws(
    () => claudeRelayCommand('s', shellQuote, 'claude', null, null, { tools: ['Read'] }),
    /model and effort only/,
  );
  assert.throws(
    () => claudeRelayCommand('s', shellQuote, 'claude', null, null, { addDirectories: ['/repo/images'] }),
    /model and effort only/,
  );
});

test('a Claude launch records its settings against the first provider process and forgets them when the pid changes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-launch-settings-'));
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    createId: () => 'settings-session',
    claudeSettingsForSession: () => LAUNCH_HOOK_SETTINGS,
    run: async () => ({ stdout: '17\n' }),
  });
  try {
    const launched = await launcher.launch(directory, 'claude', null, {
      claudeLaunchSettings: { model: 'opus', effort: 'max' },
    });
    assert.match(launched.command, /--session-id 'settings-session' --model 'opus' --effort 'max' --settings /);
    launcher.bindOwnedTerminal(launched.launchId, {
      id: 'settings-session',
      provider: 'claude',
      cwd: directory,
    });

    // Nothing is proven until a live provider process has actually been observed on this launch.
    assert.equal(launcher.provenClaudeLaunchSettings('settings-session'), null);

    const identity = { terminalWindowId: 17, terminalTty: '/dev/ttys042', runtimeProcessId: 900 };
    assert.equal(launcher.refreshTerminalRuntimeIdentity('settings-session', identity), true);
    assert.deepEqual(launcher.provenClaudeLaunchSettings('settings-session'), {
      model: 'opus',
      effort: 'max',
      permissionMode: null,
      tools: [],
      addDirectories: [],
      hookSettingsJson: JSON.stringify(LAUNCH_HOOK_SETTINGS),
    });

    // A different provider pid in the same tab is a process CC Relay did not configure, so the
    // record stops proving anything and the executor falls back to its restart.
    assert.equal(
      launcher.refreshTerminalRuntimeIdentity('settings-session', { ...identity, runtimeProcessId: 901 }),
      true,
    );
    assert.equal(launcher.provenClaudeLaunchSettings('settings-session'), null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// Without this, the whole feature could pass every other test and still be dead code in
// production: if a first runtime resolution could hand back a terminal with no runtimeProcessId,
// the pid latch would never arm on a task's FIRST turn, the executor would relaunch, and the
// post-relaunch pid would then permanently invalidate the record. This walks the exact sequence
// src/server.mjs resolveClaudeTerminal runs, through the real resolver.
test('the production resolve sequence proves a freshly launched Claude terminal on its first turn', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-proven-launch-'));
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    createId: () => 'proven-session',
    claudeSettingsForSession: () => LAUNCH_HOOK_SETTINGS,
    run: async () => ({ stdout: '17\n' }),
  });
  const runtimeResolver = new TerminalRuntimeResolver({
    platform: 'darwin',
    run: async (command) => {
      if (command === 'ps') return { stdout: '901 ttys020\n' };
      if (command === 'osascript') {
        return { stdout: JSON.stringify([{ id: 17, tabs: [{ tty: '/dev/ttys020' }] }]) };
      }
      throw new Error(`Unexpected command: ${command}`);
    },
  });
  try {
    const launched = await launcher.launch(directory, 'claude', null, {
      claudeLaunchSettings: { model: 'opus', effort: 'max' },
    });
    launcher.bindOwnedTerminal(launched.launchId, {
      id: 'proven-session',
      provider: 'claude',
      cwd: directory,
    });

    const session = {
      id: 'proven-session',
      provider: 'claude',
      cwd: directory,
      source: 'Claude interactive',
      pid: 901,
    };
    const [native] = await runtimeResolver.resolve([session]);
    // A Claude candidate without a positive pid is dropped before resolution, so a resolved
    // Claude terminal always carries its live process id on the very first pass.
    assert.equal(native.runtimeProcessId, 901);
    assert.equal(launcher.refreshTerminalRuntimeIdentity(session.id, native), true);
    assert.deepEqual(launcher.provenClaudeLaunchSettings(session.id), {
      model: 'opus',
      effort: 'max',
      permissionMode: null,
      tools: [],
      addDirectories: [],
      hookSettingsJson: JSON.stringify(LAUNCH_HOOK_SETTINGS),
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an interactive Launchpad Claude launch records no settings and never claims to be preconfigured', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-legacy-launch-'));
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    createId: () => 'legacy-session',
    claudeSettingsForSession: () => LAUNCH_HOOK_SETTINGS,
    run: async () => ({ stdout: '17\n' }),
  });
  try {
    const launched = await launcher.launch(directory, 'claude');
    assert.equal(/--model|--effort/.test(launched.command), false);
    launcher.bindOwnedTerminal(launched.launchId, {
      id: 'legacy-session',
      provider: 'claude',
      cwd: directory,
    });
    launcher.refreshTerminalRuntimeIdentity('legacy-session', {
      terminalWindowId: 17,
      terminalTty: '/dev/ttys042',
      runtimeProcessId: 900,
    });
    assert.equal(launcher.provenClaudeLaunchSettings('legacy-session'), null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a Codex launch cannot carry Claude model and effort settings', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-codex-launch-settings-'));
  const launcher = new ProjectLauncher({ platform: 'darwin', run: async () => ({ stdout: '17\n' }) });
  try {
    await assert.rejects(
      () => launcher.launch(directory, 'codex', null, { claudeLaunchSettings: { model: 'opus' } }),
      /Only a Claude terminal launch/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('project launcher installs live Claude hooks for its expected session', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-hooked-claude-'));
  const requestedSessions = [];
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    createId: () => 'hooked-session',
    claudeSettingsForSession: (sessionId) => {
      requestedSessions.push(sessionId);
      return {
        hooks: {
          Stop: [{
            hooks: [{ type: 'http', url: 'http://127.0.0.1:58925/hook', timeout: 1 }],
          }],
        },
      };
    },
    run: async () => ({ stdout: '17\n' }),
  });
  try {
    const result = await launcher.launch(directory, 'claude');
    assert.deepEqual(requestedSessions, ['hooked-session']);
    assert.match(result.command, /--settings '\{"hooks":\{"Stop":/);
    assert.match(result.command, /127\.0\.0\.1:58925\/hook/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// The evaluated body is this repository's own committed source, never test input or any value
// derived from one, so running it here carries no injection surface.
function evaluateTerminalBounds(windows, { running = true, runningThrows = false } = {}) {
  const source = readFileSync(new URL('../src/project-launcher.mjs', import.meta.url), 'utf8');
  const script = source.match(/const DARWIN_TERMINAL_BOUNDS_INVENTORY = `([\s\S]*?)`;/)?.[1];
  assert.ok(script, 'the macOS Terminal bounds script must stay readable from source');
  assert.equal(/terminal\.windows\(\)\.map/.test(script), false);
  const evaluate = new Function('Application', `${script}\nreturn windowBounds();`);
  return evaluate(() => ({
    running: () => {
      if (runningThrows) throw new Error('Terminal cannot report whether it is running.');
      return running;
    },
    windows: () => windows,
  }));
}

test('one Terminal window that refuses its bounds does not erase the whole grid pass', () => {
  const readable = { bounds: () => ({ x: 0, y: 30, width: 1706, height: 443 }) };
  const unreadable = { bounds: () => { throw new Error('Terminal cannot describe this window.'); } };
  const nullBounds = { bounds: () => null };
  assert.deepEqual(
    evaluateTerminalBounds([unreadable, readable, nullBounds]),
    [null, { x: 0, y: 30, width: 1706, height: 443 }, null],
  );
  assert.deepEqual(evaluateTerminalBounds([readable], { running: false }), []);
  assert.deepEqual(evaluateTerminalBounds([readable], { runningThrows: true }), []);
  // Grid placement keeps only the rectangles it could actually read, so an unreadable window
  // never becomes a bogus occupied cell and never hides a real one.
  assert.deepEqual(
    evaluateTerminalBounds([unreadable, readable]).map(normalizeMacTerminalWindowBounds).filter(Boolean),
    [{ left: 0, top: 30, right: 1706, bottom: 473 }],
  );
});

test('grid placement drops unreadable Terminal windows and keeps the readable rectangles', async () => {
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    run: async () => ({
      stdout: JSON.stringify([null, { x: 0, y: 30, width: 1706, height: 443 }]),
    }),
  });
  assert.deepEqual(await launcher.listTerminalWindowBounds(), [
    { left: 0, top: 30, right: 1706, bottom: 473 },
  ]);
});

test('a missing conversation ID never targets a terminal that is still binding', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-null-thread-close-'));
  const calls = [];
  let nextWindowId = 620;
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    run: async (...args) => {
      calls.push(args);
      if (args[0] === 'osascript' && args[1][1].includes('do script')) return { stdout: `${nextWindowId++}\n` };
      if (args[0] === 'osascript' && args[1][1].includes('return tty')) return { stdout: 'ttys060\n' };
      if (args[0] === 'ps' && args[1][0] === '-t') return { stdout: '' };
      return { stdout: '' };
    },
  });
  try {
    // This launch is still unbound, exactly like a second task's terminal during its binding
    // window. Owned launches hold threadId = null until they bind, so a lookup by a missing
    // conversation ID used to match this one and close somebody else's terminal.
    const binding = await launcher.launch(directory, 'claude');
    assert.equal(binding.terminalWindowId, 620);

    await assert.rejects(
      () => launcher.closeOwnedTerminal(null),
      /could not verify an exact native terminal/,
    );
    await assert.rejects(
      () => launcher.closeOwnedTerminal(''),
      /could not verify an exact native terminal/,
    );
    assert.equal(launcher.terminalForThread(null), null);
    assert.equal(launcher.terminalForThread(''), null);
    assert.equal(await launcher.verifyTerminalForThread({ id: null }), false);
    assert.equal(launcher.refreshTerminalRuntimeIdentity(null, {
      terminalWindowId: 620,
      terminalTty: '/dev/ttys060',
    }), false);
    assert.equal(
      calls.some(([command, args]) => command === 'osascript' && args[1].includes('then close window id')),
      false,
    );
    assert.deepEqual(launcher.terminalForLaunch(binding.launchId), {
      launchId: binding.launchId,
      threadId: null,
      provider: 'claude',
      path: binding.path,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Windows launcher can start cmd minimized', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-windows-background-'));
  const calls = [];
  const launcher = new ProjectLauncher({
    platform: 'win32',
    run: async (...args) => {
      calls.push(args);
      return { stdout: '' };
    },
  });
  try {
    await launcher.launch(directory, 'claude', { enabled: false, background: true });
    assert.match(calls[0][1].at(-1), /-WindowStyle Minimized/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Windows shutdown force-kills only cmd process trees launched by CC Relay', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-owned-windows-terminal-'));
  const calls = [];
  const processIds = [7123, 7124];
  const launcher = new ProjectLauncher({
    platform: 'win32',
    run: async (...args) => {
      calls.push(args);
      if (args[0] === 'powershell.exe') return { stdout: `${processIds.shift()}\r\n` };
      return { stdout: '' };
    },
  });
  try {
    const first = await launcher.launch(directory, 'codex');
    const second = await launcher.launch(directory, 'claude');
    assert.equal(first.terminalProcessId, 7123);
    assert.equal(second.terminalProcessId, 7124);

    const closed = await launcher.closeOwnedTerminals();
    const taskkillCalls = calls.filter(([file]) => file === 'taskkill.exe');
    assert.deepEqual(closed, { windowCount: 0, processCount: 2 });
    assert.deepEqual(taskkillCalls.map(([, args]) => args), [
      ['/PID', '7123', '/T', '/F'],
      ['/PID', '7124', '/T', '/F'],
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the Windows launch script stays parseable PowerShell and never uses WaitForInputIdle', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-windows-placement-'));
  const calls = [];
  const launcher = new ProjectLauncher({
    platform: 'win32',
    run: async (...args) => {
      calls.push(args);
      if (String(args[1]?.at(-1)).includes('AllScreens')) {
        return { stdout: '{"name":"D1","x":0,"y":0,"width":1920,"height":1040,"primary":true}\r\n' };
      }
      return { stdout: '4242\r\n' };
    },
  });
  try {
    const launched = await launcher.launch(directory, 'codex', {
      enabled: true,
      rows: 2,
      columns: 2,
      display: 0,
      background: false,
    });
    assert.equal(launched.terminalProcessId, 4242);
    const script = calls.at(-1)[1].at(-1);

    // PowerShell has no backslash escape. A single \" anywhere would end the string that carries
    // the C# source, so the placement statement would fail before MoveWindow could run.
    assert.ok(!script.includes('\\"'), 'the launch script must contain no backslash-escaped quotes');
    // cmd.exe is a console process, so WaitForInputIdle always throws against it.
    assert.ok(!script.includes('WaitForInputIdle'));
    // How the DllImport quote is produced is deliberately not asserted, so a later switch to
    // backticks or -EncodedCommand stays free as long as the script keeps parsing.
    assert.match(script, /Add-Type -TypeDefinition/);
    assert.match(script, /user32\.dll/);
    // Placement never fails a launch that already opened a terminal.
    assert.match(script, /try \{ Add-Type[\s\S]*\} catch \{ \}/);
    assert.match(script, /MoveWindow\(\$process\.MainWindowHandle, 0, 0, 960, 520, \$true\)/);
    // No `; ` directly after an opening brace, which would rely on an empty PowerShell statement.
    assert.ok(!/\{\s*;/.test(script), 'no statement list may start with a semicolon');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a minimized Windows launch skips grid placement instead of moving an iconic window', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-windows-minimized-grid-'));
  const calls = [];
  const launcher = new ProjectLauncher({
    platform: 'win32',
    run: async (...args) => {
      calls.push(args);
      if (String(args[1]?.at(-1)).includes('AllScreens')) {
        return { stdout: '{"name":"D1","x":0,"y":0,"width":1920,"height":1040,"primary":true}\r\n' };
      }
      return { stdout: '4243\r\n' };
    },
  });
  try {
    await launcher.launch(directory, 'claude', {
      enabled: true,
      rows: 2,
      columns: 2,
      display: 0,
      background: true,
    });
    const script = calls.at(-1)[1].at(-1);
    assert.match(script, /-WindowStyle Minimized/);
    assert.ok(!script.includes('MoveWindow'));
    assert.ok(!script.includes('Add-Type'));
    assert.match(script, /-PassThru; \$process\.Id$/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a quoted Windows provider command survives the cmd.exe /K quote-stripping rule', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-windows-cmd-quotes-'));
  const calls = [];
  const launcher = new ProjectLauncher({
    platform: 'win32',
    claudeBinary: 'C:\\Users\\Test User\\AppData\\Roaming\\npm\\claude.cmd',
    run: async (...args) => {
      calls.push(args);
      return { stdout: '4244\r\n' };
    },
  });
  try {
    const launched = await launcher.launch(directory, 'claude');
    // The reported command stays the logical command. Only the cmd.exe argument is wrapped.
    assert.ok(launched.command.startsWith('"C:\\Users\\Test User\\AppData\\Roaming\\npm\\claude.cmd" --dangerously-skip-permissions'));
    assert.ok(!launched.command.startsWith('""'));
    const script = calls.at(-1)[1].at(-1);
    assert.ok(
      script.includes(`-ArgumentList '/k', '"${launched.command}"'`),
      'the cmd.exe command must carry one extra wrapping quote pair',
    );
    // cmd /K removes the first character and the last quote of the line, which restores the
    // exact command including the quoted binary path.
    const cmdLine = script.split("-ArgumentList '/k', '")[1].split("' -PassThru")[0];
    const stripped = cmdLine.slice(1).replace(/"([^"]*)$/, '$1');
    assert.equal(stripped, launched.command);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a Windows project path ending in a backslash cannot escape its own closing quote', () => {
  assert.equal(cmdQuote('D:\\'), '"D:\\\\"');
  assert.equal(cmdQuote('C:\\Users\\a b'), '"C:\\Users\\a b"');
  assert.equal(cmdQuote('{"hooks":1}'), '"{""hooks"":1}"');
});

test('a Windows terminal the user already closed still releases its ownership', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-windows-missing-process-'));
  const diagnostics = [];
  // execFile puts stderr into the rejection message, so these mirror the real rejection shape.
  // The first is a localized Windows install, where only the exit code identifies the outcome.
  // The second keeps the English text under an exit code the numeric check would not catch.
  const failures = [
    Object.assign(
      new Error('Command failed: taskkill.exe /PID 5001 /T /F\nFEHLER: Der Prozess "5001" wurde nicht gefunden.\r\n'),
      { code: 128, stderr: 'FEHLER: Der Prozess "5001" wurde nicht gefunden.\r\n' },
    ),
    Object.assign(
      new Error('Command failed: taskkill.exe /PID 5002 /T /F\nERROR: The process "5002" not found.\r\n'),
      { code: 255, stderr: 'ERROR: The process "5002" not found.\r\n' },
    ),
  ];
  const launcher = new ProjectLauncher({
    platform: 'win32',
    diagnostic: (event, details) => diagnostics.push({ event, details }),
    run: async (file) => {
      if (file === 'taskkill.exe') throw failures.shift();
      return { stdout: '' };
    },
  });
  try {
    const path = validateProjectPath(directory).path;
    for (const [index, processId] of [5001, 5002].entries()) {
      const launchId = `gone-${processId}`;
      const threadId = `gone-thread-${processId}`;
      launcher.trackOwnedTerminal({
        launchId,
        provider: index === 0 ? 'codex' : 'claude',
        path,
        terminalProcessId: processId,
      });
      launcher.bindOwnedTerminal(launchId, {
        id: threadId,
        provider: index === 0 ? 'codex' : 'claude',
        cwd: directory,
      });
      const closed = await launcher.closeOwnedTerminal(threadId);
      assert.equal(closed.threadId, threadId);
      assert.equal(launcher.terminalForThread(threadId), null);
    }
    assert.deepEqual(
      diagnostics.filter((entry) => entry.event === 'terminal.close.already_exited')
        .map((entry) => entry.details.terminalProcessId),
      [5001, 5002],
    );
    assert.equal(
      diagnostics.filter((entry) => entry.event === 'terminal.close.failed').length,
      0,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('any other Windows taskkill failure still fails closed and keeps the launch owned', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-windows-taskkill-denied-'));
  const diagnostics = [];
  const launcher = new ProjectLauncher({
    platform: 'win32',
    diagnostic: (event, details) => diagnostics.push({ event, details }),
    run: async (file) => {
      if (file === 'taskkill.exe') {
        throw Object.assign(
          new Error('Command failed: taskkill.exe /PID 5003 /T /F\nERROR: The process "5003" could not be terminated.\r\nReason: Access is denied.\r\n'),
          {
            code: 1,
            stderr: 'ERROR: The process "5003" could not be terminated.\r\nReason: Access is denied.\r\n',
          },
        );
      }
      return { stdout: '' };
    },
  });
  try {
    const path = validateProjectPath(directory).path;
    launcher.trackOwnedTerminal({
      launchId: 'denied-launch',
      provider: 'codex',
      path,
      terminalProcessId: 5003,
    });
    launcher.bindOwnedTerminal('denied-launch', {
      id: 'denied-thread',
      provider: 'codex',
      cwd: directory,
    });
    await assert.rejects(
      () => launcher.closeOwnedTerminal('denied-thread'),
      /Access is denied/,
    );
    assert.equal(launcher.terminalForThread('denied-thread').launchId, 'denied-launch');
    assert.equal(
      diagnostics.filter((entry) => entry.event === 'terminal.close.failed').length,
      1,
    );
    assert.equal(
      diagnostics.filter((entry) => entry.event === 'terminal.close.already_exited').length,
      0,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('windowsTerminalProcessMissing accepts the exit code and the localized message only', () => {
  assert.equal(windowsTerminalProcessMissing(null), false);
  assert.equal(windowsTerminalProcessMissing(Object.assign(new Error('x'), { code: 128 })), true);
  assert.equal(
    windowsTerminalProcessMissing(Object.assign(new Error('x'), {
      code: 255,
      stderr: 'ERROR: The process "1" not found.',
    })),
    true,
  );
  assert.equal(
    windowsTerminalProcessMissing(Object.assign(new Error('x'), {
      code: 1,
      stderr: 'ERROR: The process "1" could not be terminated.\nReason: Access is denied.',
    })),
    false,
  );
  assert.equal(windowsTerminalProcessMissing(Object.assign(new Error('ETIMEDOUT'), {})), false);
});
