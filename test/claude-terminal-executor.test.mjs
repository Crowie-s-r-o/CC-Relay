import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { ClaudeExecutionRunner, taskPrompt } from '../src/claude-execution-runner.mjs';
import {
  CLAUDE_COMPOSER_ANCHOR_CHARS,
  CLAUDE_COMPOSER_CLEAR_KEYS,
  CLAUDE_COMPOSER_MAX_CHROME_LINES,
  CLAUDE_COMPOSER_MAX_TAIL_DEPTH,
  CLAUDE_COMPOSER_MIN_STRIPPED_ANCHOR_CHARS,
  CLAUDE_COMPOSER_STATUS_ROW_PATTERNS,
  CLAUDE_COMPOSER_TAIL_LINES,
  CLAUDE_PASTE_COLLAPSE_MIN_LINES,
  CLAUDE_RESUME_PICKER_FALLBACK_KEYS,
  CLAUDE_RESUME_PICKER_KEYS,
  CLAUDE_SCREEN_RULE_PATTERN,
  ClaudeTerminalExecutor,
  classifyClaudeScreen,
  claudeComposerContent,
  claudeComposerState,
  claudeScreenExcerpt,
  claudeScreenTailLines,
  claudeTerminalRelaunchCommand,
  expectedPastePlaceholderLines,
  submitHeldTerminalPaste,
} from '../src/claude-terminal-executor.mjs';
import {
  assistantRecordText,
  attachmentRewrittenPromptForms,
  attachmentRewrittenPrompts,
  bracketedPastePayload,
  createTranscriptReader,
  fsTranscriptSource,
  injectionPromptIssue,
  isSubmittedPromptRecord,
  isTurnFinalAssistantRecord,
  mungeClaudeCwd,
  queuedPromptRecordText,
  releasedQueuedPromptRecordText,
  resolveClaudeTranscriptPath,
  sanitizeInjectedPrompt,
  submittedPromptMatches,
  submittedRewrittenPromptMatches,
  userPromptRecordText,
} from '../src/claude-transcript-tail.mjs';
import { RELAY_NON_INTERACTIVE_INSTRUCTION } from '../src/relay-prompt.mjs';

const ESC = String.fromCharCode(27);
const NUL = String.fromCharCode(0);
const SESSION_ID = 'a1b2c3d4-0000-0000-0000-000000000000';
const WINDOW_ID = 4242;
const TTY = '/dev/ttys042';
const PID = 111;
const TERMINAL = { terminalWindowId: WINDOW_ID, terminalTty: TTY, runtimeProcessId: PID };

// ---- pure transcript helpers -------------------------------------------------

test('mungeClaudeCwd replaces every non-alphanumeric character with a dash', () => {
  assert.equal(mungeClaudeCwd('/Users/dev/WebstormProjects/relay'), '-Users-dev-WebstormProjects-relay');
  assert.equal(mungeClaudeCwd('/tmp/a.b_c'), '-tmp-a-b-c');
});

test('resolveClaudeTranscriptPath munges the realpath-resolved cwd', () => {
  const path = resolveClaudeTranscriptPath('/var/x', SESSION_ID, {
    home: '/home/dev',
    realpathSync: (value) => (value === '/var/x' ? '/private/var/x' : value),
    existsSync: (value) => value === `/home/dev/.claude/projects/-private-var-x/${SESSION_ID}.jsonl`,
    readdirSync: () => [],
  });
  assert.equal(path, `/home/dev/.claude/projects/-private-var-x/${SESSION_ID}.jsonl`);
});

test('resolveClaudeTranscriptPath falls back to a sessionId glob across project dirs', () => {
  const target = `/home/dev/.claude/projects/-elsewhere/${SESSION_ID}.jsonl`;
  const path = resolveClaudeTranscriptPath('/repo', SESSION_ID, {
    home: '/home/dev',
    realpathSync: (value) => value,
    existsSync: (value) => value === target,
    readdirSync: () => ['-repo', '-elsewhere'],
  });
  assert.equal(path, target);
});

test('sanitizeInjectedPrompt strips ESC so a prompt cannot break out of bracketed paste', () => {
  const dangerous = `plain ${ESC}[201~ text`;
  assert.equal(sanitizeInjectedPrompt(dangerous), 'plain [201~ text');
  const payload = bracketedPastePayload(dangerous);
  assert.equal(payload, `${ESC}[200~plain [201~ text${ESC}[201~`);
  assert.equal(payload.split(`${ESC}[200~`).length, 2);
  assert.equal(payload.split(`${ESC}[201~`).length, 2);
});

test('bracketedPastePayload preserves multiline text and special characters', () => {
  const payload = bracketedPastePayload('line one\nline "two" \\ done');
  assert.equal(payload, `${ESC}[200~line one\nline "two" \\ done${ESC}[201~`);
});

test('held terminal paste recovery sends a nonempty trailing space before Return', async () => {
  const typed = [];
  await submitHeldTerminalPaste(WINDOW_ID, async (...args) => typed.push(args));
  assert.deepEqual(typed, [[WINDOW_ID, ' ']]);
});

test('filesystem transcript state distinguishes an absent file from an unreadable file', () => {
  const absent = fsTranscriptSource('/missing/transcript.jsonl', {
    statSync: () => {
      const error = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    },
  });
  const unreadable = fsTranscriptSource('/blocked/transcript.jsonl', {
    statSync: () => {
      const error = new Error('blocked');
      error.code = 'EACCES';
      throw error;
    },
  });
  const present = fsTranscriptSource('/present/transcript.jsonl', {
    statSync: () => ({ size: 0 }),
  });

  assert.equal(absent.state(), 'absent');
  assert.equal(unreadable.state(), 'unreadable');
  assert.equal(present.state(), 'present');
});

test('filesystem transcript wait wakes immediately when Claude writes the watched file', async () => {
  let size = 10;
  let onChange = null;
  let closed = false;
  let timerCleared = false;
  const source = fsTranscriptSource('/project/session.jsonl', {
    statSync: () => ({ size }),
    watch: (directory, options, listener) => {
      assert.equal(directory, '/project');
      assert.deepEqual(options, { persistent: false });
      onChange = listener;
      return {
        close: () => { closed = true; },
        on: () => {},
      };
    },
    setTimer: () => 42,
    clearTimer: (timer) => {
      assert.equal(timer, 42);
      timerCleared = true;
    },
  });

  const changed = source.waitForChange(10, 800);
  size = 20;
  onChange('change', 'session.jsonl');

  assert.equal(await changed, true);
  assert.equal(closed, true);
  assert.equal(timerCleared, true);
});

test('filesystem transcript wait keeps its timeout fallback when native watching is unavailable', async () => {
  let resolveTimer = null;
  const source = fsTranscriptSource('/project/session.jsonl', {
    statSync: () => ({ size: 10 }),
    watch: () => { throw new Error('watch unavailable'); },
    setTimer: (callback) => {
      resolveTimer = callback;
      return 42;
    },
    clearTimer: () => {},
  });

  const changed = source.waitForChange(10, 800);
  resolveTimer();
  assert.equal(await changed, false);
});

test('isTurnFinalAssistantRecord treats any non-tool_use stop reason as final', () => {
  assert.equal(isTurnFinalAssistantRecord({ type: 'assistant', message: { stop_reason: 'tool_use' } }), false);
  assert.equal(isTurnFinalAssistantRecord({ type: 'assistant', message: { stop_reason: 'end_turn' } }), true);
  assert.equal(isTurnFinalAssistantRecord({ type: 'assistant', message: { stop_reason: 'max_tokens' } }), true);
  assert.equal(isTurnFinalAssistantRecord({ type: 'user', message: {} }), false);
});

test('createTranscriptReader surfaces only records appended after the offset', () => {
  let content = Buffer.from(`${JSON.stringify({ type: 'startup' })}\n`);
  const source = { size: () => content.length, readFrom: (offset) => content.subarray(offset) };
  const reader = createTranscriptReader(source, content.length);
  assert.deepEqual(reader.poll(), []);
  content = Buffer.concat([content, Buffer.from(`${JSON.stringify({ type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'hi' }] } })}\n`)]);
  const records = reader.poll();
  assert.equal(records.length, 1);
  assert.equal(assistantRecordText(records[0]), 'hi');
});

test('submitted prompt correlation rejects compaction records and accepts hook-prefixed context', () => {
  const expected = 'Continue with the exact follow-up.';
  const direct = { type: 'user', message: { content: expected } };
  const blocks = { type: 'user', message: { content: [{ type: 'text', text: expected }] } };
  const compact = { ...direct, isCompactSummary: true };
  const toolResultRecord = {
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: expected }] },
  };

  assert.equal(userPromptRecordText(direct), expected);
  assert.equal(userPromptRecordText(toolResultRecord), '');
  assert.equal(isSubmittedPromptRecord(direct, expected), true);
  assert.equal(isSubmittedPromptRecord(blocks, expected), true);
  assert.equal(isSubmittedPromptRecord(compact, expected), false);
  assert.equal(isSubmittedPromptRecord({ type: 'user', message: { content: '/compact' } }, expected), false);
  assert.equal(submittedPromptMatches(`Injected context\n${expected}`, expected), true);
  assert.equal(
    submittedPromptMatches(expected, `${expected}\n\nRequired delivery footer.`),
    false,
  );
});

// ---- image prompt correlation (production shapes) ----------------------------
//
// Every literal below is the shape Claude Code 2.1.220 actually recorded for a CC Relay prompt
// that carried image attachments. Sources: the plan council author stage of task 39
// (2026-07-30T13:13 and 13:22, one attachment path referenced twice) and direct Execute task 41
// (13:55, three distinct attachment paths). They are written out by hand rather than derived, so
// they assert the observed contract instead of restating the implementation.
const IMAGE_PATH = '/data/tasks/41/attachments/01.png';
const ONE_IMAGE_TASK = {
  prompt: 'Check the failing screenshot.',
  attachments: [{ name: 'image.png', path: IMAGE_PATH }],
};
const ONE_IMAGE_RECORDED = `[Image #1]Check the failing screenshot.
Reference images are attached. Use the Read tool to inspect every image before working:
1. image.png:
${RELAY_NON_INTERACTIVE_INSTRUCTION}`;
const attachmentPaths = (task) => task.attachments.map((attachment) => attachment.path);
const rewrites = (task, prompt = taskPrompt(task)) => attachmentRewrittenPrompts(prompt, attachmentPaths(task));
// What live correlation actually compares against: the chip-less bodies plus the required chip
// count. The chip run's start index is not contractual, so it is validated rather than derived.
const rewriteForms = (task, prompt = taskPrompt(task)) => (
  attachmentRewrittenPromptForms(prompt, attachmentPaths(task))
);
// Claude numbers chips cumulatively across the whole SESSION, so a prompt delivered after earlier
// image turns is recorded with a run that starts above one. Renumbering the canonical form keeps
// every cumulative case anchored to the hand-written production shapes rather than to new literals.
const renumberChips = (recorded, start) => {
  let next = Number(start);
  return recorded.replace(
    /^(?:\[Image #\d+\] )*\[Image #\d+\]/,
    (run) => run.replace(/\[Image #\d+\]/g, () => `[Image #${next++}]`),
  );
};

test('attachmentRewrittenPrompts reproduces the recorded chip form for one, two, and three image references', () => {
  assert.equal(submittedPromptMatches(ONE_IMAGE_RECORDED, rewrites(ONE_IMAGE_TASK)), true);

  // Task 39: one attachment referenced twice (the council block plus the Execute block) produces
  // two chips, so occurrences are numbered, not unique paths.
  const councilTask = {
    prompt: `You are the author.

<original-user-brief>
fix the totals
</original-user-brief>

Reference images are attached to this planning brief. Inspect every image before deciding the plan:
1. image.png: ${IMAGE_PATH}`,
    attachments: [{ name: 'image.png', path: IMAGE_PATH }],
  };
  const councilRecorded = `[Image #1] [Image #2]You are the author.
<original-user-brief>
fix the totals
</original-user-brief>
Reference images are attached to this planning brief. Inspect every image before deciding the plan:
1. image.png:
Reference images are attached. Use the Read tool to inspect every image before working:
1. image.png:
${RELAY_NON_INTERACTIVE_INSTRUCTION}`;
  assert.equal(submittedPromptMatches(councilRecorded, rewrites(councilTask)), true);

  // Task 41: three distinct paths.
  const threeImageTask = {
    prompt: 'CC relay still failing - resuming gets stuck.\n\nmake sure launching and resuming terminals is flawless',
    attachments: [
      { name: 'image.png', path: '/data/tasks/41/attachments/01.png' },
      { name: 'image.png', path: '/data/tasks/41/attachments/02.png' },
      { name: 'image.png', path: '/data/tasks/41/attachments/03.png' },
    ],
  };
  const threeImageRecorded = `[Image #1] [Image #2] [Image #3]CC relay still failing - resuming gets stuck.
make sure launching and resuming terminals is flawless
Reference images are attached. Use the Read tool to inspect every image before working:
1. image.png:
2. image.png:
3. image.png:
${RELAY_NON_INTERACTIVE_INSTRUCTION}`;
  assert.equal(submittedPromptMatches(threeImageRecorded, rewrites(threeImageTask)), true);

  // The captured live UserPromptSubmit payload from Claude Code 2.1.220. Its `prompt` field was
  // byte identical to the transcript record for the same turn, which is why the hook comparison
  // accepts this form too. This prompt is written literally because it was not built by taskPrompt.
  const probeImage = '/probe/hookprobe/probe.png';
  const probeDelivered = [
    'reply with the word ok',
    '',
    'Reference images are attached. Use the Read tool to inspect every image before working:',
    `1. probe.png: ${probeImage}`,
    '',
    'filler line one',
    'filler line two',
  ].join('\n');
  const probeCaptured = '[Image #1]reply with the word ok\n'
    + 'Reference images are attached. Use the Read tool to inspect every image before working:\n'
    + '1. probe.png:\n'
    + 'filler line one\n'
    + 'filler line two';
  assert.deepEqual(attachmentRewrittenPrompts(probeDelivered, [probeImage]), [probeCaptured]);

  // The whole reason this exists: the delivered text can never equal what Claude recorded.
  for (const [recorded, task] of [
    [ONE_IMAGE_RECORDED, ONE_IMAGE_TASK],
    [councilRecorded, councilTask],
    [threeImageRecorded, threeImageTask],
  ]) {
    assert.equal(submittedPromptMatches(recorded, [taskPrompt(task)]), false);
  }
});

test('attachmentRewrittenPrompts is extension agnostic because it only removes known attachment paths', () => {
  const task = {
    prompt: 'Compare these.',
    attachments: [
      { name: 'shot.webp', path: '/data/tasks/9/attachments/01.webp' },
      { name: 'shot.jpeg', path: '/data/tasks/9/attachments/02.jpeg' },
    ],
  };
  const recorded = `[Image #1] [Image #2]Compare these.
Reference images are attached. Use the Read tool to inspect every image before working:
1. shot.webp:
2. shot.jpeg:
${RELAY_NON_INTERACTIVE_INSTRUCTION}`;
  assert.equal(submittedPromptMatches(recorded, rewrites(task)), true);
  // An unrelated absolute path that is not one of this task's attachments is never rewritten.
  assert.deepEqual(attachmentRewrittenPrompts('see /etc/other/01.png please', attachmentPaths(task)), []);

  // One attachment path that is a strict prefix of another must never consume the longer
  // reference, in either delivery order. No production sample exercises this, so it is pinned here.
  const overlapping = ['/a/01.png', '/a/01.png.backup.png'];
  assert.deepEqual(
    attachmentRewrittenPrompts('x /a/01.png.backup.png y', overlapping),
    ['[Image #1]x y'],
  );
  assert.deepEqual(
    attachmentRewrittenPrompts('x /a/01.png y /a/01.png.backup.png z', overlapping),
    ['[Image #1] [Image #2]x y z'],
  );
});

test('attachmentRewrittenPrompts reproduces Task 58 newline-before-slash normalization', () => {
  const task = {
    prompt: 'Review View Input / View Output.\nCall `GET /api/read` and `PUT /api/write`.',
    attachments: [{ name: 'image.png', path: IMAGE_PATH }],
  };
  const recorded = `[Image #1]Review View Input
/ View Output.
Call \`GET
/api/read\` and \`PUT
/api/write\`.
Reference images are attached. Use the Read tool to inspect every image before working:
1. image.png:
${RELAY_NON_INTERACTIVE_INSTRUCTION}`;
  const accepted = rewrites(task);

  assert.equal(submittedPromptMatches(recorded, accepted), true);
  assert.equal(accepted.length, 2);
  // Task 58 converted every space-before-slash occurrence. A hybrid prompt is not a complete
  // deterministic rewrite and must remain untrusted.
  assert.equal(
    submittedPromptMatches(recorded.replace('\n/api/read', ' /api/read'), accepted),
    false,
  );
});

test('attachmentRewrittenPrompts leaves text-only prompts on strict raw equality', () => {
  const textOnly = { prompt: 'Ship the release through GET /api/release.', attachments: [] };
  const delivered = taskPrompt(textOnly);
  // No attachment path, so no rewritten form exists at all: nothing about text-only matching moves.
  assert.deepEqual(attachmentRewrittenPrompts(delivered, []), []);
  assert.deepEqual(attachmentRewrittenPrompts(delivered, ['/data/tasks/9/attachments/01.png']), []);
  // A prompt that differs from the delivered text only by collapsed blank lines is still rejected.
  assert.equal(submittedPromptMatches(delivered.replace(/\n{2,}/g, '\n'), [delivered]), false);
  assert.equal(submittedPromptMatches(delivered.replace(' /api', '\n/api'), [delivered]), false);
});

test('the rewritten prompt anchor still rejects a different, truncated, or half-rewritten prompt', () => {
  const accepted = rewrites(ONE_IMAGE_TASK);

  // A different prompt carrying the same image.
  const otherTask = { ...ONE_IMAGE_TASK, prompt: 'Check something else entirely.' };
  assert.equal(submittedPromptMatches(ONE_IMAGE_RECORDED, rewrites(otherTask)), false);

  // Truncated: the first line only, and everything but the final sentence.
  assert.equal(submittedPromptMatches(ONE_IMAGE_RECORDED.split('\n')[0], accepted), false);
  assert.equal(
    submittedPromptMatches(ONE_IMAGE_RECORDED.slice(0, ONE_IMAGE_RECORDED.length - 20), accepted),
    false,
  );

  // A compact summary that quotes the rewritten prompt is not a submitted prompt record.
  assert.equal(
    isSubmittedPromptRecord(
      { type: 'user', isCompactSummary: true, message: { content: ONE_IMAGE_RECORDED } },
      accepted,
    ),
    false,
  );
  // Neither is a tool result carrying the same text.
  assert.equal(
    isSubmittedPromptRecord(
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: ONE_IMAGE_RECORDED }] } },
      accepted,
    ),
    false,
  );

  // Half-rewritten forms prove both transforms are required together, not either one alone.
  const delivered = taskPrompt(ONE_IMAGE_TASK);
  assert.equal(submittedPromptMatches(delivered.replace(/\n{2,}/g, '\n'), accepted), false);
  assert.equal(submittedPromptMatches(`[Image #1]${delivered}`, accepted), false);
  // Chips without the path removal, and path removal without chips, both fail.
  assert.equal(submittedPromptMatches(ONE_IMAGE_RECORDED.replace('[Image #1]', ''), accepted), false);
  assert.equal(submittedPromptMatches(`[Image #1] [Image #2]${ONE_IMAGE_RECORDED.slice('[Image #1]'.length)}`, accepted), false);

  // A user record whose blocks are text plus images, exactly as Claude stores an image prompt.
  assert.equal(
    isSubmittedPromptRecord(
      {
        type: 'user',
        message: {
          content: [
            { type: 'text', text: ONE_IMAGE_RECORDED },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
          ],
        },
      },
      accepted,
    ),
    true,
  );
});

// Task 84's production shape with synthetic content: a plan council revision stage delivered into
// the author session whose draft stage had already consumed chips #1 and #2, one attachment path
// referenced twice (the council block plus the Execute block), and every space before a slash
// converted. The real turn was recorded as `[Image #3] [Image #4]...`, and again as
// `[Image #5] [Image #6]...` after the user pressed Resume. Deriving only the start-at-one form
// matched neither, so CC Relay failed the stage at promptAcceptanceTimeoutMs and closed the
// terminals while Claude had already finished writing the final plan.
const CUMULATIVE_COUNCIL_TASK = {
  prompt: `You are the original plan author returning after an independent review.

<original-user-brief>
Split the importer / exporter pipeline. Call \`GET /api/import\` first.
</original-user-brief>

Reference images are attached to this planning brief. Inspect every image before deciding the plan:
1. image.png: ${IMAGE_PATH}`,
  attachments: [{ name: 'image.png', path: IMAGE_PATH }],
};
const CUMULATIVE_COUNCIL_RECORDED = `[Image #3] [Image #4]You are the original plan author returning after an independent review.
<original-user-brief>
Split the importer
/ exporter pipeline. Call \`GET
/api/import\` first.
</original-user-brief>
Reference images are attached to this planning brief. Inspect every image before deciding the plan:
1. image.png:
Reference images are attached. Use the Read tool to inspect every image before working:
1. image.png:
${RELAY_NON_INTERACTIVE_INSTRUCTION}`;

test('a session-cumulative chip run anchors the same prompt at any start index', () => {
  // The count is contractual, the start is not: one removed occurrence, one chip, any index.
  const oneImage = rewriteForms(ONE_IMAGE_TASK);
  assert.equal(oneImage.chipCount, 1);
  for (const start of [1, 2, 3, 8, 17, 204]) {
    assert.equal(
      submittedRewrittenPromptMatches(renumberChips(ONE_IMAGE_RECORDED, start), oneImage),
      true,
    );
  }

  // The task 84 shape: two chips that start at three, plus the task 58 slash conversion. Both
  // transforms are complete, so this is still the whole prompt and nothing partial is accepted.
  const council = rewriteForms(CUMULATIVE_COUNCIL_TASK);
  assert.equal(council.chipCount, 2);
  assert.equal(submittedRewrittenPromptMatches(CUMULATIVE_COUNCIL_RECORDED, council), true);
  // The same prompt re-injected after Resume, numbered from wherever the session had reached.
  assert.equal(
    submittedRewrittenPromptMatches(renumberChips(CUMULATIVE_COUNCIL_RECORDED, 5), council),
    true,
  );
  // The start-at-one rendering stays valid: it is one member of the accepted family, not a
  // separate rule, which is why every earlier production sample keeps matching unchanged.
  assert.equal(
    submittedRewrittenPromptMatches(renumberChips(CUMULATIVE_COUNCIL_RECORDED, 1), council),
    true,
  );
  assert.deepEqual(
    rewrites(CUMULATIVE_COUNCIL_TASK).includes(renumberChips(CUMULATIVE_COUNCIL_RECORDED, 1)),
    true,
  );

  // The regression itself: comparing against the derived start-at-one strings matched neither
  // recorded form, which is what left task 84 in unverified-submission until it timed out.
  for (const start of [3, 5]) {
    assert.equal(
      submittedPromptMatches(renumberChips(CUMULATIVE_COUNCIL_RECORDED, start), rewrites(CUMULATIVE_COUNCIL_TASK)),
      false,
    );
  }

  // Hook-injected context before the prompt stays acceptable on exactly the raw channel's terms.
  assert.equal(
    submittedRewrittenPromptMatches(`Injected context\n${CUMULATIVE_COUNCIL_RECORDED}`, council),
    true,
  );
});

test('the cumulative chip rule keeps every rejection the start-at-one rule made', () => {
  const oneImage = rewriteForms(ONE_IMAGE_TASK);
  const council = rewriteForms(CUMULATIVE_COUNCIL_TASK);
  const body = ONE_IMAGE_RECORDED.slice('[Image #1]'.length);
  const withRun = (run) => `${run}${body}`;

  // Wrong chip count in both directions. One removed occurrence means exactly one chip.
  assert.equal(submittedRewrittenPromptMatches(withRun('[Image #3] [Image #4]'), oneImage), false);
  assert.equal(submittedRewrittenPromptMatches(withRun(''), oneImage), false);
  assert.equal(
    submittedRewrittenPromptMatches(
      renumberChips(CUMULATIVE_COUNCIL_RECORDED, 3).replace('[Image #3] [Image #4]', '[Image #3]'),
      council,
    ),
    false,
  );
  assert.equal(
    submittedRewrittenPromptMatches(
      renumberChips(CUMULATIVE_COUNCIL_RECORDED, 3).replace('[Image #3] [Image #4]', '[Image #3] [Image #4] [Image #5]'),
      council,
    ),
    false,
  );

  // The run must ascend by exactly one, so gaps, repeats, and descending runs are all rejected.
  for (const run of ['[Image #3] [Image #5]', '[Image #3] [Image #3]', '[Image #4] [Image #3]', '[Image #3] [Image #14]']) {
    assert.equal(
      submittedRewrittenPromptMatches(
        renumberChips(CUMULATIVE_COUNCIL_RECORDED, 3).replace('[Image #3] [Image #4]', run),
        council,
      ),
      false,
    );
  }

  // A start below one is not a session index at all, and a zero-padded index is not Claude's form.
  assert.equal(submittedRewrittenPromptMatches(withRun('[Image #0]'), oneImage), false);
  assert.equal(submittedRewrittenPromptMatches(withRun('[Image #01]'), oneImage), false);
  assert.equal(submittedRewrittenPromptMatches(withRun('[Image #-1]'), oneImage), false);

  // Half-rewritten forms still prove nothing: chips without the path removal, and path removal
  // without chips, at any start index.
  const delivered = taskPrompt(ONE_IMAGE_TASK);
  assert.equal(submittedRewrittenPromptMatches(`[Image #7]${delivered}`, oneImage), false);
  assert.equal(submittedRewrittenPromptMatches(body, oneImage), false);
  assert.equal(submittedRewrittenPromptMatches(delivered.replace(/\n{2,}/g, '\n'), oneImage), false);
  // A hybrid that converted only one of the two slash boundaries is not a complete transform.
  assert.equal(
    submittedRewrittenPromptMatches(
      CUMULATIVE_COUNCIL_RECORDED.replace('\n/api/import', ' /api/import'),
      council,
    ),
    false,
  );

  // Truncations and a different prompt carrying the same image.
  assert.equal(submittedRewrittenPromptMatches(withRun('[Image #6]').split('\n')[0], oneImage), false);
  assert.equal(
    submittedRewrittenPromptMatches(withRun('[Image #6]').slice(0, body.length - 10), oneImage),
    false,
  );
  assert.equal(
    submittedRewrittenPromptMatches(
      renumberChips(ONE_IMAGE_RECORDED, 6),
      rewriteForms({ ...ONE_IMAGE_TASK, prompt: 'Check something else entirely.' }),
    ),
    false,
  );

  // A compact summary and a tool result never become prompt evidence, whatever they quote.
  const cumulative = renumberChips(ONE_IMAGE_RECORDED, 6);
  assert.equal(
    submittedRewrittenPromptMatches(
      userPromptRecordText({ type: 'user', isCompactSummary: true, message: { content: cumulative } }),
      oneImage,
    ),
    false,
  );
  assert.equal(
    submittedRewrittenPromptMatches(
      userPromptRecordText({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: cumulative }] },
      }),
      oneImage,
    ),
    false,
  );

  // A text-only prompt has no chip count at all, so no chip run can ever anchor it.
  const textOnly = rewriteForms({ prompt: 'Ship the release through GET /api/release.', attachments: [] });
  assert.equal(textOnly.chipCount, 0);
  assert.deepEqual(textOnly.bodies, []);
  assert.equal(submittedRewrittenPromptMatches(cumulative, textOnly), false);
});

test('a prompt that is nothing but attachment paths derives no anchor at all', () => {
  // The body is what identifies the turn. Once the start index stopped being contractual, an empty
  // body would degenerate into "any record ending in a newline and one chip", so it is refused at
  // both ends: nothing is derived, and a hand-assembled empty form matches nothing.
  for (const bare of [IMAGE_PATH, ` ${IMAGE_PATH}`, `${IMAGE_PATH} ${IMAGE_PATH}`, `\n${IMAGE_PATH}\n`]) {
    assert.deepEqual(attachmentRewrittenPromptForms(bare, [IMAGE_PATH]), { chipCount: 0, bodies: [] });
    assert.deepEqual(attachmentRewrittenPrompts(bare, [IMAGE_PATH]), []);
    assert.equal(submittedRewrittenPromptMatches('[Image #1]', attachmentRewrittenPromptForms(bare, [IMAGE_PATH])), false);
  }

  // A form assembled by a future caller rather than derived here is refused on the same terms.
  for (const forms of [{ chipCount: 1, bodies: [''] }, { chipCount: 2, bodies: ['', '   \n '] }]) {
    for (const candidate of ['[Image #1]', '[Image #3] [Image #4]', 'unrelated turn\n[Image #9]', '']) {
      assert.equal(submittedRewrittenPromptMatches(candidate, forms), false);
    }
  }

  // A single surviving character is enough to identify the prompt again, so the guard is scoped to
  // the empty case and nothing else moved.
  const oneCharacter = attachmentRewrittenPromptForms(`x ${IMAGE_PATH}`, [IMAGE_PATH]);
  assert.deepEqual(oneCharacter, { chipCount: 1, bodies: ['x'] });
  assert.equal(submittedRewrittenPromptMatches('[Image #6]x', oneCharacter), true);
});

// The exact record shapes Claude Code 2.1.220 wrote for task 85's three live updates on
// 2026-07-31, reproduced field for field from the read-only transcript of session 917fd23a.
// A BUSY session queues the typed text instead of submitting it, so none of them is a user record.
const queueEnqueue = (content) => ({
  type: 'queue-operation',
  operation: 'enqueue',
  timestamp: '2026-07-31T12:44:08.066Z',
  sessionId: '917fd23a-6943-4ba5-8e52-77e411cfc92b',
  content,
});
const queueRemove = (content) => ({
  ...queueEnqueue(content),
  operation: 'remove',
  timestamp: '2026-07-31T12:44:35.689Z',
});
// Written when the queued text is consumed into a turn, but stamped with the enqueue timestamp,
// which is why its timestamp is never a latency measurement.
const queuedCommandAttachment = (prompt) => ({
  parentUuid: 'd09552d0-96ce-4f7f-9abd-14f62f042005',
  isSidechain: false,
  attachment: {
    type: 'queued_command',
    prompt,
    commandMode: 'prompt',
    origin: { kind: 'human' },
    timestamp: '2026-07-31T12:44:08.066Z',
  },
  type: 'attachment',
  uuid: '558249c1-1c45-4ac9-8b05-7e0506f6977f',
  timestamp: '2026-07-31T12:44:08.066Z',
  sessionId: '917fd23a-6943-4ba5-8e52-77e411cfc92b',
  version: '2.1.220',
});
// Task 85's third live update, rebuilt through the real builder. The recorded `content` was 433
// bytes and this reproduces it exactly, which is what proves the queue record carries the injected
// text with no framing of its own.
const QUEUED_STEER_PROMPT = taskPrompt({
  prompt: 'also when I send a message to running claude through the cc relay it sends it but it leaves it also in the input like it failed to send why? - fix this as well',
  attachments: [],
});
const QUEUED_TASK_NOTIFICATION = '<task-notification>\n'
  + '<task-id>a21d93d8cd05ec4fb</task-id>\n'
  + '<tool-use-id>toolu_012M2JjykSAMBUw7JewJMYeX</tool-use-id>\n'
  + '<status>completed</status>\n'
  + '<summary>Agent "dev-2: standby core developer" finished</summary>\n'
  + '</task-notification>';

test('a queued live update is recorded as a queue-operation carrying the delivered text', () => {
  // Byte identity with the capture: 433 recorded bytes, rebuilt by the real taskPrompt() builder.
  assert.equal(Buffer.byteLength(QUEUED_STEER_PROMPT, 'utf8'), 433);
  // Why three live updates timed out: the user-record channel cannot see this record at all.
  assert.equal(userPromptRecordText(queueEnqueue(QUEUED_STEER_PROMPT)), '');
  assert.equal(userPromptRecordText(queuedCommandAttachment(QUEUED_STEER_PROMPT)), '');

  // Delivery evidence is the enqueue verb and nothing else, because a human deleting a queued
  // message leaves the queue with the same verb as consuming it.
  assert.equal(queuedPromptRecordText(queueEnqueue(QUEUED_STEER_PROMPT)), QUEUED_STEER_PROMPT);
  assert.equal(submittedPromptMatches(
    queuedPromptRecordText(queueEnqueue(QUEUED_STEER_PROMPT)),
    [QUEUED_STEER_PROMPT],
  ), true);
  for (const record of [
    queueRemove(QUEUED_STEER_PROMPT),
    { ...queueEnqueue(QUEUED_STEER_PROMPT), operation: 'dequeue' },
    queuedCommandAttachment(QUEUED_STEER_PROMPT),
    // Our text without the queue framing is not a queue record.
    userPrompt(QUEUED_STEER_PROMPT),
    // The framing with nothing usable inside it, which this repository's own fixtures produce.
    { type: 'queue-operation', operation: 'enqueue', content: null },
    { type: 'queue-operation', operation: 'enqueue' },
    null,
  ]) {
    assert.equal(queuedPromptRecordText(record), '');
  }

  // Boundary release: every verb that is not enqueue, plus the consumption attachment. It proves
  // only that the text stopped waiting, never that it was accepted.
  assert.equal(releasedQueuedPromptRecordText(queueRemove(QUEUED_STEER_PROMPT)), QUEUED_STEER_PROMPT);
  assert.equal(releasedQueuedPromptRecordText({
    ...queueEnqueue(QUEUED_STEER_PROMPT),
    operation: 'dequeue',
  }), QUEUED_STEER_PROMPT);
  assert.equal(
    releasedQueuedPromptRecordText(queuedCommandAttachment(QUEUED_STEER_PROMPT)),
    QUEUED_STEER_PROMPT,
  );
  for (const record of [
    queueEnqueue(QUEUED_STEER_PROMPT),
    { type: 'attachment', attachment: { type: 'image', prompt: QUEUED_STEER_PROMPT } },
    { type: 'attachment', attachment: { type: 'queued_command', prompt: null } },
    userPrompt(QUEUED_STEER_PROMPT),
    null,
  ]) {
    assert.equal(releasedQueuedPromptRecordText(record), '');
  }

  // The queued channel adds no match surface of its own: correlation is the same byte-exact pair
  // the user-record channel uses, so every negative there stays negative here.
  const framingWithoutOurText = queuedPromptRecordText(queueEnqueue(QUEUED_TASK_NOTIFICATION));
  assert.equal(framingWithoutOurText, QUEUED_TASK_NOTIFICATION);
  for (const foreign of [
    QUEUED_STEER_PROMPT.slice(0, QUEUED_STEER_PROMPT.length - 1),
    QUEUED_STEER_PROMPT.slice(1),
    `${QUEUED_STEER_PROMPT} and one more sentence`,
    taskPrompt({ prompt: 'a different live update', attachments: [] }),
    QUEUED_TASK_NOTIFICATION,
    '<agent-message from="fullstack-engineer">done</agent-message>',
    '',
  ]) {
    assert.equal(
      submittedPromptMatches(queuedPromptRecordText(queueEnqueue(foreign)), [QUEUED_STEER_PROMPT]),
      false,
    );
  }

  // An image-bearing live update. Which form Claude writes into `content` is unobserved, so both
  // the raw text and the session-cumulative chip rewrite are correlated, exactly as the
  // user-record channel does, and a truncation of either is still refused.
  const imageSteer = {
    prompt: 'look at this while you work',
    attachments: [{ id: 'live', name: 'live.png', path: IMAGE_PATH }],
  };
  const imageDelivered = taskPrompt(imageSteer);
  const imageForms = attachmentRewrittenPromptForms(imageDelivered, [IMAGE_PATH]);
  const cumulative = renumberChips(attachmentRewrittenPrompts(imageDelivered, [IMAGE_PATH])[0], 4);
  assert.equal(submittedPromptMatches(
    queuedPromptRecordText(queueEnqueue(imageDelivered)),
    [imageDelivered],
  ), true);
  assert.equal(submittedRewrittenPromptMatches(
    queuedPromptRecordText(queueEnqueue(cumulative)),
    imageForms,
  ), true);
  assert.equal(submittedRewrittenPromptMatches(
    queuedPromptRecordText(queueEnqueue(cumulative.slice(0, cumulative.length - 1))),
    imageForms,
  ), false);
  assert.equal(submittedRewrittenPromptMatches(
    queuedPromptRecordText(queueEnqueue(QUEUED_STEER_PROMPT)),
    imageForms,
  ), false);
});

test('injectionPromptIssue rejects NUL bytes and oversized prompts, accepts normal prompts', () => {
  assert.match(injectionPromptIssue(`ok${NUL}bad`), /NUL/i);
  assert.match(injectionPromptIssue('x'.repeat(50), { maxBytes: 10 }), /larger than/i);
  assert.equal(injectionPromptIssue('a normal multiline\nprompt "here"'), null);
});

