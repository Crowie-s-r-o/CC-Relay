import assert from 'node:assert/strict';
import test from 'node:test';
import {
  breakdownInProgress,
  breakdownUpdateForTask,
  buildBreakdownPrompt,
  ensureUniqueProposalIds,
  normalizeProposals,
  parseBreakdownProposals,
} from '../src/plan-breakdown.mjs';

test('buildBreakdownPrompt includes the plan, repository, guidance, and JSON contract', () => {
  const prompt = buildBreakdownPrompt({
    plan: { name: 'Auth revamp', content: 'Replace the session cookie flow.', repo_path: '/repo/app' },
    guidance: 'Prefer small, independent tasks.',
  });
  assert.match(prompt, /Auth revamp/);
  assert.match(prompt, /Replace the session cookie flow\./);
  assert.match(prompt, /\/repo\/app/);
  assert.match(prompt, /Prefer small, independent tasks\./);
  assert.match(prompt, /"tasks":\[\{"id"/);
  assert.match(prompt, /"dependsOn"/);
  assert.match(prompt, /do not edit files/);
});

test('buildBreakdownPrompt tolerates an empty plan and missing guidance', () => {
  const prompt = buildBreakdownPrompt({ plan: { name: '', content: '' } });
  assert.match(prompt, /Untitled plan/);
  assert.match(prompt, /\(the saved plan is empty\)/);
  assert.doesNotMatch(prompt, /Additional guidance/);
});

test('parseBreakdownProposals reads a plain JSON object', () => {
  const proposals = parseBreakdownProposals('{"tasks":[{"title":"One","prompt":"Do one"},{"title":"Two","prompt":"Do two"}]}');
  assert.equal(proposals.length, 2);
  assert.equal(proposals[0].title, 'One');
  assert.equal(proposals[0].prompt, 'Do one');
  assert.ok(proposals[0].id && proposals[1].id && proposals[0].id !== proposals[1].id);
});

test('parseBreakdownProposals strips a fenced code block', () => {
  const raw = 'Here is the breakdown:\n```json\n{"tasks":[{"title":"A","prompt":"Build A"}]}\n```\nDone.';
  const proposals = parseBreakdownProposals(raw);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].prompt, 'Build A');
});

test('parseBreakdownProposals extracts an object embedded in prose', () => {
  const raw = 'Sure, here you go: {"tasks":[{"title":"X","prompt":"Ship X"}]} let me know.';
  const proposals = parseBreakdownProposals(raw);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].title, 'X');
});

test('parseBreakdownProposals accepts a bare array and alternate keys', () => {
  assert.equal(parseBreakdownProposals('[{"title":"A","prompt":"a"}]').length, 1);
  const alt = parseBreakdownProposals('{"proposals":[{"name":"Named","instructions":"do it"}]}');
  assert.equal(alt.length, 1);
  assert.equal(alt[0].title, 'Named');
  assert.equal(alt[0].prompt, 'do it');
});

test('parseBreakdownProposals derives a title when only a prompt is present', () => {
  const proposals = parseBreakdownProposals('{"tasks":[{"prompt":"Refactor the queue scheduler to be reentrant"}]}');
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].title, 'Refactor the queue scheduler to be reentrant');
});

test('parseBreakdownProposals returns empty for unparseable output', () => {
  assert.deepEqual(parseBreakdownProposals('I could not do that.'), []);
  assert.deepEqual(parseBreakdownProposals(''), []);
  assert.deepEqual(parseBreakdownProposals('{"tasks":[]}'), []);
  assert.deepEqual(parseBreakdownProposals('{"tasks":[{"title":"no prompt"}]}'), []);
});

test('normalizeProposals skips invalid entries but keeps valid ones', () => {
  const proposals = normalizeProposals([
    { title: 'Good', prompt: 'valid' },
    null,
    'string',
    { title: 'Missing prompt' },
    { prompt: '   ' },
    { title: 'Second', prompt: 'also valid' },
  ]);
  assert.equal(proposals.length, 2);
  assert.deepEqual(proposals.map((item) => item.title), ['Good', 'Second']);
});

test('breakdownUpdateForTask reconciles pending -> running -> complete with parsed proposals', () => {
  const breakdown = { status: 'pending' };
  const runningTask = { status: 'running', result: null };
  const runningChange = breakdownUpdateForTask(runningTask, breakdown);
  assert.deepEqual(runningChange, { status: 'running' });

  const completeTask = { status: 'complete', result: '{"tasks":[{"title":"T","prompt":"p"}]}' };
  const completeChange = breakdownUpdateForTask(completeTask, { status: 'running' });
  assert.equal(completeChange.status, 'complete');
  assert.equal(completeChange.parsed, 1);
  assert.match(completeChange.proposals_json, /"title":"T"/);
  assert.equal(completeChange.error, null);
});

