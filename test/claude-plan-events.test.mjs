import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeClaudeStreamMessage } from '../src/claude-execution-runner.mjs';

// Record shapes below follow real Claude Code 2.1.228 task-board traffic: `TaskCreate` reports
// the new id only in its result, `TaskUpdate` sends just the fields that changed, and a rejected
// update answers with an ordinary result that carries `success: false`. Subjects, owners, and
// identifiers are synthetic.

// Claude mirrors its board to ~/.claude/tasks/<sessionId>/<n>.json. Every context injects a
// board source so no unit test can reach the real home directory, and so "there is no mirrored
// board" is stated by the test rather than left to whatever the machine happens to hold.
function missingBoardDirectory() {
  const readdirSync = (path) => {
    const error = new Error(`ENOENT: no such file or directory, scandir '${path}'`);
    error.code = 'ENOENT';
    throw error;
  };
  return {
    home: '/tmp/home',
    readdirSync,
    readFileSync: readdirSync,
    calls: [],
  };
}

// Files is a map of file name to raw file text, so a test can hand over malformed JSON or an
// unreadable file the same way the real directory would.
function boardDirectory(files, { home = '/tmp/home', sessionId = 'session-one' } = {}) {
  const calls = [];
  const directory = `${home}/.claude/tasks/${sessionId}`;
  return {
    home,
    calls,
    readdirSync(path) {
      calls.push(path);
      if (path !== directory) {
        const error = new Error(`ENOENT: no such file or directory, scandir '${path}'`);
        error.code = 'ENOENT';
        throw error;
      }
      return Object.keys(files);
    },
    readFileSync(path) {
      calls.push(path);
      const name = path.slice(directory.length + 1);
      const contents = Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null;
      if (typeof contents !== 'string') {
        const error = new Error(`EACCES: permission denied, open '${path}'`);
        error.code = 'EACCES';
        throw error;
      }
      return contents;
    },
  };
}

// One mirrored task file, in the real on-disk shape.
function boardFile({ id, subject, activeForm = '', owner = '', status = 'pending' }) {
  return JSON.stringify({
    id,
    subject,
    description: 'Synthetic briefing.',
    activeForm,
    owner,
    status,
    blocks: [],
    blockedBy: [],
  });
}

function turnContext(overrides = {}) {
  return {
    cwd: '/tmp/repo',
    tools: new Map(),
    finalResponse: '',
    sessionId: 'session-one',
    error: null,
    planBoardIO: missingBoardDirectory(),
    ...overrides,
  };
}

function toolUse(id, name, input) {
  return { type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } };
}

function toolResult(id, content, toolUseResult) {
  const record = {
    type: 'user',
    message: { content: [{ tool_use_id: id, type: 'tool_result', content }] },
  };
  if (toolUseResult !== undefined) {
    record.toolUseResult = toolUseResult;
  }
  return record;
}

function plans(emitted) {
  return emitted.filter((entry) => entry.event?.type === 'claude/plan');
}

// Runs one full board tool call and returns only the plan events its result produced.
function boardCall(context, { id, name, input, text = '', result }) {
  consumeClaudeStreamMessage(toolUse(id, name, input), context);
  return plans(consumeClaudeStreamMessage(toolResult(id, text, result), context));
}

function create(context, { id, taskId, subject, activeForm, owner }) {
  return boardCall(context, {
    id,
    name: 'TaskCreate',
    input: { subject, description: 'Synthetic briefing.', ...(activeForm ? { activeForm } : {}), ...(owner ? { owner } : {}) },
    text: `Task #${taskId} created successfully: ${subject}`,
    result: { task: { id: taskId, subject } },
  });
}

function update(context, { id, input, updatedFields = ['status'] }) {
  return boardCall(context, {
    id,
    name: 'TaskUpdate',
    input,
    text: `Updated task #${input.taskId} ${updatedFields.join(', ')}`,
    result: { success: true, taskId: input.taskId, updatedFields },
  });
}

test('a created and started task folds into one provider-neutral plan event', () => {
  const context = turnContext();

  const [created] = create(context, {
    id: 'toolu_planA',
    taskId: '1',
    subject: 'Add the widget parser',
    activeForm: 'Adding the widget parser',
  });
  assert.deepEqual(created.event, {
    type: 'claude/plan',
    provider: 'claude',
    planKey: 'session-one',
    explanation: '',
    plan: [{ step: 'Add the widget parser', status: 'pending', owner: '' }],
  });
  assert.equal(created.message, 'Claude updated its plan (0/1 steps done).');

  const [started] = update(context, {
    id: 'toolu_planB',
    input: { taskId: '1', owner: 'dev-1', status: 'in_progress' },
    updatedFields: ['owner', 'status'],
  });
  // `activeForm` only ever arrives on the create, so the board has to keep it to explain the
  // step that is running now.
  assert.equal(started.event.explanation, 'Adding the widget parser');
  assert.deepEqual(started.event.plan, [
    { step: 'Add the widget parser', status: 'inProgress', owner: 'dev-1' },
  ]);

  const [finished] = update(context, { id: 'toolu_planC', input: { taskId: '1', status: 'completed' } });
  assert.deepEqual(finished.event.plan, [
    { step: 'Add the widget parser', status: 'completed', owner: 'dev-1' },
  ]);
  assert.equal(finished.event.explanation, '');
  assert.equal(finished.message, 'Claude updated its plan (1/1 steps done).');
});

test('the created task id is read from the result text when no result object exists', () => {
  const context = turnContext();
  // The headless stream-json path carries the tool result text and nothing else.
  const [created] = boardCall(context, {
    id: 'toolu_planA',
    name: 'TaskCreate',
    input: { subject: 'Ship the parser', activeForm: 'Shipping the parser' },
    text: 'Task #7 created successfully: Ship the parser',
  });
  assert.deepEqual(created.event.plan, [{ step: 'Ship the parser', status: 'pending', owner: '' }]);

  // The id parsed from that text is the one a later partial update names.
  const [started] = boardCall(context, {
    id: 'toolu_planB',
    name: 'TaskUpdate',
    input: { taskId: '7', status: 'in_progress' },
    text: 'Updated task #7 status',
  });
  assert.deepEqual(started.event.plan, [{ step: 'Ship the parser', status: 'inProgress', owner: '' }]);
  assert.equal(started.event.explanation, 'Shipping the parser');
});