test('Claude terminal relaunch commands pin settings and preserve the same session', () => {
  assert.equal(
    claudeTerminalRelaunchCommand({
      command: '/Applications/Claude Code/claude',
      sessionId: SESSION_ID,
      resumed: true,
      model: 'opus',
      effort: 'max',
    }),
    `'/Applications/Claude Code/claude' --dangerously-skip-permissions --resume '${SESSION_ID}' --model 'opus' --effort 'max'`,
  );
  assert.equal(
    claudeTerminalRelaunchCommand({
      sessionId: SESSION_ID,
      resumed: false,
      effort: 'high',
    }),
    `'claude' --dangerously-skip-permissions --session-id '${SESSION_ID}' --effort 'high'`,
  );
  assert.equal(
    claudeTerminalRelaunchCommand({
      sessionId: SESSION_ID,
      resumed: true,
      model: 'fable',
      effort: 'max',
      permissionMode: 'plan',
      tools: ['Read', 'Glob', 'Grep', 'AskUserQuestion'],
      addDirectories: ['/tmp/relay-plan-images'],
    }),
    `'claude' --permission-mode 'plan' --resume '${SESSION_ID}' --model 'fable' --effort 'max' --tools 'Read,Glob,Grep,AskUserQuestion' --add-dir '/tmp/relay-plan-images'`,
  );
  assert.equal(
    claudeTerminalRelaunchCommand({
      sessionId: SESSION_ID,
      resumed: true,
      settings: {
        hooks: {
          Stop: [{
            hooks: [{
              type: 'http',
              url: 'http://127.0.0.1:58925/api/internal/claude-hooks/token',
              timeout: 1,
            }],
          }],
        },
      },
    }),
    `'claude' --dangerously-skip-permissions --resume '${SESSION_ID}' --settings '{"hooks":{"Stop":[{"hooks":[{"type":"http","url":"http://127.0.0.1:58925/api/internal/claude-hooks/token","timeout":1}]}]}}'`,
  );
});

// ---- terminal screen classification (production shapes) ----------------------
//
// The composer frame below is byte-for-byte the structure a live Claude Code 2.1.220 tab returned
// through `Application('Terminal').windows.byId(id).tabs[0].contents()` on Darwin 25.5.0, captured
// read-only during this work. Three facts in it drive the whole design and are asserted here:
// the caret glyph is `❯`, the caret line is NOT the last non-empty line (status chrome follows it),
// and `contents()` is the viewport rather than the scrollback.
const LIVE_COMPOSER_CAPTURE = [
  '',
  '  ⎿  Backgrounded agent (↓ to manage · ctrl+o to expand)',
  '',
  '⏺ Both developers are now working in parallel:',
  '',
  '  - dev-1 is implementing the fix in src/claude-terminal-executor.mjs',
  '  - dev-2 is running a private pty probe against a synthetic session',
  '',
  '✻ Waiting for 2 background agents to finish',
  '',
  '  4 tasks (0 done, 2 in progress, 2 open)',
  '  ◼ dev-1: resume-picker guard, composer verification, and re-arm',
  '  ◻ code-review: adversarial review of executor changes › blocked by #1',
  '                                                                                        ',
  '────────────────────────────────────────────────────────────────────────────────────────',
  '❯ tell me when to restart relay',
  '────────────────────────────────────────────────────────────────────────────────────────',
  '  dev@host:~/WebstormProjects/relay  main  Fable 5  ctx:22%                              ',
  '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents',
  '',
  '  ⏺ main',
  '',
].join('\n');

test('the composer is recognized in a captured live Claude Code 2.1.220 frame', () => {
  assert.equal(classifyClaudeScreen(LIVE_COMPOSER_CAPTURE), 'composer');
  assert.deepEqual(claudeComposerContent(LIVE_COMPOSER_CAPTURE), {
    found: true,
    text: 'tell me when to restart relay',
  });
  // Relative to a different prompt that text is somebody else's unsubmitted note, not this turn's
  // paste. Relative to itself it is a held paste. Nothing else in the frame changes that.
  assert.equal(claudeComposerState(LIVE_COMPOSER_CAPTURE, 'List the files.'), 'junk');
  assert.equal(claudeComposerState(LIVE_COMPOSER_CAPTURE, 'tell me when to restart relay'), 'held');

  // Task 39's exact composer: two image chips and the collapsed placeholder for a 202 line prompt.
  // A four or more line paste never renders its text, so the placeholder and its line count are
  // the only held signal that can work for a real CC Relay prompt.
  const councilPrompt = Array.from({ length: 202 }, (_, index) => `plan line ${index}`).join('\n');
  assert.equal(expectedPastePlaceholderLines(councilPrompt), 201);
  const held = LIVE_COMPOSER_CAPTURE.replace(
    '❯ tell me when to restart relay',
    '❯ [Image #3] [Image #4][Pasted text #5 +201 lines]',
  );
  assert.equal(claudeComposerState(held, councilPrompt), 'held');
  // The same placeholder against a prompt of a different size is somebody else's paste, and
  // pressing Return would submit it as this task's prompt.
  assert.equal(claudeComposerState(held, 'List the files.'), 'junk');

  // A live empty composer renders as the bare caret with no placeholder text at all.
  const empty = LIVE_COMPOSER_CAPTURE.replace('❯ tell me when to restart relay', '❯ ');
  assert.equal(classifyClaudeScreen(empty), 'composer');
  assert.equal(claudeComposerState(empty, 'List the files.'), 'empty');
});

test('the status row family recognizes every composer state, including a held paste', () => {
  // Verified: a held multi-line paste REPLACES "shift+tab to cycle" with "paste again to expand",
  // so a detector that required the former would report not-ready at exactly the moment CC Relay
  // has just pasted. And "bypass permissions on" is absent on the --permission-mode plan branch
  // every council stage launches with, so it can never be the only marker.
  const withHeldPaste = LIVE_COMPOSER_CAPTURE
    .replace('❯ tell me when to restart relay', '❯ [Pasted text #2 +11 lines]')
    .replace('  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents', '  paste again to expand');
  assert.equal(classifyClaudeScreen(withHeldPaste), 'composer');

  // A plan-mode council stage: no bypass row at all.
  const planMode = LIVE_COMPOSER_CAPTURE
    .replace('  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents', '  ⏸ plan mode on (shift+tab to cycle)');
  assert.equal(classifyClaudeScreen(planMode), 'composer');

  // Just after a clear, the transient exit hint is the only status text on screen.
  const afterClear = LIVE_COMPOSER_CAPTURE
    .replace('❯ tell me when to restart relay', '❯ ')
    .replace('  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents', '  Press Ctrl-C again to exit');
  assert.equal(classifyClaudeScreen(afterClear), 'composer');
  assert.equal(claudeComposerState(afterClear, 'List the files.'), 'empty');
});

// The frame a text-only live steer actually leaves on screen, reproduced from a Claude Code
// 2.1.224 capture taken through a private pty at 80 columns on Darwin 25.5.0. The workspace and
// host row are neutralized; every structural fact is byte-faithful.
//
// This is THE shape the old classifier could not read. A single-line follow-up message becomes a
// THREE line paste once taskPrompt() appends the non-interactive notice after a blank line, three
// lines are under the collapse threshold, so the text renders literally and word-wraps over four
// rows. That puts the caret nine non-empty lines above the bottom of the screen, past the former
// CLAUDE_COMPOSER_MAX_TAIL_DEPTH of 8, so claudeComposerContent() reported found:false and the
// whole guarded submit schedule classified it as 'unreadable' and sent nothing at all.
const LIVE_TEXT_STEER_CAPTURE = [
  '⏺ Working on the previous instruction.',
  '',
  '────────────────────────────────────────────────────────────────────────────────',
  '❯ also fix the spacing in the header',
  '',
  '  CC Relay orchestrator notice: this is a non-interactive run and no answers',
  '  can be provided. Do not ask questions, request approval, or wait for user',
  '  input. Make reasonable assumptions and proceed autonomously. If progress is',
  '  impossible, report the blocker and end the run.',
  '────────────────────────────────────────────────────────────────────────────────',
  '  dev@host:/private/tmp/probe-cwd',
  '  ⏵⏵ bypass permissions on (shift+tab to cycle)',
  '                                                                            /rc',
].join('\n');

test('a text-only live steer is recognized in its captured multi-row composer frame', () => {
  const delivered = taskPrompt({
    prompt: 'also fix the spacing in the header',
    attachments: [],
  });
  // The exact reason this frame exists: three lines never collapse.
  assert.equal(delivered.split('\n').length, 3);
  assert.ok(delivered.split('\n').length < CLAUDE_PASTE_COLLAPSE_MIN_LINES);

  // The caret sits deeper than the one-row composer bound, which is the whole defect.
  const tail = claudeScreenTailLines(LIVE_TEXT_STEER_CAPTURE);
  const caretIndex = tail.findIndex((line) => line.startsWith('❯'));
  assert.ok(caretIndex >= 0);
  assert.ok(
    tail.length - caretIndex > CLAUDE_COMPOSER_MAX_TAIL_DEPTH,
    'the captured caret must sit past the one-row composer depth bound',
  );

  assert.equal(classifyClaudeScreen(LIVE_TEXT_STEER_CAPTURE), 'composer');
  assert.equal(claudeComposerContent(LIVE_TEXT_STEER_CAPTURE).found, true);
  // Positive: this exact update is visibly held, so a guarded Return is allowed.
  assert.equal(claudeComposerState(LIVE_TEXT_STEER_CAPTURE, delivered), 'held');
  // Negative, unchanged: relative to somebody else's prompt the same frame is foreign text.
  assert.equal(claudeComposerState(LIVE_TEXT_STEER_CAPTURE, taskPrompt({
    prompt: 'a completely different instruction',
    attachments: [],
  })), 'junk');

  // An empty composer in the same chrome still reads empty, so widening the search cannot turn a
  // cleared composer into a held one on the opening-prompt path that re-injects for 'empty'.
  const emptied = LIVE_TEXT_STEER_CAPTURE
    .split('\n')
    .filter((line) => !line.startsWith('  CC Relay orchestrator') && !line.startsWith('  can be')
      && !line.startsWith('  input.') && !line.startsWith('  impossible,'))
    .join('\n')
    .replace('❯ also fix the spacing in the header', '❯ ');
  assert.equal(claudeComposerState(emptied, delivered), 'empty');
});

test('the composer scan is bounded by the chrome below its closing rule', () => {
  // A caret with more than the allowed chrome below its closing rule is transcript, not a
  // composer. This is what replaces the old raw depth bound, and it is what stops a replayed
  // `❯ user message` from being read as the input box.
  const replayed = [
    '❯ an earlier user message replayed by --resume',
    ...Array.from({ length: CLAUDE_COMPOSER_MAX_CHROME_LINES + 2 }, (_, i) => `⏺ output line ${i}`),
    SCREEN_RULE,
    ...Array.from({ length: CLAUDE_COMPOSER_MAX_CHROME_LINES + 2 }, (_, i) => `  trailing ${i}`),
  ].join('\n');
  assert.equal(claudeComposerContent(replayed).found, false);
  assert.equal(claudeComposerState(replayed, 'anything at all'), 'unreadable');

  // A composer taller than the composer scan window fails closed rather than guessing.
  const enormous = composerFrame(
    Array.from({ length: CLAUDE_COMPOSER_TAIL_LINES + 5 }, (_, i) => `row ${i}`).join('\n'),
  );
  assert.equal(claudeComposerContent(enormous).found, false);

  // Widening the scan must not let a composer read 'empty' that could not read 'empty' before,
  // because on the opening-prompt path 'empty' re-injects the whole prompt. It cannot: an empty
  // composer is one body row, and blank rows are filtered out of the tail before classification,
  // so even an all-blank body collapses to the shallow shape the old bound already accepted.
  const blankBody = composerFrame('\n\n\n\n\n');
  const blankTail = claudeScreenTailLines(blankBody);
  const blankCaret = blankTail.findIndex((line) => line.startsWith('❯'));
  assert.ok(blankTail.length - blankCaret <= CLAUDE_COMPOSER_MAX_TAIL_DEPTH);
  assert.equal(claudeComposerState(blankBody, 'an opening prompt'), 'empty');
});

test('a wrapped row that begins with a quote marker is not mistaken for the caret', () => {
  // The caret pattern also matches a plain `>`, and a literal multi-row paste can start a wrapped
  // row with one: a quoted error, a markdown blockquote, a diff marker. Taking that row as the
  // caret extracts only the TAIL of the paste, so this turn's own held text stops containing its
  // own first line and classifies as a foreign draft. On the steer path that silently ends
  // recovery; on the opening-prompt path 'junk' clears the composer CC Relay just pasted into.
  const deliveredPrompt = taskPrompt({
    prompt: 'please fix the crash below and keep the retry path intact '
      + '> TypeError: cannot read properties of undefined reading composer',
    attachments: [],
  });
  assert.equal(deliveredPrompt.split('\n').length, 3);
  const frame = heldPasteFrame(deliveredPrompt, { columns: 58 });
  // Prove the hazard is really present in this frame, otherwise the test would pass for free.
  const rows = frame.split('\n');
  assert.ok(
    rows.some((row) => row.startsWith('  >')),
    'the wrap must put a quote marker at the start of a continuation row',
  );

  assert.equal(claudeComposerContent(frame).found, true);
  // The whole paste is extracted, starting from the real caret, so it is still this turn's text.
  assert.match(claudeComposerContent(frame).text, /^please fix the crash below/);
  assert.equal(claudeComposerState(frame, deliveredPrompt), 'held');
  // The negative is unchanged: against a different prompt the same frame is still foreign text.
  assert.equal(claudeComposerState(frame, taskPrompt({
    prompt: 'something else entirely',
    attachments: [],
  })), 'junk');
});

test('held-paste verification follows the verified collapse threshold', () => {
  const frameWith = (content) => composerFrame(content, { statusRow: '  paste again to expand' });
  const lines = (count) => Array.from({ length: count }, (_, index) => `line ${index}`).join('\n');

  // Four or more lines collapse, so the placeholder is the only held signal available and its
  // count is what identifies the paste.
  assert.equal(expectedPastePlaceholderLines(lines(CLAUDE_PASTE_COLLAPSE_MIN_LINES)), 3);
  assert.equal(claudeComposerState(frameWith('[Pasted text #1 +3 lines]'), lines(4)), 'held');
  assert.equal(claudeComposerState(frameWith('[Pasted text #1 +39 lines]'), lines(40)), 'held');
  assert.equal(claudeComposerState(frameWith('[Pasted text #1 +39 lines]'), lines(12)), 'junk');

  // One to three lines never collapse, so any placeholder there is provably a foreign paste.
  assert.equal(claudeComposerState(frameWith('[Pasted text #1 +2 lines]'), lines(3)), 'junk');
  // They render literally instead, so the first line is the anchor. Image chips are tolerated.
  assert.equal(claudeComposerState(frameWith('Check the failing screenshot.'), 'Check the failing screenshot.'), 'held');
  assert.equal(
    claudeComposerState(frameWith('[Image #1]Check the failing screenshot.'), 'Check the failing screenshot.'),
    'held',
  );
  // Chips with no text yet are this turn's delivery in flight, not foreign text.
  assert.equal(claudeComposerState(frameWith('[Image #1] [Image #2]'), lines(9)), 'held');
});

test('the folder trust prompt is its own classification, never a composer', () => {
  // Byte-exact from the captured pty frame. Same chrome and same select widget as the picker.
  const trust = [
    ' Accessing workspace:',
    '',
    ' /private/tmp/probe',
    '',
    ' Quick safety check: Is this a project you created or one you trust? (Like your own code, a',
    ' well-known open source project, or work from your team).',
    '',
    " Claude Code'll be able to read, edit, and execute files here.",
    '',
    ' ❯ 1. Yes, I trust this folder',
    '   2. No, exit',
    '',
    ' Enter to confirm · Esc to cancel',
  ].join('\n');
  assert.equal(classifyClaudeScreen(trust), 'trust-dialog');
  assert.equal(claudeComposerContent(trust).found, false);
});

test('a multi-line composer keeps its whole text, including a separator line inside the prompt', () => {
  // A structured brief with its own dashed separator. An unanchored rule test, or one that stopped
  // at the FIRST rule below the caret, would cut the composer text at that separator and could
  // then read a held paste as junk or as empty.
  const prompt = [
    'You are the author of the plan.',
    '--------',
    'Ship the release notes.',
  ].join('\n');
  const frame = [
    '⏺ Ready.',
    '',
    '────────────────────────────────────────',
    '❯ You are the author of the plan.',
    '  --------',
    '  Ship the release notes.',
    '────────────────────────────────────────',
    '  dev@host:~/repo  main  Fable 5  ctx:4%',
    '  ⏵⏵ bypass permissions on (shift+tab to cycle)',
  ].join('\n');

  assert.equal(classifyClaudeScreen(frame), 'composer');
  assert.deepEqual(claudeComposerContent(frame), {
    found: true,
    text: 'You are the author of the plan.\n--------\nShip the release notes.',
  });
  assert.equal(claudeComposerState(frame, prompt), 'held');
});

test('the resume picker is recognized at every captured width, and never from prose', () => {
  // Byte-exact from the 100x40 pty capture, including the leading two-space indent, the U+276F
  // pointer on the selected row only, and the ASCII apostrophe in "Don't".
  const wide = [
    '  PROBE ASSISTANT TURN 89 block 8: The disposable terminal pool reserves provider capacity',
    '  before launching a native terminal, binds only the session proven to belong to that launch.',
    '',
    '────────────────────────────────────────────────────────────────────────────────────────────',
    '  This session is 4h 30m old and 215.6k tokens.',
    '',
    '  Resuming the full session will consume a substantial portion of your usage limits. We recommend',
    '  resuming from a summary.',
    '',
    '  ❯ 1. Resume from summary (recommended)',
    '    2. Resume full session as-is',
    "    3. Don't ask me again",
    '',
    '  Enter to confirm · Esc to cancel',
  ].join('\n');
  assert.equal(classifyClaudeScreen(wide), 'resume-picker');
  // The highlighted option carries the same `❯` glyph as the composer caret, so a picker must
  // never be mistaken for a composer with text in it.
  assert.equal(claudeComposerContent(wide).found, false);

  // The same dialog at 44 columns, where the title and the body sentence wrap across lines but
  // every option label and the footer still fit on one line each. This is exactly why the title
  // and body are never matched and the option rows are.
  const narrow = [
    '  Claude limits.',
    '',
    '────────────────────────────────────────────',
    '  This session is 4h 37m old and 215.6k',
    '  tokens.',
    '',
    '  Resuming the full session will consume a',
    '  substantial portion of your usage',
    '  limits. We recommend resuming from a',
    '  summary.',
    '',
    '  ❯ 1. Resume from summary (recommended)',
    '    2. Resume full session as-is',
    "    3. Don't ask me again",
    '',
    '  Enter to confirm · Esc to cancel',
  ].join('\n');
  assert.equal(classifyClaudeScreen(narrow), 'resume-picker');

  // Both option phrases quoted inside a Claude message, with a real composer underneath. Sending
  // keys here would type a digit and a Return into a live composer, so prose must never match.
  const prose = LIVE_COMPOSER_CAPTURE.replace(
    '⏺ Both developers are now working in parallel:',
    [
      '⏺ The dialog offers Resume from summary, which compacts the conversation, and',
      '  Resume full session as-is, which loads it unchanged. Enter to confirm picks one.',
    ].join('\n'),
  );
  assert.equal(classifyClaudeScreen(prose), 'composer');

  // Even a numbered list that quotes the labels is not the widget: the wrapped body sentence of
  // the real dialog is never matched, and prose lacks the rendered option rows plus footer pair.
  const quotedList = LIVE_COMPOSER_CAPTURE.replace(
    '⏺ Both developers are now working in parallel:',
    '⏺ Resuming the full session will consume a substantial portion of your usage limits.',
  );
  assert.equal(classifyClaudeScreen(quotedList), 'composer');
});

test('an unknown dialog is never classified as a composer and yields a readable excerpt', () => {
  const dialog = [
    '  A question nobody has seen before',
    '',
    '  ❯ 1. Do the thing',
    '    2. Do not do the thing',
    '',
    '  Enter to confirm · Esc to cancel',
  ].join('\n');
  assert.equal(classifyClaudeScreen(dialog), 'unknown');
  assert.equal(claudeComposerState(dialog, 'List the files.'), 'unreadable');
  assert.match(claudeScreenExcerpt(dialog), /Do the thing/);

  // Nothing readable at all is unknown, never a composer.
  assert.equal(classifyClaudeScreen(''), 'unknown');
  assert.equal(classifyClaudeScreen(null), 'unknown');
  assert.equal(classifyClaudeScreen('   \n  \n'), 'unknown');
});

test('screen classification is bounded so old output can never decide the current state', () => {
  // A tab whose viewport somehow carries a huge amount of text still classifies on its tail only.
  const noise = `${'filler output line\n'.repeat(5000)}${LIVE_COMPOSER_CAPTURE}`;
  assert.equal(classifyClaudeScreen(noise), 'composer');
  assert.equal(claudeComposerContent(noise).text, 'tell me when to restart relay');
  assert.ok(claudeScreenTailLines(noise).length <= 15);

  // A real picker that has scrolled out of the current state cannot reach the classifier.
  const stale = [
    '  ❯ 1. Resume from summary (recommended)',
    '    2. Resume full session as-is',
    '  Enter to confirm · Esc to cancel',
    ...Array.from({ length: 40 }, (_, index) => `⏺ later output line ${index}`),
    '────────────────────────────────────────',
    '❯ ',
    '────────────────────────────────────────',
    '  ⏵⏵ bypass permissions on (shift+tab to cycle)',
  ].join('\n');
  assert.equal(classifyClaudeScreen(stale), 'composer');

  // And a replayed user message carrying the caret, far above the bottom, is not a composer box.
  const replayed = [
    '❯ an earlier user message replayed by --resume',
    ...Array.from({ length: 12 }, (_, index) => `⏺ assistant output line ${index}`),
  ].join('\n');
  assert.equal(claudeComposerContent(replayed).found, false);
  assert.equal(classifyClaudeScreen(replayed), 'unknown');
});

// ---- harness -----------------------------------------------------------------

function fakeTranscript({ present = true } = {}) {
  let content = Buffer.alloc(0);
  let created = present;
  // A transient FS failure makes statSync throw, so both size() and existsSync report failure
  // at the same instant. The fake mirrors that coupling: while statFails is armed, size()
  // returns -1 AND exists() returns false, exactly as production would during the failure the
  // Issue 14 guard must survive without trusting a concurrent existence check.
  let statFails = 0;
  return {
    source: {
      path: '/fake/transcript.jsonl',
      state: () => {
        if (statFails > 0) return 'unreadable';
        return created ? 'present' : 'absent';
      },
      exists: () => (statFails > 0 ? false : created),
      size: () => {
        if (statFails > 0) { statFails -= 1; return -1; }
        return created ? content.length : -1;
      },
      readFrom: (offset) => content.subarray(offset),
    },
    append(record) { created = true; content = Buffer.concat([content, Buffer.from(`${JSON.stringify(record)}\n`)]); },
    appendRaw(value) { created = true; content = Buffer.concat([content, Buffer.from(value)]); },
    shrinkToZero() { content = Buffer.alloc(0); },
    failStat(count = Infinity) { statFails = count; },
  };
}

// Each step drives one readConnectedSession call: its status, optional transcript records
// to append, and an optional mutate hook. status:null returns a missing session.
function sessionSteps(steps, fake) {
  let i = 0;
  return {
    readConnectedSession: async () => {
      const step = steps[Math.min(i, steps.length - 1)] || {};
      i += 1;
      if (step.append && fake) for (const record of step.append) fake.append(record);
      if (step.mutate) step.mutate();
      if (step.status === null) return null;
      const status = step.status || 'idle';
      return { id: SESSION_ID, source: 'Claude interactive', cwd: '/repo', rawStatus: status, pid: PID };
    },
  };
}

function mockClock() {
  let value = 0;
  return { now: () => value, wait: async (ms) => { value += ms; await Promise.resolve(); } };
}

const baseTask = {
  id: 7,
  thread_id: SESSION_ID,
  thread_name: 'relay-9',
  repo_path: '/repo',
  prompt: 'List the files.',
  provider: 'claude',
  attachments: [],
};

const deliveredPrompt = (task = baseTask) => taskPrompt(task);

function collect() {
  const events = [];
  const stderr = [];
  return {
    onEvent: (event) => events.push(event),
    onStderr: (line) => stderr.push(line),
    events,
    stderr,
    types: () => events.map((entry) => entry.event.type),
  };
}

const assistant = (stop, blocks) => ({ type: 'assistant', message: { stop_reason: stop, content: blocks } });
const text = (value) => ({ type: 'text', text: value });
const thinking = (value) => ({ type: 'thinking', thinking: value });
const toolUse = (id, name, input) => ({ type: 'tool_use', id, name, input });
const userPrompt = (value, promptId = null) => ({
  type: 'user',
  ...(promptId ? { promptId } : {}),
  message: { content: [text(value)] },
});
const toolResult = (id, value) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: value }] } });
const BACKGROUND_AGENT_TOOL_USE_ID = 'toolu_background_dev_1';
const BACKGROUND_AGENT_ID = 'agent-background-dev-1';
const backgroundAgentLaunch = () => assistant('tool_use', [toolUse(
  BACKGROUND_AGENT_TOOL_USE_ID,
  'Agent',
  {
    description: 'dev-1: completion gate',
    subagent_type: 'fullstack-engineer',
    prompt: 'Verify the completion gate.',
  },
)]);
const backgroundAgentResult = () => ({
  type: 'user',
  toolUseResult: {
    isAsync: true,
    status: 'async_launched',
    agentId: BACKGROUND_AGENT_ID,
  },
  message: {
    content: [{
      type: 'tool_result',
      tool_use_id: BACKGROUND_AGENT_TOOL_USE_ID,
      content: `Async agent launched successfully.\nagentId: ${BACKGROUND_AGENT_ID}\nThe agent is working in the background.`,
    }],
  },
});
const backgroundAgentNotification = () => queueEnqueue(
  QUEUED_TASK_NOTIFICATION
    .replaceAll('a21d93d8cd05ec4fb', BACKGROUND_AGENT_ID)
    .replaceAll('toolu_012M2JjykSAMBUw7JewJMYeX', BACKGROUND_AGENT_TOOL_USE_ID)
    .replace('dev-2: standby core developer', 'dev-1: completion gate'),
);
const turnDuration = (pendingBackgroundAgentCount) => ({
  type: 'system',
  subtype: 'turn_duration',
  pendingBackgroundAgentCount,
});
// How Claude stores a prompt that carried images: one rewritten text block plus one image block
// per attachment, which is why the raw delivered text can never anchor such a turn.
const imagePromptRecord = (value, images = 1) => ({
  type: 'user',
  message: {
    content: [
      text(value),
      ...Array.from({ length: images }, () => ({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
      })),
    ],
  },
});

// ---- terminal screen frames --------------------------------------------------
//
// Every frame below reproduces the structure of a real Claude Code 2.1.220 screen captured
// read-only from a live Terminal tab on Darwin 25.5.0: a horizontal rule, the `❯` caret line, a
// closing rule, and the status chrome underneath. `contents()` returns the viewport, not the
// scrollback (3025 characters against 6270 of history on the captured tab), which is what makes
// tail classification safe.
const SCREEN_RULE = '─'.repeat(100);
// The composer exactly as Claude Code 2.1.220 renders it: an opening rule, the `❯` caret line, a
// closing rule, then the status row family. Reproduced from dev-2's pty frames at 100x40 and from
// a live Terminal.app `contents()` read on Darwin 25.5.0.
// Inner width of the composer box: the rule minus the two column `❯ ` gutter.
const COMPOSER_INNER_WIDTH = SCREEN_RULE.length - 2;
// Claude Code WORD-wraps the literal rendering and hard-splits only a token that is longer than
// the box. Verified on the 2.1.224 pty capture: "...no answers can be provided. Do" / "not ask
// questions...". A 400 character unbroken token instead breaks exactly at the column boundary.
const wrapComposerRows = (text, width = COMPOSER_INNER_WIDTH) => {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (line === '') {
      rows.push('');
      continue;
    }
    let current = '';
    for (const word of line.split(' ')) {
      let token = word;
      while (token.length > width) {
        if (current) {
          rows.push(current);
          current = '';
        }
        rows.push(token.slice(0, width));
        token = token.slice(width);
      }
      if (!current) {
        current = token;
      } else if (current.length + 1 + token.length <= width) {
        current = `${current} ${token}`;
      } else {
        rows.push(current);
        current = token;
      }
    }
    rows.push(current);
  }
  return rows;
};
const composerFrame = (content = '', {
  scrollback = ['⏺ Ready.'],
  statusRow = '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents',
} = {}) => {
  const [first = '', ...rest] = String(content).split('\n');
  return [
    ...scrollback,
    '',
    SCREEN_RULE,
    `❯ ${first}`.trimEnd(),
    // Continuation rows sit in the same box under the caret gutter.
    ...rest.map((row) => `  ${row}`.trimEnd()),
    SCREEN_RULE,
    '  dev@host:/private/tmp/probe',
    statusRow,
    '                                                                                          /rc',
  ].join('\n');
};
// A multi-line paste never renders its text: Claude collapses it to `[Pasted text #N +M lines]`
// where M is the pasted line count minus one, and the status row swaps to "paste again to expand".
// The frame is derived from what was actually pasted so the fake terminal reports the same count a
// real one would, which is what the held-paste verification checks against.
//
// A paste of one to three lines does NOT collapse. It renders every line, word-wrapped over as
// many composer rows as it needs, which is what a real terminal draws and what this fixture used
// to hide by emitting only the first non-empty line on a single row. Every text-only live steer is
// exactly that shape, because taskPrompt() appends the non-interactive notice after a blank line
// and keeps the paste under the collapse threshold. See [[claude-steer-text-hold-reliability]].
const heldPasteFrame = (pasted, { chips = '', counter = 5, columns = null } = {}) => {
  // The terminal consumes the bracketed paste markers, so they never appear on screen.
  const text = String(pasted ?? '')
    .split(`${ESC}[200~`).join('')
    .split(`${ESC}[201~`).join('');
  const lines = text.split(/\r?\n/);
  // Faithful to the verified behavior: one to three lines render literally and keep the normal
  // status row, four or more collapse into the placeholder and swap the row.
  if (lines.length < CLAUDE_PASTE_COLLAPSE_MIN_LINES) {
    const rows = wrapComposerRows(`${chips}${text}`, columns || COMPOSER_INNER_WIDTH);
    return composerFrame(rows.join('\n'));
  }
  return composerFrame(
    `${chips}[Pasted text #${counter} +${expectedPastePlaceholderLines(text)} lines]`,
    { statusRow: '  paste again to expand' },
  );
};
// A live empty composer renders as the bare caret with nothing after it: no placeholder text.
const EMPTY_COMPOSER_FRAME = composerFrame('');
const JUNK_COMPOSER_FRAME = composerFrame('half typed note from the user');
// The Claude Code 2.1.220 large-session resume picker, byte-exact from the 100x40 capture. Option 1
// carries the same U+276F pointer the composer caret uses, which is why dialogs are classified
// first. The title and body sentence wrap at narrower widths and are never matched.
const RESUME_PICKER_FRAME = [
  '  PROBE ASSISTANT TURN 89 block 8: The disposable terminal pool reserves provider capacity',
  '  before launching a native terminal, binds only the session proven to belong to that launch.',
  '',
  SCREEN_RULE,
  '  This session is 4h 30m old and 215.6k tokens.',
  '',
  '  Resuming the full session will consume a substantial portion of your usage limits. We recommend',
  '  resuming from a summary.',
  '',
  '  ❯ 1. Resume from summary (recommended)',
  '    2. Resume full session as-is',
  "    3. Don't ask me again",
  '',
  '  Enter to confirm · Esc to cancel',
].join('\n');
// The folder trust prompt, byte-exact from the same capture. Identical chrome, two options.
const TRUST_DIALOG_FRAME = [
  ' Accessing workspace:',
  '',
  ' /private/tmp/probe',
  '',
  ' Quick safety check: Is this a project you created or one you trust? (Like your own code, a',
  ' well-known open source project, or work from your team).',
  '',
  " Claude Code'll be able to read, edit, and execute files here.",
  '',
  ' ❯ 1. Yes, I trust this folder',
  '   2. No, exit',
  '',
  ' Enter to confirm · Esc to cancel',
].join('\n');
// Any dialog CC Relay has never seen. It must never be typed into and must never be answered.
const UNKNOWN_DIALOG_FRAME = [
  '  A brand new question nobody has seen before',
  '',
  '  ❯ 1. Do the thing',
  '    2. Do not do the thing',
  '',
  '  Enter to confirm · Esc to cancel',
].join('\n');

// Scripted screen reader. Each entry is one snapshot and the last entry repeats forever, exactly
// like sessionSteps drives readConnectedSession. `null` models an unreadable screen.
function screenFrames(frames) {
  const reads = [];
  const reader = async (terminalWindowId) => {
    const entry = frames[Math.min(reads.length, frames.length - 1)];
    const frame = typeof entry === 'function' ? entry() : entry;
    reads.push({ terminalWindowId, frame });
    if (frame === null || frame === undefined) {
      return { ok: false, reason: 'window-missing', text: '' };
    }
    return { ok: true, reason: 'read', text: frame };
  };
  reader.reads = reads;
  return reader;
}

// Screen frames driven by what has actually been typed rather than by read count, which is how a
// real terminal behaves: an empty composer until CC Relay pastes, the held paste afterwards. Tests
// that need per-snapshot control still use screenFrames.
function phasedScreenFrames(beforePaste, afterPaste, hasPasted) {
  let beforeIndex = 0;
  let afterIndex = 0;
  const reads = [];
  const reader = async (terminalWindowId) => {
    const pasted = hasPasted();
    const list = pasted ? afterPaste : beforePaste;
    const index = pasted ? afterIndex : beforeIndex;
    if (pasted) afterIndex += 1; else beforeIndex += 1;
    const entry = list[Math.min(index, list.length - 1)];
    const frame = typeof entry === 'function' ? entry() : entry;
    reads.push({ terminalWindowId, frame, phase: pasted ? 'after' : 'before' });
    if (frame === null || frame === undefined) {
      return { ok: false, reason: 'window-missing', text: '' };
    }
    return { ok: true, reason: 'read', text: frame };
  };
  reader.reads = reads;
  return reader;
}

function makeExecutor(overrides = {}) {
  const injected = [];
  const submitted = [];
  const cancels = [];
  const keys = [];
  // Every terminal-facing action in dispatch order. Ordering is load bearing for the screen
  // gates: a dialog key must never be sent after a paste, and a paste must never precede the
  // composer verification that allowed it.
  const timeline = [];
  const clock = mockClock();
  const executor = new ClaudeTerminalExecutor({
    inject: async (windowId, value) => {
      injected.push({ windowId, value });
      timeline.push({ action: 'inject', windowId, value });
    },
    submit: async (windowId) => {
      submitted.push(windowId);
      timeline.push({ action: 'submit', windowId });
    },
    sendCancel: async (windowId) => cancels.push(windowId),
    sendKeys: async (windowId, value) => {
      keys.push({ windowId, value });
      timeline.push({ action: 'keys', windowId, value });
    },
    // Default: an empty composer until CC Relay pastes, then this turn's collapsed paste. Every
    // gate sees a healthy terminal, nothing needs clearing, and the guarded schedule sees a held
    // paste, so every case that predates screen verification behaves exactly as it did before.
    // Cases that exercise the new gates script their own frames.
    readScreen: phasedScreenFrames(
      [EMPTY_COMPOSER_FRAME],
      [() => heldPasteFrame(injected[injected.length - 1]?.value ?? '')],
      () => injected.length > 0,
    ),
    screenSettleMs: 500,
    now: clock.now,
    wait: clock.wait,
    pollMs: 1000,
    // Deterministic short guarded-submit timings so every case below runs on a handful of mock
    // clock ticks. Production defaults (a 6 s first attempt inside an 80 s submission window) are
    // asserted separately by the executor default test; cases that exercise the multi-attempt
    // schedule set submitRetryMs explicitly.
    submitNudgeMs: 1500,
    submitRetryMs: 8000,
    submitRetryBackoffMs: 0,
    submitConfirmMs: 1000,
    ...overrides,
  });
  return { executor, injected, submitted, cancels, keys, timeline, clock };
}

// ---- executor behaviour ------------------------------------------------------

