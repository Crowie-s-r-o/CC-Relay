import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  DESKTOP_UPDATE_CHECK_INTERVAL,
  createDesktopUpdater,
} from '../src/desktop-updater.mjs';

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
  const intervals = [];
  const intervalTimer = (callback, delay) => {
    intervals.push({ callback, delay });
    return intervals.length;
  };
  const window = { isDestroyed: () => false };
  const restartCalls = [];
  const states = [];
  const coordinator = createDesktopUpdater({
    updater,
    dialog,
    currentVersion: options.currentVersion || '1.0.0',
    eligible: options.eligible ?? true,
    automaticUpdate: options.automaticUpdate ?? true,
    checkLatestRelease: options.checkLatestRelease,
    getMainWindow: () => options.window === undefined ? window : options.window,
    restartAndInstall: async () => restartCalls.push(true),
    releasesUrl: 'https://github.com/Crowie-s-r-o/CC-Relay/releases/latest',
    releaseUrlForVersion: (version) => `https://github.com/Crowie-s-r-o/CC-Relay/releases/tag/v${version}`,
    onStateChange: (state) => states.push(state),
    logger,
    timer,
    intervalTimer,
    delay: options.delay ?? 25,
    interval: options.interval,
  });
  return {
    updater,
    coordinator,
    dialog,
    dialogs,
    logs,
    logger,
    timers,
    intervals,
    restartCalls,
    states,
  };
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

test('derives automatic updates for packaged macOS and NSIS builds only', () => {
  const checkLatestRelease = async () => ({ version: '1.2.0' });
  const mac = harness({ eligible: undefined });
  mac.coordinator = createDesktopUpdater({
    updater: mac.updater,
    packaged: true,
    platform: 'darwin',
    checkLatestRelease,
    timer: () => {},
    intervalTimer: () => {},
  });
  assert.equal(mac.coordinator.start(), true);
  assert.equal(mac.coordinator.status().automaticUpdate, true);
  assert.equal(mac.updater.autoDownload, true);
  assert.equal(mac.updater.autoInstallOnAppQuit, true);
  const installed = harness({ eligible: undefined });
  installed.coordinator = createDesktopUpdater({
    updater: installed.updater,
    packaged: true,
    platform: 'win32',
    portable: false,
    timer: () => {},
    intervalTimer: () => {},
  });
  assert.equal(installed.coordinator.start(), true);
  assert.equal(installed.coordinator.status().automaticUpdate, true);
  assert.equal(installed.updater.autoDownload, true);
  assert.equal(installed.updater.autoInstallOnAppQuit, true);
  const portable = harness({ eligible: undefined });
  portable.coordinator = createDesktopUpdater({
    updater: portable.updater,
    packaged: true,
    platform: 'win32',
    portable: true,
    checkLatestRelease,
    timer: () => {},
    intervalTimer: () => {},
  });
  assert.equal(portable.coordinator.start(), true);
  assert.equal(portable.coordinator.status().automaticUpdate, false);
  assert.equal(portable.updater.autoDownload, 'unset');
});

test('start is idempotent, configures automatic updates, and checks every five minutes', async () => {
  const { updater, coordinator, logger, timers, intervals } = harness();
  assert.equal(coordinator.start(), true);
  assert.equal(coordinator.start(), false);
  assert.equal(updater.logger, logger);
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 25);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].delay, DESKTOP_UPDATE_CHECK_INTERVAL);
  timers[0].callback();
  await flush();
  assert.equal(updater.checkCalls, 1);
  intervals[0].callback();
  await flush();
  assert.equal(updater.checkCalls, 2);
});

