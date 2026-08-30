import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';
import {
  createVoiceSignalMonitor,
  discoverVoiceInputDevices,
  enumerateVoiceInputDevices,
  PushToTalkRecorder,
  normalizeVoiceInputPreferences,
  preferredVoiceMimeType,
  voiceRecordingLooksSilent,
  voiceSignalDetected,
  voiceSignalLevel,
  voiceShortcutFromKeyboardEvent,
  voiceShortcutKeyLabels,
  voiceShortcutLabel,
  voiceShortcutMatches,
  voiceShortcutReleased,
} from '../public/voice-input.js';
import {
  configureDesktopPermissions,
  desktopPermissionAllowed,
} from '../src/desktop-microphone.mjs';
import {
  FASTER_WHISPER_VERSION,
  MAX_VOICE_AUDIO_BYTES,
  VOICE_INPUT_MODEL,
  VoiceInputService,
  parsePythonVersion,
  voiceInputAudioExtension,
} from '../src/voice-input-service.mjs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
const electron = readFileSync(new URL('../src/electron-main.mjs', import.meta.url), 'utf8');
const builder = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8');
const helper = readFileSync(new URL('../src/faster-whisper-worker.py', import.meta.url), 'utf8');

function keyEvent(code, overrides = {}) {
  return {
    type: 'keydown',
    code,
    key: code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    ...overrides,
  };
}

test('voice shortcuts are configurable, exact, and stop on any required key release', () => {
  const captured = voiceShortcutFromKeyboardEvent(keyEvent('KeyV', {
    ctrlKey: true,
    shiftKey: true,
  }));
  assert.equal(captured, 'Control+Shift+KeyV');
  assert.deepEqual(normalizeVoiceInputPreferences({ enabled: true, shortcut: captured }), {
    enabled: true,
    shortcut: captured,
    alternateShortcut: null,
    microphoneLabel: null,
  });
  assert.deepEqual(normalizeVoiceInputPreferences({
    enabled: true,
    shortcut: captured,
    alternateShortcut: 'F5',
  }), {
    enabled: true,
    shortcut: captured,
    alternateShortcut: 'F5',
    microphoneLabel: null,
  });
  assert.equal(voiceShortcutMatches(keyEvent('KeyV', {
    ctrlKey: true,
    shiftKey: true,
  }), captured), true);
  assert.equal(voiceShortcutMatches(keyEvent('KeyV', { ctrlKey: true }), captured), false);
  assert.equal(voiceShortcutMatches(keyEvent('KeyB', {
    ctrlKey: true,
    shiftKey: true,
  }), captured), false);
  assert.equal(voiceShortcutReleased(keyEvent('KeyV', { type: 'keyup' }), captured), true);
  assert.equal(voiceShortcutReleased(keyEvent('ShiftLeft', { type: 'keyup' }), captured), true);
  assert.equal(voiceShortcutReleased(keyEvent('AltLeft', { type: 'keyup' }), captured), false);
  assert.equal(voiceShortcutLabel('Control+Shift+Space', 'MacIntel'), '⌃⇧Space');
  assert.equal(voiceShortcutLabel('Control+Shift+Space', 'Win32'), 'Ctrl+Shift+Space');
  assert.deepEqual(voiceShortcutKeyLabels('Control+Shift+Space', 'Win32'), ['Ctrl', 'Shift', 'Space']);
});

class FakeMediaRecorder extends EventTarget {
  static isTypeSupported(type) {
    return type === 'audio/webm;codecs=opus';
  }

  constructor(stream, options = {}) {
    super();
    this.stream = stream;
    this.mimeType = options.mimeType || '';
    this.state = 'inactive';
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    const dataEvent = new Event('dataavailable');
    Object.defineProperty(dataEvent, 'data', {
      value: new Blob(['recorded voice'], { type: this.mimeType }),
    });
    this.dispatchEvent(dataEvent);
    this.dispatchEvent(new Event('stop'));
  }
}

