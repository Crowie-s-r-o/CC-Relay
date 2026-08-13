export const CHANGELOG_SECTION_ORDER = Object.freeze([
  Object.freeze(['added', 'Added']),
  Object.freeze(['changed', 'Changed']),
  Object.freeze(['fixed', 'Fixed']),
  Object.freeze(['security', 'Security']),
]);

export const MAX_CHANGELOG_NOTE_LENGTH = 180;

export const changelogNotesSchema = {
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries(CHANGELOG_SECTION_ORDER.map(([key]) => [key, {
    type: 'array',
    items: {
      type: 'string',
      minLength: 1,
      maxLength: MAX_CHANGELOG_NOTE_LENGTH,
    },
  }])),
  required: CHANGELOG_SECTION_ORDER.map(([key]) => key),
};

function extractJsonObject(output) {
  const text = String(output || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end < start) throw new Error('The AI response did not contain a JSON object.');
  return JSON.parse(text.slice(start, end + 1));
}

function cleanNote(value, { collectionLabel, itemLabel }) {
  const source = String(value || '');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(source)) {
    throw new Error(`${collectionLabel} must not contain control characters.`);
  }
  let text = source
    .replace(/\u2014/g, ' - ')
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (
    /(?:https?:\/\/|www\.)/i.test(text)
    || /!?\[[^\]]*\]\([^)]*\)/.test(text)
    || /<\/?[a-z!][^>]*>/i.test(text)
  ) {
    throw new Error(`${collectionLabel} must be plain text without links or HTML.`);
  }
  if (!/[.!?)]$/.test(text)) text = `${text}.`;
  if (text.length > MAX_CHANGELOG_NOTE_LENGTH) {
    throw new Error(`${itemLabel} exceeds ${MAX_CHANGELOG_NOTE_LENGTH} characters.`);
  }
  return text;
}

export function normalizeChangelogNotes(output, {
  collectionLabel = 'AI changelog notes',
  itemLabel = 'AI changelog note',
} = {}) {
  const parsed = typeof output === 'string' ? extractJsonObject(output) : output;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${collectionLabel} must be a JSON object.`);
  }
  const allowed = new Set(CHANGELOG_SECTION_ORDER.map(([key]) => key));
  const unexpected = Object.keys(parsed).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new Error(`${collectionLabel} contain unsupported sections: ${unexpected.join(', ')}`);
  }

  const normalized = {};
  const seen = new Set();
  for (const [key] of CHANGELOG_SECTION_ORDER) {
    if (!Array.isArray(parsed[key])) throw new Error(`${collectionLabel} must include a ${key} array.`);
    normalized[key] = [];
    for (const value of parsed[key]) {
      if (typeof value !== 'string') throw new Error(`${itemLabel} in ${key} is not text.`);
      const note = cleanNote(value, { collectionLabel, itemLabel });
      if (!note) continue;
      const identity = note.toLocaleLowerCase();
      if (seen.has(identity)) continue;
      seen.add(identity);
      normalized[key].push(note);
    }
  }
  if (seen.size === 0) throw new Error(`The AI completed without any usable ${itemLabel.replace(/^AI\s+/i, '').replace(/\s+note$/, ' notes')}.`);
  return normalized;
}

export function formatChangelogSections(notes) {
  const lines = [];
  for (const [key, title] of CHANGELOG_SECTION_ORDER) {
    const items = Array.isArray(notes?.[key]) ? notes[key] : [];
    if (items.length === 0) continue;
    if (lines.length > 0) lines.push('');
    lines.push(`### ${title}`, '', ...items.map((item) => `- ${item}`));
  }
  return lines.join('\n');
}