test('terminal turn mirrors the transcript and completes on a stable idle after a final record', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const task = { ...baseTask, attachments: [{ name: 'bug.png', path: '/repo/.data/tasks/7/images/bug.png' }] };
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [userPrompt(deliveredPrompt(task)), assistant('tool_use', [toolUse('t1', 'Bash', { command: 'ls' })]), toolResult('t1', 'file.txt')] },
    { status: 'busy', append: [assistant('end_turn', [text('Listed the files.')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor, injected, submitted } = makeExecutor({ sessions, openTranscript: () => fake.source });
  const io = collect();

  const outcome = await executor.runTurn(task, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io);

  assert.equal(outcome.finalResponse, 'Listed the files.');
  assert.equal(outcome.sessionId, SESSION_ID);
  assert.equal(outcome.exitCode, 0);
  assert.equal(injected.length, 1);
  assert.equal(submitted.length, 0);
  assert.equal(injected[0].windowId, WINDOW_ID);
  assert.match(injected[0].value, /List the files\./);
  assert.match(injected[0].value, /\/repo\/\.data\/tasks\/7\/images\/bug\.png/);
  const started = io.events.filter((entry) => entry.event.type === 'claude/started');
  assert.equal(started.length, 1);
  assert.equal(started[0].event.sessionMode, 'terminal');
  assert.equal(io.types().includes('claude/completed'), false);
  assert.equal(io.types().includes('item/started'), true);
  assert.equal(io.types().includes('item/completed'), true);
  assert.equal(io.events.some((e) => e.event.type === 'claude/message' && /Listed the files\./.test(e.message)), true);
});

test('a backgrounded sub-agent blocks completion until it finishes and Claude consolidates', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const io = collect();
  let settled = false;
  const sessions = sessionSteps([
    { status: 'idle' },
    {
      status: 'busy',
      append: [
        userPrompt(deliveredPrompt()),
        backgroundAgentLaunch(),
        backgroundAgentResult(),
        assistant('end_turn', [text('Interim response while dev-1 is running.')]),
      ],
    },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle', append: [backgroundAgentNotification()] },
    {
      status: 'idle',
      mutate: () => {
        assert.equal(settled, false);
        assert.equal(
          io.events.filter((entry) => entry.event.deliveryState === 'background-work-finished').length,
          1,
        );
      },
    },
    { status: 'busy', append: [assistant('end_turn', [text('Consolidated response after dev-1 finished.')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor } = makeExecutor({ sessions, openTranscript: () => fake.source });

  const execution = executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );
  void execution.then(
    () => { settled = true; },
    () => { settled = true; },
  );
  const outcome = await execution;

  assert.equal(outcome.finalResponse, 'Consolidated response after dev-1 finished.');
  assert.equal(settled, true);
  const pending = io.events.filter(
    (entry) => entry.event.deliveryState === 'background-work-pending',
  );
  assert.equal(pending.length, 1);
  assert.equal(pending[0].event.backgroundWorkCount, 1);
  assert.match(pending[0].message, /dev-1: completion gate/);
  assert.equal(
    io.events.filter((entry) => entry.event.deliveryState === 'background-work-finished').length,
    1,
  );
});

test('a positive turn-duration count independently holds completion until a fresh final', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([
    { status: 'idle' },
    {
      status: 'busy',
      append: [
        userPrompt(deliveredPrompt()),
        turnDuration(1),
        assistant('end_turn', [text('Interim response with one pending agent.')]),
      ],
    },
    { status: 'idle' },
    { status: 'idle' },
    {
      status: 'busy',
      append: [
        turnDuration(0),
        assistant('end_turn', [text('Fresh response after the authoritative count cleared.')]),
      ],
    },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor } = makeExecutor({ sessions, openTranscript: () => fake.source });
  const io = collect();

  const outcome = await executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Fresh response after the authoritative count cleared.');
  assert.equal(
    io.events.filter((entry) => entry.event.deliveryState === 'background-work-pending').length,
    1,
  );
  assert.equal(
    io.events.filter((entry) => entry.event.deliveryState === 'background-work-finished').length,
    1,
  );
});

test('a Stop hook background task cannot be overridden by a transcript end_turn', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let liveHook = null;
  let settled = false;
  const io = collect();
  const hookBridge = {
    register: () => ({
      settings: { hooks: {} },
      activate: (handler) => {
        liveHook = handler;
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'UserPromptSubmit',
          prompt_id: 'prompt-background-task',
          prompt: deliveredPrompt(),
        });
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'Stop',
          prompt_id: 'prompt-background-task',
          last_assistant_message: 'Interim hook response.',
          background_tasks: [{ id: 'background-task-1' }],
          session_crons: [],
        });
        return true;
      },
      deactivate: () => true,
    }),
  };
  const sessions = sessionSteps([
    { status: 'idle' },
    {
      status: 'busy',
      append: [
        userPrompt(deliveredPrompt()),
        assistant('end_turn', [text('Transcript interim response.')]),
      ],
    },
    { status: 'idle' },
    { status: 'idle' },
    {
      status: 'idle',
      mutate: () => {
        assert.equal(settled, false);
        liveHook({
          session_id: SESSION_ID,
          hook_event_name: 'Stop',
          prompt_id: 'prompt-background-task',
          last_assistant_message: 'Fresh consolidated hook response.',
          background_tasks: [],
          session_crons: [],
        });
      },
    },
    { status: 'idle' },
  ], fake);
  const { executor } = makeExecutor({ sessions, hookBridge, openTranscript: () => fake.source });
  const execution = executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );
  void execution.then(
    () => { settled = true; },
    () => { settled = true; },
  );

  const outcome = await execution;
  assert.equal(outcome.finalResponse, 'Fresh consolidated hook response.');
  assert.equal(
    io.events.filter((entry) => entry.event.deliveryState === 'background-work-pending').length,
    1,
  );
});

// Tasks 218 and 223 (August 11 to 12, 2026 UTC) reproduced the task 129 wedge: a background
// sub-agent reports back, Claude re-invokes the parent with a prompt id CC Relay never submitted,
// and every Stop from those internal boundaries used to be dropped before it could replace the
// snapshot taken while the sub-agent was still running. Task 223 then failed with "1 background
// task had not finished when the terminal closed" three minutes after Claude had answered.
test('a Stop hook from a later prompt boundary clears the frozen background snapshot', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let liveHook = null;
  let settled = false;
  const io = collect();
  const hookBridge = {
    register: () => ({
      settings: { hooks: {} },
      activate: (handler) => {
        liveHook = handler;
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'UserPromptSubmit',
          prompt_id: 'prompt-a',
          prompt: deliveredPrompt(),
        });
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'Stop',
          prompt_id: 'prompt-a',
          last_assistant_message: 'Interim reply while dev-1 is still running.',
          background_tasks: [{ id: 'background-task-1' }],
          session_crons: [],
        });
        return true;
      },
      deactivate: () => true,
    }),
  };
  const sessions = sessionSteps([
    { status: 'idle' },
    {
      status: 'busy',
      append: [
        userPrompt(deliveredPrompt()),
        assistant('end_turn', [text('Interim transcript reply.')]),
      ],
    },
    { status: 'idle' },
    { status: 'idle' },
    {
      status: 'idle',
      mutate: () => {
        assert.equal(settled, false);
        liveHook({
          session_id: SESSION_ID,
          // The notification turn Claude ran on its own. CC Relay never submitted this prompt, so
          // this identifier can never become hookPromptId through any submission channel.
          hook_event_name: 'Stop',
          prompt_id: 'prompt-b',
          last_assistant_message: 'Done. Consolidated reply after every sub-agent finished.',
          background_tasks: [],
          session_crons: [],
        });
      },
    },
    { status: 'idle' },
  ], fake);
  const { executor } = makeExecutor({
    sessions,
    hookBridge,
    openTranscript: () => fake.source,
    // Bounds the pre-fix behaviour: with the snapshot frozen nothing else refreshes activity, so
    // the wedge fails on the inactivity ceiling instead of running the harness forever.
    inactivityCeilingMs: 30_000,
  });
  const execution = executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );
  void execution.then(
    () => { settled = true; },
    () => { settled = true; },
  );

  const outcome = await execution;
  assert.equal(outcome.finalResponse, 'Done. Consolidated reply after every sub-agent finished.');
  assert.equal(
    io.events.filter((entry) => entry.event.deliveryState === 'background-work-pending').length,
    1,
  );
  assert.equal(
    io.events.filter((entry) => entry.event.deliveryState === 'background-work-finished').length,
    1,
  );
});

test('a later Stop survives the stale pending count until its closing duration clears it', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let liveHook = null;
  const finalResponse = 'Done after the background notification turn.';
  const io = collect();
  const hookBridge = {
    register: () => ({
      settings: { hooks: {} },
      activate: (handler) => {
        liveHook = handler;
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'UserPromptSubmit',
          prompt_id: 'prompt-a',
          prompt: deliveredPrompt(),
        });
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'Stop',
          prompt_id: 'prompt-a',
          last_assistant_message: 'Interim reply while dev-1 is still running.',
          background_tasks: [{ id: 'background-task-1' }],
          session_crons: [],
        });
        return true;
      },
      deactivate: () => true,
    }),
  };
  const sessions = sessionSteps([
    { status: 'idle' },
    {
      status: 'busy',
      append: [
        userPrompt(deliveredPrompt()),
        turnDuration(1),
        assistant('end_turn', [text('Interim transcript reply.')]),
      ],
    },
    { status: 'idle' },
    { status: 'idle' },
    {
      status: 'idle',
      // Claude writes the assistant record, posts Stop, then writes turn_duration. The Stop sees
      // the previous duration's count of one even though its own hook snapshot is already empty.
      append: [assistant('end_turn', [text(finalResponse)])],
      mutate: () => liveHook({
        session_id: SESSION_ID,
        hook_event_name: 'Stop',
        prompt_id: 'prompt-b',
        last_assistant_message: finalResponse,
        background_tasks: [],
        session_crons: [],
      }),
    },
    {
      status: 'idle',
      // JSON serialization omits the undefined property, matching the production closing record.
      append: [turnDuration(undefined)],
    },
    { status: 'idle' },
  ], fake);
  const { executor } = makeExecutor({
    sessions,
    hookBridge,
    openTranscript: () => fake.source,
    inactivityCeilingMs: 30_000,
  });

  const outcome = await executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, finalResponse);
  assert.equal(
    io.events.filter((entry) => (
      entry.event.type === 'claude/message'
      && entry.event.text === finalResponse
    )).length,
    1,
  );
  assert.equal(
    io.events.filter((entry) => entry.event.deliveryState === 'background-work-finished').length,
    1,
  );
});

// The same bookkeeping clear on the channel that has no Stop hook in it at all. Claude writes the
// consolidated assistant record first and its closing turn_duration after it, so the count still
// reads the previous boundary's value when the final is recorded and clears one record later. A
// terminal whose hooks never registered ends every turn this way, so the confirming clear cannot
// be reserved for the hook path.
test('a pending count cleared after the final assistant record still releases the turn', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const finalResponse = 'Consolidated response after the pending agent finished.';
  const sessions = sessionSteps([
    { status: 'idle' },
    {
      status: 'busy',
      append: [
        userPrompt(deliveredPrompt()),
        turnDuration(1),
        assistant('end_turn', [text('Interim response with one pending agent.')]),
      ],
    },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'busy', append: [assistant('end_turn', [text(finalResponse)])] },
    // JSON serialization omits the undefined property, matching the production closing record.
    { status: 'idle', append: [turnDuration(undefined)] },
    { status: 'idle' },
  ], fake);
  const { executor } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    inactivityCeilingMs: 30_000,
  });
  const io = collect();

  const outcome = await executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, finalResponse);
  assert.equal(
    io.events.filter((entry) => (
      entry.event.type === 'claude/message'
      && entry.event.text === finalResponse
    )).length,
    1,
  );
  assert.equal(
    io.events.filter((entry) => entry.event.deliveryState === 'background-work-pending').length,
    1,
  );
  assert.equal(
    io.events.filter((entry) => entry.event.deliveryState === 'background-work-finished').length,
    1,
  );
});

// The mismatched-Stop ordering where the closing turn_duration is already on disk when the hook
// arrives. The guard drains before it decides, so the count clears inside that drain and the
// pending-work fence then rejects the Stop, correctly: there is no frozen snapshot left to repair.
// The transcript final that same drain confirmed is the only final this turn produces, and the
// rejected hook must not re-emit it.
test('a Stop rejected by the pending fence still leaves the drained transcript final armed', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let liveHook = null;
  const finalResponse = 'Done after the background notification turn closed itself.';
  const io = collect();
  const hookBridge = {
    register: () => ({
      settings: { hooks: {} },
      activate: (handler) => {
        liveHook = handler;
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'UserPromptSubmit',
          prompt_id: 'prompt-a',
          prompt: deliveredPrompt(),
        });
        return true;
      },
      deactivate: () => true,
    }),
  };
  const sessions = sessionSteps([
    { status: 'idle' },
    {
      status: 'busy',
      append: [
        userPrompt(deliveredPrompt()),
        turnDuration(1),
        assistant('end_turn', [text('Interim transcript reply.')]),
      ],
    },
    { status: 'idle' },
    { status: 'idle' },
    {
      status: 'idle',
      append: [
        assistant('end_turn', [text(finalResponse)]),
        turnDuration(undefined),
      ],
      mutate: () => liveHook({
        session_id: SESSION_ID,
        hook_event_name: 'Stop',
        prompt_id: 'prompt-b',
        last_assistant_message: finalResponse,
        background_tasks: [],
        session_crons: [],
      }),
    },
    { status: 'idle' },
  ], fake);
  const { executor } = makeExecutor({
    sessions,
    hookBridge,
    openTranscript: () => fake.source,
    inactivityCeilingMs: 30_000,
  });

  const outcome = await executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, finalResponse);
  assert.equal(
    io.events.filter((entry) => (
      entry.event.type === 'claude/message'
      && entry.event.text === finalResponse
    )).length,
    1,
  );
  assert.equal(
    io.events.filter((entry) => entry.event.deliveryState === 'background-work-finished').length,
    1,
  );
});

test('each later Stop boundary replaces the snapshot, and only an empty one completes the turn', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let liveHook = null;
  let settled = false;
  const io = collect();
  const finishedEvents = () => io.events.filter(
    (entry) => entry.event.deliveryState === 'background-work-finished',
  );
  const hookBridge = {
    register: () => ({
      settings: { hooks: {} },
      activate: (handler) => {
        liveHook = handler;
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'UserPromptSubmit',
          prompt_id: 'prompt-a',
          prompt: deliveredPrompt(),
        });
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'Stop',
          prompt_id: 'prompt-a',
          last_assistant_message: 'Interim reply while dev-1 is still running.',
          background_tasks: [{ id: 'background-task-1' }],
          session_crons: [],
        });
        return true;
      },
      deactivate: () => true,
    }),
  };
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [userPrompt(deliveredPrompt())] },
    { status: 'idle' },
    { status: 'idle' },
    {
      status: 'idle',
      // A middle notification boundary. Its snapshot is newer, so it replaces the frozen one, but
      // it still reports work in flight and must not release the task.
      mutate: () => liveHook({
        session_id: SESSION_ID,
        hook_event_name: 'Stop',
        prompt_id: 'prompt-b',
        last_assistant_message: 'Second interim reply while dev-2 is still running.',
        background_tasks: [{ id: 'background-task-2' }],
        session_crons: [],
      }),
    },
    { status: 'idle' },
    { status: 'idle' },
    {
      status: 'idle',
      mutate: () => {
        assert.equal(settled, false);
        assert.equal(finishedEvents().length, 0);
        liveHook({
          session_id: SESSION_ID,
          hook_event_name: 'Stop',
          prompt_id: 'prompt-c',
          last_assistant_message: 'Done. Consolidated reply after both sub-agents finished.',
          background_tasks: [],
          session_crons: [],
        });
      },
    },
    { status: 'idle' },
  ], fake);
  const { executor } = makeExecutor({
    sessions,
    hookBridge,
    openTranscript: () => fake.source,
    inactivityCeilingMs: 30_000,
  });
  const execution = executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );
  void execution.then(
    () => { settled = true; },
    () => { settled = true; },
  );

  const outcome = await execution;
  assert.equal(outcome.finalResponse, 'Done. Consolidated reply after both sub-agents finished.');
  assert.equal(
    io.events.filter((entry) => entry.event.deliveryState === 'background-work-pending').length,
    1,
  );
  assert.equal(finishedEvents().length, 1);
});

test('a delayed Stop from an older prompt cannot end a turn that is still in flight', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let liveHook = null;
  const io = collect();
  const hookBridge = {
    register: () => ({
      settings: { hooks: {} },
      activate: (handler) => {
        liveHook = handler;
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'UserPromptSubmit',
          prompt_id: 'prompt-a',
          prompt: deliveredPrompt(),
        });
        return true;
      },
      deactivate: () => true,
    }),
  };
  const sessions = sessionSteps([
    { status: 'idle' },
    {
      status: 'busy',
      // Real tracked background work, so the pending fence alone cannot reject the delayed hook
      // below. This turn has produced no boundary of its own, which is the only reason it stays
      // rejected.
      append: [
        userPrompt(deliveredPrompt()),
        backgroundAgentLaunch(),
        backgroundAgentResult(),
      ],
    },
    {
      status: 'busy',
      mutate: () => liveHook({
        session_id: SESSION_ID,
        hook_event_name: 'Stop',
        prompt_id: 'prompt-older-turn',
        last_assistant_message: 'Stale earlier response.',
        background_tasks: [],
        session_crons: [],
      }),
    },
    { status: 'idle', append: [backgroundAgentNotification()] },
    {
      status: 'idle',
      mutate: () => liveHook({
        session_id: SESSION_ID,
        hook_event_name: 'Stop',
        prompt_id: 'prompt-a',
        last_assistant_message: 'Own consolidated response.',
        background_tasks: [],
        session_crons: [],
      }),
    },
    { status: 'idle' },
  ], fake);
  const { executor } = makeExecutor({
    sessions,
    hookBridge,
    openTranscript: () => fake.source,
    inactivityCeilingMs: 30_000,
  });

  const outcome = await executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Own consolidated response.');
  assert.equal(io.events.some((entry) => /Stale earlier response/.test(entry.message || '')), false);
  // The rejected hook never reached recordFinalSignal, so it never registered as a reply waiting
  // on background work either.
  assert.equal(
    io.events.filter((entry) => entry.event.deliveryState === 'background-work-pending').length,
    0,
  );
});

test('a Stop hook session cron independently holds completion', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let liveHook = null;
  const hookBridge = {
    register: () => ({
      settings: { hooks: {} },
      activate: (handler) => {
        liveHook = handler;
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'UserPromptSubmit',
          prompt_id: 'prompt-cron',
          prompt: deliveredPrompt(),
        });
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'Stop',
          prompt_id: 'prompt-cron',
          last_assistant_message: 'Interim cron response.',
          background_tasks: [],
          session_crons: [{ id: 'cron-1' }],
        });
        return true;
      },
      deactivate: () => true,
    }),
  };
  const io = collect();
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [userPrompt(deliveredPrompt())] },
    { status: 'idle' },
    { status: 'idle' },
    {
      status: 'idle',
      mutate: () => liveHook({
        session_id: SESSION_ID,
        hook_event_name: 'Stop',
        prompt_id: 'prompt-cron',
        last_assistant_message: 'Fresh response after the cron cleared.',
        background_tasks: [],
        session_crons: [],
      }),
    },
    { status: 'idle' },
  ], fake);
  const { executor } = makeExecutor({ sessions, hookBridge, openTranscript: () => fake.source });

  const outcome = await executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Fresh response after the cron cleared.');
  const pending = io.events.find(
    (entry) => entry.event.deliveryState === 'background-work-pending',
  );
  assert.ok(pending);
  assert.match(pending.message, /1 session cron/);
});

test('background work that never finishes enriches the inactivity failure', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([
    { status: 'idle' },
    {
      status: 'busy',
      append: [
        userPrompt(deliveredPrompt()),
        turnDuration(2),
        assistant('end_turn', [text('Interim response with background work.')]),
      ],
    },
    { status: 'idle' },
  ], fake);
  const { executor } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    inactivityCeilingMs: 3000,
  });

  await assert.rejects(
    () => executor.runTurn(
      baseTask,
      { cancelRequested: false },
      { id: SESSION_ID },
      TERMINAL,
      collect(),
    ),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /2 pending background agents never reported finishing/);
      assert.match(error.message, /Continue session/);
      assert.match(error.message, /Retry re-sends the original prompt/);
      return true;
    },
  );
});

test('a running terminal turn accepts an exact live update without creating another task', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const active = { cancelRequested: false };
  const injections = [];
  let originalInjected = false;
  let finalReady = false;
  let steerPromise = null;
  let steerOutcome = null;
  const liveAttachments = [{
    id: 'image-live',
    name: 'live.png',
    path: '/repo/.data/tasks/7/attachments/live.png',
  }];
  const sessions = {
    readConnectedSession: async () => ({
      id: SESSION_ID,
      provider: 'claude',
      source: 'Claude interactive',
      cwd: '/repo',
      rawStatus: originalInjected && !finalReady ? 'busy' : 'idle',
      pid: PID,
    }),
  };
  const io = collect();
  const onEvent = (entry) => {
    io.onEvent(entry);
    if (entry.event.item?.clientId === 'relay-steer-7-1') {
      throw new Error('simulated local history write failure');
    }
    if (entry.event.type !== 'claude/started' || steerPromise) return;
    steerPromise = active.steer('Use the new direction.', liveAttachments)
      .then((outcome) => {
        steerOutcome = outcome;
        fake.append(assistant('end_turn', [text('Applied the live direction.')]));
        finalReady = true;
      });
  };
  const { executor, submitted } = makeExecutor({
    sessions,
    resolveTerminal: async () => ({ ...TERMINAL }),
    openTranscript: () => fake.source,
    readScreen: async () => ({ ok: true, reason: 'read', text: EMPTY_COMPOSER_FRAME }),
    inject: async (windowId, value) => {
      injections.push({ windowId, value });
      if (!originalInjected) {
        originalInjected = true;
        fake.append(userPrompt(value, 'original-prompt'));
      } else {
        const [recordedPrompt] = attachmentRewrittenPrompts(
          value,
          [liveAttachments[0].path],
        );
        // A live update always lands in a session that has already run at least this task's own
        // turn, so its chips continue the session count rather than restarting at one.
        fake.append({
          ...imagePromptRecord(renumberChips(recordedPrompt, 4)),
          promptId: 'steer-prompt',
        });
      }
    },
    now: Date.now,
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    pollMs: 2,
    steerSubmitNudgeMs: 20,
    steerAcceptanceTimeoutMs: 100,
  });

  const outcome = await executor.runTurn(
    baseTask,
    active,
    { id: SESSION_ID },
    TERMINAL,
    { onEvent, onStderr: io.onStderr },
  );
  await steerPromise;

  assert.equal(outcome.finalResponse, 'Applied the live direction.');
  assert.equal(injections.length, 2);
  assert.equal(submitted.length, 0);
  assert.match(injections[1].value, /Use the new direction\./);
  assert.match(injections[1].value, /attachments\/live\.png/);
  assert.match(injections[1].value, /non-interactive run/);
  assert.deepEqual(steerOutcome, {
    taskId: baseTask.id,
    threadId: SESSION_ID,
    turnId: null,
    clientUserMessageId: 'relay-steer-7-1',
    promptSubmissionEvidence: 'transcript-anchor-normalized',
    submitAttempted: false,
    submitAttempts: 0,
    // Exact evidence arrived before the recovery loop ran, so no composer pass was classified.
    composerStates: [],
  });
  const update = io.events.find((entry) => (
    entry.event.type === 'item/completed'
    && entry.event.item?.clientId === 'relay-steer-7-1'
  ));
  assert.equal(update.event.provider, 'claude');
  assert.deepEqual(update.event.item.content, [
    { type: 'text', text: 'Use the new direction.' },
    { type: 'localImage', path: liveAttachments[0].path },
  ]);
  assert.match(io.stderr.join('\n'), /accepted the live update.*could not record/i);
});

test('a held live update receives one guarded submit and exact transcript confirmation', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const active = { cancelRequested: false };
  const injections = [];
  const submits = [];
  let finalReady = false;
  let steerPromise = null;
  let steerOutcome = null;
  const sessions = {
    readConnectedSession: async () => ({
      id: SESSION_ID,
      provider: 'claude',
      source: 'Claude interactive',
      cwd: '/repo',
      rawStatus: injections.length > 0 && !finalReady ? 'busy' : 'idle',
      pid: PID,
    }),
  };
  const io = collect();
  const onEvent = (entry) => {
    io.onEvent(entry);
    if (entry.event.type !== 'claude/started' || steerPromise) return;
    steerPromise = active.steer('Submit this held update once.')
      .then((outcome) => {
        steerOutcome = outcome;
        fake.append(assistant('end_turn', [text('Used the guarded live update.')]));
        finalReady = true;
      });
  };
  const { executor } = makeExecutor({
    sessions,
    resolveTerminal: async () => ({ ...TERMINAL }),
    openTranscript: () => fake.source,
    readScreen: async () => ({
      ok: true,
      reason: 'read',
      text: injections.length < 2
        ? EMPTY_COMPOSER_FRAME
        : heldPasteFrame(injections[1].value),
    }),
    inject: async (windowId, value) => {
      injections.push({ windowId, value });
      if (injections.length === 1) fake.append(userPrompt(value, 'original-prompt'));
    },
    submit: async (windowId) => {
      submits.push(windowId);
      fake.append(userPrompt(injections[1].value, 'steer-prompt'));
    },
    now: Date.now,
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    pollMs: 2,
    steerSubmitNudgeMs: 20,
    steerAcceptanceTimeoutMs: 120,
  });

  const outcome = await executor.runTurn(
    baseTask,
    active,
    { id: SESSION_ID },
    TERMINAL,
    { onEvent, onStderr: io.onStderr },
  );
  await steerPromise;

  assert.equal(outcome.finalResponse, 'Used the guarded live update.');
  assert.deepEqual(submits, [WINDOW_ID]);
  assert.equal(steerOutcome.submitAttempted, true);
  assert.equal(steerOutcome.submitAttempts, 1);
  assert.equal(steerOutcome.promptSubmissionEvidence, 'transcript-prompt');
});

test('task 129: an image live update retries its exact held paste after the first submit is swallowed', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const active = { cancelRequested: false };
  const injections = [];
  const submits = [];
  let finalReady = false;
  let steerPromise = null;
  let steerOutcome = null;
  const liveAttachments = [{
    id: 'task-129-image',
    name: 'new-modal.png',
    path: '/repo/.data/tasks/129/attachments/new-modal.png',
  }];
  const sessions = {
    readConnectedSession: async () => ({
      id: SESSION_ID,
      provider: 'claude',
      source: 'Claude interactive',
      cwd: '/repo',
      // The earlier response ends after the swallowed action. Recovery still owns this exact
      // held update and must be allowed to submit it across the busy-to-idle boundary.
      rawStatus: injections.length > 0 && submits.length === 0 && !finalReady ? 'busy' : 'idle',
      pid: PID,
    }),
  };
  const io = collect();
  const onEvent = (entry) => {
    io.onEvent(entry);
    if (entry.event.type !== 'claude/started' || steerPromise) return;
    steerPromise = active.steer('Use this additional modal design.', liveAttachments)
      .then((outcome) => {
        steerOutcome = outcome;
        fake.append(assistant('end_turn', [text('Applied the additional modal design.')]));
        finalReady = true;
      });
  };
  const { executor } = makeExecutor({
    sessions,
    resolveTerminal: async () => ({ ...TERMINAL }),
    openTranscript: () => fake.source,
    readScreen: async () => ({
      ok: true,
      reason: 'read',
      text: injections.length < 2
        ? EMPTY_COMPOSER_FRAME
        : heldPasteFrame(injections[1].value, { chips: '[Image #2]', counter: 3 }),
    }),
    inject: async (windowId, value) => {
      injections.push({ windowId, value });
      if (injections.length === 1) fake.append(userPrompt(value, 'original-prompt'));
    },
    submit: async (windowId) => {
      submits.push(windowId);
      // Task 129 stopped here after one action. Model that swallowed Return by writing nothing
      // until the second independently verified action reaches the same exact held paste.
      if (submits.length !== 2) return;
      const [recordedPrompt] = attachmentRewrittenPrompts(
        injections[1].value,
        [liveAttachments[0].path],
      );
      fake.append({
        ...imagePromptRecord(renumberChips(recordedPrompt, 2)),
        promptId: 'steer-prompt',
      });
    },
    now: Date.now,
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    pollMs: 2,
    steerSubmitNudgeMs: 10,
    steerAcceptanceTimeoutMs: 100,
    submitRetryMs: 12,
    submitRetryBackoffMs: 0,
    maxSubmitAttempts: 3,
  });

  const outcome = await executor.runTurn(
    baseTask,
    active,
    { id: SESSION_ID },
    TERMINAL,
    { onEvent, onStderr: io.onStderr },
  );
  await steerPromise;

  assert.equal(outcome.finalResponse, 'Applied the additional modal design.');
  assert.equal(injections.length, 2);
  assert.deepEqual(submits, [WINDOW_ID, WINDOW_ID]);
  assert.equal(steerOutcome.submitAttempted, true);
  assert.equal(steerOutcome.submitAttempts, 2);
  assert.equal(steerOutcome.promptSubmissionEvidence, 'transcript-anchor-normalized');
});

function unacknowledgedSteerRequest(deliveredPrompt) {
  let releaseAcknowledgement;
  const acknowledgement = new Promise((resolve) => {
    releaseAcknowledgement = resolve;
  });
  const request = {
    deliveredPrompt,
    acknowledged: false,
    closedError: null,
    acknowledgement,
    releaseAcknowledgement,
    injectionStarted: false,
    submitAttempted: false,
    submitAttempts: 0,
    composerStates: [],
    result: () => null,
  };
  return request;
}

test('a held live update receives no second Return once the composer is empty', async () => {
  const deliveredPrompt = taskPrompt({
    prompt: 'Do not duplicate this live update.',
    attachments: [],
  });
  const request = unacknowledgedSteerRequest(deliveredPrompt);
  let screenReads = 0;
  const { executor, submitted } = makeExecutor({
    sessions: {
      readConnectedSession: async () => ({
        id: SESSION_ID,
        provider: 'claude',
        source: 'Claude interactive',
        cwd: '/repo',
        rawStatus: 'busy',
        pid: PID,
      }),
    },
    resolveTerminal: async () => ({ ...TERMINAL }),
    readScreen: async () => {
      screenReads += 1;
      if (screenReads === 1) {
        return { ok: true, reason: 'read', text: EMPTY_COMPOSER_FRAME };
      }
      if (screenReads === 2) {
        return { ok: true, reason: 'read', text: heldPasteFrame(deliveredPrompt) };
      }
      return { ok: true, reason: 'read', text: EMPTY_COMPOSER_FRAME };
    },
    now: Date.now,
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    steerSubmitNudgeMs: 3,
    steerAcceptanceTimeoutMs: 30,
    submitRetryMs: 3,
    submitRetryBackoffMs: 0,
    maxSubmitAttempts: 4,
  });

  await assert.rejects(
    executor.deliverActiveSteer(baseTask, { cancelRequested: false }, TERMINAL, request),
    (error) => error.deliveryUncertain === true,
  );

  // An empty composer can mean the first action landed and its evidence was lost. Never press
  // Return again unless the exact held paste is positively visible again.
  assert.deepEqual(submitted, [WINDOW_ID]);
  assert.equal(request.submitAttempts, 1);
});

test('a live update that stays held exhausts the bounded submit limit', async () => {
  const deliveredPrompt = taskPrompt({
    prompt: 'Keep this live update held for the full schedule.',
    attachments: [],
  });
  const request = unacknowledgedSteerRequest(deliveredPrompt);
  let screenReads = 0;
  const { executor, submitted } = makeExecutor({
    sessions: {
      readConnectedSession: async () => ({
        id: SESSION_ID,
        provider: 'claude',
        source: 'Claude interactive',
        cwd: '/repo',
        rawStatus: 'busy',
        pid: PID,
      }),
    },
    resolveTerminal: async () => ({ ...TERMINAL }),
    readScreen: async () => {
      screenReads += 1;
      return {
        ok: true,
        reason: 'read',
        text: screenReads === 1 ? EMPTY_COMPOSER_FRAME : heldPasteFrame(deliveredPrompt),
      };
    },
    now: Date.now,
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    steerSubmitNudgeMs: 3,
    // Leave enough real-clock slack that scheduler load cannot consume the final guarded action.
    // The production schedule contract is covered separately with the default 80 second window.
    steerAcceptanceTimeoutMs: 100,
    submitRetryMs: 3,
    submitRetryBackoffMs: 0,
    maxSubmitAttempts: 3,
  });

  await assert.rejects(
    executor.deliverActiveSteer(baseTask, { cancelRequested: false }, TERMINAL, request),
    (error) => {
      assert.equal(error.deliveryUncertain, true);
      assert.match(error.message, /after 3 guarded submit actions/);
      assert.match(error.message, /exact update may still be held/);
      return true;
    },
  );

  assert.deepEqual(submitted, [WINDOW_ID, WINDOW_ID, WINDOW_ID]);
  assert.equal(request.submitAttempts, 3);
  // Every recovery pass that ran is reported, so an unconfirmed update is explainable from
  // diagnostics alone. The pre-injection gate read is not a recovery pass and is not recorded.
  assert.deepEqual(request.composerStates, ['held', 'held', 'held']);
});

// ---- text-only held live updates ---------------------------------------------
//
// The operator report on 2026-08-07 was that a follow-up message to a running Claude session is
// typed into the composer and then never submitted. A single-line follow-up is a THREE line paste
// after taskPrompt() appends the non-interactive notice, three lines never collapse, and the
// literal word-wrapped rendering puts the caret past the old one-row composer depth bound. Every
// recovery pass then classified 'unreadable' and sent nothing, so the text sat there forever.
// These pin the recovery for each real rendered form.

// Drives deliverActiveSteer against a scripted sequence of RECOVERY screen reads and reports what
// happened. The pre-injection gate read is supplied here, because it must show an empty composer
// or nothing is ever typed; `screens` describes only what the recovery loop sees, in order, with
// the last entry repeating once the script runs out.
async function runSteerRecovery(deliveredPrompt, recoveryScreens, options = {}) {
  const screens = [EMPTY_COMPOSER_FRAME, ...recoveryScreens];
  const request = unacknowledgedSteerRequest(deliveredPrompt);
  let screenReads = 0;
  const { executor, submitted } = makeExecutor({
    sessions: {
      readConnectedSession: async () => ({
        id: SESSION_ID,
        provider: 'claude',
        source: 'Claude interactive',
        cwd: '/repo',
        rawStatus: 'busy',
        pid: PID,
      }),
    },
    resolveTerminal: async () => ({ ...TERMINAL }),
    readScreen: async () => {
      const entry = screens[Math.min(screenReads, screens.length - 1)];
      screenReads += 1;
      return typeof entry === 'string'
        ? { ok: true, reason: 'read', text: entry }
        : entry;
    },
    now: Date.now,
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    steerSubmitNudgeMs: 3,
    steerAcceptanceTimeoutMs: 60,
    submitRetryMs: 3,
    submitRetryBackoffMs: 0,
    steerRecheckMs: 1,
    maxSubmitAttempts: 4,
    ...options,
  });

  let error = null;
  try {
    await executor.deliverActiveSteer(baseTask, { cancelRequested: false }, TERMINAL, request);
  } catch (thrown) {
    error = thrown;
  }
  return { request, submitted, error };
}

test('a text-only live update held in its literal multi-row form receives a guarded submit', async () => {
  const deliveredPrompt = taskPrompt({
    prompt: 'when I send a follow-up it should immediately reach the terminal',
    attachments: [],
  });
  // The exact shape of the operator's report: three lines, so no collapse and a tall composer.
  assert.equal(deliveredPrompt.split('\n').length, 3);
  // Terminal.app's default window is 80 columns, which is where this reproduces. Pin the caret
  // depth so this test can never quietly stop exercising the defect if the notice text changes.
  const heldFrame = heldPasteFrame(deliveredPrompt, { columns: 78 });
  const heldTail = claudeScreenTailLines(heldFrame);
  const heldCaret = heldTail.findIndex((line) => line.startsWith('❯'));
  assert.ok(
    heldTail.length - heldCaret > CLAUDE_COMPOSER_MAX_TAIL_DEPTH,
    'the literal rendering must put the caret past the one-row composer depth bound',
  );

  const { request, submitted } = await runSteerRecovery(deliveredPrompt, [heldFrame]);

  // Before the fix this frame classified 'unreadable' and produced zero actions.
  assert.ok(submitted.length >= 1, 'a held text-only update must receive a guarded Return');
  assert.deepEqual(submitted[0], WINDOW_ID);
  assert.equal(request.submitAttempts >= 1, true);
  assert.equal(request.composerStates[0], 'held');
});