test('a partial update leaves every field it did not send untouched', () => {
  const context = turnContext();
  create(context, {
    id: 'toolu_planA',
    taskId: '1',
    subject: 'Add the widget parser',
    activeForm: 'Adding the widget parser',
  });
  update(context, { id: 'toolu_planB', input: { taskId: '1', owner: 'dev-1', status: 'in_progress' }, updatedFields: ['owner', 'status'] });

  // Real traffic sends owner-only edits like `{"taskId":"2","addBlockedBy":["1"],"owner":"..."}`.
  const [reassigned] = update(context, {
    id: 'toolu_planC',
    input: { taskId: '1', addBlockedBy: ['2'], owner: 'dev-2' },
    updatedFields: ['owner', 'blockedBy'],
  });
  assert.deepEqual(reassigned.event.plan, [
    { step: 'Add the widget parser', status: 'inProgress', owner: 'dev-2' },
  ]);
  assert.equal(reassigned.event.explanation, 'Adding the widget parser');

  // A status-only edit keeps the owner and the subject the create established.
  const [finished] = update(context, { id: 'toolu_planD', input: { taskId: '1', status: 'completed' } });
  assert.deepEqual(finished.event.plan, [
    { step: 'Add the widget parser', status: 'completed', owner: 'dev-2' },
  ]);
});

test('a deleted task leaves the board and an emptied board reports nothing', () => {
  const context = turnContext();
  create(context, { id: 'toolu_planA', taskId: '1', subject: 'Add the widget parser' });
  create(context, { id: 'toolu_planB', taskId: '2', subject: 'Review the widget parser' });

  const [dropped] = update(context, { id: 'toolu_planC', input: { taskId: '2', status: 'deleted' } });
  assert.deepEqual(dropped.event.plan, [
    { step: 'Add the widget parser', status: 'pending', owner: '' },
  ]);

  // The last step leaving empties the board, and an empty plan is not worth an event.
  assert.deepEqual(update(context, { id: 'toolu_planD', input: { taskId: '1', status: 'deleted' } }), []);
  assert.equal(context.planBoard.size, 0);

  // A board that fills again still reports, so the emptied state cannot latch.
  const [refilled] = create(context, { id: 'toolu_planE', taskId: '3', subject: 'Rewrite the widget parser' });
  assert.deepEqual(refilled.event.plan, [
    { step: 'Rewrite the widget parser', status: 'pending', owner: '' },
  ]);
});

test('an unrecognized status normalizes to pending', () => {
  const context = turnContext();
  create(context, { id: 'toolu_planA', taskId: '1', subject: 'Add the widget parser' });
  update(context, { id: 'toolu_planB', input: { taskId: '1', status: 'completed' } });

  const [odd] = update(context, { id: 'toolu_planC', input: { taskId: '1', status: 'blocked_on_review' } });
  assert.deepEqual(odd.event.plan, [{ step: 'Add the widget parser', status: 'pending', owner: '' }]);

  // Provider data is untrusted, so a non-string status is normalized the same way.
  const [malformed] = update(context, { id: 'toolu_planD', input: { taskId: '1', status: 17 } });
  assert.equal(malformed, undefined);
  assert.deepEqual(context.planBoard.get('1').status, 'pending');
});

test('a rejected update never moves the board', () => {
  const context = turnContext();
  create(context, { id: 'toolu_planA', taskId: '1', subject: 'Add the widget parser' });
  update(context, { id: 'toolu_planB', input: { taskId: '1', status: 'in_progress' } });

  // Verbatim shape of the real August 12 rejection: an ordinary result, no `is_error`.
  const rejected = boardCall(context, {
    id: 'toolu_planC',
    name: 'TaskUpdate',
    input: { taskId: '1', status: 'completed' },
    text: 'Task not found',
    result: { success: false, taskId: '1', updatedFields: [], error: 'Task not found' },
  });
  assert.deepEqual(rejected, []);
  assert.equal(context.planBoard.get('1').status, 'inProgress');

  // A refusal that reports only the flag, with no error text to fall back on, counts too.
  const flagged = boardCall(context, {
    id: 'toolu_planD',
    name: 'TaskUpdate',
    input: { taskId: '1', status: 'completed' },
    text: 'Updated task #1 status',
    result: { success: false, taskId: '1', updatedFields: [] },
  });
  assert.deepEqual(flagged, []);
  assert.equal(context.planBoard.get('1').status, 'inProgress');

  // The headless path sees only that text, and must reach the same conclusion.
  const textOnly = boardCall(context, {
    id: 'toolu_planE',
    name: 'TaskUpdate',
    input: { taskId: '1', status: 'completed' },
    text: 'Task not found',
  });
  assert.deepEqual(textOnly, []);
  assert.equal(context.planBoard.get('1').status, 'inProgress');

  // A create the CLI refused outright must not add a step either.
  consumeClaudeStreamMessage(toolUse('toolu_planF', 'TaskCreate', { subject: 'Never created' }), context);
  const failed = plans(consumeClaudeStreamMessage({
    type: 'user',
    message: {
      content: [{
        tool_use_id: 'toolu_planF', type: 'tool_result', content: 'Board is locked', is_error: true,
      }],
    },
  }, context));
  assert.deepEqual(failed, []);
  assert.equal(context.planBoard.size, 1);
});

test('an update for a task this turn never saw created is ignored', () => {
  const context = turnContext();
  create(context, { id: 'toolu_planA', taskId: '1', subject: 'Add the widget parser' });

  // The step exists on Claude's board but not in this turn's fold, so there is no readable
  // subject to show. Reading the tasks directory is the documented fallback for that.
  const orphan = update(context, { id: 'toolu_planB', input: { taskId: '9', status: 'in_progress' } });
  assert.deepEqual(orphan, []);
  assert.equal(context.planBoard.size, 1);
});

