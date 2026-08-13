import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

const TASK_DETAIL_ROUTE = "request.method === 'GET' && /^\\/api\\/tasks\\/\\d+$/.test(pathname)";
const DIFF_SUMMARY_ROUTE = "request.method === 'GET' && /^\\/api\\/tasks\\/\\d+\\/diff$/.test(pathname)";
const DIFF_FILE_ROUTE = "request.method === 'GET' && /^\\/api\\/tasks\\/\\d+\\/diff\\/file$/.test(pathname)";

test('the diff routes are registered above the bare task detail route', async () => {
  const server = await readFile(new URL('src/server.mjs', root), 'utf8');

  const summary = server.indexOf(DIFF_SUMMARY_ROUTE);
  const file = server.indexOf(DIFF_FILE_ROUTE);
  const detail = server.indexOf(TASK_DETAIL_ROUTE);

  assert.notEqual(summary, -1, 'the diff summary route should exist');
  assert.notEqual(file, -1, 'the diff file route should exist');
  assert.notEqual(detail, -1, 'the task detail route should exist');
  // Anything between the bare GET and the PATCH handler is read as the task detail route by
  // test/session-tasks-api.test.mjs, so these two have to stay in front of it.
  assert.ok(summary < detail, 'the diff summary route must be registered before the bare task route');
  assert.ok(file < detail, 'the diff file route must be registered before the bare task route');
});

