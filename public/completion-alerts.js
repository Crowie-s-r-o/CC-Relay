export const COMPLETION_SOUND_OPTIONS = Object.freeze([
  { id: 'none', label: 'Silent' },
  { id: 'chime', label: 'Gentle chime' },
  { id: 'bell', label: 'Bright bell' },
  { id: 'pulse', label: 'Digital pulse' },
]);

const COMPLETION_SOUND_IDS = new Set(COMPLETION_SOUND_OPTIONS.map(({ id }) => id));

export function normalizeCompletionAlertPreferences(value) {
  return {
    sound: COMPLETION_SOUND_IDS.has(value?.sound) ? value.sound : 'chime',
    speak: value?.speak === true,
  };
}

function lastPathPart(path) {
  const clean = String(path || '').replace(/[\\/]+$/, '');
  return clean.split(/[\\/]/).filter(Boolean).pop() || 'Project';
}

function firstWord(value) {
  return String(value || '').match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/u)?.[0] || 'task';
}

export function completionSpeechText(task) {
  const project = lastPathPart(task?.repo_path);
  const taskWord = firstWord(task?.title || task?.prompt);
  return `${project}. ${taskWord}.`;
}

function audioContextConstructor(windowObject) {
  return windowObject?.AudioContext || windowObject?.webkitAudioContext || null;
}

export class CompletionAlerts {
  constructor({ windowObject = globalThis.window } = {}) {
    this.windowObject = windowObject;
    this.audioContext = null;
  }

  context() {
    if (this.audioContext) return this.audioContext;
    const AudioContext = audioContextConstructor(this.windowObject);
    if (!AudioContext) return null;
    this.audioContext = new AudioContext();
    return this.audioContext;
  }

  tone(context, { frequency, start, duration, gain = 0.075, type = 'sine' }) {
    const oscillator = context.createOscillator();
    const volume = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    volume.gain.setValueAtTime(0.0001, start);
    volume.gain.exponentialRampToValueAtTime(gain, start + 0.012);
    volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(volume);
    volume.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  async playSound(sound) {
    if (sound === 'none') return;
    const context = this.context();
    if (!context) return;
    try {
      if (context.state === 'suspended') await context.resume();
      const start = context.currentTime + 0.025;
      if (sound === 'bell') {
        this.tone(context, { frequency: 880, start, duration: 0.55, gain: 0.06, type: 'triangle' });
        this.tone(context, { frequency: 1760, start, duration: 0.38, gain: 0.025, type: 'sine' });
        return;
      }
      if (sound === 'pulse') {
        this.tone(context, { frequency: 523.25, start, duration: 0.09, gain: 0.045, type: 'square' });
        this.tone(context, { frequency: 659.25, start: start + 0.11, duration: 0.11, gain: 0.045, type: 'square' });
        this.tone(context, { frequency: 783.99, start: start + 0.24, duration: 0.14, gain: 0.04, type: 'square' });
        return;
      }
      this.tone(context, { frequency: 659.25, start, duration: 0.22, gain: 0.055 });
      this.tone(context, { frequency: 987.77, start: start + 0.14, duration: 0.38, gain: 0.065 });
    } catch {
      // A browser can deny audio before the first user gesture. Completion must still proceed.
    }
  }

  speak(task) {
    const speech = this.windowObject?.speechSynthesis;
    const Utterance = this.windowObject?.SpeechSynthesisUtterance;
    if (!speech || !Utterance) return;
    try {
      const utterance = new Utterance(completionSpeechText(task));
      utterance.rate = 1.05;
      utterance.pitch = 1;
      speech.speak(utterance);
    } catch {
      // Voice support is optional and must never interfere with refreshing task state.
    }
  }

  notify(task, preferences) {
    const normalized = normalizeCompletionAlertPreferences(preferences);
    void this.playSound(normalized.sound);
    if (normalized.speak) this.speak(task);
  }
}