test('TodoWrite replaces the whole board', () => {
  const context = turnContext();
  create(context, { id: 'toolu_planA', taskId: '1', subject: 'Add the widget parser' });

  const [replaced] = boardCall(context, {
    id: 'toolu_planB',
    name: 'TodoWrite',
    input: {
      todos: [
        { content: 'Read the parser', status: 'completed', activeForm: 'Reading the parser' },
        { content: 'Rewrite the parser', status: 'in_progress', activeForm: 'Rewriting the parser' },
        { content: 'Test the parser', status: 'pending', activeForm: 'Testing the parser' },
      ],
    },
    text: 'Todos have been modified successfully.',
  });
  assert.deepEqual(replaced.event.plan, [
    { step: 'Read the parser', status: 'completed', owner: '' },
    { step: 'Rewrite the parser', status: 'inProgress', owner: '' },
    { step: 'Test the parser', status: 'pending', owner: '' },
  ]);
  assert.equal(replaced.event.explanation, 'Rewriting the parser');
  assert.equal(replaced.message, 'Claude updated its plan (1/3 steps done).');

  // A malformed list is data, not a crash, and it replaces the board just the same.
  const emptied = boardCall(context, {
    id: 'toolu_planC',
    name: 'TodoWrite',
    input: { todos: 'all done' },
    text: 'Todos have been modified successfully.',
  });
  assert.deepEqual(emptied, []);
  assert.equal(context.planBoard.size, 0);
});

test('reads never mutate the board and never repeat a plan', () => {
  const context = turnContext();
  create(context, { id: 'toolu_planA', taskId: '1', subject: 'Add the widget parser' });

  const listed = boardCall(context, {
    id: 'toolu_planB',
    name: 'TaskList',
    input: {},
    text: '#1 [pending] Add the widget parser',
    result: { tasks: [{ id: '1', subject: 'Add the widget parser', status: 'pending', blockedBy: [] }] },
  });
  assert.deepEqual(listed, []);

  const fetched = boardCall(context, {
    id: 'toolu_planC',
    name: 'TaskGet',
    input: { taskId: '1' },
    text: '#1 [pending] Add the widget parser',
    result: { task: { id: '1', subject: 'Add the widget parser', status: 'pending' } },
  });
  assert.deepEqual(fetched, []);
  assert.deepEqual(context.planBoard.get('1'), {
    step: 'Add the widget parser', status: 'pending', owner: '', activeForm: '',
  });

  // A repeated write that changes nothing is not news either.
  const repeated = update(context, { id: 'toolu_planD', input: { taskId: '1', status: 'pending' } });
  assert.deepEqual(repeated, []);
});

test('a read on an empty board emits nothing at all', () => {
  const context = turnContext();
  const listed = boardCall(context, {
    id: 'toolu_planA',
    name: 'TaskList',
    input: {},
    text: 'No tasks',
    result: { tasks: [] },
  });
  assert.deepEqual(listed, []);
  assert.equal(context.planSignature, undefined);
});

test('the plan reads in task order however the updates arrive', () => {
  const context = turnContext();
  create(context, { id: 'toolu_planA', taskId: '10', subject: 'Tenth step' });
  create(context, { id: 'toolu_planB', taskId: '2', subject: 'Second step' });
  const [ordered] = create(context, { id: 'toolu_planC', taskId: '9', subject: 'Ninth step' });

  assert.deepEqual(ordered.event.plan.map((entry) => entry.step), [
    'Second step', 'Ninth step', 'Tenth step',
  ]);
});

test('a numeric task id still finds its step', () => {
  const context = turnContext();
  create(context, { id: 'toolu_planA', taskId: '1', subject: 'Add the widget parser' });

  const [started] = boardCall(context, {
    id: 'toolu_planB',
    name: 'TaskUpdate',
    input: { taskId: 1, status: 'in_progress' },
    text: 'Updated task #1 status',
    result: { success: true, taskId: 1, updatedFields: ['status'] },
  });
  assert.deepEqual(started.event.plan, [
    { step: 'Add the widget parser', status: 'inProgress', owner: '' },
  ]);
});

test('board tool calls are marked for quiet rendering and ordinary tools are not', () => {
  const context = turnContext();
  for (const name of ['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TodoWrite']) {
    const [started] = consumeClaudeStreamMessage(toolUse(`toolu_${name}`, name, {}), context);
    // The envelope older consumers and stored events depend on is unchanged.
    assert.equal(started.event.item.type, 'mcpToolCall');
    assert.equal(started.event.item.server, 'Claude Code');
    assert.equal(started.event.item.tool, name);
    assert.equal(started.event.item.planTool, true);
    assert.equal(started.event.item.planToolName, name);
  }

  const [ordinary] = consumeClaudeStreamMessage(
    toolUse('toolu_read', 'Read', { file_path: '/tmp/repo/widget.js' }),
    context,
  );
  assert.equal(ordinary.event.item.type, 'mcpToolCall');
  assert.equal(ordinary.event.item.planTool, undefined);
  assert.equal(ordinary.event.item.planToolName, undefined);

  const [edited] = consumeClaudeStreamMessage(
    toolUse('toolu_write', 'Write', { file_path: '/tmp/repo/widget.js' }),
    context,
  );
  assert.equal(edited.event.item.type, 'fileChange');
  assert.equal(edited.event.item.planTool, undefined);
});

test('the plan event follows the tool row it was folded from', () => {
  const context = turnContext();
  consumeClaudeStreamMessage(toolUse('toolu_planA', 'TaskCreate', { subject: 'Add the widget parser' }), context);
  const emitted = consumeClaudeStreamMessage(
    toolResult('toolu_planA', 'Task #1 created successfully: Add the widget parser', { task: { id: '1', subject: 'Add the widget parser' } }),
    context,
  );
  assert.deepEqual(emitted.map((entry) => entry.event.type), ['item/completed', 'claude/plan']);
});

test('the plan key falls back to the task when a turn reports no session', () => {
  const context = turnContext({ sessionId: '', taskId: 42 });
  const [created] = create(context, { id: 'toolu_planA', taskId: '1', subject: 'Add the widget parser' });
  assert.equal(created.event.planKey, 'task-42');

  const anonymous = turnContext({ sessionId: null, taskId: null });
  const [fallback] = create(anonymous, { id: 'toolu_planB', taskId: '1', subject: 'Add the widget parser' });
  assert.equal(fallback.event.planKey, 'claude-plan');
});

