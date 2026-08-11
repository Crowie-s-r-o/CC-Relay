import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPLETION_SOUND_OPTIONS,
  CompletionAlerts,
  completionSpeechText,
  normalizeCompletionAlertPreferences,
} from '../public/completion-alerts.js';

test('completion alert preferences expose distinct sounds and safe defaults', () => {
  assert.deepEqual(COMPLETION_SOUND_OPTIONS.map(({ id }) => id), ['none', 'chime', 'bell', 'pulse']);
  assert.deepEqual(normalizeCompletionAlertPreferences(null), { sound: 'chime', speak: false });
  assert.deepEqual(normalizeCompletionAlertPreferences({ sound: 'pulse', speak: true }), { sound: 'pulse', speak: true });
  assert.deepEqual(normalizeCompletionAlertPreferences({ sound: 'unknown', speak: 1 }), { sound: 'chime', speak: false });
});

test('voice copy uses the project folder and first word of the task name', () => {
  assert.equal(completionSpeechText({ repo_path: '/work/relay/', title: 'Add completion sounds' }), 'relay. Add.');
  assert.equal(completionSpeechText({ repo_path: 'C:\\work\\alpha', prompt: 'Fix the queue' }), 'alpha. Fix.');
});

test('notification can combine a sound with the short voice phrase', async () => {
  const spoken = [];
  class Utterance {
    constructor(text) { this.text = text; }
  }
  const alerts = new CompletionAlerts({
    windowObject: {
      speechSynthesis: { speak: (utterance) => spoken.push(utterance.text) },
      SpeechSynthesisUtterance: Utterance,
    },
  });
  const sounds = [];
  alerts.playSound = async (sound) => sounds.push(sound);
  alerts.notify({ repo_path: '/work/relay', title: 'Add sounds' }, { sound: 'bell', speak: true });
  await Promise.resolve();
  assert.deepEqual(sounds, ['bell']);
  assert.deepEqual(spoken, ['relay. Add.']);
});
