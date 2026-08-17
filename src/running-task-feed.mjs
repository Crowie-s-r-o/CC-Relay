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

export function taskBelongsInMonitor(task) {
  if (task?.status === 'running') return true;
  return task?.status === 'open'
    && task?.manual_completion === true
    && task?.keep_terminal_open === true
    && task?.terminal_lifecycle === 'disposable'
    && task?.mode === 'execute'
    && ['codex', 'claude'].includes(task?.provider);
}

export function runningTaskFeed(tasks, eventsForTask) {
  return (tasks || [])
    .filter(taskBelongsInMonitor)
    .map((task) => ({
      ...task,
      latestAgentUpdate: latestAgentUpdate(eventsForTask(task.id)),
    }));
}

// GET /api/status is polled every two seconds and used to rebuild this feed by re-reading and
// re-parsing a large event window for every monitored task. That was affordable when exactly
// one task ran at a time; with per-session parallel execution and durable terminal sessions it
// multiplies by the number of cards and reintroduces the main-thread stall this work avoids.
//
// Instead, remember the last computed update per task and only read events appended since
// then. A poll where nothing new arrived costs one indexed MAX(id) lookup per monitored task.
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

  // Keeps the cache bounded to whatever is actually visible in the task monitor.
  prune(activeTaskIds) {
    const keep = new Set(activeTaskIds);
    for (const taskId of this.entries.keys()) {
      if (!keep.has(taskId)) this.entries.delete(taskId);
    }
  }

  feed(tasks) {
    const monitored = (tasks || []).filter(taskBelongsInMonitor);
    this.prune(monitored.map((task) => task.id));
    return monitored.map((task) => ({ ...task, latestAgentUpdate: this.update(task.id) }));
  }
}
