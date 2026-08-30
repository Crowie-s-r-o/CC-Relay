import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeSubAgentCount,
  assistantMessageStatus,
  entryFirstEvent,
  entryItem,
  entryLastEvent,
  eventEntryCategory,
  eventEntryMessageRole,
  eventEntryRepeatCount,
  eventMessageCounts,
  eventStreamStats,
  filterEventEntries,
  goalEntryDetails,
  groupEventEntries,
  isEventEntryHighlight,
  isGoalEntry,
  isPlanEntry,
  isPlanToolItem,
  isSubAgentEntry,
  mergePromptMessages,
  planEntryDetails,
  subAgentEntryDetails,
  subAgentEntryState,
} from '../public/event-stream.js';

function itemEvent(id, phase, type, overrides = {}) {
  return {
    id: overrides.eventId || id,
    kind: overrides.kind || 'codex',
    message: `${type} ${phase}.`,
    created_at: overrides.createdAt || '2026-07-16T10:00:00.000Z',
    payload: {
      type: `item/${phase}`,
      item: { id, type, ...overrides.item },
    },
  };
}

test('event stream groups item start and completion into one signal', () => {
  const events = [
    { id: 1, kind: 'queue', message: 'Task started.', created_at: '2026-07-16T10:00:00.000Z', payload: null },
    itemEvent('command-1', 'started', 'commandExecution', { eventId: 2, item: { command: 'npm test' } }),
    itemEvent('command-1', 'completed', 'commandExecution', {
      eventId: 3,
      item: { command: 'npm test', exitCode: 0, aggregatedOutput: '22 tests passed' },
    }),
  ];

  const entries = groupEventEntries(events);
  assert.equal(entries.length, 2);
  assert.equal(entries[1].events.length, 2);
  assert.equal(entries[1].startedEvent.id, 2);
  assert.equal(entries[1].completedEvent.id, 3);
  assert.equal(entryItem(entries[1]).aggregatedOutput, '22 tests passed');
});

test('event stream folds live Claude message batches into one updating signal', () => {
  const entries = groupEventEntries([
    {
      id: 1,
      kind: 'claude',
      message: 'Working.',
      created_at: '2026-07-16T10:00:00.000Z',
      payload: {
        type: 'claude/message',
        liveMessageId: 'message-1',
        liveIndex: 0,
        liveFinal: false,
        liveDelta: 'Working.\n',
        text: 'Working.',
      },
    },
    {
      id: 2,
      kind: 'claude',
      message: 'Done.',
      created_at: '2026-07-16T10:00:01.000Z',
      payload: {
        type: 'claude/message',
        liveMessageId: 'message-1',
        liveIndex: 1,
        liveFinal: true,
        liveDelta: 'Done.',
        text: 'Done.',
      },
    },
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].events.length, 2);
  assert.equal(entries[0].events.at(-1).payload.text, 'Done.');
  assert.equal(entryLastEvent(entries[0]).payload.text, 'Working.\nDone.');
  assert.equal(eventStreamStats(entries).messages, 1);
});

test('OpenCode responses are assistant messages and token telemetry folds by provider', () => {
  const entries = groupEventEntries([
    {
      id: 1,
      kind: 'opencode',
      message: 'Implemented it.',
      created_at: '2026-08-25T10:00:01.000Z',
      payload: { type: 'opencode/message', provider: 'opencode', text: 'Implemented it.' },
    },
    {
      id: 2,
      kind: 'opencode',
      message: 'OpenCode session is active.',
      created_at: '2026-08-25T10:00:01.500Z',
      payload: { type: 'opencode/session', provider: 'opencode', sessionId: 'session-1' },
    },
    {
      id: 3,
      kind: 'opencode',
      message: 'OpenCode used 100 tokens so far.',
      created_at: '2026-08-25T10:00:02.000Z',
      payload: {
        type: 'provider/token-usage',
        provider: 'opencode',
        source: 'native',
        cumulative: true,
        usage: { totalTokens: 100 },
      },
    },
    {
      id: 4,
      kind: 'opencode',
      message: 'OpenCode used 200 tokens so far.',
      created_at: '2026-08-25T10:00:03.000Z',
      payload: {
        type: 'provider/token-usage',
        provider: 'opencode',
        source: 'native',
        cumulative: true,
        usage: { totalTokens: 200 },
      },
    },
  ]);

  assert.equal(entries.length, 3);
  assert.equal(eventEntryMessageRole(entries[0]), 'assistant');
  assert.equal(eventEntryCategory(entries[0]), 'messages');
  assert.equal(eventEntryCategory(entries[1]), 'system');
  assert.equal(entries[2].events.length, 2);
  assert.equal(entryLastEvent(entries[2]).payload.usage.totalTokens, 200);
  assert.equal(eventStreamStats(entries).messages, 1);
});

test('assistant message status distinguishes transport completion from final answers', () => {
  const [claudeUpdate] = groupEventEntries([{
    id: 1,
    kind: 'claude',
    message: 'The implementation agent is running.',
    created_at: '2026-07-16T10:00:00.000Z',
    payload: {
      type: 'claude/message',
      liveMessageId: 'message-progress',
      liveIndex: 0,
      liveFinal: true,
      liveDelta: 'The implementation agent is running.',
      text: 'The implementation agent is running.',
    },
  }]);
  assert.equal(
    assistantMessageStatus(claudeUpdate, { status: 'running', result: '' }),
    'update',
  );

  const [codexCommentary] = groupEventEntries([
    itemEvent('message-commentary', 'completed', 'agentMessage', {
      kind: 'result',
      item: { phase: 'commentary', text: 'I am running the final checks.' },
    }),
  ]);
  assert.equal(assistantMessageStatus(codexCommentary, { status: 'running' }), 'update');

  const [codexFinal] = groupEventEntries([
    itemEvent('message-final', 'completed', 'agentMessage', {
      kind: 'result',
      item: { phase: 'final_answer', text: 'Implemented and verified.' },
    }),
  ]);
  assert.equal(assistantMessageStatus(codexFinal, { status: 'running' }), 'final');
});

test('assistant message status recognizes settled Claude and legacy final responses', () => {
  const [claudeFinal] = groupEventEntries([{
    id: 1,
    kind: 'claude',
    message: 'Implemented and verified.',
    created_at: '2026-07-16T10:00:00.000Z',
    payload: {
      type: 'claude/message',
      liveMessageId: 'message-final',
      liveIndex: 0,
      liveFinal: true,
      liveDelta: 'Implemented and verified.',
      text: 'Implemented and verified.',
    },
  }]);
  assert.equal(
    assistantMessageStatus(
      claudeFinal,
      { status: 'complete', result: 'Implemented and verified.' },
    ),
    'final',
  );

  const [legacyFinal] = groupEventEntries([{
    id: 2,
    kind: 'result',
    message: 'Historical final response.',
    created_at: '2026-07-16T10:00:01.000Z',
    payload: null,
  }]);
  assert.equal(assistantMessageStatus(legacyFinal, { status: 'complete' }), 'final');
});

test('message role filters separate sent prompts from AI responses', () => {
  const events = [
    itemEvent('prompt-1', 'started', 'userMessage', {
      item: {
        content: [{
          type: 'text',
          text: 'Improve the terminal.\n\nCC Relay orchestrator notice: continue autonomously.',
        }],
      },
    }),
    itemEvent('prompt-1', 'completed', 'userMessage', {
      eventId: 2,
      item: {
        content: [{
          type: 'text',
          text: 'Improve the terminal.\n\nCC Relay orchestrator notice: continue autonomously.',
        }],
      },
    }),
    itemEvent('message-1', 'completed', 'agentMessage', {
      eventId: 3,
      item: { text: 'Terminal improved.' },
    }),
  ];
  const displayEvents = mergePromptMessages(events, [{
    id: 'task-1-original',
    kind: 'original',
    text: 'Improve the terminal.',
    created_at: '2026-07-16T10:00:00.000Z',
  }]);
  const entries = groupEventEntries(displayEvents);

  assert.equal(entries.length, 2);
  assert.match(events[0].payload.item.content[0].text, /CC Relay orchestrator notice:/);
  assert.match(events[1].payload.item.content[0].text, /CC Relay orchestrator notice:/);
  assert.equal(displayEvents[0].payload.item.content[0].text, 'Improve the terminal.');
  assert.equal(displayEvents[1].payload.item.content[0].text, 'Improve the terminal.');
  assert.equal(displayEvents[1].payload.item.promptKind, 'original');
  assert.equal(entryItem(entries[0]).content[0].text, 'Improve the terminal.');
  assert.equal(eventEntryMessageRole(entries[0]), 'user');
  assert.equal(eventEntryMessageRole(entries[1]), 'assistant');
  assert.deepEqual(filterEventEntries(entries, 'conversation'), entries);
  assert.equal(filterEventEntries(entries, 'mine').length, 1);
  assert.equal(filterEventEntries(entries, 'ai').length, 1);
  assert.deepEqual(eventMessageCounts(entries), { user: 1, assistant: 1 });
});

test('a provider delivery echo replaces the provisional Relay follow-up receipt', () => {
  const prompt = 'Add a manual test mode.';
  const delivered = `${prompt}\n\nCC Relay orchestrator notice: continue autonomously.`;
  const events = [
    itemEvent('relay-follow-up-42-1', 'completed', 'userMessage', {
      eventId: 197,
      createdAt: '2026-08-26T19:21:04.000Z',
      item: { content: [{ type: 'text', text: prompt }] },
    }),
    itemEvent('provider-prompt-2', 'started', 'userMessage', {
      eventId: 202,
      createdAt: '2026-08-26T19:21:11.000Z',
      item: { content: [{ type: 'text', text: delivered }] },
    }),
    itemEvent('provider-prompt-2', 'completed', 'userMessage', {
      eventId: 203,
      createdAt: '2026-08-26T19:21:12.000Z',
      item: { content: [{ type: 'text', text: delivered }] },
    }),
  ];
  const displayEvents = mergePromptMessages(events, [{
    id: 'relay-follow-up-42-1',
    kind: 'follow-up',
    text: prompt,
    created_at: '2026-08-26T19:21:04.000Z',
  }]);
  const entries = groupEventEntries(displayEvents);

  assert.deepEqual(displayEvents.map((event) => event.id), [202, 203]);
  assert.equal(displayEvents[0].payload.item.content[0].text, delivered);
  assert.equal(displayEvents[1].payload.item.content[0].text, delivered);
  assert.equal(displayEvents[1].payload.item.promptKind, 'follow-up');
  assert.equal(events[0].payload.item.content[0].text, prompt);
  assert.equal(entries.length, 1);
  assert.equal(entryItem(entries[0]).content[0].text, delivered);
  assert.deepEqual(eventMessageCounts(entries), { user: 1, assistant: 0 });
});

