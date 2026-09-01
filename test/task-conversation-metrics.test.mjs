import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compactTokenCount,
  dailyTokenUsagePresentation,
  taskTokenPresentation,
} from '../public/task-conversation-metrics.js';

function taskWithTokens(inputTokens, outputTokens, tokenObserved = true, totalTokens = inputTokens + outputTokens) {
  return {
    conversation_metrics: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      token_observed: tokenObserved,
    },
  };
}

test('token counts use compact stable labels', () => {
  assert.equal(compactTokenCount(999), '999');
  assert.equal(compactTokenCount(1_250), '1.3k');
  assert.equal(compactTokenCount(24_500), '25k');
  assert.equal(compactTokenCount(1_250_000), '1.3m');
  assert.equal(compactTokenCount(15_687_282), '15.7m');
  assert.equal(compactTokenCount(125_000_000), '125m');
});

test('conversation token heat uses the provider total', () => {
  assert.equal(taskTokenPresentation(taskWithTokens(20_000, 1_000)).level, 'quiet');
  assert.equal(taskTokenPresentation(taskWithTokens(60_000, 10_000)).level, 'steady');
  assert.equal(taskTokenPresentation(taskWithTokens(250_000, 20_000)).level, 'heavy');
  const intense = taskTokenPresentation(taskWithTokens(600_000, 50_000));
  assert.equal(intense.level, 'intense');
  assert.equal(intense.totalLabel, '650k');
  assert.equal(intense.outputLabel, '50k');
  assert.match(intense.title, /650,000 provider-reported tokens \| 50,000 output tokens \| 600,000 input, cache, reasoning, or unclassified tokens/);
});

test('Claude cache tokens remain in the visible provider total', () => {
  const presentation = taskTokenPresentation(taskWithTokens(38, 19_310, true, 5_466_578));
  assert.equal(presentation.totalTokens, 5_466_578);
  assert.equal(presentation.totalLabel, '5.5m');
  assert.equal(presentation.inputTokens, 38);
  assert.equal(presentation.outputTokens, 19_310);
});

test('cards hide token capsules until native usage has been observed', () => {
  assert.equal(taskTokenPresentation(taskWithTokens(0, 0, false)), null);
  assert.equal(taskTokenPresentation({}), null);
});

test('daily title-bar usage presents one all-provider sum with provider detail', () => {
  const presentation = dailyTokenUsagePresentation({
    totalTokens: 6_000_000,
    providers: {
      claude: { totalTokens: 5_500_000 },
      codex: { totalTokens: 500_000 },
    },
  });

  assert.equal(presentation.label, 'Today 6.0m');
  assert.equal(presentation.state, 'ready');
  assert.match(presentation.title, /6,000,000 provider-reported tokens/);
  assert.match(presentation.title, /Claude: 5,500,000 \| Codex: 500,000/);
  assert.match(presentation.title, /cache, reasoning, and completed Claude sub-agent usage/);
});

test('daily title-bar usage distinguishes no activity from an older backend', () => {
  assert.deepEqual(dailyTokenUsagePresentation({ totalTokens: 0 }), {
    label: 'Today 0',
    title: 'No provider-reported token usage has been recorded today.',
    state: 'empty',
    totalTokens: 0,
  });
  assert.equal(
    dailyTokenUsagePresentation(null, { supported: false }).label,
    'Today --',
  );
});
