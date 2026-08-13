export const PROVIDER_USAGE_METERS = Object.freeze([
  Object.freeze({ key: 'claude-five-hour', provider: 'claude', window: 'fiveHour', label: 'Cla 5h' }),
  Object.freeze({ key: 'claude-weekly', provider: 'claude', window: 'weekly', label: 'Cla Week' }),
  Object.freeze({ key: 'claude-fable', provider: 'claude', window: 'fableWeekly', label: 'Fable' }),
  Object.freeze({ key: 'codex-weekly', provider: 'codex', window: 'weekly', label: 'Cod Week' }),
]);

function finitePercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, Math.round(number))) : null;
}

const MONTH_INDEX = Object.freeze({
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
});

function zonedDateParts(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  return Object.fromEntries(parts
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value }) => [type, Number(value)]));
}

function timestampForZonedParts(parts, timeZone) {
  const desiredAsUtc = Date.UTC(
    parts.year,
    parts.month,
    parts.day,
    parts.hour,
    parts.minute,
    0,
  );
  let timestamp = desiredAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = zonedDateParts(timestamp, timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const correction = desiredAsUtc - actualAsUtc;
    timestamp += correction;
    if (correction === 0) break;
  }
  return timestamp;
}

function resetTimestamp(usageWindow, now) {
  const seconds = Number(usageWindow?.resetsAt);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1_000;

  if (typeof usageWindow?.resetLabel !== 'string') return null;
  const label = usageWindow.resetLabel.trim();
  if (!label) return null;
  const zoneMatch = label.match(/\s+\(([^()]+)\)\s*$/);
  const timeZone = zoneMatch?.[1] || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const localLabel = zoneMatch ? label.slice(0, zoneMatch.index).trim() : label;
  const match = localLabel.match(/^(?:(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:,\s*(\d{4}))?\s+at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!match) return null;

  try {
    const current = zonedDateParts(now, timeZone);
    let year = match[3] ? Number(match[3]) : current.year;
    const month = match[1] ? MONTH_INDEX[match[1].toLowerCase()] : current.month - 1;
    const day = match[2] ? Number(match[2]) : current.day;
    let hour = Number(match[4]) % 12;
    if (match[6].toLowerCase() === 'pm') hour += 12;
    const minute = Number(match[5] || 0);
    let timestamp = timestampForZonedParts({ year, month, day, hour, minute }, timeZone);

    if (!match[1] && timestamp < now) {
      const followingDay = new Date(Date.UTC(year, month, day + 1));
      timestamp = timestampForZonedParts({
        year: followingDay.getUTCFullYear(),
        month: followingDay.getUTCMonth(),
        day: followingDay.getUTCDate(),
        hour,
        minute,
      }, timeZone);
    } else if (match[1] && !match[3] && timestamp < now - (180 * 24 * 60 * 60 * 1_000)) {
      year += 1;
      timestamp = timestampForZonedParts({ year, month, day, hour, minute }, timeZone);
    }
    return Number.isFinite(timestamp) ? timestamp : null;
  } catch {
    return null;
  }
}

function resetCountdown(usageWindow, meter, now) {
  const timestamp = resetTimestamp(usageWindow, now);
  if (timestamp === null) return { value: '', label: '' };
  const remaining = Math.max(0, timestamp - now);
  if (meter.window === 'fiveHour') {
    const totalMinutes = Math.ceil(remaining / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return {
      value: `${hours}h ${minutes}m`,
      label: `Resets in ${hours} ${hours === 1 ? 'hour' : 'hours'} and ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`,
    };
  }
  const totalHours = Math.ceil(remaining / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return {
    value: `${days}d ${hours}h`,
    label: `Resets in ${days} ${days === 1 ? 'day' : 'days'} and ${hours} ${hours === 1 ? 'hour' : 'hours'}`,
  };
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
  now = Date.now(),
} = {}) {
  const nowTimestamp = Number(now);
  const provider = providerUsage?.[meter.provider];
  const usageWindow = provider?.[meter.window];
  const usedPercent = finitePercent(usageWindow?.usedPercent);
  if (usedPercent === null) {
    const state = !provider || provider.status === 'checking' ? 'checking' : 'unavailable';
    return {
      key: meter.key,
      label: meter.label,
      value: '--',
      countdown: '',
      countdownLabel: '',
      usedPercent: null,
      level: state,
      title: state === 'unavailable'
        ? `${meter.label} usage is unavailable.`
        : `${meter.label} usage is being checked.`,
    };
  }

  const reset = resetCopy(usageWindow, formatDate);
  const countdown = resetCountdown(
    usageWindow,
    meter,
    Number.isFinite(nowTimestamp) ? nowTimestamp : Date.now(),
  );
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
    countdown: countdown.value,
    countdownLabel: countdown.label,
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
