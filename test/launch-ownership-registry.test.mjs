import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { RelayDatabase } from '../src/database.mjs';
import {
  LAUNCH_BINDING_CLAIM_MS,
  LAUNCH_OWNER_STALE_MS,
  LaunchOwnershipRegistry,
  readProcessStartToken,
  START_TOKEN_ENVIRONMENT,
} from '../src/launch-ownership-registry.mjs';
import { ProjectLauncher, validateProjectPath } from '../src/project-launcher.mjs';

const FOREIGN_PID = 424_242;
const FOREIGN_TOKEN = 'Mon Aug  3 08:00:00 2026';
const SELF_TOKEN = 'Mon Aug  3 09:30:00 2026';

function workspace(t, prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, path: validateProjectPath(directory).path };
}

function sharedDatabase(t) {
  const directory = mkdtempSync(join(tmpdir(), 'relay-launch-registry-db-'));
  const database = new DatabaseSync(join(directory, 'relay-config.sqlite'));
  t.after(() => {
    try { database.close(); } catch { /* already closed by the test */ }
    rmSync(directory, { recursive: true, force: true });
  });
  return database;
}

function clock(start = 1_000_000) {
  const state = { value: start };
  return Object.assign(() => state.value, {
    advance(ms) { state.value += ms; },
  });
}

// Liveness is faked everywhere. No test may inspect a real CC Relay process.
function registryFor(database, {
  instanceId,
  pid,
  now = clock(),
  alive = new Set([FOREIGN_PID]),
  tokens = { [FOREIGN_PID]: FOREIGN_TOKEN },
  diagnostic = () => {},
} = {}) {
  return new LaunchOwnershipRegistry({
    database,
    instanceId,
    pid,
    now,
    diagnostic,
    processAlive: (target) => alive.has(target),
    readStartToken: async (target) => tokens[target] ?? null,
    heartbeatMs: 0,
  });
}

function launcherWith(registry, {
  nativeTerminal,
  diagnostics = [],
  run = async () => ({ stdout: '' }),
} = {}) {
  return new ProjectLauncher({
    platform: 'darwin',
    createId: () => 'adopted-one',
    diagnostic: (event, details) => diagnostics.push({ event, details }),
    launchRegistry: registry,
    runtimeResolver: { resolve: async () => (nativeTerminal ? [nativeTerminal] : []) },
    run,
  });
}

function foreignClaim(registry, thread, native, path) {
  registry.recordLaunch({
    launchId: 'desktop-launch-90',
    provider: thread.provider,
    path,
    threadId: thread.id,
    terminalWindowId: native.terminalWindowId,
    terminalTty: native.terminalTty,
    ownershipSource: 'launch',
  });
}

test('a live foreign backend keeps its launch and runtime recovery skips it', async (t) => {
  const database = sharedDatabase(t);
  const { directory, path } = workspace(t, 'relay-foreign-live-');
  const now = clock();
  const desktop = registryFor(database, { instanceId: 'desktop', pid: FOREIGN_PID, now });
  await desktop.start();

  const thread = { id: 'eda117ec-claude', provider: 'claude', cwd: directory, pid: 901 };
  const native = {
    threadId: thread.id,
    provider: 'claude',
    terminalWindowId: 710,
    terminalTty: '/dev/ttys018',
    runtimeProcessId: 901,
  };
  foreignClaim(desktop, thread, native, path);

  const localhost = registryFor(database, {
    instanceId: 'localhost',
    pid: process.pid,
    now,
    alive: new Set([FOREIGN_PID, process.pid]),
    tokens: { [FOREIGN_PID]: FOREIGN_TOKEN, [process.pid]: SELF_TOKEN },
  });
  await localhost.start();

  const diagnostics = [];
  const calls = [];
  const launcher = launcherWith(localhost, {
    nativeTerminal: native,
    diagnostics,
    run: async (command, args) => { calls.push([command, args]); return { stdout: '' }; },
  });

  assert.deepEqual(await launcher.recoverConnectedTerminals([thread]), []);
  assert.equal(launcher.terminalForThread(thread.id), null);
  const skipped = diagnostics.find(
    ({ event }) => event === 'terminal.recovery.skipped_foreign_owner',
  );
  assert.ok(skipped, 'the skip must be recorded in diagnostics');
  assert.equal(skipped.details.foreignPid, FOREIGN_PID);
  assert.equal(skipped.details.foreignLaunchId, 'desktop-launch-90');
  assert.equal(skipped.details.match, 'conversation');
  assert.equal(
    diagnostics.some(({ event }) => event === 'terminal.recovery.completed'),
    false,
  );
  assert.equal(calls.length, 0, 'no native command may run for a foreign launch');
  // The foreign claim survives untouched.
  assert.equal(
    database.prepare(
      `SELECT COUNT(*) AS value FROM terminal_launch_owners WHERE instance_id = 'desktop'`,
    ).get().value,
    1,
  );
});

