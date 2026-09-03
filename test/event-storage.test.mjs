import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTIVITY_TEXT_CHARACTER_LIMIT,
  boundedActivityText,
  compactEventForStorage,
} from '../src/event-storage.mjs';

test('activity command output keeps bounded head and tail text without mutating the raw event', () => {
  const output = `${'a'.repeat(ACTIVITY_TEXT_CHARACTER_LIMIT)}${'z'.repeat(ACTIVITY_TEXT_CHARACTER_LIMIT)}`;
  const event = {
    type: 'item/completed',
    item: { id: 'command-1', type: 'commandExecution', aggregatedOutput: output },
  };

  const compacted = compactEventForStorage(event);

  assert.equal(event.item.aggregatedOutput, output);
  assert.notEqual(compacted, event);
  assert.ok(compacted.item.aggregatedOutput.length <= ACTIVITY_TEXT_CHARACTER_LIMIT);
  assert.match(compacted.item.aggregatedOutput, /^a+/);
  assert.match(compacted.item.aggregatedOutput, /z+$/);
  assert.match(compacted.item.aggregatedOutput, /complete provider event remains in the task artifact/i);
  assert.equal(compacted.item.aggregatedOutputCharacters, output.length);
  assert.equal(compacted.item.activityDetailTruncated, true);
});

test('started file changes omit duplicate diffs while completed diffs remain exact', () => {
  const item = {
    id: 'change-1',
    type: 'fileChange',
    changes: [{ path: 'src/app.js', kind: { type: 'update' }, diff: 'exact patch' }],
  };

  const started = compactEventForStorage({ type: 'item/started', item });
  const completed = compactEventForStorage({ type: 'item/completed', item });

  assert.equal(started.item.changes[0].diff, undefined);
  assert.equal(started.item.changes[0].diffCharacters, 11);
  assert.equal(started.item.changes[0].diffOmittedFromStartedEvent, true);
  assert.equal(completed.item.changes[0].diff, 'exact patch');
  assert.equal(item.changes[0].diff, 'exact patch');
});

test('activity tool results omit embedded media and bound oversized text', () => {
  const longText = 'tool output '.repeat(4_000);
  const event = {
    type: 'item/completed',
    item: {
      id: 'tool-1',
      type: 'mcpToolCall',
      result: {
        content: [{ type: 'text', text: longText }],
        screenshot: { url: `data:image/png;base64,${'A'.repeat(50_000)}` },
      },
    },
  };

  const compacted = compactEventForStorage(event);

  assert.ok(compacted.item.result.content[0].text.length <= ACTIVITY_TEXT_CHARACTER_LIMIT);
  assert.match(compacted.item.result.screenshot.url, /binary media omitted/i);
  assert.equal(compacted.item.activityDetailTruncated, true);
  assert.equal(event.item.result.content[0].text, longText);
  assert.match(event.item.result.screenshot.url, /^data:image\/png;base64,/);
});

test('short activity text remains unchanged', () => {
  assert.deepEqual(boundedActivityText('short'), {
    value: 'short',
    truncated: false,
    originalCharacters: 5,
  });
});

test('activity text honors small limits and deeply nested tool results stay bounded', () => {
  const tiny = boundedActivityText('longer than ten', 10);
  assert.equal(tiny.value.length, 10);
  assert.equal(tiny.truncated, true);

  let result = { value: 'bottom' };
  for (let index = 0; index < 40; index += 1) result = { child: result };
  const compacted = compactEventForStorage({
    type: 'item/completed',
    item: { type: 'mcpToolCall', result },
  });
  assert.equal(compacted.item.activityDetailTruncated, true);
  assert.match(JSON.stringify(compacted.item.result), /deep provider value omitted/i);
});
