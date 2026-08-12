export const PROVIDER_USAGE_METERS = Object.freeze([
  Object.freeze({ key: 'claude-five-hour', provider: 'claude', window: 'fiveHour', label: 'Claude 5h' }),
  Object.freeze({ key: 'claude-weekly', provider: 'claude', window: 'weekly', label: 'Claude week' }),
  Object.freeze({ key: 'claude-fable', provider: 'claude', window: 'fableWeekly', label: 'Fable week' }),
  Object.freeze({ key: 'codex-weekly', provider: 'codex', window: 'weekly', label: 'Codex week' }),
]);

function finitePercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, Math.round(number))) : null;
}

function resetCopy(window, formatDate) {
  if (typeof window?.resetLabel === 'string' && window.resetLabel.trim()) {
    return `Resets ${window.resetLabel.trim()}`;
  }
  const seconds = Number(window?.resetsAt);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const date = new Date(seconds * 1_000);
  if (!Number.isFinite(date.getTime())) return '';
  return `Resets ${formatDate(date)}`;
}

function defaultDateFormat(date) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function providerUsageMeterPresentation(providerUsage, meter, {
  formatDate = defaultDateFormat,
} = {}) {
  const provider = providerUsage?.[meter.provider];
  const window = provider?.[meter.window];
  const usedPercent = finitePercent(window?.usedPercent);
  if (usedPercent === null) {
    const state = !provider || provider.status === 'checking' ? 'checking' : 'unavailable';
    return {
      key: meter.key,
      label: meter.label,
      value: '--',
      usedPercent: null,
      level: state,
      title: state === 'unavailable'
        ? `${meter.label} usage is unavailable.`
        : `${meter.label} usage is being checked.`,
    };
  }

  const reset = resetCopy(window, formatDate);
  const stale = provider?.status === 'stale';
  const level = usedPercent >= 90
    ? 'critical'
    : usedPercent >= 75
      ? 'elevated'
      : usedPercent >= 50 ? 'warning' : 'normal';
  return {
    key: meter.key,
    label: meter.label,
    value: `${usedPercent}%`,
    usedPercent,
    level,
    title: `${meter.label}: ${usedPercent}% used.${reset ? ` ${reset}.` : ''}${stale ? ' Last known value.' : ''}`,
  };
}

export function providerUsagePresentation(providerUsage, options) {
  return PROVIDER_USAGE_METERS.map((meter) => (
    providerUsageMeterPresentation(providerUsage, meter, options)
  ));
}
