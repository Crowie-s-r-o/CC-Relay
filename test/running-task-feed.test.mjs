import assert from 'node:assert/strict';
import test from 'node:test';
import { latestAgentUpdate, runningTaskFeed } from '../src/running-task-feed.mjs';

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

test('running task feed is global and excludes non-running tasks', () => {
  const tasks = [
    { id: 1, status: 'running', repo_path: '/repo/alpha' },
    { id: 2, status: 'queued', repo_path: '/repo/alpha' },
    { id: 3, status: 'running', repo_path: '/repo/beta' },
  ];
  const events = new Map([
    [1, [{ id: 1, kind: 'codex', payload: { item: { type: 'agentMessage', text: 'Alpha update' } } }]],
    [3, [{ id: 2, kind: 'claude', payload: { type: 'claude/message', text: 'Beta update', provider: 'claude' } }]],
  ]);

  const feed = runningTaskFeed(tasks, (taskId) => events.get(taskId) || []);
  assert.deepEqual(feed.map((task) => [task.id, task.repo_path, task.latestAgentUpdate.text]), [
    [1, '/repo/alpha', 'Alpha update'],
    [3, '/repo/beta', 'Beta update'],
  ]);
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