test('a Relay follow-up receipt remains visible when the provider does not echo it', () => {
  const prompt = 'Check the remaining edge case.';
  const displayEvents = mergePromptMessages([
    itemEvent('relay-follow-up-42-2', 'completed', 'userMessage', {
      eventId: 204,
      item: { content: [{ type: 'text', text: prompt }] },
    }),
  ], [{
    id: 'relay-follow-up-42-2',
    kind: 'follow-up',
    text: prompt,
    created_at: '2026-08-26T19:22:00.000Z',
  }]);

  assert.equal(displayEvents.length, 1);
  assert.equal(displayEvents[0].payload.item.content[0].text, prompt);
  assert.equal(displayEvents[0].payload.item.promptKind, 'follow-up');
});

test('an exact provider echo also replaces a historical Relay follow-up receipt', () => {
  const prompt = 'Resume the saved session.';
  const displayEvents = mergePromptMessages([
    itemEvent('relay-follow-up-42-3', 'completed', 'userMessage', {
      eventId: 205,
      item: { content: [{ type: 'text', text: prompt }] },
    }),
    itemEvent('provider-prompt-3', 'started', 'userMessage', {
      eventId: 206,
      item: { content: [{ type: 'text', text: prompt }] },
    }),
    itemEvent('provider-prompt-3', 'completed', 'userMessage', {
      eventId: 207,
      item: { content: [{ type: 'text', text: prompt }] },
    }),
  ], [{
    id: 'relay-follow-up-42-3',
    kind: 'follow-up',
    text: prompt,
    created_at: '2026-08-26T19:23:00.000Z',
  }]);

  assert.deepEqual(displayEvents.map((event) => event.id), [206, 207]);
  assert.equal(groupEventEntries(displayEvents).length, 1);
});

test('a legacy Relay notice is recognized as provider-delivered follow-up text', () => {
  const prompt = 'Verify the older task.';
  const delivered = `${prompt}\n\nRelay orchestrator notice: continue autonomously.`;
  const displayEvents = mergePromptMessages([
    itemEvent('relay-follow-up-42-4', 'completed', 'userMessage', {
      eventId: 208,
      item: { content: [{ type: 'text', text: prompt }] },
    }),
    itemEvent('provider-prompt-4', 'completed', 'userMessage', {
      eventId: 209,
      item: { content: [{ type: 'text', text: delivered }] },
    }),
  ], [{
    id: 'relay-follow-up-42-4',
    kind: 'follow-up',
    text: prompt,
    created_at: '2026-08-26T19:24:00.000Z',
  }]);

  assert.deepEqual(displayEvents.map((event) => event.id), [209]);
  assert.equal(displayEvents[0].payload.item.content[0].text, delivered);
});

test('the original prompt appears in the terminal when the provider did not echo it', () => {
  const displayEvents = mergePromptMessages([{
    id: 2,
    kind: 'claude',
    message: 'Done.',
    created_at: '2026-07-16T10:00:01.000Z',
    payload: { type: 'claude/message', provider: 'claude', text: 'Done.' },
  }], [{
    id: 'task-2-original',
    kind: 'original',
    text: 'Inspect the output.',
    created_at: '2026-07-16T10:00:00.000Z',
  }], { provider: 'claude' });
  const entries = groupEventEntries(displayEvents);

  assert.equal(displayEvents[0].payload.displayOnly, true);
  assert.equal(entryItem(entries[0]).content[0].text, 'Inspect the output.');
  assert.deepEqual(eventMessageCounts(entries), { user: 1, assistant: 1 });
});

test('prompt merging tolerates missing and malformed API collections', () => {
  assert.deepEqual(mergePromptMessages(undefined, undefined), []);
  assert.deepEqual(mergePromptMessages({}, {}), []);
});

test('AI messages exclude Claude session notices', () => {
  const entries = groupEventEntries([{
    id: 1,
    kind: 'claude',
    message: 'Claude needs input.',
    created_at: '2026-07-16T10:00:00.000Z',
    payload: { type: 'claude/input-required', provider: 'claude' },
  }]);

  assert.equal(filterEventEntries(entries, 'messages').length, 1);
  assert.equal(filterEventEntries(entries, 'conversation').length, 0);
  assert.equal(filterEventEntries(entries, 'ai').length, 0);
  assert.deepEqual(eventMessageCounts(entries), { user: 0, assistant: 0 });
});

test('Conversation keeps both speakers in signal order and excludes other activity', () => {
  const entries = groupEventEntries([
    itemEvent('prompt-1', 'completed', 'userMessage', {
      eventId: 1,
      item: { content: [{ type: 'text', text: 'Please check this.' }] },
    }),
    itemEvent('command-1', 'completed', 'commandExecution', { eventId: 2 }),
    itemEvent('message-1', 'completed', 'agentMessage', {
      eventId: 3,
      item: { text: 'Checked.' },
    }),
    {
      id: 4,
      kind: 'claude',
      message: 'Claude needs input.',
      created_at: '2026-07-16T10:00:03.000Z',
      payload: { type: 'claude/input-required', provider: 'claude' },
    },
  ]);

  assert.deepEqual(
    filterEventEntries(entries, 'conversation').map(eventEntryMessageRole),
    ['user', 'assistant'],
  );
});

test('legacy result rows remain AI messages', () => {
  const entries = groupEventEntries([
    {
      id: 1,
      kind: 'result',
      message: 'Finished response.',
      created_at: '2026-07-16T10:00:00.000Z',
      payload: null,
    },
    itemEvent('legacy-message', 'completed', 'agent_message', {
      eventId: 2,
      item: { text: 'Older response.' },
    }),
  ]);

  assert.equal(eventEntryMessageRole(entries[0]), 'assistant');
  assert.equal(eventEntryMessageRole(entries[1]), 'assistant');
  assert.equal(filterEventEntries(entries, 'ai').length, 2);
});

test('event stream summarizes execution telemetry', () => {
  const entries = groupEventEntries([
    itemEvent('command-1', 'started', 'commandExecution'),
    itemEvent('command-1', 'completed', 'commandExecution'),
    itemEvent('files-1', 'completed', 'fileChange'),
    itemEvent('message-1', 'completed', 'agentMessage'),
    itemEvent('prompt-1', 'completed', 'userMessage'),
    itemEvent('failed-1', 'completed', 'commandExecution', { item: { status: 'failed' } }),
  ]);
  assert.deepEqual(eventStreamStats(entries), {
    commands: 2,
    files: 1,
    messages: 2,
    errors: 1,
    running: 0,
    thinkingTokens: 0,
    agents: 0,
    plan: null,
  });
});

test('live turn updates appear in the Messages filter but stay out of Highlights', () => {
  const entries = groupEventEntries([
    itemEvent('prompt-live', 'completed', 'userMessage', {
      item: { content: [{ type: 'text', text: 'Correct the current work' }] },
    }),
  ]);
  assert.equal(filterEventEntries(entries, 'messages').length, 1);
  assert.equal(filterEventEntries(entries, 'highlights').length, 0);
  assert.equal(eventStreamStats(entries).messages, 1);
});

test('event stream reports reasoning output tokens from turn completion', () => {
  const entries = groupEventEntries([{
    id: 1,
    kind: 'codex',
    message: 'Codex turn completed.',
    created_at: '2026-07-16T10:00:00.000Z',
    payload: {
      type: 'turn/completed',
      tokenUsage: { last: { reasoningOutputTokens: 4321 } },
    },
  }]);
  assert.equal(eventStreamStats(entries).thinkingTokens, 4321);
});

test('event stream highlight filter removes protocol noise but keeps useful work', () => {
  const entries = groupEventEntries([
    itemEvent('reasoning-1', 'completed', 'reasoning'),
    itemEvent('command-1', 'completed', 'commandExecution'),
    itemEvent('message-1', 'completed', 'agentMessage', { kind: 'result' }),
    { id: 4, kind: 'queue', message: 'Task completed.', created_at: '2026-07-16T10:00:04.000Z', payload: null },
  ]);

  assert.equal(filterEventEntries(entries, 'highlights').length, 3);
  assert.equal(filterEventEntries(entries, 'commands').length, 1);
  assert.equal(filterEventEntries(entries, 'messages').length, 1);
  assert.equal(filterEventEntries(entries, 'all').length, 4);
});

test('claude/progress heartbeats stay out of Highlights while claude/started remains', () => {
  const progress = groupEventEntries([{
    id: 1,
    kind: 'claude',
    message: 'Claude is still working in the relay-9 terminal.',
    created_at: '2026-07-16T10:00:00.000Z',
    payload: { type: 'claude/progress' },
  }]);
  assert.equal(filterEventEntries(progress, 'highlights').length, 0);

  const started = groupEventEntries([{
    id: 2,
    kind: 'claude',
    message: 'Claude is running this turn inside the relay-9 terminal.',
    created_at: '2026-07-16T10:00:01.000Z',
    payload: { type: 'claude/started' },
  }]);
  assert.equal(filterEventEntries(started, 'highlights').length, 1);
});

