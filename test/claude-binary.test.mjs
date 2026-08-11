import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import {
  ClaudeBinaryResolver,
  compareVersions,
  enumerateCandidates,
  isUnknownOptionError,
  parseClaudeVersion,
  pickBest,
  providerCommandInvocation,
  resolveExecutableOnPath,
  terminateChildProcess,
} from '../src/claude-binary.mjs';

// Reverses what cmd.exe does to one caret-escaped command line: strip the outer quote pair,
// consume one caret layer, then a second layer for the `%*` re-expansion an npm shim performs.
// Applying it to the generated line proves the child receives the original argument text.
function cmdParse(commandLine) {
  const inner = commandLine.replace(/^"/, '').replace(/"$/, '');
  const stripCarets = (value) => value.replace(/\^(.)/g, '$1');
  return stripCarets(stripCarets(inner));
}

// Reads the argument list a Windows child would see from a fully unescaped command line.
function windowsArgv(commandLine) {
  const argv = [];
  let current = '';
  let quoted = false;
  let started = false;
  for (let index = 0; index < commandLine.length; index += 1) {
    const character = commandLine[index];
    if (character === '\\' && commandLine[index + 1] === '"') {
      current += '"';
      started = true;
      index += 1;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      started = true;
      continue;
    }
    if (character === ' ' && !quoted) {
      if (started) argv.push(current);
      current = '';
      started = false;
      continue;
    }
    current += character;
    started = true;
  }
  if (started) argv.push(current);
  return argv;
}

function enoent() {
  return Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
}

test('candidate enumeration lists PATH entries first, then well-known locations, deduplicated', () => {
  const candidates = enumerateCandidates({
    env: { PATH: '/opt/homebrew/bin:/usr/bin:/opt/homebrew/bin' },
    platform: 'darwin',
    homedir: '/Users/tester',
  });
  assert.deepEqual(candidates, [
    '/opt/homebrew/bin/claude',
    '/usr/bin/claude',
    '/Users/tester/.local/bin/claude',
    '/usr/local/bin/claude',
  ]);
});

test('candidate enumeration expands the home directory for the well-known local bin', () => {
  const candidates = enumerateCandidates({ env: { PATH: '' }, platform: 'darwin', homedir: '/home/dev' });
  assert.ok(candidates.includes('/home/dev/.local/bin/claude'));
  assert.ok(candidates.includes('/opt/homebrew/bin/claude'));
});

test('candidate enumeration on Windows probes shim variants and omits POSIX locations', () => {
  const candidates = enumerateCandidates({ env: { Path: 'C:/tools' }, platform: 'win32', homedir: 'C:/Users/dev' });
  assert.ok(candidates.some((path) => path.endsWith('claude.cmd')));
  assert.ok(candidates.some((path) => path.endsWith('claude.exe')));
  assert.ok(!candidates.includes('/opt/homebrew/bin/claude'));
  assert.ok(!candidates.includes('/usr/bin/claude'));
});

test('version parsing and comparison are numeric, not lexical', () => {
  assert.deepEqual(parseClaudeVersion('2.1.218 (Claude Code)\n'), [2, 1, 218]);
  assert.equal(parseClaudeVersion('not a version'), null);
  // Lexical comparison would rank 2.1.84 above 2.1.218 because "8" > "2".
  assert.equal(compareVersions([2, 1, 218], [2, 1, 84]), 1);
  assert.equal(compareVersions([2, 1, 84], [2, 1, 218]), -1);
  assert.equal(compareVersions([2, 1, 218], [2, 1, 218]), 0);
  const best = pickBest([
    { path: '/opt/homebrew/bin/claude', version: [2, 1, 84] },
    { path: '/Users/tester/.local/bin/claude', version: [2, 1, 218] },
  ]);
  assert.equal(best.path, '/Users/tester/.local/bin/claude');
});

