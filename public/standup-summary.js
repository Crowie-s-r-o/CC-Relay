import { periodRange } from './task-history.js';
import { escapeHtml } from './escape-html.js';

const STANDUP_STATUSES = new Set(['complete']);

export const STANDUP_CHANGELOG_SECTIONS = Object.freeze([
  Object.freeze({ key: 'added', title: 'Added' }),
  Object.freeze({ key: 'changed', title: 'Changed' }),
  Object.freeze({ key: 'fixed', title: 'Fixed' }),
  Object.freeze({ key: 'security', title: 'Security' }),
]);

function validTimestamp(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function standupStartTimestamp(task) {
  return validTimestamp(task?.started_at) ?? validTimestamp(task?.created_at);
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

export function standupDateRange(anchor = new Date(), dayCount = 1) {
  const { start } = periodRange('day', anchor);
  const days = Number(dayCount) === 2 ? 2 : 1;
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  return { start, end, dayCount: days };
}

export function tasksForStandupDays(tasks, anchor = new Date(), dayCount = 1) {
  const { start, end } = standupDateRange(anchor, dayCount);
  return (Array.isArray(tasks) ? tasks : [])
    .filter((task) => STANDUP_STATUSES.has(task?.status))
    .filter((task) => {
      const timestamp = standupStartTimestamp(task);
      return timestamp !== null && timestamp >= start.getTime() && timestamp < end.getTime();
    })
    .sort((left, right) => (
      standupStartTimestamp(left) - standupStartTimestamp(right)
      || Number(left?.id || 0) - Number(right?.id || 0)
    ));
}

export function tasksForStandupDay(tasks, anchor = new Date()) {
  return tasksForStandupDays(tasks, anchor, 1);
}

function cleanStandupItem(value) {
  return String(value || '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function emptyStandupSections() {
  return Object.fromEntries(STANDUP_CHANGELOG_SECTIONS.map(({ key }) => [key, []]));
}

function sectionKey(value) {
  const normalized = String(value || '').trim().toLocaleLowerCase();
  return STANDUP_CHANGELOG_SECTIONS.find(({ key, title }) => (
    key === normalized || title.toLocaleLowerCase() === normalized
  ))?.key || null;
}

function addStandupItem(sections, key, value) {
  const text = cleanStandupItem(value);
  if (!key || !text) return;
  const identity = text.toLocaleLowerCase();
  const duplicate = STANDUP_CHANGELOG_SECTIONS.some(({ key: candidate }) => (
    sections[candidate].some((item) => item.toLocaleLowerCase() === identity)
  ));
  if (!duplicate) sections[key].push(text);
}

export function standupSections(value) {
  const sections = emptyStandupSections();
  if (value && typeof value === 'object') {
    const hasStructuredItems = STANDUP_CHANGELOG_SECTIONS.some(({ key }) => Array.isArray(value[key]));
    if (hasStructuredItems) {
      for (const { key } of STANDUP_CHANGELOG_SECTIONS) {
        for (const item of value[key] || []) addStandupItem(sections, key, item);
      }
      return sections;
    }
    value = value.standup || value.copyText || '';
  }

  let activeSection = null;
  for (const rawLine of String(value || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const section = line.match(/^#{0,6}\s*(Added|Changed|Fixed|Security)\s*:?\s*$/i);
    if (section) {
      activeSection = sectionKey(section[1]);
      continue;
    }
    const bullet = line.match(/^(?:[-*+]|\d+[.)])\s+(.+)$/);
    if (bullet && activeSection) addStandupItem(sections, activeSection, bullet[1]);
  }
  return sections;
}

export function standupCopyText(value) {
  const sections = standupSections(value);
  return STANDUP_CHANGELOG_SECTIONS
    .filter(({ key }) => sections[key].length > 0)
    .map(({ key, title }) => `### ${title}\n\n${sections[key].map((item) => `- ${item}`).join('\n')}`)
    .join('\n\n');
}

export function standupCopyHtml(value) {
  const sections = standupSections(value);
  return STANDUP_CHANGELOG_SECTIONS
    .filter(({ key }) => sections[key].length > 0)
    .map(({ key, title }) => (
      `<div><p><strong>${escapeHtml(title)}</strong></p><ul>${sections[key]
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join('')}</ul></div>`
    ))
    .join('');
}

export function standupBullets(value) {
  const sections = standupSections(value);
  return STANDUP_CHANGELOG_SECTIONS.flatMap(({ key }) => sections[key]);
}
