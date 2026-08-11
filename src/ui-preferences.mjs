export const UI_PREFERENCES_SETTING = 'ui-layout-preferences';

const COMPLETION_SOUNDS = new Set(['none', 'chime', 'bell', 'pulse']);

function boundedNumber(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum
    ? Math.round(number)
    : null;
}

export function normalizeUiPreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const composer = boundedNumber(value.panelWidths?.composer, 400, 5000);
  const queue = boundedNumber(value.panelWidths?.queue, 360, 5000);
  const terminalHeight = boundedNumber(value.terminalHeight, 180, 5000);
  const headerPosition = value.headerPosition === 'bottom' ? 'bottom' : 'top';
  const completionAlerts = {
    sound: COMPLETION_SOUNDS.has(value.completionAlerts?.sound)
      ? value.completionAlerts.sound
      : 'chime',
    speak: value.completionAlerts?.speak === true,
  };
  if (composer == null || queue == null) return null;
  return {
    panelWidths: { composer, queue },
    terminalHeight,
    headerPosition,
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