test('a dead foreign owner releases its launches back to runtime recovery', async (t) => {
  const database = sharedDatabase(t);
  const { directory } = workspace(t, 'relay-foreign-dead-');
  const now = clock();
  const desktop = registryFor(database, { instanceId: 'desktop', pid: FOREIGN_PID, now });
  await desktop.start();

  const thread = { id: 'dead-owner-claude', provider: 'claude', cwd: directory, pid: 901 };
  const native = {
    threadId: thread.id,
    provider: 'claude',
    terminalWindowId: 711,
    terminalTty: '/dev/ttys019',
    runtimeProcessId: 901,
  };
  foreignClaim(desktop, thread, native, validateProjectPath(directory).path);

  // The desktop backend has exited: its identifier is no longer taken.
  const localhost = registryFor(database, {
    instanceId: 'localhost',
    pid: process.pid,
    now,
    alive: new Set([process.pid]),
    tokens: { [process.pid]: SELF_TOKEN },
  });
  await localhost.start();

  const diagnostics = [];
  const launcher = launcherWith(localhost, { nativeTerminal: native, diagnostics });
  const recovered = await launcher.recoverConnectedTerminals([thread]);
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].threadId, thread.id);
  assert.equal(
    diagnostics.some(({ event }) => event === 'terminal.recovery.completed'),
    true,
  );
  assert.equal(
    database.prepare(
      `SELECT COUNT(*) AS value FROM terminal_launch_owners WHERE instance_id = 'desktop'`,
    ).get().value,
    0,
    'a dead backend must not keep claims',
  );
});

test('a stale heartbeat with a dead process identifier does not block adoption', async (t) => {
  const database = sharedDatabase(t);
  const { directory, path } = workspace(t, 'relay-stale-heartbeat-');
  const now = clock();
  const desktop = registryFor(database, { instanceId: 'desktop', pid: FOREIGN_PID, now });
  await desktop.start();
  const thread = { id: 'stale-claude', provider: 'claude', cwd: directory, pid: 901 };
  const native = {
    threadId: thread.id,
    provider: 'claude',
    terminalWindowId: 712,
    terminalTty: '/dev/ttys020',
    runtimeProcessId: 901,
  };
  foreignClaim(desktop, thread, native, path);

  now.advance(10 * 60 * 1000);
  const localhost = registryFor(database, {
    instanceId: 'localhost',
    pid: process.pid,
    now,
    alive: new Set([process.pid]),
    tokens: { [process.pid]: SELF_TOKEN },
  });
  // No start(): the pruning pass is deliberately skipped so the guard itself is on trial.
  const launcher = launcherWith(localhost, { nativeTerminal: native });
  assert.equal((await launcher.recoverConnectedTerminals([thread])).length, 1);
});