test('consecutive identical Claude progress heartbeats fold into one counted signal', () => {
  const message = 'Claude is still working in the relay-9 terminal.';
  const entries = groupEventEntries([
    {
      id: 1,
      kind: 'claude',
      message,
      created_at: '2026-07-16T10:00:00.000Z',
      payload: { type: 'claude/progress', provider: 'claude', sessionId: 'relay-9' },
    },
    {
      id: 2,
      kind: 'claude',
      message,
      created_at: '2026-07-16T10:00:30.000Z',
      payload: { type: 'claude/progress', provider: 'claude', sessionId: 'relay-9' },
    },
    {
      id: 3,
      kind: 'claude',
      message,
      created_at: '2026-07-16T10:01:00.000Z',
      payload: { type: 'claude/progress', provider: 'claude', sessionId: 'relay-9' },
    },
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].events.length, 3);
  assert.equal(eventEntryRepeatCount(entries[0]), 3);
  assert.equal(entryFirstEvent(entries[0]).id, 1);
  assert.equal(entryLastEvent(entries[0]).id, 3);
  assert.equal(filterEventEntries(entries, 'all').length, 1);
  assert.equal(filterEventEntries(entries, 'highlights').length, 0);
});

test('Claude heartbeat folding stops at any chronological or payload change', () => {
  const message = 'Claude is still working in the relay-9 terminal.';
  const progress = (id, payload = {}) => ({
    id,
    kind: 'claude',
    message,
    created_at: `2026-07-16T10:0${id}:00.000Z`,
    payload: {
      type: 'claude/progress',
      provider: 'claude',
      sessionId: 'relay-9',
      ...payload,
    },
  });
  const entries = groupEventEntries([
    progress(1),
    progress(2),
    { id: 3, kind: 'queue', message: 'Task is still running.', created_at: '2026-07-16T10:03:00.000Z' },
    progress(4),
    progress(5, { deliveryState: 'idle-without-question' }),
  ]);

  assert.equal(entries.length, 4);
  assert.deepEqual(entries.map(eventEntryRepeatCount), [2, 1, 1, 1]);
  assert.equal(entryFirstEvent(entries[2]).id, 4);
  assert.equal(entryFirstEvent(entries[3]).id, 5);
});

test('Claude terminal input requests remain visible in Highlights', () => {
  const entries = groupEventEntries([{
    id: 1,
    kind: 'claude',
    message: 'Claude paused in the relay-9 terminal and may be waiting for your input.',
    created_at: '2026-07-16T10:00:00.000Z',
    payload: { type: 'claude/input-required', provider: 'claude' },
  }]);

  assert.equal(filterEventEntries(entries, 'highlights').length, 1);
  assert.equal(filterEventEntries(entries, 'messages').length, 1);
});

// Sub-agent shapes below mirror the events CC Relay records for a real Claude team session:
// an `Agent` tool call that returns immediately, then a task notification minutes later.
function subAgentEvent(toolUseId, phase, overrides = {}) {
  const completed = phase === 'completed';
  return {
    id: overrides.eventId || 1,
    kind: 'claude',
    message: completed ? 'Sub-agent is working in the background.' : 'Claude started sub-agent.',
    created_at: overrides.createdAt || '2026-07-27T17:28:57.672Z',
    payload: {
      type: `item/${phase}`,
      provider: 'claude',
      item: {
        type: 'mcpToolCall',
        id: toolUseId,
        server: 'Claude Code',
        tool: 'Agent',
        arguments: {
          description: 'dev-1: editor layout rework',
          subagent_type: 'fullstack-engineer',
          prompt: 'You are dev-1 on the dev-team.',
        },
        status: completed ? 'completed' : 'inProgress',
        result: completed ? { content: [{ type: 'text', text: 'Async agent launched successfully.' }] } : null,
        subAgent: true,
        toolUseId,
        agentName: 'dev-1: editor layout rework',
        agentType: 'fullstack-engineer',
        ...(completed ? { backgrounded: true, agentId: 'ac125e8d59ad9fbc1' } : {}),
        ...overrides.item,
      },
    },
  };
}

function agentFinishedEvent(toolUseId, overrides = {}) {
  return {
    id: overrides.eventId || 9,
    kind: 'claude',
    message: 'Agent "dev-1: editor layout rework" finished',
    created_at: overrides.createdAt || '2026-07-27T17:45:03.085Z',
    payload: {
      type: 'claude/agent-finished',
      provider: 'claude',
      toolUseId,
      agentId: overrides.agentId || 'ac125e8d59ad9fbc1',
      status: overrides.status || 'completed',
      summary: 'Agent "dev-1: editor layout rework" finished',
      agentName: 'dev-1: editor layout rework',
    },
  };
}

function codexAgentActivity(agentThreadId, kind, overrides = {}) {
  const itemId = overrides.itemId || `activity-${kind}-${agentThreadId}`;
  return {
    id: overrides.eventId || itemId,
    kind: 'codex',
    message: overrides.message || `Codex sub-agent ${kind}.`,
    created_at: overrides.createdAt || '2026-08-04T10:00:00.000Z',
    payload: {
      type: overrides.phase || 'item/completed',
      provider: 'codex',
      item: {
        type: 'subAgentActivity',
        id: itemId,
        kind,
        agentThreadId,
        agentPath: overrides.agentPath || '/root/codex_ui_worker',
      },
    },
  };
}

function codexAgentSpawn(agentThreadId, phase, overrides = {}) {
  return {
    id: overrides.eventId || `spawn-${phase}`,
    kind: 'codex',
    message: `Codex sub-agent spawn ${phase}.`,
    created_at: overrides.createdAt || '2026-08-04T09:59:59.000Z',
    payload: {
      type: `item/${phase}`,
      provider: 'codex',
      item: {
        type: 'collabAgentToolCall',
        id: overrides.itemId || 'spawn-codex-ui-worker',
        tool: 'spawnAgent',
        status: phase === 'completed' ? 'completed' : 'inProgress',
        senderThreadId: 'root-thread',
        receiverThreadIds: phase === 'completed' ? [agentThreadId] : [],
        prompt: 'Audit and implement the Codex sub-agent console.',
        model: 'gpt-test',
        reasoningEffort: 'high',
        agentsStates: phase === 'completed'
          ? { [agentThreadId]: { status: 'running', message: null } }
          : {},
        ...overrides.item,
      },
    },
  };
}

test('a backgrounded sub-agent stays active until its task notification arrives', () => {
  const launch = [
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'started', { eventId: 1 }),
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'completed', { eventId: 2 }),
  ];
  const working = groupEventEntries(launch);
  assert.equal(working.length, 1);
  assert.equal(isSubAgentEntry(working[0]), true);
  assert.equal(subAgentEntryState(working[0]), 'backgrounded');
  assert.equal(activeSubAgentCount(working), 1);
  assert.equal(eventStreamStats(working).agents, 1);

  const resolved = groupEventEntries([...launch, agentFinishedEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N')]);
  assert.equal(resolved.length, 1, 'the notification resolves the launch instead of adding a signal');
  assert.equal(resolved[0].events.length, 3);
  assert.equal(subAgentEntryState(resolved[0]), 'finished');
  assert.equal(activeSubAgentCount(resolved), 0);
});

test('Codex spawn and activity items fold into one named live sub-agent', () => {
  const agentThreadId = '019fcd5b-aaaa-7000-8000-000000000001';
  const entries = groupEventEntries([
    codexAgentSpawn(agentThreadId, 'started', { eventId: 1 }),
    codexAgentSpawn(agentThreadId, 'completed', { eventId: 2 }),
    codexAgentActivity(agentThreadId, 'started', { eventId: 3 }),
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].events.length, 3);
  assert.equal(isSubAgentEntry(entries[0]), true);
  assert.equal(subAgentEntryState(entries[0]), 'running');
  assert.equal(activeSubAgentCount(entries), 1);
  assert.deepEqual(subAgentEntryDetails(entries[0]), {
    provider: 'codex',
    name: 'codex_ui_worker',
    agentType: 'gpt-test / high',
    prompt: 'Audit and implement the Codex sub-agent console.',
    reportedStatus: 'running',
    statusLabel: 'Running',
    note: '',
    failed: false,
  });
  assert.equal(filterEventEntries(entries, 'highlights').length, 1);
  assert.equal(filterEventEntries(entries, 'commands').length, 1);
});

test('a Windows sub-agent path is named by its last segment, not by the whole path', () => {
  const agentThreadId = '019fcd5b-cccc-7000-8000-000000000003';
  const windows = groupEventEntries([
    codexAgentActivity(agentThreadId, 'started', {
      eventId: 1,
      agentPath: 'C:\\Users\\Pat\\.codex\\agents\\codex_ui_worker',
    }),
  ]);

  assert.equal(subAgentEntryDetails(windows[0]).name, 'codex_ui_worker');

  const posix = groupEventEntries([
    codexAgentActivity(agentThreadId, 'started', { eventId: 1, agentPath: '/root/codex_ui_worker' }),
  ]);
  assert.equal(subAgentEntryDetails(posix[0]).name, 'codex_ui_worker');
});

test('a Codex interaction keeps its matching sub-agent active', () => {
  const firstId = '019fcd5b-aaaa-7000-8000-000000000001';
  const secondId = '019fcd5b-bbbb-7000-8000-000000000002';
  const entries = groupEventEntries([
    codexAgentActivity(firstId, 'started', { eventId: 1, agentPath: '/root/first_worker' }),
    codexAgentActivity(secondId, 'started', { eventId: 2, agentPath: '/root/second_worker' }),
    codexAgentActivity(firstId, 'interacted', {
      eventId: 3,
      agentPath: '/root/first_worker',
      createdAt: '2026-08-04T10:05:00.000Z',
    }),
  ]);

  assert.equal(entries.length, 2);
  assert.equal(subAgentEntryDetails(entries[0]).name, 'first_worker');
  assert.equal(subAgentEntryState(entries[0]), 'running');
  assert.equal(subAgentEntryDetails(entries[0]).statusLabel, 'Running');
  assert.equal(subAgentEntryState(entries[1]), 'running');
  assert.equal(activeSubAgentCount(entries), 2);
  assert.equal(eventStreamStats(entries).agents, 2);
});

