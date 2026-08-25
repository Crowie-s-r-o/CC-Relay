export const DEFAULT_VOICE_INPUT_SHORTCUT = 'Control+Shift+Space';

const SHORTCUT_MODIFIERS = ['Control', 'Alt', 'Shift', 'Meta'];
const SHORTCUT_CODE = /^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1\d|2[0-4])|Space|CapsLock|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal))$/;
const CODE_LABELS = {
  Space: 'Space',
  CapsLock: 'Caps Lock',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  NumpadAdd: 'Numpad +',
  NumpadSubtract: 'Numpad -',
  NumpadMultiply: 'Numpad ×',
  NumpadDivide: 'Numpad /',
  NumpadDecimal: 'Numpad .',
};

function shortcutParts(value) {
  const parts = typeof value === 'string' ? value.split('+') : [];
  return {
    modifiers: parts.slice(0, -1),
    code: parts.at(-1) || '',
  };
}

function canonicalVoiceInputShortcut(value) {
  const { modifiers, code } = shortcutParts(value);
  if (!SHORTCUT_CODE.test(code)) return null;
  const requested = new Set(modifiers);
  if (
    requested.size !== modifiers.length
    || [...requested].some((modifier) => !SHORTCUT_MODIFIERS.includes(modifier))
  ) return null;
  return [
    ...SHORTCUT_MODIFIERS.filter((modifier) => requested.has(modifier)),
    code,
  ].join('+');
}

export function normalizeVoiceInputShortcut(value) {
  return canonicalVoiceInputShortcut(value) || DEFAULT_VOICE_INPUT_SHORTCUT;
}

export function normalizeVoiceInputPreferences(value) {
  const shortcut = normalizeVoiceInputShortcut(value?.shortcut);
  const alternateShortcut = canonicalVoiceInputShortcut(value?.alternateShortcut);
  return {
    enabled: value?.enabled === true,
    shortcut,
    alternateShortcut: alternateShortcut === shortcut ? null : alternateShortcut,
  };
}

export function voiceShortcutFromKeyboardEvent(event) {
  const code = String(event?.code || '');
  if (!SHORTCUT_CODE.test(code) || event?.isComposing) return null;
  return [
    ...(event.ctrlKey ? ['Control'] : []),
    ...(event.altKey ? ['Alt'] : []),
    ...(event.shiftKey ? ['Shift'] : []),
    ...(event.metaKey ? ['Meta'] : []),
    code,
  ].join('+');
}

export function voiceShortcutMatches(event, shortcut) {
  if (event?.type && event.type !== 'keydown') return false;
  const normalized = normalizeVoiceInputShortcut(shortcut);
  const expected = shortcutParts(normalized);
  const modifiers = new Set(expected.modifiers);
  return event?.code === expected.code
    && Boolean(event.ctrlKey) === modifiers.has('Control')
    && Boolean(event.altKey) === modifiers.has('Alt')
    && Boolean(event.shiftKey) === modifiers.has('Shift')
    && Boolean(event.metaKey) === modifiers.has('Meta')
    && !event.isComposing;
}

export function voiceShortcutReleased(event, shortcut) {
  if (event?.type && event.type !== 'keyup') return false;
  const { modifiers, code } = shortcutParts(normalizeVoiceInputShortcut(shortcut));
  const releasedModifier = {
    ControlLeft: 'Control',
    ControlRight: 'Control',
    AltLeft: 'Alt',
    AltRight: 'Alt',
    ShiftLeft: 'Shift',
    ShiftRight: 'Shift',
    MetaLeft: 'Meta',
    MetaRight: 'Meta',
  }[event?.code];
  return event?.code === code || Boolean(releasedModifier && modifiers.includes(releasedModifier));
}

export function voiceShortcutKeyLabels(shortcut, platform = '') {
  const { modifiers, code } = shortcutParts(normalizeVoiceInputShortcut(shortcut));
  const mac = platform === 'MacIntel' || platform === 'MacARM' || platform === 'macOS';
  const labels = modifiers.map((modifier) => ({
    Control: mac ? '⌃' : 'Ctrl',
    Alt: mac ? '⌥' : 'Alt',
    Shift: mac ? '⇧' : 'Shift',
    Meta: mac ? '⌘' : 'Meta',
  })[modifier]);
  const codeLabel = CODE_LABELS[code]
    || code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad(?=\d)/, 'Numpad ');
  return [...labels, codeLabel];
}

