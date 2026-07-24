import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TurboPlanCouncilError,
  TurboPlanCouncilReviewer,
  buildTurboPlanCouncilDraftPrompt,
  buildTurboPlanCouncilPrompt,
} from '../src/turbo-plan-council.mjs';

const draft = {
  version: 1,
  summary: 'Draft graph',
  sharedContext: 'Shared worktree',
  tasks: [{
    id: 'inspect',
    title: 'Inspect repository',
    instructions: 'Inspect the repository.',
    dependsOn: [],
    ownedPaths: ['src'],
    verification: ['npm test'],
  }],
};

function reviewed(text = 'Reviewed graph') {
  return {
    version: 1,
    summary: text,
    sharedContext: 'Reviewed shared worktree',
    tasks: [{
      id: 'inspect',
      title: 'Inspect repository',
      instructions: 'Inspect the repository safely.',
      dependsOn: [],
      ownedPaths: ['src'],
      verification: ['npm test'],
    }],
  };
}

function result(summary) {
  return { text: JSON.stringify(reviewed(summary)) };
}

test('Codex-first council prompt contains route, repository context, draft JSON, schema, and attachments', () => {
  const prompt = buildTurboPlanCouncilPrompt({
    task: { prompt: 'Implement the relay scheduler.', repo_path: '/tmp/relay' },
    draftPlan: draft,
    workerCount: 3,
    attachmentPaths: ['/tmp/images/a.png', '/tmp/images/b.jpg'],
  });
  assert.match(prompt, /Codex has already produced the draft graph/);
  assert.match(prompt, /step 02/);
  assert.match(prompt, /Original objective:\nImplement the relay scheduler\./);
  assert.match(prompt, /Repository path:\n\/tmp\/relay/);
  assert.match(prompt, /- \/tmp\/images\/a\.png/);
  assert.match(prompt, /Required worker count:\n3/);
  assert.match(prompt, /Exact Codex draft JSON:/);
  assert.match(prompt, /"summary": "Draft graph"/);
  assert.match(prompt, /"version": 1/);
  assert.match(prompt, /ownedPaths/);
  assert.match(prompt, /Return only the complete corrected JSON object/);
  assert.match(prompt, /Do not edit files/);
});

test('Claude-first draft prompt asks for the initial graph without implementation', () => {
  const prompt = buildTurboPlanCouncilDraftPrompt({
    task: { prompt: 'Build selectable council order.', repo_path: '/tmp/relay' },
    workerCount: 2,
    attachmentPaths: ['/tmp/reference.png'],
  });
  assert.match(prompt, /Claude author stage/);
  assert.match(prompt, /produce the initial execution graph for Codex to review/);
  assert.match(prompt, /Required worker count:\n2/);
  assert.match(prompt, /Do not edit files/);
});

test('draft uses the same serialized Claude queue and returns a validated graph', async () => {
  const calls = [];
  const reviewer = new TurboPlanCouncilReviewer({
    claude: {
      async run(prompt, options) {
        calls.push({ prompt, options });
        return result('Claude authored graph');
      },
      cancel() { return false; },
    },
  });
  const output = await reviewer.draft({
    parentTaskId: 8,
    task: { prompt: 'Draft graph', repo_path: '/workspace/relay' },
    workerCount: 1,
    authorModel: 'sonnet',
    authorEffort: 'high',
  });
  assert.equal(calls[0].options.model, 'sonnet');
  assert.equal(output.plan.summary, 'Claude authored graph');
});