test('Codex wait state updates resolve each matching sub-agent independently', () => {
  const firstId = '019fcd5b-aaaa-7000-8000-000000000001';
  const secondId = '019fcd5b-bbbb-7000-8000-000000000002';
  const entries = groupEventEntries([
    codexAgentActivity(firstId, 'started', { eventId: 1, agentPath: '/root/first_worker' }),
    codexAgentActivity(secondId, 'started', { eventId: 2, agentPath: '/root/second_worker' }),
    codexAgentSpawn(firstId, 'completed', {
      eventId: 3,
      itemId: 'wait-for-workers',
      item: {
        tool: 'wait',
        receiverThreadIds: [firstId, secondId],
        agentsStates: {
          [firstId]: { status: 'completed', message: 'First worker finished.' },
          [secondId]: { status: 'running', message: null },
        },
      },
    }),
  ]);

  assert.equal(entries.length, 2);
  assert.equal(subAgentEntryState(entries[0]), 'finished');
  assert.equal(subAgentEntryDetails(entries[0]).statusLabel, 'Finished');
  assert.equal(subAgentEntryDetails(entries[0]).note, 'First worker finished.');
  assert.equal(subAgentEntryState(entries[1]), 'running');
  assert.equal(activeSubAgentCount(entries), 1);
});

test('Codex interrupted agents are finished and counted as attention', () => {
  const agentThreadId = '019fcd5b-aaaa-7000-8000-000000000001';
  const entries = groupEventEntries([
    codexAgentActivity(agentThreadId, 'started', { eventId: 1 }),
    codexAgentActivity(agentThreadId, 'interrupted', { eventId: 2 }),
  ]);

  assert.equal(subAgentEntryState(entries[0]), 'finished');
  assert.equal(subAgentEntryDetails(entries[0]).statusLabel, 'Interrupted');
  assert.equal(subAgentEntryDetails(entries[0]).failed, true);
  assert.equal(activeSubAgentCount(entries), 0);
  assert.equal(eventStreamStats(entries).errors, 1);
});

test('Codex activity after an interruption does not invent a resume', () => {
  const agentThreadId = '019fcd5b-aaaa-7000-8000-000000000001';
  const entries = groupEventEntries([
    codexAgentActivity(agentThreadId, 'started', { eventId: 1 }),
    codexAgentActivity(agentThreadId, 'interacted', { eventId: 2 }),
    codexAgentActivity(agentThreadId, 'interrupted', { eventId: 3 }),
    codexAgentActivity(agentThreadId, 'interacted', { eventId: 4 }),
  ]);

  assert.equal(subAgentEntryState(entries[0]), 'finished');
  assert.equal(subAgentEntryDetails(entries[0]).statusLabel, 'Interrupted');
  assert.equal(activeSubAgentCount(entries), 0);
});

test('a task notification recorded before its own launch still folds into one signal', () => {
  // Claude appends the notification out of order; task 320 recorded exactly this sequence.
  const entries = groupEventEntries([
    agentFinishedEvent('toolu_012M2JjykSAMBUw7JewJMYeX', { eventId: 1 }),
    subAgentEvent('toolu_012M2JjykSAMBUw7JewJMYeX', 'started', { eventId: 2 }),
    subAgentEvent('toolu_012M2JjykSAMBUw7JewJMYeX', 'completed', { eventId: 3 }),
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entryItem(entries[0]).agentName, 'dev-1: editor layout rework');
  assert.equal(subAgentEntryState(entries[0]), 'finished');
  assert.equal(activeSubAgentCount(entries), 0);
});

test('a notification for a launch this stream never saw keeps its own signal', () => {
  // A resumed agent reports through the SendMessage tool use that woke it.
  const entries = groupEventEntries([
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'started', { eventId: 1 }),
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'completed', { eventId: 2 }),
    agentFinishedEvent('toolu_01GL9D1R3PPMn2Vh2NHRERXA', { eventId: 3 }),
  ]);

  assert.equal(entries.length, 2);
  assert.equal(isSubAgentEntry(entries[1]), true);
  assert.equal(subAgentEntryState(entries[1]), 'finished');
  // The orphan notification never resolves the unrelated launch, which is still working.
  assert.equal(activeSubAgentCount(entries), 1);
});

test('Claude background command notifications do not masquerade as sub-agents', () => {
  const event = agentFinishedEvent('toolu_background_command', { eventId: 1 });
  event.message = 'Background command "Production build" completed (exit code 0)';
  event.payload.agentName = '';
  event.payload.summary = event.message;
  const entries = groupEventEntries([event]);

  assert.equal(entries.length, 1);
  assert.equal(isSubAgentEntry(entries[0]), false);
  assert.equal(activeSubAgentCount(entries), 0);
  assert.equal(filterEventEntries(entries, 'messages').length, 1);
});

test('the active sub-agent count never goes negative', () => {
  const strayFinishes = groupEventEntries([
    agentFinishedEvent('toolu_01GL9D1R3PPMn2Vh2NHRERXA', { eventId: 1 }),
    agentFinishedEvent('toolu_01HRJZ5EyCSjqw1WoiKsgBoi', { eventId: 2 }),
    agentFinishedEvent('toolu_01CGSVLPYFeYywpEi2Tze2bi', { eventId: 3 }),
  ]);
  assert.equal(activeSubAgentCount(strayFinishes), 0);
  assert.equal(eventStreamStats(strayFinishes).agents, 0);

  const repeated = groupEventEntries([
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'started', { eventId: 1 }),
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'completed', { eventId: 2 }),
    agentFinishedEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', { eventId: 3 }),
    agentFinishedEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', { eventId: 4 }),
  ]);
  assert.equal(activeSubAgentCount(repeated), 0);
  assert.equal(groupEventEntries([]).length, 0);
  assert.equal(activeSubAgentCount(undefined), 0);
});

test('a finished turn owns no live sub-agents', () => {
  const entries = groupEventEntries([
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'started', { eventId: 1 }),
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'completed', { eventId: 2 }),
  ]);

  assert.equal(activeSubAgentCount(entries), 1);
  assert.equal(activeSubAgentCount(entries, { turnEnded: true }), 0);
  assert.equal(eventStreamStats(entries, { turnEnded: true }).agents, 0);
});

test('a sub-agent that answers inline finishes with its tool call', () => {
  const entries = groupEventEntries([
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'started', { eventId: 1 }),
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'completed', {
      eventId: 2,
      item: { backgrounded: false, agentId: undefined },
    }),
  ]);

  assert.equal(subAgentEntryState(entries[0]), 'finished');
  assert.equal(activeSubAgentCount(entries), 0);
});

test('a sub-agent whose launch failed is not counted as working', () => {
  const entries = groupEventEntries([
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'started', { eventId: 1 }),
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'completed', {
      eventId: 2,
      item: { status: 'failed', backgrounded: undefined },
    }),
  ]);

  assert.equal(subAgentEntryState(entries[0]), 'finished');
  assert.equal(activeSubAgentCount(entries), 0);
  assert.equal(eventStreamStats(entries).errors, 1);
});

test('sub-agent signals stay in the Highlights and Commands views', () => {
  const entries = groupEventEntries([
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'started', { eventId: 1 }),
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'completed', { eventId: 2 }),
    agentFinishedEvent('toolu_01GL9D1R3PPMn2Vh2NHRERXA', { eventId: 3 }),
  ]);

  assert.equal(filterEventEntries(entries, 'highlights').length, 2);
  assert.equal(filterEventEntries(entries, 'commands').length, 1);
  assert.equal(filterEventEntries(entries, 'all').length, 2);
});

test('legacy Agent tool calls without sub-agent metadata behave exactly as before', () => {
  const legacyStarted = subAgentEvent('toolu_legacy', 'started', { eventId: 1 });
  const legacyCompleted = subAgentEvent('toolu_legacy', 'completed', { eventId: 2 });
  for (const event of [legacyStarted, legacyCompleted]) {
    delete event.payload.item.subAgent;
    delete event.payload.item.toolUseId;
    delete event.payload.item.agentName;
    delete event.payload.item.agentType;
    delete event.payload.item.backgrounded;
    delete event.payload.item.agentId;
  }
  const entries = groupEventEntries([
    legacyStarted,
    legacyCompleted,
    agentFinishedEvent('toolu_legacy', { eventId: 3 }),
  ]);

  assert.equal(isSubAgentEntry(entries[0]), false);
  assert.equal(entries[0].events.length, 2, 'a legacy tool call is never folded');
  assert.equal(entries.length, 2);
  assert.equal(eventStreamStats(entries).agents, 0);
  assert.equal(filterEventEntries(entries, 'commands').length, 1);
});

test('event stream folds streamed reasoning summaries into one All entry', () => {
  const started = itemEvent('reasoning-live', 'started', 'reasoning');
  const first = itemEvent('reasoning-live', 'updated', 'reasoning', {
    eventId: 2,
    item: { summary: [{ text: 'Inspecting the queue' }], status: 'inProgress' },
  });
  const second = itemEvent('reasoning-live', 'updated', 'reasoning', {
    eventId: 3,
    item: { summary: [{ text: 'Inspecting the queue and terminal bridge.' }], status: 'inProgress' },
  });
  const entries = groupEventEntries([started, first, second]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].events.length, 3);
  assert.equal(entryItem(entries[0]).summary[0].text, 'Inspecting the queue and terminal bridge.');
  assert.equal(filterEventEntries(entries, 'highlights').length, 0);
  assert.equal(filterEventEntries(entries, 'all').length, 1);
});

