const COMMAND_ITEM_TYPES = new Set([
  'commandExecution',
  'fileChange',
  'imageView',
  'mcpToolCall',
  'webSearch',
]);

const QUIET_ITEM_TYPES = new Set([
  'contextCompaction',
  'reasoning',
  'userMessage',
]);

const CODEX_AGENT_RUNNING_STATES = new Set(['pendingInit', 'running']);

const CODEX_AGENT_STATUS_LABELS = {
  pendingInit: 'Starting',
  running: 'Running',
  completed: 'Finished',
  interrupted: 'Interrupted',
  errored: 'Failed',
  shutdown: 'Closed',
  notFound: 'Unavailable',
};

function isPairableItemEvent(event) {
  return event?.payload?.item?.id
    && ['item/started', 'item/updated', 'item/completed'].includes(event.payload.type);
}

function liveClaudeMessageId(event) {
  if (event?.payload?.type !== 'claude/message') return '';
  return typeof event.payload.liveMessageId === 'string'
    ? event.payload.liveMessageId.trim()
    : '';
}

function isClaudeSubAgentItem(item) {
  return Boolean(item && item.type === 'mcpToolCall' && item.subAgent === true);
}

function isCodexSubAgentActivityItem(item) {
  return Boolean(item && item.type === 'subAgentActivity' && item.agentThreadId);
}

function isCodexSubAgentSpawnItem(item) {
  return Boolean(item && item.type === 'collabAgentToolCall' && item.tool === 'spawnAgent');
}

function isCodexCollabAgentItem(item) {
  return Boolean(item && item.type === 'collabAgentToolCall');
}

function codexAgentIds(item) {
  if (isCodexSubAgentActivityItem(item)) {
    return [item.agentThreadId];
  }
  if (!isCodexCollabAgentItem(item)) {
    return [];
  }
  return [...new Set([
    ...(item.receiverThreadIds || []),
    ...Object.keys(item.agentsStates || {}),
  ].filter(Boolean))];
}

// Provider-neutral sub-agent signal. Claude marks Agent tool calls explicitly. Codex exposes
// first-class collaboration activity and spawn items through the app-server protocol.
export function isSubAgentItem(item) {
  return isClaudeSubAgentItem(item)
    || isCodexSubAgentActivityItem(item)
    || isCodexSubAgentSpawnItem(item);
}

// Claude reports a finished sub-agent through a task notification, which CC Relay records as a
// claude/agent-finished event carrying the tool use that launched (or last resumed) the agent.
export function isAgentFinishedEvent(event) {
  return event?.payload?.type === 'claude/agent-finished';
}