test('breakdownUpdateForTask marks complete-but-unparseable as parsed 0 with the raw response', () => {
  const change = breakdownUpdateForTask(
    { status: 'complete', result: 'sorry, no JSON here' },
    { status: 'running' },
  );
  assert.equal(change.status, 'complete');
  assert.equal(change.parsed, 0);
  assert.equal(change.proposals_json, '[]');
  assert.equal(change.raw_response, 'sorry, no JSON here');
});

test('breakdownUpdateForTask does not rewrite proposals once complete (preserves user edits)', () => {
  const change = breakdownUpdateForTask(
    { status: 'complete', result: '{"tasks":[{"title":"fresh","prompt":"p"}]}' },
    { status: 'complete', proposals_json: '[{"id":"1","title":"edited","prompt":"kept"}]' },
  );
  assert.equal(change, null);
});

test('breakdownUpdateForTask self-heals a failed breakdown that later completes on retry', () => {
  // failure recorded
  const failedChange = breakdownUpdateForTask(
    { status: 'failed', error: 'session dropped' },
    { status: 'running' },
  );
  assert.equal(failedChange.status, 'failed');
  assert.equal(failedChange.error, 'session dropped');

  // auto-retry re-runs the same task: failed -> running clears the stale error
  const rerunChange = breakdownUpdateForTask({ status: 'running' }, { status: 'failed' });
  assert.deepEqual(rerunChange, { status: 'running', error: null });

  // then the retry completes and populates proposals despite the earlier failure
  const completeChange = breakdownUpdateForTask(
    { status: 'complete', result: '{"tasks":[{"title":"ok","prompt":"done"}]}' },
    { status: 'running' },
  );
  assert.equal(completeChange.status, 'complete');
  assert.equal(completeChange.parsed, 1);
});

test('breakdownUpdateForTask maps cancelled and interrupted terminal states', () => {
  const cancelled = breakdownUpdateForTask({ status: 'cancelled', error: 'stopped' }, { status: 'running' });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.error, 'stopped');

  const interrupted = breakdownUpdateForTask({ status: 'interrupted', error: 'relay stopped' }, { status: 'running' });
  assert.equal(interrupted.status, 'failed');
});

test('breakdownUpdateForTask returns null when nothing changes', () => {
  assert.equal(breakdownUpdateForTask({ status: 'running' }, { status: 'running' }), null);
  assert.equal(breakdownUpdateForTask(null, { status: 'running' }), null);
  assert.equal(breakdownUpdateForTask({ status: 'running' }, null), null);
});

test('ensureUniqueProposalIds regenerates duplicate and blank ids (Finding 25)', () => {
  const result = ensureUniqueProposalIds([
    { id: 'dup', title: 'A', prompt: 'a' },
    { id: 'dup', title: 'B', prompt: 'b' },
    { id: '   ', title: 'C', prompt: 'c' },
    { title: 'D', prompt: 'd' },
  ]);
  const ids = result.map((item) => item.id);
  assert.equal(new Set(ids).size, 4, 'every id is unique');
  assert.equal(ids[0], 'dup', 'the first occurrence keeps its id');
  assert.notEqual(ids[1], 'dup', 'the colliding id is regenerated');
  assert.ok(ids.every((id) => typeof id === 'string' && id.trim()));
  // titles and prompts are preserved
  assert.deepEqual(result.map((item) => item.title), ['A', 'B', 'C', 'D']);
});

test('breakdownInProgress treats the retry window and live tasks as in progress (Finding 23)', () => {
  assert.equal(breakdownInProgress({ status: 'pending' }), true);
  assert.equal(breakdownInProgress({ status: 'running' }), true);
  // failed row, but the linked task is scheduled for an automatic retry
  assert.equal(breakdownInProgress({ status: 'failed' }, { retryScheduled: true }), true);
  // failed row whose retry has re-queued or restarted the task
  assert.equal(breakdownInProgress({ status: 'failed' }, { taskStatus: 'queued' }), true);
  assert.equal(breakdownInProgress({ status: 'failed' }, { taskStatus: 'running' }), true);
  // genuinely finished: complete, or failed with no retry pending
  assert.equal(breakdownInProgress({ status: 'complete' }), false);
  assert.equal(breakdownInProgress({ status: 'failed' }, { retryScheduled: false, taskStatus: 'failed' }), false);
  assert.equal(breakdownInProgress(null), false);
});