test('thinking summaries are visible by default and can be removed from any event view', () => {
  const entries = groupEventEntries([
    itemEvent('reasoning-visibility', 'completed', 'reasoning', {
      eventId: 1,
      item: { summary: [{ text: 'Checking the requested behavior.' }] },
    }),
    itemEvent('command-visibility', 'completed', 'commandExecution', { eventId: 2 }),
  ]);

  assert.equal(filterEventEntries(entries, 'all').length, 2);
  assert.deepEqual(
    filterEventEntries(entries, 'all', { showThinking: false })
      .map((entry) => entryItem(entry)?.type),
    ['commandExecution'],
  );
  assert.equal(filterEventEntries(entries, 'highlights', { showThinking: false }).length, 1);
});

test('OpenCode reasoning stays toggleable telemetry instead of an AI response', () => {
  const event = itemEvent('opencode-reasoning', 'completed', 'reasoning', {
    kind: 'opencode',
    item: {
      status: 'completed',
      summary: [{ text: 'Checking the native OpenCode response.' }],
    },
  });
  event.payload.provider = 'opencode';
  const entries = groupEventEntries([event]);

  assert.equal(entries.length, 1);
  assert.equal(eventEntryCategory(entries[0]), 'system');
  assert.equal(eventStreamStats(entries).messages, 0);
  assert.equal(filterEventEntries(entries, 'all').length, 1);
  assert.equal(filterEventEntries(entries, 'all', { showThinking: false }).length, 0);
  assert.equal(filterEventEntries(entries, 'highlights').length, 0);
});

/* Plan checklist and Codex goal ----------------------------------------------
   Plan events carry no `payload.item.id`, so without a dedicated fold every
   revision would land in the generic `event-<id>` branch and the scrollback
   would fill with duplicate plans. */

function codexPlanEvent(planKey, plan, overrides = {}) {
  return {
    id: overrides.eventId || 1,
    kind: overrides.kind || 'codex',
    message: overrides.message || 'Updated plan.',
    created_at: overrides.createdAt || '2026-08-12T09:00:00.000Z',
    payload: {
      type: 'turn/plan/updated',
      threadId: overrides.threadId || 'thread-a1b2c3',
      turnId: overrides.turnId || 'turn-0001',
      planKey,
      explanation: overrides.explanation ?? 'Working through the queue repair.',
      plan,
    },
  };
}

function claudePlanEvent(planKey, plan, overrides = {}) {
  return {
    id: overrides.eventId || 1,
    kind: overrides.kind || 'claude',
    message: overrides.message || 'Updated plan.',
    created_at: overrides.createdAt || '2026-08-12T09:00:00.000Z',
    payload: {
      type: 'claude/plan',
      planKey,
      explanation: overrides.explanation ?? 'Working through the queue repair.',
      plan,
      // `src/claude-execution-runner.mjs` writes the flag only when it is true, so a test that
      // never asks for it produces the exact payload an ordinary whole revision has.
      ...(overrides.partial ? { partial: true } : {}),
    },
  };
}

// A revision the runner could not vouch for whole: this turn's own steps and no more.
function claudePartialPlanEvent(planKey, plan, overrides = {}) {
  return claudePlanEvent(planKey, plan, { ...overrides, partial: true });
}

function goalEvent(overrides = {}) {
  return {
    id: overrides.eventId || 1,
    kind: 'codex',
    message: 'Goal updated.',
    created_at: overrides.createdAt || '2026-08-12T09:00:00.000Z',
    payload: {
      type: 'thread/goal/updated',
      threadId: overrides.threadId || 'thread-a1b2c3',
      turnId: overrides.turnId || 'turn-0001',
      goal: {
        objective: 'Ship the plan visibility work',
        status: 'active',
        tokenBudget: 250_000,
        tokensUsed: 41_500,
        timeUsedSeconds: 903,
        createdAt: '2026-08-12T08:30:00.000Z',
        updatedAt: '2026-08-12T09:00:00.000Z',
        ...overrides.goal,
      },
    },
  };
}

function goalClearedEvent(overrides = {}) {
  return {
    id: overrides.eventId || 2,
    kind: 'codex',
    message: 'Goal cleared.',
    created_at: overrides.createdAt || '2026-08-12T09:05:00.000Z',
    payload: {
      type: 'thread/goal/cleared',
      threadId: overrides.threadId || 'thread-a1b2c3',
    },
  };
}

test('repeated plan revisions fold into one entry that reflects the latest plan', () => {
  const entries = groupEventEntries([
    codexPlanEvent('plan-turn-1', [
      { step: 'Read the queue module', status: 'inProgress' },
      { step: 'Repair the fold', status: 'pending' },
      { step: 'Cover it with tests', status: 'pending' },
    ], { eventId: 1 }),
    codexPlanEvent('plan-turn-1', [
      { step: 'Read the queue module', status: 'completed' },
      { step: 'Repair the fold', status: 'inProgress' },
      { step: 'Cover it with tests', status: 'pending' },
    ], { eventId: 2, createdAt: '2026-08-12T09:01:00.000Z', explanation: 'Fold repaired next.' }),
  ]);

  assert.equal(entries.length, 1, 'every revision folds into one plan row');
  assert.equal(entries[0].id, 'plan-plan-turn-1');
  assert.equal(entries[0].events.length, 2);
  assert.equal(entryFirstEvent(entries[0]).id, 1);
  assert.equal(entryLastEvent(entries[0]).id, 2);
  assert.equal(entryItem(entries[0]), null, 'a plan notification carries no thread item');

  const details = planEntryDetails(entries[0]);
  assert.equal(details.explanation, 'Fold repaired next.');
  assert.equal(details.total, 3);
  assert.equal(details.done, 1);
  assert.equal(details.inProgress, 1);
  assert.equal(details.current, 'Repair the fold');
  assert.deepEqual(details.steps.map((step) => step.status), ['completed', 'inProgress', 'pending']);
});

test('two plan keys in one task keep their own rows and first-seen order', () => {
  const entries = groupEventEntries([
    codexPlanEvent('plan-turn-1', [{ step: 'First turn work', status: 'completed' }], { eventId: 1 }),
    codexPlanEvent('plan-turn-2', [{ step: 'Second turn work', status: 'inProgress' }], {
      eventId: 2,
      turnId: 'turn-0002',
    }),
    codexPlanEvent('plan-turn-1', [{ step: 'First turn work', status: 'completed' }], { eventId: 3 }),
  ]);

  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.id), ['plan-plan-turn-1', 'plan-plan-turn-2']);
  assert.equal(planEntryDetails(entries[1]).current, 'Second turn work');
});

test('a Claude plan and a Codex plan normalize through the same neutral shape', () => {
  const [codex] = groupEventEntries([
    codexPlanEvent('codex-key', [{ step: 'Shared step', status: 'inProgress' }]),
  ]);
  const [claude] = groupEventEntries([
    claudePlanEvent('claude-key', [{ step: 'Shared step', status: 'inProgress', owner: 'dev-3' }]),
  ]);

  const codexDetails = planEntryDetails(codex);
  const claudeDetails = planEntryDetails(claude);
  assert.equal(codexDetails.provider, 'codex');
  assert.equal(claudeDetails.provider, 'claude');
  assert.deepEqual(
    { ...codexDetails, provider: null, planKey: null },
    { ...claudeDetails, provider: null, planKey: null, steps: codexDetails.steps },
  );
  // owner is Claude-only and normalizes to an empty string for Codex.
  assert.equal(codexDetails.steps[0].owner, '');
  assert.equal(claudeDetails.steps[0].owner, 'dev-3');
});

test('an unknown step status degrades to pending instead of vanishing', () => {
  const [entry] = groupEventEntries([
    codexPlanEvent('plan-turn-1', [{ step: 'Mystery step', status: 'somethingElse' }, { step: '', status: 'pending' }]),
  ]);
  const details = planEntryDetails(entry);
  assert.equal(details.total, 2);
  assert.equal(details.steps[0].status, 'pending');
  assert.equal(details.done, 0);
});

test('plan and goal rows are system category and survive the Highlights filter', () => {
  const entries = groupEventEntries([
    codexPlanEvent('plan-turn-1', [{ step: 'Codex step', status: 'pending' }], { eventId: 1 }),
    claudePlanEvent('claude-turn-1', [{ step: 'Claude step', status: 'pending' }], { eventId: 2 }),
    goalEvent({ eventId: 3 }),
  ]);

  assert.equal(entries.length, 3);
  for (const entry of entries) {
    assert.equal(eventEntryCategory(entry), 'system');
    assert.equal(isEventEntryHighlight(entry), true);
  }
  assert.equal(filterEventEntries(entries, 'highlights').length, 3);
  assert.equal(filterEventEntries(entries, 'commands').length, 0);
  // A Claude plan event is recorded with kind 'claude'; it must never file under Messages.
  assert.equal(filterEventEntries(entries, 'messages').length, 0);
});

test('plan progress joins the stats without disturbing the other counts', () => {
  const entries = groupEventEntries([
    itemEvent('command-1', 'started', 'commandExecution', { eventId: 1 }),
    itemEvent('command-1', 'completed', 'commandExecution', { eventId: 2 }),
    itemEvent('files-1', 'completed', 'fileChange', { eventId: 3 }),
    itemEvent('message-1', 'completed', 'agentMessage', { eventId: 4 }),
    claudePlanEvent('claude-turn-1', [
      { step: 'Done work', status: 'completed' },
      { step: 'Live work', status: 'inProgress' },
      { step: 'Later work', status: 'pending' },
      { step: 'Even later work', status: 'pending' },
      { step: 'Last work', status: 'pending' },
    ], { eventId: 5 }),
    goalEvent({ eventId: 6 }),
  ]);

  assert.deepEqual(eventStreamStats(entries), {
    commands: 1,
    files: 1,
    messages: 1,
    errors: 0,
    running: 0,
    thinkingTokens: 0,
    agents: 0,
    plan: { total: 5, done: 1, inProgress: 1 },
  });
});