function isNamedAgentFinishedEvent(event) {
  if (!isAgentFinishedEvent(event)) {
    return false;
  }
  const name = String(event.payload.agentName || '').trim();
  const summary = String(event.payload.summary || '').trim();
  return Boolean(name) || /^Agent\s+['"]/i.test(summary);
}

function agentFinishedToolUseId(event) {
  return isAgentFinishedEvent(event) ? String(event.payload.toolUseId || '').trim() : '';
}

export function groupEventEntries(events) {
  const list = events || [];
  const entries = [];
  const entriesByItemId = new Map();
  const entriesByLiveMessageId = new Map();
  const entriesByCodexAgentId = new Map();
  const codexAgentIdsByItemId = new Map();
  // A backgrounded sub-agent's task notification can be written to the transcript before the
  // launch record it belongs to, so the fold targets are collected before grouping starts.
  const subAgentItemIds = new Set();
  for (const event of list) {
    const item = event?.payload?.item;
    if (isClaudeSubAgentItem(item) && item.id) {
      subAgentItemIds.add(item.id);
    }
    const agentIds = codexAgentIds(item);
    if (item?.id && agentIds.length) {
      const knownIds = codexAgentIdsByItemId.get(item.id) || new Set();
      for (const agentId of agentIds) knownIds.add(agentId);
      codexAgentIdsByItemId.set(item.id, knownIds);
    }
  }

  const entryForItemId = (itemId) => {
    let entry = entriesByItemId.get(itemId);
    if (!entry) {
      entry = {
        id: `item-${itemId}`,
        events: [],
        startedEvent: null,
        updatedEvent: null,
        completedEvent: null,
        agentFinishedEvent: null,
      };
      entriesByItemId.set(itemId, entry);
      entries.push(entry);
    }
    return entry;
  };

  const entryForCodexAgent = (agentThreadId) => {
    let entry = entriesByCodexAgentId.get(agentThreadId);
    if (!entry) {
      entry = {
        id: `codex-agent-${agentThreadId}`,
        events: [],
        startedEvent: null,
        updatedEvent: null,
        completedEvent: null,
        agentFinishedEvent: null,
        codexAgentThreadId: agentThreadId,
        codexAgentEvents: [],
      };
      entriesByCodexAgentId.set(agentThreadId, entry);
      entries.push(entry);
    }
    return entry;
  };

  for (const event of list) {
    const item = event?.payload?.item;
    const groupedCodexAgentIds = item?.id && codexAgentIdsByItemId.has(item.id)
      ? [...codexAgentIdsByItemId.get(item.id)]
      : codexAgentIds(item);
    if (groupedCodexAgentIds.length) {
      for (const codexAgentId of groupedCodexAgentIds) {
        const entry = entryForCodexAgent(codexAgentId);
        entry.events.push(event);
        entry.codexAgentEvents.push(event);
        entry.startedEvent ||= event;
        entry.updatedEvent = event;
        if (item.type === 'subAgentActivity') {
          if (item.kind === 'interrupted') {
            entry.completedEvent = event;
          } else if (item.kind === 'started') {
            entry.completedEvent = null;
          }
        }
        const codexState = isCodexCollabAgentItem(item)
          ? item.agentsStates?.[codexAgentId]?.status
          : null;
        if (codexState && !CODEX_AGENT_RUNNING_STATES.has(codexState)) {
          entry.completedEvent = event;
        } else if (codexState && CODEX_AGENT_RUNNING_STATES.has(codexState)) {
          entry.completedEvent = null;
        }
      }
      continue;
    }

    const messageId = liveClaudeMessageId(event);
    if (messageId) {
      let entry = entriesByLiveMessageId.get(messageId);
      if (!entry) {
        entry = {
          id: `live-message-${event.id}`,
          events: [],
          liveMessageText: '',
          liveMessageEvent: null,
          startedEvent: null,
          updatedEvent: null,
          completedEvent: null,
          agentFinishedEvent: null,
        };
        entriesByLiveMessageId.set(messageId, entry);
        entries.push(entry);
      }
      entry.events.push(event);
      if (typeof event.payload.liveDelta === 'string') {
        entry.liveMessageText += event.payload.liveDelta;
      } else {
        // Compatibility with live message events written before delta-only storage.
        entry.liveMessageText = String(event.payload.text || event.message || '');
      }
      const text = entry.liveMessageText.trim();
      entry.liveMessageEvent = {
        ...event,
        message: text,
        payload: {
          ...event.payload,
          text,
        },
      };
      continue;
    }

    const finishedToolUseId = agentFinishedToolUseId(event);
    // A notification whose tool use is a known sub-agent launch resolves that signal. Any
    // other notification (a resumed agent reports through the SendMessage that woke it) keeps
    // its own line instead of silently attaching to an unrelated tool call.
    if (finishedToolUseId && subAgentItemIds.has(finishedToolUseId)) {
      const entry = entryForItemId(finishedToolUseId);
      entry.events.push(event);
      entry.agentFinishedEvent = event;
      continue;
    }

    if (!isPairableItemEvent(event)) {
      entries.push({
        id: `event-${event.id}`,
        events: [event],
        startedEvent: null,
        updatedEvent: null,
        completedEvent: null,
        agentFinishedEvent: isAgentFinishedEvent(event) ? event : null,
      });
      continue;
    }

    const entry = entryForItemId(event.payload.item.id);
    entry.events.push(event);
    if (event.payload.type === 'item/started') {
      entry.startedEvent = event;
    } else if (event.payload.type === 'item/completed') {
      entry.completedEvent = event;
    } else {
      entry.updatedEvent = event;
    }
  }

  return entries;
}

export function entryItem(entry) {
  if (entry?.codexAgentEvents?.length) {
    return entry.codexAgentEvents.at(-1)?.payload?.item || null;
  }
  return entry?.completedEvent?.payload?.item
    || entry?.updatedEvent?.payload?.item
    || entry?.startedEvent?.payload?.item
    || entry?.events?.find((event) => event.payload?.item)?.payload.item
    || null;
}

export function entryLastEvent(entry) {
  if (entry?.codexAgentEvents?.length) {
    return entry.codexAgentEvents.at(-1) || null;
  }
  return entry?.completedEvent || entry?.liveMessageEvent || entry?.events?.at(-1) || null;
}

export function entryFirstEvent(entry) {
  if (entry?.codexAgentEvents?.length) {
    return entry.codexAgentEvents[0] || null;
  }
  return entry?.startedEvent || entry?.events?.[0] || null;
}

export function eventEntryCategory(entry) {
  if (entry?.codexAgentThreadId || isSubAgentItem(entryItem(entry))) {
    return 'commands';
  }
  const item = entryItem(entry);
  if (COMMAND_ITEM_TYPES.has(item?.type)) {
    return 'commands';
  }
  if (item?.type === 'agentMessage' || item?.type === 'userMessage') {
    return 'messages';
  }
  if (entry.events.some((event) => ['claude', 'plan', 'result'].includes(event.kind))) {
    return 'messages';
  }
  return 'system';
}

export function isEventEntryHighlight(entry) {
  const item = entryItem(entry);
  const lastEvent = entryLastEvent(entry);
  if (lastEvent?.kind === 'stderr' || lastEvent?.payload?.type === 'error') {
    return true;
  }
  if (QUIET_ITEM_TYPES.has(item?.type)) {
    return false;
  }
  if (lastEvent?.payload?.type === 'turn/started'
    || lastEvent?.payload?.type === 'turn/completed'
    || lastEvent?.payload?.type === 'claude/progress') {
    return false;
  }
  return true;
}

export function filterEventEntries(entries, filter) {
  if (filter === 'highlights') {
    return entries.filter(isEventEntryHighlight);
  }
  if (filter === 'commands' || filter === 'messages') {
    return entries.filter((entry) => eventEntryCategory(entry) === filter);
  }
  return [...entries];
}

// True for a sub-agent launch signal and for a standalone finish notification that has no
// launch signal in this stream (a resumed agent, or a notification read before its launch).
export function isSubAgentEntry(entry) {
  return Boolean(entry?.codexAgentThreadId)
    || isSubAgentItem(entryItem(entry))
    || isNamedAgentFinishedEvent(entry?.agentFinishedEvent);
}

function codexSubAgentDetails(entry) {
  if (!entry?.codexAgentThreadId) {
    return null;
  }
  const details = {
    provider: 'codex',
    name: '',
    agentType: '',
    prompt: '',
    reportedStatus: 'running',
    statusLabel: 'Running',
    note: '',
    failed: false,
  };
  let agentPath = '';
  let model = '';
  let reasoningEffort = '';

  for (const event of entry.codexAgentEvents || []) {
    const item = event?.payload?.item;
    if (isCodexSubAgentActivityItem(item)) {
      agentPath = String(item.agentPath || agentPath).trim();
      if (item.kind === 'started') {
        details.reportedStatus = 'running';
      } else if (item.kind === 'interrupted') {
        details.reportedStatus = 'interrupted';
      }
    }
    if (isCodexCollabAgentItem(item)) {
      if (isCodexSubAgentSpawnItem(item)) {
        details.prompt = String(item.prompt || details.prompt).trim();
        model = String(item.model || model).trim();
        reasoningEffort = String(item.reasoningEffort || reasoningEffort).trim();
      }
      if (item.status === 'failed' && isCodexSubAgentSpawnItem(item)) {
        details.reportedStatus = 'errored';
      }
      const state = item.agentsStates?.[entry.codexAgentThreadId];
      if (state?.status) {
        details.reportedStatus = state.status;
      }
      if (state?.message) {
        details.note = String(state.message).trim();
      }
    }
  }

  const pathName = agentPath.split(/[\\/]/).filter(Boolean).at(-1) || '';
  details.name = pathName || `agent ${entry.codexAgentThreadId.slice(0, 8)}`;
  details.agentType = [model, reasoningEffort].filter(Boolean).join(' / ') || 'Codex';
  details.statusLabel = CODEX_AGENT_STATUS_LABELS[details.reportedStatus] || 'Recorded';
  details.failed = ['errored', 'interrupted', 'notFound'].includes(details.reportedStatus);
  return details;
}

export function subAgentEntryDetails(entry) {
  return codexSubAgentDetails(entry);
}

// running: the launch tool call is still open.
// backgrounded: Claude launched the agent asynchronously and it is still working.
// finished: its task notification arrived, or a synchronous run returned.
export function subAgentEntryState(entry) {
  const codex = codexSubAgentDetails(entry);
  if (codex) {
    return CODEX_AGENT_RUNNING_STATES.has(codex.reportedStatus) ? 'running' : 'finished';
  }
  if (entry?.agentFinishedEvent) {
    return 'finished';
  }
  const item = entryItem(entry);
  if (!isSubAgentItem(item)) {
    return 'finished';
  }
  if (item.status === 'failed') {
    return 'finished';
  }
  if (item.backgrounded) {
    return 'backgrounded';
  }
  return entry.completedEvent ? 'finished' : 'running';
}

// Sub-agents that started and have not reported back. Counting live launches (never
// decrementing a shared tally) keeps the number at or above zero even when a notification
// arrives before its launch record or belongs to a launch this stream never saw. A finished
// turn owns no live sub-agents, so the count clears with it.
export function activeSubAgentCount(entries, { turnEnded = false } = {}) {
  if (turnEnded) {
    return 0;
  }
  let active = 0;
  for (const entry of entries || []) {
    if (!isSubAgentEntry(entry)) {
      continue;
    }
    if (['running', 'backgrounded'].includes(subAgentEntryState(entry))) {
      active += 1;
    }
  }
  return active;
}

export function eventStreamStats(entries, { turnEnded = false } = {}) {
  const stats = {
    commands: 0,
    files: 0,
    messages: 0,
    errors: 0,
    running: 0,
    thinkingTokens: 0,
    agents: activeSubAgentCount(entries, { turnEnded }),
  };
  for (const entry of entries || []) {
    const item = entryItem(entry);
    const last = entryLastEvent(entry);
    if (item?.type === 'commandExecution') stats.commands += 1;
    if (item?.type === 'fileChange') stats.files += 1;
    if (['agentMessage', 'userMessage'].includes(item?.type) || ['claude', 'result'].includes(last?.kind)) stats.messages += 1;
    if (
      last?.kind === 'stderr'
      || last?.payload?.type === 'error'
      || item?.status === 'failed'
      || subAgentEntryDetails(entry)?.failed
    ) stats.errors += 1;
    if (entry.startedEvent && !entry.completedEvent) stats.running += 1;
    const reasoningTokens = Number(last?.payload?.tokenUsage?.last?.reasoningOutputTokens);
    if (Number.isFinite(reasoningTokens)) stats.thinkingTokens += reasoningTokens;
  }
  return stats;
}
