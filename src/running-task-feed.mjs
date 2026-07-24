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
    if (!isAgentMessage && !isClaudeMessage) continue;
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
