import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

// Scoped to the GET handler so this cannot pass on the standup route, which reads the same
// helpers through `task.id`, or on the PATCH and DELETE handlers for the identical path.
function taskDetailRoute(server) {
  const start = server.indexOf("request.method === 'GET' && /^\\/api\\/tasks\\/\\d+$/.test(pathname)");
  assert.notEqual(start, -1, 'task detail route should exist');
  const end = server.indexOf("if (request.method === 'PATCH'", start);
  assert.notEqual(end, -1, 'task detail route should be followed by the task edit route');
  return server.slice(start, end);
}

test('task detail returns the paired prompt and response history for session tasks', async () => {
  const server = await readFile(new URL('src/server.mjs', root), 'utf8');
  const route = taskDetailRoute(server);

  assert.match(route, /prompts: database\.listTaskPrompts\(taskId\)/);
  assert.match(route, /responses: database\.listTaskResponses\(taskId\)/);
});

test('closing a retained terminal records a task event and refreshes task watchers', async () => {
  const server = await readFile(new URL('src/server.mjs', root), 'utf8');

  assert.match(server, /import \{ retainedSessionTaskForThread \} from '\.\/terminal-control\.mjs'/);
  assert.match(server, /retainedSessionTaskForThread\(database\.listTasks\(\), threadId\)/);
  assert.match(
    server,
    /database\.addEvent\(retained\.id, 'queue', 'The retained terminal window was closed from CC Relay\.'\)/,
  );
  assert.match(server, /\{ threads: true, tasks: true, taskId: closedTaskId \}/);
});

test('a running task can latch terminal retention through a capability-gated route', async () => {
  const server = await readFile(new URL('src/server.mjs', root), 'utf8');

  assert.match(server, /liveTerminalRetention: true/);
  assert.match(server, /request\.method === 'POST' && \/\^\\\/api\\\/tasks\\\/\\d\+\\\/keep-terminal-open\$\//);
  assert.match(server, /const task = queue\.keepTerminalOpen\(taskId\)/);
  assert.match(server, /api\.task\.terminal_retention_enabled/);
});

test('manual terminal sessions are capability gated and finish through an explicit route', async () => {
  const [server, queue] = await Promise.all([
    readFile(new URL('src/server.mjs', root), 'utf8'),
    readFile(new URL('src/queue.mjs', root), 'utf8'),
  ]);

  assert.match(server, /manualSessionTasks: true/);
  assert.match(server, /const manualCompletion = disposable[\s\S]{0,180}mode === 'execute'[\s\S]{0,120}body\.manualCompletion === true/);
  assert.match(server, /request\.method === 'POST' && \/\^\\\/api\\\/tasks\\\/\\d\+\\\/complete-session\$\//);
  assert.match(server, /const task = queue\.completeSession\(taskId\)/);
  assert.match(server, /isManualSessionTask\(sourceTask\) && sourceTask\.status === 'complete'/);
  assert.match(queue, /status: manualSession \? 'open' : 'complete'/);
  assert.match(queue, /Terminal session completed manually\. This does not close any retained terminal\./);
});