test('resolver picks the newest binary even when an older one is first on PATH', async () => {
  const diagnostics = [];
  const resolver = new ClaudeBinaryResolver({
    platform: 'darwin',
    env: { PATH: '/opt/homebrew/bin:/usr/local/bin' },
    homedir: '/Users/tester',
    diagnostic: (event, details) => diagnostics.push({ event, details }),
    exec: async (command) => {
      if (command === '/opt/homebrew/bin/claude') return '2.1.84 (Claude Code)\n';
      if (command === '/Users/tester/.local/bin/claude') return '2.1.218 (Claude Code)\n';
      throw enoent();
    },
  });

  const resolved = await resolver.resolve();
  assert.equal(resolved, '/Users/tester/.local/bin/claude');

  const record = diagnostics.find((entry) => entry.event === 'claude.binary.resolved');
  assert.ok(record, 'expected a claude.binary.resolved diagnostic');
  assert.equal(record.details.command, '/Users/tester/.local/bin/claude');
  assert.equal(record.details.version, '2.1.218');
  assert.equal(record.details.supportsAgentsJson, true);
  const rejected = record.details.rejected.find((item) => item.path === '/opt/homebrew/bin/claude');
  assert.ok(rejected, 'expected the older homebrew binary to be listed as rejected');
  assert.equal(rejected.version, '2.1.84');
});

test('resolver caches for the process lifetime and re-probes only on refresh', async () => {
  let probes = 0;
  const resolver = new ClaudeBinaryResolver({
    platform: 'darwin',
    env: { PATH: '/usr/local/bin' },
    homedir: '/Users/tester',
    exec: async (command) => {
      probes += 1;
      if (command === '/usr/local/bin/claude') return '2.1.218 (Claude Code)\n';
      throw enoent();
    },
  });

  await resolver.resolve();
  const firstProbeCount = probes;
  await resolver.resolve();
  assert.equal(probes, firstProbeCount, 'cached resolve must not re-probe');
  await resolver.resolve({ refresh: true });
  assert.ok(probes > firstProbeCount, 'refresh must re-probe candidates');
});

test('resolver falls back to bare claude with a diagnostic when nothing is found', async () => {
  const diagnostics = [];
  const resolver = new ClaudeBinaryResolver({
    platform: 'darwin',
    env: { PATH: '/nowhere' },
    homedir: '/Users/tester',
    diagnostic: (event, details) => diagnostics.push({ event, details }),
    exec: async () => {
      throw enoent();
    },
  });

  const resolved = await resolver.resolve();
  assert.equal(resolved, 'claude');
  const fallback = diagnostics.find((entry) => entry.event === 'claude.binary.fallback');
  assert.ok(fallback, 'expected a claude.binary.fallback diagnostic');
  assert.equal(fallback.details.command, 'claude');
});

test('resolver never rejects even when probing throws synchronously', async () => {
  const resolver = new ClaudeBinaryResolver({
    platform: 'darwin',
    env: { PATH: '/usr/local/bin' },
    homedir: '/Users/tester',
    exec: () => {
      throw new Error('exec exploded before returning a promise');
    },
  });
  const resolved = await resolver.resolve();
  assert.equal(resolved, 'claude');
});

test('provider invocation is an identity function on POSIX', () => {
  const invocation = providerCommandInvocation('/Users/tester/.local/bin/claude', ['agents', '--json'], {
    platform: 'darwin',
  });
  assert.deepEqual(invocation, {
    command: '/Users/tester/.local/bin/claude',
    args: ['agents', '--json'],
    options: {},
  });
});

test('provider invocation spawns a Windows executable directly and hides its console window', () => {
  const invocation = providerCommandInvocation('C:/tools/claude.exe', ['agents', '--json'], {
    platform: 'win32',
  });
  assert.equal(invocation.command, 'C:/tools/claude.exe');
  assert.deepEqual(invocation.args, ['agents', '--json']);
  // Without this a packaged desktop parent flashes a console window on every discovery poll.
  assert.equal(invocation.options.windowsHide, true);
  assert.equal(invocation.options.windowsVerbatimArguments, undefined);
});

