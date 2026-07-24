import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClaudeBinaryResolver,
  compareVersions,
  enumerateCandidates,
  isUnknownOptionError,
  parseClaudeVersion,
  pickBest,
} from '../src/claude-binary.mjs';

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

test('unknown-option detection matches the outdated agents --json failure', () => {
  assert.equal(isUnknownOptionError({ stderr: "error: unknown option '--json'" }), true);
  assert.equal(isUnknownOptionError({ message: 'Command failed: unknown option --json' }), true);
  assert.equal(isUnknownOptionError({ stderr: 'network unreachable' }), false);
  assert.equal(isUnknownOptionError(null), false);
});