test('a create with no readable subject still shows a step', () => {
  const context = turnContext();
  const [created] = boardCall(context, {
    id: 'toolu_planA',
    name: 'TaskCreate',
    input: { activeForm: 'Doing the unnamed work' },
    text: 'Task #1 created successfully:',
    result: { task: { id: '1' } },
  });
  assert.deepEqual(created.event.plan, [
    { step: 'Doing the unnamed work', status: 'pending', owner: '' },
  ]);

  // Neither a result object nor a parsable id leaves a deterministic synthetic id behind.
  const bare = turnContext();
  const [synthetic] = boardCall(bare, {
    id: 'toolu_planZ',
    name: 'TaskCreate',
    input: {},
    text: 'created',
  });
  assert.deepEqual(synthetic.event.plan, [{ step: 'Task tool-toolu_planZ', status: 'pending', owner: '' }]);
  assert.ok(bare.planBoard.has('tool-toolu_planZ'));
});

// --- The mirrored board directory -------------------------------------------------------
//
// The fold above sees only the calls one turn made. A continuation turn resumes a board that
// already has steps on it, so the directory Claude mirrors to ~/.claude/tasks/<sessionId>/ is
// the authoritative source and the fold is the fallback for when it cannot be read.

const CONTINUATION_BOARD = {
  '.lock': '',
  '.highwatermark': '3',
  '1.json': boardFile({
    id: '1', subject: 'Compact the panel header', owner: 'dev-1', status: 'completed',
  }),
  '2.json': boardFile({
    id: '2',
    subject: 'Rewrite the worker fleet control',
    activeForm: 'Rewriting the worker fleet control',
    owner: 'dev-2',
    status: 'in_progress',
  }),
  '3.json': boardFile({ id: '3', subject: 'Review both themes', owner: 'dev-3' }),
};

test('a continuation turn that only updates earlier ids reports the whole board', () => {
  const context = turnContext({ planBoardIO: boardDirectory(CONTINUATION_BOARD) });

  // Nothing was created in this turn, so the fold alone knows nothing about task 2 and would
  // emit no plan event at all. That silence left the previous turn's board rendering as live.
  const [started] = update(context, {
    id: 'toolu_planA',
    input: { taskId: '2', status: 'in_progress' },
  });
  assert.deepEqual(started.event.plan, [
    { step: 'Compact the panel header', status: 'completed', owner: 'dev-1' },
    { step: 'Rewrite the worker fleet control', status: 'inProgress', owner: 'dev-2' },
    { step: 'Review both themes', status: 'pending', owner: 'dev-3' },
  ]);
  assert.equal(started.event.explanation, 'Rewriting the worker fleet control');
  assert.equal(started.message, 'Claude updated its plan (1/3 steps done).');
  assert.equal(started.event.planKey, 'session-one');
});

test('a continuation turn that creates one task does not shrink the board to that task', () => {
  const context = turnContext({
    planBoardIO: boardDirectory({
      ...CONTINUATION_BOARD,
      '.highwatermark': '4',
      '4.json': boardFile({ id: '4', subject: 'Add the fourth step', owner: 'dev-4' }),
    }),
  });

  // The fold would report a one-step board here, and the renderer folds by planKey, so the
  // three steps already on screen would be replaced by this single new one.
  const [created] = create(context, { id: 'toolu_planA', taskId: '4', subject: 'Add the fourth step' });
  assert.deepEqual(created.event.plan.map((entry) => entry.step), [
    'Compact the panel header',
    'Rewrite the worker fleet control',
    'Review both themes',
    'Add the fourth step',
  ]);
  assert.equal(created.message, 'Claude updated its plan (1/4 steps done).');
});

test('a cleared board directory degrades to the transcript fold', () => {
  // The real 989d7801 session: the board was cleared after the session, so only Claude's own
  // dotfiles remain and `.highwatermark` still reads 4. Reporting an empty plan there would
  // erase a board the operator can still see.
  const context = turnContext({
    planBoardIO: boardDirectory({ '.lock': '', '.highwatermark': '4' }),
  });

  const [created] = create(context, {
    id: 'toolu_planA',
    taskId: '1',
    subject: 'Add the widget parser',
    activeForm: 'Adding the widget parser',
  });
  assert.deepEqual(created.event.plan, [
    { step: 'Add the widget parser', status: 'pending', owner: '' },
  ]);

  const [started] = update(context, { id: 'toolu_planB', input: { taskId: '1', status: 'in_progress' } });
  assert.deepEqual(started.event.plan, [
    { step: 'Add the widget parser', status: 'inProgress', owner: '' },
  ]);
  assert.equal(started.event.explanation, 'Adding the widget parser');
});

test('a missing board directory never throws and leaves the fold in charge', () => {
  const io = missingBoardDirectory();
  const context = turnContext({ planBoardIO: io });
  const [created] = create(context, { id: 'toolu_planA', taskId: '1', subject: 'Add the widget parser' });
  assert.deepEqual(created.event.plan, [
    { step: 'Add the widget parser', status: 'pending', owner: '' },
  ]);
});

test('an unreadable or malformed task file costs one step, not the turn', () => {
  const context = turnContext({
    planBoardIO: boardDirectory({
      '.lock': '',
      '1.json': boardFile({ id: '1', subject: 'Readable step' }),
      // Truncated mid-write, which is what a board read during a write looks like.
      '2.json': '{"id":"2","subject":"Half writ',
      // Present in the listing, unreadable on open.
      '3.json': null,
      '4.json': boardFile({ id: '4', subject: 'Later readable step', status: 'completed' }),
    }),
  });

  // The create names a task the directory already mirrors, so the only steps in play are the
  // ones the directory could read.
  const [created] = create(context, { id: 'toolu_planA', taskId: '1', subject: 'Readable step' });
  assert.deepEqual(created.event.plan, [
    { step: 'Readable step', status: 'pending', owner: '' },
    { step: 'Later readable step', status: 'completed', owner: '' },
  ]);
});