test('a long single-line live update hard-wrapped across the composer still recovers', async () => {
  // One unbroken token longer than the composer width is the only case Claude Code does not word
  // wrap. It breaks at the column boundary with no space, so rejoining the rows inserts a space
  // the prompt never had and the plain containment check fails inside the anchor.
  const token = `steerreliability${'0123456789'.repeat(30)}`;
  const deliveredPrompt = taskPrompt({ prompt: token, attachments: [] });
  const heldFrame = heldPasteFrame(deliveredPrompt, { columns: 24 });
  // Prove the wrap really does split the anchor, otherwise this test would pass for free.
  const composerText = claudeComposerContent(heldFrame).text.replace(/\s+/g, ' ').trim();
  assert.equal(composerText.includes(token.slice(0, 40)), false);

  const { request, submitted } = await runSteerRecovery(deliveredPrompt, [heldFrame]);

  assert.ok(submitted.length >= 1, 'a hard-wrapped held update must still receive a guarded Return');
  assert.equal(request.composerStates[0], 'held');
});

test('a short whitespace-heavy anchor is refused by the stripped comparison floor', async () => {
  // The negative side of the hard-wrap recovery above. Ignoring whitespace makes the anchor weaker,
  // and a short anchor built mostly of spaces strips down towards the empty string, which EVERY
  // composer contains. Accepting one would let a foreign draft read as this turn's held paste and
  // earn a guarded Return, so the weak comparison is refused below the floor and the turn falls
  // back to the clear and re-inject path that still delivers the exact prompt.
  const deliveredPrompt = taskPrompt({ prompt: 'fix  the  composerwrap', attachments: [] });
  // What promptComposerAnchor() derives: the first non-empty line, whitespace collapsed, capped at
  // CLAUDE_COMPOSER_ANCHOR_CHARS. That helper is not exported, so the derivation this whole test
  // depends on is pinned here rather than assumed.
  const anchor = 'fix the composerwrap';
  assert.equal(deliveredPrompt.split('\n')[0].replace(/\s+/g, ' ').trim(), anchor);
  assert.ok(anchor.length <= CLAUDE_COMPOSER_ANCHOR_CHARS, 'the cap must not truncate this anchor');
  assert.ok(
    anchor.replace(/\s+/g, '').length < CLAUDE_COMPOSER_MIN_STRIPPED_ANCHOR_CHARS,
    'the anchor must strip below the floor, otherwise this test would not exercise it',
  );
  // And prove that this exact string is what the classifier matches on, not some longer or shorter
  // derivation that happens to agree on the frames below. The whole anchor is required: a composer
  // one character short of it is not this turn's paste.
  assert.equal(claudeComposerState(composerFrame(anchor), deliveredPrompt), 'held');
  assert.equal(claudeComposerState(composerFrame(anchor.slice(0, -1)), deliveredPrompt), 'junk');

  // Positive control: rendered normally this exact prompt IS recoverable, so nothing about the
  // prompt itself is what refuses the frame below.
  assert.equal(claudeComposerState(heldPasteFrame(deliveredPrompt), deliveredPrompt), 'held');

  // The same prompt after a wrap split its last word: the notice rows are exactly what the default
  // composer width renders, and only the first line is hard-broken at the column boundary.
  const [, ...noticeRows] = wrapComposerRows(deliveredPrompt);
  const mangledFrame = composerFrame(['fix  the  composerwr', 'ap', ...noticeRows].join('\n'));
  const composerText = claudeComposerContent(mangledFrame).text.replace(/\s+/g, ' ').trim();
  // Prove the floor is the ONLY thing standing between this frame and 'held'.
  assert.equal(
    composerText.includes(anchor),
    false,
    'the split word must break the plain anchor comparison',
  );
  assert.equal(
    composerText.replace(/\s+/g, '').includes(anchor.replace(/\s+/g, '')),
    true,
    'the stripped comparison would otherwise accept it, which is what the floor refuses',
  );

  assert.equal(claudeComposerState(mangledFrame, deliveredPrompt), 'junk');

  const { request, submitted, error } = await runSteerRecovery(deliveredPrompt, [mangledFrame]);

  // Fail closed: a weak agreement never earns a guarded Return.
  assert.deepEqual(submitted, []);
  assert.equal(request.submitAttempts, 0);
  assert.equal(error.deliveryUncertain, true);
  assert.deepEqual(request.composerStates, ['junk']);
});

test('a text-only live update collapsed under a cumulative paste counter recovers', async () => {
  // A multi-line follow-up crosses the collapse threshold and renders as a chip whose counter is
  // session-cumulative, so it does not start at 1.
  const deliveredPrompt = taskPrompt({
    prompt: 'first change the header\nthen change the footer\nthen re-run the suite',
    attachments: [],
  });
  assert.ok(deliveredPrompt.split('\n').length >= CLAUDE_PASTE_COLLAPSE_MIN_LINES);
  const heldFrame = heldPasteFrame(deliveredPrompt, { counter: 17 });
  assert.match(heldFrame, /\[Pasted text #17 \+4 lines\]/);

  const { request, submitted } = await runSteerRecovery(deliveredPrompt, [heldFrame]);

  assert.ok(submitted.length >= 1);
  assert.equal(request.composerStates[0], 'held');

  // The counter identifies nothing; the LINE COUNT is what proves which paste is held. A chip for
  // a different sized paste under the same counter is still somebody else's text.
  assert.equal(
    claudeComposerState(composerFrame('[Pasted text #17 +99 lines]', {
      statusRow: '  paste again to expand',
    }), deliveredPrompt),
    'junk',
  );
});

test('an unreadable first read does not consume a guarded submit attempt', async () => {
  const deliveredPrompt = taskPrompt({
    prompt: 'this one is only visible on a later read',
    attachments: [],
  });
  const heldFrame = heldPasteFrame(deliveredPrompt, { columns: 78 });
  // Echo lag and a transient osascript failure both look like this: the composer proves nothing on
  // the first passes and only becomes readable later. The action backoff here is deliberately a
  // large fraction of the acceptance window, so if an inconclusive read consumed a schedule slot
  // the window would be gone before the paste ever became readable, which is the pre-fix
  // behaviour: three inconclusive reads at 110 of a 300 window retire it with zero actions.
  const { request, submitted } = await runSteerRecovery(deliveredPrompt, [
    { ok: false, reason: 'osascript-timeout' },
    { ok: false, reason: 'osascript-timeout' },
    { ok: false, reason: 'osascript-timeout' },
    heldFrame,
  ], {
    steerAcceptanceTimeoutMs: 300,
    steerSubmitNudgeMs: 5,
    submitRetryMs: 110,
    submitRetryBackoffMs: 0,
    steerRecheckMs: 1,
    maxSubmitAttempts: 2,
  });

  assert.ok(submitted.length >= 1, 'recovery must survive inconclusive reads');
  // The inconclusive passes are recorded but cost no attempt from the hard cap, and they use the
  // short recheck gap rather than the action backoff, so the window survives them.
  assert.deepEqual(
    request.composerStates.slice(0, 4),
    ['unreadable', 'unreadable', 'unreadable', 'held'],
  );
  // The cap counts ACTIONS, never reads. The full action budget is still available afterwards and
  // is still enforced exactly.
  assert.equal(request.submitAttempts, 2);
  assert.deepEqual(submitted, [WINDOW_ID, WINDOW_ID]);
});

test('an unreadable composer alone never presses Return and stays bounded', async () => {
  const deliveredPrompt = taskPrompt({ prompt: 'never proven held', attachments: [] });
  const { request, submitted, error } = await runSteerRecovery(deliveredPrompt, [
    { ok: false, reason: 'osascript-timeout' },
  ]);

  // Fail-closed: nothing is ever submitted on an unprovable composer, and the recheck budget
  // keeps the loop finite instead of spinning against the acceptance deadline.
  assert.deepEqual(submitted, []);
  assert.equal(request.submitAttempts, 0);
  assert.equal(error.deliveryUncertain, true);
  assert.ok(request.composerStates.every((state) => state === 'unreadable'));
});

test('a foreign draft in the composer still receives zero guarded submit actions', async () => {
  const deliveredPrompt = taskPrompt({ prompt: 'do the thing', attachments: [] });
  const { request, submitted, error } = await runSteerRecovery(deliveredPrompt, [
    JUNK_COMPOSER_FRAME,
  ]);

  assert.deepEqual(submitted, []);
  assert.equal(request.submitAttempts, 0);
  assert.equal(error.deliveryUncertain, true);
  // One definite foreign-draft classification stops the schedule immediately.
  assert.deepEqual(request.composerStates, ['junk']);
});

// A scrolled-up transcript can end on every structural feature of the composer box without being
// one: an opening rule, a row that starts with a plain `>` because it quotes an error, prose, a
// closing rule, and a few prose lines under it that clear the chrome bound. The one feature it
// cannot have is the bottom status row, which every captured real composer frame carries, so the
// box scan requires that corroboration before it accepts a caret. Without it this shape reads as a
// composer holding foreign text: harmless on its own, but 'junk' on the opening-prompt path sends
// the clearing Ctrl+C, which lands in the REAL composer further down the screen and destroys this
// turn's own held paste, turning a recoverable turn into a failed one.
const SCROLLED_QUOTE_BLOCK_FRAME = [
  '⏺ The deploy step failed. This is what the build log reported:',
  '',
  SCREEN_RULE,
  '  > Error: ENOENT no such file or directory, open dist/manifest.json',
  '  The retry path swallowed it and moved on to the next stage.',
  SCREEN_RULE,
  '  I will rebuild the manifest before retrying the deploy.',
  '  The live composer is further down, below the scrolled viewport.',
].join('\n');

test('a scrolled quote block shaped like the composer box is unreadable, never a foreign draft', async () => {
  // Prove the hazard is really present in this frame, otherwise the test would pass for free.
  const tail = claudeScreenTailLines(SCROLLED_QUOTE_BLOCK_FRAME, CLAUDE_COMPOSER_TAIL_LINES);
  const caret = tail.findIndex((line) => line.startsWith('>'));
  assert.ok(caret > 0, 'the quoted row must present itself as a caret line');
  assert.ok(
    CLAUDE_SCREEN_RULE_PATTERN.test(tail[caret - 1]),
    'a rule must sit directly above the quoted row, exactly as the composer opening rule does',
  );
  const closing = tail.findLastIndex((line) => CLAUDE_SCREEN_RULE_PATTERN.test(line));
  assert.ok(closing > caret, 'a second rule must close the block below the quoted row');
  assert.ok(
    tail.length - 1 - closing <= CLAUDE_COMPOSER_MAX_CHROME_LINES,
    'the prose under the closing rule must be short enough to clear the chrome bound',
  );
  assert.equal(
    tail.some((line) => CLAUDE_COMPOSER_STATUS_ROW_PATTERNS.some((pattern) => pattern.test(line))),
    false,
    'the transcript shape must carry no status row, which is what separates it from a composer',
  );

  // Fail closed: nothing about this screen is proof of anything, so no state is derived from it.
  assert.equal(claudeComposerContent(SCROLLED_QUOTE_BLOCK_FRAME).found, false);
  assert.equal(classifyClaudeScreen(SCROLLED_QUOTE_BLOCK_FRAME), 'unknown');
  assert.equal(
    claudeComposerState(SCROLLED_QUOTE_BLOCK_FRAME, taskPrompt({
      prompt: 'rebuild the manifest and retry the deploy',
      attachments: [],
    })),
    'unreadable',
  );
  // found:false is also what keeps normalizeComposerBeforePaste from sending its clearing Ctrl+C,
  // which is the destructive half of this misread.

  const deliveredPrompt = taskPrompt({
    prompt: 'rebuild the manifest and retry the deploy',
    attachments: [],
  });
  const { request, submitted, error } = await runSteerRecovery(deliveredPrompt, [
    SCROLLED_QUOTE_BLOCK_FRAME,
  ]);

  assert.deepEqual(submitted, []);
  assert.equal(request.submitAttempts, 0);
  assert.equal(error.deliveryUncertain, true);
  // The load-bearing assertion. Without the status-row corroboration this frame classifies 'junk',
  // which also sends nothing but stops the schedule on a fabricated foreign draft instead of
  // admitting the screen proved nothing and re-reading it.
  assert.ok(request.composerStates.length > 0);
  assert.ok(request.composerStates.every((state) => state === 'unreadable'));
});

test('a live prompt id rejects a delayed Stop hook from the earlier prompt', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const active = { cancelRequested: false };
  const injections = [];
  let liveHook = null;
  let finalReady = false;
  let steerPromise = null;
  const hookBridge = {
    register: () => ({
      settings: { hooks: {} },
      activate: (handler) => {
        liveHook = handler;
        return true;
      },
      deactivate: () => true,
    }),
  };
  const sessions = {
    readConnectedSession: async () => ({
      id: SESSION_ID,
      provider: 'claude',
      source: 'Claude interactive',
      cwd: '/repo',
      rawStatus: injections.length > 0 && !finalReady ? 'busy' : 'idle',
      pid: PID,
    }),
  };
  const io = collect();
  const onEvent = (entry) => {
    io.onEvent(entry);
    if (entry.event.type !== 'claude/started' || steerPromise) return;
    steerPromise = active.steer('Use only the newest prompt.')
      .then(() => {
        fake.append(assistant('end_turn', [text('Newest prompt completed.')]));
        finalReady = true;
      });
  };
  const { executor } = makeExecutor({
    sessions,
    hookBridge,
    resolveTerminal: async () => ({ ...TERMINAL }),
    openTranscript: () => fake.source,
    readScreen: async () => ({ ok: true, reason: 'read', text: EMPTY_COMPOSER_FRAME }),
    inject: async (windowId, value) => {
      injections.push({ windowId, value });
      if (injections.length === 1) {
        fake.append(userPrompt(value, 'original-prompt'));
        return;
      }
      liveHook({
        session_id: SESSION_ID,
        hook_event_name: 'UserPromptSubmit',
        prompt_id: 'steer-prompt',
        prompt: value,
      });
      fake.append(userPrompt(value, 'steer-prompt'));
      liveHook({
        session_id: SESSION_ID,
        hook_event_name: 'Stop',
        prompt_id: 'original-prompt',
        last_assistant_message: 'Stale earlier response.',
        background_tasks: [],
        session_crons: [],
      });
    },
    now: Date.now,
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    pollMs: 2,
    steerSubmitNudgeMs: 20,
    steerAcceptanceTimeoutMs: 100,
  });

  const outcome = await executor.runTurn(
    baseTask,
    active,
    { id: SESSION_ID },
    TERMINAL,
    { onEvent, onStderr: io.onStderr },
  );
  await steerPromise;

  assert.equal(outcome.finalResponse, 'Newest prompt completed.');
  assert.equal(io.events.some((entry) => /Stale earlier response/.test(entry.message || '')), false);
});

// The pairing of the two rules. A steer moves the accepted boundary onto a turn that has not
// ended, so the evidence that made a later Stop adoptable is gone again, even though the frozen
// snapshot from the previous boundary is still pending and would otherwise invite adoption.
test('an accepted live update makes a mismatched Stop hook rejectable again', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const active = { cancelRequested: false };
  const injections = [];
  let liveHook = null;
  let allowIdle = false;
  let idleReads = 0;
  let steerPromise = null;
  const hookBridge = {
    register: () => ({
      settings: { hooks: {} },
      activate: (handler) => {
        liveHook = handler;
        return true;
      },
      deactivate: () => true,
    }),
  };
  const sessions = {
    readConnectedSession: async () => {
      if (allowIdle) {
        idleReads += 1;
        if (idleReads === 3) {
          liveHook({
            session_id: SESSION_ID,
            hook_event_name: 'Stop',
            prompt_id: 'steer-prompt',
            last_assistant_message: 'Steered reply after the background task finished.',
            background_tasks: [],
            session_crons: [],
          });
        }
      }
      return {
        id: SESSION_ID,
        provider: 'claude',
        source: 'Claude interactive',
        cwd: '/repo',
        rawStatus: injections.length > 0 && !allowIdle ? 'busy' : 'idle',
        pid: PID,
      };
    },
  };
  const io = collect();
  const onEvent = (entry) => {
    io.onEvent(entry);
    if (entry.event.type !== 'claude/started' || steerPromise) return;
    // The accepted turn reaches its own boundary with one background task still running: the
    // snapshot that used to freeze for the rest of the task.
    liveHook({
      session_id: SESSION_ID,
      hook_event_name: 'Stop',
      prompt_id: 'original-prompt',
      last_assistant_message: 'Interim reply while the background task runs.',
      background_tasks: [{ id: 'background-task-1' }],
      session_crons: [],
    });
    steerPromise = active.steer('Use only the newest prompt.')
      .then(() => {
        allowIdle = true;
      });
  };
  const { executor } = makeExecutor({
    sessions,
    hookBridge,
    resolveTerminal: async () => ({ ...TERMINAL }),
    openTranscript: () => fake.source,
    readScreen: async () => ({ ok: true, reason: 'read', text: EMPTY_COMPOSER_FRAME }),
    inject: async (windowId, value) => {
      injections.push({ windowId, value });
      if (injections.length === 1) {
        fake.append(userPrompt(value, 'original-prompt'));
        return;
      }
      liveHook({
        session_id: SESSION_ID,
        hook_event_name: 'UserPromptSubmit',
        prompt_id: 'steer-prompt',
        prompt: value,
      });
      // Delayed, mismatched, and arriving while tracked background work is pending, so the pending
      // fence cannot reject it. It is fired before the durable record exists, so the acknowledged
      // update is the only thing that moved the boundary: this is the acknowledgement's own reset
      // or nothing.
      liveHook({
        session_id: SESSION_ID,
        hook_event_name: 'Stop',
        prompt_id: 'prompt-stale',
        last_assistant_message: 'Stale earlier response.',
        background_tasks: [],
        session_crons: [],
      });
      fake.append(userPrompt(value, 'steer-prompt'));
    },
    now: Date.now,
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    pollMs: 2,
    steerSubmitNudgeMs: 20,
    steerAcceptanceTimeoutMs: 100,
    // This case runs on the real clock, so a regression that holds the task must fail within
    // seconds instead of parking the suite on the production inactivity ceiling.
    inactivityCeilingMs: 10_000,
  });

  const outcome = await executor.runTurn(
    baseTask,
    active,
    { id: SESSION_ID },
    TERMINAL,
    { onEvent, onStderr: io.onStderr },
  );
  await steerPromise;

  assert.equal(outcome.finalResponse, 'Steered reply after the background task finished.');
  assert.equal(io.events.some((entry) => /Stale earlier response/.test(entry.message || '')), false);
  assert.equal(
    io.events.filter((entry) => entry.event.deliveryState === 'background-work-pending').length,
    1,
  );
  assert.equal(
    io.events.filter((entry) => entry.event.deliveryState === 'background-work-finished').length,
    1,
  );
});

// The other ordering of the same boundary. Claude writes the final assistant record before it runs
// the Stop hook, so a Stop that beats the transcript watcher carries the only proof that the turn
// ended in a file CC Relay has not read yet. The guard drains before it decides, which is why this
// completes instead of holding on the frozen snapshot forever.
test('a Stop hook that outruns the transcript still finds its own turn ended', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const active = { cancelRequested: false };
  const injections = [];
  let liveHook = null;
  let allowIdle = false;
  let idleReads = 0;
  let steerPromise = null;
  const hookBridge = {
    register: () => ({
      settings: { hooks: {} },
      activate: (handler) => {
        liveHook = handler;
        return true;
      },
      deactivate: () => true,
    }),
  };
  const sessions = {
    readConnectedSession: async () => {
      if (allowIdle) {
        idleReads += 1;
        if (idleReads === 3) {
          // Both halves of one boundary, in the order Claude produces them and faster than the
          // watcher can wake. The steered turn's own end_turn is still unread when its successor's
          // Stop arrives under a prompt id CC Relay never submitted.
          fake.append(assistant('end_turn', [text('Steered turn ended with work still tracked.')]));
          liveHook({
            session_id: SESSION_ID,
            hook_event_name: 'Stop',
            prompt_id: 'prompt-notification',
            last_assistant_message: 'Done. Consolidated reply after the notification turn.',
            background_tasks: [],
            session_crons: [],
          });
        }
      }
      return {
        id: SESSION_ID,
        provider: 'claude',
        source: 'Claude interactive',
        cwd: '/repo',
        rawStatus: injections.length > 0 && !allowIdle ? 'busy' : 'idle',
        pid: PID,
      };
    },
  };
  const io = collect();
  const onEvent = (entry) => {
    io.onEvent(entry);
    if (entry.event.type !== 'claude/started' || steerPromise) return;
    liveHook({
      session_id: SESSION_ID,
      hook_event_name: 'Stop',
      prompt_id: 'original-prompt',
      last_assistant_message: 'Interim reply while the background task runs.',
      background_tasks: [{ id: 'background-task-1' }],
      session_crons: [],
    });
    // The steer is what leaves the snapshot frozen while the turn-ended latch is clear, which is
    // the only reachable state where the drain inside the guard decides the outcome.
    steerPromise = active.steer('Use only the newest prompt.')
      .then(() => {
        allowIdle = true;
      });
  };
  const { executor } = makeExecutor({
    sessions,
    hookBridge,
    resolveTerminal: async () => ({ ...TERMINAL }),
    openTranscript: () => fake.source,
    readScreen: async () => ({ ok: true, reason: 'read', text: EMPTY_COMPOSER_FRAME }),
    inject: async (windowId, value) => {
      injections.push({ windowId, value });
      if (injections.length === 1) {
        fake.append(userPrompt(value, 'original-prompt'));
        return;
      }
      liveHook({
        session_id: SESSION_ID,
        hook_event_name: 'UserPromptSubmit',
        prompt_id: 'steer-prompt',
        prompt: value,
      });
      fake.append(userPrompt(value, 'steer-prompt'));
    },
    now: Date.now,
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    pollMs: 2,
    steerSubmitNudgeMs: 20,
    steerAcceptanceTimeoutMs: 100,
    inactivityCeilingMs: 10_000,
  });

  const outcome = await executor.runTurn(
    baseTask,
    active,
    { id: SESSION_ID },
    TERMINAL,
    { onEvent, onStderr: io.onStderr },
  );
  await steerPromise;

  assert.equal(outcome.finalResponse, 'Done. Consolidated reply after the notification turn.');
  assert.equal(
    io.events.filter((entry) => entry.event.deliveryState === 'background-work-finished').length,
    1,
  );
});

test('a durable live prompt boundary cannot finalize with the earlier transcript response', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const active = { cancelRequested: false };
  const injections = [];
  let liveHook = null;
  let allowIdle = false;
  let idleReads = 0;
  let steerPromise = null;
  const hookBridge = {
    register: () => ({
      settings: { hooks: {} },
      activate: (handler) => {
        liveHook = handler;
        return true;
      },
      deactivate: () => true,
    }),
  };
  const sessions = {
    readConnectedSession: async () => {
      if (allowIdle) {
        idleReads += 1;
        if (idleReads === 3) {
          liveHook({
            session_id: SESSION_ID,
            hook_event_name: 'Stop',
            prompt_id: 'steer-prompt',
            last_assistant_message: 'Current steered response.',
            background_tasks: [],
            session_crons: [],
          });
        }
      }
      return {
        id: SESSION_ID,
        provider: 'claude',
        source: 'Claude interactive',
        cwd: '/repo',
        rawStatus: injections.length > 0 && !allowIdle ? 'busy' : 'idle',
        pid: PID,
      };
    },
  };
  const io = collect();
  const onEvent = (entry) => {
    io.onEvent(entry);
    if (entry.event.type !== 'claude/started' || steerPromise) return;
    steerPromise = active.steer('Apply this at the response boundary.')
      .then(() => {
        allowIdle = true;
      });
  };
  const { executor } = makeExecutor({
    sessions,
    hookBridge,
    resolveTerminal: async () => ({ ...TERMINAL }),
    openTranscript: () => fake.source,
    readScreen: async () => ({ ok: true, reason: 'read', text: EMPTY_COMPOSER_FRAME }),
    inject: async (windowId, value) => {
      injections.push({ windowId, value });
      if (injections.length === 1) {
        fake.append(userPrompt(value, 'original-prompt'));
        return;
      }
      liveHook({
        session_id: SESSION_ID,
        hook_event_name: 'UserPromptSubmit',
        prompt_id: 'steer-prompt',
        prompt: value,
      });
      fake.append(assistant('end_turn', [text('Earlier response at the boundary.')]));
      fake.append(userPrompt(value, 'steer-prompt'));
    },
    now: Date.now,
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    pollMs: 2,
    steerSubmitNudgeMs: 20,
    steerAcceptanceTimeoutMs: 100,
    finalIdleObservations: 2,
  });

  const outcome = await executor.runTurn(
    baseTask,
    active,
    { id: SESSION_ID },
    TERMINAL,
    { onEvent, onStderr: io.onStderr },
  );
  await steerPromise;

  assert.equal(outcome.finalResponse, 'Current steered response.');
  assert.equal(idleReads, 3);
});

// Drives a live update into a session that stays BUSY, so Claude queues the typed text instead of
// submitting it. `recordQueued` decides what the transcript gets for the update, and `onSettled`
// drives what happens once the update resolves, which is all that separates the cases below.
// `state.busy` is the live session status and `state.onIdleRead` fires on each idle status poll,
// so a case can script the window between the earlier response finishing and the queue draining.
function queuedSteerHarness({ steerText, attachments = [], recordQueued, onSettled, ...overrides }) {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const active = { cancelRequested: false };
  const injections = [];
  let originalInjected = false;
  let steerPromise = null;
  const settled = { outcome: null, error: null };
  const state = { busy: true, idleReads: 0, onIdleRead: null };
  const io = collect();
  const sessions = {
    readConnectedSession: async () => {
      const busy = originalInjected && state.busy;
      if (!busy && originalInjected) {
        state.idleReads += 1;
        state.onIdleRead?.(state.idleReads);
      }
      return {
        id: SESSION_ID,
        provider: 'claude',
        source: 'Claude interactive',
        cwd: '/repo',
        rawStatus: busy ? 'busy' : 'idle',
        pid: PID,
      };
    },
  };
  const onEvent = (entry) => {
    io.onEvent(entry);
    if (entry.event.type !== 'claude/started' || steerPromise) return;
    steerPromise = active.steer(steerText, attachments)
      .then((outcome) => {
        settled.outcome = outcome;
        onSettled(fake, injections, state);
      })
      .catch((error) => {
        settled.error = error;
        onSettled(fake, injections, state);
      });
  };
  const { executor, submitted } = makeExecutor({
    sessions,
    resolveTerminal: async () => ({ ...TERMINAL }),
    openTranscript: () => fake.source,
    // A queued message leaves the composer empty. That is also why the guarded submit schedule
    // finds nothing held and never presses Return a second time on top of a queued update.
    readScreen: async () => ({ ok: true, reason: 'read', text: EMPTY_COMPOSER_FRAME }),
    inject: async (windowId, value) => {
      injections.push({ windowId, value });
      if (!originalInjected) {
        originalInjected = true;
        fake.append(userPrompt(value, 'original-prompt'));
        return;
      }
      recordQueued(fake, value);
    },
    now: Date.now,
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    pollMs: 2,
    steerSubmitNudgeMs: 20,
    steerAcceptanceTimeoutMs: 100,
    ...overrides,
  });
  return {
    io,
    injections,
    submitted,
    settled,
    state,
    run: async () => {
      const outcome = await executor.runTurn(
        baseTask,
        active,
        { id: SESSION_ID },
        TERMINAL,
        { onEvent, onStderr: io.onStderr },
      );
      await steerPromise;
      return outcome;
    },
  };
}

test('a live update queued by a busy Claude session confirms on its enqueue record', async () => {
  const harness = queuedSteerHarness({
    steerText: 'Apply this while Claude is still working.',
    // Task 85's exact failure: a busy session writes the queue record and NEVER a user record, so
    // the whole raw and rewritten user-record contract had nothing to match for 25 seconds.
    recordQueued: (fake, value) => fake.append(queueEnqueue(value)),
    onSettled: (fake, injections, state) => {
      // The response that was already generating finishes and the session reports IDLE. This is
      // the window an update anchored too early would finalize in: a final assistant record plus
      // two idle observations end the turn on the EARLIER answer and close the terminal before the
      // update has run at all.
      fake.append(assistant('end_turn', [text('Earlier response, still the old prompt.')]));
      state.busy = false;
      state.onIdleRead = (reads) => {
        if (reads !== 4) return;
        // Claude then drains the queue and answers the update.
        fake.append(queueRemove(injections[1].value));
        fake.append(queuedCommandAttachment(injections[1].value));
        fake.append(assistant('end_turn', [text('Applied the queued live update.')]));
      };
    },
  });

  const outcome = await harness.run();

  assert.equal(harness.injections.length, 2);
  assert.equal(harness.submitted.length, 0);
  assert.deepEqual(harness.settled.outcome, {
    taskId: baseTask.id,
    threadId: SESSION_ID,
    turnId: null,
    clientUserMessageId: 'relay-steer-7-1',
    promptSubmissionEvidence: 'transcript-queued-prompt',
    submitAttempted: false,
    submitAttempts: 0,
    // A queued update is confirmed from its enqueue record, so no composer pass ever ran.
    composerStates: [],
  });
  // The enqueue confirms delivery but not the turn boundary, so the earlier response cannot be
  // attributed to the update. Only the record of the text LEAVING the queue releases that.
  assert.equal(outcome.finalResponse, 'Applied the queued live update.');
  const update = harness.io.events.find((entry) => (
    entry.event.type === 'item/completed'
    && entry.event.item?.clientId === 'relay-steer-7-1'
  ));
  assert.equal(update.event.promptSubmissionEvidence, 'transcript-queued-prompt');
});

test('a queued image-bearing live update confirms on the rewritten enqueue record', async () => {
  const liveAttachments = [{
    id: 'image-live',
    name: 'live.png',
    path: '/repo/.data/tasks/7/attachments/live.png',
  }];
  const harness = queuedSteerHarness({
    steerText: 'Use the new direction.',
    attachments: liveAttachments,
    recordQueued: (fake, value) => {
      const [recorded] = attachmentRewrittenPrompts(value, [liveAttachments[0].path]);
      // Chips continue the session count, and the queue record is the only place this text lands.
      fake.append(queueEnqueue(renumberChips(recorded, 4)));
    },
    onSettled: (fake, injections, state) => {
      fake.append(assistant('end_turn', [text('Earlier response, still the old prompt.')]));
      state.busy = false;
      state.onIdleRead = (reads) => {
        if (reads !== 4) return;
        const [recorded] = attachmentRewrittenPrompts(
          injections[1].value,
          [liveAttachments[0].path],
        );
        fake.append(queuedCommandAttachment(renumberChips(recorded, 4)));
        fake.append(assistant('end_turn', [text('Applied the queued image update.')]));
      };
    },
  });

  const outcome = await harness.run();

  assert.equal(harness.submitted.length, 0);
  assert.equal(harness.settled.error, null);
  assert.equal(
    harness.settled.outcome.promptSubmissionEvidence,
    'transcript-queued-anchor-normalized',
  );
  assert.equal(harness.settled.outcome.submitAttempted, false);
  assert.equal(outcome.finalResponse, 'Applied the queued image update.');
});

test('a queued task notification never confirms a live update and still reports the sub-agent', async () => {
  const harness = queuedSteerHarness({
    steerText: 'This update has no matching queue record.',
    recordQueued: (fake, value) => {
      // Sub-agent task notifications travel as enqueue records too, and so would any other
      // session traffic. Neither they nor a truncated copy of our own text prove delivery.
      fake.append(queueEnqueue(QUEUED_TASK_NOTIFICATION));
      fake.append(queueEnqueue(value.slice(0, value.length - 1)));
    },
    onSettled: (fake, injections, state) => {
      fake.append(assistant('end_turn', [text('Finished without the update.')]));
      state.busy = false;
    },
  });

  const outcome = await harness.run();

  assert.equal(harness.settled.outcome, null);
  assert.equal(harness.settled.error.deliveryUncertain, true);
  assert.match(harness.settled.error.message, /did not receive exact delivery evidence/i);
  // Nothing was typed a second time on the strength of a record that proved nothing.
  assert.equal(harness.injections.length, 2);
  assert.equal(harness.submitted.length, 0);
  // And the sub-agent console signal that shares this record type still fires.
  const finished = harness.io.events.filter((entry) => entry.event.type === 'claude/agent-finished');
  assert.equal(finished.length, 1);
  assert.equal(finished[0].event.toolUseId, 'toolu_012M2JjykSAMBUw7JewJMYeX');
  assert.equal(outcome.finalResponse, 'Finished without the update.');
});

test('a queued live update whose release record never arrives ends on the inactivity ceiling', async () => {
  const harness = queuedSteerHarness({
    steerText: 'This update is delivered but never leaves the queue.',
    recordQueued: (fake, value) => fake.append(queueEnqueue(value)),
    onSettled: (fake, injections, state) => {
      // The earlier response finishes and the session goes quiet, but the transcript never records
      // the update leaving the queue, so the turn boundary is never proven.
      fake.append(assistant('end_turn', [text('Earlier response, still the old prompt.')]));
      state.busy = false;
    },
    inactivityCeilingMs: 200,
  });

  // The bounded outcome, stated rather than assumed: the update stays confirmed delivered, and the
  // turn releases its slot on the inactivity ceiling instead of finalizing on the earlier answer.
  // This is the one case the queued channel trades away, and it is the same shape the pre-existing
  // hook-acknowledged path already has when no durable user record follows.
  await assert.rejects(harness.run(), /showed no activity for/i);
  assert.equal(harness.settled.error, null);
  assert.equal(harness.settled.outcome.promptSubmissionEvidence, 'transcript-queued-prompt');
  assert.equal(harness.submitted.length, 0);
  assert.equal(harness.injections.length, 2);
});

test('a turn ending after live injection reports uncertain delivery', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const active = { cancelRequested: false };
  const injections = [];
  let steerPromise = null;
  let steerError = null;
  const sessions = {
    readConnectedSession: async () => ({
      id: SESSION_ID,
      provider: 'claude',
      source: 'Claude interactive',
      cwd: '/repo',
      rawStatus: injections.length > 0 ? 'busy' : 'idle',
      pid: PID,
    }),
  };
  const io = collect();
  const onEvent = (entry) => {
    io.onEvent(entry);
    if (entry.event.type !== 'claude/started' || steerPromise) return;
    steerPromise = active.steer('This update may land during cancellation.')
      .catch((error) => {
        steerError = error;
      });
  };
  const { executor } = makeExecutor({
    sessions,
    resolveTerminal: async () => ({ ...TERMINAL }),
    openTranscript: () => fake.source,
    readScreen: async () => ({ ok: true, reason: 'read', text: EMPTY_COMPOSER_FRAME }),
    inject: async (windowId, value) => {
      injections.push({ windowId, value });
      if (injections.length === 1) {
        fake.append(userPrompt(value, 'original-prompt'));
      } else {
        active.cancelRequested = true;
      }
    },
    now: Date.now,
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    pollMs: 2,
    steerSubmitNudgeMs: 40,
    steerAcceptanceTimeoutMs: 120,
  });

  await assert.rejects(
    executor.runTurn(
      baseTask,
      active,
      { id: SESSION_ID },
      TERMINAL,
      { onEvent, onStderr: io.onStderr },
    ),
    (error) => error.cancelled === true,
  );
  await steerPromise;

  assert.equal(injections.length, 2);
  assert.equal(steerError.deliveryUncertain, true);
  assert.match(steerError.message, /may already be queued/i);
});

test('a live Claude update never overwrites text already in the native composer', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const active = { cancelRequested: false };
  const injections = [];
  let originalInjected = false;
  let finalReady = false;
  let steerPromise = null;
  let steerError = null;
  const sessions = {
    readConnectedSession: async () => ({
      id: SESSION_ID,
      provider: 'claude',
      source: 'Claude interactive',
      cwd: '/repo',
      rawStatus: originalInjected && !finalReady ? 'busy' : 'idle',
      pid: PID,
    }),
  };
  const io = collect();
  const onEvent = (entry) => {
    io.onEvent(entry);
    if (entry.event.type !== 'claude/started' || steerPromise) return;
    steerPromise = active.steer('Do not overwrite this draft.')
      .catch((error) => {
        steerError = error;
        fake.append(assistant('end_turn', [text('Kept the native draft intact.')]));
        finalReady = true;
      });
  };
  const { executor, submitted } = makeExecutor({
    sessions,
    resolveTerminal: async () => ({ ...TERMINAL }),
    openTranscript: () => fake.source,
    readScreen: async () => ({
      ok: true,
      reason: 'read',
      text: originalInjected ? JUNK_COMPOSER_FRAME : EMPTY_COMPOSER_FRAME,
    }),
    inject: async (windowId, value) => {
      injections.push({ windowId, value });
      originalInjected = true;
      fake.append(userPrompt(value, 'original-prompt'));
    },
    now: Date.now,
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    pollMs: 2,
    steerSubmitNudgeMs: 20,
    steerAcceptanceTimeoutMs: 100,
  });

  const outcome = await executor.runTurn(
    baseTask,
    active,
    { id: SESSION_ID },
    TERMINAL,
    { onEvent, onStderr: io.onStderr },
  );
  await steerPromise;

  assert.equal(outcome.finalResponse, 'Kept the native draft intact.');
  assert.equal(injections.length, 1);
  assert.equal(submitted.length, 0);
  assert.match(steerError.message, /already contains unsent text/i);
  assert.equal(steerError.deliveryUncertain, false);
  assert.equal(
    io.events.some((entry) => entry.event.item?.clientId?.startsWith('relay-steer-')),
    false,
  );
});

