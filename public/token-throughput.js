function timeValue(value) {
  const milliseconds = new Date(value || 0).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : 0;
}

function compactRate(value) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  if (value >= 100) return Math.round(value).toLocaleString();
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

export function tokenThroughput(events, task, now = Date.now()) {
  const startedAt = timeValue(task?.started_at);
  if (!startedAt) return null;
  const provider = task?.provider || 'codex';
  let attemptStartedAt = startedAt;
  let latest = null;
  for (const event of events || []) {
    const payload = event?.payload;
    const eventAt = timeValue(event.created_at);
    if (
      payload?.type === 'relay/task-attempt-started'
      && (!payload.provider || payload.provider === provider)
    ) {
      const boundaryAt = timeValue(payload.attemptStartedAt) || eventAt;
      if (boundaryAt >= attemptStartedAt) {
        attemptStartedAt = boundaryAt;
        latest = null;
      }
      continue;
    }
    if (
      payload?.type !== 'provider/token-usage'
      || payload.provider !== provider
      || payload.source !== 'native'
      || payload.cumulative !== true
    ) continue;
    const eventAttemptStartedAt = timeValue(payload.attemptStartedAt);
    if (eventAttemptStartedAt > attemptStartedAt) {
      attemptStartedAt = eventAttemptStartedAt;
      latest = null;
    }
    if (eventAt < attemptStartedAt) continue;
    const usage = payload.usage || {};
    const totalTokens = Number(usage.totalTokens);
    const inputTokens = Number(usage.inputTokens);
    const outputTokens = Number(usage.outputTokens);
    const reasoningTokens = Number(usage.reasoningTokens);
    const cacheReadTokens = Number(usage.cacheReadTokens);
    const cacheWriteTokens = Number(usage.cacheWriteTokens);
    if (
      !Number.isFinite(totalTokens)
      || totalTokens < 0
      || !Number.isFinite(inputTokens)
      || inputTokens < 0
      || !Number.isFinite(outputTokens)
      || outputTokens < 0
    ) continue;
    if (!latest || eventAt >= latest.eventAt) {
      latest = {
        eventAt,
        attemptStartedAt,
        totalTokens,
        inputTokens,
        outputTokens,
        reasoningTokens: Number.isFinite(reasoningTokens) && reasoningTokens >= 0
          ? reasoningTokens
          : 0,
        cacheReadTokens: Number.isFinite(cacheReadTokens) && cacheReadTokens >= 0
          ? cacheReadTokens
          : 0,
        cacheWriteTokens: Number.isFinite(cacheWriteTokens) && cacheWriteTokens >= 0
          ? cacheWriteTokens
          : 0,
      };
    }
  }
  if (!latest) return null;

  const finishedAt = timeValue(task?.finished_at);
  const endAt = task?.status === 'running'
    ? Number(now)
    : finishedAt || latest.eventAt;
  const elapsedSeconds = Math.max(0.001, (endAt - latest.attemptStartedAt) / 1000);
  const tokensPerSecond = latest.outputTokens / elapsedSeconds;
  return {
    ...latest,
    elapsedSeconds,
    tokensPerSecond,
    rateLabel: compactRate(tokensPerSecond),
  };
}

export function tokenThroughputFromSnapshot(snapshot, task, now = Date.now()) {
  if (!snapshot?.usage) return null;
  return tokenThroughput([{
    created_at: snapshot.createdAt || task?.started_at,
    payload: {
      type: 'provider/token-usage',
      provider: snapshot.provider || task?.provider,
      source: snapshot.source || 'native',
      cumulative: true,
      attemptStartedAt: snapshot.attemptStartedAt,
      usage: snapshot.usage,
    },
  }], task, now);
}