test('caps an injected recurring cadence at five minutes', () => {
  const { coordinator, intervals } = harness({ interval: DESKTOP_UPDATE_CHECK_INTERVAL * 2 });
  coordinator.start();
  assert.equal(intervals[0].delay, DESKTOP_UPDATE_CHECK_INTERVAL);
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

test('discovers a manual portable release without starting the automatic updater', async () => {
  const { updater, coordinator, dialogs, states } = harness({
    automaticUpdate: false,
    checkLatestRelease: async () => ({ version: '1.2.0' }),
    runTimer: true,
  });
  coordinator.start();
  await flush();
  assert.equal(updater.checkCalls, 0);
  assert.equal(updater.autoDownload, 'unset');
  assert.equal(dialogs.length, 0);
  assert.equal(states.at(-1).supported, true);
  assert.equal(states.at(-1).automaticUpdate, false);
  assert.equal(states.at(-1).status, 'available');
  assert.equal(states.at(-1).latestVersion, '1.2.0');
  assert.equal(
    states.at(-1).releaseUrl,
    'https://github.com/Crowie-s-r-o/CC-Relay/releases/tag/v1.2.0',
  );
});

test('manual release discovery stays current for equal or older versions', async () => {
  for (const version of ['1.0.0', '0.9.9']) {
    const { coordinator, states } = harness({
      automaticUpdate: false,
      checkLatestRelease: async () => ({ version }),
      runTimer: true,
    });
    coordinator.start();
    await flush();
    assert.equal(states.at(-1).status, 'current');
    assert.equal(states.at(-1).latestVersion, null);
  }
});

test('manual discovery keeps a known update visible after a later refresh failure', async () => {
  let fail = false;
  const { coordinator, intervals, states } = harness({
    automaticUpdate: false,
    checkLatestRelease: async () => {
      if (fail) throw new Error('GitHub unavailable');
      return { version: '1.2.0' };
    },
    runTimer: true,
  });
  coordinator.start();
  await flush();
  fail = true;
  intervals[0].callback();
  await flush();
  assert.equal(states.at(-1).status, 'available');
  assert.equal(states.at(-1).latestVersion, '1.2.0');
});

test('publishes a safe, queryable update lifecycle for the desktop UI', async () => {
  const { updater, coordinator, dialogs, states } = harness({ choices: [1] });
  assert.equal(coordinator.status().status, 'unsupported');
  coordinator.start();
  assert.deepEqual(coordinator.status(), states.at(-1));
  assert.equal(states.at(-1).supported, true);
  assert.equal(states.at(-1).automaticUpdate, true);
  assert.equal(states.at(-1).status, 'checking');

  updater.emit('update-available', { version: '1.2.0' });
  await flush();
  assert.equal(states.at(-1).status, 'downloading');
  assert.equal(states.at(-1).latestVersion, '1.2.0');
  assert.equal(dialogs.length, 0);
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

test('downloads available updates automatically without interrupting active work', async () => {
  const { updater, coordinator, dialogs, logs, states } = harness();
  coordinator.start();
  updater.emit('update-available', { version: '1.2.0' });
  await flush();
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal(dialogs.length, 0);
  assert.equal(updater.downloadCalls, 0);
  assert.equal(states.at(-1).status, 'downloading');
  assert.equal(
    logs.some((entry) => entry.level === 'info' && /automatically/.test(entry.message)),
    true,
  );
});

test('retries an automatic update after an updater error without manual action', async () => {
  const { updater, coordinator, intervals, states } = harness();
  coordinator.start();
  updater.emit('update-available', { version: '1.2.0' });
  updater.emit('error', new Error('download interrupted'));
  assert.equal(states.at(-1).status, 'error');
  assert.equal(states.at(-1).latestVersion, '1.2.0');

  intervals[0].callback();
  await flush();
  assert.equal(updater.checkCalls, 1);
});

test('pauses recurring checks while an automatic download or installation is pending', async () => {
  const { updater, coordinator, intervals } = harness({ choices: [1] });
  coordinator.start();
  updater.emit('update-available', { version: '1.2.0' });
  intervals[0].callback();
  await flush();
  assert.equal(updater.checkCalls, 0);
  updater.emit('update-downloaded', { version: '1.2.0' });
  intervals[0].callback();
  await flush();
  assert.equal(updater.checkCalls, 0);
});

test('prompts for a downloaded update and restarts only after acceptance', async () => {
  const accepted = harness({ choices: [0] });
  accepted.coordinator.start();
  accepted.updater.emit('update-downloaded', { version: '1.2.0' });
  await flush();
  assert.deepEqual(accepted.dialogs[0].options.buttons, ['Restart and install', 'Install on quit']);
  assert.match(accepted.dialogs[0].options.message, /install automatically when you quit/i);
  assert.equal(accepted.restartCalls.length, 1);

  const deferred = harness({ choices: [1] });
  deferred.coordinator.start();
  deferred.updater.emit('update-downloaded', { version: '1.2.0' });
  await flush();
  assert.equal(deferred.restartCalls.length, 0);
});

test('does not prompt again after install on quit is selected for the same version', async () => {
  const deferred = harness({ choices: [1, 0] });
  deferred.coordinator.start();

  deferred.updater.emit('update-downloaded', { version: '1.2.0' });
  await flush();
  assert.equal(deferred.dialogs.length, 1);
  assert.equal(deferred.restartCalls.length, 0);

  deferred.updater.emit('update-downloaded', { version: '1.2.0' });
  await flush();
  assert.equal(deferred.dialogs.length, 1);
  assert.equal(deferred.restartCalls.length, 0);

  deferred.updater.emit('update-downloaded', { version: '1.3.0' });
  await flush();
  assert.equal(deferred.dialogs.length, 2);
  assert.equal(deferred.restartCalls.length, 1);
});

test('does not prompt when the main window is absent or destroyed', async () => {
  const absent = harness({ window: null, choices: [0] });
  absent.coordinator.start();
  absent.updater.emit('update-available', { version: '1.2.0' });
  await flush();
  assert.equal(absent.dialogs.length, 0);
  assert.equal(absent.coordinator.status().status, 'downloading');
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

test('prevents overlapping checks, downloads, and restart prompts', async () => {
  let releaseCheck;
  const updater = new FakeUpdater();
  updater.checkForUpdates = () => new Promise((resolve) => { updater.checkCalls += 1; releaseCheck = resolve; });
  const { coordinator, timers, intervals, dialogs } = harness({ updater, choices: [1] });
  coordinator.start();
  timers[0].callback();
  timers[0].callback();
  assert.equal(updater.checkCalls, 1);
  updater.emit('update-available', { version: '1.2.0' });
  intervals[0].callback();
  await flush();
  assert.equal(updater.checkCalls, 1);
  updater.emit('update-downloaded', { version: '1.2.0' });
  updater.emit('update-downloaded', { version: '1.2.0' });
  await flush();
  assert.equal(dialogs.length, 1);
  releaseCheck();
  await flush();
});

test('logs rejected checks and updater failures without error dialogs', async () => {
  const { updater, coordinator, logs, dialogs } = harness({ runTimer: true });
  updater.checkForUpdates = async () => { throw new Error('check exploded'); };
  coordinator.start();
  await flush();
  assert.equal(dialogs.length, 0);
  assert.equal(logs.some((entry) => entry.level === 'error' && /check failed/.test(entry.message)), true);

  updater.emit('update-available', { version: '1.2.0' });
  updater.emit('error', new Error('download exploded'));
  await flush();
  assert.equal(dialogs.length, 0);
  assert.equal(
    logs.some((entry) => entry.level === 'error' && /reported an error/.test(entry.message)),
    true,
  );
});
