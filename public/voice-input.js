export const DEFAULT_VOICE_INPUT_SHORTCUT = 'Control+Shift+Space';

const SHORTCUT_MODIFIERS = ['Control', 'Alt', 'Shift', 'Meta'];
const SHORTCUT_CODE = /^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1\d|2[0-4])|Space|CapsLock|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal))$/;
const SILENT_OPUS_MAX_BYTES_PER_SECOND = 1_500;
const VOICE_SIGNAL_DETECTED_LEVEL = 0.008;
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

export async function enumerateVoiceInputDevices(mediaDevices = globalThis.navigator?.mediaDevices) {
  if (!mediaDevices?.enumerateDevices) return [];
  const devices = await mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device?.kind === 'audioinput' && device.deviceId)
    .map((device) => ({
      deviceId: String(device.deviceId),
      label: String(device.label || '').trim().replace(/\s+/g, ' ').slice(0, 200),
      isDefault: device.deviceId === 'default',
    }));
}

export async function discoverVoiceInputDevices(
  mediaDevices = globalThis.navigator?.mediaDevices,
  { requestPermission = false } = {},
) {
  const initialDevices = await enumerateVoiceInputDevices(mediaDevices).catch(() => []);
  if (
    !requestPermission
    || !mediaDevices?.getUserMedia
    || (initialDevices.length > 0 && initialDevices.every((device) => device.label))
  ) {
    return initialDevices;
  }

  let permissionStream = null;
  try {
    permissionStream = await mediaDevices.getUserMedia({ audio: true, video: false });
    return await enumerateVoiceInputDevices(mediaDevices);
  } catch {
    return initialDevices;
  } finally {
    stopTracks(permissionStream);
  }
}

export function voiceSignalLevel(samples) {
  if (!samples || !Number.isFinite(samples.length) || samples.length === 0) return 0;
  const unsigned = samples instanceof Uint8Array;
  let squares = 0;
  let count = 0;
  for (const sample of samples) {
    const value = Number(sample);
    if (!Number.isFinite(value)) continue;
    const normalized = unsigned ? (value - 128) / 128 : value;
    squares += normalized * normalized;
    count += 1;
  }
  return count > 0 ? Math.min(1, Math.sqrt(squares / count)) : 0;
}

export function voiceSignalDetected(level) {
  return Number.isFinite(level) && level >= VOICE_SIGNAL_DETECTED_LEVEL;
}

export function createVoiceSignalMonitor(stream, {
  AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
  onLevel = () => {},
  setIntervalFn = (callback, delay) => globalThis.setInterval(callback, delay),
  clearIntervalFn = (timer) => globalThis.clearInterval(timer),
} = {}) {
  if (!AudioContextClass || !stream) return null;
  let context;
  let source;
  let analyser;
  let timer = null;
  let stopped = false;
  let peakLevel = 0;
  try {
    context = new AudioContextClass();
    source = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.45;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const sampleLevel = () => {
      if (stopped) return;
      analyser.getFloatTimeDomainData(samples);
      const level = voiceSignalLevel(samples);
      peakLevel = Math.max(peakLevel, level);
      onLevel(level, peakLevel);
    };
    void context.resume?.().catch?.(() => {});
    sampleLevel();
    timer = setIntervalFn(sampleLevel, 80);
  } catch {
    try {
      source?.disconnect?.();
      void context?.close?.().catch?.(() => {});
    } catch {}
    return null;
  }
  return {
    get peakLevel() {
      return peakLevel;
    },
    stop() {
      if (stopped) return peakLevel;
      stopped = true;
      if (timer != null) clearIntervalFn(timer);
      try {
        source?.disconnect?.();
        analyser?.disconnect?.();
        void context?.close?.().catch?.(() => {});
      } catch {}
      return peakLevel;
    },
  };
}

export function voiceRecordingLooksSilent(audio, durationMs) {
  if (!(audio instanceof Blob) || !Number.isFinite(durationMs) || durationMs < 400) return false;
  const mimeType = String(audio.type || '').toLowerCase();
  if (!mimeType.includes('webm') && !mimeType.includes('ogg')) return false;
  // Live voiced clips were above 10 KB/s while the unfed virtual input stayed below 1 KB/s.
  return (audio.size * 1000) / durationMs < SILENT_OPUS_MAX_BYTES_PER_SECOND;
}

function stopTracks(stream) {
  for (const track of stream?.getTracks?.() || []) track.stop();
}

