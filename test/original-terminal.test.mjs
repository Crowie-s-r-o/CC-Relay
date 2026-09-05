import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openNativeTerminal, windowsTerminalOpenScript } from '../src/native-terminal-opener.mjs';
import { ProjectLauncher, validateProjectPath } from '../src/project-launcher.mjs';
import { TaskOriginalTerminal, taskTerminalCandidates } from '../src/task-original-terminal.mjs';

const birth = '134330400000000000';
const winIdentity = { terminalProcessId: 4101, terminalProcessStartedAt: birth };

test('Windows focus pins process birth, window ownership, and successful foreground evidence', async () => {
  const calls = [];
  await openNativeTerminal({ platform: 'win32', terminal: winIdentity, run: async (...args) => {
    calls.push(args);
    return { stdout: 'opened\r\n' };
  } });
  const [file, args, options] = calls[0];
  assert.equal(file, 'powershell.exe');
  assert.ok(args.includes('-NonInteractive'));
  const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
  assert.match(script, /Get-Process -Id 4101/);
  assert.ok(script.includes(`-cne '${birth}'`));
  assert.match(script, /\$null = \$target.Handle/);
  assert.match(script, /GetWindowThreadProcessId\(\$handle, \[ref\]\$windowProcess\)/);
  assert.match(script, /\$windowProcess -ne 4101/);
  assert.match(script, /GetForegroundWindow\(\) -ne \$handle/);
  assert.match(script, /finally \{ \$target.Dispose\(\) \}/);
  assert.equal(options.windowsHide, true);
  assert.ok(options.timeout > 0);
  assert.doesNotMatch(script, /Start-Process|SendKeys|AppActivate|Get-Process -Name/);
});

for (const identity of [ {}, { ...winIdentity, terminalProcessId: -1 },
  { ...winIdentity, terminalProcessStartedAt: null }, { ...winIdentity, terminalProcessStartedAt: "1'; Start-Process calc" }]) {
  test(`Windows rejects incomplete or untrusted launch identity ${JSON.stringify(identity)}`, async () => {
    assert.equal(windowsTerminalOpenScript(identity), null);
    await assert.rejects(openNativeTerminal({ platform: 'win32', terminal: identity,
      run: () => assert.fail('must not run PowerShell') }), /identity/);
  });
}

test('native open never reports a failed OS action as opened', async () => {
  await assert.rejects(openNativeTerminal({ platform: 'win32', terminal: winIdentity,
    run: async () => ({ stdout: '' }) }), /could not show/);
  await assert.rejects(openNativeTerminal({ platform: 'win32', terminal: winIdentity,
    run: async () => { throw new Error('PID changed'); } }), /could not foreground/);
});

test('macOS opens only one existing window with its exact tty and sends no input', async () => {
  let script;
  await openNativeTerminal({ platform: 'darwin', terminal: { terminalWindowId: 417, terminalTty: '/dev/ttys021' },
    run: async (file, args, options) => {
      assert.equal(file, 'osascript'); script = args.at(-1); assert.ok(options.timeout > 0);
    } });
  assert.match(script, /exists window id 417/);
  assert.match(script, /count of tabs of targetWindow\) is not 1/);
  assert.match(script, /tty of first tab of targetWindow\) is not "\/dev\/ttys021"/);
  assert.match(script, /miniaturized of targetWindow to false/);
  assert.doesNotMatch(script, /do script|keystroke|beep|set bounds/);
});

function taskWorld({ platform = 'darwin', provider = 'codex', mode = 'execute' } = {}) {
  let task = { id: 4, provider, mode, status: 'running', repo_path: '/synthetic/project', thread_id: 'session-a' };
  const owned = new Map([['session-a', { provider, path: task.repo_path, launchId: 'launch-a' }]]);
  const calls = [];
  let claudeMode = null;
  const launcher = {
    terminalForThread: (id) => owned.get(id),
    openOriginalTerminal: async (thread, options) => {
      assert.equal(options.isCurrent(), true); calls.push(thread); return { state: 'opened' };
    },
  };
  const service = new TaskOriginalTerminal({ database: { getTask: () => task }, launcher, platform,
    knownThread: () => ({ pid: 400, cwd: '/incorrect', provider: 'incorrect' }), claudeMode: () => claudeMode });
  return { service, launcher, owned, calls, setTask: (next) => { task = next; }, task: () => task,
    setClaudeMode: (value) => { claudeMode = value; } };
}

test('task-scoped open uses stored provider, project, conversation and known process metadata', async () => {
  const world = taskWorld();
  assert.equal((await world.service.open(4)).state, 'opened');
  assert.equal(world.calls[0].id, 'session-a');
  assert.equal(world.calls[0].provider, 'codex');
  assert.equal(world.calls[0].cwd, '/synthetic/project');
  assert.equal(world.calls[0].pid, 400);
  assert.equal((await world.service.open(4, 'foreign-session')).state, 'unavailable');
  assert.equal(world.calls.length, 1);
});

