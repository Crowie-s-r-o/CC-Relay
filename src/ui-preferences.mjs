export const UI_PREFERENCES_SETTING = 'ui-layout-preferences';
export const DEFAULT_VOICE_INPUT_SHORTCUT = 'Control+Shift+Space';

const COMPLETION_SOUNDS = new Set(['none', 'chime', 'bell', 'pulse']);
const TERMINAL_WINDOW_VIEWS = new Set(['all', 'activity', 'conversation', 'mine', 'ai']);
const RUNNING_TASK_ROWS = new Set([1, 2, 3]);
const RUNNING_TASK_WIDTHS = new Set([230, 286, 360]);
const COMPLETION_SPEECH_MIN_WORDS = 1;
const COMPLETION_SPEECH_MAX_WORDS = 12;
const VOICE_SHORTCUT_MODIFIERS = ['Control', 'Alt', 'Shift', 'Meta'];
const VOICE_SHORTCUT_CODE = /^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1\d|2[0-4])|Space|CapsLock|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal))$/;

/*
 * Saved quick skills.
 *
 * `public/quick-skills.js` carries a byte-equivalent copy of these rules because nothing in
 * `src/` imports from `public/`. `test/quick-skills.test.mjs` holds the parity table that keeps
 * the two copies honest, the same arrangement `public/voice-input.js` already uses.
 */
const QUICK_SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_QUICK_SKILLS = 12;
const MAX_QUICK_SKILL_LABEL_LENGTH = 80;
const MAX_QUICK_SKILL_PROMPT_LENGTH = 20000;

export const DEFAULT_QUICK_SKILLS = Object.freeze([
  Object.freeze({
    id: 'deploy-check',
    label: 'Deploy check',
    prompt: `I want you to create me a full list of things we changed, it needs to be detailed so no change escapes it, it should basically compare with production and it should be a release-pdf with versions compared .. it's very important to have the sentences short (in bullet list) and the changes grouped by categories

it is for me to verify we did only changes which we wanted to, be sure to go through every changed line of code`,
  }),
]);

function normalizeQuickSkill(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const { id, label, prompt } = entry;
  if (typeof id !== 'string' || !QUICK_SKILL_ID_PATTERN.test(id)) return null;
  if (typeof label !== 'string' || typeof prompt !== 'string') return null;
  const cleanLabel = label.trim().replace(/\s+/gu, ' ');
  if (!cleanLabel || cleanLabel.length > MAX_QUICK_SKILL_LABEL_LENGTH) return null;
  // Newlines inside a prompt are meaningful, so only trailing whitespace is removed. `trimEnd`
  // rather than a `/\s+$/` replace: the regex backtracks quadratically on a long interior
  // whitespace run, and a twenty thousand character prompt is exactly that input.
  const cleanPrompt = prompt.trimEnd();
  if (!cleanPrompt || cleanPrompt.length > MAX_QUICK_SKILL_PROMPT_LENGTH) return null;
  // Unknown keys are stripped: the persisted record stays exactly the three-member shape.
  return { id, label: cleanLabel, prompt: cleanPrompt };
}

/*
 * A missing or non-array value means the operator never configured the strip, so the built-in
 * catalog answers. An array is authoritative even when empty, which is how an operator deletes
 * every saved skill permanently. Invalid entries are dropped, never fatal, so a malformed entry
 * can never make `normalizeUiPreferences` return null.
 *
 * The cap applies to survivors, not to input slots, so an invalid entry early in the list cannot
 * push a valid later entry out of the strip.
 */
export function normalizeQuickSkills(value) {
  if (!Array.isArray(value)) return DEFAULT_QUICK_SKILLS.map((skill) => ({ ...skill }));
  const seen = new Set();
  const skills = [];
  for (const entry of value) {
    if (skills.length >= MAX_QUICK_SKILLS) break;
    const skill = normalizeQuickSkill(entry);
    // Duplicate ids keep the first occurrence so display order stays the operator's order.
    if (!skill || seen.has(skill.id)) continue;
    seen.add(skill.id);
    skills.push(skill);
  }
  return skills;
}