test('a reused process identifier with a different start token is treated as dead', async (t) => {
  const database = sharedDatabase(t);
  const { directory, path } = workspace(t, 'relay-token-mismatch-');
  const now = clock();
  const desktop = registryFor(database, { instanceId: 'desktop', pid: FOREIGN_PID, now });
  await desktop.start();
  const thread = { id: 'recycled-claude', provider: 'claude', cwd: directory, pid: 901 };
  const native = {
    threadId: thread.id,
    provider: 'claude',
    terminalWindowId: 713,
    terminalTty: '/dev/ttys021',
    runtimeProcessId: 901,
  };
  foreignClaim(desktop, thread, native, path);

  // The identifier is taken again, by an unrelated process started later.
  const localhost = registryFor(database, {
    instanceId: 'localhost',
    pid: process.pid,
    now,
    alive: new Set([FOREIGN_PID, process.pid]),
    tokens: { [FOREIGN_PID]: 'Mon Aug  3 11:11:11 2026', [process.pid]: SELF_TOKEN },
  });
  const launcher = launcherWith(localhost, { nativeTerminal: native });
  assert.equal((await launcher.recoverConnectedTerminals([thread])).length, 1);
  assert.equal(
    await localhost.foreignOwner({ threadId: thread.id, provider: 'claude', path }),
    null,
  );
});

test('a foreign launch that has not bound yet still blocks adoption in the same project', async (t) => {
  const database = sharedDatabase(t);
  const { directory, path } = workspace(t, 'relay-foreign-pending-');
  const now = clock();
  const desktop = registryFor(database, { instanceId: 'desktop', pid: FOREIGN_PID, now });
  await desktop.start();
  desktop.recordLaunch({
    launchId: 'desktop-binding',
    provider: 'claude',
    path,
    threadId: null,
    expectedThreadId: 'expected-uuid',
    terminalWindowId: 800,
  });

  const localhost = registryFor(database, {
    instanceId: 'localhost',
    pid: process.pid,
    now,
    alive: new Set([FOREIGN_PID, process.pid]),
    tokens: { [FOREIGN_PID]: FOREIGN_TOKEN, [process.pid]: SELF_TOKEN },
  });
  const diagnostics = [];
  const thread = { id: 'other-uuid', provider: 'claude', cwd: directory, pid: 902 };
  const launcher = launcherWith(localhost, {
    diagnostics,
    nativeTerminal: {
      threadId: thread.id,
      provider: 'claude',
      terminalWindowId: 801,
      terminalTty: '/dev/ttys022',
      runtimeProcessId: 902,
    },
  });
  assert.deepEqual(await launcher.recoverConnectedTerminals([thread]), []);
  const skipped = diagnostics.find(
    ({ event }) => event === 'terminal.recovery.skipped_foreign_owner',
  );
  assert.equal(skipped.details.match, 'pending-launch');
  assert.equal(skipped.details.foreignPid, FOREIGN_PID);
});

test('a foreign launch that never binds stops blocking its project after the binding window', async (t) => {
  const database = sharedDatabase(t);
  const { path } = workspace(t, 'relay-stuck-pending-');
  const now = clock();
  const desktop = registryFor(database, { instanceId: 'desktop', pid: FOREIGN_PID, now });
  await desktop.start();
  // A launch whose native close failed keeps its unbound claim while its backend keeps running.
  desktop.recordLaunch({
    launchId: 'desktop-stuck',
    provider: 'claude',
    path,
    threadId: null,
    terminalWindowId: 810,
  });

  const localhost = registryFor(database, {
    instanceId: 'localhost',
    pid: process.pid,
    now,
    alive: new Set([FOREIGN_PID, process.pid]),
    tokens: { [FOREIGN_PID]: FOREIGN_TOKEN, [process.pid]: SELF_TOKEN },
  });
  const query = { threadId: 'unrelated-session', provider: 'claude', path };
  assert.equal((await localhost.foreignOwner(query))?.reason, 'pending-launch');

  now.advance(LAUNCH_BINDING_CLAIM_MS + 1);
  assert.equal(
    await localhost.foreignOwner(query),
    null,
    'a stuck unbound claim must not lock a project forever',
  );
  // The exact native identity of that same row still applies for as long as it exists.
  assert.equal(
    (await localhost.foreignOwner({ ...query, terminalWindowId: 810 }))?.launchId,
    'desktop-stuck',
  );
});