class EmptyMediaRecorder extends FakeMediaRecorder {
  stop() {
    this.state = 'inactive';
    this.dispatchEvent(new Event('stop'));
  }
}

function fakeStream(label = '') {
  const track = { label, stopped: false, stop() { this.stopped = true; } };
  return {
    track,
    stream: {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    },
  };
}

test('push-to-talk records while held and ends the microphone stream on release', async () => {
  const source = fakeStream();
  const states = [];
  let audio = null;
  const recorder = new PushToTalkRecorder({
    mediaDevices: { getUserMedia: async () => source.stream },
    MediaRecorderClass: FakeMediaRecorder,
    onState: (state) => states.push(state),
    onAudio: (value) => { audio = value; },
  });
  assert.equal(preferredVoiceMimeType(FakeMediaRecorder), 'audio/webm;codecs=opus');
  assert.equal(await recorder.press(), true);
  assert.equal(recorder.held, true);
  assert.equal(recorder.recorder.state, 'recording');
  assert.equal(recorder.release(), true);
  assert.equal(recorder.held, false);
  assert.equal(source.track.stopped, true);
  assert.ok(audio instanceof Blob);
  assert.equal(audio.type, 'audio/webm;codecs=opus');
  assert.deepEqual(states, ['requesting', 'listening', 'processing', 'captured']);
});

test('push-to-talk selects a named microphone and reports its exact source', async () => {
  const source = fakeStream('Desk microphone');
  const requests = [];
  let recorded = null;
  let now = 1_000;
  const mediaDevices = {
    enumerateDevices: async () => [
      { kind: 'audioinput', deviceId: 'default', label: 'Default - Virtual audio' },
      { kind: 'audioinput', deviceId: 'desk-mic', label: 'Desk microphone' },
      { kind: 'videoinput', deviceId: 'camera', label: 'Camera' },
    ],
    getUserMedia: async (constraints) => {
      requests.push(constraints);
      return source.stream;
    },
  };
  assert.deepEqual(await enumerateVoiceInputDevices(mediaDevices), [
    { deviceId: 'default', label: 'Default - Virtual audio', isDefault: true },
    { deviceId: 'desk-mic', label: 'Desk microphone', isDefault: false },
  ]);
  const recorder = new PushToTalkRecorder({
    mediaDevices,
    MediaRecorderClass: FakeMediaRecorder,
    preferredDeviceLabel: 'Desk microphone',
    now: () => now,
    onAudio: (audio, metadata) => { recorded = { audio, metadata }; },
  });
  assert.equal(await recorder.press(), true);
  now = 3_250;
  assert.equal(recorder.release(), true);
  assert.deepEqual(requests, [{
    audio: {
      autoGainControl: true,
      channelCount: { ideal: 1 },
      echoCancellation: true,
      noiseSuppression: true,
      deviceId: { exact: 'desk-mic' },
    },
    video: false,
  }]);
  assert.equal(recorded.metadata.deviceLabel, 'Desk microphone');
  assert.equal(recorded.metadata.durationMs, 2_250);
});

test('settings reveal named microphones through one released permission stream', async () => {
  const permissionSource = fakeStream('Default microphone');
  let enumerations = 0;
  const requests = [];
  const mediaDevices = {
    enumerateDevices: async () => {
      enumerations += 1;
      if (enumerations === 1) throw new Error('labels unavailable before permission');
      return [
        { kind: 'audioinput', deviceId: 'default', label: 'Default - AirPods Max' },
        { kind: 'audioinput', deviceId: 'airpods', label: 'AirPods Max' },
        { kind: 'audioinput', deviceId: 'teams', label: 'Microsoft Teams Audio' },
      ];
    },
    getUserMedia: async (constraints) => {
      requests.push(constraints);
      return permissionSource.stream;
    },
  };
  const devices = await discoverVoiceInputDevices(mediaDevices, { requestPermission: true });
  assert.equal(devices.length, 3);
  assert.equal(devices[1].label, 'AirPods Max');
  assert.deepEqual(requests, [{ audio: true, video: false }]);
  assert.equal(permissionSource.track.stopped, true);
});

