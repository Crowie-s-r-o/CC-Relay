import { app, BrowserWindow, dialog, shell } from 'electron';
import { execFileSync } from 'node:child_process';
import { autoUpdater } from 'electron-updater';
import { createDesktopUpdater } from './desktop-updater.mjs';

const RELAY_URL = 'http://127.0.0.1:4768';
let mainWindow = null;
let relayShutdown = null;
let quitting = false;

const desktopUpdater = createDesktopUpdater({
  updater: autoUpdater,
  dialog,
  getCurrentVersion: () => app.getVersion(),
  isEligible: () => app.isPackaged && (
    process.platform === 'darwin'
    || (process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_FILE)
  ),
  getMainWindow: () => mainWindow,
  restartAndInstall: async () => {
    quitting = true;
    try {
      if (relayShutdown) await relayShutdown();
    } finally {
      autoUpdater.quitAndInstall(false, true);
    }
  },
  logger: console,
  timer: setTimeout,
});

function restoreMacShellPath() {
  if (process.platform !== 'darwin') return;
  try {
    const loginPath = execFileSync('/bin/zsh', ['-lic', 'printf %s "$PATH"'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (loginPath) process.env.PATH = loginPath;
  } catch {}
}

async function createWindow() {
  restoreMacShellPath();
  process.argv.push('--relay-data-dir', app.getPath('userData'));
  const relay = await import('./server.mjs');
  relayShutdown = relay.shutdown;
  if (!relay.server.listening) {
    await new Promise((resolve) => relay.server.once('listening', resolve));
  }

  mainWindow = new BrowserWindow({
    width: 1540,
    height: 980,
    minWidth: 1040,
    minHeight: 700,
    backgroundColor: '#dfe7e4',
    title: 'Relay',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  await mainWindow.loadURL(RELAY_URL);
  await mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
  mainWindow.webContents.setZoomFactor(1);
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const zoomShortcut = (input.meta || input.control) && ['+', '=', '-', '0'].includes(input.key);
    if (!zoomShortcut) return;
    event.preventDefault();
    mainWindow.webContents.setZoomFactor(1);
  });
  desktopUpdater.start();
}

const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(createWindow).catch((error) => {
    console.error(error);
    app.quit();
  });
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (quitting || !relayShutdown) return;
  event.preventDefault();
  quitting = true;
  relayShutdown().finally(() => app.quit());
});
