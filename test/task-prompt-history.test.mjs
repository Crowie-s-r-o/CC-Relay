import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeTaskPrompts,
  taskPromptCopyText,
  taskPromptHistoryPreview,
  taskPromptHistoryText,
} from '../public/task-prompt-history.js';

test('prompt history keeps the original request first and renders every follow-up', () => {
  const task = {
    id: 42,
    prompt: 'Original request',
    created_at: '2026-07-28T08:00:00.000Z',
  };
  const prompts = normalizeTaskPrompts(task, [
    {
      id: 'follow-up-1',
      kind: 'follow-up',
      text: 'First follow-up',
      created_at: '2026-07-28T08:10:00.000Z',
    },
    {
      id: 'original',
      kind: 'original',
      text: 'Stale original value',
      created_at: '2026-07-28T08:00:00.000Z',
    },
    {
      id: 'follow-up-2',
      kind: 'follow-up',
      text: 'Second follow-up',
      created_at: '2026-07-28T08:20:00.000Z',
    },
  ]);

  assert.deepEqual(prompts.map(({ kind, text }) => ({ kind, text })), [
    { kind: 'original', text: 'Original request' },
    { kind: 'follow-up', text: 'First follow-up' },
    { kind: 'follow-up', text: 'Second follow-up' },
  ]);
  assert.equal(taskPromptHistoryText(prompts), [
    '01 · Original request',
    'Original request',
    '',
    '02 · Follow-up 1',
    'First follow-up',
    '',
    '03 · Follow-up 2',
    'Second follow-up',
  ].join('\n'));
  assert.equal(taskPromptHistoryPreview(prompts), '3 prompts · Second follow-up');
  assert.equal(taskPromptCopyText(prompts), [
    'Original request',
    'First follow-up',
    'Second follow-up',
  ].join('\n\n'));
  assert.doesNotMatch(taskPromptCopyText(prompts), /^01 \u00b7 Original request$/m);
});

test('prompt history falls back to the task prompt for an older backend', () => {
  const prompts = normalizeTaskPrompts({ id: 7, prompt: 'Only request' });
  assert.equal(taskPromptHistoryText(prompts), '01 · Original request\nOnly request');
  assert.equal(taskPromptCopyText(prompts), 'Only request');
  assert.equal(taskPromptHistoryPreview(prompts), '1 prompt · Only request');
});