test('a backend with no start token stays live only while it heartbeats', async (t) => {
  const database = sharedDatabase(t);
  const { path } = workspace(t, 'relay-heartbeat-liveness-');
  const now = clock();
  // No start token: Windows, or a platform where ps cannot be read. The heartbeat is then the
  // only evidence of liveness.
  const desktop = registryFor(database, {
    instanceId: 'desktop',
    pid: FOREIGN_PID,
    now,
    tokens: {},
  });
  await desktop.start();
  assert.equal(
    database.prepare(`SELECT start_token FROM relay_backends WHERE instance_id = 'desktop'`)
      .get().start_token,
    null,
  );
  desktop.recordLaunch({
    launchId: 'desktop-untokened',
    provider: 'claude',
    path,
    threadId: 'untokened-session',
    terminalWindowId: 820,
  });

  const localhost = registryFor(database, {
    instanceId: 'localhost',
    pid: process.pid,
    now,
    alive: new Set([FOREIGN_PID, process.pid]),
    tokens: {},
  });
  const query = { threadId: 'untokened-session', provider: 'claude', path };
  assert.equal((await localhost.foreignOwner(query))?.pid, FOREIGN_PID);

  now.advance(LAUNCH_OWNER_STALE_MS + 1);
  assert.equal(
    await localhost.foreignOwner(query),
    null,
    'a live identifier with no token and no heartbeat is not evidence of ownership',
  );

  assert.equal(desktop.heartbeat(), true);
  assert.equal(
    (await localhost.foreignOwner(query))?.launchId,
    'desktop-untokened',
    'a refreshed heartbeat restores the claim',
  );
});

test('a registry read failure degrades runtime recovery to single-process behavior', async (t) => {
  const { directory } = workspace(t, 'relay-registry-failure-');
  const diagnostics = [];
  const thread = { id: 'degraded-claude', provider: 'claude', cwd: directory, pid: 903 };
  const launcher = launcherWith({
    recordLaunch: () => { throw new Error('database is locked'); },
    updateLaunch: () => { throw new Error('database is locked'); },
    removeLaunch: () => { throw new Error('database is locked'); },
    foreignOwner: async () => { throw new Error('no such table: terminal_launch_owners'); },
  }, {
    diagnostics,
    nativeTerminal: {
      threadId: thread.id,
      provider: 'claude',
      terminalWindowId: 714,
      terminalTty: '/dev/ttys023',
      runtimeProcessId: 903,
    },
  });
  assert.equal((await launcher.recoverConnectedTerminals([thread])).length, 1);
  assert.equal(
    diagnostics.filter(({ event }) => event === 'terminal.ownership.registry_failed').length >= 2,
    true,
    'each failed registry call is reported without breaking recovery',
  );
});

test('a closed shared database degrades every registry call instead of throwing', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-registry-closed-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = new DatabaseSync(join(directory, 'relay-config.sqlite'));
  const failures = [];
  const registry = registryFor(database, {
    instanceId: 'localhost',
    pid: process.pid,
    diagnostic: (event, details) => failures.push({ event, details }),
  });
  database.close();

  assert.equal(registry.recordLaunch({ launchId: 'a', provider: 'claude', path: '/tmp' }), false);
  assert.equal(registry.updateLaunch('a', { threadId: 'x' }), false);
  assert.equal(registry.removeLaunch('a'), false);
  assert.equal(registry.clearOwnLaunches(), false);
  assert.equal(registry.dualBackendDetected(), false);
  assert.equal(await registry.foreignOwner({ threadId: 'x', provider: 'claude', path: '/tmp' }), null);
  assert.equal(await registry.start(), false);
  assert.equal(failures.every(({ event }) => event === 'launch.registry.failed'), true);
});