test('review forwards Claude options and events, then returns the parsed corrected graph', async () => {
  const calls = [];
  const events = [];
  const stderr = [];
  const claude = {
    run(prompt, options) {
      calls.push({ prompt, options });
      options.onEvent({ event: { type: 'claude/started' }, message: 'started' });
      options.onStderr('warning');
      return Promise.resolve(result('corrected'));
    },
    cancel() { return false; },
  };
  const reviewer = new TurboPlanCouncilReviewer({ claude });
  const output = await reviewer.review({
    parentTaskId: 12,
    task: {
      id: 12,
      prompt: 'Build the queue.',
      repo_path: '/workspace/relay',
      attachments: [{ path: '/workspace/relay/.data/tasks/12/attachments/a.png' }],
    },
    draftPlan: draft,
    workerCount: 1,
    claudeModel: 'opus',
    claudeEffort: 'high',
    onEvent: (event) => events.push(event),
    onStderr: (line) => stderr.push(line),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.cwd, '/workspace/relay');
  assert.equal(calls[0].options.model, 'opus');
  assert.equal(calls[0].options.effort, 'high');
  assert.deepEqual(calls[0].options.attachmentPaths, ['/workspace/relay/.data/tasks/12/attachments/a.png']);
  assert.equal(events[0].message, 'started');
  assert.deepEqual(stderr, ['warning']);
  assert.equal(output.plan.summary, 'corrected');
  assert.equal(output.finalResponse, output.text);
});

test('reviews run in FIFO order with only one Claude stage active', async () => {
  const starts = [];
  const finishes = [];
  const pending = [];
  const claude = {
    run(prompt) {
      const parent = prompt.match(/task parent (\d+)/)?.[1] || String(starts.length + 1);
      starts.push(parent);
      return new Promise((resolve) => pending.push(() => {
        finishes.push(parent);
        resolve(result(`review-${parent}`));
      }));
    },
    cancel() { return false; },
  };
  const reviewer = new TurboPlanCouncilReviewer({ claude });
  const first = reviewer.review({ parentTaskId: 1, task: { prompt: 'task parent 1' }, draftPlan: draft, workerCount: 1 });
  const second = reviewer.review({ parentTaskId: 2, task: { prompt: 'task parent 2' }, draftPlan: draft, workerCount: 1 });
  assert.deepEqual(starts, ['1']);
  pending.shift()();
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(starts, ['1', '2']);
  pending.shift()();
  await second;
  assert.deepEqual(finishes, ['1', '2']);
});

test('active cancellation targets only the matching parent and advances the FIFO queue', async () => {
  const starts = [];
  const rejectActive = [];
  const claude = {
    run(prompt) {
      const parent = prompt.includes('parent one') ? 1 : 2;
      starts.push(parent);
      if (parent === 1) {
        return new Promise((resolve, reject) => rejectActive.push(() => reject({ cancelled: true, message: 'cancelled' })));
      }
      return Promise.resolve(result('second'));
    },
    cancel() {
      rejectActive.shift()?.();
      return true;
    },
  };
  const reviewer = new TurboPlanCouncilReviewer({ claude });
  const first = reviewer.review({ parentTaskId: 1, task: { prompt: 'parent one' }, draftPlan: draft, workerCount: 1 });
  const second = reviewer.review({ parentTaskId: 2, task: { prompt: 'parent two' }, draftPlan: draft, workerCount: 1 });
  assert.deepEqual(starts, [1]);
  assert.equal(reviewer.cancel(1), true);
  await assert.rejects(first, (error) => error.cancelled === true);
  await second;
  assert.deepEqual(starts, [1, 2]);
});

test('queued cancellation rejects with cancelled=true and does not disturb another parent', async () => {
  let release;
  let calls = 0;
  const claude = {
    run() {
      calls += 1;
      return new Promise((resolve) => { release = () => resolve(result('first')); });
    },
    cancel() { return false; },
  };
  const reviewer = new TurboPlanCouncilReviewer({ claude });
  const first = reviewer.review({ parentTaskId: 1, task: { prompt: 'first' }, draftPlan: draft, workerCount: 1 });
  const second = reviewer.review({ parentTaskId: 2, task: { prompt: 'second' }, draftPlan: draft, workerCount: 1 });
  assert.equal(reviewer.cancel(2), true);
  await assert.rejects(second, (error) => error.cancelled === true);
  release();
  await first;
  assert.equal(calls, 1);
});

test('a failed or synchronous Claude stage does not wedge later reviews', async () => {
  let calls = 0;
  const claude = {
    run() {
      calls += 1;
      if (calls === 1) throw new Error('Claude unavailable');
      return Promise.resolve(result('recovered'));
    },
    cancel() { return false; },
  };
  const reviewer = new TurboPlanCouncilReviewer({ claude });
  const first = reviewer.review({ parentTaskId: 1, task: { prompt: 'first' }, draftPlan: draft, workerCount: 1 });
  const second = reviewer.review({ parentTaskId: 2, task: { prompt: 'second' }, draftPlan: draft, workerCount: 1 });
  await assert.rejects(first, /Claude unavailable/);
  assert.equal((await second).plan.summary, 'recovered');
  assert.equal(calls, 2);
});

test('malformed Claude output fails the review instead of reaching workers', async () => {
  const reviewer = new TurboPlanCouncilReviewer({
    claude: {
      run() { return Promise.resolve({ text: 'not JSON' }); },
      cancel() { return false; },
    },
  });
  await assert.rejects(
    reviewer.review({ parentTaskId: 3, task: { prompt: 'bad graph' }, draftPlan: draft, workerCount: 1 }),
    (error) => error instanceof TurboPlanCouncilError && /invalid Turbo graph JSON/.test(error.message),
  );
});
