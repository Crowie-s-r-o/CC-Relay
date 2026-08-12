import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createDesktopUpdater } from '../src/desktop-updater.mjs';

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.autoDownload = 'unset';
    this.autoInstallOnAppQuit = 'unset';
    this.checkCalls = 0;
    this.downloadCalls = 0;
    this.checkResult = undefined;
    this.downloadResult = undefined;
  }

  async checkForUpdates() {
    this.checkCalls += 1;
    return this.checkResult;
  }

  async downloadUpdate() {
    this.downloadCalls += 1;
    return this.downloadResult;
  }
}

function harness(options = {}) {
  const updater = options.updater || new FakeUpdater();
  const dialogs = [];
  const choices = [...(options.choices || [])];
  const dialog = {
    async showMessageBox(window, messageOptions) {
      dialogs.push({ window, options: messageOptions });
      return { response: choices.length ? choices.shift() : 1 };
    },
  };
  const logs = [];
  const logger = {
    info(message, error) { logs.push({ level: 'info', message, error }); },
    error(message, error) { logs.push({ level: 'error', message, error }); },
  };
  const timers = [];
  const timer = (callback, delay) => {
    timers.push({ callback, delay });
    if (options.runTimer) callback();
    return timers.length;
  };
  const window = { isDestroyed: () => false };
  const restartCalls = [];
  const states = [];
  const coordinator = createDesktopUpdater({
    updater,
    dialog,
    currentVersion: options.currentVersion || '1.0.0',
    eligible: options.eligible ?? true,
    getMainWindow: () => options.window === undefined ? window : options.window,
    restartAndInstall: async () => restartCalls.push(true),
    releasesUrl: 'https://github.com/Crowie-s-r-o/CC-Relay/releases/latest',
    releaseUrlForVersion: (version) => `https://github.com/Crowie-s-r-o/CC-Relay/releases/tag/v${version}`,
    onStateChange: (state) => states.push(state),
    logger,
    timer,
    delay: options.delay ?? 25,
  });
  return { updater, coordinator, dialog, dialogs, logs, timers, restartCalls, states };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

test('skips unpackaged or otherwise ineligible builds', async () => {
  const { updater, coordinator, timers } = harness({ eligible: false });
  assert.equal(coordinator.start(), false);
  assert.equal(coordinator.start(), false);
  assert.equal(updater.autoDownload, 'unset');
  assert.equal(updater.listenerCount('update-available'), 0);
  assert.equal(timers.length, 0);
  await flush();
  assert.equal(updater.checkCalls, 0);
});

test('derives eligibility for packaged macOS and installed Windows builds', () => {
  const mac = harness({ eligible: undefined });
  mac.coordinator = createDesktopUpdater({ updater: mac.updater, packaged: true, platform: 'darwin', timer: () => {} });
  assert.equal(mac.coordinator.start(), true);
  const portable = harness({ eligible: undefined });
  portable.coordinator = createDesktopUpdater({ updater: portable.updater, packaged: true, platform: 'win32', portable: true, timer: () => {} });
  assert.equal(portable.coordinator.start(), false);
});

test('start is idempotent, configures manual update flow, and schedules once', async () => {
  const { updater, coordinator, timers } = harness();
  assert.equal(coordinator.start(), true);
  assert.equal(coordinator.start(), false);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 25);
  timers[0].callback();
  timers[0].callback();
  await flush();
  assert.equal(updater.checkCalls, 1);
});

test('runs a check without prompting when no update is available', async () => {
  const { updater, coordinator, dialogs, states } = harness({ runTimer: true });
  coordinator.start();
  updater.emit('update-not-available');
  await flush();
  assert.equal(updater.checkCalls, 1);
  assert.equal(dialogs.length, 0);
  assert.equal(states.at(-1).status, 'current');
});

test('publishes a safe, queryable update lifecycle for the desktop UI', async () => {
  const { updater, coordinator, states } = harness({ choices: [1, 1] });
  assert.equal(coordinator.status().status, 'unsupported');
  coordinator.start();
  assert.deepEqual(coordinator.status(), states.at(-1));
  assert.equal(states.at(-1).supported, true);
  assert.equal(states.at(-1).status, 'checking');

  updater.emit('update-available', { version: '1.2.0' });
  await flush();
  assert.equal(states.at(-1).status, 'available');
  assert.equal(states.at(-1).latestVersion, '1.2.0');
  assert.equal(
    states.at(-1).releaseUrl,
    'https://github.com/Crowie-s-r-o/CC-Relay/releases/tag/v1.2.0',
  );

  updater.emit('download-progress', { percent: 47.6 });
  assert.equal(states.at(-1).status, 'downloading');
  assert.equal(states.at(-1).downloadPercent, 47.6);

  updater.emit('update-downloaded', { version: '1.2.0' });
  await flush();
  assert.equal(states.at(-1).status, 'downloaded');
  assert.equal(states.at(-1).downloadPercent, 100);

  updater.emit('error', new Error('network unavailable'));
  assert.equal(states.at(-1).status, 'error');
  assert.equal(states.at(-1).latestVersion, '1.2.0');
});

