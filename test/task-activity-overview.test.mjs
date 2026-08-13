import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { groupEventEntries } from '../public/event-stream.js';
import {
  refreshActivityOverviewDurations,
  taskActivityOverview,
} from '../public/task-activity-overview.js';

const markup = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

function planEvent(plan, overrides = {}) {
  return {
    id: overrides.id || 1,
    kind: 'codex',
    message: 'Updated plan.',
    created_at: overrides.createdAt || '2026-08-13T10:00:00.000Z',
    payload: {
      type: 'turn/plan/updated',
      threadId: 'thread-overview',
      turnId: 'turn-overview',
      planKey: overrides.planKey || 'plan-overview',
      plan,
    },
  };
}

function claudeAgentEvent(phase, overrides = {}) {
  return {
    id: overrides.id || (phase === 'started' ? 2 : 3),
    kind: 'claude',
    message: phase === 'started' ? 'Claude started sub-agent.' : 'Sub-agent is working in the background.',
    created_at: overrides.createdAt || '2026-08-13T10:01:00.000Z',
    payload: {
      type: `item/${phase}`,
      provider: 'claude',
      item: {
        type: 'mcpToolCall',
        id: 'agent-overview',
        server: 'Claude Code',
        tool: 'Agent',
        arguments: {
          description: overrides.name || 'ui_worker',
          subagent_type: 'interface specialist',
          prompt: overrides.prompt || 'Implement the activity overview.',
        },
        status: phase === 'started' ? 'inProgress' : 'completed',
        result: null,
        subAgent: true,
        toolUseId: 'agent-overview',
        agentName: overrides.name || 'ui_worker',
        agentType: 'interface specialist',
        ...(phase === 'completed' ? { backgrounded: true, agentId: 'agent-1' } : {}),
      },
    },
  };
}

function agentFinishedEvent(overrides = {}) {
  return {
    id: overrides.id || 4,
    kind: 'claude',
    message: 'Agent "ui_worker" finished',
    created_at: overrides.createdAt || '2026-08-13T10:04:30.000Z',
    payload: {
      type: 'claude/agent-finished',
      provider: 'claude',
      toolUseId: 'agent-overview',
      agentId: 'agent-1',
      status: overrides.status || 'completed',
      summary: 'Agent "ui_worker" finished',
      agentName: 'ui_worker',
    },
  };
}

test('the task activity manifest is expanded by default and uses a native compact toggle', () => {
  assert.match(markup, /<details id="event-overview" class="event-overview" open>/);
  assert.match(markup, /<summary class="event-overview-summary">/);
  assert.match(markup, /id="event-metrics"[\s\S]*?Minimize[\s\S]*?Show details[\s\S]*?id="event-overview-body"/);
  assert.match(app, /const overview = taskActivityOverview\(grouped, task\);/);
  assert.match(app, /elements\.eventOverviewBody\.innerHTML = overview\.body;/);
  assert.match(style, /\.event-overview:not\(\[open\]\) \.event-overview-toggle-closed \{ display: inline; \}/);
});

test('the expanded manifest shows runtime, plan task states, and live sub-agent work', () => {
  const events = [
    planEvent([
      { step: 'Inspect the current header', status: 'completed' },
      { step: 'Build the visible overview', status: 'inProgress', owner: 'ui_worker' },
      { step: 'Verify compact mode', status: 'pending' },
    ]),
    claudeAgentEvent('started'),
    claudeAgentEvent('completed'),
  ];
  const overview = taskActivityOverview(groupEventEntries(events), {
    status: 'running',
    started_at: '2026-08-13T10:00:00.000Z',
  }, new Date('2026-08-13T10:05:00.000Z').getTime());

  assert.match(overview.runtimeMetric, />5m 00s<\/time><\/b><small>running<\/small>/);
  assert.match(overview.body, /Plan<\/h3>[\s\S]*?1 of 3 complete/);
  assert.match(overview.body, /data-activity-state="completed"[\s\S]*?Inspect the current header[\s\S]*?Complete/);
  assert.match(overview.body, /data-activity-state="inProgress"[\s\S]*?Build the visible overview[\s\S]*?ui_worker[\s\S]*?In progress/);
  assert.match(overview.body, /data-activity-state="pending"[\s\S]*?Verify compact mode[\s\S]*?Pending/);
  assert.match(overview.body, /Sub-agents<\/h3>[\s\S]*?1 active · 1 total/);
  assert.match(overview.body, /ui_worker[\s\S]*?Implement the activity overview\.[\s\S]*?In background[\s\S]*?4m 00s/);
});

