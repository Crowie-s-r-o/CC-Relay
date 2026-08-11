import { app, BrowserWindow, dialog, nativeImage, shell } from 'electron';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronUpdater from 'electron-updater';
import { desktopZoomFactorForInput } from './desktop-zoom.mjs';
import { createDesktopUpdater } from './desktop-updater.mjs';
import { DiagnosticLog } from './diagnostics.mjs';
import { RELAY_APPLICATION_DIRECTORY } from './server-options.mjs';

const { autoUpdater } = electronUpdater;
const DESKTOP_RELAY_PORT = 0;
const DESKTOP_CODEX_PORT = 0;
const APP_ICON_PATH = fileURLToPath(new URL('../build/icon.png', import.meta.url));
const PRODUCT_NAME = 'CC Relay';
const DESKTOP_DATA_ROOT = join(app.getPath('appData'), RELAY_APPLICATION_DIRECTORY);
mkdirSync(DESKTOP_DATA_ROOT, { recursive: true });
app.setPath('userData', DESKTOP_DATA_ROOT);
app.setName(PRODUCT_NAME);
let mainWindow = null;
let relayShutdown = null;
let quitting = false;
let desktopDiagnostics = null;

function errorDetails(error) {
  return {
    errorName: error?.name || 'Error',
    error: error?.message || String(error),
    stack: error?.stack,
  };
}

function desktopDiagnostic(event, details = {}) {
  return desktopDiagnostics?.write(event, {
    processId: process.pid,
    ...details,
  });
}

function initializeDesktopDiagnostics(dataRoot) {
  desktopDiagnostics = new DiagnosticLog(join(dataRoot, 'relay-diagnostics.jsonl'));
  desktopDiagnostic('desktop.start.requested', {
    version: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    dataRoot,
    logFile: desktopDiagnostics.filePath,
  });
}

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

function applyDevelopmentAppIcon() {
  if (app.isPackaged) return undefined;
  const icon = nativeImage.createFromPath(APP_ICON_PATH);
  if (icon.isEmpty()) return undefined;
  if (process.platform === 'darwin') app.dock.setIcon(icon);
  return icon;
}

async function createWindow() {
  const dataRoot = app.getPath('userData');
  initializeDesktopDiagnostics(dataRoot);
  restoreMacShellPath();
  const appIcon = applyDevelopmentAppIcon();
  process.argv.push(
    '--relay-data-dir',
    dataRoot,
    '--relay-config-dir',
    dataRoot,
    '--relay-port',
    String(DESKTOP_RELAY_PORT),
    '--relay-codex-port',
    String(DESKTOP_CODEX_PORT),
    '--relay-desktop',
  );
  desktopDiagnostic('desktop.server.start.requested', {
    host: '127.0.0.1',
    requestedPort: DESKTOP_RELAY_PORT,
    requestedCodexPort: DESKTOP_CODEX_PORT,
    portSelection: 'operating-system',
  });
  const relay = await import('./server.mjs');
  const endpoint = await relay.serverReady;
  relayShutdown = relay.shutdown;
  desktopDiagnostic('desktop.server.ready', endpoint);

  mainWindow = new BrowserWindow({
    width: 1540,
    height: 980,
    minWidth: 1040,
    minHeight: 700,
    backgroundColor: '#dfe7e4',
    title: PRODUCT_NAME,
    ...(appIcon ? { icon: appIcon } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  desktopDiagnostic('desktop.window.created', {
    width: 1540,
    height: 980,
  });
  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on(
    'did-fail-load',
    (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      desktopDiagnostic('desktop.window.load.failed', {
        errorCode,
        error: errorDescription,
        url: validatedURL,
        mainFrame: isMainFrame,
      });
    },
  );
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    desktopDiagnostic('desktop.renderer.gone', {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
  mainWindow.on('unresponsive', () => {
    desktopDiagnostic('desktop.window.unresponsive', { url: endpoint.url });
  });
  mainWindow.on('responsive', () => {
    desktopDiagnostic('desktop.window.responsive', { url: endpoint.url });
  });
  mainWindow.on('closed', () => {
    desktopDiagnostic('desktop.window.closed', { url: endpoint.url });
    mainWindow = null;
  });
  desktopDiagnostic('desktop.window.load.requested', { url: endpoint.url });
  await mainWindow.loadURL(endpoint.url);
  desktopDiagnostic('desktop.window.load.completed', { url: endpoint.url });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const currentFactor = mainWindow.webContents.getZoomFactor();
    const nextFactor = desktopZoomFactorForInput(input, currentFactor);
    if (nextFactor == null) return;
    event.preventDefault();
    if (nextFactor === currentFactor) return;
    mainWindow.webContents.setZoomFactor(nextFactor);
    desktopDiagnostic('desktop.window.zoom.changed', {
      factor: nextFactor,
      percent: Math.round(nextFactor * 100),
    });
  });
  desktopUpdater.start();
  desktopDiagnostic('desktop.updater.started');
}

const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    desktopDiagnostic('desktop.second_instance.received', {
      windowAvailable: Boolean(mainWindow && !mainWindow.isDestroyed()),
    });
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.whenReady().then(createWindow).catch((error) => {
    desktopDiagnostic('desktop.start.failed', errorDetails(error));
    console.error(error);
    const logFile = desktopDiagnostics?.filePath || 'the CC Relay application data directory';
    dialog.showErrorBox(
      'CC Relay could not start',
      `${error?.message || String(error)}\n\nDiagnostics: ${logFile}`,
    );
    quitting = true;
    if (!relayShutdown) {
      app.quit();
      return;
    }
    relayShutdown().catch((shutdownError) => {
      desktopDiagnostic('desktop.shutdown.failed', errorDetails(shutdownError));
    }).finally(() => app.quit());
  });
}

process.on('uncaughtExceptionMonitor', (error) => {
  desktopDiagnostic('desktop.process.uncaught_exception', errorDetails(error));
});
app.on('child-process-gone', (event, details) => {
  desktopDiagnostic('desktop.child_process.gone', {
    type: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
    name: details.name,
    serviceName: details.serviceName,
  });
});
app.on('window-all-closed', () => {
  desktopDiagnostic('desktop.window.all_closed');
  app.quit();
});
app.on('before-quit', (event) => {
  desktopDiagnostic('desktop.shutdown.requested', {
    relayAvailable: Boolean(relayShutdown),
    alreadyQuitting: quitting,
  });
  if (quitting || !relayShutdown) return;
  event.preventDefault();
  quitting = true;
  relayShutdown().then(() => {
    desktopDiagnostic('desktop.shutdown.completed');
  }).catch((error) => {
    desktopDiagnostic('desktop.shutdown.failed', errorDetails(error));
  }).finally(() => app.quit());
});