test('terminal transcript activity wakes the mirror before the normal status poll timeout', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let clock = null;
  let waits = 0;
  let sessionReads = 0;
  fake.source.waitForChange = async (offset, timeoutMs) => {
    waits += 1;
    assert.equal(timeoutMs, 1000);
    if (waits === 1) {
      fake.append(userPrompt(deliveredPrompt()));
      fake.append(assistant('end_turn', [text('Woke from the transcript write.')]));
      assert.ok(fake.source.size() > offset);
      return true;
    }
    await clock.wait(timeoutMs);
    return false;
  };
  const steppedSessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy' },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const sessions = {
    readConnectedSession: async (...args) => {
      sessionReads += 1;
      return steppedSessions.readConnectedSession(...args);
    },
  };
  const harness = makeExecutor({ sessions, openTranscript: () => fake.source });
  clock = harness.clock;
  const io = collect();

  const outcome = await harness.executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Woke from the transcript write.');
  assert.equal(sessionReads, 4);
  assert.equal(clock.now(), 2000);
  assert.equal(io.events.some((entry) => entry.event.type === 'claude/message'), true);
});

test('terminal hook activity mirrors live output before the transcript flushes', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let deactivated = false;
  const hookBridge = {
    register: () => ({
      settings: { hooks: {} },
      activate: (handler) => {
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'UserPromptSubmit',
          prompt_id: 'prompt-current',
          prompt: deliveredPrompt(),
        });
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'Stop',
          prompt_id: 'prompt-stale',
          last_assistant_message: 'STALE response from the previous turn.',
          background_tasks: [],
          session_crons: [],
        });
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'PreToolUse',
          prompt_id: 'prompt-stale',
          tool_use_id: 'stale-question',
          tool_name: 'AskUserQuestion',
          tool_input: { questions: [{ question: 'Old question?' }] },
        });
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'MessageDisplay',
          prompt_id: 'prompt-current',
          message_id: 'message-1',
          index: 0,
          final: false,
          delta: 'Working.\n',
        });
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'PreToolUse',
          prompt_id: 'prompt-current',
          agent_id: 'sub-agent-1',
          tool_use_id: 'internal-tool',
          tool_name: 'Read',
          tool_input: { file_path: '/repo/internal.js' },
        });
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'PreToolUse',
          prompt_id: 'prompt-current',
          tool_use_id: 'tool-1',
          tool_name: 'Bash',
          tool_input: { command: 'npm test' },
        });
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'PostToolUse',
          prompt_id: 'prompt-current',
          tool_use_id: 'tool-1',
          tool_name: 'Bash',
          tool_input: { command: 'npm test' },
          tool_response: { stdout: 'ok' },
        });
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'MessageDisplay',
          prompt_id: 'prompt-current',
          message_id: 'message-1',
          index: 1,
          final: true,
          delta: 'Done.',
        });
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'Stop',
          prompt_id: 'prompt-current',
          prompt_id: 'prompt-1',
          last_assistant_message: 'Working.\nDone.',
          background_tasks: [],
          session_crons: [],
        });
        return true;
      },
      deactivate: () => {
        deactivated = true;
      },
    }),
  };
  const sessions = sessionSteps([
    { status: 'idle' },
    {
      status: 'idle',
      append: [
        userPrompt(deliveredPrompt()),
        assistant('tool_use', [toolUse('tool-1', 'Bash', { command: 'npm test' })]),
        toolResult('tool-1', 'ok'),
        assistant('end_turn', [text('Working.\nDone.')]),
      ],
    },
    { status: 'idle' },
  ], fake);
  const { executor } = makeExecutor({
    sessions,
    hookBridge,
    openTranscript: () => fake.source,
  });
  const io = collect();

  const outcome = await executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Working.\nDone.');
  assert.equal(deactivated, true);
  assert.equal(io.events.filter((entry) => entry.event.type === 'item/started').length, 1);
  assert.equal(io.events.filter((entry) => entry.event.type === 'item/completed').length, 1);
  const messages = io.events.filter((entry) => entry.event.type === 'claude/message');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].event.text, 'Working.');
  assert.equal(messages[1].event.text, 'Done.');
  assert.equal(messages[1].event.liveDelta, 'Done.');
  assert.equal(messages[1].event.liveFinal, true);
  assert.equal(io.events.some((entry) => /STALE response/.test(entry.message || '')), false);
  assert.equal(io.events.some((entry) => entry.event.type === 'claude/input-required'), false);
});

test('the current transcript prompt id replaces a delayed matching hook from an older turn', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let liveHook = null;
  const hookBridge = {
    register: () => ({
      settings: { hooks: {} },
      activate: (handler) => {
        liveHook = handler;
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'UserPromptSubmit',
          prompt_id: 'prompt-older-turn',
          prompt: deliveredPrompt(),
        });
        return true;
      },
      deactivate: () => true,
    }),
  };
  const sessions = sessionSteps([
    { status: 'idle' },
    {
      status: 'busy',
      append: [userPrompt(deliveredPrompt(), 'prompt-current-turn')],
    },
    {
      status: 'idle',
      mutate: () => liveHook({
        session_id: SESSION_ID,
        hook_event_name: 'Stop',
        prompt_id: 'prompt-current-turn',
        last_assistant_message: 'Current turn completed.',
        background_tasks: [],
        session_crons: [],
      }),
    },
    { status: 'idle' },
  ], fake);
  const { executor } = makeExecutor({
    sessions,
    hookBridge,
    openTranscript: () => fake.source,
    inactivityCeilingMs: 3000,
  });

  const outcome = await executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    collect(),
  );

  assert.equal(outcome.finalResponse, 'Current turn completed.');
});

test('terminal task restarts the same session with selected model and effort before typing', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const actions = [];
  let read = 0;
  const sessions = {
    readConnectedSession: async () => {
      read += 1;
      if (read <= 2) {
        return {
          id: SESSION_ID,
          source: 'Claude interactive',
          cwd: '/repo',
          rawStatus: 'idle',
          pid: PID,
        };
      }
      if (read === 5) {
        fake.append(userPrompt(deliveredPrompt()));
        fake.append(assistant('end_turn', [text('Configured terminal done.')]));
        return {
          id: SESSION_ID,
          source: 'Claude interactive',
          cwd: '/repo',
          rawStatus: 'busy',
          pid: 222,
        };
      }
      return {
        id: SESSION_ID,
        source: 'Claude interactive',
        cwd: '/repo',
        rawStatus: 'idle',
        pid: 222,
      };
    },
  };
  let terminated = false;
  const clock = mockClock();
  const injected = [];
  const relaunched = [];
  const hookSettings = {
    hooks: {
      Stop: [{
        hooks: [{ type: 'http', url: 'http://127.0.0.1:58925/hook', timeout: 1 }],
      }],
    },
  };
  const executor = new ClaudeTerminalExecutor({
    command: '/opt/claude/bin/claude',
    sessions,
    resolveTerminal: async (current) => ({
      terminalWindowId: WINDOW_ID,
      terminalTty: TTY,
      runtimeProcessId: current.pid,
    }),
    terminateProcess: async (pid) => {
      actions.push(`terminate:${pid}`);
      terminated = true;
    },
    isProcessAlive: async () => !terminated,
    relaunch: async (windowId, command) => {
      actions.push(`relaunch:${windowId}`);
      relaunched.push(command);
    },
    inject: async (windowId, value) => {
      actions.push(`inject:${windowId}`);
      injected.push(value);
    },
    // A normal composer at every gate. Supplied explicitly so this direct construction never
    // reaches the production JXA reader and never spawns osascript from the unit suite.
    readScreen: phasedScreenFrames(
      [EMPTY_COMPOSER_FRAME],
      [() => heldPasteFrame(injected[injected.length - 1]?.value ?? '')],
      () => injected.length > 0,
    ),
    sendKeys: async (windowId, value) => actions.push(`keys:${windowId}:${JSON.stringify(value)}`),
    now: clock.now,
    wait: clock.wait,
    pollMs: 1000,
    restartPollMs: 100,
    relaunchSettleMs: 10,
    hookBridge: {
      register: () => ({
        settings: hookSettings,
        activate: () => true,
        deactivate: () => true,
      }),
    },
    openTranscript: () => fake.source,
  });
  const io = collect();

  const outcome = await executor.runTurn(
    { ...baseTask, model: 'opus', effort: 'max' },
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Configured terminal done.');
  assert.deepEqual(actions.slice(0, 3), [
    `terminate:${PID}`,
    `relaunch:${WINDOW_ID}`,
    `inject:${WINDOW_ID}`,
  ]);
  assert.equal(relaunched.length, 1);
  assert.match(relaunched[0], /--resume/);
  assert.match(relaunched[0], /--model 'opus'/);
  assert.match(relaunched[0], /--effort 'max'/);
  assert.match(relaunched[0], /--settings '\{"hooks":\{"Stop":/);
  assert.equal(injected.length, 1);
  const started = io.events.find((entry) => entry.event.type === 'claude/started');
  assert.equal(started.event.model, 'opus');
  assert.equal(started.event.effort, 'max');
  assert.equal(io.events.some((entry) => /terminal is ready with opus at max effort/i.test(entry.message)), true);
});

test('a cancellation during settings restart restores Claude but never types the prompt', async () => {
  const fake = fakeTranscript();
  const active = { cancelRequested: false };
  let terminated = false;
  let reads = 0;
  const sessions = {
    readConnectedSession: async () => {
      reads += 1;
      return {
        id: SESSION_ID,
        source: 'Claude interactive',
        cwd: '/repo',
        rawStatus: 'idle',
        pid: reads <= 2 ? PID : 222,
      };
    },
  };
  const relaunched = [];
  const { executor, injected } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    resolveTerminal: async (current) => ({
      terminalWindowId: WINDOW_ID,
      terminalTty: TTY,
      runtimeProcessId: current.pid,
    }),
    terminateProcess: async () => {
      terminated = true;
      active.cancelRequested = true;
    },
    isProcessAlive: async () => !terminated,
    relaunch: async (windowId, command) => relaunched.push({ windowId, command }),
    restartPollMs: 100,
    relaunchSettleMs: 10,
  });

  await assert.rejects(
    () => executor.runTurn(
      { ...baseTask, model: 'opus', effort: 'max' },
      active,
      { id: SESSION_ID },
      TERMINAL,
      collect(),
    ),
    (error) => error.cancelled === true,
  );

  assert.equal(relaunched.length, 1);
  assert.equal(injected.length, 0);
});

test('a settings relaunch failure never sends the launch command twice or types the prompt', async () => {
  const fake = fakeTranscript();
  const sessions = sessionSteps([{ status: 'idle' }, { status: 'idle' }], fake);
  let terminated = false;
  let relaunches = 0;
  const { executor, injected } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    resolveTerminal: async () => ({ ...TERMINAL }),
    terminateProcess: async () => { terminated = true; },
    isProcessAlive: async () => !terminated,
    relaunch: async () => {
      relaunches += 1;
      throw new Error('Apple Event timed out');
    },
    restartPollMs: 100,
    relaunchSettleMs: 10,
  });

  await assert.rejects(
    () => executor.runTurn(
      { ...baseTask, model: 'opus', effort: 'max' },
      { cancelRequested: false },
      { id: SESSION_ID },
      TERMINAL,
      collect(),
    ),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /may already have run/i);
      return true;
    },
  );

  assert.equal(relaunches, 1);
  assert.equal(injected.length, 0);
});

test('a Claude process that does not exit blocks relaunch and prompt injection', async () => {
  const fake = fakeTranscript();
  const sessions = sessionSteps([{ status: 'idle' }, { status: 'idle' }], fake);
  let relaunches = 0;
  const { executor, injected } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    resolveTerminal: async () => ({ ...TERMINAL }),
    terminateProcess: async () => {},
    isProcessAlive: async () => true,
    relaunch: async () => { relaunches += 1; },
    processExitTimeoutMs: 500,
    restartPollMs: 100,
  });

  await assert.rejects(
    () => executor.runTurn(
      { ...baseTask, model: 'opus', effort: 'max' },
      { cancelRequested: false },
      { id: SESSION_ID },
      TERMINAL,
      collect(),
    ),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /did not exit/i);
      return true;
    },
  );

  assert.equal(relaunches, 0);
  assert.equal(injected.length, 0);
});

test('a terminal that becomes busy at the settings identity check is never stopped', async () => {
  const fake = fakeTranscript();
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy' },
  ], fake);
  let terminations = 0;
  const { executor, injected } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    resolveTerminal: async () => ({ ...TERMINAL }),
    terminateProcess: async () => { terminations += 1; },
  });

  await assert.rejects(
    () => executor.runTurn(
      { ...baseTask, model: 'opus', effort: 'max' },
      { cancelRequested: false },
      { id: SESSION_ID },
      TERMINAL,
      collect(),
    ),
    (error) => {
      assert.equal(error.retryable, true);
      assert.match(error.message, /became busy/i);
      return true;
    },
  );

  assert.equal(terminations, 0);
  assert.equal(injected.length, 0);
});

test('Issue 1: a freshly launched terminal with no transcript still runs the first turn visibly', async () => {
  const fake = fakeTranscript({ present: false }); // transcript does not exist at readiness time
  const sessions = sessionSteps([
    { status: 'idle' }, // registered + idle is enough; transcript existence is not required
    { status: 'busy', append: [{ type: 'mode' }, userPrompt(deliveredPrompt()), assistant('end_turn', [text('First turn done.')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor, injected } = makeExecutor({ sessions, openTranscript: () => fake.source });
  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect());
  assert.equal(outcome.finalResponse, 'First turn done.');
  assert.equal(injected.length, 1); // typed into the terminal even though no transcript existed yet
});

test('terminal turn completes when the model stops on a non-end_turn reason', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [userPrompt(deliveredPrompt()), assistant('max_tokens', [text('Truncated answer.')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor } = makeExecutor({ sessions, openTranscript: () => fake.source });
  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect());
  assert.equal(outcome.finalResponse, 'Truncated answer.');
});

test('Issue 4: a thinking-only end_turn record does not finalize before the text record flushes', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [userPrompt(deliveredPrompt()), assistant('end_turn', [thinking('deciding')])] }, // sawFinal set, no text yet
    { status: 'idle', append: [assistant('end_turn', [text('Real answer.')])] }, // text flushes one poll later
    { status: 'idle' },
  ], fake);
  const { executor } = makeExecutor({ sessions, openTranscript: () => fake.source });
  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect());
  assert.equal(outcome.finalResponse, 'Real answer.'); // not '' and not thrown
});

test('Issue 2b: a turn that ends with no final text fails non-retryably', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [userPrompt(deliveredPrompt()), assistant('end_turn', [thinking('only thinking')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor } = makeExecutor({ sessions, openTranscript: () => fake.source });
  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, false); assert.match(error.message, /without any final text/i); return true; },
  );
});

test('an idle interactive question keeps the task running until the terminal answer resumes the turn', { timeout: 1000 }, async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let liveHook = null;
  const question = {
    questions: [{ question: 'What should I review?', options: [{ label: 'Whole app' }] }],
  };
  const hookBridge = {
    register: () => ({
      settings: { hooks: {} },
      activate: (handler) => {
        liveHook = handler;
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'UserPromptSubmit',
          prompt: deliveredPrompt(),
        });
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'PreToolUse',
          tool_use_id: 'q1',
          tool_name: 'AskUserQuestion',
          tool_input: question,
        });
        return true;
      },
      deactivate: () => true,
    }),
  };
  const io = collect();
  const sessions = sessionSteps([
    { status: 'idle' },
    {
      status: 'busy',
      append: [
        userPrompt(deliveredPrompt()),
        assistant('tool_use', [text('Let me look...'), toolUse('t1', 'Bash', { command: 'ls' })]),
      ],
    },
    // Claude reports idle while AskUserQuestion is visible, but does not flush that
    // tool-use record to the transcript until the user answers in the terminal.
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'busy' }, // busy alone does not prove that the question was answered
    {
      status: 'busy',
      mutate: () => {
        assert.equal(
          io.events.filter((entry) => entry.event.type === 'claude/input-resumed').length,
          0,
        );
        liveHook({
          session_id: SESSION_ID,
          hook_event_name: 'PostToolUse',
          tool_use_id: 'q1',
          tool_name: 'AskUserQuestion',
          tool_input: question,
          tool_response: 'Whole app',
        });
      },
      append: [
        assistant('tool_use', [toolUse('q1', 'AskUserQuestion', question)]),
        toolResult('q1', 'Whole app'),
      ],
    },
    { status: 'busy', append: [assistant('end_turn', [text('Review complete.')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const attention = [];
  const { executor, injected } = makeExecutor({
    sessions,
    hookBridge,
    openTranscript: () => fake.source,
    requestAttention: (request) => {
      attention.push(request);
      return new Promise(() => {});
    },
  });

  const outcome = await executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Review complete.');
  assert.equal(injected.length, 1);
  assert.equal(attention.length, 1);
  assert.equal(attention[0].provider, 'claude');
  assert.equal(attention[0].thread.id, SESSION_ID);
  assert.equal(attention[0].thread.rawStatus, 'idle');
  assert.deepEqual(attention[0].terminal, TERMINAL);
  assert.equal(io.events.filter((entry) => entry.event.type === 'claude/input-required').length, 1);
  assert.equal(io.events.filter((entry) => entry.event.type === 'claude/input-resumed').length, 1);
  assert.equal(io.events.some((entry) => (
    entry.event.type === 'item/started'
    && entry.event.item?.tool === 'AskUserQuestion'
  )), true);
  assert.equal(io.events.some((entry) => (
    entry.event.type === 'item/completed'
    && entry.event.item?.tool === 'AskUserQuestion'
  )), true);
});

test('an unanswered interactive pause still stops at the inactivity ceiling', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const hookBridge = {
    register: () => ({
      settings: { hooks: {} },
      activate: (handler) => {
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'UserPromptSubmit',
          prompt: deliveredPrompt(),
        });
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'PreToolUse',
          tool_use_id: 'q1',
          tool_name: 'AskUserQuestion',
          tool_input: {
            questions: [{ question: 'Which scope?', options: [{ label: 'Whole app' }] }],
          },
        });
        return true;
      },
      deactivate: () => true,
    }),
  };
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [userPrompt(deliveredPrompt()), assistant('tool_use', [text('I need a choice.')])] },
    { status: 'idle' },
  ], fake);
  const { executor } = makeExecutor({
    sessions,
    hookBridge,
    openTranscript: () => fake.source,
    inactivityCeilingMs: 8000,
  });
  const io = collect();

  // The pause itself is inactivity: idle status, no new records, no transcript growth. An
  // abandoned question therefore still releases the task and session within the same bound.
  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /no activity/i);
      return true;
    },
  );

  assert.equal(io.events.filter((entry) => entry.event.type === 'claude/input-required').length, 1);
});

test('Issue 2: no double execution when a prompt injects but never starts', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }], fake); // always idle, never busy, never grows
  const { executor, injected, submitted } = makeExecutor({ sessions, openTranscript: () => fake.source, submissionTimeoutMs: 3000 });
  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /separate submit action/i);
      assert.match(error.message, /unsubmitted text/i);
      return true;
    },
  );
  assert.equal(injected.length, 1);
  assert.deepEqual(submitted, [WINDOW_ID]);
});

test('a stalled large paste receives one guarded submit action and then completes', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([
    { status: 'idle' }, // readiness
    { status: 'idle' }, // paste is visible but not submitted
    { status: 'idle' },
    { status: 'idle' }, // submit nudge threshold reached
    { status: 'idle' }, // final pre-submit status check
    { status: 'busy', append: [userPrompt(deliveredPrompt()), assistant('end_turn', [text('Submitted after the nudge.')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor, injected, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    submissionTimeoutMs: 6000,
  });
  const io = collect();

  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io);

  assert.equal(outcome.finalResponse, 'Submitted after the nudge.');
  assert.equal(injected.length, 1);
  assert.deepEqual(submitted, [WINDOW_ID]);
  assert.equal(
    io.events.some((entry) => /sent one separate submit action/i.test(entry.message)),
    true,
  );
});

test('task 364: a fresh conversation with no transcript receives the guarded submit action', async () => {
  const fake = fakeTranscript({ present: false });
  const sessions = sessionSteps([
    { status: 'idle' }, // readiness
    { status: 'idle' }, // no transcript file until the held first prompt is submitted
    { status: 'idle' },
    { status: 'idle' }, // submit nudge threshold reached
    { status: 'idle' }, // final pre-submit status check
    {
      status: 'busy',
      append: [
        userPrompt(deliveredPrompt()),
        assistant('end_turn', [text('Fresh conversation submitted after the nudge.')]),
      ],
    },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    submissionTimeoutMs: 6000,
  });

  const outcome = await executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    collect(),
  );

  assert.equal(outcome.finalResponse, 'Fresh conversation submitted after the nudge.');
  assert.deepEqual(submitted, [WINDOW_ID]);
});

test('a fresh conversation with an unreadable transcript still suppresses submit recovery', async () => {
  const fake = fakeTranscript({ present: false });
  const sessions = sessionSteps([
    { status: 'idle', mutate: () => fake.failStat(Infinity) },
    { status: 'idle' },
  ], fake);
  const { executor, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    submissionTimeoutMs: 3000,
  });

  await assert.rejects(
    () => executor.runTurn(
      baseTask,
      { cancelRequested: false },
      { id: SESSION_ID },
      TERMINAL,
      collect(),
    ),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /unsubmitted text/i);
      return true;
    },
  );
  assert.equal(submitted.length, 0);
});

test('task 341: transient busy without transcript growth does not suppress submit recovery', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([
    { status: 'idle' }, // readiness
    { status: 'busy' }, // relaunched TUI settles, but the paste is still held
    { status: 'idle' },
    { status: 'idle' }, // nudge threshold reached
    { status: 'idle' }, // final pre-submit status check
    {
      status: 'busy',
      append: [
        userPrompt(deliveredPrompt()),
        assistant('end_turn', [text('Submitted after transient busy cleared.')]),
      ],
    },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    submissionTimeoutMs: 6000,
  });
  const io = collect();

  const outcome = await executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Submitted after transient busy cleared.');
  assert.deepEqual(submitted, [WINDOW_ID]);
  assert.equal(io.events.some((entry) => entry.event.type === 'claude/input-required'), false);
});

test('task 15: resume compaction cannot impersonate continuation delivery or a user question', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let liveHook = null;
  const hookBridge = {
    register: () => ({
      settings: { hooks: {} },
      activate: (handler) => {
        liveHook = handler;
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'UserPromptSubmit',
          prompt: '/compact',
        });
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'PreCompact',
          trigger: 'auto',
        });
        return true;
      },
      deactivate: () => true,
    }),
  };
  const sessions = sessionSteps([
    { status: 'idle' }, // readiness
    {
      status: 'busy',
      append: [{ type: 'user', message: { content: '/compact' } }],
    },
    { status: 'busy' },
    {
      status: 'idle',
      append: [
        { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto' } },
        {
          type: 'user',
          isCompactSummary: true,
          message: { content: 'Summary of the earlier conversation.' },
        },
      ],
      mutate: () => liveHook({
        session_id: SESSION_ID,
        hook_event_name: 'PostCompact',
        trigger: 'auto',
      }),
    },
    { status: 'idle' }, // the compacted records get one quiet verification read
    { status: 'idle' }, // final status check before the one guarded submit
    {
      status: 'busy',
      append: [
        userPrompt(deliveredPrompt()),
        assistant('end_turn', [text('Continuation delivered after compaction.')]),
      ],
      mutate: () => liveHook({
        session_id: SESSION_ID,
        hook_event_name: 'UserPromptSubmit',
        prompt: deliveredPrompt(),
      }),
    },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor, submitted } = makeExecutor({
    sessions,
    hookBridge,
    openTranscript: () => fake.source,
    submissionTimeoutMs: 9000,
  });
  const io = collect();

  const outcome = await executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Continuation delivered after compaction.');
  assert.deepEqual(submitted, [WINDOW_ID]);
  assert.equal(io.events.filter((entry) => entry.event.type === 'claude/started').length, 1);
  assert.equal(io.events.some((entry) => entry.event.type === 'claude/input-required'), false);
  const compactedAt = io.events.findIndex((entry) => entry.event.deliveryState === 'compacted');
  const startedAt = io.events.findIndex((entry) => entry.event.type === 'claude/started');
  assert.ok(compactedAt >= 0);
  assert.ok(startedAt > compactedAt);
});

test('a submitted prompt with no processing evidence cannot occupy a busy terminal forever', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const hookBridge = {
    register: () => ({
      settings: { hooks: {} },
      activate: (handler) => {
        handler({
          session_id: SESSION_ID,
          hook_event_name: 'UserPromptSubmit',
          prompt_id: 'prompt-unverified',
          prompt: deliveredPrompt(),
        });
        return true;
      },
      deactivate: () => true,
    }),
  };
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy' },
  ], fake);
  const { executor, submitted } = makeExecutor({
    sessions,
    hookBridge,
    openTranscript: () => fake.source,
    promptAcceptanceTimeoutMs: 3000,
  });

  await assert.rejects(
    () => executor.runTurn(
      baseTask,
      { cancelRequested: false },
      { id: SESSION_ID },
      TERMINAL,
      collect(),
    ),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /reported receiving the exact prompt/i);
      assert.match(error.message, /could not verify that Claude began processing it/i);
      return true;
    },
  );
  assert.equal(submitted.length, 0);
});

test('a delayed turn that starts during the submit guard never receives the extra action', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  let resolution = 0;
  const { executor, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    resolveTerminal: async () => {
      resolution += 1;
      if (resolution === 2) {
        fake.append(userPrompt(deliveredPrompt()));
        fake.append(assistant('end_turn', [text('The original submit started late.')]));
      }
      return { ...TERMINAL };
    },
    submissionTimeoutMs: 6000,
  });

  const outcome = await executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    collect(),
  );

  assert.equal(outcome.finalResponse, 'The original submit started late.');
  assert.equal(submitted.length, 0);
});

test('partial unrelated transcript growth waits for a quiet read but cannot suppress submit recovery', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const unrelatedLine = `${JSON.stringify({
    type: 'system',
    subtype: 'compact_boundary',
    compact_metadata: { trigger: 'auto' },
  })}\n`;
  const splitAt = Math.floor(unrelatedLine.length / 2);
  let resolution = 0;
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle', mutate: () => fake.appendRaw(unrelatedLine.slice(splitAt)) },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle' },
    {
      status: 'busy',
      append: [
        userPrompt(deliveredPrompt()),
        assistant('end_turn', [text('Submitted after unrelated partial growth.')]),
      ],
    },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    resolveTerminal: async () => {
      resolution += 1;
      if (resolution === 2) fake.appendRaw(unrelatedLine.slice(0, splitAt));
      return { ...TERMINAL };
    },
    submissionTimeoutMs: 9000,
  });

  const outcome = await executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    collect(),
  );

  assert.equal(outcome.finalResponse, 'Submitted after unrelated partial growth.');
  assert.deepEqual(submitted, [WINDOW_ID]);
});

test('a stalled paste is not submitted when the exact terminal identity changes', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  let resolution = 0;
  const { executor, injected, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    resolveTerminal: async () => {
      resolution += 1;
      return resolution === 1
        ? { ...TERMINAL }
        : { terminalWindowId: 9999, terminalTty: '/dev/ttys999', runtimeProcessId: 222 };
    },
    submissionTimeoutMs: 6000,
  });

  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /pasted the prompt/i);
      assert.match(error.message, /could not safely re-verify/i);
      return true;
    },
  );
  assert.equal(injected.length, 1);
  assert.equal(submitted.length, 0);
});

test('cancellation during the final submit guard never sends the extra action', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const active = { cancelRequested: false };
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle', mutate: () => { active.cancelRequested = true; } },
  ], fake);
  const { executor, submitted, cancels } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    submissionTimeoutMs: 6000,
  });

  await assert.rejects(
    () => executor.runTurn(baseTask, active, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => error.cancelled === true,
  );

  assert.equal(submitted.length, 0);
  assert.deepEqual(cancels, [WINDOW_ID]);
});

test('a failed separate submit action never retries a pasted prompt', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const { executor, injected } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    submit: async () => { throw new Error('submit Apple Event timed out'); },
    submissionTimeoutMs: 6000,
  });

  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /could not confirm the separate submit action/i);
      assert.match(error.message, /may now be running/i);
      return true;
    },
  );
  assert.equal(injected.length, 1);
});

// ---- task 39: bounded multi-attempt guarded submit ---------------------------

// A hook bridge whose handler is captured so a test can deliver Claude hook events at an exact
// point in the schedule, such as from inside the fake submit action that finally lands.
function captureHookBridge() {
  const state = { handler: null };
  return {
    bridge: {
      register: () => ({
        settings: { hooks: {} },
        activate: (handler) => { state.handler = handler; },
        deactivate: () => { state.handler = null; },
      }),
    },
    fire: (payload) => state.handler?.(payload),
  };
}

const submitAttemptMessages = (io) => io.events
  .filter((entry) => entry.event.deliveryState === 'submit-attempt')
  .map((entry) => entry.message);

test('task 39: a swallowed first submit action is followed by a later attempt that recovers the held paste', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }], fake); // idle throughout, exactly like task 39
  let attempt = 0;
  const { executor, injected, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    submit: async (windowId) => {
      attempt += 1;
      submitted.push(windowId);
      // Attempt 1 is swallowed by the still-settling large-paste widget, exactly as the
      // 13:52:05Z action was. Attempt 2 lands and Claude records the exact prompt.
      if (attempt === 2) {
        fake.append(userPrompt(deliveredPrompt()));
        fake.append(assistant('end_turn', [text('Recovered by the second submit action.')]));
      }
    },
    submissionTimeoutMs: 40_000,
    submitRetryMs: 4000,
  });
  const io = collect();

  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io);

  assert.equal(outcome.finalResponse, 'Recovered by the second submit action.');
  assert.equal(injected.length, 1); // the prompt is never pasted twice
  assert.deepEqual(submitted, [WINDOW_ID, WINDOW_ID]);
  const attempts = submitAttemptMessages(io);
  assert.equal(attempts.length, 2);
  assert.match(attempts[0], /attempt 1 of 4/);
  assert.match(attempts[1], /attempt 2 of 4/);
  const started = io.events.find((entry) => entry.event.type === 'claude/started');
  assert.equal(started.event.promptSubmissionEvidence, 'transcript-prompt');
  assert.equal(started.event.submitAttempts, 2);
});

test('a held paste that never submits fails non-retryably after the whole bounded schedule', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const { executor, injected, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    submissionTimeoutMs: 30_000,
    submitRetryMs: 4000,
    maxSubmitAttempts: 3,
  });
  const io = collect();

  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /sent 3 separate submit actions/);
      assert.match(error.message, /unsubmitted text/i);
      return true;
    },
  );
  assert.equal(injected.length, 1);
  assert.equal(submitted.length, 3); // bounded: never one action per poll
  assert.equal(submitAttemptMessages(io).length, 3);
});

test('a UserPromptSubmit hook between attempts stops every further guarded submit action', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const hooks = captureHookBridge();
  const { executor, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    hookBridge: hooks.bridge,
    submit: async (windowId) => {
      submitted.push(windowId);
      // The landed Return produces its hook within a second or two, well inside one attempt gap.
      hooks.fire({
        session_id: SESSION_ID,
        hook_event_name: 'UserPromptSubmit',
        prompt_id: 'prompt-1',
        prompt: deliveredPrompt(),
      });
      hooks.fire({
        session_id: SESSION_ID,
        hook_event_name: 'Stop',
        prompt_id: 'prompt-1',
        last_assistant_message: 'Recovered by the first submit action.',
        background_tasks: [],
        session_crons: [],
      });
    },
    submissionTimeoutMs: 40_000,
    submitRetryMs: 4000,
  });
  const io = collect();

  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io);

  assert.equal(outcome.finalResponse, 'Recovered by the first submit action.');
  assert.deepEqual(submitted, [WINDOW_ID]);
  const started = io.events.find((entry) => entry.event.type === 'claude/started');
  assert.equal(started.event.promptSubmissionEvidence, 'user-prompt-hook');
  assert.equal(started.event.submitAttempts, 1);
});

test('an image prompt Claude rewrote into chips still anchors the turn on the durable transcript', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const task = { ...baseTask, ...ONE_IMAGE_TASK };
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [imagePromptRecord(ONE_IMAGE_RECORDED)] },
    { status: 'busy', append: [assistant('end_turn', [text('Read the screenshot.')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor, injected, submitted } = makeExecutor({ sessions, openTranscript: () => fake.source });
  const io = collect();

  const outcome = await executor.runTurn(task, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io);

  assert.equal(outcome.finalResponse, 'Read the screenshot.');
  // The delivered text still carries the real path, so nothing about injection changed.
  assert.match(injected[0].value, new RegExp(IMAGE_PATH.replace(/\//g, '\\/')));
  // No guarded submit action was needed: the rewritten anchor ended the submission wait.
  assert.equal(submitted.length, 0);
  const started = io.events.find((entry) => entry.event.type === 'claude/started');
  assert.equal(started.event.promptSubmissionEvidence, 'transcript-anchor-normalized');
  assert.equal(started.event.submitAttempts, 0);
});

test('a Task 58-style slash-normalized image prompt anchors the durable transcript', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const task = {
    ...baseTask,
    prompt: 'Review View Input / View Output.\nCall `GET /api/read` and `PUT /api/write`.',
    attachments: [{ name: 'image.png', path: IMAGE_PATH }],
  };
  const recorded = `[Image #1]Review View Input
/ View Output.
Call \`GET
/api/read\` and \`PUT
/api/write\`.
Reference images are attached. Use the Read tool to inspect every image before working:
1. image.png:
${RELAY_NON_INTERACTIVE_INSTRUCTION}`;
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [imagePromptRecord(recorded)] },
    { status: 'busy', append: [assistant('end_turn', [text('Implemented the reviewed plan.')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor, submitted } = makeExecutor({ sessions, openTranscript: () => fake.source });
  const io = collect();

  const outcome = await executor.runTurn(
    task,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Implemented the reviewed plan.');
  assert.equal(submitted.length, 0);
  const started = io.events.find((entry) => entry.event.type === 'claude/started');
  assert.equal(started.event.promptSubmissionEvidence, 'transcript-anchor-normalized');
  assert.equal(started.event.submitAttempts, 0);
});

test('a rewritten UserPromptSubmit hook stops every further guarded submit action', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const hooks = captureHookBridge();
  const { executor, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    hookBridge: hooks.bridge,
    submit: async (windowId) => {
      submitted.push(windowId);
      // Whether this hook reports the raw or the rewritten prompt is not observable from any
      // recorded payload, so the rewritten form must also stop the schedule. Otherwise an image
      // turn that really did submit keeps receiving Return actions and then dies at the
      // acceptance timeout.
      hooks.fire({
        session_id: SESSION_ID,
        hook_event_name: 'UserPromptSubmit',
        prompt_id: 'prompt-1',
        prompt: ONE_IMAGE_RECORDED,
      });
      hooks.fire({
        session_id: SESSION_ID,
        hook_event_name: 'Stop',
        prompt_id: 'prompt-1',
        last_assistant_message: 'Read the screenshot.',
        background_tasks: [],
        session_crons: [],
      });
    },
    submissionTimeoutMs: 40_000,
    submitRetryMs: 4000,
  });
  const io = collect();

  const outcome = await executor.runTurn(
    { ...baseTask, ...ONE_IMAGE_TASK },
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Read the screenshot.');
  assert.deepEqual(submitted, [WINDOW_ID]);
  const started = io.events.find((entry) => entry.event.type === 'claude/started');
  assert.equal(started.event.promptSubmissionEvidence, 'user-prompt-hook-normalized');
  assert.equal(started.event.submitAttempts, 1);
});

test('a text-only turn is unaffected: a rewritten-looking prompt never anchors it', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const hooks = captureHookBridge();
  const { executor, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    hookBridge: hooks.bridge,
    submit: async (windowId) => {
      submitted.push(windowId);
      // baseTask has no attachments, so no rewritten form exists and only the raw prompt counts.
      hooks.fire({
        session_id: SESSION_ID,
        hook_event_name: 'UserPromptSubmit',
        prompt_id: 'prompt-1',
        prompt: deliveredPrompt().replace(/\n{2,}/g, '\n'),
      });
    },
    submissionTimeoutMs: 20_000,
    submitRetryMs: 4000,
    maxSubmitAttempts: 2,
  });
  const io = collect();

  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io),
    (error) => {
      assert.equal(error.retryable, false);
      // The anchoring contract is what "unaffected" means here, and it is unchanged: a collapsed
      // text-only prompt is not this turn's prompt, so it never becomes submission evidence.
      // The closing guidance did move. A UserPromptSubmit hook for this session with no agent_id
      // means Claude submitted SOMETHING, so telling the user the terminal holds unsubmitted text
      // would invite a duplicate run of a turn that may already be live.
      assert.match(error.message, /may actually be running/i);
      assert.doesNotMatch(error.message, /unsubmitted text/i);
      return true;
    },
  );
  assert.equal(io.events.some((entry) => entry.event.type === 'claude/started'), false);
  // Permission to stop, never evidence: the latch fired but the turn was still never anchored.
  assert.equal(
    io.events.some((entry) => entry.event.deliveryState === 'unverified-submission'),
    true,
  );
});

test('a task 84 cumulative chip run anchors the turn on the durable transcript', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  // The plan council revision stage: the same session already drafted with these images, so Claude
  // numbers this prompt's chips from three. Deriving only the start-at-one form matched nothing and
  // failed the stage at promptAcceptanceTimeoutMs while Claude was writing the final plan.
  const task = { ...baseTask, ...CUMULATIVE_COUNCIL_TASK };
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [imagePromptRecord(CUMULATIVE_COUNCIL_RECORDED, 2)] },
    { status: 'busy', append: [assistant('end_turn', [text('Wrote the final reviewed plan.')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor, injected, submitted } = makeExecutor({ sessions, openTranscript: () => fake.source });
  const io = collect();

  const outcome = await executor.runTurn(task, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io);

  assert.equal(outcome.finalResponse, 'Wrote the final reviewed plan.');
  // Injection is unchanged: the delivered text still carries both real path references.
  assert.equal(injected[0].value.split(IMAGE_PATH).length - 1, 2);
  // The turn was already accepted, so CC Relay must never type or submit into it again.
  assert.equal(submitted.length, 0);
  const started = io.events.find((entry) => entry.event.type === 'claude/started');
  assert.equal(started.event.promptSubmissionEvidence, 'transcript-anchor-normalized');
  assert.equal(started.event.submitAttempts, 0);
});

test('a cumulative UserPromptSubmit hook stops every further guarded submit action', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const hooks = captureHookBridge();
  const { executor, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    hookBridge: hooks.bridge,
    submit: async (windowId) => {
      submitted.push(windowId);
      // Both evidence channels carry the same rewritten text, so both must read the chip run the
      // same way. Otherwise a turn that really did submit keeps receiving Return actions.
      hooks.fire({
        session_id: SESSION_ID,
        hook_event_name: 'UserPromptSubmit',
        prompt_id: 'prompt-1',
        prompt: renumberChips(ONE_IMAGE_RECORDED, 4),
      });
      hooks.fire({
        session_id: SESSION_ID,
        hook_event_name: 'Stop',
        prompt_id: 'prompt-1',
        last_assistant_message: 'Read the screenshot.',
        background_tasks: [],
        session_crons: [],
      });
    },
    submissionTimeoutMs: 40_000,
    submitRetryMs: 4000,
  });
  const io = collect();

  const outcome = await executor.runTurn(
    { ...baseTask, ...ONE_IMAGE_TASK },
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Read the screenshot.');
  assert.deepEqual(submitted, [WINDOW_ID]);
  const started = io.events.find((entry) => entry.event.type === 'claude/started');
  assert.equal(started.event.promptSubmissionEvidence, 'user-prompt-hook-normalized');
  assert.equal(started.event.submitAttempts, 1);
});

test('a text-only turn is never anchored by a cumulative-looking chip run', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const hooks = captureHookBridge();
  const { executor, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    hookBridge: hooks.bridge,
    submit: async (windowId) => {
      submitted.push(windowId);
      // baseTask has no attachments, so the derived chip count is zero and no chip run, cumulative
      // or otherwise, can stand in for the exact prompt.
      hooks.fire({
        session_id: SESSION_ID,
        hook_event_name: 'UserPromptSubmit',
        prompt_id: 'prompt-1',
        prompt: `[Image #4] [Image #5]${deliveredPrompt().replace(/\n{2,}/g, '\n')}`,
      });
    },
    submissionTimeoutMs: 20_000,
    submitRetryMs: 4000,
    maxSubmitAttempts: 2,
  });
  const io = collect();

  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /may actually be running/i);
      return true;
    },
  );
  assert.equal(io.events.some((entry) => entry.event.type === 'claude/started'), false);
  assert.equal(submitted.length > 0, true);
});

