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
    restartAndInstall: async (prepareToInstall) => {
      restartCalls.push(true);
      if (typeof options.restartAndInstall === 'function') {
        await options.restartAndInstall(prepareToInstall);
      } else {
        await prepareToInstall?.();
      }
    },
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
  assert.equal(mac.updater.autoDownload, false);
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
  assert.equal(installed.updater.autoDownload, false);
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
  assert.equal(updater.autoDownload, false);
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
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal(dialogs.length, 0);
  assert.equal(updater.downloadCalls, 1);
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
  await flush();

  intervals[0].callback();
  await flush();
  assert.equal(updater.checkCalls, 1);
});

test('retries the same release when native staging fails after download', async () => {
  const { updater, coordinator, intervals, dialogs, states } = harness({ choices: [1] });
  coordinator.start();
  updater.emit('update-available', { version: '1.2.0' });
  await flush();
  assert.equal(updater.downloadCalls, 1);
  updater.emit('update-downloaded', { version: '1.2.0' });
  await flush();
  assert.equal(dialogs.length, 1);

  updater.emit('error', new Error('native staging failed'));
  assert.equal(states.at(-1).status, 'error');
  intervals[0].callback();
  await flush();
  assert.equal(updater.checkCalls, 1);

  updater.emit('update-available', { version: '1.2.0' });
  await flush();
  assert.equal(updater.downloadCalls, 2);
  assert.equal(states.at(-1).status, 'downloading');
});

test('pauses recurring checks while downloading or installing immediately', async () => {
  const { updater, coordinator, intervals } = harness({ choices: [1] });
  let finishDownload;
  updater.downloadUpdate = () => new Promise((resolve) => {
    updater.downloadCalls += 1;
    finishDownload = resolve;
  });
  coordinator.start();
  updater.emit('update-available', { version: '1.2.0' });
  intervals[0].callback();
  await flush();
  assert.equal(updater.checkCalls, 0);
  finishDownload();
  await flush();

  const installing = harness({ choices: [0] });
  installing.coordinator.start();
  installing.updater.emit('update-downloaded', { version: '1.2.0' });
  await flush();
  installing.intervals[0].callback();
  await flush();
  assert.equal(installing.updater.checkCalls, 1);
  assert.equal(installing.coordinator.status().status, 'installing');
});