test('a foreign claim recorded after adoption stops the native close', async (t) => {
  const database = sharedDatabase(t);
  const { directory, path } = workspace(t, 'relay-close-guard-');
  const now = clock();
  const localhost = registryFor(database, {
    instanceId: 'localhost',
    pid: process.pid,
    now,
    alive: new Set([FOREIGN_PID, process.pid]),
    tokens: { [FOREIGN_PID]: FOREIGN_TOKEN, [process.pid]: SELF_TOKEN },
  });
  await localhost.start();

  const thread = { id: 'contested-claude', provider: 'claude', cwd: directory, pid: 904 };
  const native = {
    threadId: thread.id,
    provider: 'claude',
    terminalWindowId: 715,
    terminalTty: '/dev/ttys024',
    runtimeProcessId: 904,
  };
  const diagnostics = [];
  const calls = [];
  const launcher = launcherWith(localhost, {
    nativeTerminal: native,
    diagnostics,
    run: async (command, args) => { calls.push([command, args]); return { stdout: '' }; },
  });
  assert.equal((await launcher.recoverConnectedTerminals([thread])).length, 1);

  const desktop = registryFor(database, { instanceId: 'desktop', pid: FOREIGN_PID, now });
  await desktop.start();
  foreignClaim(desktop, thread, native, path);

  await assert.rejects(
    () => launcher.closeOwnedTerminal(thread.id),
    /another running CC Relay backend \(process 424242\)/,
  );
  assert.equal(calls.length, 0, 'no kill, no osascript, no taskkill');
  assert.equal(launcher.terminalForThread(thread.id), null, 'the adoption is released');
  const skipped = diagnostics.find(({ event }) => event === 'terminal.close.skipped_foreign_owner');
  assert.equal(skipped.details.foreignPid, FOREIGN_PID);
  assert.equal(
    diagnostics.some(({ event }) => event === 'terminal.close.requested'),
    false,
  );
});

test('identity verification drops an adoption a live foreign backend has claimed', async (t) => {
  const database = sharedDatabase(t);
  const { directory, path } = workspace(t, 'relay-verify-guard-');
  const now = clock();
  const localhost = registryFor(database, {
    instanceId: 'localhost',
    pid: process.pid,
    now,
    alive: new Set([FOREIGN_PID, process.pid]),
    tokens: { [FOREIGN_PID]: FOREIGN_TOKEN, [process.pid]: SELF_TOKEN },
  });
  await localhost.start();
  const thread = { id: 'verify-claude', provider: 'claude', cwd: directory, pid: 905 };
  const native = {
    threadId: thread.id,
    provider: 'claude',
    terminalWindowId: 716,
    terminalTty: '/dev/ttys025',
    runtimeProcessId: 905,
  };
  const diagnostics = [];
  const launcher = launcherWith(localhost, { nativeTerminal: native, diagnostics });
  assert.equal((await launcher.recoverConnectedTerminals([thread])).length, 1);
  assert.equal(await launcher.verifyTerminalForThread(thread), true);

  const desktop = registryFor(database, { instanceId: 'desktop', pid: FOREIGN_PID, now });
  await desktop.start();
  foreignClaim(desktop, thread, native, path);

  assert.equal(await launcher.verifyTerminalForThread(thread), false);
  assert.equal(launcher.terminalForThread(thread.id), null);
  assert.equal(
    diagnostics.filter(({ event, details }) => (
      event === 'terminal.recovery.skipped_foreign_owner' && details.stage === 'verify'
    )).length,
    1,
  );
});

