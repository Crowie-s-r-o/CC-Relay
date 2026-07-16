import assert from 'node:assert/strict';
import test from 'node:test';
import { buildParallelCodexPrompt } from '../src/parallel-batch.mjs';

test('parallel Codex prompt delegates numbered tasks to concurrent sub-agents', () => {
  const prompt = buildParallelCodexPrompt([
    { prompt: 'Fix checkout tests.' },
    { prompt: 'Update payment documentation.' },
    { prompt: 'Audit the retry path.' },
  ]);
  assert.match(prompt, /Use sub-agents/);
  assert.match(prompt, /one coordinated Codex command/);
  assert.match(prompt, /1\. Fix checkout tests\./);
  assert.match(prompt, /2\. Update payment documentation\./);
  assert.match(prompt, /3\. Audit the retry path\./);
  assert.match(prompt, /Wait for all sub-agents to finish/);
});

test('parallel Codex prompt requires at least two tasks', () => {
  assert.throws(() => buildParallelCodexPrompt([{ prompt: 'Only one.' }]), /at least two/);
});
