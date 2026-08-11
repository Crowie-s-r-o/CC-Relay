import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_TASK_TITLE_LENGTH,
  taskTitleFromInput,
  titleFromPrompt,
} from '../src/task-title.mjs';

test('task names normalize whitespace and override the generated prompt title', () => {
  assert.equal(
    taskTitleFromInput('  Release   readiness\nreview  ', 'Inspect the release.'),
    'Release readiness review',
  );
});

test('blank or omitted task names fall back to the compact prompt title', () => {
  const prompt = 'Inspect the queue naming behavior and verify every compatibility path.';
  assert.equal(taskTitleFromInput(undefined, prompt), titleFromPrompt(prompt));
  assert.equal(taskTitleFromInput('   ', prompt), titleFromPrompt(prompt));
  assert.equal(titleFromPrompt('word '.repeat(30)).length, 80);
});

test('task names reject non-text values and names over the limit', () => {
  assert.throws(() => taskTitleFromInput(42, 'Prompt'), /must be text/i);
  assert.throws(
    () => taskTitleFromInput('x'.repeat(MAX_TASK_TITLE_LENGTH + 1), 'Prompt'),
    /120 characters or fewer/i,
  );
  assert.equal(
    taskTitleFromInput('x'.repeat(MAX_TASK_TITLE_LENGTH), 'Prompt').length,
    MAX_TASK_TITLE_LENGTH,
  );
});
