function normalizedProvider(event) {
  const provider = event?.payload?.provider || event?.kind;
  if (provider === 'claude') return 'claude';
  if (provider === 'plan' || provider === 'council') return 'council';
  return 'codex';
}

export function latestAgentUpdate(events) {
  for (let index = (events || []).length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const payload = event?.payload || {};
    const item = payload.item;
    const isAgentMessage = item?.type === 'agentMessage';
    const isClaudeMessage = payload.type === 'claude/message';
    const isClaudeInputState = ['claude/input-required', 'claude/input-resumed'].includes(payload.type);
    if (!isAgentMessage && !isClaudeMessage && !isClaudeInputState) continue;
    const text = String(isAgentMessage ? item.text : payload.text || event.message || '').trim();
    if (!text) continue;
    return {
      text,
      provider: normalizedProvider(event),
      createdAt: event.created_at || null,
    };
  }
  return null;
}

export function runningTaskFeed(tasks, eventsForTask) {
  return (tasks || [])
    .filter((task) => task.status === 'running')
    .map((task) => ({
      ...task,
      latestAgentUpdate: latestAgentUpdate(eventsForTask(task.id)),
    }));
}

// GET /api/status is polled every two seconds and used to rebuild this feed by re-reading and
// re-parsing a large event window for every running task. That was affordable when exactly
// one task ran at a time; with per-session parallel execution it multiplies by the number of
// running tasks and reintroduces the very main-thread stall this work exists to remove.
//
// Instead, remember the last computed update per task and only read events appended since
// then. A poll where nothing new arrived costs one indexed MAX(id) lookup per running task.
export class AgentUpdateCache {
  constructor({ latestEventId, listEventsSince, limit = 500 }) {
    this.latestEventId = latestEventId;
    this.listEventsSince = listEventsSince;
    this.limit = limit;
    this.entries = new Map();
  }

  update(taskId) {
    const latestId = this.latestEventId(taskId);
    const entry = this.entries.get(taskId);
    if (entry && entry.eventId === latestId) return entry.update;

    const events = this.listEventsSince(taskId, entry ? entry.eventId : 0, this.limit);
    // No newer agent message means the previously reported one is still the latest.
    const next = latestAgentUpdate(events) || entry?.update || null;
    this.entries.set(taskId, { eventId: latestId, update: next });
    return next;
  }

  // Keeps the cache bounded to whatever is actually running right now.
  prune(activeTaskIds) {
    const keep = new Set(activeTaskIds);
    for (const taskId of this.entries.keys()) {
      if (!keep.has(taskId)) this.entries.delete(taskId);
    }
  }

  feed(tasks) {
    const running = (tasks || []).filter((task) => task.status === 'running');
    this.prune(running.map((task) => task.id));
    return running.map((task) => ({ ...task, latestAgentUpdate: this.update(task.id) }));
  }
}