test('keeps checking after install on quit while preserving the staged release', async () => {
  const { updater, coordinator, intervals, states } = harness({ choices: [1] });
  coordinator.start();
  updater.emit('update-downloaded', { version: '1.2.0' });
  await flush();

  intervals[0].callback();
  await flush();
  assert.equal(updater.checkCalls, 1);
  assert.equal(states.at(-1).status, 'downloaded');

  updater.emit('update-not-available');
  assert.equal(states.at(-1).status, 'downloaded');
  assert.equal(states.at(-1).latestVersion, '1.2.0');
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

test('restart intent silently adopts a higher release while shutdown is still running', async () => {
  let finishShutdown;
  const restarting = harness({
    choices: [0],
    restartAndInstall: async (prepareToInstall) => {
      await new Promise((resolve) => { finishShutdown = resolve; });
      await prepareToInstall();
    },
  });
  restarting.coordinator.start();
  restarting.updater.emit('update-downloaded', { version: '1.2.0' });
  await flush();
  assert.equal(restarting.dialogs.length, 1);
  assert.equal(restarting.restartCalls.length, 1);

  restarting.updater.emit('update-available', { version: '1.3.0' });
  await flush();
  assert.equal(restarting.updater.downloadCalls, 1);
  restarting.updater.emit('update-downloaded', { version: '1.3.0' });
  await flush();
  assert.equal(restarting.dialogs.length, 1);
  assert.equal(restarting.coordinator.status().latestVersion, '1.3.0');

  finishShutdown();
  await flush();
  assert.equal(restarting.updater.checkCalls, 1);
  assert.equal(restarting.coordinator.status().status, 'installing');
  assert.equal(restarting.coordinator.status().latestVersion, '1.3.0');
});

test('final install preparation waits for a higher release found by its freshness check', async () => {
  const preparing = harness({ choices: [1] });
  let finishDownload;
  preparing.updater.checkForUpdates = async () => {
    preparing.updater.checkCalls += 1;
    preparing.updater.emit('update-available', { version: '1.3.0' });
  };
  preparing.updater.downloadUpdate = () => new Promise((resolve) => {
    preparing.updater.downloadCalls += 1;
    finishDownload = resolve;
  });
  preparing.coordinator.start();
  preparing.updater.emit('update-downloaded', { version: '1.2.0' });
  await flush();

  let preparationFinished = false;
  const preparation = preparing.coordinator.prepareToInstall().then(() => {
    preparationFinished = true;
  });
  await flush();
  assert.equal(preparing.updater.checkCalls, 1);
  assert.equal(preparing.updater.downloadCalls, 1);
  assert.equal(preparing.coordinator.status().status, 'downloading');
  assert.equal(preparationFinished, false);

  preparing.updater.emit('update-downloaded', { version: '1.3.0' });
  finishDownload();
  await preparation;
  assert.equal(preparationFinished, true);
  assert.equal(preparing.coordinator.status().status, 'installing');
  assert.equal(preparing.coordinator.status().latestVersion, '1.3.0');
  assert.equal(preparing.dialogs.length, 1);
});

test('final install preparation retries one failed superseding download', async () => {
  const preparing = harness({ choices: [1] });
  preparing.updater.checkForUpdates = async () => {
    preparing.updater.checkCalls += 1;
    preparing.updater.emit('update-available', { version: '1.3.0' });
  };
  preparing.updater.downloadUpdate = async () => {
    preparing.updater.downloadCalls += 1;
    if (preparing.updater.downloadCalls === 1) throw new Error('temporary download failure');
    preparing.updater.emit('update-downloaded', { version: '1.3.0' });
  };
  preparing.coordinator.start();
  preparing.updater.emit('update-downloaded', { version: '1.2.0' });
  await flush();

  await preparing.coordinator.prepareToInstall();
  assert.equal(preparing.updater.checkCalls, 2);
  assert.equal(preparing.updater.downloadCalls, 2);
  assert.equal(preparing.coordinator.status().status, 'installing');
  assert.equal(preparing.coordinator.status().latestVersion, '1.3.0');
  assert.equal(preparing.dialogs.length, 1);
});

test('failed restart handoff preserves the newest superseding release state', async () => {
  let rejectHandoff;
  const failing = harness({
    choices: [0],
    restartAndInstall: async () => new Promise((resolve, reject) => {
      rejectHandoff = reject;
    }),
  });
  failing.coordinator.start();
  failing.updater.emit('update-downloaded', { version: '1.2.0' });
  await flush();
  failing.updater.emit('update-downloaded', { version: '1.3.0' });
  await flush();
  assert.equal(failing.coordinator.status().latestVersion, '1.3.0');

  rejectHandoff(new Error('shutdown failed'));
  await flush();
  assert.equal(failing.coordinator.status().status, 'downloaded');
  assert.equal(failing.coordinator.status().latestVersion, '1.3.0');
  assert.equal(failing.dialogs.length, 1);
});

test('silently replaces an install-on-quit release with a higher downloaded version', async () => {
  const deferred = harness({ choices: [1] });
  deferred.coordinator.start();

  deferred.updater.emit('update-available', { version: '1.2.0' });
  await flush();
  assert.equal(deferred.updater.downloadCalls, 1);
  deferred.updater.emit('update-downloaded', { version: '1.2.0' });
  await flush();
  assert.equal(deferred.dialogs.length, 1);
  assert.equal(deferred.restartCalls.length, 0);

  deferred.updater.emit('update-available', { version: '1.2.0' });
  await flush();
  assert.equal(deferred.updater.downloadCalls, 1);

  deferred.updater.emit('update-downloaded', { version: '1.2.0' });
  await flush();
  assert.equal(deferred.dialogs.length, 1);
  assert.equal(deferred.restartCalls.length, 0);

  deferred.updater.emit('update-available', { version: '1.3.0' });
  await flush();
  assert.equal(deferred.updater.downloadCalls, 2);
  deferred.updater.emit('update-downloaded', { version: '1.3.0' });
  await flush();
  assert.equal(deferred.dialogs.length, 1);
  assert.equal(deferred.restartCalls.length, 0);
  assert.equal(deferred.coordinator.status().status, 'downloaded');
  assert.equal(deferred.coordinator.status().latestVersion, '1.3.0');
  assert.equal(
    deferred.logs.some((entry) => /superseded 1\.2\.0/.test(entry.message)),
    true,
  );

  deferred.updater.emit('update-downloaded', { version: '1.1.0' });
  await flush();
  assert.equal(deferred.dialogs.length, 1);
  assert.equal(deferred.coordinator.status().latestVersion, '1.3.0');
});

test('a refresh failure does not replace a deferred ready state with an error', async () => {
  const { updater, coordinator, intervals, states } = harness({ choices: [1] });
  coordinator.start();
  updater.emit('update-downloaded', { version: '1.2.0' });
  await flush();
  updater.checkForUpdates = async () => {
    throw new Error('refresh unavailable');
  };

  intervals[0].callback();
  await flush();
  assert.equal(states.at(-1).status, 'downloaded');
  assert.equal(states.at(-1).latestVersion, '1.2.0');
});

test('does not prompt when the main window is absent or destroyed', async () => {
  const absent = harness({ window: null, choices: [0] });
  absent.coordinator.start();
  absent.updater.emit('update-available', { version: '1.2.0' });
  await flush();
  assert.equal(absent.dialogs.length, 0);
  assert.equal(absent.coordinator.status().status, 'downloading');
  assert.equal(absent.updater.downloadCalls, 1);

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
