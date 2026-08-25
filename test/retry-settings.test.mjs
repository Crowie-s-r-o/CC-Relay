import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('automatic Execute retries expose executor, model, and effort before queueing', async () => {
  const [html, app, style] = await Promise.all([
    readFile(new URL('public/index.html', root), 'utf8'),
    readFile(new URL('public/app.js', root), 'utf8'),
    readFile(new URL('public/style.css', root), 'utf8'),
  ]);

  assert.match(html, /id="task-edit-provider-label">AI provider/);
  assert.match(html, /id="task-edit-model"/);
  assert.match(html, /id="task-edit-effort"/);
  assert.match(app, /function openTaskRetryEditor\(task\)/);
  assert.match(app, /prepareTaskEditor\(task, \{ mode: 'retry', executionEditable: true \}\)/);
  assert.match(app, /taskEditProviderLabel\.textContent = mode === 'retry' \? 'Executor' : 'AI provider'/);
  assert.match(app, /taskEditSave\.textContent = mode === 'retry' \? 'Retry task' : 'Save changes'/);
  assert.match(app, /method: 'POST',[\s\S]{0,100}body: JSON\.stringify\(selectedExecution\)/);
  assert.match(style, /\.task-edit-modal\[data-mode="retry"\][\s\S]{0,240}#task-edit-prompt/);
});

test('retry API validates provider settings and passes them through one guarded queue transition', async () => {
  const server = await readFile(new URL('src/server.mjs', root), 'utf8');
  const start = server.indexOf("request.method === 'POST' && /^\\/api\\/tasks\\/\\d+\\/retry$/.test(pathname)");
  const end = server.indexOf("request.method === 'POST' && /^\\/api\\/tasks\\/\\d+\\/assign$/.test(pathname)", start);
  assert.notEqual(start, -1, 'retry route should exist');
  assert.notEqual(end, -1, 'assignment route should follow retry');
  const route = server.slice(start, end);

  assert.match(server, /retryTaskExecutionSettings: true/);
  assert.match(route, /const body = await readJson\(request\)/);
  assert.match(route, /task\.mode !== 'execute' \|\| task\.terminal_lifecycle !== 'disposable'/);
  assert.match(route, /Choose Codex, Claude, or OpenCode as the retry executor/);
  assert.match(route, /validateExecutionSettings\(/);
  assert.match(route, /queue\.retry\(taskId, \{ reuseRetainedTerminal, execution: retryExecution \}\)/);
});