test('saved microphone selection survives labels hidden on a new renderer origin', async () => {
  const fallback = fakeStream('Virtual audio');
  const selected = fakeStream('Desk microphone');
  const requests = [];
  let enumerations = 0;
  const mediaDevices = {
    enumerateDevices: async () => {
      enumerations += 1;
      return enumerations === 1
        ? [{ kind: 'audioinput', deviceId: 'default', label: '' }]
        : [
          { kind: 'audioinput', deviceId: 'default', label: 'Default - Virtual audio' },
          { kind: 'audioinput', deviceId: 'desk-mic', label: 'Desk microphone' },
        ];
    },
    getUserMedia: async (constraints) => {
      requests.push(constraints);
      return constraints.audio.deviceId ? selected.stream : fallback.stream;
    },
  };
  const recorder = new PushToTalkRecorder({
    mediaDevices,
    MediaRecorderClass: FakeMediaRecorder,
    preferredDeviceLabel: 'Desk microphone',
  });
  assert.equal(await recorder.press(), true);
  assert.equal(fallback.track.stopped, true);
  assert.equal(selected.track.stopped, false);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].audio.deviceId, { exact: 'desk-mic' });
  recorder.cancel();
  assert.equal(selected.track.stopped, true);
});

test('encoded Opus silence is distinguished from a voiced recording', () => {
  assert.equal(voiceRecordingLooksSilent(
    new Blob([Buffer.alloc(968)], { type: 'audio/webm;codecs=opus' }),
    2_880,
  ), true);
  assert.equal(voiceRecordingLooksSilent(
    new Blob([Buffer.alloc(24_000)], { type: 'audio/webm;codecs=opus' }),
    2_880,
  ), false);
  assert.equal(voiceRecordingLooksSilent(
    new Blob([Buffer.alloc(100)], { type: 'audio/wav' }),
    2_880,
  ), false);
});

test('live microphone levels distinguish a speech signal and release audio analysis', () => {
  const values = [];
  let disconnected = 0;
  let closed = 0;
  let cleared = null;
  class FakeAudioContext {
    createMediaStreamSource() {
      return {
        connect() {},
        disconnect() { disconnected += 1; },
      };
    }

    createAnalyser() {
      return {
        fftSize: 0,
        smoothingTimeConstant: 0,
        getFloatTimeDomainData(samples) {
          samples.fill(0.02);
        },
        disconnect() { disconnected += 1; },
      };
    }

    resume() { return Promise.resolve(); }
    close() { closed += 1; return Promise.resolve(); }
  }
  const monitor = createVoiceSignalMonitor({}, {
    AudioContextClass: FakeAudioContext,
    onLevel: (level, peakLevel) => values.push({ level, peakLevel }),
    setIntervalFn: () => 71,
    clearIntervalFn: (timer) => { cleared = timer; },
  });
  assert.ok(monitor);
  assert.equal(voiceSignalDetected(monitor.peakLevel), true);
  assert.ok(Math.abs(voiceSignalLevel(new Float32Array([0.02, -0.02])) - 0.02) < 0.00001);
  assert.equal(voiceSignalDetected(voiceSignalLevel(new Float32Array(8))), false);
  assert.equal(values.length, 1);
  monitor.stop();
  assert.equal(cleared, 71);
  assert.equal(disconnected, 2);
  assert.equal(closed, 1);
});

test('an empty clip names the microphone that produced no audio', async () => {
  const source = fakeStream('Unfed virtual microphone');
  const errors = [];
  let now = 1_000;
  const recorder = new PushToTalkRecorder({
    mediaDevices: { getUserMedia: async () => source.stream },
    MediaRecorderClass: EmptyMediaRecorder,
    now: () => now,
    onError: (error) => errors.push(error.message),
  });
  assert.equal(await recorder.press(), true);
  now = 2_000;
  recorder.release();
  assert.deepEqual(errors, ['Unfed virtual microphone captured no microphone audio.']);
  assert.equal(source.track.stopped, true);
});

