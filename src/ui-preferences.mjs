export const UI_PREFERENCES_SETTING = 'ui-layout-preferences';

const COMPLETION_SOUNDS = new Set(['none', 'chime', 'bell', 'pulse']);
const RUNNING_TASK_ROWS = new Set([1, 2, 3]);
const RUNNING_TASK_WIDTHS = new Set([230, 286, 360]);
const COMPLETION_SPEECH_MIN_WORDS = 1;
const COMPLETION_SPEECH_MAX_WORDS = 12;

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
  if (composer == null || queue == null) return null;
  return {
    panelWidths: { composer, queue },
    terminalHeight,
    headerPosition,
    runningTaskLayout,
    completionAlerts,
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
