import { periodRange } from './task-history.js';

const STANDUP_STATUSES = new Set(['complete', 'failed']);

function validTimestamp(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function standupTimestamp(task) {
  return validTimestamp(task?.finished_at) ?? validTimestamp(task?.created_at);
}

export function localDateInputValue(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(value.getTime())) return '';
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dateFromLocalInput(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (
    date.getFullYear() !== Number(match[1])
    || date.getMonth() !== Number(match[2]) - 1
    || date.getDate() !== Number(match[3])
  ) {
    return null;
  }
  date.setHours(0, 0, 0, 0);
  return date;
}

export function tasksForStandupDay(tasks, anchor = new Date()) {
  const { start, end } = periodRange('day', anchor);
  return (Array.isArray(tasks) ? tasks : [])
    .filter((task) => STANDUP_STATUSES.has(task?.status))
    .filter((task) => {
      const timestamp = standupTimestamp(task);
      return timestamp !== null && timestamp >= start.getTime() && timestamp < end.getTime();
    })
    .sort((left, right) => (
      standupTimestamp(left) - standupTimestamp(right)
      || Number(left?.id || 0) - Number(right?.id || 0)
    ));
}

function cleanStandupItem(value) {
  return String(value || '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function addStandupItem(sections, value, fallbackKind = 'task') {
  let text = cleanStandupItem(value);
  if (!text || /^(?:None|No (?:tasks?|blockers?)(?: identified| reported)?)\.?$/i.test(text)) return;
  let kind = fallbackKind === 'blocker' ? 'blocker' : 'task';
  const label = text.match(/^(Tasks?|Blockers?|Blocked)\s*:\s*(.*)$/i);
  if (label) {
    kind = /^Block/i.test(label[1]) ? 'blocker' : 'task';
    text = cleanStandupItem(label[2]);
  }
  if (!text) return;
  const list = kind === 'blocker' ? sections.blockers : sections.tasks;
  if (!list.some((item) => item.toLocaleLowerCase() === text.toLocaleLowerCase())) list.push(text);
}

export function standupSections(value) {
  const sections = { tasks: [], blockers: [] };
  if (value && typeof value === 'object') {
    const hasStructuredItems = Array.isArray(value.tasks) || Array.isArray(value.blockers);
    if (hasStructuredItems) {
      for (const task of value.tasks || []) addStandupItem(sections, task, 'task');
      for (const blocker of value.blockers || []) addStandupItem(sections, blocker, 'blocker');
      return sections;
    }
    value = value.standup || value.copyText || '';
  }

  let sectionKind = null;
  for (const rawLine of String(value || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const section = line.match(/^#{0,6}\s*(Tasks?|Blockers?)\s*:?\s*$/i);
    if (section) {
      sectionKind = /^Block/i.test(section[1]) ? 'blocker' : 'task';
      continue;
    }
    const bullet = line.match(/^(?:[-*+]|\d+[.)])\s+(.+)$/);
    if (bullet) {
      addStandupItem(sections, bullet[1], sectionKind || 'task');
      continue;
    }
    if (/^(?:Tasks?|Blockers?|Blocked)\s*:/i.test(line)) {
      addStandupItem(sections, line, sectionKind || 'task');
      continue;
    }
    if (sectionKind && !/^#{1,6}\s+/.test(line)) addStandupItem(sections, line, sectionKind);
  }
  return sections;
}

export function standupCopyText(value) {
  const { tasks, blockers } = standupSections(value);
  return [
    'Tasks',
    ...(tasks.length > 0 ? tasks : ['None']),
    '',
    'Blockers',
    ...(blockers.length > 0 ? blockers : ['None']),
  ].join('\n');
}

export function standupBullets(markdown) {
  const { tasks, blockers } = standupSections(markdown);
  return [...tasks, ...blockers.map((item) => `Blocker: ${item}`)];
}