test('releasing before microphone permission resolves never leaves capture running', async () => {
  const source = fakeStream();
  let resolvePermission;
  let captured = false;
  const recorder = new PushToTalkRecorder({
    mediaDevices: { getUserMedia: () => new Promise((resolve) => { resolvePermission = resolve; }) },
    MediaRecorderClass: FakeMediaRecorder,
    onAudio: () => { captured = true; },
  });
  const pressing = recorder.press();
  assert.equal(recorder.release(), true);
  resolvePermission(source.stream);
  assert.equal(await pressing, false);
  assert.equal(source.track.stopped, true);
  assert.equal(captured, false);
});

test('cancelling an active recording discards its audio and closes the microphone', async () => {
  const source = fakeStream();
  const states = [];
  let captured = false;
  const recorder = new PushToTalkRecorder({
    mediaDevices: { getUserMedia: async () => source.stream },
    MediaRecorderClass: FakeMediaRecorder,
    onState: (state) => states.push(state),
    onAudio: () => { captured = true; },
  });
  assert.equal(await recorder.press(), true);
  recorder.cancel();
  assert.equal(source.track.stopped, true);
  assert.equal(captured, false);
  assert.equal(states.at(-1), 'idle');
});

test('a media recorder failure discards partial audio and closes the microphone', async () => {
  const source = fakeStream();
  const errors = [];
  let captured = false;
  const recorder = new PushToTalkRecorder({
    mediaDevices: { getUserMedia: async () => source.stream },
    MediaRecorderClass: FakeMediaRecorder,
    onAudio: () => { captured = true; },
    onError: (error) => errors.push(error.message),
  });
  assert.equal(await recorder.press(), true);
  const failure = new Event('error');
  Object.defineProperty(failure, 'error', { value: new Error('Microphone disconnected.') });
  recorder.recorder.dispatchEvent(failure);
  assert.equal(source.track.stopped, true);
  assert.equal(captured, false);
  assert.deepEqual(errors, ['Microphone disconnected.']);
});

test('desktop grants only microphone and safe clipboard writes to its exact loopback renderer', () => {
  const rendererUrl = 'http://127.0.0.1:54321/?relayDesktop=macos';
  const webContents = { getURL: () => rendererUrl };
  assert.equal(desktopPermissionAllowed({
    permission: 'media',
    webContents,
    details: { mediaTypes: ['audio'] },
    rendererUrl,
  }), true);
  assert.equal(desktopPermissionAllowed({
    permission: 'media',
    webContents,
    details: { mediaTypes: ['audio', 'video'] },
    rendererUrl,
  }), false);
  assert.equal(desktopPermissionAllowed({
    permission: 'media',
    requestingOrigin: 'https://example.test',
    details: { mediaType: 'audio' },
    rendererUrl,
    phase: 'check',
  }), false);
  assert.equal(desktopPermissionAllowed({
    permission: 'clipboard-sanitized-write',
    requestingOrigin: 'http://127.0.0.1:54321',
    rendererUrl,
    phase: 'check',
  }), true);

  const handlers = {};
  configureDesktopPermissions({
    setPermissionCheckHandler: (handler) => { handlers.check = handler; },
    setPermissionRequestHandler: (handler) => { handlers.request = handler; },
  }, rendererUrl);
  assert.equal(handlers.check(webContents, 'media', rendererUrl, { mediaType: 'audio' }), true);
  let granted = null;
  handlers.request(webContents, 'media', (value) => { granted = value; }, { mediaTypes: ['audio'] });
  assert.equal(granted, true);
});

class FakeWhisperWorker extends EventEmitter {
  constructor(onRequest) {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.exitCode = null;
    this.signalCode = null;
    this.killed = false;
    this.stdin = new Writable({
      write: (chunk, encoding, callback) => {
        onRequest(JSON.parse(String(chunk).trim()), this);
        callback();
      },
    });
    queueMicrotask(() => {
      this.stdout.write(`${JSON.stringify({
        type: 'ready',
        engineVersion: FASTER_WHISPER_VERSION,
        model: VOICE_INPUT_MODEL,
      })}\n`);
    });
  }

