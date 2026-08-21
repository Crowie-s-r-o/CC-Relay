export const MAX_DESKTOP_RELEASE_NOTES = 20;
export const MAX_DESKTOP_RELEASE_NOTE_LENGTH = 240;

const MAX_RELEASE_NOTES_SOURCE_LENGTH = 64 * 1024;
const DEFAULT_SECTION = 'Highlights';
const SECTION_NAMES = new Map([
  ['added', 'Added'],
  ['additions', 'Added'],
  ['features', 'Added'],
  ['new', 'Added'],
  ['changed', 'Changed'],
  ['changes', 'Changed'],
  ["what's changed", 'Changed'],
  ['improvements', 'Changed'],
  ['fixed', 'Fixed'],
  ['fixes', 'Fixed'],
  ['bug fixes', 'Fixed'],
  ['security', 'Security'],
  ['highlights', DEFAULT_SECTION],
]);

function decodeHtmlEntities(value) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return String(value || '').replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi,
    (match, decimal, hexadecimal, name) => {
      if (name) return named[name.toLowerCase()] ?? match;
      const point = Number.parseInt(decimal || hexadecimal, decimal ? 10 : 16);
      if (!Number.isInteger(point) || point < 0 || point > 0x10ffff) return ' ';
      try {
        return String.fromCodePoint(point);
      } catch {
        return ' ';
      }
    },
  );
}

function releaseNotesText(value) {
  return decodeHtmlEntities(String(value || '').slice(0, MAX_RELEASE_NOTES_SOURCE_LENGTH))
    .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, ' ')
    .replace(/<h[1-6]\b[^>]*>/gi, '\n### ')
    .replace(/<\/h[1-6]\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|p|ul|ol)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r\n?/g, '\n');
}

function cleanInlineText(value) {
  const text = decodeHtmlEntities(value)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_~]+/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\u2014/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= MAX_DESKTOP_RELEASE_NOTE_LENGTH) return text;
  return `${text.slice(0, MAX_DESKTOP_RELEASE_NOTE_LENGTH - 3).trimEnd()}...`;
}

function cleanSection(value) {
  const key = cleanInlineText(value)
    .replace(/[:.]$/, '')
    .trim()
    .toLowerCase();
  return SECTION_NAMES.get(key) || null;
}

function releaseNoteSources(value, version) {
  if (!Array.isArray(value)) return [value];
  if (value.some((entry) => entry && typeof entry === 'object' && 'text' in entry)) {
    return [];
  }
  const records = value.filter((entry) => entry && typeof entry === 'object' && 'note' in entry);
  const requestedVersion = String(version || '').trim().replace(/^v/i, '');
  const exact = records.find((entry) => (
    String(entry.version || '').trim().replace(/^v/i, '') === requestedVersion
  ));
  return exact ? [exact.note] : records.map((entry) => entry.note);
}

function addNote(notes, seen, section, value) {
  const text = cleanInlineText(value);
  if (!text || /^full changelog\b/i.test(text)) return;
  const key = text.toLocaleLowerCase('en-US');
  if (seen.has(key) || notes.length >= MAX_DESKTOP_RELEASE_NOTES) return;
  seen.add(key);
  notes.push({ section: cleanSection(section) || DEFAULT_SECTION, text });
}

/**
 * Converts GitHub Markdown, GitHub Atom HTML, or electron-updater ReleaseNoteInfo
 * objects into a small plain-text release brief for the renderer.
 */
export function normalizeDesktopReleaseNotes(value, { version = '' } = {}) {
  const notes = [];
  const seen = new Set();

  if (Array.isArray(value) && value.some((entry) => (
    entry && typeof entry === 'object' && 'text' in entry
  ))) {
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue;
      addNote(notes, seen, entry.section, entry.text);
    }
    return notes;
  }

  for (const source of releaseNoteSources(value, version)) {
    let section = DEFAULT_SECTION;
    for (const rawLine of releaseNotesText(source).split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const heading = /^#{1,6}\s+(.+)$/.exec(line);
      if (heading) {
        section = cleanSection(heading[1]) || DEFAULT_SECTION;
        continue;
      }
      const bullet = /^(?:[-+*]|\d+[.)])\s+(.+)$/.exec(line);
      if (bullet) {
        addNote(notes, seen, section, bullet[1]);
        continue;
      }
      addNote(notes, seen, section, line);
    }
  }

  return notes;
}