test('the diff routes answer with the shared builders and a 404 for a missing task', async () => {
  const server = await readFile(new URL('src/server.mjs', root), 'utf8');
  const routes = server.slice(server.indexOf(DIFF_SUMMARY_ROUTE), server.indexOf(TASK_DETAIL_ROUTE));

  assert.match(routes, /sendJson\(response, 200, await buildTaskDiffSummary\(\{ database, task \}\)\)/);
  assert.match(routes, /await buildTaskDiffFile\(\{[\s\S]{0,120}path: url\.searchParams\.get\('path'\),/);
  assert.equal(routes.match(/sendError\(response, 404, 'Task not found\.'\)/g)?.length, 2);
  assert.match(server, /import \{[\s\S]{0,160}buildTaskDiffFile,[\s\S]{0,160}\} from '\.\/task-diff\.mjs'/);
});

test('the diff preview is announced as a capability', async () => {
  const server = await readFile(new URL('src/server.mjs', root), 'utf8');
  const status = server.slice(server.indexOf("pathname === '/api/status'"), server.indexOf(TASK_DETAIL_ROUTE));

  assert.match(status, /taskDiffPreview: true/);
});

test('the end capture is wired into the queue change listener', async () => {
  const server = await readFile(new URL('src/server.mjs', root), 'utf8');
  const listener = server.slice(
    server.indexOf("queue.on('changed'"),
    server.indexOf("codexAppServer.on('status'"),
  );

  assert.notEqual(listener.length, 0, 'the queue change listener should exist');
  // Fire and forget on purpose: a snapshot must never delay the broadcast this listener owns.
  assert.match(listener, /void maybeCaptureTaskDiffEnd\(\{ database, task \}\)/);
  assert.match(listener, /broadcast\(plansChanged \? \{ \.\.\.change, plans: true \} : change\)/);
});

test('every git call is asynchronous, bounded, and argument array based', async () => {
  const taskDiff = await readFile(new URL('src/task-diff.mjs', root), 'utf8');

  assert.equal(taskDiff.includes('execFileSync'), false, 'no synchronous exec may run on a request path');
  assert.equal(taskDiff.includes('spawnSync'), false, 'no synchronous spawn may run on a request path');
  assert.equal(taskDiff.includes('exec('), false, 'a shell string command would let a path become an argument');
  assert.match(taskDiff, /const execFile = promisify\(execFileCallback\)/);
  assert.match(taskDiff, /const GIT_TIMEOUT_MS = 15_000/);
  assert.match(taskDiff, /timeout = GIT_TIMEOUT_MS/);
  // execFile defaults to a 1MB buffer, which an ordinary large diff overruns.
  assert.match(taskDiff, /const SUMMARY_MAX_BUFFER = 32 \* 1024 \* 1024/);
  assert.match(taskDiff, /const FILE_MAX_BUFFER = 16 \* 1024 \* 1024/);
  assert.match(taskDiff, /maxBuffer = SMALL_MAX_BUFFER/);
  assert.match(taskDiff, /GIT_OPTIONAL_LOCKS: '0'/);
  assert.match(taskDiff, /LC_ALL: 'C'/);
  // A path that arrived over HTTP is matched literally, and no repository configured program
  // is executed to render a preview.
  assert.match(taskDiff, /:\(literal\)\$\{entry\.path\}/);
  assert.match(taskDiff, /'--no-ext-diff', '--no-textconv'/);
});

test('the throwaway index never lives inside the repository being read', async () => {
  const taskDiff = await readFile(new URL('src/task-diff.mjs', root), 'utf8');
  const snapshot = taskDiff.slice(
    taskDiff.indexOf('export async function snapshotWorkingTree'),
    taskDiff.indexOf('function currentWorkingTree'),
  );

  assert.match(snapshot, /mkdtemp\(join\(tmpdir\(\), 'relay-task-diff-'\)\)/);
  assert.match(snapshot, /GIT_INDEX_FILE: join\(directory, 'index'\)/);
  assert.match(snapshot, /\['read-tree', '--empty'\]/);
  assert.match(snapshot, /\['add', '-A', '--', '\.'\]/);
  assert.match(snapshot, /\['write-tree'\]/);
  assert.match(snapshot, /rm\(directory, \{ recursive: true, force: true \}\)/);
});

test('the baseline capture starts at task begin without delaying dispatch', async () => {
  const queue = await readFile(new URL('src/queue.mjs', root), 'utf8');

  // beginTask has to stay synchronous. schedule() runs runNext() and planAhead() in one tick,
  // and planAhead() reads state that only runner.run() establishes, so an await here silently
  // stops Turbo look-ahead. The capture is started, not awaited.
  assert.match(queue, /\n {2}beginTask\(task, \{ sessionFollowUp = false \} = \{\}\) \{/);
  assert.match(queue, /void this\.captureDiffBaseline\(\{ database: this\.database, taskId: task\.id \}\)/);
  assert.match(queue, /captureDiffBaseline = captureTaskDiffBaseline/);
  assert.equal((queue.match(/await this\.beginTask\(/g) || []).length, 0);
  assert.equal((queue.match(/this\.beginTask\(/g) || []).length, 4, 'beginTask has four call sites');

  // The capture is the last statement, so the status write, the event, and the change
  // broadcast all still happen before anything touches git.
  const begin = queue.slice(queue.indexOf('  beginTask(task, {'), queue.indexOf('  runTask(task, options = {}) {'));
  assert.ok(
    begin.indexOf('this.changed(task.id)') < begin.indexOf('this.captureDiffBaseline'),
    'the baseline capture runs after the task is already visible as running',
  );
});

test('the diff column is persisted, whitelisted, and normalized', async () => {
  const database = await readFile(new URL('src/database.mjs', root), 'utf8');

  assert.match(database, /this\.ensureColumn\('diff_state_json', 'TEXT'\)/);
  // updateTask silently drops any column missing from this set.
  const fields = database.slice(database.indexOf('const TASK_FIELDS'), database.indexOf('function now()'));
  assert.match(fields, /'diff_state_json',/);
  assert.match(database, /diff_state_json: encodedDiffState/);
  assert.match(database, /diffState: normalizeDiffState\(encodedDiffState\)/);
  assert.match(database, /countOverlappingRepoTasks\(repoPath, \{ excludeTaskId = null, from = null, to = null \} = \{\}\)/);
});