test('a live plan never inflates the active-work or message counts', () => {
  const entries = groupEventEntries([
    claudePlanEvent('claude-turn-1', [{ step: 'Live work', status: 'inProgress' }], { eventId: 1 }),
    claudePlanEvent('claude-turn-1', [{ step: 'Live work', status: 'inProgress' }], { eventId: 2 }),
  ]);

  assert.equal(entries[0].startedEvent, null, 'a plan row is never an open signal');
  const stats = eventStreamStats(entries);
  assert.equal(stats.running, 0);
  assert.equal(stats.messages, 0);
  assert.equal(stats.errors, 0);
  assert.deepEqual(stats.plan, { total: 1, done: 0, inProgress: 1 });
});

test('a step whose text reads like a failure never turns the stats red', () => {
  const entries = groupEventEntries([
    codexPlanEvent('plan-turn-1', [{ step: 'Reproduce the cancelled retry error', status: 'inProgress' }], {
      message: 'Updated plan: reproduce the cancelled retry error.',
    }),
  ]);
  assert.equal(eventStreamStats(entries).errors, 0);
});

test('the newest plan owns the stats tile when a task ran several turns', () => {
  const entries = groupEventEntries([
    codexPlanEvent('plan-turn-1', [
      { step: 'Turn one work', status: 'completed' },
      { step: 'Turn one follow-up', status: 'completed' },
    ], { eventId: 1 }),
    codexPlanEvent('plan-turn-2', [
      { step: 'Turn two work', status: 'inProgress' },
      { step: 'Turn two follow-up', status: 'pending' },
      { step: 'Turn two review', status: 'pending' },
    ], { eventId: 2, turnId: 'turn-0002' }),
  ]);
  assert.deepEqual(eventStreamStats(entries).plan, { total: 3, done: 0, inProgress: 1 });
});

test('the plan tile follows the newest revision, not the oldest row position', () => {
  /*
   * A Claude plan folds on a session-scoped key, so its row is created once and never moves.
   * A Codex turn that starts later appends its row after it. Reading the stats in entry order
   * would then report the Codex plan even while the Claude plan is the one still being
   * revised, so the tile follows the most recently written plan event instead.
   */
  const entries = groupEventEntries([
    claudePlanEvent('session-8f21a0c4', [
      { step: 'Claude step one', status: 'inProgress' },
      { step: 'Claude step two', status: 'pending' },
    ], { eventId: 1 }),
    codexPlanEvent('plan-turn-9', [
      { step: 'Codex step one', status: 'completed' },
      { step: 'Codex step two', status: 'completed' },
      { step: 'Codex step three', status: 'completed' },
    ], { eventId: 2, turnId: 'turn-0009' }),
    claudePlanEvent('session-8f21a0c4', [
      { step: 'Claude step one', status: 'completed' },
      { step: 'Claude step two', status: 'inProgress' },
    ], { eventId: 3 }),
  ]);

  assert.deepEqual(entries.map((entry) => entry.id), ['plan-session-8f21a0c4', 'plan-plan-turn-9']);
  assert.deepEqual(eventStreamStats(entries).plan, { total: 2, done: 1, inProgress: 1 });
});

/* A partial Claude revision never shrinks the board -------------------------------
   `src/claude-execution-runner.mjs` marks a revision `partial: true` when it has no readable
   board mirror and its own fold is not known to be whole: the payload is that turn's steps and
   no more. Folding last-write-wins on such a revision would replace the operator's board with
   a knowingly smaller one and drop the tile with it, so the fold layers instead. */

test('a partial revision layers onto the fuller board instead of replacing it', () => {
  const entries = groupEventEntries([
    claudePlanEvent('session-8f21a0c4', [
      { step: 'Land the backend', status: 'completed' },
      { step: 'Land the renderer', status: 'inProgress' },
      { step: 'Cover it with tests', status: 'pending' },
    ], { eventId: 1 }),
    claudePartialPlanEvent('session-8f21a0c4', [
      { step: 'Land the renderer', status: 'completed' },
    ], { eventId: 2, createdAt: '2026-08-12T09:05:00.000Z' }),
  ]);

  assert.equal(entries.length, 1, 'a partial revision still folds into the same row');
  const details = planEntryDetails(entries[0]);
  assert.equal(details.partial, true);
  assert.equal(details.total, 3, 'the fuller board is what the row still carries');
  assert.deepEqual(details.steps.map((step) => step.step), [
    'Land the backend',
    'Land the renderer',
    'Cover it with tests',
  ]);
  // The movement the partial revision reported is exactly what changed.
  assert.deepEqual(details.steps.map((step) => step.status), ['completed', 'completed', 'pending']);
  assert.equal(details.done, 2);
  assert.equal(details.inProgress, 0);
  assert.equal(details.current, '');
});

test('a step only the partial revision knows is added, never dropped', () => {
  const entries = groupEventEntries([
    claudePlanEvent('session-8f21a0c4', [
      { step: 'Land the backend', status: 'completed' },
      { step: 'Land the renderer', status: 'pending' },
    ], { eventId: 1 }),
    claudePartialPlanEvent('session-8f21a0c4', [
      { step: 'Land the renderer', status: 'completed' },
      { step: 'Write the release note', status: 'inProgress', owner: 'dev-9' },
    ], { eventId: 2 }),
  ]);

  const details = planEntryDetails(entries[0]);
  assert.equal(details.total, 3);
  assert.deepEqual(details.steps.map((step) => step.step), [
    'Land the backend',
    'Land the renderer',
    'Write the release note',
  ]);
  assert.equal(details.steps[2].status, 'inProgress');
  assert.equal(details.steps[2].owner, 'dev-9');
  assert.equal(details.done, 2);
  assert.equal(details.current, 'Write the release note');
});

test('every partial revision since the last whole board layers in order', () => {
  const entries = groupEventEntries([
    claudePlanEvent('session-8f21a0c4', [
      { step: 'Land the backend', status: 'inProgress' },
      { step: 'Land the renderer', status: 'pending' },
      { step: 'Cover it with tests', status: 'pending' },
    ], { eventId: 1 }),
    claudePartialPlanEvent('session-8f21a0c4', [{ step: 'Land the backend', status: 'completed' }], { eventId: 2 }),
    claudePartialPlanEvent('session-8f21a0c4', [{ step: 'Land the renderer', status: 'inProgress' }], { eventId: 3 }),
  ]);

  const details = planEntryDetails(entries[0]);
  // The completion the second turn reported survives the third turn, which never mentioned it.
  assert.deepEqual(details.steps.map((step) => step.status), ['completed', 'inProgress', 'pending']);
  assert.equal(details.done, 1);
  assert.equal(details.current, 'Land the renderer');
});

test('two partial turns can each leave a step in progress and board order decides the current one', () => {
  /*
   * Neither partial turn can speak for the other turn's steps, so nothing here is entitled to
   * clear the first in-progress step. Both are reported and the row reads the board in its own
   * order rather than in arrival order, which is the reading the checklist draws.
   */
  const entries = groupEventEntries([
    claudePlanEvent('session-8f21a0c4', [
      { step: 'Land the backend', status: 'inProgress' },
      { step: 'Land the renderer', status: 'pending' },
    ], { eventId: 1 }),
    claudePartialPlanEvent('session-8f21a0c4', [{ step: 'Land the renderer', status: 'inProgress' }], { eventId: 2 }),
  ]);

  const details = planEntryDetails(entries[0]);
  assert.equal(details.inProgress, 2);
  assert.equal(details.current, 'Land the backend');
  assert.equal(details.total, 2);
});

test('a whole revision after a partial one replaces the board outright', () => {
  const entries = groupEventEntries([
    claudePlanEvent('session-8f21a0c4', [
      { step: 'Dropped step one', status: 'completed' },
      { step: 'Dropped step two', status: 'completed' },
      { step: 'Dropped step three', status: 'inProgress' },
    ], { eventId: 1 }),
    claudePartialPlanEvent('session-8f21a0c4', [{ step: 'Dropped step three', status: 'completed' }], { eventId: 2 }),
    claudePlanEvent('session-8f21a0c4', [
      { step: 'The board the mirror actually holds', status: 'inProgress' },
      { step: 'Its only other step', status: 'pending' },
    ], { eventId: 3 }),
  ]);

  const details = planEntryDetails(entries[0]);
  assert.equal(details.partial, false, 'a readable whole board ends the partial reading');
  assert.equal(details.total, 2, 'a whole revision is the whole truth and may shrink the row');
  assert.deepEqual(details.steps.map((step) => step.step), [
    'The board the mirror actually holds',
    'Its only other step',
  ]);
});

test('a partial revision with no fuller board behind it reports exactly what it carries', () => {
  const entries = groupEventEntries([
    claudePartialPlanEvent('session-8f21a0c4', [
      { step: 'The only step this turn knows', status: 'inProgress' },
    ], { eventId: 1 }),
  ]);

  const details = planEntryDetails(entries[0]);
  assert.equal(details.partial, true, 'there is nothing fuller to keep, and the row still says so');
  assert.equal(details.total, 1);
  assert.equal(details.current, 'The only step this turn knows');
});

test('a Codex fold is untouched by the layering and never reads as partial', () => {
  const entries = groupEventEntries([
    codexPlanEvent('plan-turn-1', [
      { step: 'Codex step one', status: 'completed' },
      { step: 'Codex step two', status: 'inProgress' },
      { step: 'Codex step three', status: 'pending' },
    ], { eventId: 1 }),
    // Codex never sends `partial`, so a shorter revision is the whole new plan and replaces
    // the row exactly as it always did.
    codexPlanEvent('plan-turn-1', [{ step: 'Codex replanned', status: 'inProgress' }], { eventId: 2 }),
  ]);

  const details = planEntryDetails(entries[0]);
  assert.equal(details.partial, false);
  assert.equal(details.total, 1);
  assert.deepEqual(details.steps.map((step) => step.step), ['Codex replanned']);
});

