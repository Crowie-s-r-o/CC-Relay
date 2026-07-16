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

export function groupEventEntries(events) {
  const entries = [];
  const entriesByItemId = new Map();

  for (const event of events || []) {
    if (!isPairableItemEvent(event)) {
      entries.push({
        id: `event-${event.id}`,
        events: [event],
        startedEvent: null,
        updatedEvent: null,
        completedEvent: null,
      });
      continue;
    }

    const itemId = event.payload.item.id;
    let entry = entriesByItemId.get(itemId);
    if (!entry) {
      entry = {
        id: `item-${itemId}`,
        events: [],
        startedEvent: null,
        updatedEvent: null,
        completedEvent: null,
      };
      entriesByItemId.set(itemId, entry);
      entries.push(entry);
    }
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
  return entry?.completedEvent || entry?.events?.at(-1) || null;
}

export function entryFirstEvent(entry) {
  return entry?.startedEvent || entry?.events?.[0] || null;
}

export function eventEntryCategory(entry) {
  const item = entryItem(entry);
  if (COMMAND_ITEM_TYPES.has(item?.type)) {
    return 'commands';
  }
  if (item?.type === 'agentMessage') {
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
  if (lastEvent?.payload?.type === 'turn/started' || lastEvent?.payload?.type === 'turn/completed') {
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

export function eventStreamStats(entries) {
  const stats = { commands: 0, files: 0, messages: 0, errors: 0, running: 0 };
  for (const entry of entries || []) {
    const item = entryItem(entry);
    const last = entryLastEvent(entry);
    if (item?.type === 'commandExecution') stats.commands += 1;
    if (item?.type === 'fileChange') stats.files += 1;
    if (item?.type === 'agentMessage' || ['claude', 'result'].includes(last?.kind)) stats.messages += 1;
    if (last?.kind === 'stderr' || last?.payload?.type === 'error' || item?.status === 'failed') stats.errors += 1;
    if (entry.startedEvent && !entry.completedEvent) stats.running += 1;
  }
  return stats;
}
