// Claude Code blocks interactive startup in a workspace that has not been trusted yet. Relay
// may answer only the exact prompt shape below. Broad prose matching is intentionally excluded,
// because a resumed conversation can quote this dialog in its transcript.

const ANSI_SEQUENCE_PATTERN = new RegExp('\\u001b\\[[0-9;?]*[a-zA-Z]', 'g');
const SCREEN_CONTROL_CHARACTER_PATTERN = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]', 'g');
const CLAUDE_TRUST_SCREEN_TAIL_CHARS = 8_000;
const CLAUDE_TRUST_SCREEN_TAIL_LINES = 60;

export const CLAUDE_TRUST_DIALOG_KEYS = '1';
export const CLAUDE_TRUST_DIALOG_OPTION_PATTERN = /^\s*(?:❯\s*)?([123])[.)]\s+(Yes, I trust this folder|No, continue without these permissions|No, exit!?)$/i;
export const CLAUDE_TRUST_DIALOG_HEADING_PATTERN = /^Accessing workspace:$/i;
export const CLAUDE_TRUST_DIALOG_FOOTER_PATTERN = /enter to confirm/i;
export const CLAUDE_TRUST_DIALOG_POINTER_PATTERN = /^\s*❯/;

function normalizeTrustScreenLine(line) {
  return String(line ?? '')
    .replace(ANSI_SEQUENCE_PATTERN, '')
    .replace(SCREEN_CONTROL_CHARACTER_PATTERN, '')
    .replace(/^[\s│┃|┆┇┊┋]+/, '')
    .replace(/[\s│┃|┆┇┊┋]+$/, '');
}

function trustScreenLines(text) {
  if (typeof text !== 'string' || !text) return [];
  const bounded = text.length > CLAUDE_TRUST_SCREEN_TAIL_CHARS
    ? text.slice(-CLAUDE_TRUST_SCREEN_TAIL_CHARS)
    : text;
  return bounded
    .split(/\r?\n/)
    .map(normalizeTrustScreenLine)
    .filter((line) => line !== '')
    .slice(-CLAUDE_TRUST_SCREEN_TAIL_LINES);
}

function normalizedTrustLabel(value) {
  return String(value || '').trim().replace(/[!.]+$/, '').toLowerCase();
}

export function claudeFolderTrustDialogDetails(text) {
  const lines = Array.isArray(text)
    ? text.map(normalizeTrustScreenLine).filter((line) => line !== '')
    : trustScreenLines(text);
  if (lines.length === 0) return null;

  // These three pieces identify the actual safety prompt rather than a generic numbered picker.
  // The explanatory sentence can wrap differently at every terminal width, so the joined frame
  // is checked while the title stays line anchored.
  if (!lines.some((line) => CLAUDE_TRUST_DIALOG_HEADING_PATTERN.test(line))) return null;
  const joined = lines.join(' ');
  if (!/Quick safety check:\s*Is this a project you created or one you trust\?/i.test(joined)) return null;
  if (!/Claude Code(?:'|’)?ll be able to read, edit, and execute files here\./i.test(joined)) return null;
  if (!lines.some((line) => CLAUDE_TRUST_DIALOG_FOOTER_PATTERN.test(line))) return null;

  // A real prompt has no active composer chrome. This rejects a byte-for-byte quotation above a
  // live composer, where sending "1" would otherwise submit an unrelated one-character turn.
  if (lines.some((line) => (
    /shift\+tab to cycle/i.test(line)
    || /paste again to expand/i.test(line)
    || /Press Ctrl-C again to exit/i.test(line)
    || /bypass permissions on/i.test(line)
  ))) {
    return null;
  }

  const options = new Map();
  let pointed = false;
  for (const line of lines) {
    const match = CLAUDE_TRUST_DIALOG_OPTION_PATTERN.exec(line);
    if (!match) continue;
    options.set(Number(match[1]), normalizedTrustLabel(match[2]));
    if (CLAUDE_TRUST_DIALOG_POINTER_PATTERN.test(line)) pointed = true;
  }
  if (!pointed || options.get(1) !== 'yes, i trust this folder') return null;

  const legacy = options.size === 2 && options.get(2) === 'no, exit';
  const current = options.size === 3
    && options.get(2) === 'no, continue without these permissions'
    && options.get(3) === 'no, exit';
  if (!legacy && !current) return null;

  return { variant: current ? 'current' : 'legacy', options };
}

export function isClaudeTrustDialogScreen(text) {
  return claudeFolderTrustDialogDetails(text) !== null;
}