test('the plan tile keeps the fuller board when the newest revision is partial', () => {
  const entries = groupEventEntries([
    claudePlanEvent('session-8f21a0c4', [
      { step: 'Land the backend', status: 'completed' },
      { step: 'Land the renderer', status: 'inProgress' },
      { step: 'Cover it with tests', status: 'pending' },
    ], { eventId: 1 }),
    claudePartialPlanEvent('session-8f21a0c4', [{ step: 'Land the renderer', status: 'completed' }], { eventId: 2 }),
  ]);

  // The tile reads the same fold the row does, so it must not drop from three steps to one.
  assert.deepEqual(eventStreamStats(entries).plan, { total: 3, done: 2, inProgress: 0 });
});

test('goal notifications fold by thread and a cleared goal resolves the row', () => {
  const entries = groupEventEntries([
    goalEvent({ eventId: 1 }),
    goalEvent({ eventId: 2, goal: { status: 'blocked', tokensUsed: 60_000 } }),
    goalClearedEvent({ eventId: 3 }),
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'goal-thread-a1b2c3');
  assert.equal(isGoalEntry(entries[0]), true);
  assert.equal(isPlanEntry(entries[0]), false);
  assert.equal(entries[0].completedEvent.id, 3, 'the cleared event resolves the row');

  const details = goalEntryDetails(entries[0]);
  assert.equal(details.cleared, true);
  assert.equal(details.status, 'cleared');
  assert.equal(details.statusLabel, 'Cleared');
  // The last known objective survives the clear so the row keeps its meaning.
  assert.equal(details.objective, 'Ship the plan visibility work');
  assert.equal(details.tokensUsed, 60_000);
});

test('goal usage details are always real, non-negative numbers', () => {
  // src/codex-app-server.mjs reports an absent budget, token count, or elapsed time as null.
  // goalEntryDetails is the contract the renderer consumes, so the clamp lives here too and
  // is not left to the presentation layer alone.
  const [nulled] = groupEventEntries([goalEvent({
    eventId: 1,
    goal: { tokenBudget: null, tokensUsed: null, timeUsedSeconds: null },
  })]);
  assert.deepEqual(
    [goalEntryDetails(nulled).tokenBudget, goalEntryDetails(nulled).tokensUsed, goalEntryDetails(nulled).timeUsedSeconds],
    [0, 0, 0],
  );

  const [bare] = groupEventEntries([{
    id: 2,
    kind: 'codex',
    message: 'Goal updated.',
    created_at: '2026-08-12T09:00:00.000Z',
    payload: { type: 'thread/goal/updated', threadId: 'thread-a1b2c3', goal: { objective: 'Ship it' } },
  }]);
  const bareDetails = goalEntryDetails(bare);
  assert.equal(bareDetails.tokensUsed, 0);
  assert.equal(Number.isFinite(bareDetails.tokensUsed), true);
  assert.equal(bareDetails.statusLabel, 'Recorded');

  const [nonsense] = groupEventEntries([goalEvent({
    eventId: 3,
    goal: { tokenBudget: -1, tokensUsed: 'lots', timeUsedSeconds: Number.POSITIVE_INFINITY },
  })]);
  const nonsenseDetails = goalEntryDetails(nonsense);
  assert.deepEqual(
    [nonsenseDetails.tokenBudget, nonsenseDetails.tokensUsed, nonsenseDetails.timeUsedSeconds],
    [0, 0, 0],
  );
});

test('a goal set again after a clear reopens its row', () => {
  const entries = groupEventEntries([
    goalEvent({ eventId: 1 }),
    goalClearedEvent({ eventId: 2 }),
    goalEvent({ eventId: 3, goal: { objective: 'Finish the release gates', status: 'usageLimited' } }),
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].completedEvent, null);
  const details = goalEntryDetails(entries[0]);
  assert.equal(details.cleared, false);
  assert.equal(details.objective, 'Finish the release gates');
  assert.equal(details.statusLabel, 'Usage limited');
});

test('a task that never recorded a goal has no goal entry at all', () => {
  const entries = groupEventEntries([
    itemEvent('command-1', 'completed', 'commandExecution', { eventId: 1 }),
    codexPlanEvent('plan-turn-1', [{ step: 'Only a plan', status: 'pending' }], { eventId: 2 }),
  ]);

  assert.equal(entries.some(isGoalEntry), false);
  assert.equal(goalEntryDetails(entries[0]), null);
  assert.equal(goalEntryDetails(entries[1]), null);
  assert.equal(planEntryDetails(entries[0]), null);
});

test('a plan or goal row never adopts a thread item, even if one rides along', () => {
  // The row is defined by its payload, not by an item. A stray item would otherwise reach
  // the command classifier through entryItem and file the plan under Commands.
  const plan = codexPlanEvent('plan-turn-1', [{ step: 'Only step', status: 'pending' }]);
  plan.payload.item = { id: 'command-9', type: 'commandExecution', command: 'rm -rf .data' };
  const goal = goalEvent({ eventId: 2 });
  goal.payload.item = { id: 'command-8', type: 'commandExecution', command: 'echo hi' };

  const entries = groupEventEntries([plan, goal]);
  assert.equal(entries.length, 2);
  assert.equal(entryItem(entries[0]), null);
  assert.equal(entryItem(entries[1]), null);
  assert.equal(eventEntryCategory(entries[0]), 'system');
  assert.equal(eventEntryCategory(entries[1]), 'system');
  assert.equal(eventStreamStats(entries).commands, 0);
});

test('the plan and goal guards keep those rows in Highlights ahead of the quiet check', () => {
  /*
   * These two entries are built by hand, not by groupEventEntries. A grouped plan row never
   * carries a thread item, so every later check in isEventEntryHighlight misses it and the
   * permissive fallthrough returns true on its own: a test built from a grouped row passes
   * exactly as happily with the guard deleted, and proves nothing. A row that is a plan by
   * its fold key while a quiet item rides along in its events is the case that tells the
   * guard apart from the fallthrough.
   */
  const planWithQuietItem = {
    id: 'plan-plan-turn-1',
    planKey: 'plan-turn-1',
    events: [{
      id: 1,
      kind: 'claude',
      created_at: '2026-08-12T09:00:00.000Z',
      payload: { type: 'item/completed', item: { id: 'reason-1', type: 'reasoning' } },
    }],
  };
  const goalWithQuietItem = {
    id: 'goal-thread-a1b2c3',
    goalThreadId: 'thread-a1b2c3',
    events: [{
      id: 2,
      kind: 'codex',
      created_at: '2026-08-12T09:00:00.000Z',
      payload: { type: 'item/completed', item: { id: 'prompt-1', type: 'userMessage' } },
    }],
  };
  assert.equal(entryItem(planWithQuietItem)?.type, 'reasoning', 'the quiet item is reachable');
  assert.equal(entryItem(goalWithQuietItem)?.type, 'userMessage', 'the quiet item is reachable');
  assert.equal(isPlanEntry(planWithQuietItem), true);
  assert.equal(isGoalEntry(goalWithQuietItem), true);
  assert.equal(isEventEntryHighlight(planWithQuietItem), true, 'the plan guard runs before the quiet check');
  assert.equal(isEventEntryHighlight(goalWithQuietItem), true, 'the goal guard runs before the quiet check');
  assert.equal(filterEventEntries([planWithQuietItem, goalWithQuietItem], 'highlights').length, 2);

  // The fallthrough is genuinely permissive: unrecognized protocol noise is what it drops.
  const noise = groupEventEntries([{
    id: 1,
    kind: 'codex',
    message: 'Turn started.',
    created_at: '2026-08-12T09:00:00.000Z',
    payload: { type: 'turn/started' },
  }]);
  assert.equal(isEventEntryHighlight(noise[0]), false);

  const rows = groupEventEntries([
    codexPlanEvent('plan-turn-1', [{ step: 'Only step', status: 'pending' }], { eventId: 2 }),
    goalClearedEvent({ eventId: 3 }),
  ]);
  assert.equal(isEventEntryHighlight(rows[0]), true);
  assert.equal(isEventEntryHighlight(rows[1]), true, 'a cleared goal is still worth showing');
  assert.equal(filterEventEntries(rows, 'highlights').length, 2);
});

test('a plan event with no planKey keeps its own row instead of collapsing the task', () => {
  const first = codexPlanEvent('', [{ step: 'A', status: 'pending' }], { eventId: 7 });
  const second = codexPlanEvent('', [{ step: 'B', status: 'pending' }], { eventId: 8 });
  delete first.payload.planKey;
  delete second.payload.planKey;
  delete first.payload.turnId;
  delete second.payload.turnId;

  const entries = groupEventEntries([first, second]);
  // The threadId is the next-best fold key; two turns on one thread still share a row only
  // when the backend omitted both keys, which never collapses unrelated threads together.
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'plan-thread-a1b2c3');

  delete first.payload.threadId;
  delete second.payload.threadId;
  const unkeyed = groupEventEntries([first, second]);
  assert.equal(unkeyed.length, 2, 'a completely unkeyed plan never folds into a stranger');
});

function goalTurnEndedEvent(overrides = {}) {
  return {
    id: overrides.eventId || 2,
    kind: 'codex',
    message: 'Goal recorded at turn end.',
    created_at: overrides.createdAt || '2026-08-12T09:10:00.000Z',
    payload: {
      type: 'thread/goal/updated',
      threadId: overrides.threadId || 'thread-a1b2c3',
      ...(overrides.nested ? {} : { turnEnded: true }),
      goal: {
        objective: 'Ship the plan visibility work',
        status: 'active',
        ...(overrides.nested ? { turnEnded: true } : {}),
        ...overrides.goal,
      },
    },
  };
}

function planToolEvent(itemId, phase, toolName, overrides = {}) {
  return {
    id: overrides.eventId || itemId,
    kind: 'claude',
    message: `Claude ${toolName} ${phase}.`,
    created_at: overrides.createdAt || '2026-08-12T09:00:00.000Z',
    payload: {
      type: `item/${phase}`,
      provider: 'claude',
      item: {
        type: 'mcpToolCall',
        id: itemId,
        server: 'Claude Code',
        tool: toolName,
        arguments: { title: 'Land the renderer half' },
        status: overrides.status || (phase === 'completed' ? 'completed' : 'inProgress'),
        result: null,
        planTool: true,
        planToolName: toolName,
      },
    },
  };
}