test('the directory board coerces every untrusted field it reads', () => {
  const context = turnContext({
    planBoardIO: boardDirectory({
      '.lock': '',
      // A deleted task is off the board even while its file survives.
      '1.json': boardFile({ id: '1', subject: 'Removed step', status: 'deleted' }),
      // Non-string subject, owner, and status, plus an id the file name has to supply.
      '2.json': JSON.stringify({ subject: 17, owner: ['dev-2'], status: { done: true } }),
      // A JSON array is not a task record, and neither is a bare `null`, string, or number.
      // These are dropped like an unreadable file rather than shown as an invented `Task N`
      // step that no board ever held and that the step count would still charge for.
      '3.json': '[{"id":"3","subject":"Not an object"}]',
      '6.json': 'null',
      '7.json': '"a string"',
      '8.json': '42',
      // An object with nothing readable in it is still a task record, so the file names it.
      '4.json': '{}',
      '5.json': boardFile({ id: '5', subject: '', activeForm: 'Doing the unnamed work' }),
    }),
  });

  const [created] = create(context, { id: 'toolu_planA', taskId: '2', subject: 'Ignored by the directory' });
  assert.deepEqual(created.event.plan, [
    { step: 'Task 2', status: 'pending', owner: '' },
    { step: 'Task 4', status: 'pending', owner: '' },
    { step: 'Doing the unnamed work', status: 'pending', owner: '' },
  ]);
  // The rendered payload stays exactly the three provider-neutral fields.
  assert.deepEqual(Object.keys(created.event.plan[0]), ['step', 'status', 'owner']);
});

test('a non-numeric board keeps a stable order and a numeric one reads in task order', () => {
  const numeric = turnContext({
    planBoardIO: boardDirectory({
      '.lock': '',
      '10.json': boardFile({ id: '10', subject: 'Tenth step' }),
      '2.json': boardFile({ id: '2', subject: 'Second step' }),
      '9.json': boardFile({ id: '9', subject: 'Ninth step' }),
    }),
  });
  const [ordered] = create(numeric, { id: 'toolu_planA', taskId: '2', subject: 'Second step' });
  assert.deepEqual(ordered.event.plan.map((entry) => entry.step), [
    'Second step', 'Ninth step', 'Tenth step',
  ]);

  // readdir order is not guaranteed, so a board whose ids are not all numeric is read in
  // sorted file-name order rather than whatever the platform hands back.
  const named = turnContext({
    planBoardIO: boardDirectory({
      '.lock': '',
      'b.json': JSON.stringify({ id: 'beta', subject: 'Beta step' }),
      'a.json': JSON.stringify({ id: 'alpha', subject: 'Alpha step' }),
    }),
  });
  const [byName] = create(named, { id: 'toolu_planB', taskId: 'alpha', subject: 'Alpha step' });
  assert.deepEqual(byName.event.plan.map((entry) => entry.step), ['Alpha step', 'Beta step']);
});

test('dotfiles are never read as tasks', () => {
  const io = boardDirectory({
    '.lock': '',
    '.highwatermark': '3',
    '.DS_Store': 'binary junk',
    '1.json': boardFile({ id: '1', subject: 'The only step' }),
  });
  const context = turnContext({ planBoardIO: io });

  const [created] = create(context, { id: 'toolu_planA', taskId: '1', subject: 'The only step' });
  assert.deepEqual(created.event.plan, [{ step: 'The only step', status: 'pending', owner: '' }]);
  // `.highwatermark` counts ids ever issued, so reading it would invent steps that do not exist.
  // The session directory itself is the only opened path whose own name may start with a dot.
  const opened = io.calls.map((path) => path.slice(path.lastIndexOf('/') + 1));
  assert.deepEqual(opened, ['session-one', '1.json']);
});

test('a session id that is not a safe path component skips the directory read', () => {
  const io = boardDirectory(CONTINUATION_BOARD);
  const context = turnContext({ sessionId: '../../../etc', planBoardIO: io });

  const [created] = create(context, { id: 'toolu_planA', taskId: '1', subject: 'Add the widget parser' });
  assert.deepEqual(created.event.plan, [
    { step: 'Add the widget parser', status: 'pending', owner: '' },
  ]);
  assert.deepEqual(io.calls, []);
});

test('an implausibly large directory is refused rather than shown truncated', () => {
  const files = { '.lock': '' };
  for (let index = 1; index <= 501; index += 1) {
    files[`${index}.json`] = boardFile({ id: String(index), subject: `Step ${index}` });
  }
  const context = turnContext({ planBoardIO: boardDirectory(files) });

  // A cut-off board presented as the whole plan is worse than the fold, so the fold wins.
  const [created] = create(context, { id: 'toolu_planA', taskId: '1', subject: 'Add the widget parser' });
  assert.deepEqual(created.event.plan, [
    { step: 'Add the widget parser', status: 'pending', owner: '' },
  ]);
});

test('a rejected update still moves nothing when a board directory exists', () => {
  const io = boardDirectory({
    '.lock': '',
    '1.json': boardFile({ id: '1', subject: 'Compact the panel header', owner: 'dev-1', status: 'in_progress' }),
  });
  const context = turnContext({ planBoardIO: io });

  const [created] = create(context, { id: 'toolu_planA', taskId: '1', subject: 'Compact the panel header' });
  assert.deepEqual(created.event.plan, [
    { step: 'Compact the panel header', status: 'inProgress', owner: 'dev-1' },
  ]);

  const before = io.calls.length;
  const rejected = boardCall(context, {
    id: 'toolu_planB',
    name: 'TaskUpdate',
    input: { taskId: '1', status: 'completed' },
    text: 'Task not found',
    result: { success: false, taskId: '1', updatedFields: [], error: 'Task not found' },
  });
  assert.deepEqual(rejected, []);
  // The fold keeps its own board beside the mirror now, so the refusal is checked against what
  // this turn watched: the create's own pending step, untouched by the rejected completion.
  assert.deepEqual(context.planBoard.get('1').status, 'pending');
  // The veto is settled before any board source is consulted, so the refusal cannot be
  // laundered into a report by a directory read.
  assert.equal(io.calls.length, before);

  // And the next real movement still publishes the mirror's version of that step, so nothing
  // the refusal touched leaks into the row.
  const [next] = create(context, { id: 'toolu_planC', taskId: '2', subject: 'Review both themes' });
  assert.deepEqual(next.event.plan, [
    { step: 'Compact the panel header', status: 'inProgress', owner: 'dev-1' },
    { step: 'Review both themes', status: 'pending', owner: '' },
  ]);
});

