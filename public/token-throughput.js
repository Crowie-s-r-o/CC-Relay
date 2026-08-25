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
  let latest = null;
  for (const event of events || []) {
    const payload = event?.payload;
    const eventAt = timeValue(event.created_at);
    if (
      payload?.type !== 'provider/token-usage'
      || payload.provider !== provider
      || payload.source !== 'native'
      || payload.cumulative !== true
      || eventAt < startedAt
    ) continue;
    const totalTokens = Number(payload.usage?.totalTokens);
    if (!Number.isFinite(totalTokens) || totalTokens < 0) continue;
    if (!latest || eventAt >= latest.eventAt) latest = { eventAt, totalTokens };
  }
  if (!latest) return null;

  const finishedAt = timeValue(task?.finished_at);
  const endAt = task?.status === 'running'
    ? Number(now)
    : finishedAt || latest.eventAt;
  const elapsedSeconds = Math.max(0.001, (endAt - startedAt) / 1000);
  const tokensPerSecond = latest.totalTokens / elapsedSeconds;
  return {
    totalTokens: latest.totalTokens,
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
      usage: snapshot.usage,
    },
  }], task, now);
}