export class PushToTalkRecorder {
  constructor({
    mediaDevices = globalThis.navigator?.mediaDevices,
    MediaRecorderClass = globalThis.MediaRecorder,
    AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
    preferredDeviceLabel = null,
    now = () => globalThis.performance?.now?.() ?? Date.now(),
    setIntervalFn = (callback, delay) => globalThis.setInterval(callback, delay),
    clearIntervalFn = (timer) => globalThis.clearInterval(timer),
    onState = () => {},
    onDevice = () => {},
    onLevel = () => {},
    onAudio = () => {},
    onError = () => {},
  } = {}) {
    this.mediaDevices = mediaDevices;
    this.MediaRecorderClass = MediaRecorderClass;
    this.AudioContextClass = AudioContextClass;
    this.preferredDeviceLabel = preferredDeviceLabel;
    this.now = now;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.onState = onState;
    this.onDevice = onDevice;
    this.onLevel = onLevel;
    this.onAudio = onAudio;
    this.onError = onError;
    this.held = false;
    this.session = 0;
    this.recorder = null;
    this.stream = null;
    this.signalMonitor = null;
  }

  setPreferredDeviceLabel(value) {
    this.preferredDeviceLabel = typeof value === 'string' && value.trim()
      ? value.trim().replace(/\s+/g, ' ').slice(0, 200)
      : null;
  }

  async _openStream() {
    const baseAudio = {
      autoGainControl: true,
      channelCount: { ideal: 1 },
      echoCancellation: true,
      noiseSuppression: true,
    };
    let selected = null;
    if (this.preferredDeviceLabel) {
      const devices = await enumerateVoiceInputDevices(this.mediaDevices).catch(() => []);
      selected = devices.find((device) => (
        !device.isDefault && device.label === this.preferredDeviceLabel
      )) || devices.find((device) => device.label === this.preferredDeviceLabel);
    }
    const stream = await this.mediaDevices.getUserMedia({
      audio: selected
        ? { ...baseAudio, deviceId: { exact: selected.deviceId } }
        : baseAudio,
      video: false,
    });
    if (!this.preferredDeviceLabel || selected) return stream;

    // A later Electron launch uses a new loopback origin. Chromium can hide device labels on that
    // origin until its first granted stream, so resolve the durable label once more before capture.
    const revealedDevices = await enumerateVoiceInputDevices(this.mediaDevices).catch(() => []);
    selected = revealedDevices.find((device) => (
      !device.isDefault && device.label === this.preferredDeviceLabel
    )) || revealedDevices.find((device) => device.label === this.preferredDeviceLabel);
    const currentLabel = String(stream.getAudioTracks?.()[0]?.label || '').trim();
    if (!selected || currentLabel === this.preferredDeviceLabel) return stream;
    try {
      const selectedStream = await this.mediaDevices.getUserMedia({
        audio: { ...baseAudio, deviceId: { exact: selected.deviceId } },
        video: false,
      });
      stopTracks(stream);
      return selectedStream;
    } catch {
      return stream;
    }
  }

  _startSignalMonitor(stream) {
    this.signalMonitor = createVoiceSignalMonitor(stream, {
      AudioContextClass: this.AudioContextClass,
      onLevel: this.onLevel,
      setIntervalFn: this.setIntervalFn,
      clearIntervalFn: this.clearIntervalFn,
    });
  }

  _stopSignalMonitor() {
    const monitor = this.signalMonitor;
    this.signalMonitor = null;
    return monitor?.stop?.() || 0;
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
      stream = await this._openStream();
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
      const track = stream.getAudioTracks?.()[0] || stream.getTracks?.()[0] || null;
      const deviceLabel = String(track?.label || '').trim().replace(/\s+/g, ' ').slice(0, 200);
      const startedAt = this.now();
      this.stream = stream;
      this.recorder = recorder;
      this.onDevice({
        label: deviceLabel,
        requestedLabel: this.preferredDeviceLabel,
      });
      this._startSignalMonitor(stream);
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener('error', (event) => {
        if (session !== this.session) return;
        this.session += 1;
        this.held = false;
        if (this.recorder === recorder) this.recorder = null;
        if (this.stream === stream) this.stream = null;
        this._stopSignalMonitor();
        stopTracks(stream);
        if (recorder.state === 'recording') recorder.stop();
        this.onState('idle');
        this.onError(event.error || new Error('Microphone recording failed.'));
      }, { once: true });
      recorder.addEventListener('stop', () => {
        const recordedType = recorder.mimeType || mimeType || chunks[0]?.type || '';
        const audio = new Blob(chunks, { type: recordedType });
        const durationMs = Math.max(0, this.now() - startedAt);
        const peakSignalLevel = this._stopSignalMonitor();
        stopTracks(stream);
        if (this.recorder === recorder) this.recorder = null;
        if (this.stream === stream) this.stream = null;
        if (session !== this.session) return;
        this.held = false;
        if (audio.size > 0) {
          this.onState('captured');
          this.onAudio(audio, { deviceLabel, durationMs, peakSignalLevel });
        } else {
          this.onState('idle');
          this.onError(new Error(deviceLabel
            ? `${deviceLabel} captured no microphone audio.`
            : 'No microphone audio was captured.'));
        }
      }, { once: true });
      recorder.start();
      this.onState('listening');
      return true;
    } catch (error) {
      this._stopSignalMonitor();
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
    this._stopSignalMonitor();
    if (recorder?.state === 'recording') recorder.stop();
    stopTracks(stream);
    this.onState('idle');
  }
}
