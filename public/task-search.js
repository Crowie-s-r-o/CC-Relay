import { escapeHtml } from './escape-html.js';

export const TASK_SEARCH_DEBOUNCE_MS = 180;

export function taskSearchActive(query) {
  return String(query || '').trim().length > 0;
}

export function tasksForSearchResults(tasks, results) {
  const tasksById = new Map((tasks || []).map((task) => [Number(task.id), task]));
  return (results || [])
    .map((result) => tasksById.get(Number(result.taskId)))
    .filter(Boolean);
}

export function taskSearchMatchMarkup(match) {
  const text = String(match?.excerpt || '');
  const normalized = (match?.highlights || [])
    .map((range) => [
      Math.max(0, Math.min(text.length, Number(range?.[0]) || 0)),
      Math.max(0, Math.min(text.length, Number(range?.[1]) || 0)),
    ])
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const ranges = [];
  for (const range of normalized) {
    const previous = ranges.at(-1);
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else ranges.push([...range]);
  }
  let offset = 0;
  let markup = '';
  for (const [start, end] of ranges) {
    markup += escapeHtml(text.slice(offset, start));
    markup += `<mark>${escapeHtml(text.slice(start, end))}</mark>`;
    offset = end;
  }
  return `${markup}${escapeHtml(text.slice(offset))}`;
}