test('a natively launched terminal keeps its own claim and never blocks itself', async (t) => {
  const database = sharedDatabase(t);
  const { directory, path } = workspace(t, 'relay-self-claim-');
  const now = clock();
  const localhost = registryFor(database, {
    instanceId: 'localhost',
    pid: process.pid,
    now,
    alive: new Set([process.pid]),
    tokens: { [process.pid]: SELF_TOKEN },
  });
  await localhost.start();
  const launcher = launcherWith(localhost, {});

  launcher.trackOwnedTerminal({
    launchId: 'own-launch',
    provider: 'claude',
    path,
    terminalWindowId: 900,
    expectedThreadId: 'expected-own',
  });
  const stored = database.prepare(
    `SELECT * FROM terminal_launch_owners WHERE launch_id = 'own-launch'`,
  ).get();
  assert.equal(stored.instance_id, 'localhost');
  assert.equal(stored.owner_pid, process.pid);
  assert.equal(stored.thread_id, null);
  assert.equal(stored.expected_thread_id, 'expected-own');

  launcher.bindOwnedTerminal('own-launch', {
    id: 'own-session',
    provider: 'claude',
    cwd: directory,
  });
  assert.equal(
    database.prepare(`SELECT thread_id FROM terminal_launch_owners WHERE launch_id = 'own-launch'`)
      .get().thread_id,
    'own-session',
  );
  assert.equal(
    await localhost.foreignOwner({ threadId: 'own-session', provider: 'claude', path }),
    null,
    'a backend never treats its own claim as foreign',
  );

  launcher.forgetTrackedTerminal('own-launch');
  assert.equal(
    database.prepare(`SELECT COUNT(*) AS value FROM terminal_launch_owners`).get().value,
    0,
  );
});

test('simultaneous adoption yields to the claim that was written first', async (t) => {
  const database = sharedDatabase(t);
  const { path } = workspace(t, 'relay-adoption-race-');
  const now = clock();
  const desktop = registryFor(database, { instanceId: 'desktop', pid: FOREIGN_PID, now });
  await desktop.start();
  const localhost = registryFor(database, {
    instanceId: 'localhost',
    pid: process.pid,
    now,
    alive: new Set([FOREIGN_PID, process.pid]),
    tokens: { [FOREIGN_PID]: FOREIGN_TOKEN, [process.pid]: SELF_TOKEN },
  });
  await localhost.start();

  const query = {
    threadId: 'raced-session',
    provider: 'claude',
    path,
    terminalWindowId: 950,
    terminalTty: '/dev/ttys026',
  };
  desktop.recordLaunch({ launchId: 'desktop-race', ...query, ownershipSource: 'runtime' });
  now.advance(5);
  localhost.recordLaunch({ launchId: 'localhost-race', ...query, ownershipSource: 'runtime' });

  const contender = await localhost.foreignOwner(query, { precedingLaunchId: 'localhost-race' });
  assert.equal(contender.launchId, 'desktop-race');
  assert.equal(
    await desktop.foreignOwner(query, { precedingLaunchId: 'desktop-race' }),
    null,
    'the earlier claim keeps the launch',
  );
});

test('dual backend detection reports only a live foreign backend', async (t) => {
  const database = sharedDatabase(t);
  const now = clock();
  const localhost = registryFor(database, {
    instanceId: 'localhost',
    pid: process.pid,
    now,
    alive: new Set([process.pid]),
    tokens: { [process.pid]: SELF_TOKEN },
  });
  await localhost.start();
  assert.equal(localhost.dualBackendDetected(), false);

  const desktop = registryFor(database, { instanceId: 'desktop', pid: FOREIGN_PID, now });
  await desktop.start();
  now.advance(5_000);
  assert.equal(localhost.dualBackendDetected(), false, 'the cached answer stays cheap');
  now.advance(5_000);
  localhost.dualBackendCache = null;
  assert.equal(localhost.dualBackendDetected(), false, 'a foreign heartbeat needs a live process');

  const watcher = registryFor(database, {
    instanceId: 'localhost',
    pid: process.pid,
    now,
    alive: new Set([FOREIGN_PID, process.pid]),
    tokens: { [FOREIGN_PID]: FOREIGN_TOKEN, [process.pid]: SELF_TOKEN },
  });
  assert.equal(watcher.dualBackendDetected(), true);
});

