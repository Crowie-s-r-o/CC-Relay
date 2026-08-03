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

// A Claude sub-agent launch. Legacy stored events carry the same mcpToolCall envelope without
// the marker, so they keep rendering as ordinary connected-tool signals.
export function isSubAgentItem(item) {
  return Boolean(item && item.type === 'mcpToolCall' && item.subAgent === true);
}

// Claude reports a finished sub-agent through a task notification, which CC Relay records as a
// claude/agent-finished event carrying the tool use that launched (or last resumed) the agent.
export function isAgentFinishedEvent(event) {
  return event?.payload?.type === 'claude/agent-finished';
}

function agentFinishedToolUseId(event) {
  return isAgentFinishedEvent(event) ? String(event.payload.toolUseId || '').trim() : '';
}

export function groupEventEntries(events) {
  const list = events || [];
  const entries = [];
  const entriesByItemId = new Map();
  const entriesByLiveMessageId = new Map();
  // A backgrounded sub-agent's task notification can be written to the transcript before the
  // launch record it belongs to, so the fold targets are collected before grouping starts.
  const subAgentItemIds = new Set();
  for (const event of list) {
    const item = event?.payload?.item;
    if (isSubAgentItem(item) && item.id) {
      subAgentItemIds.add(item.id);
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

  for (const event of list) {
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
  return entry?.completedEvent?.payload?.item
    || entry?.updatedEvent?.payload?.item
    || entry?.startedEvent?.payload?.item
    || entry?.events?.find((event) => event.payload?.item)?.payload.item
    || null;
}

export function entryLastEvent(entry) {
  return entry?.completedEvent || entry?.liveMessageEvent || entry?.events?.at(-1) || null;
}

export function entryFirstEvent(entry) {
  return entry?.startedEvent || entry?.events?.[0] || null;
}

export function eventEntryCategory(entry) {
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
  return isSubAgentItem(entryItem(entry)) || Boolean(entry?.agentFinishedEvent);
}

// running: the launch tool call is still open.
// backgrounded: Claude launched the agent asynchronously and it is still working.
// finished: its task notification arrived, or a synchronous run returned.
export function subAgentEntryState(entry) {
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
    if (!isSubAgentItem(entryItem(entry))) {
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
    if (last?.kind === 'stderr' || last?.payload?.type === 'error' || item?.status === 'failed') stats.errors += 1;
    if (entry.startedEvent && !entry.completedEvent) stats.running += 1;
    const reasoningTokens = Number(last?.payload?.tokenUsage?.last?.reasoningOutputTokens);
    if (Number.isFinite(reasoningTokens)) stats.thinkingTokens += reasoningTokens;
  }
  return stats;
}
