import assert from 'node:assert/strict';
import test from 'node:test';
import pty from 'node-pty';
import { EmbeddedTerminalHost, embeddedShellCommand } from '../src/embedded-terminal.mjs';
import { ProjectLauncher } from '../src/project-launcher.mjs';
import { TaskOriginalTerminal } from '../src/task-original-terminal.mjs';
import { ClaudeTerminalExecutor, claudeTerminalRelaunchCommand } from '../src/claude-terminal-executor.mjs';
import { ClaudeExecutionRunner } from '../src/claude-execution-runner.mjs';

const quote = (text) => `'${text.replaceAll("'", `'\\''`)}'`;
const until = async (condition) => {
  for (let i = 0; i < 100; i += 1) {
    if (await condition()) return;
    await new Promise((done) => setTimeout(done, 20));
  }
  throw new Error('Terminal did not reach its expected state.');
};

test('real PTY preserves terminal rendering, direct input, resize, reconnect, and exact process cleanup', { skip: process.platform === 'win32' }, async (t) => {
  const host = new EmbeddedTerminalHost({
    // Avoid a developer's personal login startup files in this OS integration test.
    spawn: (_file, args, options) => pty.spawn('/bin/sh', ['-c', args[2]], options),
  });
  t.after(() => host.shutdown());
  const source = `process.stdin.setRawMode(true); process.stdout.write('\\x1b[2J\\x1b[H\\x1b[31mORIGINAL\\x1b[0m');
    process.stdin.on('data', d => { if(d.toString() === 'q') process.exit(); process.stdout.write('\\r\\nKEY:'+d.toString('hex')); });
    process.stdout.on('resize', () => process.stdout.write('\\r\\nSIZE:'+process.stdout.columns+'x'+process.stdout.rows));`;
  const handle = host.launch({ launchId: 'qa-launch', provider: 'codex', path: process.cwd(),
    command: `exec ${quote(process.execPath)} -e ${quote(source)}` });
  await until(async () => (await host.readScreen('qa-launch')).text.includes('ORIGINAL'));
  const events = [];
  const detach = await host.attach('qa-launch', (event) => events.push(event));
  assert.equal(events[0].type, 'snapshot');
  assert.match(events[0].data, /\x1b\[31m/);
  host.write('qa-launch', '\x1b[A');
  await until(() => events.some((event) => event.data?.includes('KEY:1b5b41')));
  host.resize('qa-launch', 93, 27);
  await until(async () => (await host.readScreen('qa-launch')).text.includes('SIZE:93x27'));
  assert.equal(await host.ownsProcess('qa-launch', handle.processId), true);
  assert.equal(await host.ownsProcess('qa-launch', process.pid), false);
  assert.throws(() => host.resize('qa-launch', 0, 10), /dimensions/);
  detach();
  host.write('qa-launch', 'z');
  await until(async () => (await host.readScreen('qa-launch')).text.includes('KEY:7a'));
  const reconnected = [];
  await host.attach('qa-launch', (event) => reconnected.push(event));
  assert.match(reconnected[0].data, /KEY:7a/);
  assert.equal(reconnected[0].cols, 93);
  await host.close('qa-launch');
  assert.throws(() => process.kill(handle.processId, 0), { code: 'ESRCH' });
  assert.throws(() => host.write('qa-launch', 'x'), /closed/);
  assert.equal(host.sessions.size, 0);
});

test('embedded launch keeps the Codex reservation without native window commands on macOS and Windows', async () => {
  for (const platform of ['darwin', 'win32']) {
    const calls = [];
    const host = { launch: (options) => { calls.push(options); return { processId: 4242, tty: '/dev/ttys999' }; },
      close: async () => {}, shutdown: async () => {}, isAlive: () => true };
    let cancelled = 0;
    const launcher = new ProjectLauncher({ platform, embeddedTerminalHost: host,
      run: () => assert.fail('Embedded launches must never open an OS window.'),
      createId: () => 'launch-qa', reserveCodexLaunch: () => ({ endpoint: 'ws://127.0.0.1:4999', cancel: () => cancelled++ }) });
    const launch = await launcher.launch(process.cwd(), 'codex', { rows: 2, columns: 2 }, { taskId: 7 });
    assert.equal(launch.transport, 'pty');
    assert.match(calls[0].command, /--remote ws:\/\/127.0.0.1:4999/);
    launcher.bindOwnedTerminal(launch.launchId, { id: 'session-qa', provider: 'codex', cwd: process.cwd() });
    assert.equal(cancelled, 1);
    assert.equal(launcher.terminalForThread('session-qa').transport, 'pty');
    assert.equal(await launcher.verifyTerminalForThread({ id: 'session-qa' }), true);
    await launcher.closeOwnedTerminal('session-qa');
    await launcher.closeOwnedTerminals();
  }
});

test('only the launching task can interact with its pre-conversation CLI, and binding retires the temporary target', async () => {
  const host = { launch: () => ({ processId: 4242 }), isAlive: () => true, close: async () => {}, shutdown: async () => {} };
  const launcher = new ProjectLauncher({ embeddedTerminalHost: host, createId: () => 'pending-qa',
    run: () => assert.fail('No external terminal.') });
  const task = { id: 7, mode: 'execute', provider: 'codex', status: 'running', repo_path: process.cwd(), thread_id: null };
  const service = new TaskOriginalTerminal({ database: { getTask: (id) => id === task.id ? task : { ...task, id } },
    launcher, knownThread: () => null });
  await launcher.launch(task.repo_path, task.provider, null, { taskId: task.id });
  const starting = await service.read(task.id);
  assert.equal(starting.state, 'interactive');
  assert.equal(starting.threadId, 'launch:pending-qa');
  assert.ok(service.connection(7, starting.threadId, starting.launchId));
  assert.equal(service.connection(8, starting.threadId, starting.launchId), null);
  launcher.bindOwnedTerminal(starting.launchId, { id: 'connected-qa', provider: 'codex', cwd: task.repo_path });
  task.thread_id = 'connected-qa';
  assert.equal(service.connection(7, starting.threadId, starting.launchId), null);
  assert.equal((await service.read(7)).threadId, task.thread_id);
  await launcher.closeOwnedTerminals();
});

test('Claude routes prompt, submit, keys, and cancel into the same PTY on Windows without native injection', async () => {
  const writes = [];
  const host = { input: (id, data) => writes.push({ id, data }), readScreen: async () => ({ ok: true, text: 'CLI composer' }) };
  const forbidden = () => assert.fail('A PTY must not invoke Terminal.app.');
  const executor = new ClaudeTerminalExecutor({ embeddedTerminalHost: host, inject: forbidden,
    submit: forbidden, relaunch: forbidden, sendCancel: forbidden, readScreen: forbidden, sendKeys: forbidden });
  const target = { transport: 'pty', terminalId: 'pty:claude-qa', runtimeProcessId: 4242 };
  const runner = new ClaudeExecutionRunner({ platform: 'win32', resolveTerminal: async () => target, terminalExecutor: executor });
  assert.equal(await runner.resolveTerminalTarget({}, {}), target);
  await executor.inject(target.terminalId, 'line one\nline two');
  await executor.submit(target.terminalId);
  await executor.sendCancel(target.terminalId);
  assert.deepEqual(writes, [
    { id: target.terminalId, data: '\x1b[200~line one\nline two\x1b[201~\r' },
    { id: target.terminalId, data: ' \r' }, { id: target.terminalId, data: '\x1b' },
  ]);
  assert.equal((await executor.readScreen(target.terminalId)).text, 'CLI composer');
  const command = claudeTerminalRelaunchCommand({ platform: 'win32', command: 'C:\\Program Files\\Claude\\claude.cmd', sessionId: 'qa-session' });
  assert.match(command, /^"C:\\Program Files\\Claude\\claude.cmd" /);
  assert.doesNotMatch(command, /'/);
});

test('task terminal metadata and socket authorization require its exact current embedded launch', async () => {
  let task = { id: 7, provider: 'claude', mode: 'execute', repo_path: '/synthetic/project', thread_id: 'session-qa' };
  let owned = { provider: 'claude', path: task.repo_path, launchId: 'launch-qa', transport: 'pty' };
  const launcher = { terminalForThread: () => owned, embeddedTerminalHost: { isAlive: () => true } };
  const terminals = new TaskOriginalTerminal({ platform: 'win32', database: { getTask: () => task }, launcher, knownThread: () => null });
  assert.equal((await terminals.read(7)).state, 'interactive');
  assert.ok(terminals.connection(7, 'session-qa', 'launch-qa'));
  assert.equal(terminals.connection(7, 'foreign', 'launch-qa'), null);
  assert.equal(terminals.connection(7, 'session-qa', 'old-launch'), null);
  owned = { ...owned, path: '/synthetic/other' };
  assert.equal(terminals.connection(7, 'session-qa', 'launch-qa'), null);
  task = null;
  assert.equal(terminals.connection(7, 'session-qa', 'launch-qa'), null);
});

test('Windows launches use the existing command quoting inside ConPTY cmd.exe, never conhost or a new window', () => {
  const command = '"C:\\Program Files\\Claude\\claude.cmd" --resume "session-qa"';
  const shell = embeddedShellCommand(command, 'win32');
  assert.equal(shell.args, `/d /s /k "${command}"`);
  assert.doesNotMatch(shell.file, /conhost|powershell/);
});
