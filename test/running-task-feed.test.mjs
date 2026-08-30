import assert from 'node:assert/strict';
import test from 'node:test';
import {
  latestAgentUpdate,
  latestTokenUsage,
  runningTaskFeed,
  taskBelongsInMonitor,
} from '../src/running-task-feed.mjs';

test('latest agent update reads Codex and Claude response events', () => {
  const events = [
    { id: 1, kind: 'queue', message: 'Task started.', payload: null, created_at: '2026-07-20T10:00:00.000Z' },
    {
      id: 2,
      kind: 'codex',
      message: 'First response',
      payload: { type: 'item/updated', item: { type: 'agentMessage', text: 'First response' } },
      created_at: '2026-07-20T10:00:01.000Z',
    },
    {
      id: 3,
      kind: 'claude',
      message: 'Latest response',
      payload: { type: 'claude/message', provider: 'claude', text: 'Latest response' },
      created_at: '2026-07-20T10:00:02.000Z',
    },
    {
      id: 4,
      kind: 'codex',
      message: 'Command completed',
      payload: { type: 'item/completed', item: { type: 'commandExecution', command: 'npm test' } },
      created_at: '2026-07-20T10:00:03.000Z',
    },
  ];

  assert.deepEqual(latestAgentUpdate(events), {
    text: 'Latest response',
    provider: 'claude',
    createdAt: '2026-07-20T10:00:02.000Z',
  });
});

test('latest agent update recognizes an OpenCode response', () => {
  const events = [{
    id: 1,
    kind: 'opencode',
    message: 'OpenCode response',
    payload: { type: 'opencode/message', provider: 'opencode', text: 'OpenCode response' },
    created_at: '2026-08-25T10:00:01.000Z',
  }];
  assert.deepEqual(latestAgentUpdate(events), {
    text: 'OpenCode response',
    provider: 'opencode',
    createdAt: '2026-08-25T10:00:01.000Z',
  });
});

test('latest token usage keeps only cumulative native provider statistics', () => {
  const events = [
    {
      id: 1,
      kind: 'opencode',
      payload: {
        type: 'provider/token-usage',
        provider: 'opencode',
        source: 'native',
        cumulative: true,
        usage: { totalTokens: 300 },
      },
      created_at: '2026-08-25T10:00:01.000Z',
    },
    {
      id: 2,
      kind: 'opencode',
      payload: {
        type: 'provider/token-usage',
        provider: 'opencode',
        source: 'estimated',
        cumulative: true,
        usage: { totalTokens: 400 },
      },
      created_at: '2026-08-25T10:00:02.000Z',
    },
  ];
  assert.deepEqual(latestTokenUsage(events), {
    provider: 'opencode',
    usage: { totalTokens: 300 },
    source: 'native',
    createdAt: '2026-08-25T10:00:01.000Z',
  });
});

test('a new task-attempt boundary hides the preceding turn usage', () => {
  const events = [
    {
      id: 1,
      kind: 'codex',
      payload: {
        type: 'provider/token-usage',
        provider: 'codex',
        source: 'native',
        cumulative: true,
        usage: { totalTokens: 300 },
      },
      created_at: '2026-08-25T10:00:01.000Z',
    },
    {
      id: 2,
      kind: 'queue',
      payload: {
        type: 'relay/task-attempt-started',
        provider: 'codex',
        attemptStartedAt: '2026-08-25T11:00:00.000Z',
      },
      created_at: '2026-08-25T11:00:00.000Z',
    },
  ];

  assert.equal(latestTokenUsage(events), null);
});

test('task monitor is global and retains only valid open manual sessions after running work', () => {
  const manualSession = {
    status: 'open',
    manual_completion: true,
    keep_terminal_open: true,
    terminal_lifecycle: 'disposable',
    mode: 'execute',
    provider: 'codex',
  };
  const tasks = [
    { id: 1, status: 'running', repo_path: '/repo/alpha' },
    { id: 2, status: 'queued', repo_path: '/repo/alpha' },
    { id: 3, status: 'running', repo_path: '/repo/beta' },
    { id: 4, ...manualSession, repo_path: '/repo/alpha' },
    { id: 5, ...manualSession, manual_completion: false, repo_path: '/repo/alpha' },
    { id: 6, ...manualSession, status: 'complete', repo_path: '/repo/alpha' },
    { id: 7, ...manualSession, mode: 'plan', repo_path: '/repo/alpha' },
  ];
  const events = new Map([
    [1, [{ id: 1, kind: 'codex', payload: { item: { type: 'agentMessage', text: 'Alpha update' } } }]],
    [3, [{ id: 2, kind: 'claude', payload: { type: 'claude/message', text: 'Beta update', provider: 'claude' } }]],
    [4, [{ id: 3, kind: 'codex', payload: { item: { type: 'agentMessage', text: 'Session result' } } }]],
  ]);

  const feed = runningTaskFeed(tasks, (taskId) => events.get(taskId) || []);
  assert.deepEqual(feed.map((task) => [task.id, task.repo_path, task.latestAgentUpdate.text]), [
    [1, '/repo/alpha', 'Alpha update'],
    [3, '/repo/beta', 'Beta update'],
    [4, '/repo/alpha', 'Session result'],
  ]);

  assert.equal(taskBelongsInMonitor({ status: 'running' }), true);
  assert.equal(taskBelongsInMonitor(manualSession), true);
  assert.equal(taskBelongsInMonitor({ ...manualSession, keep_terminal_open: false }), false);
  assert.equal(taskBelongsInMonitor({ ...manualSession, terminal_lifecycle: 'persistent' }), false);
  assert.equal(taskBelongsInMonitor({ ...manualSession, provider: 'council' }), false);
});

test('status can preserve the legacy running-only feed beside the additive monitor feed', () => {
  const tasks = [
    { id: 1, status: 'running' },
    {
      id: 2,
      status: 'open',
      manual_completion: true,
      keep_terminal_open: true,
      terminal_lifecycle: 'disposable',
      mode: 'execute',
      provider: 'claude',
    },
  ];
  const monitored = runningTaskFeed(tasks, () => []);

  assert.deepEqual(monitored.map((task) => task.id), [1, 2]);
  assert.deepEqual(monitored.filter((task) => task.status === 'running').map((task) => task.id), [1]);
});

test('a Claude input request becomes the latest running-task update', () => {
  const events = [
    {
      id: 1,
      kind: 'claude',
      message: 'Earlier response',
      payload: { type: 'claude/message', provider: 'claude', text: 'Earlier response' },
      created_at: '2026-07-20T10:00:01.000Z',
    },
    {
      id: 2,
      kind: 'claude',
      message: 'Claude paused in the relay-9 terminal and may be waiting for your input.',
      payload: { type: 'claude/input-required', provider: 'claude' },
      created_at: '2026-07-20T10:00:02.000Z',
    },
  ];

  assert.deepEqual(latestAgentUpdate(events), {
    text: 'Claude paused in the relay-9 terminal and may be waiting for your input.',
    provider: 'claude',
    createdAt: '2026-07-20T10:00:02.000Z',
  });
});