function boundedNumber(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum
    ? Math.round(number)
    : null;
}

function completionSpeechWordLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return COMPLETION_SPEECH_MIN_WORDS;
  return Math.min(
    COMPLETION_SPEECH_MAX_WORDS,
    Math.max(COMPLETION_SPEECH_MIN_WORDS, Math.round(number)),
  );
}

function canonicalVoiceInputShortcut(value) {
  const parts = typeof value === 'string' ? value.split('+') : [];
  const code = parts.at(-1);
  if (!VOICE_SHORTCUT_CODE.test(code || '')) return null;
  const requestedModifiers = new Set(parts.slice(0, -1));
  if (
    requestedModifiers.size !== parts.length - 1
    || [...requestedModifiers].some((part) => !VOICE_SHORTCUT_MODIFIERS.includes(part))
  ) return null;
  return [
    ...VOICE_SHORTCUT_MODIFIERS.filter((modifier) => requestedModifiers.has(modifier)),
    code,
  ].join('+');
}

export function normalizeVoiceInputShortcut(value) {
  return canonicalVoiceInputShortcut(value) || DEFAULT_VOICE_INPUT_SHORTCUT;
}

export function normalizeVoiceInputPreferences(value) {
  const shortcut = normalizeVoiceInputShortcut(value?.shortcut);
  const alternateShortcut = canonicalVoiceInputShortcut(value?.alternateShortcut);
  const microphoneLabel = typeof value?.microphoneLabel === 'string'
    ? value.microphoneLabel.trim().replace(/\s+/g, ' ').slice(0, 200) || null
    : null;
  return {
    enabled: value?.enabled === true,
    shortcut,
    alternateShortcut: alternateShortcut === shortcut ? null : alternateShortcut,
    microphoneLabel,
  };
}

export function normalizeUiPreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const composer = boundedNumber(value.panelWidths?.composer, 400, 5000);
  const queue = boundedNumber(value.panelWidths?.queue, 360, 5000);
  const terminalHeight = boundedNumber(value.terminalHeight, 180, 5000);
  const headerPosition = value.headerPosition === 'bottom' ? 'bottom' : 'top';
  const terminalWindowView = TERMINAL_WINDOW_VIEWS.has(value.terminalWindowView)
    ? value.terminalWindowView
    : 'all';
  const completionSpeech = {
    project: value.completionAlerts?.speech?.project !== false,
    task: value.completionAlerts?.speech?.task !== false,
    status: value.completionAlerts?.speech?.status === true,
    taskWords: completionSpeechWordLimit(value.completionAlerts?.speech?.taskWords),
  };
  if (!completionSpeech.project && !completionSpeech.task && !completionSpeech.status) {
    completionSpeech.project = true;
  }
  const completionAlerts = {
    sound: COMPLETION_SOUNDS.has(value.completionAlerts?.sound)
      ? value.completionAlerts.sound
      : 'chime',
    speak: value.completionAlerts?.speak === true,
    speech: completionSpeech,
  };
  const requestedRunningTaskRows = Number(value.runningTaskLayout?.rows);
  const requestedRunningTaskWidth = Number(value.runningTaskLayout?.width);
  const runningTaskLayout = {
    rows: RUNNING_TASK_ROWS.has(requestedRunningTaskRows) ? requestedRunningTaskRows : 2,
    width: RUNNING_TASK_WIDTHS.has(requestedRunningTaskWidth) ? requestedRunningTaskWidth : 286,
  };
  const voiceInput = normalizeVoiceInputPreferences(value.voiceInput);
  const quickSkills = normalizeQuickSkills(value.quickSkills);
  if (composer == null || queue == null) return null;
  return {
    panelWidths: { composer, queue },
    terminalHeight,
    headerPosition,
    terminalWindowView,
    terminalMode: value.terminalMode === 'activity' ? 'activity' : 'native',
    runningTaskLayout,
    completionAlerts,
    voiceInput,
    quickSkills,
  };
}

export function parseUiPreferences(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return normalizeUiPreferences(JSON.parse(value));
  } catch {
    return null;
  }
}
