const MAX_ACTIVITY_TEXT_CHARACTERS = 16_000;
const MAX_ACTIVITY_NESTING_DEPTH = 32;

function safePrefix(value, length) {
  let end = Math.max(0, Math.min(value.length, length));
  if (end > 0 && /[\uD800-\uDBFF]/u.test(value[end - 1])) end -= 1;
  return value.slice(0, end);
}

function safeSuffix(value, length) {
  let start = Math.max(0, value.length - Math.max(0, length));
  if (start < value.length && /[\uDC00-\uDFFF]/u.test(value[start])) start += 1;
  return value.slice(start);
}

export function boundedActivityText(value, maximum = MAX_ACTIVITY_TEXT_CHARACTERS) {
  const numericMaximum = Number(maximum);
  const limit = Number.isFinite(numericMaximum)
    ? Math.max(0, Math.floor(numericMaximum))
    : MAX_ACTIVITY_TEXT_CHARACTERS;
  if (typeof value !== 'string' || value.length <= limit) {
    return { value, truncated: false, originalCharacters: typeof value === 'string' ? value.length : 0 };
  }
  const marker = '\n\n[CC Relay omitted activity detail here. The complete provider event remains in the task artifact.]\n\n';
  if (limit <= marker.length) {
    return {
      value: safePrefix(marker, limit),
      truncated: true,
      originalCharacters: value.length,
    };
  }
  const available = limit - marker.length;
  const prefixLength = Math.ceil(available / 2);
  const suffixLength = Math.floor(available / 2);
  return {
    value: `${safePrefix(value, prefixLength)}${marker}${safeSuffix(value, suffixLength)}`,
    truncated: true,
    originalCharacters: value.length,
  };
}

function compactNestedValue(value, seen = new WeakSet(), depth = 0) {
  if (typeof value === 'string') {
    if (/^data:(?:image|audio|video)\//iu.test(value)) {
      return {
        value: '[Binary media omitted from the activity database. The complete provider event remains in the task artifact.]',
        truncated: true,
      };
    }
    const bounded = boundedActivityText(value);
    return { value: bounded.value, truncated: bounded.truncated };
  }
  if (!value || typeof value !== 'object') return { value, truncated: false };
  if (depth >= MAX_ACTIVITY_NESTING_DEPTH) {
    return { value: '[Deep provider value omitted from the activity database.]', truncated: true };
  }
  if (seen.has(value)) return { value: '[Circular provider value omitted.]', truncated: true };
  seen.add(value);
  let truncated = false;
  if (Array.isArray(value)) {
    const compacted = value.map((entry) => {
      const result = compactNestedValue(entry, seen, depth + 1);
      truncated ||= result.truncated;
      return result.value;
    });
    seen.delete(value);
    return { value: compacted, truncated };
  }
  const compacted = {};
  for (const [key, entry] of Object.entries(value)) {
    const result = compactNestedValue(entry, seen, depth + 1);
    compacted[key] = result.value;
    truncated ||= result.truncated;
  }
  seen.delete(value);
  return { value: compacted, truncated };
}

function compactStartedFileChanges(item) {
  if (!Array.isArray(item.changes)) return item;
  let truncated = false;
  const changes = item.changes.map((change) => {
    if (!change || typeof change !== 'object' || typeof change.diff !== 'string') return change;
    const { diff, ...summary } = change;
    truncated = true;
    return {
      ...summary,
      diffOmittedFromStartedEvent: true,
      diffCharacters: diff.length,
    };
  });
  return truncated ? { ...item, changes, activityDetailTruncated: true } : item;
}

/**
 * Keep the SQLite activity index bounded while raw task artifacts retain exact provider events.
 * Completed file-change diffs stay lossless because the task diff viewer reads them from SQLite.
 */
export function compactEventForStorage(event) {
  if (!event || typeof event !== 'object' || !event.item || typeof event.item !== 'object') {
    return event;
  }

  let item = event.item;
  if (event.type === 'item/started' && item.type === 'fileChange') {
    item = compactStartedFileChanges(item);
  }

  if (item.type === 'commandExecution' && typeof item.aggregatedOutput === 'string') {
    const output = boundedActivityText(item.aggregatedOutput);
    if (output.truncated) {
      item = {
        ...item,
        aggregatedOutput: output.value,
        activityDetailTruncated: true,
        aggregatedOutputCharacters: output.originalCharacters,
      };
    }
  }

  if (item.type === 'mcpToolCall' && Object.hasOwn(item, 'result')) {
    const result = compactNestedValue(item.result);
    if (result.truncated) {
      item = {
        ...item,
        result: result.value,
        activityDetailTruncated: true,
      };
    }
  }

  if (item.type === 'imageGeneration') {
    const result = compactNestedValue(item);
    if (result.truncated) item = { ...result.value, activityDetailTruncated: true };
  }

  return item === event.item ? event : { ...event, item };
}

export const ACTIVITY_TEXT_CHARACTER_LIMIT = MAX_ACTIVITY_TEXT_CHARACTERS;