test('finished workers show their outcome and frozen elapsed time', () => {
  const entries = groupEventEntries([
    claudeAgentEvent('started'),
    claudeAgentEvent('completed'),
    agentFinishedEvent(),
  ]);
  const overview = taskActivityOverview(entries, {
    status: 'running',
    started_at: '2026-08-13T10:00:00.000Z',
  }, new Date('2026-08-13T10:10:00.000Z').getTime());

  assert.match(overview.body, /data-activity-state="finished"/);
  assert.match(overview.body, /Finished[\s\S]*?3m 30s/);
  assert.match(overview.body, /1 recorded/);
  assert.doesNotMatch(overview.body, /1 active/);
});

test('the board shows the most recently revised plan, not the last row created', () => {
  const entries = groupEventEntries([
    planEvent([{ step: 'First plan, old revision', status: 'pending' }], {
      id: 1,
      planKey: 'first-plan',
    }),
    planEvent([{ step: 'Second plan', status: 'inProgress' }], {
      id: 2,
      planKey: 'second-plan',
    }),
    planEvent([{ step: 'First plan, newest revision', status: 'completed' }], {
      id: 3,
      planKey: 'first-plan',
    }),
  ]);
  const overview = taskActivityOverview(entries, {
    status: 'running',
    started_at: '2026-08-13T10:00:00.000Z',
  });

  assert.match(overview.body, /First plan, newest revision/);
  assert.doesNotMatch(overview.body, /Second plan/);
  assert.match(overview.body, /1 of 1 complete/);
});

test('a task that ended cannot leave a plan step or worker looking live', () => {
  const entries = groupEventEntries([
    planEvent([{ step: 'Work that did not finish', status: 'inProgress' }]),
    claudeAgentEvent('started', { createdAt: '2026-08-13T10:02:00.000Z' }),
    claudeAgentEvent('completed', { createdAt: '2026-08-13T10:02:01.000Z' }),
  ]);
  const overview = taskActivityOverview(entries, {
    status: 'failed',
    started_at: '2026-08-13T10:00:00.000Z',
    finished_at: '2026-08-13T10:10:00.000Z',
  }, new Date('2026-08-13T10:30:00.000Z').getTime());

  assert.match(overview.runtimeMetric, />10m 00s<\/time><\/b><small>duration<\/small>/);
  assert.equal((overview.body.match(/data-activity-state="unfinished"/g) || []).length, 2);
  assert.equal((overview.body.match(/>Unfinished<\/span>/g) || []).length, 2);
  assert.match(overview.body, /8m 00s/);
  assert.doesNotMatch(overview.body, />Running<|>In background</);
});

test('provider-controlled task text stays escaped and bounded in the overview', () => {
  const attack = '"/><img src=x onerror=alert(1)>';
  const entries = groupEventEntries([
    planEvent([{ step: attack, status: 'inProgress', owner: attack }]),
    claudeAgentEvent('started', { name: attack, prompt: attack }),
    claudeAgentEvent('completed', { name: attack, prompt: attack }),
  ]);
  const overview = taskActivityOverview(entries, {
    status: 'running',
    started_at: '2026-08-13T10:00:00.000Z',
  });

  assert.doesNotMatch(overview.body, /<img/);
  assert.match(overview.body, /&quot;\/&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('the one-second refresh updates live overview durations without rebuilding the board', () => {
  const live = {
    dataset: {
      startedAt: '2026-08-13T10:00:00.000Z',
      finishedAt: '',
    },
    textContent: '',
  };
  const frozen = {
    dataset: {
      startedAt: '2026-08-13T10:00:00.000Z',
      finishedAt: '2026-08-13T10:01:05.000Z',
    },
    textContent: '',
  };
  refreshActivityOverviewDurations({
    querySelectorAll: () => [live, frozen],
  }, new Date('2026-08-13T10:02:03.000Z').getTime());

  assert.equal(live.textContent, '2m 03s');
  assert.equal(frozen.textContent, '1m 05s');
});

test('the manifest has bounded scrolling, state cues, and a compact container layout', () => {
  assert.match(style, /\.event-overview-body \{[\s\S]*?max-height: min\(34vh, 320px\);[\s\S]*?overflow: auto;/);
  assert.match(style, /data-activity-state="running"[\s\S]*?color: var\(--term-cyan\)/);
  assert.match(style, /data-activity-state="unfinished"[\s\S]*?color: var\(--term-amber\)/);
  assert.match(style, /data-activity-state="attention"[\s\S]*?color: var\(--term-red\)/);
  assert.match(style, /@container \(max-width: 440px\) \{[\s\S]*?grid-template-columns: 16px minmax\(0, 1fr\);/);
});