test('busy status suppresses an otherwise due guarded submit attempt', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  // Busy from just after the first action until the exact prompt is recorded. Busy is liveness
  // only, so it never confirms submission, but a busy terminal must never receive a Return.
  const sessions = sessionSteps([
    { status: 'idle' }, // readiness
    { status: 'idle' }, // watcher poll
    { status: 'idle' }, // watcher poll
    { status: 'idle' }, // watcher poll at the first attempt
    { status: 'idle' }, // fresh pre-submit read: attempt 1 is sent
    { status: 'busy' },
    { status: 'busy' },
    { status: 'busy' },
    { status: 'busy' }, // attempt 2 is due here and must be suppressed
    {
      status: 'busy',
      append: [
        userPrompt(deliveredPrompt()),
        assistant('end_turn', [text('The first action landed after all.')]),
      ],
    },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    submissionTimeoutMs: 40_000,
    submitRetryMs: 4000,
  });

  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect());

  assert.equal(outcome.finalResponse, 'The first action landed after all.');
  assert.deepEqual(submitted, [WINDOW_ID]);
});

test('the fresh pre-submit read, not the throttled poll sample, decides whether an attempt is sent', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  // The throttled loop sample says idle while the session has already started working. Only the
  // fresh read taken immediately before the Apple Event can catch that, and it must defer the
  // attempt without consuming one: a suppressed attempt is not an attempt.
  const sessions = sessionSteps([
    { status: 'idle' }, // readiness
    { status: 'idle' }, // injection identity check
    { status: 'idle' }, // watcher poll
    { status: 'idle' }, // watcher poll
    { status: 'idle' }, // watcher poll at the first due attempt
    { status: 'idle' }, // identity re-verification
    { status: 'busy' }, // fresh pre-submit read: the terminal is busy after all
    { status: 'idle' }, // next watcher poll
    { status: 'idle' }, // identity re-verification
    { status: 'idle' }, // fresh pre-submit read: now the action is safe
    { status: 'idle' },
  ], fake);
  let sentAt = null;
  const { executor, submitted, clock } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    resolveTerminal: async () => ({ ...TERMINAL }),
    submit: async (windowId) => {
      sentAt = clock.now();
      submitted.push(windowId);
      fake.append(userPrompt(deliveredPrompt()));
      fake.append(assistant('end_turn', [text('Sent once the fresh read agreed.')]));
    },
    submissionTimeoutMs: 40_000,
    submitRetryMs: 4000,
  });

  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect());

  assert.equal(outcome.finalResponse, 'Sent once the fresh read agreed.');
  assert.deepEqual(submitted, [WINDOW_ID]);
  assert.equal(sentAt, 3000); // deferred by exactly one poll, not consumed and not skipped
});

test('compaction suppresses an otherwise due guarded submit attempt until it finishes', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const hooks = captureHookBridge();
  // Finish compaction and land the prompt long after a second attempt would otherwise be due.
  let reads = 0;
  const sessions = {
    readConnectedSession: async () => {
      reads += 1;
      if (reads === 14) {
        hooks.fire({ session_id: SESSION_ID, hook_event_name: 'PostCompact' });
        fake.append(userPrompt(deliveredPrompt()));
        fake.append(assistant('end_turn', [text('Submitted once compaction finished.')]));
      }
      return { id: SESSION_ID, source: 'Claude interactive', cwd: '/repo', rawStatus: 'idle', pid: PID };
    },
  };
  const { executor, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    hookBridge: hooks.bridge,
    submit: async (windowId) => {
      submitted.push(windowId);
      // Claude starts compacting instead of accepting the paste. No further action may be sent
      // while compaction runs, no matter how many attempts the schedule still has.
      if (submitted.length === 1) {
        hooks.fire({ session_id: SESSION_ID, hook_event_name: 'PreCompact' });
      }
    },
    submissionTimeoutMs: 40_000,
    submitRetryMs: 4000,
  });
  const io = collect();

  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io);

  assert.equal(outcome.finalResponse, 'Submitted once compaction finished.');
  assert.deepEqual(submitted, [WINDOW_ID]);
});

test('a compaction longer than the submission window still leaves a full attempt schedule', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const hooks = captureHookBridge();
  // Compaction starts immediately and runs past submissionTimeoutMs - submitConfirmMs. Charging
  // that time to the submission window used to leave no room for any attempt and then fail the
  // turn the instant compaction ended, with the continuation still held in the composer.
  let reads = 0;
  const sessions = {
    readConnectedSession: async () => {
      reads += 1;
      // Read 1 is readiness, before the watcher activates its hook handler. Read 2 is the first
      // watcher poll at t=0, and read 27 is the poll at t=25000.
      if (reads === 2) hooks.fire({ session_id: SESSION_ID, hook_event_name: 'PreCompact' });
      if (reads === 27) hooks.fire({ session_id: SESSION_ID, hook_event_name: 'PostCompact' });
      return { id: SESSION_ID, source: 'Claude interactive', cwd: '/repo', rawStatus: 'idle', pid: PID };
    },
  };
  let sentAt = null;
  const { executor, submitted, clock } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    hookBridge: hooks.bridge,
    submit: async (windowId) => {
      sentAt = clock.now();
      submitted.push(windowId);
      fake.append(userPrompt(deliveredPrompt()));
      fake.append(assistant('end_turn', [text('Submitted after a very long compaction.')]));
    },
    submissionTimeoutMs: 20_000,
    submitConfirmMs: 5000,
    submitRetryMs: 4000,
  });

  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect());

  assert.equal(outcome.finalResponse, 'Submitted after a very long compaction.');
  assert.deepEqual(submitted, [WINDOW_ID]);
  // Wall time is well past the window; only idle time counts against it.
  assert.equal(sentAt, 25_000);
});

test('a busy stretch longer than the submission window still leaves a full attempt schedule', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  // Same starvation shape driven by busy status instead of compaction.
  const sessions = sessionSteps([
    { status: 'idle' }, // readiness
    ...Array.from({ length: 25 }, () => ({ status: 'busy' })),
    { status: 'idle' },
  ], fake);
  let sentAt = null;
  const { executor, submitted, clock } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    submit: async (windowId) => {
      sentAt = clock.now();
      submitted.push(windowId);
      fake.append(userPrompt(deliveredPrompt()));
      fake.append(assistant('end_turn', [text('Submitted after a very long busy stretch.')]));
    },
    submissionTimeoutMs: 20_000,
    submitConfirmMs: 5000,
    submitRetryMs: 4000,
  });

  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect());

  assert.equal(outcome.finalResponse, 'Submitted after a very long busy stretch.');
  assert.deepEqual(submitted, [WINDOW_ID]);
  assert.equal(sentAt, 25_000);
});

test('a hook that lands during the fresh pre-submit read cancels the dispatch', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const hooks = captureHookBridge();
  // The fresh readConnectedSession is an await. Evidence can arrive inside it, after every other
  // guard has already passed, so correlation is re-checked once more before the Apple Event.
  let reads = 0;
  const sessions = {
    readConnectedSession: async () => {
      reads += 1;
      if (reads === 5) {
        hooks.fire({
          session_id: SESSION_ID,
          hook_event_name: 'UserPromptSubmit',
          prompt_id: 'prompt-1',
          prompt: deliveredPrompt(),
        });
        hooks.fire({
          session_id: SESSION_ID,
          hook_event_name: 'Stop',
          prompt_id: 'prompt-1',
          last_assistant_message: 'The paste had already been accepted.',
          background_tasks: [],
          session_crons: [],
        });
      }
      return { id: SESSION_ID, source: 'Claude interactive', cwd: '/repo', rawStatus: 'idle', pid: PID };
    },
  };
  const { executor, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    hookBridge: hooks.bridge,
    submissionTimeoutMs: 40_000,
    submitRetryMs: 4000,
  });
  const io = collect();

  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io);

  assert.equal(outcome.finalResponse, 'The paste had already been accepted.');
  assert.equal(submitted.length, 0);
  const started = io.events.find((entry) => entry.event.type === 'claude/started');
  assert.equal(started.event.submitAttempts, 0);
});

test('a verified pending question never receives a guarded submit action', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const hooks = captureHookBridge();
  const sessions = sessionSteps([
    { status: 'idle' },
    {
      status: 'busy',
      append: [
        userPrompt(deliveredPrompt()),
        assistant('tool_use', [toolUse('q1', 'AskUserQuestion', { questions: [{ question: 'Which scope?' }] })]),
      ],
    },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle', append: [toolResult('q1', 'Answered in the terminal.')] },
    { status: 'busy', append: [assistant('end_turn', [text('Continued after the answer.')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    hookBridge: hooks.bridge,
    submissionTimeoutMs: 40_000,
    submitRetryMs: 4000,
  });
  const io = collect();

  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io);

  assert.equal(outcome.finalResponse, 'Continued after the answer.');
  assert.equal(submitted.length, 0);
  assert.equal(io.types().includes('claude/input-required'), true);
});

test('an unreadable transcript suppresses every attempt in the schedule, not just the first', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  // The established transcript is readable at injection and becomes unreadable immediately
  // afterwards. Uncertainty about the file must fail closed for the whole schedule.
  let reads = 0;
  const sessions = {
    readConnectedSession: async () => {
      reads += 1;
      if (reads === 2) fake.failStat(Infinity);
      return { id: SESSION_ID, source: 'Claude interactive', cwd: '/repo', rawStatus: 'idle', pid: PID };
    },
  };
  const { executor, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    submissionTimeoutMs: 30_000,
    submitRetryMs: 4000,
  });

  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /never started the turn/i);
      return true;
    },
  );
  assert.equal(submitted.length, 0);
});

test('task 364: a fresh absent transcript still receives later attempts, not only the first', async () => {
  const fake = fakeTranscript({ present: false });
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  let attempt = 0;
  const { executor, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    submit: async (windowId) => {
      attempt += 1;
      submitted.push(windowId);
      if (attempt === 3) {
        fake.append(userPrompt(deliveredPrompt()));
        fake.append(assistant('end_turn', [text('Fresh conversation recovered on attempt 3.')]));
      }
    },
    submissionTimeoutMs: 40_000,
    submitRetryMs: 4000,
  });

  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect());

  assert.equal(outcome.finalResponse, 'Fresh conversation recovered on attempt 3.');
  assert.equal(submitted.length, 3);
});

test('a terminal identity change stops the schedule after the attempts already sent', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  let resolution = 0;
  const { executor, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    resolveTerminal: async () => {
      resolution += 1;
      // Resolution 1 is the injection-time check and 2 is the first attempt. By the second
      // attempt the window belongs to another session, so no further action may be sent.
      return resolution <= 2
        ? { ...TERMINAL }
        : { terminalWindowId: 9999, terminalTty: '/dev/ttys999', runtimeProcessId: 222 };
    },
    submissionTimeoutMs: 40_000,
    submitRetryMs: 4000,
  });

  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /could not safely re-verify/i);
      return true;
    },
  );
  assert.equal(submitted.length, 1);
});

test('a transient identity resolution flake skips one attempt and the next one still recovers', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  let resolution = 0;
  const { executor, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    resolveTerminal: async () => {
      resolution += 1;
      // Resolution 1 is the injection-time check. One flake at the first attempt proves nothing
      // about the composer, so it must skip that attempt instead of ending the turn.
      if (resolution === 2) throw new Error('discovery flaked');
      return { ...TERMINAL };
    },
    submit: async (windowId) => {
      submitted.push(windowId);
      fake.append(userPrompt(deliveredPrompt()));
      fake.append(assistant('end_turn', [text('Recovered after the resolution flake.')]));
    },
    submissionTimeoutMs: 40_000,
    submitRetryMs: 4000,
  });

  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect());

  assert.equal(outcome.finalResponse, 'Recovered after the resolution flake.');
  assert.deepEqual(submitted, [WINDOW_ID]);
});

test('a persistent identity resolution flake still ends the turn without any submit action', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  let resolution = 0;
  const { executor, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    resolveTerminal: async () => {
      resolution += 1;
      // Injection resolves normally; every guarded re-verification after it keeps failing.
      if (resolution === 1) return { ...TERMINAL };
      throw new Error('discovery keeps flaking');
    },
    submissionTimeoutMs: 40_000,
    submitRetryMs: 4000,
  });

  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /could not safely re-verify/i);
      return true;
    },
  );
  assert.equal(submitted.length, 0);
});

// ---- resume picker, trust dialog, and composer verification -------------------
//
// Task 39 (July 30, 2026): a Plan council revision stage relaunched `claude --resume` for a
// conversation 3h 6m old and 187.2k tokens. Claude Code 2.1.220 showed its large-session resume
// picker instead of the composer, the session registered as idle the whole time, CC Relay pasted
// the 201-line prompt into the dialog, the appended Return confirmed the highlighted summary
// option, a 2.5 minute compaction destroyed the paste, and all four guarded submit actions then
// pressed Return at an empty composer.

// A relaunch flow whose session reports the old pid for the first two reads and the new pid after,
// exactly as a settings restart looks to discovery. Screen frames are phase driven: the
// beforePaste list drives every readiness gate, the afterPaste list drives the submit schedule.
function relaunchHarness({
  beforePaste = [EMPTY_COMPOSER_FRAME],
  afterPaste = null,
  task = { ...baseTask, model: 'opus', effort: 'max' },
  ...overrides
} = {}) {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let harness = null;
  let reads = 0;
  let appended = false;
  const sessions = {
    readConnectedSession: async () => {
      reads += 1;
      // The turn's records appear once the prompt has actually been pasted, never before.
      if (!appended && harness?.injected.length > 0) {
        appended = true;
        fake.append(userPrompt(deliveredPrompt(task)));
        fake.append(assistant('end_turn', [text('Revision delivered after the resume dialog.')]));
      }
      return {
        id: SESSION_ID,
        source: 'Claude interactive',
        cwd: '/repo',
        rawStatus: 'idle',
        pid: reads <= 2 ? PID : 222,
      };
    },
  };
  let terminated = false;
  const reader = { current: null };
  harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    resolveTerminal: async (current) => ({
      terminalWindowId: WINDOW_ID,
      terminalTty: TTY,
      runtimeProcessId: current.pid,
    }),
    terminateProcess: async () => { terminated = true; },
    isProcessAlive: async () => !terminated,
    relaunch: async () => {},
    readScreen: async (windowId) => reader.current(windowId),
    restartPollMs: 100,
    relaunchSettleMs: 10,
    ...overrides,
  });
  reader.current = phasedScreenFrames(
    beforePaste,
    afterPaste || [() => heldPasteFrame(harness.injected[harness.injected.length - 1]?.value ?? '')],
    () => harness.injected.length > 0,
  );
  return { ...harness, task, fake };
}

// A plain continuation turn: no model or effort, so settings.apply is false and relaunchForTask
// never runs. A conversation resumed by the disposable pool launch reaches the composer gate with
// no relaunch at all, and the picker depends on the conversation's age and size, not on how it was
// started, so this path needs the same protection.
function continuationHarness({ beforePaste, afterPaste = null, ...overrides } = {}) {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let harness = null;
  let appended = false;
  const sessions = {
    readConnectedSession: async () => {
      if (!appended && harness?.injected.length > 0 && overrides.autoComplete !== false) {
        appended = true;
        fake.append(userPrompt(deliveredPrompt()));
        fake.append(assistant('end_turn', [text('Continuation delivered after the resume dialog.')]));
      }
      return { id: SESSION_ID, source: 'Claude interactive', cwd: '/repo', rawStatus: 'idle', pid: PID };
    },
  };
  const { autoComplete, ...executorOverrides } = overrides;
  const reader = { current: null };
  harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    readScreen: async (windowId) => reader.current(windowId),
    ...executorOverrides,
  });
  reader.current = phasedScreenFrames(
    beforePaste,
    afterPaste || [() => heldPasteFrame(harness.injected[harness.injected.length - 1]?.value ?? '')],
    () => harness.injected.length > 0,
  );
  return { ...harness, fake };
}

test('task 39: the resume picker at relaunch readiness is answered before anything is pasted', async () => {
  const harness = relaunchHarness({
    // The relaunched session registers as idle while the picker is displayed, which is exactly
    // why status readiness alone was not enough.
    beforePaste: [RESUME_PICKER_FRAME, EMPTY_COMPOSER_FRAME],
  });
  const io = collect();

  const outcome = await harness.executor.runTurn(
    harness.task,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Revision delivered after the resume dialog.');
  // Exactly one resolution, and it sent the verified single digit that selects AND confirms
  // "Resume full session as-is". Never a bare Return, never "1", never "3".
  assert.deepEqual(harness.keys, [{ windowId: WINDOW_ID, value: CLAUDE_RESUME_PICKER_KEYS }]);
  assert.equal(CLAUDE_RESUME_PICKER_KEYS, '2');
  assert.equal(harness.injected.length, 1);
  // Nothing was pasted while the dialog was up: the keys strictly precede the paste.
  assert.deepEqual(harness.timeline.map((entry) => entry.action), ['keys', 'inject']);
  const resolved = io.events.find((entry) => entry.event.deliveryState === 'resume-picker-resolved');
  assert.equal(resolved.event.resumePickerChoice, 'continue');
  assert.equal(resolved.event.resumePickerAttempt, 1);
  assert.match(resolved.message, /Resume full session as-is/);
  // The dialog was answered by the RELAUNCH gate, not merely by the later pre-injection gate:
  // the resolution precedes the readiness announcement that ends relaunchForTask.
  const readyIndex = io.events.findIndex((entry) => /terminal is ready with opus at max effort/i.test(entry.message));
  const resolvedIndex = io.events.indexOf(resolved);
  assert.ok(resolvedIndex >= 0 && readyIndex > resolvedIndex);
});

test('the resume picker is answered on the plain continuation path that never relaunches', async () => {
  const harness = continuationHarness({
    beforePaste: [RESUME_PICKER_FRAME, EMPTY_COMPOSER_FRAME],
  });
  const io = collect();

  const outcome = await harness.executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Continuation delivered after the resume dialog.');
  assert.deepEqual(harness.keys, [{ windowId: WINDOW_ID, value: CLAUDE_RESUME_PICKER_KEYS }]);
  assert.equal(harness.injected.length, 1);
  assert.deepEqual(harness.timeline.slice(0, 2).map((entry) => entry.action), ['keys', 'inject']);
});

// ---- launch settings applied before the terminal opened ----------------------
//
// The disposable pool now puts the task's model and effort on the FIRST launch command, so the
// live process is already configured and the stop-and-relaunch that users watched as an open,
// close, and reopen is unnecessary. The skip is allowed only on a structured, pid-bound fact
// recorded by the launcher; every uncertainty keeps the restart.

const PREAPPLIED_HOOK_SETTINGS = {
  hooks: {
    Stop: [{
      hooks: [{ type: 'http', url: 'http://127.0.0.1:58925/hook', timeout: 1 }],
    }],
  },
};

const preappliedHookBridge = () => ({
  register: () => ({
    settings: PREAPPLIED_HOOK_SETTINGS,
    activate: () => true,
    deactivate: () => true,
  }),
});

function recordedLaunchSettings(overrides = {}) {
  return {
    model: 'opus',
    effort: 'max',
    permissionMode: null,
    tools: [],
    addDirectories: [],
    hookSettingsJson: JSON.stringify(PREAPPLIED_HOOK_SETTINGS),
    ...overrides,
  };
}

const configuredTask = { ...baseTask, model: 'opus', effort: 'max' };

test('a Claude terminal launched with the task model and effort is never restarted before typing', async () => {
  const restarts = [];
  const harness = continuationHarness({
    beforePaste: [EMPTY_COMPOSER_FRAME],
    hookBridge: preappliedHookBridge(),
    resolveTerminal: async (current) => ({
      terminalWindowId: WINDOW_ID,
      terminalTty: TTY,
      runtimeProcessId: current.pid,
      launchSettings: recordedLaunchSettings(),
    }),
    terminateProcess: async (pid) => { restarts.push(`terminate:${pid}`); },
    isProcessAlive: async () => true,
    relaunch: async (windowId) => { restarts.push(`relaunch:${windowId}`); },
  });
  const io = collect();

  const outcome = await harness.executor.runTurn(
    configuredTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    { ...TERMINAL, launchSettings: recordedLaunchSettings() },
    io,
  );

  assert.equal(outcome.finalResponse, 'Continuation delivered after the resume dialog.');
  // The whole reported bug: no kill, no relaunch, one paste into the terminal that already exists.
  assert.deepEqual(restarts, []);
  assert.equal(harness.injected.length, 1);
  assert.deepEqual(harness.timeline.map((entry) => entry.action), ['inject']);
  const preapplied = io.events.find((entry) => entry.event.deliveryState === 'launch-settings-preapplied');
  assert.match(preapplied.message, /already started with opus at max effort/i);
  assert.equal(io.events.some((entry) => /^Restarting the /.test(entry.message)), false);
  // The turn still reports the settings it actually ran with.
  const started = io.events.find((entry) => entry.event.type === 'claude/started');
  assert.equal(started.event.model, 'opus');
  assert.equal(started.event.effort, 'max');
});

test('the resume picker is answered on the pre-configured launch path that never relaunches', async () => {
  const restarts = [];
  const harness = continuationHarness({
    // A conversation over ~70 minutes idle and over 100k tokens shows Claude Code's resume picker
    // on --resume regardless of how it was launched, and that screen used to be classified inside
    // the relaunch gate. With the relaunch skipped, the pre-injection gate has to own it.
    beforePaste: [RESUME_PICKER_FRAME, EMPTY_COMPOSER_FRAME],
    hookBridge: preappliedHookBridge(),
    resolveTerminal: async (current) => ({
      terminalWindowId: WINDOW_ID,
      terminalTty: TTY,
      runtimeProcessId: current.pid,
      launchSettings: recordedLaunchSettings(),
    }),
    terminateProcess: async () => { restarts.push('terminate'); },
    isProcessAlive: async () => true,
    relaunch: async () => { restarts.push('relaunch'); },
  });
  const io = collect();

  const outcome = await harness.executor.runTurn(
    configuredTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    { ...TERMINAL, launchSettings: recordedLaunchSettings() },
    io,
  );

  assert.equal(outcome.finalResponse, 'Continuation delivered after the resume dialog.');
  assert.deepEqual(restarts, []);
  assert.deepEqual(harness.keys, [{ windowId: WINDOW_ID, value: CLAUDE_RESUME_PICKER_KEYS }]);
  assert.equal(harness.injected.length, 1);
  // The dialog was answered strictly before anything was pasted.
  assert.deepEqual(harness.timeline.map((entry) => entry.action), ['keys', 'inject']);
  const resolved = io.events.find((entry) => entry.event.deliveryState === 'resume-picker-resolved');
  assert.equal(resolved.event.resumePickerChoice, 'continue');
});

test('the folder trust dialog still fails closed on the pre-configured launch path', async () => {
  const harness = continuationHarness({
    beforePaste: [TRUST_DIALOG_FRAME],
    hookBridge: preappliedHookBridge(),
    terminateProcess: async () => { throw new Error('the terminal must not be restarted'); },
    relaunch: async () => { throw new Error('the terminal must not be restarted'); },
  });

  await assert.rejects(
    () => harness.executor.runTurn(
      configuredTask,
      { cancelRequested: false },
      { id: SESSION_ID },
      { ...TERMINAL, launchSettings: recordedLaunchSettings() },
      collect(),
    ),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /trust/i);
      return true;
    },
  );
  assert.equal(harness.keys.length, 0);
  assert.equal(harness.injected.length, 0);
});

test('a recorded launch that does not match the task settings still restarts the terminal', async () => {
  for (const [label, recorded] of [
    ['a different model', recordedLaunchSettings({ model: 'fable' })],
    ['a different effort', recordedLaunchSettings({ effort: 'high' })],
    ['a different hook payload', recordedLaunchSettings({ hookSettingsJson: JSON.stringify({ hooks: {} }) })],
    ['plan mode this task did not ask for', recordedLaunchSettings({ permissionMode: 'plan' })],
    ['no recorded settings at all', null],
  ]) {
    let terminated = false;
    const restarts = [];
    const relaunched = [];
    const harness = relaunchHarness({
      hookBridge: preappliedHookBridge(),
      terminateProcess: async (pid) => { restarts.push(`terminate:${pid}`); terminated = true; },
      isProcessAlive: async () => !terminated,
      relaunch: async (windowId, command) => {
        restarts.push(`relaunch:${windowId}`);
        relaunched.push(command);
      },
    });
    const io = collect();

    const outcome = await harness.executor.runTurn(
      harness.task,
      { cancelRequested: false },
      { id: SESSION_ID },
      recorded ? { ...TERMINAL, launchSettings: recorded } : TERMINAL,
      io,
    );

    assert.equal(outcome.finalResponse, 'Revision delivered after the resume dialog.', label);
    assert.deepEqual(restarts, [`terminate:${PID}`, `relaunch:${WINDOW_ID}`], label);
    assert.match(relaunched[0], /--model 'opus'/, label);
    assert.match(relaunched[0], /--effort 'max'/, label);
    assert.equal(
      io.events.some((entry) => entry.event.deliveryState === 'launch-settings-preapplied'),
      false,
      label,
    );
  }
});

test('a resume picker that survives the digit falls back to the arrow exactly once, then fails closed', async () => {
  const harness = continuationHarness({
    beforePaste: [RESUME_PICKER_FRAME], // never clears
  });

  await assert.rejects(
    () => harness.executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /kept showing the resume dialog/i);
      assert.match(error.message, /Resume full session as-is/);
      return true;
    },
  );

  // Digit first, then the once-only down-arrow fallback, then it stops pressing keys and asks the
  // user to resolve it. Never a third attempt, and never a key that could pick option 1 or 3.
  assert.deepEqual(harness.keys.map((entry) => entry.value), [
    CLAUDE_RESUME_PICKER_KEYS,
    CLAUDE_RESUME_PICKER_FALLBACK_KEYS,
  ]);
  assert.equal(harness.injected.length, 0);
  assert.equal(harness.submitted.length, 0);
});

test('the folder trust prompt is never answered and never typed into', async () => {
  const harness = continuationHarness({
    beforePaste: [TRUST_DIALOG_FRAME],
  });

  await assert.rejects(
    () => harness.executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /folder trust prompt/i);
      assert.match(error.message, /never answers that prompt for you/i);
      return true;
    },
  );

  // Trusting a folder grants read, edit, and execute access. That decision belongs to the user.
  assert.equal(harness.keys.length, 0);
  assert.equal(harness.injected.length, 0);
});

test('an unknown dialog is never typed into, never answered, and names itself in the failure', async () => {
  const harness = continuationHarness({
    beforePaste: [UNKNOWN_DIALOG_FRAME],
    readinessTimeoutMs: 2000,
  });

  await assert.rejects(
    () => harness.executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /showing something other than its prompt composer/i);
      // The user sees WHAT is blocking without opening the terminal.
      assert.match(error.message, /Do the thing/);
      // And the one false-positive path, a window the user scrolled up, is named.
      assert.match(error.message, /scroll back to the bottom/i);
      return true;
    },
  );

  assert.equal(harness.injected.length, 0);
  // A dialog CC Relay does not understand never receives keystrokes.
  assert.equal(harness.keys.length, 0);
});

test('leftover text in the composer is cleared once before the prompt is pasted on top of it', async () => {
  const harness = continuationHarness({
    // Gate confirms a composer, then the residue check finds the user's half typed note and
    // clears it. This is the state the user photographed during the incident.
    beforePaste: [JUNK_COMPOSER_FRAME, JUNK_COMPOSER_FRAME, EMPTY_COMPOSER_FRAME],
  });
  const io = collect();

  const outcome = await harness.executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Continuation delivered after the resume dialog.');
  // Exactly one Ctrl+C, sent before the paste, never after it.
  assert.deepEqual(harness.keys, [{ windowId: WINDOW_ID, value: CLAUDE_COMPOSER_CLEAR_KEYS }]);
  assert.deepEqual(harness.timeline.map((entry) => entry.action), ['keys', 'inject']);
  assert.equal(harness.injected.length, 1);
  assert.equal(
    io.events.some((entry) => entry.event.deliveryState === 'composer-cleared'),
    true,
  );
});

test('a clean composer receives no keystroke at all before the paste', async () => {
  const harness = continuationHarness({ beforePaste: [EMPTY_COMPOSER_FRAME] });
  const io = collect();

  await harness.executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io);

  // The common path is untouched: no clear, no dialog keys, just the paste.
  assert.equal(harness.keys.length, 0);
  assert.deepEqual(harness.timeline.map((entry) => entry.action), ['inject']);
  assert.equal(
    io.events.some((entry) => entry.event.deliveryState === 'composer-cleared'),
    false,
  );
});

test('residue that survives the clear stops the turn instead of corrupting the prompt', async () => {
  const harness = continuationHarness({
    beforePaste: [JUNK_COMPOSER_FRAME], // the leftover text never goes away
  });

  await assert.rejects(
    () => harness.executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /still holding text that CC Relay could not clear/i);
      assert.match(error.message, /half typed note/);
      return true;
    },
  );

  // One clear attempt, and the prompt was never pasted on top of unknown text.
  assert.equal(harness.keys.length, 1);
  assert.equal(harness.injected.length, 0);
});

test('task 39 end to end: the picker swallows the paste, CC Relay answers it and re-arms the prompt', async () => {
  // The literal incident. The gate passes because the composer is genuinely there, the paste is
  // swallowed by a picker that appears while the session still registers idle, and every guarded
  // Return afterwards would have been pressed at an empty composer. This is the replay of that
  // sequence with the fix in place.
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let harness = null;
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const reader = { current: null };
  harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    readScreen: async (windowId) => reader.current(windowId),
    inject: async (windowId, value) => {
      harness.injected.push({ windowId, value });
      harness.timeline.push({ action: 'inject', windowId, value });
      // The re-armed paste is the one that survives: it correlates through the transcript exactly
      // as a real accepted prompt does.
      if (harness.injected.length === 2) {
        fake.append(userPrompt(deliveredPrompt()));
        fake.append(assistant('end_turn', [text('Revision plan delivered after the picker was answered.')]));
      }
    },
  });
  reader.current = phasedScreenFrames(
    [EMPTY_COMPOSER_FRAME], // the gate sees a healthy composer, so the prompt is pasted
    [
      RESUME_PICKER_FRAME, // the paste vanished into the dialog, which is now on screen
      EMPTY_COMPOSER_FRAME, // answered: the composer is back, and provably empty
      EMPTY_COMPOSER_FRAME,
    ],
    () => harness.injected.length > 0,
  );
  const io = collect();

  const outcome = await harness.executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Revision plan delivered after the picker was answered.');
  // Answering the dialog consumed no submit attempt, and no Return was ever pressed at the picker
  // or at the empty composer that followed it.
  assert.deepEqual(harness.timeline.map((entry) => entry.action), ['inject', 'keys', 'inject']);
  assert.deepEqual(harness.keys, [{ windowId: WINDOW_ID, value: CLAUDE_RESUME_PICKER_KEYS }]);
  assert.equal(harness.submitted.length, 0);
  // Exactly one re-arm, carrying the byte-identical prompt.
  assert.equal(harness.injected.length, 2);
  assert.equal(harness.injected[0].value, harness.injected[1].value);
  assert.equal(io.events.filter((entry) => entry.event.deliveryState === 're-injected').length, 1);
  assert.equal(
    io.events.filter((entry) => entry.event.deliveryState === 'resume-picker-resolved').length,
    1,
  );
  // And the turn correlated on the exact prompt, not on anything the dialog produced.
  const started = io.events.find((entry) => entry.event.type === 'claude/started');
  assert.equal(started.event.promptSubmissionEvidence, 'transcript-prompt');
  assert.equal(started.event.submitAttempts, 0);
});

test('a trust dialog discovered after the paste fails closed with a message that admits the paste', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let harness = null;
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const reader = { current: null };
  harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    readScreen: async (windowId) => reader.current(windowId),
  });
  reader.current = phasedScreenFrames(
    [EMPTY_COMPOSER_FRAME],
    [TRUST_DIALOG_FRAME],
    () => harness.injected.length > 0,
  );

  await assert.rejects(
    () => harness.executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => {
      assert.equal(error.retryable, false);
      // Post-injection wording: claiming nothing was typed would be false here.
      assert.match(error.message, /had already pasted this task's prompt/i);
      assert.match(error.message, /will not retry automatically/i);
      assert.equal(/did not type anything/i.test(error.message), false);
      assert.match(error.message, /never answers the trust prompt for you/i);
      return true;
    },
  );

  assert.equal(harness.submitted.length, 0); // never a Return at a security question
  assert.equal(harness.keys.length, 0); // and never an answer to it
  assert.equal(harness.injected.length, 1); // no re-arm into a dialog
});

