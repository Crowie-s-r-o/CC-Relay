export const UI_PREFERENCES_SETTING = 'ui-layout-preferences';
export const DEFAULT_VOICE_INPUT_SHORTCUT = 'Control+Shift+Space';

const COMPLETION_SOUNDS = new Set(['none', 'chime', 'bell', 'pulse']);
const RUNNING_TASK_ROWS = new Set([1, 2, 3]);
const RUNNING_TASK_WIDTHS = new Set([230, 286, 360]);
const COMPLETION_SPEECH_MIN_WORDS = 1;
const COMPLETION_SPEECH_MAX_WORDS = 12;
const VOICE_SHORTCUT_MODIFIERS = ['Control', 'Alt', 'Shift', 'Meta'];
const VOICE_SHORTCUT_CODE = /^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1\d|2[0-4])|Space|CapsLock|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal))$/;

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
    rows: RUNNING_TASK_ROWS.has(requestedRunningTaskRows) ? requestedRunningTaskRows : 1,
    width: RUNNING_TASK_WIDTHS.has(requestedRunningTaskWidth) ? requestedRunningTaskWidth : 286,
  };
  const voiceInput = normalizeVoiceInputPreferences(value.voiceInput);
  if (composer == null || queue == null) return null;
  return {
    panelWidths: { composer, queue },
    terminalHeight,
    headerPosition,
    runningTaskLayout,
    completionAlerts,
    voiceInput,
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