export function voiceShortcutLabel(shortcut, platform = '') {
  const labels = voiceShortcutKeyLabels(shortcut, platform);
  const mac = platform === 'MacIntel' || platform === 'MacARM' || platform === 'macOS';
  return labels.join(mac ? '' : '+');
}

export function preferredVoiceMimeType(MediaRecorderClass = globalThis.MediaRecorder) {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  return candidates.find((mimeType) => MediaRecorderClass?.isTypeSupported?.(mimeType)) || '';
}

function stopTracks(stream) {
  for (const track of stream?.getTracks?.() || []) track.stop();
}

export class PushToTalkRecorder {
  constructor({
    mediaDevices = globalThis.navigator?.mediaDevices,
    MediaRecorderClass = globalThis.MediaRecorder,
    onState = () => {},
    onAudio = () => {},
    onError = () => {},
  } = {}) {
    this.mediaDevices = mediaDevices;
    this.MediaRecorderClass = MediaRecorderClass;
    this.onState = onState;
    this.onAudio = onAudio;
    this.onError = onError;
    this.held = false;
    this.session = 0;
    this.recorder = null;
    this.stream = null;
  }

  async press() {
    if (this.held || this.recorder) return false;
    if (!this.mediaDevices?.getUserMedia || !this.MediaRecorderClass) {
      this.onError(new Error('Microphone recording is unavailable in this browser.'));
      return false;
    }
    this.held = true;
    const session = ++this.session;
    this.onState('requesting');
    let stream;
    try {
      stream = await this.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
    } catch (error) {
      if (session === this.session) {
        this.held = false;
        this.onState('idle');
        this.onError(error);
      }
      return false;
    }
    if (session !== this.session || !this.held) {
      stopTracks(stream);
      this.onState('idle');
      return false;
    }

    const mimeType = preferredVoiceMimeType(this.MediaRecorderClass);
    try {
      const chunks = [];
      const recorder = new this.MediaRecorderClass(stream, mimeType ? { mimeType } : undefined);
      this.stream = stream;
      this.recorder = recorder;
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener('error', (event) => {
        if (session !== this.session) return;
        this.session += 1;
        this.held = false;
        if (this.recorder === recorder) this.recorder = null;
        if (this.stream === stream) this.stream = null;
        stopTracks(stream);
        if (recorder.state === 'recording') recorder.stop();
        this.onState('idle');
        this.onError(event.error || new Error('Microphone recording failed.'));
      }, { once: true });
      recorder.addEventListener('stop', () => {
        const recordedType = recorder.mimeType || mimeType || chunks[0]?.type || '';
        const audio = new Blob(chunks, { type: recordedType });
        stopTracks(stream);
        if (this.recorder === recorder) this.recorder = null;
        if (this.stream === stream) this.stream = null;
        if (session !== this.session) return;
        this.held = false;
        if (audio.size > 0) {
          this.onState('captured');
          this.onAudio(audio);
        } else {
          this.onState('idle');
          this.onError(new Error('No microphone audio was captured.'));
        }
      }, { once: true });
      recorder.start();
      this.onState('listening');
      return true;
    } catch (error) {
      stopTracks(stream);
      this.stream = null;
      this.recorder = null;
      this.held = false;
      this.onState('idle');
      this.onError(error);
      return false;
    }
  }

  release() {
    if (!this.held && this.recorder?.state !== 'recording') return false;
    this.held = false;
    if (this.recorder?.state === 'recording') {
      this.onState('processing');
      this.recorder.stop();
    } else {
      this.onState('idle');
    }
    return true;
  }

  cancel() {
    this.held = false;
    this.session += 1;
    const recorder = this.recorder;
    const stream = this.stream;
    this.recorder = null;
    this.stream = null;
    if (recorder?.state === 'recording') recorder.stop();
    stopTracks(stream);
    this.onState('idle');
  }
}