test('an unreadable screen after a junk clear never lets a Return follow the junk', async () => {
  // The invariant: no Return may follow a junk-positive snapshot without a readable snapshot
  // proving the junk is gone. A failed re-snapshot is not that proof, and the general
  // submit-time fail-open rule cannot apply once the composer was positively identified as
  // holding text that is not this turn's prompt.
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let harness = null;
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const reader = { current: null };
  harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    readScreen: async (windowId) => reader.current(windowId),
    submissionTimeoutMs: 20_000,
  });
  reader.current = phasedScreenFrames(
    [EMPTY_COMPOSER_FRAME],
    [
      JUNK_COMPOSER_FRAME, // attempt 1 finds foreign text
      null, // the re-snapshot after the clear fails: the clear is NOT proven to have landed
      null, // and it keeps failing for the rest of the window
    ],
    () => harness.injected.length > 0,
  );
  const io = collect();

  await assert.rejects(
    () => harness.executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /never started the turn/i);
      return true;
    },
  );

  // One clear was sent, and then nothing: no Return that could have submitted the foreign text,
  // and no re-arm on top of a composer that was never proven clear.
  assert.deepEqual(harness.keys, [{ windowId: WINDOW_ID, value: CLAUDE_COMPOSER_CLEAR_KEYS }]);
  assert.equal(harness.submitted.length, 0);
  assert.equal(harness.injected.length, 1);
  // The turn stayed recoverable rather than failing at the first unreadable snapshot, and the
  // degraded verification was announced.
  assert.equal(
    io.events.some((entry) => entry.event.deliveryState === 'screen-unverified'),
    true,
  );
});

test('an empty composer with proof of loss is re-armed exactly once and the submit schedule continues', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let harness = null;
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const reader = { current: null };
  harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    readScreen: async (windowId) => reader.current(windowId),
    submit: async (windowId) => {
      harness.submitted.push(windowId);
      harness.timeline.push({ action: 'submit', windowId });
      fake.append(userPrompt(deliveredPrompt()));
      fake.append(assistant('end_turn', [text('Delivered by the re-armed paste.')]));
    },
  });
  reader.current = phasedScreenFrames(
    [EMPTY_COMPOSER_FRAME],
    [
      // What makes the emptiness below provable at all. Task 92 (2026-08-03) established that an
      // empty composer on its own is buffered stdin rather than a lost paste, so this turn needs
      // the dialog that swallowed the paste on screen first: answering it is CC Relay's own
      // keystroke landing strictly after the paste.
      RESUME_PICKER_FRAME,
      EMPTY_COMPOSER_FRAME, // the snapshot the resolver takes right after answering it
      // The next attempt finds the composer empty, which now proves the paste is gone: a Return
      // can only submit text that is there. After the re-arm it holds the collapsed paste again.
      EMPTY_COMPOSER_FRAME,
      () => heldPasteFrame(harness.injected[harness.injected.length - 1]?.value ?? ''),
    ],
    () => harness.injected.length > 0,
  );
  const io = collect();

  const outcome = await harness.executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Delivered by the re-armed paste.');
  // The exact same prompt, delivered twice, never a modified one.
  assert.equal(harness.injected.length, 2);
  assert.equal(harness.injected[0].value, harness.injected[1].value);
  // The re-arm consumed no submit attempt: the schedule still sent its own action afterwards.
  assert.deepEqual(harness.submitted, [WINDOW_ID]);
  const rearmed = io.events.filter((entry) => entry.event.deliveryState === 're-injected');
  assert.equal(rearmed.length, 1);
  assert.equal(rearmed[0].event.promptReinjection, 1);
  assert.match(rearmed[0].message, /composer was empty/i);
  const started = io.events.find((entry) => entry.event.type === 'claude/started');
  assert.equal(started.event.submitAttempts, 1);
});

// Task 92 (2026-08-03, session 84ca0eff, Agreau, 65,966 characters and two images). A freshly
// launched claude renders its composer box before its input loop starts consuming stdin, and this
// machine's SessionStart hooks emit roughly 77KB and delay that loop well past seven seconds. At
// 14:44:00.654Z ONE screen read saw an empty composer, called the held paste lost, and pasted the
// same prompt again. Both pastes were still buffered, so when the loop finally started they flushed
// in together: Claude durably recorded a single 132,976 character prompt with four image parts and
// a duplicate seam at offset 66,509. The empty composer was never proof of loss.
test('a never-seen paste on a starting session is waited out instead of being pasted again', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let harness = null;
  let screenReads = 0;
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    submissionTimeoutMs: 20_000,
    submitRetryMs: 3000,
    readScreen: async () => {
      // The pre-injection gates see the same empty composer a stalled input loop shows.
      if (harness.injected.length === 0) {
        return { ok: true, reason: 'read', text: EMPTY_COMPOSER_FRAME };
      }
      screenReads += 1;
      // The buffered paste finally reaches Claude's input loop and submits itself with the Return
      // it has carried all along, exactly as task 92's did, just without a second copy in front.
      if (screenReads === 3) {
        fake.append(userPrompt(deliveredPrompt()));
        fake.append(assistant('end_turn', [text('Delivered by the paste the starting session buffered.')]));
      }
      return { ok: true, reason: 'read', text: EMPTY_COMPOSER_FRAME };
    },
  });
  const io = collect();

  const outcome = await harness.executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Delivered by the paste the starting session buffered.');
  // The whole point: one delivery, never two, no matter how many empty screens are read.
  assert.ok(screenReads >= 3, `only ${screenReads} post-paste screens were read`);
  assert.equal(harness.injected.length, 1);
  assert.equal(io.events.some((entry) => entry.event.deliveryState === 're-injected'), false);
  // No Return either: pressing one at a composer that is provably empty proves nothing.
  assert.equal(harness.submitted.length, 0);
  // And the operator is told why nothing is happening, exactly once per turn.
  const waiting = io.events.filter((entry) => entry.event.deliveryState === 'paste-unconsumed');
  assert.equal(waiting.length, 1);
  assert.match(waiting[0].message, /has not consumed/i);
  assert.match(waiting[0].message, /will not paste it again/i);
});

// The waiting state above is the one branch that can hold a turn for the whole submission window
// while sending nothing at all, so it must still fail closed rather than poll forever.
test('a paste that is never consumed ends the turn at the submission window without a second paste', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let harness = null;
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    submissionTimeoutMs: 20_000,
    submitRetryMs: 3000,
    // Empty forever, and no dialog, no clear, and no compaction ever proves the paste was lost.
    readScreen: async () => ({ ok: true, reason: 'read', text: EMPTY_COMPOSER_FRAME }),
  });
  const io = collect();

  await assert.rejects(
    () => harness.executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /never started the turn/i);
      // No re-delivery happened, so the failure must not claim one did.
      assert.equal(/pasted the exact prompt again/i.test(error.message), false);
      return true;
    },
  );

  assert.equal(harness.injected.length, 1);
  assert.equal(harness.submitted.length, 0);
  assert.equal(harness.keys.length, 0);
  assert.equal(io.events.some((entry) => entry.event.deliveryState === 're-injected'), false);
  assert.equal(
    io.events.filter((entry) => entry.event.deliveryState === 'paste-unconsumed').length,
    1,
  );
});

// A dialog answered BEFORE the paste existed proves nothing about the paste. The pre-injection
// gates answer the picker through the same shared screen record the submit schedule reads, so a
// resolution counted there would hand the empty-composer branch evidence it never earned. Task 91
// attempt 3 answered the picker pre-injection at 14:25:58.510 on 2026-08-03 and then buffered its
// paste behind the full-session load exactly like task 92; only the compaction that happened to
// follow made that day's empty composer a real loss.
test('a resume dialog answered before the paste is not evidence that the paste was lost', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let harness = null;
  let preReads = 0;
  let postReads = 0;
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    submissionTimeoutMs: 20_000,
    submitRetryMs: 3000,
    readScreen: async () => {
      if (harness.injected.length === 0) {
        preReads += 1;
        // The picker is displayed at the pre-injection gate, where this turn's prompt does not
        // exist yet. CC Relay answers it and then pastes into the composer it left behind.
        return {
          ok: true,
          reason: 'read',
          text: preReads === 1 ? RESUME_PICKER_FRAME : EMPTY_COMPOSER_FRAME,
        };
      }
      postReads += 1;
      // Loading the full session stalls the input loop, so the paste sits in the PTY and the
      // composer reads empty. No compaction and no dialog ever follows the paste.
      if (postReads === 3) {
        fake.append(userPrompt(deliveredPrompt()));
        fake.append(assistant('end_turn', [text('Delivered by the paste the resumed session buffered.')]));
      }
      return { ok: true, reason: 'read', text: EMPTY_COMPOSER_FRAME };
    },
  });
  const io = collect();

  const outcome = await harness.executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Delivered by the paste the resumed session buffered.');
  // The picker really was answered, and it really was answered before anything was typed.
  assert.deepEqual(harness.keys, [{ windowId: WINDOW_ID, value: CLAUDE_RESUME_PICKER_KEYS }]);
  assert.deepEqual(harness.timeline.slice(0, 2).map((entry) => entry.action), ['keys', 'inject']);
  // And it bought the empty composer no credit at all: one delivery, never two.
  assert.ok(postReads >= 3, `only ${postReads} post-paste screens were read`);
  assert.equal(harness.injected.length, 1);
  assert.equal(harness.submitted.length, 0);
  assert.equal(io.events.some((entry) => entry.event.deliveryState === 're-injected'), false);
  assert.equal(
    io.events.filter((entry) => entry.event.deliveryState === 'paste-unconsumed').length,
    1,
  );
});

// The task 39 recovery must survive the task 92 rule. A resume dialog answered this turn is
// positive proof that CC Relay's own keystroke reached the TUI after the paste, so the paste was
// consumed and destroyed and the empty composer that follows is a genuine loss.
test('a resume dialog answered this turn still permits the empty-composer re-injection', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let harness = null;
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const reader = { current: null };
  harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    readScreen: async (windowId) => reader.current(windowId),
    submit: async (windowId) => {
      harness.submitted.push(windowId);
      fake.append(userPrompt(deliveredPrompt()));
      fake.append(assistant('end_turn', [text('Delivered after the dialog was answered.')]));
    },
  });
  reader.current = phasedScreenFrames(
    [EMPTY_COMPOSER_FRAME],
    [
      RESUME_PICKER_FRAME, // the paste vanished into the dialog
      EMPTY_COMPOSER_FRAME, // the post-answer snapshot the resolver takes
      EMPTY_COMPOSER_FRAME, // provably empty, and now provably lost
      () => heldPasteFrame(harness.injected[harness.injected.length - 1]?.value ?? ''),
    ],
    () => harness.injected.length > 0,
  );
  const io = collect();

  const outcome = await harness.executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Delivered after the dialog was answered.');
  assert.equal(harness.injected.length, 2);
  assert.equal(harness.injected[0].value, harness.injected[1].value);
  assert.equal(io.events.filter((entry) => entry.event.deliveryState === 're-injected').length, 1);
  // The waiting state belongs to a paste that was never proven lost, which is not this turn.
  assert.equal(io.events.some((entry) => entry.event.deliveryState === 'paste-unconsumed'), false);
});

// A compaction discards whatever the composer is holding, so a compaction observed this turn is the
// second way an empty composer becomes proof of loss. This is the hook channel.
test('a compaction observed through the hooks still permits the empty-composer re-injection', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let harness = null;
  let compacted = false;
  const hooks = captureHookBridge();
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    hookBridge: hooks.bridge,
    submit: async (windowId) => {
      harness.submitted.push(windowId);
      fake.append(userPrompt(deliveredPrompt()));
      fake.append(assistant('end_turn', [text('Delivered after the compaction finished.')]));
    },
    readScreen: async () => {
      if (harness.injected.length === 0) {
        return { ok: true, reason: 'read', text: EMPTY_COMPOSER_FRAME };
      }
      if (!compacted) {
        compacted = true;
        // The compaction that ate the paste runs and finishes while CC Relay is reading.
        hooks.fire({ session_id: SESSION_ID, hook_event_name: 'PreCompact' });
        hooks.fire({ session_id: SESSION_ID, hook_event_name: 'PostCompact' });
      }
      if (harness.injected.length > 1) {
        return {
          ok: true,
          reason: 'read',
          text: heldPasteFrame(harness.injected[harness.injected.length - 1].value),
        };
      }
      return { ok: true, reason: 'read', text: EMPTY_COMPOSER_FRAME };
    },
  });
  const io = collect();

  const outcome = await harness.executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Delivered after the compaction finished.');
  assert.equal(compacted, true);
  assert.equal(harness.injected.length, 2);
  assert.equal(io.events.filter((entry) => entry.event.deliveryState === 're-injected').length, 1);
  assert.equal(io.events.some((entry) => entry.event.deliveryState === 'paste-unconsumed'), false);
});

// The same proof on the channel that needs no hook bridge at all. A terminal launched by an older
// CC Relay, or one whose settings hooks never registered, reports its compaction only as a
// compact_boundary transcript record, and that turn must keep its recovery.
test('a compact boundary record alone still permits the empty-composer re-injection', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let harness = null;
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    inject: async (windowId, value) => {
      harness.injected.push({ windowId, value });
      // The compaction that discarded the first paste leaves only this record behind.
      if (harness.injected.length === 1) fake.append({ type: 'system', subtype: 'compact_boundary' });
    },
    submit: async (windowId) => {
      harness.submitted.push(windowId);
      fake.append(userPrompt(deliveredPrompt()));
      fake.append(assistant('end_turn', [text('Delivered after the compact boundary.')]));
    },
    readScreen: async () => {
      if (harness.injected.length > 1) {
        return {
          ok: true,
          reason: 'read',
          text: heldPasteFrame(harness.injected[harness.injected.length - 1].value),
        };
      }
      return { ok: true, reason: 'read', text: EMPTY_COMPOSER_FRAME };
    },
  });
  const io = collect();

  const outcome = await harness.executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Delivered after the compact boundary.');
  assert.equal(harness.injected.length, 2);
  assert.equal(io.events.filter((entry) => entry.event.deliveryState === 're-injected').length, 1);
  assert.equal(io.events.some((entry) => entry.event.deliveryState === 'paste-unconsumed'), false);
});

// The third proof, and the one the buffering hypothesis cannot explain away: the paste was visibly
// in the composer and is now gone, so something took it and no turn started.
test('a paste seen held and then gone is still re-armed exactly once', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let harness = null;
  let submits = 0;
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const reader = { current: null };
  harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    readScreen: async (windowId) => reader.current(windowId),
    submit: async (windowId) => {
      harness.submitted.push(windowId);
      submits += 1;
      // The first Return is swallowed by the still-settling paste widget and the paste disappears
      // with it. The second one lands on the re-armed paste.
      if (submits === 2) {
        fake.append(userPrompt(deliveredPrompt()));
        fake.append(assistant('end_turn', [text('Delivered by the re-armed paste.')]));
      }
    },
  });
  reader.current = phasedScreenFrames(
    [EMPTY_COMPOSER_FRAME],
    [
      () => heldPasteFrame(harness.injected[harness.injected.length - 1]?.value ?? ''),
      EMPTY_COMPOSER_FRAME, // seen held one snapshot ago, so this emptiness is a real loss
      () => heldPasteFrame(harness.injected[harness.injected.length - 1]?.value ?? ''),
    ],
    () => harness.injected.length > 0,
  );
  const io = collect();

  const outcome = await harness.executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Delivered by the re-armed paste.');
  assert.equal(harness.injected.length, 2);
  assert.equal(harness.injected[0].value, harness.injected[1].value);
  assert.equal(io.events.filter((entry) => entry.event.deliveryState === 're-injected').length, 1);
  assert.equal(io.events.some((entry) => entry.event.deliveryState === 'paste-unconsumed'), false);
  assert.equal(harness.submitted.length, 2);
});

// Task 61 (2026-07-30, transcript record 45035695-34ef-4938-8df2-013a0a7a8bfb). Claude durably
// recorded the delivered 30k prompt at 21:52:40.284Z in a composer rewrite the correlation of
// that day could not derive, so promptSubmitted stayed false. At 21:52:41.901Z the empty
// composer that successful submit had left behind was read as a lost paste, the same prompt was
// pasted a second time into a session that was already working, and at 21:57:33Z the turn timed
// out and the pool closed the terminal on live work. An empty composer cannot tell a lost paste
// from an accepted one, so the durable record has to break the tie.
test('an unmatched submission record stops the empty-composer re-injection', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const task = {
    ...baseTask,
    prompt: 'Implement the reviewed plan below.\nRead /data/tasks/39/plan.md and call `GET /api/read`.',
    attachments: [{ name: 'image.png', path: IMAGE_PATH }],
  };
  const derived = rewrites(task);
  // The real Task 61 shape: chips with no separator plus the space-before-slash conversion, with
  // one further rewrite CC Relay does not model. Any future composer rewrite looks like this.
  const slashConverted = derived.find((value) => value.includes('\n/api/read'));
  const recorded = slashConverted.replaceAll(' `', '\n`');
  // The premise of this test: no derived form matches, so the turn gets no submission evidence.
  assert.equal(submittedPromptMatches(recorded, derived), false);

  let harness = null;
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    inject: async (windowId, value) => {
      harness.injected.push({ windowId, value });
      // The paste carried its own Return and Claude accepted it, which is what the transcript
      // proves happened one second before CC Relay read the composer.
      fake.append(imagePromptRecord(recorded));
    },
    // The composer a successful submit leaves behind is byte for byte the composer a lost paste
    // leaves behind, which is exactly why the screen alone cannot decide this.
    readScreen: phasedScreenFrames(
      [EMPTY_COMPOSER_FRAME],
      [EMPTY_COMPOSER_FRAME],
      () => harness.injected.length > 0,
    ),
  });
  const io = collect();

  await assert.rejects(
    () => harness.executor.runTurn(task, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io),
    (error) => {
      assert.equal(error.retryable, false);
      // The user must not be told Claude never received it: the turn is probably running.
      assert.match(error.message, /may actually be running/i);
      return true;
    },
  );

  // The whole point: the 30k prompt was delivered exactly once.
  assert.equal(harness.injected.length, 1);
  assert.equal(io.events.some((entry) => entry.event.deliveryState === 're-injected'), false);
  const unverified = io.events.filter((entry) => entry.event.deliveryState === 'unverified-submission');
  assert.equal(unverified.length, 1);
  assert.match(unverified[0].message, /will not paste it again/i);
});

// The same queueing that broke live updates can hit a task's own opening prompt. `runTurn` proves
// the session idle before typing, but the session can turn busy in that gap, and then Claude queues
// the paste and leaves the composer EMPTY. That is byte for byte the composer a lost paste leaves
// behind, so the recovery schedule reads it as a lost paste and pastes the whole prompt a second
// time into a session that is already holding it. Only the queue record breaks the tie.
function queuedOpeningPromptHarness({
  task = baseTask,
  onInject,
  sessions,
  // Cases that need the empty-composer recovery to actually run supply the positive paste-loss
  // evidence task 92 (2026-08-03) made mandatory. Everything else keeps the plain empty screen.
  afterPasteFrames = [EMPTY_COMPOSER_FRAME],
  ...overrides
} = {}) {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let harness = null;
  harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    inject: async (windowId, value) => {
      harness.injected.push({ windowId, value });
      onInject(fake, value);
    },
    // A queued paste leaves the composer empty, exactly like a lost one.
    readScreen: phasedScreenFrames(
      [EMPTY_COMPOSER_FRAME],
      afterPasteFrames,
      () => harness.injected.length > 0,
    ),
    ...overrides,
  });
  return { ...harness, fake, task };
}

test('a queued opening prompt stops the empty-composer re-injection', async () => {
  const harness = queuedOpeningPromptHarness({
    sessions: sessionSteps([{ status: 'idle' }]),
    onInject: (fake, value) => {
      // Claude queued the paste instead of submitting it, and never wrote a user record for it.
      fake.append(queueEnqueue(value));
      // The response that was already running finishes. It must not be read as this turn starting,
      // and it must not become this task's result.
      fake.append(assistant('end_turn', [text('Earlier response, not this task.')]));
    },
    submissionTimeoutMs: 6000,
  });
  const io = collect();

  await assert.rejects(
    () => harness.executor.runTurn(
      harness.task,
      { cancelRequested: false },
      { id: SESSION_ID },
      TERMINAL,
      io,
    ),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /queued this task's exact prompt/i);
      // The generic guidance would tell the operator to submit text that is already on the queue.
      assert.match(error.message, /do not submit it again/i);
      assert.equal(/holding unsubmitted text/i.test(error.message), false);
      return true;
    },
  );

  // The whole point: delivered exactly once, and no Return sent on top of a queued prompt.
  assert.equal(harness.injected.length, 1);
  assert.equal(harness.submitted.length, 0);
  assert.equal(io.events.some((entry) => entry.event.deliveryState === 're-injected'), false);
  // The latch suppresses recovery WITHOUT starting the turn, so the earlier response can never be
  // attributed to this prompt.
  assert.equal(io.events.some((entry) => entry.event.type === 'claude/started'), false);
  const queued = io.events.filter((entry) => entry.event.deliveryState === 'queued-submission');
  assert.equal(queued.length, 1);
  assert.match(queued[0].message, /will not paste it again/i);
  assert.match(queued[0].message, /take it off the queue/i);
});

test('a queued opening prompt starts its turn only when Claude takes it off the queue', async () => {
  let reads = 0;
  let harness = null;
  harness = queuedOpeningPromptHarness({
    sessions: {
      readConnectedSession: async () => {
        reads += 1;
        if (reads === 4) {
          // Claude drains the queue: the consumption record is the turn boundary and, because a
          // queued prompt is never written as a user record, also the only anchor this turn gets.
          harness.fake.append(queuedCommandAttachment(harness.injected[0].value));
          harness.fake.append(assistant('end_turn', [text('Answered the queued opening prompt.')]));
        }
        return {
          id: SESSION_ID,
          provider: 'claude',
          source: 'Claude interactive',
          cwd: '/repo',
          rawStatus: reads > 1 && reads < 4 ? 'busy' : 'idle',
          pid: PID,
        };
      },
    },
    onInject: (fake, value) => {
      fake.append(queueEnqueue(value));
      fake.append(assistant('end_turn', [text('Earlier response, not this task.')]));
    },
  });
  const io = collect();

  const outcome = await harness.executor.runTurn(
    harness.task,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Answered the queued opening prompt.');
  assert.equal(harness.injected.length, 1);
  assert.equal(harness.submitted.length, 0);
  const started = io.events.filter((entry) => entry.event.type === 'claude/started');
  assert.equal(started.length, 1);
  assert.equal(started[0].event.promptSubmissionEvidence, 'transcript-queued-release');
  assert.equal(started[0].event.submitAttempts, 0);
});

// The anchor sets transcriptCorrelated, promptProcessingConfirmed, and promptSubmitted in one step,
// on a transcript that already holds the earlier response's records. This pins that the turn stays
// bounded when the consumption record is the LAST thing that ever arrives, which is the state that
// distinguishes a correct anchor from one placed at the enqueue.
test('a queued opening prompt consumed with no further output stays bounded', async () => {
  let reads = 0;
  let harness = null;
  harness = queuedOpeningPromptHarness({
    sessions: {
      readConnectedSession: async () => {
        reads += 1;
        // The earlier response finishes and is drained BEFORE the anchor exists, which is what
        // keeps it out of this turn entirely rather than becoming its final answer.
        if (reads === 2) harness.fake.append(assistant('end_turn', [text('Earlier response, not this task.')]));
        if (reads === 4) harness.fake.append(queuedCommandAttachment(harness.injected[0].value));
        return {
          id: SESSION_ID,
          provider: 'claude',
          source: 'Claude interactive',
          cwd: '/repo',
          rawStatus: reads > 1 && reads < 4 ? 'busy' : 'idle',
          pid: PID,
        };
      },
    },
    onInject: (fake, value) => fake.append(queueEnqueue(value)),
    inactivityCeilingMs: 4000,
  });
  const io = collect();

  await assert.rejects(
    () => harness.executor.runTurn(
      harness.task,
      { cancelRequested: false },
      { id: SESSION_ID },
      TERMINAL,
      io,
    ),
    /showed no activity for/i,
  );

  // The turn started on the consumption record, and the earlier response never became its result.
  const started = io.events.filter((entry) => entry.event.type === 'claude/started');
  assert.equal(started.length, 1);
  assert.equal(started[0].event.promptSubmissionEvidence, 'transcript-queued-release');
  assert.equal(io.events.some((entry) => /Earlier response/.test(entry.message || '')), false);
  assert.equal(harness.injected.length, 1);
  assert.equal(harness.submitted.length, 0);
});

test('a foreign queue record never latches the opening prompt or stops re-injection', async () => {
  const harness = queuedOpeningPromptHarness({
    sessions: sessionSteps([{ status: 'idle' }]),
    // The dialog gives the empty composer its proof of loss, so the recovery under test here is
    // gated only by the queue records, which is what this case is about.
    afterPasteFrames: [RESUME_PICKER_FRAME, EMPTY_COMPOSER_FRAME],
    onInject: (fake, value) => {
      if (fake.taken) return;
      fake.taken = true;
      // Sub-agent notifications and other session traffic travel as enqueue records too, and a
      // truncated copy of our own prompt is not our prompt. Neither proves anything reached Claude,
      // so the empty composer stays a lost paste and normal recovery must still run.
      fake.append(queueEnqueue(QUEUED_TASK_NOTIFICATION));
      fake.append(queueEnqueue(value.slice(0, value.length - 1)));
      // A release record for a prompt that was never latched cannot start a turn either.
      fake.append(queuedCommandAttachment(value.slice(0, value.length - 1)));
      fake.append(queueRemove(value));
    },
    submissionTimeoutMs: 6000,
  });
  const io = collect();

  await assert.rejects(
    () => harness.executor.runTurn(
      harness.task,
      { cancelRequested: false },
      { id: SESSION_ID },
      TERMINAL,
      io,
    ),
    (error) => {
      assert.equal(error.retryable, false);
      assert.equal(/queued this task's exact prompt/i.test(error.message), false);
      return true;
    },
  );

  // Recovery ran exactly as it does without any queue records at all.
  assert.equal(harness.injected.length, 2);
  assert.equal(io.events.filter((entry) => entry.event.deliveryState === 're-injected').length, 1);
  assert.equal(io.events.some((entry) => entry.event.deliveryState === 'queued-submission'), false);
  assert.equal(io.events.some((entry) => entry.event.type === 'claude/started'), false);
});

test('a queued opening prompt that is never taken off the queue fails closed at the acceptance bound', async () => {
  const harness = queuedOpeningPromptHarness({
    // The realistic never-released shape: the earlier response keeps working, so the session never
    // reports idle and the submission window never advances. Only the acceptance bound ends this.
    sessions: sessionSteps([{ status: 'idle' }, { status: 'busy' }]),
    onInject: (fake, value) => {
      fake.append(queueEnqueue(value));
    },
    promptAcceptanceTimeoutMs: 3000,
  });
  const io = collect();

  await assert.rejects(
    () => harness.executor.runTurn(
      harness.task,
      { cancelRequested: false },
      { id: SESSION_ID },
      TERMINAL,
      io,
    ),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /queued this task's exact prompt/i);
      assert.match(error.message, /did not start its turn/i);
      // The unchanged fail-closed sentence, and never an invitation to retype live work.
      assert.match(error.message, /will not type the prompt again automatically/i);
      assert.equal(/could not verify that Claude received/i.test(error.message), false);
      return true;
    },
  );

  assert.equal(harness.injected.length, 1);
  assert.equal(harness.submitted.length, 0);
  assert.equal(io.events.some((entry) => entry.event.type === 'claude/started'), false);
});

test('an unmatched submission arriving during the screen read blocks a held-composer submit', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let harness = null;
  let appendedDuringScreenRead = false;
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    readScreen: async () => {
      if (harness.injected.length === 0) {
        return { ok: true, reason: 'read', text: EMPTY_COMPOSER_FRAME };
      }
      if (!appendedDuringScreenRead) {
        appendedDuringScreenRead = true;
        fake.append(userPrompt('A submitted composer rewrite CC Relay does not recognize.'));
      }
      return {
        ok: true,
        reason: 'read',
        text: heldPasteFrame(harness.injected[harness.injected.length - 1].value),
      };
    },
  });
  const io = collect();

  await assert.rejects(
    () => harness.executor.runTurn(
      baseTask,
      { cancelRequested: false },
      { id: SESSION_ID },
      TERMINAL,
      io,
    ),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /may actually be running/i);
      return true;
    },
  );

  assert.equal(appendedDuringScreenRead, true);
  assert.equal(harness.injected.length, 1);
  assert.equal(harness.submitted.length, 0);
  const unverified = io.events.filter((entry) => entry.event.deliveryState === 'unverified-submission');
  assert.equal(unverified.length, 1);
  assert.match(unverified[0].message, /another submit action/i);
});

// The suppression above must not swallow the genuine lost-paste recovery. Claude writes its own
// `[Image: source: ...]` annotation as an isMeta user record that rides along with a submit
// rather than being one, so it is not evidence that anything reached the session.
test('a meta annotation record does not suppress the empty-composer re-injection', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let harness = null;
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    inject: async (windowId, value) => {
      harness.injected.push({ windowId, value });
      if (harness.injected.length === 1) {
        fake.append({
          type: 'user',
          isMeta: true,
          message: { content: [text(`[Image: source: ${IMAGE_PATH}]`)] },
        });
      }
    },
    submit: async (windowId) => {
      harness.submitted.push(windowId);
      fake.append(userPrompt(deliveredPrompt()));
      fake.append(assistant('end_turn', [text('Delivered by the re-armed paste.')]));
    },
    readScreen: phasedScreenFrames(
      [EMPTY_COMPOSER_FRAME],
      [
        // The dialog is what proves the empty composer below lost the paste, so the only thing
        // still gating the recovery under test is the meta record.
        RESUME_PICKER_FRAME,
        EMPTY_COMPOSER_FRAME, // the snapshot the resolver takes after answering it
        EMPTY_COMPOSER_FRAME,
        () => heldPasteFrame(harness.injected[harness.injected.length - 1]?.value ?? ''),
      ],
      () => harness.injected.length > 0,
    ),
  });
  const io = collect();

  const outcome = await harness.executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Delivered by the re-armed paste.');
  assert.equal(harness.injected.length, 2);
  assert.equal(io.events.some((entry) => entry.event.deliveryState === 'unverified-submission'), false);
});

test('a sidechain user record does not suppress the empty-composer re-injection', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let harness = null;
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    inject: async (windowId, value) => {
      harness.injected.push({ windowId, value });
      if (harness.injected.length === 1) {
        fake.append({
          type: 'user',
          isSidechain: true,
          message: { content: [text('Sub-agent traffic from the same Claude session.')] },
        });
      }
    },
    submit: async (windowId) => {
      harness.submitted.push(windowId);
      fake.append(userPrompt(deliveredPrompt()));
      fake.append(assistant('end_turn', [text('Delivered after ignoring sidechain traffic.')]));
    },
    readScreen: phasedScreenFrames(
      [EMPTY_COMPOSER_FRAME],
      [
        // Same as the meta case above: the dialog supplies the proof of loss so the sidechain
        // record is the only thing that could still suppress the recovery.
        RESUME_PICKER_FRAME,
        EMPTY_COMPOSER_FRAME, // the snapshot the resolver takes after answering it
        EMPTY_COMPOSER_FRAME,
        () => heldPasteFrame(harness.injected[harness.injected.length - 1]?.value ?? ''),
      ],
      () => harness.injected.length > 0,
    ),
  });
  const io = collect();

  const outcome = await harness.executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Delivered after ignoring sidechain traffic.');
  assert.equal(harness.injected.length, 2);
  assert.equal(io.events.some((entry) => entry.event.deliveryState === 'unverified-submission'), false);
});

// The hook is the EARLIEST submission signal Claude produces, so the durable record cannot be the
// only latch. Task 61's re-paste happened 1.6 s after acceptance while the session status still
// read idle; if the JSONL flush lags that pass (hook at T+1, record at T+8) the record latch has
// not fired yet and the empty composer would be re-armed anyway.
test('an unmatched UserPromptSubmit hook stops the empty-composer re-injection before the record flushes', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const task = {
    ...baseTask,
    prompt: 'Implement the reviewed plan below.\nRead /data/tasks/39/plan.md and call `GET /api/read`.',
    attachments: [{ name: 'image.png', path: IMAGE_PATH }],
  };
  const derived = rewrites(task);
  // Same shape as the record case: a real composer rewrite carrying one conversion CC Relay does
  // not model, which is what the hook reports for this class of failure.
  const hookPrompt = derived
    .find((value) => value.includes('\n/api/read'))
    .replaceAll(' `', '\n`');
  assert.equal(submittedPromptMatches(hookPrompt, derived), false);

  let harness = null;
  let hookFired = false;
  const hooks = captureHookBridge();
  // Idle throughout, which is the exact status staleness that let Task 61 re-paste into a session
  // that had already accepted the prompt.
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    hookBridge: hooks.bridge,
    inject: async (windowId, value) => {
      harness.injected.push({ windowId, value });
    },
    readScreen: async () => {
      if (harness.injected.length > 0 && !hookFired) {
        hookFired = true;
        hooks.fire({
          session_id: SESSION_ID,
          hook_event_name: 'UserPromptSubmit',
          prompt_id: 'prompt-1',
          prompt: hookPrompt,
        });
      }
      return { ok: true, reason: 'read', text: EMPTY_COMPOSER_FRAME };
    },
  });
  const io = collect();

  await assert.rejects(
    () => harness.executor.runTurn(task, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /may actually be running/i);
      return true;
    },
  );

  assert.equal(hookFired, true);
  // The durable record never flushed, so the record latch could not have produced this outcome.
  assert.equal(fake.source.readFrom(0).toString().includes('Implement the reviewed plan'), false);
  // The whole point: delivered exactly once.
  assert.equal(harness.injected.length, 1);
  assert.equal(io.events.some((entry) => entry.event.deliveryState === 're-injected'), false);
  assert.equal(
    io.events.filter((entry) => entry.event.deliveryState === 'unverified-submission').length,
    1,
  );
});

// The hook latch must not fire on `/compact`, which is a command the user or CC Relay can send
// without it being this turn's prompt.
test('a /compact UserPromptSubmit hook does not suppress the empty-composer re-injection', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let harness = null;
  let hookFired = false;
  const hooks = captureHookBridge();
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    hookBridge: hooks.bridge,
    inject: async (windowId, value) => {
      harness.injected.push({ windowId, value });
    },
    submit: async (windowId) => {
      harness.submitted.push(windowId);
      fake.append(userPrompt(deliveredPrompt()));
      fake.append(assistant('end_turn', [text('Delivered after ignoring the compact command.')]));
    },
    readScreen: async () => {
      if (harness.injected.length > 0 && !hookFired) {
        hookFired = true;
        hooks.fire({
          session_id: SESSION_ID,
          hook_event_name: 'UserPromptSubmit',
          prompt_id: 'prompt-compact',
          prompt: '/compact',
        });
        // What a real /compact always emits next, and what makes the empty composer below provable
        // proof of loss: the compaction discarded whatever the composer was holding. The subject
        // here stays the UserPromptSubmit payload, which must never latch as this turn's prompt.
        hooks.fire({ session_id: SESSION_ID, hook_event_name: 'PreCompact' });
        hooks.fire({ session_id: SESSION_ID, hook_event_name: 'PostCompact' });
      }
      if (harness.injected.length > 1) {
        return { ok: true, reason: 'read', text: heldPasteFrame(harness.injected[harness.injected.length - 1].value) };
      }
      return { ok: true, reason: 'read', text: EMPTY_COMPOSER_FRAME };
    },
  });
  const io = collect();

  const outcome = await harness.executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Delivered after ignoring the compact command.');
  assert.equal(hookFired, true);
  assert.equal(harness.injected.length, 2);
  assert.equal(io.events.some((entry) => entry.event.deliveryState === 'unverified-submission'), false);
});

test('a composer holding foreign text is cleared once, then the prompt is re-armed', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let harness = null;
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const reader = { current: null };
  harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    readScreen: async (windowId) => reader.current(windowId),
    submit: async (windowId) => {
      harness.submitted.push(windowId);
      fake.append(userPrompt(deliveredPrompt()));
      fake.append(assistant('end_turn', [text('Delivered after the composer was cleared.')]));
    },
  });
  reader.current = phasedScreenFrames(
    [EMPTY_COMPOSER_FRAME],
    [
      JUNK_COMPOSER_FRAME, // first attempt: somebody else's unsubmitted text is in the way
      EMPTY_COMPOSER_FRAME, // after the single Ctrl+C
      () => heldPasteFrame(harness.injected[harness.injected.length - 1]?.value ?? ''),
    ],
    () => harness.injected.length > 0,
  );

  const outcome = await harness.executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    collect(),
  );

  assert.equal(outcome.finalResponse, 'Delivered after the composer was cleared.');
  // Exactly one Ctrl+C, ever. A second press inside Claude's hint window exits the CLI.
  assert.deepEqual(harness.keys, [{ windowId: WINDOW_ID, value: CLAUDE_COMPOSER_CLEAR_KEYS }]);
  assert.equal(harness.injected.length, 2);
  assert.deepEqual(harness.submitted, [WINDOW_ID]);
});