test('TaskList reconciles the fold without reporting a mutation', () => {
  const context = turnContext();

  // A continuation turn with no mirrored directory: the list is the only full board available.
  const listed = boardCall(context, {
    id: 'toolu_planA',
    name: 'TaskList',
    input: {},
    text: '#1 [completed] Compact the panel header\n#2 [pending] Review both themes',
    result: {
      tasks: [
        { id: '1', subject: 'Compact the panel header', status: 'completed', blockedBy: [] },
        { id: '2', subject: 'Review both themes', status: 'pending', blockedBy: [] },
      ],
    },
  });
  // Reading the board is not the board moving.
  assert.deepEqual(listed, []);
  assert.equal(context.planSignature, undefined);
  assert.equal(context.planBoard.size, 2);

  // The next real mutation reports the reconciled board, including the step this turn never
  // watched being created.
  const [started] = update(context, { id: 'toolu_planB', input: { taskId: '2', status: 'in_progress' } });
  assert.deepEqual(started.event.plan, [
    { step: 'Compact the panel header', status: 'completed', owner: '' },
    { step: 'Review both themes', status: 'inProgress', owner: '' },
  ]);
});

test('a TaskList reconcile keeps what the list does not report', () => {
  const context = turnContext();
  create(context, {
    id: 'toolu_planA',
    taskId: '1',
    subject: 'Add the widget parser',
    activeForm: 'Adding the widget parser',
    owner: 'dev-1',
  });

  boardCall(context, {
    id: 'toolu_planB',
    name: 'TaskList',
    input: {},
    text: '#1 [in_progress] Add the widget parser',
    // The real list payload carries no `activeForm` and no `owner`.
    result: { tasks: [{ id: '1', subject: 'Add the widget parser', status: 'in_progress', blockedBy: [] }] },
  });
  assert.deepEqual(context.planBoard.get('1'), {
    step: 'Add the widget parser', status: 'inProgress', owner: 'dev-1', activeForm: 'Adding the widget parser',
  });

  // A malformed or empty list is data, not an instruction to empty the board.
  boardCall(context, {
    id: 'toolu_planC',
    name: 'TaskList',
    input: {},
    text: 'No tasks',
    result: { tasks: 'all done' },
  });
  assert.equal(context.planBoard.size, 1);
});

test('the plan key is stable across the first headless turn', () => {
  // `runProcess` seeds `sessionId` from `task.thread_id`, which `run` requires and a fresh turn
  // passes to Claude as `--session-id`, so the key is the same on turn one and on every
  // continuation. The `result` record then repeats that id.
  const context = turnContext({ sessionId: 'session-one', taskId: 42 });
  const [created] = create(context, { id: 'toolu_planA', taskId: '1', subject: 'Add the widget parser' });
  assert.equal(created.event.planKey, 'session-one');

  consumeClaudeStreamMessage({ type: 'result', result: 'done', session_id: 'session-one' }, context);
  const [started] = update(context, { id: 'toolu_planB', input: { taskId: '1', status: 'in_progress' } });
  assert.equal(started.event.planKey, 'session-one');

  // One board keeps one row even if the session id a turn reports changes underneath it.
  const drifting = turnContext({ sessionId: '', taskId: 42 });
  const [first] = create(drifting, { id: 'toolu_planC', taskId: '1', subject: 'Add the widget parser' });
  assert.equal(first.event.planKey, 'task-42');
  consumeClaudeStreamMessage({ type: 'result', result: 'done', session_id: 'session-two' }, drifting);
  const [second] = update(drifting, { id: 'toolu_planD', input: { taskId: '1', status: 'in_progress' } });
  assert.equal(second.event.planKey, 'task-42');
});

// --- The directory and the fold together ------------------------------------------------
//
// Neither board replaces the other. The directory decides what the board contains and what a
// mirrored step says; the fold is the only record of the ids this turn created, and the only
// board left once the directory stops being readable partway through a turn.

test('a board cleared from disk mid-turn still reports this turn own updates', () => {
  // Mutating this object is how the real directory changes underneath a running turn: a board
  // cleared by Claude, a permission change, a resume against an older build.
  const files = {
    '.lock': '',
    '.highwatermark': '2',
    '1.json': boardFile({ id: '1', subject: 'Compact the panel header', owner: 'dev-1', status: 'completed' }),
    '2.json': boardFile({ id: '2', subject: 'Rewrite the worker fleet control', owner: 'dev-2', status: 'completed' }),
  };
  const context = turnContext({ planBoardIO: boardDirectory(files) });

  const [created] = create(context, {
    id: 'toolu_planA',
    taskId: '3',
    subject: 'Review both themes',
    activeForm: 'Reviewing both themes',
  });
  assert.deepEqual(created.event.plan.map((entry) => entry.step), [
    'Compact the panel header', 'Rewrite the worker fleet control', 'Review both themes',
  ]);

  // Every task file leaves; only Claude's own bookkeeping dotfiles remain, exactly as the real
  // 989d7801 board looks after it was cleared.
  delete files['1.json'];
  delete files['2.json'];

  // Before this fix the directory had already replaced the fold, so task 3 was not on the board
  // the update looked at, the directory read then failed, and the turn emitted nothing at all
  // for the rest of its life.
  const [finished] = update(context, { id: 'toolu_planB', input: { taskId: '3', status: 'completed' } });
  assert.ok(finished, 'an update on a task this turn created must still report');
  assert.deepEqual(finished.event.plan, [
    { step: 'Review both themes', status: 'completed', owner: '' },
  ]);
  // It is this turn's own steps and no more, so the row is published as knowingly partial.
  assert.equal(finished.event.partial, true);

  // A board that becomes readable again takes the row back, with this turn's own step kept.
  files['1.json'] = boardFile({ id: '1', subject: 'Compact the panel header', owner: 'dev-1', status: 'completed' });
  const [restored] = update(context, { id: 'toolu_planC', input: { taskId: '3', owner: 'dev-3' } });
  assert.deepEqual(restored.event.plan, [
    { step: 'Compact the panel header', status: 'completed', owner: 'dev-1' },
    { step: 'Review both themes', status: 'completed', owner: 'dev-3' },
  ]);
  assert.equal(restored.event.partial, undefined);
});

