import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  CODEX_RELAY_COMMAND,
  CLAUDE_RELAY_COMMAND,
  ProjectLauncher,
  firstAvailableGridSlot,
  gridBounds,
  normalizeTerminalLayout,
  shellQuote,
  terminalCommand,
  validateProjectPath,
} from '../src/project-launcher.mjs';

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

test('project launcher validates folders and builds fixed provider commands', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay project-'));
  try {
    const project = validateProjectPath(directory);
    assert.equal(project.name, directory.split('/').at(-1));
    assert.equal(terminalCommand(project.path, 'codex'), `cd ${shellQuote(project.path)} && ${CODEX_RELAY_COMMAND}`);
    assert.equal(terminalCommand(project.path, 'claude'), `cd ${shellQuote(project.path)} && ${CLAUDE_RELAY_COMMAND}`);
    assert.throws(() => terminalCommand(directory, 'custom'), /Unsupported AI provider/);
    assert.throws(() => validateProjectPath('relative'), /absolute/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('project launcher opens Terminal with a quoted project command', async () => {
  const directory = mkdtempSync(join(tmpdir(), "relay's-project-"));
  const calls = [];
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    run: async (...args) => {
      calls.push(args);
      return { stdout: '' };
    },
  });
  try {
    const result = await launcher.launch(directory, 'codex');
    assert.equal(result.provider, 'codex');
    assert.equal(calls[0][0], 'osascript');
    assert.match(calls[0][1][1], /tell application "Terminal"/);
    assert.match(calls[0][1][1], /--remote ws:\/\/127\.0\.0\.1:4769/);
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
            : JSON.stringify([{ left: 0, top: 25, right: 400, bottom: 325 }]),
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
    assert.match(second.command, /dangerously-skip-permissions$/);
    assert.match(calls[2][1][1], /set launchedWindowId to id of front window/);
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
    assert.equal(result.command, CLAUDE_RELAY_COMMAND);
    assert.equal(calls[0][0], 'powershell.exe');
    assert.match(calls[0][1].at(-1), /FolderBrowserDialog/);
    assert.match(calls[1][1].at(-1), /Start-Process -FilePath 'cmd\.exe'/);
    assert.match(calls[1][1].at(-1), /dangerously-skip-permissions/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