test('two composer clears in one turn can never land inside the Claude exit hint window', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let harness = null;
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const clearTimes = [];
  const reader = { current: null };
  harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    readScreen: async (windowId) => reader.current(windowId),
    sendKeys: async (windowId, value) => {
      harness.keys.push({ windowId, value });
      if (value === CLAUDE_COMPOSER_CLEAR_KEYS) clearTimes.push(harness.clock.now());
    },
    // A tiny first-attempt delay so the submit schedule's junk clear would otherwise arrive
    // immediately after the pre-injection residue clear.
    submitNudgeMs: 100,
    composerClearSpacingMs: 5000,
  });
  reader.current = phasedScreenFrames(
    [JUNK_COMPOSER_FRAME, JUNK_COMPOSER_FRAME, EMPTY_COMPOSER_FRAME], // residue cleared pre-paste
    [JUNK_COMPOSER_FRAME, EMPTY_COMPOSER_FRAME, EMPTY_COMPOSER_FRAME], // junk again at attempt 1
    () => harness.injected.length > 0,
  );

  await assert.rejects(
    () => harness.executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    () => true, // the turn's outcome is irrelevant here; the keystroke spacing is the contract
  );

  assert.equal(clearTimes.length, 2);
  assert.ok(
    clearTimes[1] - clearTimes[0] >= 5000,
    `two Ctrl+C presses were ${clearTimes[1] - clearTimes[0]}ms apart, which can exit Claude`,
  );
});

test('foreign text that survives the single clear fails closed instead of submitting it', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let harness = null;
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const reader = { current: null };
  harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    readScreen: async (windowId) => reader.current(windowId),
  });
  reader.current = phasedScreenFrames(
    [EMPTY_COMPOSER_FRAME],
    [JUNK_COMPOSER_FRAME], // junk never clears
    () => harness.injected.length > 0,
  );

  await assert.rejects(
    () => harness.executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /could not clear/i);
      assert.match(error.message, /would submit the wrong text/i);
      return true;
    },
  );

  assert.equal(harness.keys.length, 1); // one clear attempt, never two
  assert.equal(harness.injected.length, 1); // no re-arm into an occupied composer
  assert.equal(harness.submitted.length, 0); // and never a Return that would submit foreign text
});

test('a foreign paste with a different line count is not mistaken for this turn s prompt', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let harness = null;
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const reader = { current: null };
  harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    readScreen: async (windowId) => reader.current(windowId),
  });
  reader.current = phasedScreenFrames(
    [EMPTY_COMPOSER_FRAME],
    // A collapsed paste is held, but it is 400 lines and this turn's prompt is not. Pressing
    // Return would submit somebody else's text as this task's prompt.
    [composerFrame('[Pasted text #9 +400 lines]', { statusRow: '  paste again to expand' })],
    () => harness.injected.length > 0,
  );

  await assert.rejects(
    () => harness.executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /could not clear/i);
      return true;
    },
  );
  assert.equal(harness.submitted.length, 0);
});

test('a re-armed paste that is lost again is not re-armed a second time', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let harness = null;
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const reader = { current: null };
  harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    submissionTimeoutMs: 20_000,
    readScreen: async (windowId) => reader.current(windowId),
  });
  reader.current = phasedScreenFrames(
    [EMPTY_COMPOSER_FRAME],
    [
      // Seen held once, so its disappearance is a real loss rather than the buffered stdin of
      // task 92 (2026-08-03). After that the composer is empty forever: every delivery vanishes.
      () => heldPasteFrame(harness.injected[harness.injected.length - 1]?.value ?? ''),
      EMPTY_COMPOSER_FRAME,
    ],
    () => harness.injected.length > 0,
  );
  const io = collect();

  await assert.rejects(
    () => harness.executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /pasted the exact prompt again once/i);
      return true;
    },
  );

  assert.equal(harness.injected.length, 2); // the original paste plus exactly one re-arm
  assert.equal(io.events.filter((entry) => entry.event.deliveryState === 're-injected').length, 1);
  // One Return, at the one snapshot that held the paste. Pressing Return at a composer that is
  // provably empty proves nothing, so nothing more is sent for the rest of the window.
  assert.deepEqual(harness.submitted, [WINDOW_ID]);
  assert.equal(harness.keys.length, 0);
});

test('a screen reader that throws leaves readiness and the submit schedule exactly as they were', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([
    { status: 'idle' }, // readiness
    { status: 'idle' }, // paste is visible but not submitted
    { status: 'idle' },
    { status: 'idle' }, // submit nudge threshold reached
    { status: 'idle' }, // final pre-submit status check
    { status: 'busy', append: [userPrompt(deliveredPrompt()), assistant('end_turn', [text('Submitted blind, exactly as before.')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor, injected, submitted, keys } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    readScreen: async () => { throw new Error('osascript exploded'); },
    submissionTimeoutMs: 6000,
  });
  const io = collect();

  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io);

  // Byte for byte the pre-change behavior: one paste, one blind guarded action, no keystrokes.
  assert.equal(outcome.finalResponse, 'Submitted blind, exactly as before.');
  assert.equal(injected.length, 1);
  assert.deepEqual(submitted, [WINDOW_ID]);
  assert.equal(keys.length, 0);
  const degraded = io.events.filter((entry) => entry.event.deliveryState === 'screen-unverified');
  assert.equal(degraded.length, 1); // said once per turn, not once per snapshot
  assert.match(degraded[0].message, /session status alone/i);
});

test('an unreadable screen at the relaunch gate still reports the terminal ready', async () => {
  const harness = relaunchHarness({
    beforePaste: [null], // every snapshot fails, exactly like a denied or timed out Apple Event
    afterPaste: [null],
  });
  const io = collect();

  const outcome = await harness.executor.runTurn(
    harness.task,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  // The relaunch gate must not spin to its deadline when the screen cannot be read.
  assert.equal(outcome.finalResponse, 'Revision delivered after the resume dialog.');
  assert.equal(harness.injected.length, 1);
  assert.equal(harness.keys.length, 0);
  const degraded = io.events.filter((entry) => entry.event.deliveryState === 'screen-unverified');
  assert.equal(degraded.length, 1);
  // The notice comes from the relaunch gate itself, before that gate reports the terminal ready,
  // which is what proves the relaunch loop degraded instead of spinning to its deadline.
  const readyIndex = io.events.findIndex((entry) => /terminal is ready with opus at max effort/i.test(entry.message));
  assert.ok(readyIndex > io.events.indexOf(degraded[0]));
});

test('the busy heartbeat does not claim the turn is running before the prompt is verified', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  // Busy from the first watch poll onward, with no submission evidence: compaction or a session
  // still preparing itself. Task 39 looked healthy in exactly this state while its prompt was
  // already lost.
  const sessions = sessionSteps([{ status: 'idle' }, { status: 'busy' }], fake);
  const { executor } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    heartbeatMs: 2000,
    promptAcceptanceTimeoutMs: 8000,
  });
  const io = collect();

  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io),
    (error) => {
      assert.equal(error.retryable, false);
      return true;
    },
  );

  const heartbeats = io.events.filter((entry) => /terminal/i.test(entry.message) && /busy|still working/i.test(entry.message));
  assert.ok(heartbeats.length >= 1);
  assert.equal(heartbeats.some((entry) => /still working/i.test(entry.message)), false);
  assert.match(heartbeats[0].message, /before accepting the prompt/i);
  assert.match(heartbeats[0].message, /still waiting to verify the exact prompt/i);
});

test('the executor defaults keep the whole guarded submit schedule inside the submission window', () => {
  const executor = new ClaudeTerminalExecutor({ sessions: { readConnectedSession: async () => null } });

  assert.equal(executor.submissionTimeoutMs, 80_000);
  assert.equal(executor.submitNudgeMs, 6_000);
  assert.equal(executor.maxSubmitAttempts, 4);
  assert.equal(executor.submitRetryMs, 9_000);
  assert.equal(executor.submitRetryBackoffMs, 3_000);
  assert.equal(executor.submitConfirmMs, 15_000);
  assert.equal(executor.steerSubmitNudgeMs, 6_000);
  assert.equal(executor.steerAcceptanceTimeoutMs, 80_000);
  assert.equal(executor.steerSubmitConfirmMs, 15_000);

  // The first attempt waits for a large paste to settle but stays responsive for small prompts.
  assert.ok(executor.submitNudgeMs >= 5_000 && executor.submitNudgeMs <= 8_000);
  let last = executor.submitNudgeMs;
  for (let attempt = 1; attempt < executor.maxSubmitAttempts; attempt += 1) {
    const gap = executor.submitRetryMs + executor.submitRetryBackoffMs * (attempt - 1);
    // Wide enough that a landed Return always produces evidence before the next action.
    assert.ok(gap >= 8_000 && gap <= 15_000);
    last += gap;
  }
  // Every attempt, including the last, has room to be confirmed inside the window.
  assert.ok(last + executor.submitConfirmMs <= executor.submissionTimeoutMs);
  // Live updates use the same held-paste attempts and therefore need the same complete window.
  assert.ok(last + executor.submitConfirmMs <= executor.steerAcceptanceTimeoutMs);
  // The window stays well inside the separate processing-verification ceiling.
  assert.ok(executor.submissionTimeoutMs < executor.promptAcceptanceTimeoutMs);
});

test('the screen verification defaults leave room to answer the resume dialog and load a session', () => {
  const executor = new ClaudeTerminalExecutor({ sessions: { readConnectedSession: async () => null } });

  // Raised from 20 s: a relaunch can now have to answer the resume picker AND then load a full
  // 187k token conversation before its composer appears, both inside this window.
  assert.equal(executor.relaunchTimeoutMs, 30_000);
  assert.equal(executor.screenSettleMs, 1_500);
  assert.equal(executor.maxResumePickerResolutions, 2);
  assert.equal(executor.maxPromptReinjections, 1);
  // Claude exits on a second Ctrl+C inside its own exit-hint window, which lasts a couple of
  // seconds, so the enforced spacing has to be comfortably wider than that.
  assert.equal(executor.composerClearSpacingMs, 5_000);
  assert.ok(executor.composerClearSpacingMs > 3_000);
  // Two clears can only ever occur one pre-injection and one inside the submit schedule, and the
  // first guarded attempt is itself further away than the spacing, so the invariant never delays
  // the normal path.
  assert.ok(executor.submitNudgeMs + executor.screenSettleMs > executor.composerClearSpacingMs);
  // Two bounded resolutions plus their settle time have to fit inside the relaunch window with
  // room left for the session itself to load.
  const resolutionCost = executor.maxResumePickerResolutions * (executor.screenSettleMs + executor.restartPollMs);
  assert.ok(resolutionCost * 2 < executor.relaunchTimeoutMs);
  // The pre-injection gate runs on the readiness window, which must also fit both resolutions.
  assert.ok(resolutionCost < executor.readinessTimeoutMs);
});

test('Issue 2c: a started turn that goes completely silent fails non-retryably at the inactivity ceiling', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([
    { status: 'idle' }, // readiness
    { status: 'busy', append: [userPrompt(deliveredPrompt())] }, // durable start evidence
    { status: 'busy' },
    { status: 'idle' }, // then nothing at all: no final record, no growth, no busy status
  ], fake);
  const { executor } = makeExecutor({ sessions, openTranscript: () => fake.source, inactivityCeilingMs: 3000 });
  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, false); assert.match(error.message, /no activity/i); return true; },
  );
});

test('task 320: a turn that stays busy far past the ceiling keeps running and completes', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  // Task 320 failed at 45m11s while its Claude session was driving a team of sub-agents: busy
  // discovery status was the only live signal for the whole run, and no parent transcript record
  // was written. Elapsed time alone must never end a turn in that state.
  const longBusyRun = Array.from({ length: 30 }, () => ({ status: 'busy' }));
  const sessions = sessionSteps([
    { status: 'idle' }, // readiness
    { status: 'busy', append: [userPrompt(deliveredPrompt())] },
    ...longBusyRun,
    { status: 'busy', append: [assistant('end_turn', [text('Long run complete.')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor, submitted, clock } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    inactivityCeilingMs: 3000,
  });
  const io = collect();

  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io);

  assert.equal(outcome.finalResponse, 'Long run complete.');
  assert.ok(clock.now() > 20_000, `expected the turn to outlive the ceiling, ran ${clock.now()}ms`);
  assert.equal(io.events.some((entry) => /no activity/i.test(entry.message || '')), false);
  assert.equal(submitted.length, 0);
});

test('the inactivity window restarts from the last observed activity, not from the turn start', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let clock = null;
  let lastBusyAt = -1;
  const busyPhase = Array.from({ length: 6 }, () => ({
    status: 'busy',
    mutate: () => { lastBusyAt = clock.now(); },
  }));
  const sessions = sessionSteps([
    { status: 'idle' }, // readiness
    ...busyPhase,
    { status: 'idle' }, // inert trailing step: it repeats, so it must not record activity
  ], fake);
  const harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    inactivityCeilingMs: 3000,
  });
  clock = harness.clock;

  await assert.rejects(
    () => harness.executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, false); assert.match(error.message, /no activity/i); return true; },
  );

  // The busy phase alone already outlived the ceiling without failing.
  assert.ok(lastBusyAt > 3000, `expected the busy phase to outlive the ceiling, ended at ${lastBusyAt}ms`);
  // Failure comes a full window after the last activity, checked one poll late at the loop top.
  const silence = clock.now() - lastBusyAt;
  assert.ok(silence >= 3000, `expected a full inactivity window, saw ${silence}ms`);
  assert.ok(silence <= 3000 + 2000, `expected failure soon after the window, saw ${silence}ms`);
});

test('a transcript stat that starts failing mid-turn is neither activity nor a shrink', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' }); // a real injection offset, so the shrink guard has a threshold to trip
  let clock = null;
  let lastBusyAt = -1;
  const sessions = sessionSteps([
    { status: 'idle' }, // readiness, stat still readable
    { status: 'busy' },
    {
      status: 'busy',
      mutate: () => {
        lastBusyAt = clock.now();
        fake.failStat(); // every later size() returns -1, exactly as a transient FS failure does
      },
    },
    // Idle with an unreadable transcript for the rest of the turn. The trailing missing-session
    // steps are a terminator: a regression that read -1 as growth would restart the window on
    // every poll, and this test would then fail loudly on the wrong error instead of looping.
    ...Array.from({ length: 8 }, () => ({ status: 'idle' })),
    { status: null },
  ], fake);
  const harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    inactivityCeilingMs: 3000,
  });
  clock = harness.clock;

  await assert.rejects(
    () => harness.executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /no activity/i);
      assert.doesNotMatch(error.message, /shrank/i); // -1 is unreadable, not a truncated transcript
      return true;
    },
  );

  const silence = clock.now() - lastBusyAt;
  assert.ok(silence >= 3000, `expected a full inactivity window despite the failing stat, saw ${silence}ms`);
  assert.ok(silence <= 3000 + 2000, `expected failure soon after the window, saw ${silence}ms`);
  assert.equal(harness.submitted.length, 0);
});

test('a recovered stat at the same size is not growth, so the inactivity window keeps accruing', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let clock = null;
  let lastBusyAt = -1;
  const sessions = sessionSteps([
    { status: 'idle' }, // readiness
    { status: 'busy', mutate: () => { lastBusyAt = clock.now(); } },
    { status: 'idle', mutate: () => fake.failStat(2) }, // two unreadable polls, then the stat heals
    { status: 'idle' },
  ], fake);
  const harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    inactivityCeilingMs: 5000,
  });
  clock = harness.clock;

  await assert.rejects(
    () => harness.executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, false); assert.match(error.message, /no activity/i); return true; },
  );

  // The healed stat reports the same size it reported before the failure. If -1 had become the
  // baseline, that unchanged size would read as growth and postpone this failure by a full window.
  const silence = clock.now() - lastBusyAt;
  assert.ok(silence >= 5000, `expected a full inactivity window, saw ${silence}ms`);
  assert.ok(silence <= 5000 + 2000, `expected no phantom growth from the healed stat, saw ${silence}ms`);
});

test('transcript growth alone restarts the inactivity window, even before it parses into records', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let clock = null;
  let lastBusyAt = -1;
  let grewAt = -1;
  const sessions = sessionSteps([
    { status: 'idle' }, // readiness
    { status: 'busy', mutate: () => { lastBusyAt = clock.now(); } },
    {
      status: 'idle',
      mutate: () => {
        grewAt = clock.now();
        // A line with no terminating newline: the reader holds it as leftover and returns no
        // records, so this isolates transcript growth from the drain signal.
        fake.appendRaw('{"type":"assistant","message":{"stop_reason":"tool_use"');
      },
    },
    { status: 'idle' },
  ], fake);
  const harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    inactivityCeilingMs: 3000,
  });
  clock = harness.clock;

  await assert.rejects(
    () => harness.executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, false); assert.match(error.message, /no activity/i); return true; },
  );

  // Without growth counting as activity the turn would have failed one window after lastBusyAt.
  assert.ok(
    clock.now() > lastBusyAt + 3000 + 1000,
    `expected growth to restart the window, failed at ${clock.now()}ms with the last busy poll at ${lastBusyAt}ms`,
  );
  assert.ok(clock.now() - grewAt >= 3000, `expected a full window after the growth, saw ${clock.now() - grewAt}ms`);
});

test('the legacy turnCeilingMs option still configures the inactivity ceiling', () => {
  assert.equal(makeExecutor().executor.inactivityCeilingMs, 45 * 60 * 1_000);
  assert.equal(makeExecutor({ turnCeilingMs: 3000 }).executor.inactivityCeilingMs, 3000);
  assert.equal(
    makeExecutor({ turnCeilingMs: 3000, inactivityCeilingMs: 9000 }).executor.inactivityCeilingMs,
    9000,
  );
});

test('Issue 2d: a failed injection fails non-retryably because the prompt may already be running', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const { executor } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    inject: async () => { throw new Error('osascript timed out'); },
  });
  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, false); assert.match(error.message, /may already be running/i); return true; },
  );
});

test('Issue 5: a transcript that shrinks below the turn start fails non-retryably', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' }); // injectionOffset > 0
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', mutate: () => fake.shrinkToZero() }, // transcript truncated after injection
    { status: 'busy' },
  ], fake);
  const { executor } = makeExecutor({ sessions, openTranscript: () => fake.source });
  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, false); assert.match(error.message, /shrank/i); return true; },
  );
});

test('Issue 6: session gone with only intermediate text fails; session gone after a final record completes', async () => {
  const failFake = fakeTranscript();
  failFake.append({ type: 'mode' });
  const failSessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [userPrompt(deliveredPrompt()), assistant('tool_use', [text('partial')])] },
    { status: null }, { status: null }, { status: null },
  ], failFake);
  const failExec = makeExecutor({ sessions: failSessions, openTranscript: () => failFake.source });
  await assert.rejects(
    () => failExec.executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, false); assert.match(error.message, /closed before the turn produced a final/i); return true; },
  );

  const okFake = fakeTranscript();
  okFake.append({ type: 'mode' });
  const okSessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [userPrompt(deliveredPrompt()), assistant('end_turn', [text('Done before close.')])] },
    { status: null }, { status: null }, { status: null },
  ], okFake);
  const okExec = makeExecutor({ sessions: okSessions, openTranscript: () => okFake.source });
  const outcome = await okExec.executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect());
  assert.equal(outcome.finalResponse, 'Done before close.');
});

test('Issue 9: a transient discovery miss is tolerated and the turn still completes', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [userPrompt(deliveredPrompt()), assistant('end_turn', [text('Done despite a blip.')])] },
    { status: null }, // single transient miss (< grace of 3)
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor } = makeExecutor({ sessions, openTranscript: () => fake.source });
  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect());
  assert.equal(outcome.finalResponse, 'Done despite a blip.');
});

test('Issue 8: a prompt with a NUL byte is rejected non-retryably before typing', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const { executor, injected } = makeExecutor({ sessions, openTranscript: () => fake.source });
  await assert.rejects(
    () => executor.runTurn({ ...baseTask, prompt: `bad${NUL}prompt` }, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, false); assert.match(error.message, /NUL/i); return true; },
  );
  assert.equal(injected.length, 0);
});

test('Issue 8: an oversized prompt is rejected non-retryably before typing', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const { executor, injected } = makeExecutor({ sessions, openTranscript: () => fake.source, maxPromptBytes: 20 });
  await assert.rejects(
    () => executor.runTurn({ ...baseTask, prompt: 'x'.repeat(200) }, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, false); assert.match(error.message, /limit/i); return true; },
  );
  assert.equal(injected.length, 0);
});

test('Issue 14: an established session whose stat stays negative fails retryably and never types', async () => {
  const fake = fakeTranscript(); // established: a transcript already exists at task start
  fake.append(assistant('end_turn', [text('STALE earlier response.')])); // stale history at offset 0
  const sessions = sessionSteps([
    // The FS starts failing after the start-time existence check. From here size() AND exists()
    // both report failure together, exactly as production would during a transient stat error.
    { status: 'idle', mutate: () => fake.failStat(Infinity) },
    { status: 'idle' },
  ], fake);
  const { executor, injected } = makeExecutor({
    sessions, openTranscript: () => fake.source, statRetryAttempts: 3, statRetryDelayMs: 10,
  });
  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, true); assert.match(error.message, /transcript/i); return true; },
  );
  // Pre-injection: nothing typed, so the stale end_turn is never replayed as this turn's result.
  assert.equal(injected.length, 0);
});

test('an unreadable transcript at task start never gets classified as a fresh conversation', async () => {
  const fake = fakeTranscript();
  fake.append(assistant('end_turn', [text('STALE earlier response.')]));
  fake.failStat(Infinity);
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const { executor, injected, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
  });

  await assert.rejects(
    () => executor.runTurn(
      baseTask,
      { cancelRequested: false },
      { id: SESSION_ID },
      TERMINAL,
      collect(),
    ),
    (error) => {
      assert.equal(error.retryable, true);
      assert.match(error.message, /fresh or established/i);
      return true;
    },
  );
  assert.equal(injected.length, 0);
  assert.equal(submitted.length, 0);
});

test('Issue 14: a cancel during the bounded re-stat aborts as cancelled, never a retryable failure', async () => {
  const fake = fakeTranscript();
  fake.append(assistant('end_turn', [text('STALE earlier response.')]));
  const active = { cancelRequested: false };
  const sessions = sessionSteps([
    // Arm the transient stat failure AND request cancellation between the start-time existence
    // check and the offset read, so the re-stat loop is what observes the cancel.
    { status: 'idle', mutate: () => { fake.failStat(Infinity); active.cancelRequested = true; } },
    { status: 'idle' },
  ], fake);
  const { executor, injected } = makeExecutor({
    sessions, openTranscript: () => fake.source, statRetryAttempts: 3, statRetryDelayMs: 10,
  });
  await assert.rejects(
    () => executor.runTurn(baseTask, active, { id: SESSION_ID }, TERMINAL, collect()),
    // cancelled (queue marks it cancelled and never auto-retries), not the retryable stat error.
    (error) => { assert.equal(error.cancelled, true); return true; },
  );
  assert.equal(injected.length, 0);
});

test('Issue 18: a cancel during the final re-stat wait aborts as cancelled, not the retryable stat error', async () => {
  const fake = fakeTranscript();
  fake.append(assistant('end_turn', [text('STALE earlier response.')]));
  const active = { cancelRequested: false };
  const sessions = sessionSteps([
    { status: 'idle', mutate: () => fake.failStat(Infinity) }, // arm the transient failure after the start-time check
    { status: 'idle' },
  ], fake);
  let waits = 0;
  const { executor, injected } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    statRetryAttempts: 3,
    statRetryDelayMs: 10,
    // The cancel lands during the LAST re-stat wait, so the loop-top check never sees it and
    // only the guard before the retryable throw can catch it.
    wait: async () => { waits += 1; if (waits >= 3) active.cancelRequested = true; },
  });
  await assert.rejects(
    () => executor.runTurn(baseTask, active, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => {
      assert.equal(error.cancelled, true); // queue marks it cancelled and never auto-retries
      assert.doesNotMatch(error.message, /replaying an earlier response/i); // not the retryable stat error
      return true;
    },
  );
  assert.equal(injected.length, 0);
});

test('Issue 18: a cancel during the final readiness poll aborts as cancelled, not the retryable stayed-busy error', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const active = { cancelRequested: false };
  const sessions = sessionSteps([
    { status: 'busy' },
    { status: 'busy' },
    // The cancel lands on the final poll before the deadline expires, after that iteration's
    // loop-top cancel check has already passed.
    { status: 'busy', mutate: () => { active.cancelRequested = true; } },
  ], fake);
  const { executor, injected } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    readinessTimeoutMs: 3000,
    pollMs: 1000,
  });
  await assert.rejects(
    () => executor.runTurn(baseTask, active, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => {
      assert.equal(error.cancelled, true);
      assert.doesNotMatch(error.message, /stayed busy/i); // not the retryable stayed-busy error
      return true;
    },
  );
  assert.equal(injected.length, 0);
});

test('Issue 14: an established session recovers the real offset after a transient stat blip and does not replay history', async () => {
  const fake = fakeTranscript();
  fake.append(assistant('end_turn', [text('STALE earlier response.')])); // stale history
  const sessions = sessionSteps([
    { status: 'idle', mutate: () => fake.failStat(1) }, // one transient failure at offset time, then recovers
    { status: 'busy', append: [userPrompt(deliveredPrompt()), assistant('end_turn', [text('Fresh answer.')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor, injected } = makeExecutor({
    sessions, openTranscript: () => fake.source, statRetryAttempts: 3, statRetryDelayMs: 10,
  });
  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect());
  assert.equal(outcome.finalResponse, 'Fresh answer.'); // recovered offset skipped the stale record
  assert.equal(injected.length, 1);
});

test('Issue 14: a fresh session with no transcript still injects from offset 0 despite a negative stat', async () => {
  const fake = fakeTranscript({ present: false }); // no transcript at task start: genuinely fresh
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [userPrompt(deliveredPrompt()), assistant('end_turn', [text('First turn done.')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor, injected } = makeExecutor({
    sessions, openTranscript: () => fake.source, statRetryAttempts: 3, statRetryDelayMs: 10,
  });
  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect());
  assert.equal(outcome.finalResponse, 'First turn done.'); // offset 0, no re-stat, no retryable failure
  assert.equal(injected.length, 1);
});

test('readiness fails retryably when the session stays busy and never becomes free', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'busy' }], fake);
  const { executor, injected } = makeExecutor({ sessions, openTranscript: () => fake.source, readinessTimeoutMs: 4000 });
  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, true); assert.match(error.message, /stayed busy/i); return true; },
  );
  assert.equal(injected.length, 0);
});

test('readiness fails non-retryably when the session disappears before typing', async () => {
  const fake = fakeTranscript();
  const sessions = sessionSteps([{ status: null }], fake);
  const { executor, injected } = makeExecutor({ sessions, openTranscript: () => fake.source, readinessTimeoutMs: 10000 });
  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, false); assert.match(error.message, /disappeared before CC Relay could type/i); return true; },
  );
  assert.equal(injected.length, 0);
});

test('injection-time identity check aborts retryably on a recycled tty and never types', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }, { status: 'idle' }], fake);
  const { executor, injected } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    resolveTerminal: async () => ({ terminalWindowId: 9999, terminalTty: '/dev/ttys999', runtimeProcessId: 222 }), // window/tty/pid changed
  });
  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, true); assert.match(error.message, /identity changed/i); return true; },
  );
  assert.equal(injected.length, 0); // nothing typed into the recycled window
});

test('injection-time identity check passes when the window still maps to the live pid', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([
    { status: 'idle' }, // ensureReady
    { status: 'idle' }, // verifyTerminalIdentity
    { status: 'busy', append: [userPrompt(deliveredPrompt()), assistant('end_turn', [text('Verified done.')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor, injected } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    resolveTerminal: async () => ({ ...TERMINAL }), // still the same window/tty/pid
  });
  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect());
  assert.equal(outcome.finalResponse, 'Verified done.');
  assert.equal(injected.length, 1);
});

test('Issue 16: an identity-recheck resolution flake fails retryably with a re-verify message, not a mismatch claim', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }, { status: 'idle' }], fake);
  const { executor, injected } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    resolveTerminal: async () => { throw new Error('osascript transient resolution failure'); },
  });
  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => {
      assert.equal(error.retryable, true); // self-heals: a re-run re-resolves the terminal
      assert.match(error.message, /could not re-verify/i);
      assert.doesNotMatch(error.message, /reused by another session/i); // a flake has not proven a mismatch
      return true;
    },
  );
  assert.equal(injected.length, 0); // pre-injection: nothing typed
});

test('Issue 10: a long turn heartbeat uses claude/progress, not claude/waiting', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [userPrompt(deliveredPrompt())] }, { status: 'busy' }, { status: 'busy' },
    { status: 'busy', append: [assistant('end_turn', [text('Long turn done.')])] },
    { status: 'idle' }, { status: 'idle' },
  ], fake);
  const { executor } = makeExecutor({ sessions, openTranscript: () => fake.source, heartbeatMs: 1500 });
  const io = collect();
  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io);
  assert.equal(outcome.finalResponse, 'Long turn done.');
  assert.equal(io.events.some((e) => e.event.type === 'claude/progress' && /still working/i.test(e.message)), true);
  assert.equal(io.types().includes('claude/waiting'), false); // heartbeats are not warning-styled waiting events
});

test('cancellation stops the watcher, sends a best-effort interrupt, and rejects as cancelled', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const active = { cancelRequested: false };
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy' },
    { status: 'busy', mutate: () => { active.cancelRequested = true; } },
    { status: 'busy' },
  ], fake);
  const { executor, cancels } = makeExecutor({ sessions, openTranscript: () => fake.source });
  await assert.rejects(
    () => executor.runTurn(baseTask, active, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => error.cancelled === true,
  );
  assert.deepEqual(cancels, [WINDOW_ID]);
});

// ---- runner routing / fallback ----------------------------------------------

test('runner gives the default terminal executor the pinned Claude binary', () => {
  const requestAttention = async () => {};
  const runner = new ClaudeExecutionRunner({
    command: '/opt/claude/bin/claude',
    sessions: { readConnectedSession: async () => null },
    requestAttention,
  });
  assert.equal(runner.terminalExecutor.command, '/opt/claude/bin/claude');
  assert.equal(runner.terminalExecutor.requestAttention, requestAttention);
});

function headlessRunner(overrides = {}) {
  const spawned = [];
  const runner = new ClaudeExecutionRunner({
    spawnProcess: (command, args) => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => true;
      spawned.push(args);
      queueMicrotask(() => {
        child.stdout.end(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Headless done.', session_id: SESSION_ID })}\n`);
        child.emit('close', 0, null);
      });
      return child;
    },
    sessions: { readConnectedSession: async () => ({ id: SESSION_ID, source: 'Claude interactive', cwd: '/repo', rawStatus: 'idle' }) },
    terminalExecutor: { runTurn: async () => { throw new Error('terminal path must not run'); } },
    ...overrides,
  });
  return { runner, spawned };
}

test('runner uses the headless path when the platform is not darwin', async () => {
  const { runner, spawned } = headlessRunner({ platform: 'linux', resolveTerminal: async () => ({ terminalWindowId: WINDOW_ID }) });
  const outcome = await runner.run({ ...baseTask }, collect());
  assert.equal(outcome.finalResponse, 'Headless done.');
  assert.equal(spawned.length, 1);
});

test('runner uses the headless path when no owned terminal resolves on darwin', async () => {
  const { runner, spawned } = headlessRunner({ platform: 'darwin', resolveTerminal: async () => null });
  const outcome = await runner.run({ ...baseTask }, collect());
  assert.equal(outcome.finalResponse, 'Headless done.');
  assert.equal(spawned.length, 1);
});

test('a terminal-required council stage never falls back to headless', async () => {
  const { runner, spawned } = headlessRunner({
    platform: 'darwin',
    resolveTerminal: async () => null,
  });
  await assert.rejects(
    runner.run({ ...baseTask, require_terminal: true }, collect()),
    /did not run Claude headlessly/,
  );
  assert.equal(spawned.length, 0);
});

test('an oversized terminal-required council stage fails before injection or headless execution', async () => {
  const { runner, spawned } = headlessRunner({
    platform: 'darwin',
    resolveTerminal: async () => ({ ...TERMINAL }),
    terminalExecutor: {
      maxPromptBytes: 20,
      runTurn: async () => { throw new Error('terminal path must not run'); },
    },
  });
  await assert.rejects(
    runner.run({ ...baseTask, prompt: 'x'.repeat(500), require_terminal: true }, collect()),
    /stage was not run headlessly/,
  );
  assert.equal(spawned.length, 0);
});

test('Issue 15: an oversize prompt on an owned darwin terminal runs headless exactly once, with no injection', async () => {
  const spawned = [];
  let terminalCalls = 0;
  const runner = new ClaudeExecutionRunner({
    spawnProcess: (command, args) => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => true;
      spawned.push(args);
      queueMicrotask(() => {
        child.stdout.end(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Headless done.', session_id: SESSION_ID })}\n`);
        child.emit('close', 0, null);
      });
      return child;
    },
    sessions: { readConnectedSession: async () => ({ id: SESSION_ID, source: 'Claude interactive', cwd: '/repo', rawStatus: 'idle', pid: PID }) },
    platform: 'darwin',
    resolveTerminal: async () => ({ ...TERMINAL }), // an owned terminal DOES resolve
    // A real executor would enforce this limit; the mock records whether it was called at all.
    terminalExecutor: {
      maxPromptBytes: 20,
      runTurn: async () => { terminalCalls += 1; throw new Error('the terminal path must not run for an oversize prompt'); },
    },
  });
  const io = collect();
  const outcome = await runner.run({ ...baseTask, prompt: 'x'.repeat(500) }, io);
  assert.equal(outcome.finalResponse, 'Headless done.');
  assert.equal(spawned.length, 1); // headless ran exactly once, no double execution
  assert.equal(terminalCalls, 0); // no injection attempted
  assert.equal(
    io.events.some((e) => /headless/i.test(e.message) && /(byte|larger|limit)/i.test(e.message)),
    true, // the fallback notice explains why this task runs headless
  );
});

test('Issue 15: a NUL-bearing prompt on an owned darwin terminal also falls back to headless', async () => {
  const spawned = [];
  let terminalCalls = 0;
  const runner = new ClaudeExecutionRunner({
    spawnProcess: (command, args) => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => true;
      spawned.push(args);
      queueMicrotask(() => {
        child.stdout.end(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Headless done.', session_id: SESSION_ID })}\n`);
        child.emit('close', 0, null);
      });
      return child;
    },
    sessions: { readConnectedSession: async () => ({ id: SESSION_ID, source: 'Claude interactive', cwd: '/repo', rawStatus: 'idle', pid: PID }) },
    platform: 'darwin',
    resolveTerminal: async () => ({ ...TERMINAL }),
    terminalExecutor: {
      maxPromptBytes: 100_000,
      runTurn: async () => { terminalCalls += 1; throw new Error('the terminal path must not run for a NUL prompt'); },
    },
  });
  const io = collect();
  const outcome = await runner.run({ ...baseTask, prompt: `bad${NUL}prompt` }, io);
  assert.equal(outcome.finalResponse, 'Headless done.');
  assert.equal(spawned.length, 1);
  assert.equal(terminalCalls, 0);
  assert.equal(io.events.some((e) => /headless/i.test(e.message) && /NUL/i.test(e.message)), true);
});

test('runner drives the terminal executor when an owned terminal resolves on darwin', async () => {
  const spawned = [];
  let terminalCalled = null;
  const runner = new ClaudeExecutionRunner({
    spawnProcess: () => { spawned.push(true); throw new Error('headless must not spawn'); },
    sessions: { readConnectedSession: async () => ({ id: SESSION_ID, source: 'Claude interactive', cwd: '/repo', rawStatus: 'idle', pid: PID }) },
    platform: 'darwin',
    resolveTerminal: async () => ({ ...TERMINAL }),
    terminalExecutor: {
      runTurn: async (task, active, session, terminal) => {
        terminalCalled = { taskId: task.id, windowId: terminal.terminalWindowId };
        return { finalResponse: 'Terminal done.', sessionId: SESSION_ID, reportedSessionId: SESSION_ID, exitCode: 0 };
      },
    },
  });
  const io = collect();
  const outcome = await runner.run({ ...baseTask }, io);
  assert.equal(outcome.finalResponse, 'Terminal done.');
  assert.deepEqual(terminalCalled, { taskId: baseTask.id, windowId: WINDOW_ID });
  assert.equal(spawned.length, 0);
  assert.equal(io.types().includes('claude/completed'), true);
});