test('headless OpenCode and Windows Claude keep the activity fallback without creating sessions', async () => {
  for (const platform of ['darwin', 'win32']) {
    const world = taskWorld({ platform, provider: 'opencode' });
    assert.equal((await world.service.open(4)).state, 'unavailable');
    assert.equal(world.calls.length, 0);
  }
  const windows = taskWorld({ platform: 'win32', provider: 'claude' });
  assert.equal((await windows.service.open(4)).state, 'unavailable');
  const mac = taskWorld({ provider: 'claude' });
  mac.setClaudeMode('headless');
  assert.equal((await mac.service.open(4)).state, 'unavailable');
  assert.equal(mac.calls.length, 0);
});

test('absent, closed, mismatched and unsupported terminals all leave conversation available', async () => {
  const world = taskWorld();
  world.owned.clear();
  assert.equal((await world.service.open(4)).state, 'unavailable');
  world.owned.set('session-a', { provider: 'claude', path: '/synthetic/project' });
  assert.equal((await world.service.open(4)).state, 'unavailable');
  world.owned.set('session-a', { provider: 'codex', path: '/another/project' });
  assert.equal((await world.service.open(4)).state, 'unavailable');
  world.setTask(null);
  assert.equal((await world.service.open(4)).state, 'unavailable');
  assert.equal((await taskWorld({ platform: 'linux' }).service.open(4)).state, 'unavailable');
  assert.equal(world.calls.length, 0);
});

test('council and Turbo candidates are exact and multiple terminals require an explicit choice', async () => {
  const world = taskWorld({ mode: 'plan', provider: 'council' });
  world.setTask({ ...world.task(), author_thread_id: 'claude-a' });
  world.owned.set('session-a', { provider: 'codex', path: '/synthetic/project', launchId: 'codex-launch' });
  world.owned.set('claude-a', { provider: 'claude', path: '/synthetic/project', launchId: 'claude-launch' });
  const result = await world.service.open(4);
  assert.equal(result.state, 'choose');
  assert.deepEqual(result.targets.map((target) => target.id), ['session-a', 'claude-a']);
  assert.equal(world.calls.length, 0);
  assert.equal((await world.service.open(4, 'claude-a')).state, 'opened');
  assert.equal(world.calls[0].provider, 'claude');
  const turbo = taskTerminalCandidates({ ...world.task(), provider: 'codex', mode: 'turbo',
    turbo: { plannerThreadId: 'session-a', workers: [{ threadId: 'worker-a' }, { threadId: 'worker-a' }] } });
  assert.deepEqual(turbo.map((item) => item.id), ['session-a', 'worker-a']);
});

test('late task reassignment, cancellation of the request, and launch replacement fail closed', async () => {
  for (const mutation of ['task', 'launch', 'request']) {
    const world = taskWorld();
    let requested = true;
    world.launcher.openOriginalTerminal = async (thread, { isCurrent }) => {
      assert.equal(isCurrent(), true);
      if (mutation === 'task') world.setTask({ ...world.task(), thread_id: 'session-b' });
      if (mutation === 'launch') world.owned.get('session-a').launchId = 'replacement';
      if (mutation === 'request') requested = false;
      assert.equal(isCurrent(), false);
      throw new Error('changed');
    };
    assert.equal((await world.service.open(4, null, { isRequested: () => requested })).state, 'unavailable');
  }
});

test('launcher re-verifies native identity and refuses stale task or runtime identity', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-original-terminal-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const thread = { id: 'test-session', provider: 'codex', cwd: directory };
  let resolved = { threadId: thread.id, terminalWindowId: 912, terminalTty: '/dev/ttys041' };
  let calls = 0;
  const launcher = new ProjectLauncher({ platform: 'darwin', run: async () => { calls += 1; },
    runtimeResolver: { resolve: async () => [resolved] } });
  launcher.trackOwnedTerminal({ launchId: 'test-launch', provider: 'codex', path: validateProjectPath(directory).path,
    terminalWindowId: 912, terminalTty: '/dev/ttys041' });
  launcher.bindOwnedTerminal('test-launch', thread);
  assert.equal((await launcher.openOriginalTerminal(thread)).state, 'opened');
  await assert.rejects(launcher.openOriginalTerminal(thread, { isCurrent: () => false }), /no longer owned/);
  resolved = { ...resolved, terminalWindowId: 913 };
  await assert.rejects(launcher.openOriginalTerminal(thread), /could not be verified/);
  resolved = { ...resolved, terminalWindowId: 912, terminalTty: '/dev/ttys042' };
  await assert.rejects(launcher.openOriginalTerminal(thread), /could not be verified/);
  assert.equal(calls, 1);
});

test('Windows launch captures birth identity and creates a dedicated native console', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-original-windows-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls = [];
  const launcher = new ProjectLauncher({ platform: 'win32', run: async (...args) => {
    calls.push(args);
    return { stdout: calls.length === 1 ? `4101|${birth}` : 'opened' };
  } });
  const launch = await launcher.launch(directory, 'codex');
  assert.match(calls[0][1].at(-1), /-FilePath 'conhost.exe'/);
  assert.match(calls[0][1].at(-1), /StartTime.ToUniversalTime\(\).ToFileTimeUtc\(\)/);
  const thread = { id: 'windows-session', provider: 'codex', cwd: directory };
  launcher.bindOwnedTerminal(launch.launchId, thread);
  assert.equal((await launcher.openOriginalTerminal(thread)).state, 'opened');
});