  kill(signal = 'SIGTERM') {
    if (this.killed) return true;
    this.killed = true;
    this.signalCode = signal;
    queueMicrotask(() => this.emit('exit', null, signal));
    return true;
  }
}

test('voice service installs its isolated runtime, reuses one worker, and removes each clip', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-voice-input-'));
  const invocations = [];
  const workers = [];
  let recordedPath = null;
  const runProcess = async (command, args) => {
    invocations.push({ command, args });
    if (args.includes('-c')) return { stdout: '3.11.8\n', stderr: '' };
    const venvIndex = args.indexOf('venv');
    if (venvIndex !== -1) {
      const venvRoot = args[venvIndex + 1];
      mkdirSync(join(venvRoot, 'bin'), { recursive: true });
      writeFileSync(join(venvRoot, 'bin', 'python'), 'test');
    }
    return { stdout: '', stderr: '' };
  };
  const spawnProcess = (command, args) => {
    invocations.push({ command, args });
    const worker = new FakeWhisperWorker((request, target) => {
      recordedPath = request.audio;
      assert.equal(existsSync(recordedPath), true);
      queueMicrotask(() => target.stdout.write(`${JSON.stringify({
        type: 'result',
        id: request.id,
        text: 'Dictated task prompt.',
        language: 'en',
        duration: 1.25,
        vadFallback: true,
      })}\n`));
    });
    workers.push(worker);
    return worker;
  };
  const service = new VoiceInputService({
    dataRoot: directory,
    platform: 'linux',
    runProcess,
    spawnProcess,
  });
  let refreshedService = null;
  try {
    assert.equal(service.status().state, 'setup-required');
    const status = await service.setup();
    assert.equal(status.state, 'ready');
    assert.equal(status.installed, true);
    assert.equal(workers.length, 1);
    assert.ok(invocations.some(({ args }) => args.includes(`faster-whisper==${FASTER_WHISPER_VERSION}`)));
    assert.ok(invocations.some(({ args }) => args.includes('--worker') && args.includes(VOICE_INPUT_MODEL)));

    const result = await service.transcribe(Buffer.alloc(512, 1), 'audio/webm;codecs=opus');
    assert.deepEqual(result, {
      text: 'Dictated task prompt.',
      language: 'en',
      duration: 1.25,
      vadFallback: true,
    });
    assert.equal(existsSync(recordedPath), false);
    assert.deepEqual(readdirSync(join(directory, 'voice-input', 'recordings')), []);
    assert.equal(workers.length, 1);
    await service.shutdown();
    assert.equal(workers[0].killed, true);

    const installedHelperPath = join(directory, 'voice-input', 'faster-whisper-worker.py');
    writeFileSync(installedHelperPath, 'stale helper');
    refreshedService = new VoiceInputService({
      dataRoot: directory,
      platform: 'linux',
      runProcess,
      spawnProcess,
    });
    assert.equal((await refreshedService.prewarm()).state, 'ready');
    assert.equal(readFileSync(installedHelperPath, 'utf8'), helper);
    assert.equal(workers.length, 2);
    await refreshedService.shutdown();
    assert.equal(workers[1].killed, true);
  } finally {
    await refreshedService?.shutdown();
    await service.shutdown();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('voice service bounds versions, media types, and payload sizes', async () => {
  assert.deepEqual(parsePythonVersion('3.9.0'), {
    major: 3,
    minor: 9,
    patch: 0,
    supported: true,
  });
  assert.equal(parsePythonVersion('3.8.19').supported, false);
  assert.equal(parsePythonVersion('Python 3.11.1'), null);
  assert.equal(voiceInputAudioExtension('audio/webm;codecs=opus'), '.webm');
  assert.equal(voiceInputAudioExtension('video/webm'), null);

  const directory = mkdtempSync(join(tmpdir(), 'relay-voice-limits-'));
  const service = new VoiceInputService({ dataRoot: directory });
  try {
    await assert.rejects(
      service.transcribe(Buffer.alloc(512), 'video/webm'),
      /unsupported audio format/,
    );
    await assert.rejects(
      service.transcribe(Buffer.alloc(MAX_VOICE_AUDIO_BYTES + 1), 'audio/webm'),
      /at most 12 MB/,
    );
    await assert.rejects(
      service.transcribe(Buffer.alloc(512), 'audio/webm'),
      (error) => error.statusCode === 409 && /Set up the local faster-whisper engine/.test(error.message),
    );
  } finally {
    await service.shutdown();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('voice service rejects malformed or mismatched worker readiness without leaking a process', async () => {
  for (const line of [
    'null',
    JSON.stringify({ type: 'ready', engineVersion: '0.0.0', model: VOICE_INPUT_MODEL }),
  ]) {
    const directory = mkdtempSync(join(tmpdir(), 'relay-voice-protocol-'));
    const service = new VoiceInputService({ dataRoot: directory });
    const child = { killed: false, kill() { this.killed = true; } };
    service.worker = child;
    service.activeChildren.add(child);
    service.workerStartPromise = new Promise((resolve, reject) => {
      service.workerStartResolve = resolve;
      service.workerStartReject = reject;
    });
    const rejected = service.workerStartPromise.catch((error) => error);
    service._handleWorkerLine(line);
    const error = await rejected;
    assert.match(error.message, /invalid data|version does not match/);
    assert.equal(child.killed, true);
    assert.equal(service.worker, null);
    assert.equal(service.activeChildren.size, 0);
    await service.shutdown();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('voice input UI, API, CPU worker, and packaged microphone disclosure stay connected', () => {
  assert.match(html, /id="voice-input-enabled"[^>]*role="switch"/);
  assert.match(html, /id="voice-input-shortcut"[\s\S]*?id="voice-input-shortcut-label"/);
  assert.match(html, /id="voice-input-alternate-shortcut"[\s\S]*?id="voice-input-alternate-shortcut-label"/);
  assert.match(html, /id="voice-input-microphone"/);
  assert.match(html, /id="voice-input-device-status"/);
  assert.match(html, /id="voice-input-hold"[\s\S]*?Hold Ctrl\+Shift\+Space to talk/);
  assert.match(html, /class="voice-input-meter"/);
  assert.match(html, /Release any activation key to stop/);
  assert.match(style, /\.voice-input-composer\[data-state="listening"\]/);
  assert.match(style, /html\[data-theme="dark"\] \.voice-input-composer/);
  assert.match(style, /html\[data-theme="dark"\] \.voice-input-microphone-select/);
  assert.match(app, /\.find\(\(shortcut\) => shortcut && voiceShortcutMatches\(event, shortcut\)\)/);
  assert.match(app, /voiceShortcutReleased\(event, activeShortcut\)/);
  assert.match(app, /api\('\/api\/voice-input\/transcribe'/);
  assert.match(app, /captured only digital silence\. Choose another input in Settings\./);
  assert.match(app, /discoverVoiceInputDevices\(navigator\.mediaDevices, \{ requestPermission \}\)/);
  assert.match(app, /Speech signal detected on/);
  assert.match(app, /elements\.prompt\.setRangeText\(replacement, start, end, 'end'\)/);
  assert.match(server, /pushToTalkVoiceInput: true/);
  assert.match(server, /pathname === '\/api\/voice-input\/setup'/);
  assert.match(server, /pathname === '\/api\/voice-input\/transcribe'/);
  assert.match(server, /await voiceInput\.shutdown\(\)/);
  assert.match(helper, /device="cpu"/);
  assert.match(helper, /compute_type="int8"/);
  assert.match(helper, /decode\(model, audio_path, True\)/);
  assert.match(helper, /decode\(model, audio_path, False\)/);
  assert.match(helper, /"vadFallback": vad_fallback/);
  assert.match(electron, /configureDesktopPermissions\(mainWindow\.webContents\.session, rendererUrl\)/);
  assert.match(builder, /NSMicrophoneUsageDescription:/);
});
