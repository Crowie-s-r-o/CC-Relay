import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  buildTaskDiffFile,
  buildTaskDiffSummary,
  clearTaskDiffCaches,
  mergeDiffRecords,
  normalizeDiffState,
  parseNameStatus,
  parseNumstat,
  parsePatchSections,
  resolveRepositoryRoot,
  snapshotWorkingTree,
  validateDiffPath,
} from '../src/task-diff.mjs';

const execFile = promisify(execFileCallback);

// A maintainer's global git config must not decide which files a fixture tree contains.
const missingConfig = join(tmpdir(), 'relay-task-diff-absent-gitconfig');
process.env.GIT_CONFIG_GLOBAL = missingConfig;
process.env.GIT_CONFIG_SYSTEM = missingConfig;

async function gitAvailable() {
  try {
    await execFile('git', ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

const hasGit = await gitAvailable();
const gitSkip = hasGit ? false : 'git is not installed on this machine';

// git -z output is NUL terminated. Building it from fields keeps the fixtures readable.
const NUL = String.fromCharCode(0);
const nulTerminated = (...fields) => `${fields.join(NUL)}${NUL}`;

function recordingRun(responses) {
  const calls = [];
  const run = async (file, args, options) => {
    calls.push({ file, args, options });
    // Skip the pinned `-c name=value` prefix and key on the git subcommand itself.
    const key = args.find((argument) => !argument.startsWith('-') && !argument.includes('=')) || '';
    const responder = responses[key];
    if (typeof responder === 'function') return responder({ file, args, options });
    return { stdout: responder ?? '', stderr: '' };
  };
  return { calls, run };
}

function fakeDatabase(task, { overlapping = 0 } = {}) {
  const state = { task };
  return {
    getTask: () => state.task,
    updateTask: (id, changes) => {
      if (Object.hasOwn(changes, 'diff_state_json')) {
        state.task = { ...state.task, diffState: normalizeDiffState(changes.diff_state_json) };
      }
      return state.task;
    },
    countOverlappingRepoTasks: () => overlapping,
  };
}

test('name-status records carry renames with both paths', () => {
  const parsed = parseNameStatus(nulTerminated(
    'A', 'added.txt', 'M', 'src/app.mjs', 'D', 'gone.txt', 'R086', 'old.txt', 'new.txt',
  ));

  assert.deepEqual(parsed, [
    { path: 'added.txt', oldPath: null, status: 'added' },
    { path: 'src/app.mjs', oldPath: null, status: 'modified' },
    { path: 'gone.txt', oldPath: null, status: 'deleted' },
    { path: 'new.txt', oldPath: 'old.txt', status: 'renamed' },
  ]);
});

test('numstat records read binary markers and the empty rename path field', () => {
  const parsed = parseNumstat(nulTerminated(
    '2\t0\tadded.txt', '-\t-\tlogo.png', '1\t0\t', 'old.txt', 'new.txt',
  ));

  assert.deepEqual(parsed, [
    { path: 'added.txt', oldPath: null, additions: 2, deletions: 0, binary: false },
    { path: 'logo.png', oldPath: null, additions: 0, deletions: 0, binary: true },
    { path: 'new.txt', oldPath: 'old.txt', additions: 1, deletions: 0, binary: false },
  ]);
});

test('merged records keep the name-status verdict and zero counts for a missing pair', () => {
  const merged = mergeDiffRecords(
    [
      { path: 'new.txt', oldPath: 'old.txt', status: 'renamed' },
      { path: 'lonely.txt', oldPath: null, status: 'modified' },
    ],
    [{ path: 'new.txt', oldPath: 'old.txt', additions: 3, deletions: 1, binary: false }],
  );

  assert.deepEqual(merged, [
    { path: 'new.txt', oldPath: 'old.txt', status: 'renamed', additions: 3, deletions: 1, binary: false },
    { path: 'lonely.txt', oldPath: null, status: 'modified', additions: 0, deletions: 0, binary: false },
  ]);
});

test('a patch parses into numbered side-by-side rows', () => {
  const patch = [
    'diff --git a/src/app.mjs b/src/app.mjs',
    'index 1111111..2222222 100644',
    '--- a/src/app.mjs',
    '+++ b/src/app.mjs',
    '@@ -10,4 +10,5 @@ function boot() {',
    ' const one = 1;',
    '-const two = 2;',
    '+const two = 22;',
    '+const three = 3;',
    ' const four = 4;',
    ' ',
    '',
  ].join('\n');

  const { sections, truncated } = parsePatchSections(patch);

  assert.equal(truncated, false);
  assert.equal(sections.length, 1);
  const [hunk] = sections[0].hunks;
  assert.deepEqual(
    { oldStart: hunk.oldStart, oldLines: hunk.oldLines, newStart: hunk.newStart, newLines: hunk.newLines },
    { oldStart: 10, oldLines: 4, newStart: 10, newLines: 5 },
  );
  assert.deepEqual(hunk.lines, [
    { type: 'context', oldNumber: 10, newNumber: 10, text: 'const one = 1;' },
    { type: 'del', oldNumber: 11, newNumber: null, text: 'const two = 2;' },
    { type: 'add', oldNumber: null, newNumber: 11, text: 'const two = 22;' },
    { type: 'add', oldNumber: null, newNumber: 12, text: 'const three = 3;' },
    { type: 'context', oldNumber: 12, newNumber: 13, text: 'const four = 4;' },
    { type: 'context', oldNumber: 13, newNumber: 14, text: '' },
  ]);
});

test('a single line hunk header without counts still numbers its rows', () => {
  const { sections } = parsePatchSections([
    'diff --git a/one.txt b/one.txt',
    '@@ -7 +7 @@',
    '-before',
    '+after',
    '',
  ].join('\n'));

  const [hunk] = sections[0].hunks;
  assert.deepEqual(
    { oldLines: hunk.oldLines, newLines: hunk.newLines },
    { oldLines: 1, newLines: 1 },
  );
  assert.deepEqual(hunk.lines.map((line) => [line.type, line.oldNumber, line.newNumber]), [
    ['del', 7, null],
    ['add', null, 7],
  ]);
});

test('the no-newline marker never becomes a row and binary sections carry no hunks', () => {
  const { sections } = parsePatchSections([
    'diff --git a/tail.txt b/tail.txt',
    '@@ -1 +1 @@',
    '-old tail',
    '\\ No newline at end of file',
    '+new tail',
    '\\ No newline at end of file',
    'diff --git a/logo.png b/logo.png',
    'index 3333333..4444444 100644',
    'Binary files a/logo.png and b/logo.png differ',
    '',
  ].join('\n'));

  assert.equal(sections.length, 2);
  assert.deepEqual(sections[0].hunks[0].lines.map((line) => line.text), ['old tail', 'new tail']);
  assert.equal(sections[1].binary, true);
  assert.deepEqual(sections[1].hunks, []);
});

test('a rename section is recognisable and line text passes through intact', () => {
  const { sections } = parsePatchSections([
    'diff --git a/old.txt b/new.txt',
    'similarity index 86%',
    'rename from old.txt',
    'rename to new.txt',
    '@@ -1,2 +1,2 @@',
    '-\tindented\told',
    '+\tindented\tnew  ',
    '',
  ].join('\n'));

  assert.equal(sections[0].renamed, true);
  assert.deepEqual(sections[0].hunks[0].lines.map((line) => line.text), [
    '\tindented\told',
    '\tindented\tnew  ',
  ]);
});

test('the parsed line cap truncates without dropping the hunks it already built', () => {
  const lines = ['diff --git a/big.txt b/big.txt', '@@ -1,6 +1,6 @@'];
  for (let index = 0; index < 6; index += 1) lines.push(`+line ${index}`);
  const { sections, truncated } = parsePatchSections(lines.join('\n'), { maxLines: 4 });

  assert.equal(truncated, true);
  assert.equal(sections[0].hunks.length, 1);
  assert.equal(sections[0].hunks[0].lines.length, 4);
  assert.equal(sections[0].hunks[0].lines.at(-1).text, 'line 3');
});

test('snapshotting builds a throwaway index outside the repository and removes it', async () => {
  const { calls, run } = recordingRun({
    'read-tree': '',
    add: '',
    'write-tree': `${'a'.repeat(40)}\n`,
  });

  const tree = await snapshotWorkingTree('/projects/demo', { run });

  assert.equal(tree, 'a'.repeat(40));
  assert.deepEqual(calls.map((call) => call.args.filter((argument) => !argument.startsWith('-c'))), [
    ['core.fsmonitor=false', 'color.ui=false', 'read-tree', '--empty'],
    ['core.fsmonitor=false', 'color.ui=false', 'add', '-A', '--', '.'],
    ['core.fsmonitor=false', 'color.ui=false', 'write-tree'],
  ]);
  for (const call of calls) {
    assert.equal(call.file, 'git');
    assert.equal(call.options.cwd, '/projects/demo');
    assert.equal(call.options.timeout, 15_000);
    assert.ok(call.options.maxBuffer >= 1024 * 1024, 'every git call sets an explicit maxBuffer');
    assert.equal(call.options.env.GIT_OPTIONAL_LOCKS, '0');
    assert.equal(call.options.env.LC_ALL, 'C');
    assert.equal(call.options.env.TZ, 'UTC');
    const indexFile = call.options.env.GIT_INDEX_FILE;
    assert.ok(indexFile.startsWith(tmpdir()), 'the temporary index never lives inside the repository');
  }
  assert.equal(existsSync(calls[0].options.env.GIT_INDEX_FILE), false);
});

test('a missing git binary and a non repository are told apart', async () => {
  clearTaskDiffCaches();
  const directory = mkdtempSync(join(tmpdir(), 'relay-diff-root-'));
  try {
    const missing = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
    await assert.rejects(
      resolveRepositoryRoot(directory, { run: async () => { throw missing; } }),
      (error) => error.code === 'git-unavailable',
    );

    clearTaskDiffCaches();
    const failed = Object.assign(new Error('not a git repository'), { code: 128 });
    await assert.rejects(
      resolveRepositoryRoot(directory, { run: async () => { throw failed; } }),
      (error) => error.code === 'not-a-git-repository',
    );

    clearTaskDiffCaches();
    await assert.rejects(
      resolveRepositoryRoot(join(directory, 'deleted-project'), {
        run: async () => {
          throw new Error('git must never be spawned for a project directory that is gone');
        },
      }),
      (error) => error.code === 'not-a-git-repository',
    );
  } finally {
    clearTaskDiffCaches();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a resolved root is reused inside its cache window', async () => {
  clearTaskDiffCaches();
  const directory = mkdtempSync(join(tmpdir(), 'relay-diff-root-cache-'));
  let spawns = 0;
  try {
    const run = async () => {
      spawns += 1;
      return { stdout: `${directory}\n`, stderr: '' };
    };
    assert.equal(await resolveRepositoryRoot(directory, { run }), directory);
    assert.equal(await resolveRepositoryRoot(directory, { run }), directory);
    assert.equal(spawns, 1);

    assert.equal(await resolveRepositoryRoot(directory, { run, clock: () => Date.now() + 60_000 }), directory);
    assert.equal(spawns, 2);
  } finally {
    clearTaskDiffCaches();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a diff path is rejected before it can reach git', () => {
  for (const value of ['', null, '/etc/passwd', '../outside.txt', 'a/../../outside.txt', 'C:\\windows\\system32', 'x'.repeat(5000)]) {
    assert.throws(() => validateDiffPath(value), (error) => error.statusCode === 400, `expected ${value} to be rejected`);
  }
  assert.equal(validateDiffPath('src/app.mjs'), 'src/app.mjs');
  assert.equal(validateDiffPath('a file with spaces and ..dots.txt'), 'a file with spaces and ..dots.txt');
});

test('a task without a baseline reports the fixed unavailable shape', async () => {
  const summary = await buildTaskDiffSummary({
    database: fakeDatabase({ id: 1, status: 'complete', repo_path: '/projects/demo', diffState: null }),
    task: { id: 1, status: 'complete', repo_path: '/projects/demo', diffState: null },
    run: async () => { throw new Error('git must never run for a task with no diff state'); },
  });

  assert.deepEqual(summary, {
    available: false,
    reason: 'captured-before-diff-support',
    live: false,
    capturedAt: null,
    endedAt: null,
    sharedTree: false,
    totalAdditions: 0,
    totalDeletions: 0,
    truncated: false,
    signature: 'unavailable:captured-before-diff-support',
    files: [],
  });
});

test('a reason outside the fixed set can never reach a client', () => {
  const stored = normalizeDiffState(JSON.stringify({
    version: 1,
    root: '/projects/demo',
    baseline: null,
    end: null,
    // A failure raised by a layer this module does not own, such as SQLite.
    error: { code: 'ERR_SQLITE_ERROR', at: '2026-08-13T10:00:00.000Z' },
  }));

  assert.equal(stored.error.code, 'baseline-failed');
});

test('a stored capture failure is reported with its own reason', async () => {
  const task = {
    id: 2,
    status: 'failed',
    repo_path: '/projects/demo',
    diffState: { root: null, baseline: null, end: null, error: { code: 'not-a-git-repository', at: '2026-08-13T10:00:00.000Z' } },
  };
  const summary = await buildTaskDiffSummary({
    database: fakeDatabase(task),
    task,
    run: async () => { throw new Error('git must never run for a task whose capture already failed'); },
  });

  assert.equal(summary.available, false);
  assert.equal(summary.reason, 'not-a-git-repository');
  assert.equal(summary.signature, 'unavailable:not-a-git-repository');
  assert.deepEqual(summary.files, []);
});

// The integration section proves the git strategy itself: a temporary index, .gitignore
// respected, untracked files included, and the user's own index left untouched.
async function git(root, args) {
  return execFile('git', args, {
    cwd: root,
    timeout: 20_000,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'relay-test',
      GIT_AUTHOR_EMAIL: 'relay-test@example.invalid',
      GIT_COMMITTER_NAME: 'relay-test',
      GIT_COMMITTER_EMAIL: 'relay-test@example.invalid',
    },
  });
}

async function fixtureRepository() {
  const root = mkdtempSync(join(tmpdir(), 'relay-diff-repo-'));
  await git(root, ['init', '-q', '.']);
  await git(root, ['config', 'user.name', 'relay-test']);
  await git(root, ['config', 'user.email', 'relay-test@example.invalid']);
  writeFileSync(join(root, '.gitignore'), 'build/\n');
  writeFileSync(join(root, 'keep.txt'), 'one\ntwo\nthree\n');
  writeFileSync(join(root, 'remove.txt'), 'delete me\n');
  writeFileSync(join(root, 'rename.txt'), 'alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\n');
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-q', '-m', 'fixture']);
  return root;
}

test('a real repository snapshot honours .gitignore and includes untracked work', { skip: gitSkip }, async () => {
  const root = await fixtureRepository();
  try {
    clearTaskDiffCaches();
    const baseline = await snapshotWorkingTree(root);

    writeFileSync(join(root, 'keep.txt'), 'one\nTWO\nthree\n');
    writeFileSync(join(root, 'untracked.txt'), 'brand new\nsecond line\n');
    mkdirSync(join(root, 'build'), { recursive: true });
    writeFileSync(join(root, 'build/ignored.txt'), 'never in the tree\n');
    rmSync(join(root, 'remove.txt'));
    // A plain move, the way a provider would make it. Nothing here stages anything.
    renameSync(join(root, 'rename.txt'), join(root, 'renamed.txt'));
    const current = await snapshotWorkingTree(root);
    assert.notEqual(current, baseline);

    const { stdout: listing } = await git(root, ['ls-tree', '-r', '--name-only', current]);
    const paths = listing.trim().split('\n').sort();
    assert.deepEqual(paths, ['.gitignore', 'keep.txt', 'renamed.txt', 'untracked.txt']);

    // The real index is the one git status reads. Nothing above may have staged anything.
    const { stdout: staged } = await git(root, ['diff', '--cached', '--name-only']);
    assert.equal(staged.trim(), '');
  } finally {
    clearTaskDiffCaches();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a real diff summary and its file hunks match the working tree', { skip: gitSkip }, async () => {
  const root = await fixtureRepository();
  try {
    clearTaskDiffCaches();
    const baseline = await snapshotWorkingTree(root);
    const task = {
      id: 7,
      status: 'running',
      repo_path: root,
      diffState: { root, baseline: { tree: baseline, at: '2026-08-13T10:00:00.000Z' }, end: null, error: null },
    };
    const database = fakeDatabase(task, { overlapping: 2 });

    writeFileSync(join(root, 'keep.txt'), 'one\nTWO\nthree\n');
    writeFileSync(join(root, 'untracked.txt'), 'brand new\nsecond line\n');
    writeFileSync(join(root, 'binary.bin'), Buffer.from([0, 1, 2, 0, 3]));
    rmSync(join(root, 'remove.txt'));
    // A plain move, the way a provider would make it. Nothing here stages anything.
    renameSync(join(root, 'rename.txt'), join(root, 'renamed.txt'));
    clearTaskDiffCaches();

    const summary = await buildTaskDiffSummary({ database, task });
    assert.equal(summary.available, true);
    assert.equal(summary.reason, null);
    assert.equal(summary.live, true);
    assert.equal(summary.capturedAt, '2026-08-13T10:00:00.000Z');
    assert.equal(summary.endedAt, null);
    assert.equal(summary.sharedTree, true);
    assert.equal(summary.truncated, false);

    const byPath = new Map(summary.files.map((file) => [file.path, file]));
    assert.deepEqual([...byPath.keys()].sort(), ['binary.bin', 'keep.txt', 'remove.txt', 'renamed.txt', 'untracked.txt']);
    assert.equal(byPath.get('keep.txt').status, 'modified');
    assert.deepEqual(
      [byPath.get('keep.txt').additions, byPath.get('keep.txt').deletions],
      [1, 1],
    );
    assert.equal(byPath.get('remove.txt').status, 'deleted');
    assert.equal(byPath.get('untracked.txt').status, 'added');
    assert.equal(byPath.get('binary.bin').binary, true);
    assert.equal(byPath.get('renamed.txt').status, 'renamed');
    assert.equal(byPath.get('renamed.txt').oldPath, 'rename.txt');
    assert.equal(summary.totalAdditions, 3);
    assert.equal(summary.totalDeletions, 2);

    const modified = await buildTaskDiffFile({ database, task, path: 'keep.txt' });
    assert.equal(modified.status, 'modified');
    assert.equal(modified.binary, false);
    assert.equal(modified.tooLarge, false);
    assert.equal(modified.hunks.length, 1);
    assert.deepEqual(modified.hunks[0].lines, [
      { type: 'context', oldNumber: 1, newNumber: 1, text: 'one' },
      { type: 'del', oldNumber: 2, newNumber: null, text: 'two' },
      { type: 'add', oldNumber: null, newNumber: 2, text: 'TWO' },
      { type: 'context', oldNumber: 3, newNumber: 3, text: 'three' },
    ]);
    assert.equal(modified.signature, `${baseline}:${summary.signature.split(':')[1]}:keep.txt`);

    const renamed = await buildTaskDiffFile({ database, task, path: 'renamed.txt' });
    assert.equal(renamed.status, 'renamed');
    assert.equal(renamed.oldPath, 'rename.txt');
    assert.deepEqual(renamed.hunks, []);

    const binary = await buildTaskDiffFile({ database, task, path: 'binary.bin' });
    assert.equal(binary.binary, true);
    assert.deepEqual(binary.hunks, []);

    const deleted = await buildTaskDiffFile({ database, task, path: 'remove.txt' });
    assert.equal(deleted.status, 'deleted');
    assert.deepEqual(deleted.hunks[0].lines, [
      { type: 'del', oldNumber: 1, newNumber: null, text: 'delete me' },
    ]);

    await assert.rejects(
      buildTaskDiffFile({ database, task, path: 'never-touched.txt' }),
      (error) => error.statusCode === 404,
    );
  } finally {
    clearTaskDiffCaches();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a terminal task freezes on its captured end tree', { skip: gitSkip }, async () => {
  const root = await fixtureRepository();
  try {
    clearTaskDiffCaches();
    const baseline = await snapshotWorkingTree(root);
    writeFileSync(join(root, 'keep.txt'), 'one\nTWO\nthree\n');
    clearTaskDiffCaches();
    const ended = await snapshotWorkingTree(root);

    const task = {
      id: 9,
      status: 'complete',
      repo_path: root,
      diffState: {
        root,
        baseline: { tree: baseline, at: '2026-08-13T10:00:00.000Z' },
        end: { tree: ended, at: '2026-08-13T10:05:00.000Z' },
        error: null,
      },
    };
    const database = fakeDatabase(task);

    const first = await buildTaskDiffSummary({ database, task });
    assert.equal(first.live, false);
    assert.equal(first.endedAt, '2026-08-13T10:05:00.000Z');
    assert.deepEqual(first.files.map((file) => file.path), ['keep.txt']);

    // Work that lands after the task finished must not enter a frozen diff.
    writeFileSync(join(root, 'later.txt'), 'written by the next task\n');
    clearTaskDiffCaches();
    const second = await buildTaskDiffSummary({ database, task });
    assert.deepEqual(second.files.map((file) => file.path), ['keep.txt']);
    assert.equal(second.signature, first.signature);
  } finally {
    clearTaskDiffCaches();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a terminal task with no end tree captures one lazily and then stays frozen', { skip: gitSkip }, async () => {
  const root = await fixtureRepository();
  try {
    clearTaskDiffCaches();
    const baseline = await snapshotWorkingTree(root);
    writeFileSync(join(root, 'keep.txt'), 'one\nTWO\nthree\n');

    const task = {
      id: 11,
      status: 'cancelled',
      repo_path: root,
      diffState: { root, baseline: { tree: baseline, at: '2026-08-13T10:00:00.000Z' }, end: null, error: null },
    };
    const database = fakeDatabase(task);
    clearTaskDiffCaches();

    const summary = await buildTaskDiffSummary({ database, task });
    assert.equal(summary.available, true);
    assert.equal(summary.live, false);
    assert.ok(summary.endedAt, 'the lazy capture records when it froze the diff');
    assert.deepEqual(summary.files.map((file) => file.path), ['keep.txt']);
    assert.ok(database.getTask().diffState.end.tree, 'the end tree is persisted for later views');
  } finally {
    clearTaskDiffCaches();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a live snapshot is reused inside the poll window', { skip: gitSkip }, async () => {
  const root = await fixtureRepository();
  try {
    clearTaskDiffCaches();
    const baseline = await snapshotWorkingTree(root);
    const task = {
      id: 13,
      status: 'running',
      repo_path: root,
      diffState: { root, baseline: { tree: baseline, at: '2026-08-13T10:00:00.000Z' }, end: null, error: null },
    };
    const database = fakeDatabase(task);
    clearTaskDiffCaches();

    writeFileSync(join(root, 'first.txt'), 'first\n');
    const first = await buildTaskDiffSummary({ database, task });
    writeFileSync(join(root, 'second.txt'), 'second\n');
    const cached = await buildTaskDiffSummary({ database, task });
    assert.equal(cached.signature, first.signature, 'a poll inside the window costs no new snapshot');

    clearTaskDiffCaches();
    const refreshed = await buildTaskDiffSummary({ database, task });
    assert.notEqual(refreshed.signature, first.signature);
    assert.deepEqual(refreshed.files.map((file) => file.path).sort(), ['first.txt', 'second.txt']);
  } finally {
    clearTaskDiffCaches();
    rmSync(root, { recursive: true, force: true });
  }
});