test('the registry adds its tables to an older shared configuration database', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-registry-migration-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const configFile = join(directory, 'user-data', 'relay-config.sqlite');

  // An older backend created the shared configuration file and knows nothing about ownership.
  const older = new RelayDatabase(join(directory, 'localhost', 'relay.sqlite'), {
    projectConfigPath: configFile,
  });
  const project = older.addProject({ path: '/repo/one', name: 'one' });
  older.updateProjectInstanceLimits(project.id, { codex: 3, claude: 2 });
  older.close();

  const upgraded = new RelayDatabase(join(directory, 'desktop', 'relay.sqlite'), {
    projectConfigPath: configFile,
  });
  const registry = registryFor(upgraded.projectConfig.database, {
    instanceId: 'desktop',
    pid: process.pid,
    alive: new Set([process.pid]),
    tokens: { [process.pid]: SELF_TOKEN },
  });
  assert.equal(await registry.start(), true);
  registry.recordLaunch({
    launchId: 'desktop-launch',
    provider: 'codex',
    path: '/repo/one',
    threadId: 'codex-thread',
  });
  assert.deepEqual(
    upgraded.listProjects().map((row) => ({ path: row.path, codex: row.max_codex_instances })),
    [{ path: '/repo/one', codex: 3 }],
  );
  upgraded.close();

  // The older backend reopens the same shared file and is completely unaffected.
  const reopened = new RelayDatabase(join(directory, 'localhost', 'relay.sqlite'), {
    projectConfigPath: configFile,
  });
  assert.deepEqual(
    reopened.listProjects().map((row) => ({ path: row.path, claude: row.max_claude_instances })),
    [{ path: '/repo/one', claude: 2 }],
  );
  const second = reopened.addProject({ path: '/repo/two', name: 'two' });
  assert.equal(second.path, '/repo/two');
  assert.equal(
    reopened.projectConfig.database.prepare(
      `SELECT COUNT(*) AS value FROM terminal_launch_owners`,
    ).get().value,
    1,
    'the ownership claim survives an older backend opening the same file',
  );
  reopened.close();
});

test('start token reads never use a pgrep TTY filter and tolerate an unreadable process', async () => {
  const commands = [];
  const token = await readProcessStartToken(4242, {
    platform: 'darwin',
    run: async (command, args, options) => {
      commands.push([command, args, options]);
      return { stdout: '  Mon Aug  3   08:00:00 2026 \n' };
    },
  });
  assert.equal(token, 'Mon Aug 3 08:00:00 2026');
  assert.deepEqual(commands[0].slice(0, 2), ['ps', ['-p', '4242', '-o', 'lstart=']]);
  assert.equal(
    await readProcessStartToken(4242, {
      platform: 'darwin',
      run: async () => { throw Object.assign(new Error('no such process'), { code: 1 }); },
    }),
    null,
  );
  assert.equal(await readProcessStartToken(4242, { platform: 'win32' }), null);
  assert.equal(await readProcessStartToken(0, { platform: 'darwin' }), null);
});