test('prompts for an available update and downloads only after acceptance', async () => {
  const { updater, coordinator, dialogs } = harness({ choices: [0] });
  coordinator.start();
  updater.emit('update-available', { version: '1.2.0' });
  await flush();
  assert.equal(dialogs.length, 1);
  assert.match(dialogs[0].options.message, /1\.2\.0/);
  assert.match(dialogs[0].options.message, /1\.0\.0/);
  assert.deepEqual(dialogs[0].options.buttons, ['Download', 'Later']);
  assert.equal(updater.downloadCalls, 1);
});

test('defers an available update when the user chooses Later', async () => {
  const { updater, coordinator, dialogs } = harness({ choices: [1] });
  coordinator.start();
  updater.emit('update-available', { version: '1.2.0' });
  await flush();
  assert.equal(dialogs.length, 1);
  assert.equal(updater.downloadCalls, 0);
});

test('prompts for a downloaded update and restarts only after acceptance', async () => {
  const accepted = harness({ choices: [0] });
  accepted.coordinator.start();
  accepted.updater.emit('update-downloaded', { version: '1.2.0' });
  await flush();
  assert.deepEqual(accepted.dialogs[0].options.buttons, ['Restart and install', 'Later']);
  assert.equal(accepted.restartCalls.length, 1);

  const deferred = harness({ choices: [1] });
  deferred.coordinator.start();
  deferred.updater.emit('update-downloaded', { version: '1.2.0' });
  await flush();
  assert.equal(deferred.restartCalls.length, 0);
});

test('does not prompt when the main window is absent or destroyed', async () => {
  const absent = harness({ window: null, choices: [0] });
  absent.coordinator.start();
  absent.updater.emit('update-available', { version: '1.2.0' });
  await flush();
  assert.equal(absent.dialogs.length, 0);
  assert.equal(absent.updater.downloadCalls, 0);

  const destroyed = harness({ choices: [0] });
  destroyed.coordinator = createDesktopUpdater({
    updater: destroyed.updater,
    eligible: true,
    getMainWindow: () => ({ isDestroyed: () => true }),
    dialog: destroyed.dialog,
    logger: destroyed.logs,
    timer: () => {},
  });
  destroyed.coordinator.start();
  destroyed.updater.emit('update-downloaded', { version: '1.2.0' });
  await flush();
  assert.equal(destroyed.dialogs.length, 0);
  assert.equal(destroyed.restartCalls.length, 0);
});

test('prevents overlapping checks, downloads, and prompts', async () => {
  let releaseCheck;
  const updater = new FakeUpdater();
  updater.checkForUpdates = () => new Promise((resolve) => { updater.checkCalls += 1; releaseCheck = resolve; });
  let releaseDownload;
  updater.downloadUpdate = () => new Promise((resolve) => { updater.downloadCalls += 1; releaseDownload = resolve; });
  const { coordinator, timers, dialogs } = harness({ updater, choices: [0, 0] });
  coordinator.start();
  timers[0].callback();
  timers[0].callback();
  assert.equal(updater.checkCalls, 1);
  updater.emit('update-available', { version: '1.2.0' });
  updater.emit('update-available', { version: '1.2.0' });
  await flush();
  assert.equal(dialogs.length, 1);
  assert.equal(updater.downloadCalls, 1);
  updater.emit('update-available', { version: '1.2.0' });
  await flush();
  assert.equal(updater.downloadCalls, 1);
  releaseDownload();
  releaseCheck();
  await flush();
});

test('logs rejected checks and downloads without error dialogs', async () => {
  const { updater, coordinator, logs, dialogs } = harness({ choices: [0], runTimer: true });
  updater.checkForUpdates = async () => { throw new Error('check exploded'); };
  coordinator.start();
  await flush();
  assert.equal(dialogs.length, 0);
  assert.equal(logs.some((entry) => entry.level === 'error' && /check failed/.test(entry.message)), true);

  updater.downloadUpdate = async () => { throw new Error('download exploded'); };
  updater.emit('update-available', { version: '1.2.0' });
  await flush();
  assert.equal(dialogs.length, 1);
  assert.equal(logs.some((entry) => entry.level === 'error' && /download failed/.test(entry.message)), true);
});