test('provider invocation routes a Windows npm shim through cmd.exe with verbatim arguments', () => {
  const invocation = providerCommandInvocation('C:\\Users\\dev\\AppData\\Roaming\\npm\\claude.cmd', [
    'agents',
    '--json',
  ], { platform: 'win32' });
  // Node refuses to spawn a .cmd file directly, and PATH search never finds one either.
  assert.equal(invocation.command, 'cmd.exe');
  assert.deepEqual(invocation.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(invocation.args.length, 4);
  assert.equal(invocation.options.windowsVerbatimArguments, true);
  assert.equal(invocation.options.windowsHide, true);
  const parsed = cmdParse(invocation.args[3]);
  assert.ok(parsed.startsWith('C:\\Users\\dev\\AppData\\Roaming\\npm\\claude.cmd '));
  assert.deepEqual(windowsArgv(parsed.slice(parsed.indexOf(' ') + 1)), ['agents', '--json']);
});

test('provider invocation preserves empty, quoted, and metacharacter arguments through cmd.exe', () => {
  // These are the exact standup arguments. An empty string vanishes under a plain shell:true
  // join, and the JSON config and a workspace path can carry cmd metacharacters.
  const args = [
    '--setting-sources',
    '',
    '--tools',
    '',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--add-dir',
    'C:\\My Work\\a&b!(x)',
  ];
  const invocation = providerCommandInvocation('C:\\npm\\claude.cmd', args, { platform: 'win32' });
  const parsed = cmdParse(invocation.args[3]);
  assert.deepEqual(windowsArgv(parsed.slice(parsed.indexOf(' ') + 1)), args);
});

test('provider invocation keeps a command path containing a space one token', () => {
  const invocation = providerCommandInvocation('C:\\Program Files\\nodejs\\claude.cmd', ['--version'], {
    platform: 'win32',
  });
  // The space is caret-escaped, so cmd.exe reads one command token instead of two.
  assert.ok(invocation.args[3].includes('C:\\Program^ Files\\nodejs\\claude.cmd'));
});

test('provider invocation honours a relocated command processor', () => {
  const invocation = providerCommandInvocation('C:\\npm\\codex.cmd', ['app-server'], {
    platform: 'win32',
    env: { ComSpec: 'D:\\Windows\\System32\\cmd.exe' },
  });
  assert.equal(invocation.command, 'D:\\Windows\\System32\\cmd.exe');
});

test('executable resolution prefers a real Windows binary over a shim and is inert on POSIX', () => {
  const present = new Set(['C:/tools/codex.cmd', 'C:/bin/codex.exe', 'C:/bin/codex.cmd']);
  const fileExists = (candidate) => present.has(candidate);
  assert.equal(
    resolveExecutableOnPath('codex', { platform: 'win32', env: { PATH: 'C:/bin;C:/tools' }, fileExists }),
    'C:/bin/codex.exe',
  );
  assert.equal(
    resolveExecutableOnPath('codex', { platform: 'win32', env: { Path: 'C:/tools' }, fileExists }),
    'C:/tools/codex.cmd',
  );
  // Nothing found, an existing path, and POSIX all keep the caller's own value.
  assert.equal(resolveExecutableOnPath('codex', { platform: 'win32', env: { PATH: 'C:/none' }, fileExists }), 'codex');
  assert.equal(
    resolveExecutableOnPath('C:/bin/codex.exe', { platform: 'win32', env: { PATH: 'C:/bin' }, fileExists }),
    'C:/bin/codex.exe',
  );
  assert.equal(resolveExecutableOnPath('codex', { platform: 'darwin', env: { PATH: '/usr/bin' }, fileExists }), 'codex');
});

test('child termination kills the whole tree on Windows and signals directly on POSIX', () => {
  const spawned = [];
  const killed = [];
  const child = { pid: 4242, kill: (signal) => { killed.push(signal); return true; } };
  const spawnProcess = (command, args, options) => {
    spawned.push({ command, args, options });
    return { on: () => {}, unref: () => {} };
  };

  assert.equal(terminateChildProcess(child, { platform: 'win32', spawnProcess }), true);
  assert.deepEqual(spawned, [{
    command: 'taskkill',
    args: ['/PID', '4242', '/T', '/F'],
    options: { stdio: 'ignore', windowsHide: true },
  }]);
  assert.deepEqual(killed, [], 'Windows must not rely on a signal that terminates only cmd.exe');

  assert.equal(terminateChildProcess(child, { platform: 'darwin', spawnProcess }), true);
  assert.deepEqual(killed, ['SIGTERM']);
  assert.equal(spawned.length, 1, 'POSIX behaviour must stay byte-identical');
  assert.equal(terminateChildProcess(null, { platform: 'win32', spawnProcess }), false);
});

test('child termination falls back to a direct kill when taskkill cannot start', () => {
  const killed = [];
  const child = { pid: 7, kill: (signal) => { killed.push(signal); return true; } };
  const failing = () => { throw new Error('taskkill missing'); };
  assert.equal(terminateChildProcess(child, { signal: 'SIGKILL', platform: 'win32', spawnProcess: failing }), true);
  assert.deepEqual(killed, ['SIGKILL']);
});

test('candidate enumeration on Windows probes the installer and global npm locations', () => {
  const candidates = enumerateCandidates({
    env: { Path: 'C:/tools', APPDATA: 'C:/Users/dev/AppData/Roaming' },
    platform: 'win32',
    homedir: 'C:/Users/dev',
  });
  // A desktop launch inherits a registry PATH that can predate the installer.
  assert.ok(candidates.some((path) => path.endsWith(join('.local', 'bin', 'claude.exe'))));
  assert.ok(candidates.some((path) => path.endsWith(join('npm', 'claude.cmd'))));
});

test('resolver accepts a Windows shim by probing it the way execution invokes it', async () => {
  const invocations = [];
  const resolver = new ClaudeBinaryResolver({
    platform: 'win32',
    env: { Path: 'C:/npm' },
    homedir: 'C:/Users/dev',
    fileExists: (candidate) => candidate === join('C:/npm', 'claude.cmd'),
    exec: async (command, args) => {
      invocations.push({ command, args });
      // Windows rejects a direct .cmd spawn, which is what used to fail every probe.
      if (command !== 'cmd.exe') throw Object.assign(new Error('spawn EINVAL'), { code: 'EINVAL' });
      if (!args[3].includes('claude.cmd')) throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
      return '2.1.218 (Claude Code)\n';
    },
  });

  const resolved = await resolver.resolve();
  // The resolved value stays the shim path so every spawn site re-shapes it identically.
  assert.equal(resolved, join('C:/npm', 'claude.cmd'));
  assert.ok(invocations.some((entry) => entry.command === 'cmd.exe'));
  // Probing a missing .cmd would start a real cmd.exe that then fails to find it, and a normal
  // Windows PATH holds dozens of entries, so only files that exist are ever probed.
  assert.equal(invocations.length, 1);
});

test('resolver probes every POSIX candidate without stat filtering', async () => {
  const probed = [];
  const resolver = new ClaudeBinaryResolver({
    platform: 'darwin',
    env: { PATH: '/opt/homebrew/bin' },
    homedir: '/Users/tester',
    fileExists: () => false,
    exec: async (command) => {
      probed.push(command);
      if (command === '/Users/tester/.local/bin/claude') return '2.1.218 (Claude Code)\n';
      throw enoent();
    },
  });

  assert.equal(await resolver.resolve(), '/Users/tester/.local/bin/claude');
  assert.ok(probed.length > 1, 'POSIX resolution must keep probing candidates directly');
});

test('resolver falls back to a real Windows file instead of an unspawnable bare name', async () => {
  const resolver = new ClaudeBinaryResolver({
    platform: 'win32',
    env: { Path: 'C:/npm' },
    homedir: 'C:/Users/dev',
    fileExists: (candidate) => candidate === join('C:/npm', 'claude.cmd'),
    // Every probe times out, which used to cache the bare name that Windows can never spawn.
    exec: async () => { throw Object.assign(new Error('probe timed out'), { code: 'ETIMEDOUT' }); },
  });

  assert.equal(await resolver.resolve(), join('C:/npm', 'claude.cmd'));
});

test('unknown-option detection matches the outdated agents --json failure', () => {
  assert.equal(isUnknownOptionError({ stderr: "error: unknown option '--json'" }), true);
  assert.equal(isUnknownOptionError({ message: 'Command failed: unknown option --json' }), true);
  assert.equal(isUnknownOptionError({ stderr: 'network unreachable' }), false);
  assert.equal(isUnknownOptionError(null), false);
});