test('a task Claude removed from the directory is not put back by the fold', () => {
  // The CLI writes each task file as it creates it, so the directory grows with the fold.
  const files = {
    '.lock': '',
    '1.json': boardFile({ id: '1', subject: 'Compact the panel header', owner: 'dev-1' }),
  };
  const context = turnContext({ planBoardIO: boardDirectory(files) });

  create(context, { id: 'toolu_planA', taskId: '1', subject: 'Compact the panel header' });
  files['2.json'] = boardFile({ id: '2', subject: 'Rewrite the worker fleet control', owner: 'dev-2' });
  const [both] = create(context, { id: 'toolu_planB', taskId: '2', subject: 'Rewrite the worker fleet control' });
  assert.equal(both.event.plan.length, 2);

  // Claude drops task 2 from its board without this turn watching the removal, which is what
  // the real 989d7801 session did to two of its four tasks.
  delete files['2.json'];
  files['1.json'] = boardFile({ id: '1', subject: 'Compact the panel header', owner: 'dev-1', status: 'completed' });

  const [remaining] = update(context, { id: 'toolu_planC', input: { taskId: '1', status: 'completed' } });
  assert.deepEqual(remaining.event.plan, [
    { step: 'Compact the panel header', status: 'completed', owner: 'dev-1' },
  ]);
  // The fold still holds the step it watched being created; the directory decides that it is
  // no longer on the board.
  assert.ok(context.planBoard.has('2'));
});

test('a TaskList that drops a task this turn created removes it from the plan', () => {
  const context = turnContext();
  create(context, { id: 'toolu_planA', taskId: '1', subject: 'Compact the panel header' });
  create(context, { id: 'toolu_planB', taskId: '2', subject: 'Rewrite the worker fleet control' });
  const [three] = create(context, { id: 'toolu_planC', taskId: '3', subject: 'Review both themes' });
  assert.equal(three.event.plan.length, 3);

  // The shipped `TaskList` takes no parameters, so its result is the entire board: a task it
  // does not report is a task Claude removed.
  boardCall(context, {
    id: 'toolu_planD',
    name: 'TaskList',
    input: {},
    text: '#1 [pending] Compact the panel header',
    result: { tasks: [{ id: '1', subject: 'Compact the panel header', status: 'pending', blockedBy: [] }] },
  });

  const [after] = update(context, { id: 'toolu_planE', input: { taskId: '1', status: 'completed' } });
  assert.deepEqual(after.event.plan, [
    { step: 'Compact the panel header', status: 'completed', owner: '' },
  ]);
});

test('a TaskList that carries arguments never clears the board', () => {
  const context = turnContext();
  create(context, { id: 'toolu_planA', taskId: '1', subject: 'Compact the panel header' });
  create(context, { id: 'toolu_planB', taskId: '2', subject: 'Rewrite the worker fleet control' });

  // No shipping build filters this read, so an argument means a build CC Relay has not seen and
  // a result that may be a subset. Clearing the board against a subset would erase real steps.
  boardCall(context, {
    id: 'toolu_planC',
    name: 'TaskList',
    input: { status: 'pending' },
    text: '#1 [pending] Compact the panel header',
    result: { tasks: [{ id: '1', subject: 'Compact the panel header', status: 'pending', blockedBy: [] }] },
  });
  assert.equal(context.planBoard.size, 2);

  const [after] = update(context, { id: 'toolu_planD', input: { taskId: '2', status: 'completed' } });
  assert.deepEqual(after.event.plan.map((entry) => entry.step), [
    'Compact the panel header', 'Rewrite the worker fleet control',
  ]);
});

test('a step the directory has not mirrored yet never blinks out of the plan', () => {
  const files = {
    '.lock': '',
    '1.json': boardFile({ id: '1', subject: 'Compact the panel header', owner: 'dev-1', status: 'completed' }),
  };
  const context = turnContext({ planBoardIO: boardDirectory(files) });

  // The mirror is written by the CLI, so a read can land before the new file exists.
  const [created] = create(context, {
    id: 'toolu_planA',
    taskId: '2',
    subject: 'Rewrite the worker fleet control',
    activeForm: 'Rewriting the worker fleet control',
  });
  assert.deepEqual(created.event.plan, [
    { step: 'Compact the panel header', status: 'completed', owner: 'dev-1' },
    { step: 'Rewrite the worker fleet control', status: 'pending', owner: '' },
  ]);

  const [started] = update(context, { id: 'toolu_planB', input: { taskId: '2', status: 'in_progress' } });
  assert.deepEqual(started.event.plan[1], {
    step: 'Rewrite the worker fleet control', status: 'inProgress', owner: '',
  });
  assert.equal(started.event.explanation, 'Rewriting the worker fleet control');

  // The mirror catches up and takes the step over. It is the same step in the same place, so
  // the row never showed it leaving and coming back.
  files['2.json'] = boardFile({
    id: '2',
    subject: 'Rewrite the worker fleet control',
    owner: 'dev-2',
    status: 'in_progress',
  });
  const [mirrored] = update(context, { id: 'toolu_planC', input: { taskId: '1', owner: 'dev-9' } });
  assert.deepEqual(mirrored.event.plan, [
    { step: 'Compact the panel header', status: 'completed', owner: 'dev-1' },
    { step: 'Rewrite the worker fleet control', status: 'inProgress', owner: 'dev-2' },
  ]);
  // That mirrored file carries no `activeForm`, and the sentence explaining the running step is
  // not a step the mirror owns, so the one this turn watched arrive survives the takeover.
  assert.equal(mirrored.event.explanation, 'Rewriting the worker fleet control');
});

