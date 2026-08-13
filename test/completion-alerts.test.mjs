import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPLETION_SOUND_OPTIONS,
  CompletionAlerts,
  completionSpeechText,
  normalizeCompletionAlertPreferences,
  normalizeCompletionSpeechPreferences,
} from '../public/completion-alerts.js';

test('completion alert preferences expose distinct sounds and safe defaults', () => {
  assert.deepEqual(COMPLETION_SOUND_OPTIONS.map(({ id }) => id), ['none', 'chime', 'bell', 'pulse']);
  const defaultSpeech = { project: true, task: true, status: false, taskWords: 1 };
  assert.deepEqual(normalizeCompletionAlertPreferences(null), {
    sound: 'chime',
    speak: false,
    speech: defaultSpeech,
  });
  assert.deepEqual(normalizeCompletionAlertPreferences({ sound: 'pulse', speak: true }), {
    sound: 'pulse',
    speak: true,
    speech: defaultSpeech,
  });
  assert.deepEqual(normalizeCompletionAlertPreferences({ sound: 'unknown', speak: 1 }), {
    sound: 'chime',
    speak: false,
    speech: defaultSpeech,
  });
});

test('voice detail preferences stay bounded and always retain one spoken part', () => {
  assert.deepEqual(normalizeCompletionSpeechPreferences({
    project: false,
    task: true,
    status: true,
    taskWords: 3.4,
  }), { project: false, task: true, status: true, taskWords: 3 });
  assert.deepEqual(normalizeCompletionSpeechPreferences({
    project: false,
    task: false,
    status: false,
    taskWords: 99,
  }), { project: true, task: false, status: false, taskWords: 12 });
});

test('voice copy includes the configured parts and task word count', () => {
  assert.equal(completionSpeechText({ repo_path: '/work/relay/', title: 'Add completion sounds' }), 'relay. Add.');
  assert.equal(completionSpeechText({ repo_path: 'C:\\work\\alpha', prompt: 'Fix the queue' }), 'alpha. Fix.');
  assert.equal(completionSpeechText(
    { repo_path: '/work/relay/', title: 'Add completion sounds now' },
    {
      speech: { project: false, task: true, status: true, taskWords: 3 },
    },
  ), 'Add completion sounds. Task complete.');
  assert.equal(completionSpeechText(
    { repo_path: '/work/relay/', title: 'Add completion sounds' },
    {
      speech: { project: true, task: false, status: false, taskWords: 1 },
    },
  ), 'relay.');
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
  alerts.notify({ repo_path: '/work/relay', title: 'Add sounds now' }, {
    sound: 'bell',
    speak: true,
    speech: { project: true, task: true, status: true, taskWords: 2 },
  });
  await Promise.resolve();
  assert.deepEqual(sounds, ['bell']);
  assert.deepEqual(spoken, ['relay. Add sounds. Task complete.']);
});
