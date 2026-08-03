import test from 'node:test';
import assert from 'node:assert/strict';
import { idleExecutionThreadId, runningDirectTask, selectedExecutionProvider, selectedWorkflowMode } from '../public/task-routing.js';

function tab(mode, { selected = false, ariaSelected = selected } = {}) {
  return {
    dataset: { mode },
    classList: { contains: (name) => name === 'selected' && selected },
    getAttribute: (name) => name === 'aria-selected' ? String(ariaSelected) : null,
  };
}

function providerTab(provider, options) {
  const item = tab(undefined, options);
  item.dataset = { provider };
  return item;
}

test('visible Execute selection is authoritative', () => {
  const tabs = [
    tab('execute', { selected: true }),
    tab('turbo'),
  ];
  assert.equal(selectedWorkflowMode(tabs), 'execute');
});

test('workflow selection rejects visual and accessibility state disagreement', () => {
  const tabs = [
    tab('execute', { selected: true, ariaSelected: false }),
    tab('turbo', { selected: false, ariaSelected: true }),
  ];
  assert.throws(() => selectedWorkflowMode(tabs), /out of sync/);
});

test('standalone Plan council is not a selectable workflow', () => {
  assert.throws(() => selectedWorkflowMode([tab('plan', { selected: true })]), /valid workflow/);
});

test('visible Codex provider selection is authoritative', () => {
  const tabs = [
    providerTab('codex', { selected: true }),
    providerTab('claude'),
  ];
  assert.equal(selectedExecutionProvider(tabs), 'codex');
});

test('only Execute tasks count as direct terminal activity', () => {
  const tasks = [
    { id: 132, status: 'running', mode: 'plan', thread_id: 'relay-1' },
    { id: 133, status: 'running', mode: 'execute', provider: 'codex', thread_id: 'relay-2' },
  ];
  assert.equal(runningDirectTask(tasks, 'relay-1'), undefined);
  assert.equal(runningDirectTask(tasks, 'relay-2')?.id, 133);
});

test('idle routing selects an unassigned Codex CC Relay in the same project', () => {
  const threads = [
    { id: 'busy', provider: 'codex', cwd: '/repo', status: 'active' },
    { id: 'free', provider: 'codex', cwd: '/repo', status: 'idle' },
    { id: 'other', provider: 'codex', cwd: '/other', status: 'idle' },
  ];
  const tasks = [{ mode: 'execute', provider: 'codex', status: 'running', thread_id: 'busy' }];
  assert.equal(idleExecutionThreadId({
    threads, tasks, selectedThreadId: 'busy', provider: 'codex', routePath: '/repo', sameProjectPath: (a, b) => a === b,
  }), 'free');
});

test('idle routing does not treat a CC Relay with queued work as free', () => {
  const threads = [
    { id: 'selected', provider: 'codex', cwd: '/repo', status: 'active' },
    { id: 'claimed', provider: 'codex', cwd: '/repo', status: 'idle' },
  ];
  const tasks = [{ mode: 'execute', provider: 'codex', status: 'queued', thread_id: 'claimed' }];
  assert.equal(idleExecutionThreadId({
    threads, tasks, selectedThreadId: 'selected', provider: 'codex', routePath: '/repo', sameProjectPath: (a, b) => a === b,
  }), null);
});

test('idle routing selects an unassigned Claude session without crossing providers', () => {
  const threads = [
    { id: 'busy-claude', provider: 'claude', cwd: '/repo', status: 'active' },
    { id: 'free-claude', provider: 'claude', cwd: '/repo', status: 'idle' },
    { id: 'free-codex', provider: 'codex', cwd: '/repo', status: 'idle' },
  ];
  const tasks = [{ mode: 'execute', provider: 'claude', status: 'running', thread_id: 'busy-claude' }];
  assert.equal(idleExecutionThreadId({
    threads,
    tasks,
    selectedThreadId: 'busy-claude',
    provider: 'claude',
    routePath: '/repo',
    sameProjectPath: (a, b) => a === b,
  }), 'free-claude');
});