test('a TodoWrite board wins over a task directory it does not describe', () => {
  // Older builds publish the whole board on every `TodoWrite` and write no task files at all,
  // so a directory found beside one belongs to a different board.
  const io = boardDirectory({
    '.lock': '',
    '1.json': boardFile({ id: '1', subject: 'Stale task-board step', status: 'completed' }),
    '2.json': boardFile({ id: '2', subject: 'Second stale task-board step' }),
  });
  const context = turnContext({ planBoardIO: io });

  const [replaced] = boardCall(context, {
    id: 'toolu_planA',
    name: 'TodoWrite',
    input: {
      todos: [
        { content: 'Read the parser', status: 'completed', activeForm: 'Reading the parser' },
        { content: 'Rewrite the parser', status: 'in_progress', activeForm: 'Rewriting the parser' },
        { content: 'Test the parser', status: 'pending', activeForm: 'Testing the parser' },
      ],
    },
    text: 'Todos have been modified successfully.',
  });
  assert.deepEqual(replaced.event.plan, [
    { step: 'Read the parser', status: 'completed', owner: '' },
    { step: 'Rewrite the parser', status: 'inProgress', owner: '' },
    { step: 'Test the parser', status: 'pending', owner: '' },
  ]);
  assert.equal(replaced.message, 'Claude updated its plan (1/3 steps done).');
  // A whole board published by the provider itself is never partial.
  assert.equal(replaced.event.partial, undefined);
  // The directory is not consulted at all once a todo board owns the turn.
  assert.deepEqual(io.calls, []);

  const [again] = boardCall(context, {
    id: 'toolu_planB',
    name: 'TodoWrite',
    input: { todos: [{ content: 'Read the parser', status: 'completed', activeForm: 'Reading the parser' }] },
    text: 'Todos have been modified successfully.',
  });
  assert.deepEqual(again.event.plan, [{ step: 'Read the parser', status: 'completed', owner: '' }]);
  assert.deepEqual(io.calls, []);
});

test('a plan that is only part of the board says so, and stops saying so once it is whole', () => {
  const context = turnContext();

  // A continuation turn with no readable directory: the first thing it sees is an update for a
  // task it never watched being created, which is proof the board holds steps it cannot name.
  const orphan = update(context, { id: 'toolu_planA', input: { taskId: '4', status: 'completed' } });
  assert.deepEqual(orphan, []);

  const [created] = create(context, { id: 'toolu_planB', taskId: '5', subject: 'Add the fifth step' });
  assert.deepEqual(created.event.plan, [{ step: 'Add the fifth step', status: 'pending', owner: '' }]);
  assert.equal(created.event.partial, true);
  // The four fields every consumer already reads are untouched, and the flag is the only
  // addition. `partial` is present only when it is true.
  assert.deepEqual(Object.keys(created.event), [
    'type', 'provider', 'planKey', 'explanation', 'plan', 'partial',
  ]);

  // A `TaskList` republishes the whole board, so the row stops being partial.
  boardCall(context, {
    id: 'toolu_planC',
    name: 'TaskList',
    input: {},
    text: '#4 [completed] Add the fourth step\n#5 [pending] Add the fifth step',
    result: {
      tasks: [
        { id: '4', subject: 'Add the fourth step', status: 'completed', blockedBy: [] },
        { id: '5', subject: 'Add the fifth step', status: 'pending', blockedBy: [] },
      ],
    },
  });
  const [whole] = update(context, { id: 'toolu_planD', input: { taskId: '5', status: 'in_progress' } });
  assert.deepEqual(whole.event.plan, [
    { step: 'Add the fourth step', status: 'completed', owner: '' },
    { step: 'Add the fifth step', status: 'inProgress', owner: '' },
  ]);
  assert.equal(whole.event.partial, undefined);
});

test('a turn that watched the board come into existence is not partial', () => {
  // Claude numbers a session's tasks from 1, so a first board call that creates task 1 is a
  // board with nothing on it before this turn, mirror or no mirror.
  const fresh = turnContext();
  const [first] = create(fresh, { id: 'toolu_planA', taskId: '1', subject: 'Add the widget parser' });
  assert.equal(first.event.partial, undefined);
  const [second] = create(fresh, { id: 'toolu_planB', taskId: '2', subject: 'Review the widget parser' });
  assert.equal(second.event.partial, undefined);

  // A first create numbered anything else resumed a board that already had steps on it.
  const resumed = turnContext();
  const [later] = create(resumed, { id: 'toolu_planC', taskId: '4', subject: 'Add the fourth step' });
  assert.equal(later.event.partial, true);

  // A mirrored board is the whole board, so a directory-backed row is never partial.
  const mirrored = turnContext({ planBoardIO: boardDirectory(CONTINUATION_BOARD) });
  const [reported] = update(mirrored, { id: 'toolu_planD', input: { taskId: '2', status: 'in_progress' } });
  assert.equal(reported.event.partial, undefined);
});

test('the partial flag alone is news the renderer has to hear', () => {
  // A continuation turn: task 4 is the first thing this turn touches, so the fold alone can
  // never be the whole board and only the directory makes the row whole.
  const files = {
    '.lock': '',
    '.highwatermark': '4',
    '4.json': boardFile({ id: '4', subject: 'Add the fourth step', owner: 'dev-4' }),
  };
  const context = turnContext({ planBoardIO: boardDirectory(files) });

  const [mirrored] = create(context, {
    id: 'toolu_planA', taskId: '4', subject: 'Add the fourth step', owner: 'dev-4',
  });
  assert.equal(mirrored.event.partial, undefined);

  // The same steps with the same statuses, but the board behind them is gone. The payload is
  // otherwise identical, so without the flag in the signature this event would be suppressed as
  // a repeat and the renderer would keep treating a partial row as the whole plan.
  delete files['4.json'];
  const [degraded] = update(context, { id: 'toolu_planB', input: { taskId: '4', owner: 'dev-4' } });
  assert.ok(degraded, 'the row becoming partial must reach the renderer');
  assert.deepEqual(degraded.event.plan, mirrored.event.plan);
  assert.equal(degraded.event.partial, true);
});