test('a goal carries no turn-ended signal until a turn-final record says so', () => {
  const [live] = groupEventEntries([goalEvent({ eventId: 1 })]);
  assert.equal(goalEntryDetails(live).turnEnded, false, 'stored history from before that record has no flag');

  const [flagged] = groupEventEntries([goalEvent({ eventId: 1 }), goalTurnEndedEvent({ eventId: 2 })]);
  assert.equal(goalEntryDetails(flagged).turnEnded, true);
  assert.equal(goalEntryDetails(flagged).status, 'active', 'the recorded status is kept exactly as published');

  // The flag is honoured on the goal object too, so the backend can carry it either way.
  const [nested] = groupEventEntries([goalEvent({ eventId: 1 }), goalTurnEndedEvent({ eventId: 2, nested: true })]);
  assert.equal(goalEntryDetails(nested).turnEnded, true);
});

test('a later goal record clears the turn-ended signal the previous turn left behind', () => {
  /*
   * src/queue.mjs dispatches a same-session follow-up with addEvent(sourceTask.id, ...), so a
   * second turn's goal events land in the same task stream and fold onto the same threadId.
   * A latching flag would let turn 1's turn-final record poison turn 2's live goal forever,
   * so the flag is read off the goal record that carries it and cleared by the next one.
   */
  const ended = groupEventEntries([goalEvent({ eventId: 1 }), goalTurnEndedEvent({ eventId: 2 })])[0];
  assert.equal(goalEntryDetails(ended).turnEnded, true, 'the turn-final record still ends its own turn');

  const [entry] = groupEventEntries([
    goalEvent({ eventId: 1 }),
    goalTurnEndedEvent({ eventId: 2 }),
    goalEvent({ eventId: 3, createdAt: '2026-08-12T09:20:00.000Z', goal: { status: 'active', tokensUsed: 500 } }),
  ]);
  const details = goalEntryDetails(entry);
  assert.equal(details.turnEnded, false, 'turn 2 reports its own live goal');
  assert.equal(details.status, 'active');
  assert.equal(details.tokensUsed, 500, 'the newest goal record is the one that describes the row');
  assert.equal(details.objective, 'Ship the plan visibility work');

  // The nested shape behaves identically, in both directions.
  const nestedEnded = groupEventEntries([goalEvent({ eventId: 1 }), goalTurnEndedEvent({ eventId: 2, nested: true })])[0];
  assert.equal(goalEntryDetails(nestedEnded).turnEnded, true);
  const [nested] = groupEventEntries([
    goalEvent({ eventId: 1 }),
    goalTurnEndedEvent({ eventId: 2, nested: true }),
    goalEvent({ eventId: 3, createdAt: '2026-08-12T09:20:00.000Z', goal: { status: 'active', tokensUsed: 500 } }),
  ]);
  assert.equal(goalEntryDetails(nested).turnEnded, false);
  assert.equal(goalEntryDetails(nested).tokensUsed, 500);
});

test('a cleared goal reads the same in every order it can meet a turn-final record', () => {
  // Clearing and ending a turn are different facts. A cleared goal is resolved whichever
  // side of the turn-final record it lands on, and a goal set again after a clear reopens.
  const [clearedThenLive] = groupEventEntries([
    goalClearedEvent({ eventId: 1 }),
    goalEvent({ eventId: 2, createdAt: '2026-08-12T09:20:00.000Z' }),
  ]);
  assert.equal(clearedThenLive.completedEvent, null, 'the later goal reopens the row');
  assert.equal(goalEntryDetails(clearedThenLive).cleared, false);
  assert.equal(goalEntryDetails(clearedThenLive).turnEnded, false);
  assert.equal(goalEntryDetails(clearedThenLive).status, 'active');

  const [liveThenCleared] = groupEventEntries([goalEvent({ eventId: 1 }), goalClearedEvent({ eventId: 2 })]);
  assert.equal(liveThenCleared.completedEvent.id, 2);
  assert.equal(goalEntryDetails(liveThenCleared).cleared, true);
  assert.equal(goalEntryDetails(liveThenCleared).status, 'cleared');
  assert.equal(goalEntryDetails(liveThenCleared).statusLabel, 'Cleared');

  const [endedThenCleared] = groupEventEntries([
    goalEvent({ eventId: 1 }),
    goalTurnEndedEvent({ eventId: 2 }),
    goalClearedEvent({ eventId: 3, createdAt: '2026-08-12T09:20:00.000Z' }),
  ]);
  assert.equal(endedThenCleared.completedEvent.id, 3);
  assert.equal(goalEntryDetails(endedThenCleared).cleared, true, 'the clear is not undone by the record before it');
  assert.equal(goalEntryDetails(endedThenCleared).status, 'cleared');

  // A goal set again after all of that is live once more.
  const [reopened] = groupEventEntries([
    goalEvent({ eventId: 1 }),
    goalTurnEndedEvent({ eventId: 2 }),
    goalClearedEvent({ eventId: 3, createdAt: '2026-08-12T09:20:00.000Z' }),
    goalEvent({ eventId: 4, createdAt: '2026-08-12T09:30:00.000Z' }),
  ]);
  assert.equal(reopened.completedEvent, null);
  assert.deepEqual(
    [goalEntryDetails(reopened).cleared, goalEntryDetails(reopened).turnEnded, goalEntryDetails(reopened).status],
    [false, false, 'active'],
  );
});

test('a goal status naming an Object prototype member reads as text, never as the prototype', () => {
  // src/codex-app-server.mjs deliberately keeps an unrecognized status, so provider text
  // reaches the label lookup. An unguarded index would answer with Object.prototype itself.
  for (const status of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf']) {
    const [entry] = groupEventEntries([goalEvent({ eventId: 1, goal: { status } })]);
    const { statusLabel } = goalEntryDetails(entry);
    assert.equal(typeof statusLabel, 'string', `${status} renders a string`);
    assert.doesNotMatch(statusLabel, /\[object |native code|=>|function /, `${status} renders no prototype member`);
    assert.ok(statusLabel.length > 0 && statusLabel.length <= 48, `${status} stays bounded`);
  }

  const label = (status) => goalEntryDetails(groupEventEntries([goalEvent({ goal: { status } })])[0]).statusLabel;
  assert.equal(label('toString'), 'To string');
  assert.equal(label('hasOwnProperty'), 'Has own property');
  assert.equal(label('constructor'), 'Constructor');
  assert.equal(label('__proto__'), '__proto__');
  // The known statuses still resolve through the same guarded lookup.
  assert.equal(label('usageLimited'), 'Usage limited');
  assert.equal(label('complete'), 'Complete');
});

test('a Codex agent status naming an Object prototype member reads as recorded', () => {
  for (const status of ['__proto__', 'constructor', 'toString']) {
    const [entry] = groupEventEntries([
      codexAgentSpawn('agent-thread-proto', 'completed', {
        item: { agentsStates: { 'agent-thread-proto': { status, message: null } } },
      }),
    ]);
    const details = subAgentEntryDetails(entry);
    assert.equal(details.statusLabel, 'Recorded', `${status} falls back to the recorded label`);
    assert.equal(subAgentEntryState(entry), 'finished', `${status} is not a running state`);
  }
  const [known] = groupEventEntries([codexAgentSpawn('agent-thread-known', 'completed')]);
  assert.equal(subAgentEntryDetails(known).statusLabel, 'Running');
});

test('Claude board bookkeeping reads quietly without leaving the ledger', () => {
  const entries = groupEventEntries([
    claudePlanEvent('claude-turn-1', [
      { step: 'Land the renderer half', status: 'inProgress', owner: 'dev-6' },
    ], { eventId: 1 }),
    planToolEvent('toolu_board_1', 'completed', 'TaskUpdate', { eventId: 2 }),
    itemEvent('toolu_other_1', 'completed', 'mcpToolCall', { eventId: 3, kind: 'claude' }),
  ]);
  assert.equal(entries.length, 3);
  const [planRow, board, ordinary] = entries;

  assert.equal(isPlanToolItem(entryItem(board)), true);
  assert.equal(isPlanToolItem(entryItem(ordinary)), false, 'an ordinary connected tool call is untouched');
  assert.equal(isPlanToolItem(entryItem(planRow)), false, 'the plan row carries no item at all');

  // Quiet, not hidden: it keeps its category and its place in every non-compact view.
  assert.equal(eventEntryCategory(board), 'commands');
  assert.equal(isEventEntryHighlight(board), false, 'the folded plan row already reports this change');
  assert.equal(isEventEntryHighlight(ordinary), true);
  assert.equal(filterEventEntries(entries, 'all').length, 3);
  assert.equal(filterEventEntries(entries, 'commands').length, 2);
  assert.equal(filterEventEntries(entries, 'highlights').length, 2);
});

test('a board tool call that failed folded nothing into the plan and stays loud', () => {
  const [entry] = groupEventEntries([
    planToolEvent('toolu_board_2', 'completed', 'TaskCreate', { status: 'failed' }),
  ]);
  assert.equal(isPlanToolItem(entryItem(entry)), false);
  assert.equal(isEventEntryHighlight(entry), true, 'a rejected board call is news, not bookkeeping');
  assert.equal(eventStreamStats([entry]).errors, 1);
});

test('the plan-tool marker is only trusted on a connected tool call', () => {
  assert.equal(isPlanToolItem(null), false);
  assert.equal(isPlanToolItem(undefined), false);
  assert.equal(isPlanToolItem({ type: 'commandExecution', planTool: true }), false);
  assert.equal(isPlanToolItem({ type: 'mcpToolCall', planTool: 'yes' }), false, 'only the exact marker counts');
  assert.equal(isPlanToolItem({ type: 'mcpToolCall', planTool: true }), true);
});