// `ps -o lstart=` formats through LC_TIME and the time zone. Verified on Darwin 25.5.0: the same
// live process reads as "Mon Aug 3 12:10:10 2026" pinned, "Mo. 3 Aug. 14:10:10 2026" under
// de_DE, and "Mon Aug 3 14:10:10 2026" with no locale but the local zone. A Finder-launched
// desktop app and a shell-launched backend therefore disagree on both format and hour unless
// every read pins its environment. A mismatch means DEAD, which would disable the guard and let
// pruning delete a live owner's claims.
test('every start token read pins locale and time zone so both backends agree', async () => {
  const options = [];
  await readProcessStartToken(4242, {
    platform: 'darwin',
    environment: { PATH: '/usr/bin', LANG: 'de_DE.UTF-8', TZ: 'Europe/Vienna' },
    run: async (command, args, runOptions) => {
      options.push(runOptions);
      return { stdout: 'Mon Aug  3 08:00:00 2026\n' };
    },
  });
  assert.equal(options[0].env.LC_ALL, 'C');
  assert.equal(options[0].env.LANG, 'C');
  assert.equal(options[0].env.TZ, 'UTC');
  assert.equal(options[0].env.PATH, '/usr/bin', 'the rest of the environment is preserved');
  assert.equal(typeof options[0].timeout, 'number');

  // The registry's own reader must pin the same environment, not just the exported helper.
  const registryOptions = [];
  const registry = new LaunchOwnershipRegistry({
    database: null,
    run: async () => ({ stdout: '' }),
  });
  registry.readStartToken = (pid) => readProcessStartToken(pid, {
    platform: 'darwin',
    run: async (command, args, runOptions) => {
      registryOptions.push(runOptions);
      return { stdout: 'Mon Aug  3 08:00:00 2026\n' };
    },
  });
  assert.equal(await registry.startTokenFor(4242), 'Mon Aug 3 08:00:00 2026');
  assert.equal(registryOptions[0].env.LC_ALL, 'C');
  assert.equal(registryOptions[0].env.TZ, 'UTC');
  assert.equal(START_TOKEN_ENVIRONMENT.LC_ALL, 'C');
});

test('a foreign binding window never blocks verifying or closing an adopted terminal', async (t) => {
  const database = sharedDatabase(t);
  const { directory, path } = workspace(t, 'relay-pending-scope-');
  const now = clock();
  const localhost = registryFor(database, {
    instanceId: 'localhost',
    pid: process.pid,
    now,
    alive: new Set([FOREIGN_PID, process.pid]),
    tokens: { [FOREIGN_PID]: FOREIGN_TOKEN, [process.pid]: SELF_TOKEN },
  });
  await localhost.start();

  const thread = { id: 'adopted-session', provider: 'claude', cwd: directory, pid: 906 };
  const native = {
    threadId: thread.id,
    provider: 'claude',
    terminalWindowId: 830,
    terminalTty: '/dev/ttys027',
    runtimeProcessId: 906,
  };
  const processSnapshots = ['940\n', '', ''];
  const calls = [];
  const launcher = launcherWith(localhost, {
    nativeTerminal: native,
    run: async (command, args) => {
      calls.push([command, args]);
      if (command === 'ps' && args[0] === '-p') return { stdout: 'ttys027\n' };
      if (command === 'ps' && args[0] === '-t') return { stdout: processSnapshots.shift() ?? '' };
      if (command === 'osascript' && args[1].includes('return tty')) return { stdout: '/dev/ttys027\n' };
      return { stdout: '' };
    },
  });
  assert.equal((await launcher.recoverConnectedTerminals([thread])).length, 1);

  // The other backend is now launching its own terminal in the same project and has not bound
  // its conversation yet. That claim identifies no terminal, so it must not reach this one.
  const desktop = registryFor(database, { instanceId: 'desktop', pid: FOREIGN_PID, now });
  await desktop.start();
  desktop.recordLaunch({
    launchId: 'desktop-binding',
    provider: 'claude',
    path,
    threadId: null,
    terminalWindowId: 831,
  });

  assert.equal(
    (await localhost.foreignOwner({ threadId: 'unrelated', provider: 'claude', path }))?.launchId,
    'desktop-binding',
    'adoption still respects the foreign binding window',
  );
  assert.equal(await launcher.verifyTerminalForThread(thread), true);
  const closed = await launcher.closeOwnedTerminal(thread.id);
  assert.equal(closed.threadId, thread.id);
  assert.equal(calls.some(([command]) => command === 'kill'), true, 'the close really ran');
});
