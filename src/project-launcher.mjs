import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { TerminalRuntimeResolver, normalizeTerminalTty } from './terminal-runtime-resolver.mjs';

const execFile = promisify(execFileCallback);
const TERMINAL_CLOSE_TIMEOUT_MS = 10_000;
const TERMINAL_PROCESS_DRAIN_TIMEOUT_MS = 2_000;
const TERMINAL_PROCESS_DRAIN_POLL_MS = 50;
const SHARED_CODEX_ENDPOINT = 'ws://127.0.0.1:4769';
export const CODEX_RELAY_COMMAND = `codex --dangerously-bypass-approvals-and-sandbox --cd . --remote ${SHARED_CODEX_ENDPOINT}`;
export const CLAUDE_RELAY_COMMAND = 'claude --dangerously-skip-permissions';

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

export function powershellQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function cmdQuote(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function terminalTtyName(value) {
  const tty = normalizeTerminalTty(value);
  if (!tty?.startsWith('/dev/')) return null;
  const name = tty.slice('/dev/'.length);
  return /^[a-zA-Z0-9._-]+$/.test(name) ? name : null;
}

export function terminalProcessIds(output) {
  // Process identifiers stay strings so they can be passed straight to execFile.
  return String(output ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line));
}

export function codexRelayCommand(
  path,
  quote = shellQuote,
  endpoint = SHARED_CODEX_ENDPOINT,
  resumeThreadId = null,
) {
  const command = resumeThreadId ? `codex resume ${quote(resumeThreadId)}` : 'codex';
  return `${command} --dangerously-bypass-approvals-and-sandbox --cd ${quote(path)} --remote ${endpoint}`;
}

export function claudeRelayCommand(
  sessionId = null,
  quote = shellQuote,
  binary = 'claude',
  resumeSessionId = null,
) {
  // Pin the exact resolved binary so the interactive terminal runs the same
  // claude Relay discovered, instead of relying on shell PATH order. The bare
  // 'claude' default stays unquoted for backward compatibility.
  const bin = binary && binary !== 'claude' ? quote(binary) : 'claude';
  const sessionArgument = resumeSessionId
    ? ` --resume ${quote(resumeSessionId)}`
    : sessionId
      ? ` --session-id ${quote(sessionId)}`
      : '';
  return `${bin} --dangerously-skip-permissions${sessionArgument}`;
}

export function normalizeTerminalLayout(layout) {
  if (!layout?.enabled) return null;
  const rows = Number(layout.rows);
  const columns = Number(layout.columns);
  const display = Number(layout.display);
  if (!Number.isInteger(rows) || rows < 1 || rows > 8
    || !Number.isInteger(columns) || columns < 1 || columns > 8) {
    throw new Error('Terminal grid rows and columns must be whole numbers from 1 to 8.');
  }
  return {
    enabled: true,
    rows,
    columns,
    display: Number.isInteger(display) && display >= 0 ? display : 0,
  };
}

export function gridBounds(display, layout, slot) {
  const width = Math.floor(display.width / layout.columns);
  const height = Math.floor(display.height / layout.rows);
  const column = slot % layout.columns;
  const row = Math.floor(slot / layout.columns) % layout.rows;
  const left = display.x + column * width;
  const top = display.y + row * height;
  return {
    left,
    top,
    right: column === layout.columns - 1 ? display.x + display.width : left + width,
    bottom: row === layout.rows - 1 ? display.y + display.height : top + height,
  };
}

function boundsOverlapArea(left, right) {
  const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  return width * height;
}

export function firstAvailableGridSlot(display, layout, windowBounds) {
  const slotCount = layout.rows * layout.columns;
  const occupied = new Set();
  for (const bounds of windowBounds) {
    let bestSlot = null;
    let bestOverlap = 0;
    for (let slot = 0; slot < slotCount; slot += 1) {
      const overlap = boundsOverlapArea(bounds, gridBounds(display, layout, slot));
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestSlot = slot;
      }
    }
    if (bestSlot !== null && bestOverlap > 0) occupied.add(bestSlot);
  }
  for (let slot = 0; slot < slotCount; slot += 1) {
    if (!occupied.has(slot)) return slot;
  }
  return null;
}

export function validateProjectPath(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) {
    throw new Error('Choose an absolute project folder.');
  }
  const resolved = realpathSync(path);
  if (!statSync(resolved).isDirectory()) {
    throw new Error('The selected project path is not a folder.');
  }
  return { path: resolved, name: basename(resolved) || resolved };
}

export function terminalCommand(path, provider, {
  claudeSessionId = null,
  codexEndpoint = SHARED_CODEX_ENDPOINT,
  claudeBinary = 'claude',
  resumeThreadId = null,
} = {}) {
  if (!['codex', 'claude'].includes(provider)) {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }
  const command = provider === 'codex'
    ? codexRelayCommand(path, shellQuote, codexEndpoint, resumeThreadId)
    : claudeRelayCommand(claudeSessionId, shellQuote, claudeBinary, resumeThreadId);
  return `cd ${shellQuote(path)} && ${command}`;
}

export class ProjectLauncher {
  constructor({
    run = execFile,
    platform = process.platform,
    diagnostic = () => {},
    ensureCodexReady = async () => {},
    reserveCodexLaunch = () => null,
    codexClientForThread = () => null,
    runtimeResolver = null,
    createId = randomUUID,
    now = Date.now,
    delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    recoveryRetryMs = 15_000,
    claudeBinary = 'claude',
  } = {}) {
    this.run = run;
    this.platform = platform;
    this.diagnostic = diagnostic;
    this.claudeBinary = claudeBinary;
    this.ensureCodexReady = ensureCodexReady;
    this.reserveCodexLaunch = reserveCodexLaunch;
    this.createId = createId;
    this.now = now;
    this.delay = delay;
    this.recoveryRetryMs = recoveryRetryMs;
    this.runtimeResolver = runtimeResolver || new TerminalRuntimeResolver({
      run,
      platform,
      codexClientForThread,
      diagnostic,
    });
    this.gridSlots = new Map();
    this.launchQueue = Promise.resolve();
    this.ownedTerminalWindowIds = new Set();
    this.ownedTerminalProcessIds = new Set();
    this.ownedTerminals = new Map();
    this.recoveryRetryAt = new Map();
    this.closing = false;
  }

  trackOwnedTerminal({
    launchId = this.createId(),
    provider,
    path,
    terminalWindowId = null,
    terminalProcessId = null,
    terminalTty = null,
    runtimeProcessId = null,
    expectedThreadId = null,
    closeOnShutdown = true,
    ownershipSource = 'launch',
    cancelWorkspaceReservation = null,
  }) {
    if (!terminalWindowId && !terminalProcessId) return null;
    const duplicate = [...this.ownedTerminals.values()].find((terminal) => (
      (terminalWindowId && terminal.terminalWindowId === terminalWindowId)
      || (terminalProcessId && terminal.terminalProcessId === terminalProcessId)
    ));
    if (duplicate && duplicate.launchId !== launchId) {
      throw new Error('That native terminal is already bound to another Relay session.');
    }
    this.ownedTerminals.set(launchId, {
      launchId,
      provider,
      path,
      threadId: null,
      terminalWindowId,
      terminalProcessId,
      terminalTty,
      runtimeProcessId,
      expectedThreadId,
      closeOnShutdown,
      ownershipSource,
      cancelWorkspaceReservation,
    });
    if (closeOnShutdown && terminalWindowId) this.ownedTerminalWindowIds.add(terminalWindowId);
    if (closeOnShutdown && terminalProcessId) this.ownedTerminalProcessIds.add(terminalProcessId);
    return launchId;
  }

  forgetTrackedTerminal(launchId) {
    const terminal = this.ownedTerminals.get(launchId);
    if (!terminal) return false;
    this.ownedTerminals.delete(launchId);
    if (terminal.threadId) this.recoveryRetryAt.delete(terminal.threadId);
    if (terminal.closeOnShutdown && terminal.terminalWindowId) {
      this.ownedTerminalWindowIds.delete(terminal.terminalWindowId);
    }
    if (terminal.closeOnShutdown && terminal.terminalProcessId) {
      this.ownedTerminalProcessIds.delete(terminal.terminalProcessId);
    }
    return true;
  }

  releaseLaunchReservation(launchId) {
    const terminal = this.ownedTerminals.get(launchId);
    const cancel = terminal?.cancelWorkspaceReservation;
    if (typeof cancel !== 'function') return false;
    terminal.cancelWorkspaceReservation = null;
    try {
      cancel();
    } catch (error) {
      this.diagnostic('terminal.launch.reservation_release_failed', {
        launchId,
        error: error.message,
      });
    }
    return true;
  }

  bindOwnedTerminal(launchId, thread) {
    const terminal = this.ownedTerminals.get(launchId);
    if (!terminal) {
      throw new Error('That terminal launch is not owned by this Relay instance.');
    }
    const threadId = typeof thread?.id === 'string' ? thread.id.trim() : '';
    if (!threadId || !['codex', 'claude'].includes(thread?.provider) || typeof thread?.cwd !== 'string') {
      throw new Error('A connected Codex or Claude session is required to bind the terminal launch.');
    }
    const path = validateProjectPath(thread.cwd).path;
    if (terminal.provider !== thread.provider || terminal.path !== path) {
      throw new Error('The connected session does not match the launched terminal provider and project.');
    }
    const existing = [...this.ownedTerminals.values()].find((item) => (
      item.threadId === threadId && item.launchId !== launchId
    ));
    if (existing) {
      throw new Error('That connected session is already bound to another terminal launch.');
    }
    if (terminal.threadId && terminal.threadId !== threadId) {
      throw new Error('That terminal launch is already bound to another connected session.');
    }
    terminal.threadId = threadId;
    this.releaseLaunchReservation(launchId);
    this.diagnostic('terminal.session.bound', {
      launchId,
      threadId,
      provider: terminal.provider,
      path: terminal.path,
      ownershipSource: terminal.ownershipSource,
    });
    return this.terminalForThread(threadId);
  }

  async recoverConnectedTerminals(threads) {
    if (!this.runtimeResolver || !Array.isArray(threads)) return [];
    const timestamp = this.now();
    const candidates = threads.filter((thread) => (
      thread?.id
      && !this.terminalForThread(thread.id)
      && !this.pendingLaunchMatches(thread)
      && (this.recoveryRetryAt.get(thread.id) || 0) <= timestamp
    ));
    if (candidates.length === 0) return [];
    for (const thread of candidates) {
      this.recoveryRetryAt.set(thread.id, timestamp + this.recoveryRetryMs);
    }

    let resolved;
    try {
      resolved = await this.runtimeResolver.resolve(candidates);
    } catch (error) {
      this.diagnostic('terminal.recovery.failed', { error: error.message });
      return [];
    }

    const recovered = [];
    for (const nativeTerminal of resolved) {
      const thread = candidates.find((item) => item.id === nativeTerminal.threadId);
      if (!thread || this.terminalForThread(thread.id)) continue;
      const launchId = `runtime-${this.createId()}`;
      try {
        this.trackOwnedTerminal({
          launchId,
          provider: thread.provider,
          path: validateProjectPath(thread.cwd).path,
          terminalWindowId: nativeTerminal.terminalWindowId,
          terminalProcessId: nativeTerminal.terminalProcessId,
          terminalTty: nativeTerminal.terminalTty,
          runtimeProcessId: nativeTerminal.runtimeProcessId,
          closeOnShutdown: false,
          ownershipSource: 'runtime',
        });
        this.bindOwnedTerminal(launchId, thread);
        recovered.push(this.terminalForThread(thread.id));
        this.diagnostic('terminal.recovery.completed', {
          launchId,
          threadId: thread.id,
          provider: thread.provider,
          path: thread.cwd,
          terminalWindowId: nativeTerminal.terminalWindowId,
          terminalProcessId: nativeTerminal.terminalProcessId,
          terminalTty: nativeTerminal.terminalTty,
          runtimeProcessId: nativeTerminal.runtimeProcessId,
        });
      } catch (error) {
        this.forgetTrackedTerminal(launchId);
        this.diagnostic('terminal.recovery.rejected', {
          threadId: thread.id,
          provider: thread.provider,
          error: error.message,
        });
      }
    }
    return recovered;
  }

  pendingLaunchMatches(thread) {
    if (!thread?.provider || typeof thread.cwd !== 'string') return false;
    let path;
    try {
      path = validateProjectPath(thread.cwd).path;
    } catch {
      return false;
    }
    return [...this.ownedTerminals.values()].some((terminal) => (
      !terminal.threadId
      && terminal.provider === thread.provider
      && terminal.path === path
    ));
  }

  async verifyTerminalForThread(thread) {
    const terminal = [...this.ownedTerminals.values()].find((item) => item.threadId === thread?.id);
    if (!terminal) return false;
    if (terminal.ownershipSource !== 'runtime') return true;
    let resolved;
    try {
      resolved = await this.runtimeResolver.resolve([thread]);
    } catch (error) {
      this.forgetTrackedTerminal(terminal.launchId);
      this.diagnostic('terminal.recovery.verification_failed', {
        threadId: thread.id,
        error: error.message,
      });
      return false;
    }
    const current = resolved.find((item) => item.threadId === thread.id);
    const verified = Boolean(
      current
      && current.terminalWindowId === terminal.terminalWindowId
      && current.terminalTty === terminal.terminalTty
    );
    if (!verified) {
      this.forgetTrackedTerminal(terminal.launchId);
      this.diagnostic('terminal.recovery.identity_changed', {
        threadId: thread.id,
        provider: thread.provider,
      });
    } else if (current.runtimeProcessId !== terminal.runtimeProcessId) {
      const previousRuntimeProcessId = terminal.runtimeProcessId;
      terminal.runtimeProcessId = current.runtimeProcessId;
      this.diagnostic('terminal.recovery.process_refreshed', {
        threadId: thread.id,
        provider: thread.provider,
        previousRuntimeProcessId,
        runtimeProcessId: current.runtimeProcessId,
      });
    }
    return verified;
  }

  refreshTerminalRuntimeIdentity(threadId, current) {
    const terminal = [...this.ownedTerminals.values()].find((item) => item.threadId === threadId);
    if (!terminal || !current) return false;
    const sameTerminal = current.terminalWindowId === terminal.terminalWindowId
      && (!terminal.terminalTty || current.terminalTty === terminal.terminalTty);
    if (!sameTerminal) return false;
    const previousRuntimeProcessId = terminal.runtimeProcessId;
    terminal.terminalTty ||= current.terminalTty || null;
    terminal.runtimeProcessId = current.runtimeProcessId || null;
    if (terminal.runtimeProcessId !== previousRuntimeProcessId) {
      this.diagnostic('terminal.process.refreshed', {
        launchId: terminal.launchId,
        threadId,
        provider: terminal.provider,
        previousRuntimeProcessId,
        runtimeProcessId: terminal.runtimeProcessId,
      });
    }
    return true;
  }

  terminalForThread(threadId) {
    const terminal = [...this.ownedTerminals.values()].find((item) => item.threadId === threadId);
    if (!terminal) return null;
    return {
      launchId: terminal.launchId,
      threadId: terminal.threadId,
      provider: terminal.provider,
      path: terminal.path,
    };
  }

  terminalForLaunch(launchId) {
    const terminal = this.ownedTerminals.get(launchId);
    if (!terminal) return null;
    return {
      launchId: terminal.launchId,
      threadId: terminal.threadId,
      provider: terminal.provider,
      path: terminal.path,
    };
  }

  async listDisplays() {
    this.ensureSupported();
    if (this.platform === 'win32') {
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$screens = [System.Windows.Forms.Screen]::AllScreens | ForEach-Object {',
        '[PSCustomObject]@{ name = $_.DeviceName; x = $_.WorkingArea.X; y = $_.WorkingArea.Y; width = $_.WorkingArea.Width; height = $_.WorkingArea.Height; primary = $_.Primary }',
        '}',
        '$screens | ConvertTo-Json -Compress',
      ].join('; ');
      const { stdout } = await this.run('powershell.exe', ['-NoProfile', '-Command', script]);
      const parsed = JSON.parse(stdout.trim() || '[]');
      return Array.isArray(parsed) ? parsed : [parsed];
    }
    const script = `ObjC.import('AppKit');
const screens = $.NSScreen.screens.js;
const maxY = Math.max(...screens.map((screen) => screen.frame.origin.y + screen.frame.size.height));
JSON.stringify(screens.map((screen, index) => {
  const frame = screen.visibleFrame;
  return {
    name: ObjC.unwrap(screen.localizedName) || \`Display \${index + 1}\`,
    x: Math.round(frame.origin.x),
    y: Math.round(maxY - frame.origin.y - frame.size.height),
    width: Math.round(frame.size.width),
    height: Math.round(frame.size.height),
    primary: index === 0,
  };
}));`;
    const { stdout } = await this.run('osascript', ['-l', 'JavaScript', '-e', script]);
    return JSON.parse(stdout.trim() || '[]');
  }

  async listTerminalWindowBounds() {
    if (this.platform !== 'darwin') return [];
    const script = `const terminal = Application('Terminal');
JSON.stringify(terminal.running() ? terminal.windows().map((window) => {
  const bounds = window.bounds();
  return { left: bounds[0], top: bounds[1], right: bounds[2], bottom: bounds[3] };
}) : []);`;
    const { stdout } = await this.run('osascript', ['-l', 'JavaScript', '-e', script]);
    const parsed = JSON.parse(stdout.trim() || '[]');
    return Array.isArray(parsed) ? parsed : [];
  }

  ensureSupported() {
    if (!['darwin', 'win32'].includes(this.platform)) {
      throw new Error('The native project launcher supports macOS and Windows.');
    }
  }

  async chooseFolder() {
    this.ensureSupported();
    if (this.platform === 'win32') {
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$picker = New-Object System.Windows.Forms.FolderBrowserDialog',
        "$picker.Description = 'Choose a project folder for Relay'",
        'if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $picker.SelectedPath }',
      ].join('; ');
      const { stdout } = await this.run('powershell.exe', [
        '-NoProfile', '-STA', '-Command', script,
      ]);
      const selected = stdout.trim();
      return selected ? validateProjectPath(selected) : null;
    }
    try {
      const { stdout } = await this.run('osascript', [
        '-e',
        'POSIX path of (choose folder with prompt "Choose a project folder for Relay")',
      ]);
      return validateProjectPath(stdout.trim());
    } catch (error) {
      if (error.code === 1 && /cancel/i.test(`${error.stderr || ''}${error.message || ''}`)) {
        return null;
      }
      throw error;
    }
  }

  async launch(path, provider, requestedLayout = null, options = {}) {
    if (this.closing) {
      throw new Error('Relay is closing and cannot launch another terminal.');
    }
    const launch = this.launchQueue.then(() => this.launchNow(path, provider, requestedLayout, options));
    this.launchQueue = launch.catch(() => {});
    return launch;
  }

  async launchNow(path, provider, requestedLayout = null, { resumeThreadId = null } = {}) {
    this.ensureSupported();
    const project = validateProjectPath(path);
    if (!['codex', 'claude'].includes(provider)) {
      throw new Error(`Unsupported AI provider: ${provider}`);
    }
    if (provider === 'codex') {
      this.diagnostic('terminal.launch.waiting_for_codex', { path: project.path });
      await this.ensureCodexReady();
      this.diagnostic('terminal.launch.codex_ready', { path: project.path });
    }
    const expectedLaunchId = this.createId();
    const expectedThreadId = typeof resumeThreadId === 'string' && resumeThreadId.trim()
      ? resumeThreadId.trim()
      : expectedLaunchId;
    const layout = normalizeTerminalLayout(requestedLayout);
    const background = requestedLayout?.background === true;
    const displays = layout ? await this.listDisplays() : [];
    const displayIndex = displays.length ? Math.min(layout?.display || 0, displays.length - 1) : 0;
    const display = displays[displayIndex];
    const gridKey = layout && display ? `${displayIndex}:${layout.columns}x${layout.rows}` : null;
    let slot = gridKey ? this.gridSlots.get(gridKey) || 0 : 0;
    if (gridKey && this.platform === 'darwin') {
      try {
        const windowBounds = await this.listTerminalWindowBounds();
        slot = firstAvailableGridSlot(display, layout, windowBounds) ?? slot;
      } catch (error) {
        this.diagnostic('terminal.layout.inspect_failed', { message: error.message });
      }
    }
    const bounds = display ? gridBounds(display, layout, slot) : null;
    if (gridKey) this.gridSlots.set(gridKey, (slot + 1) % (layout.rows * layout.columns));
    const workspaceReservation = provider === 'codex'
      ? await this.reserveCodexLaunch(project.path, expectedLaunchId)
      : null;
    const cancelWorkspaceReservation = typeof workspaceReservation === 'function'
      ? workspaceReservation
      : workspaceReservation?.cancel;
    const codexEndpoint = workspaceReservation?.endpoint || SHARED_CODEX_ENDPOINT;
    const command = this.platform === 'win32'
      ? provider === 'codex'
        ? codexRelayCommand(project.path, cmdQuote, codexEndpoint, resumeThreadId)
        : claudeRelayCommand(
          resumeThreadId ? null : expectedLaunchId,
          cmdQuote,
          this.claudeBinary,
          resumeThreadId,
        )
      : terminalCommand(project.path, provider, {
        claudeSessionId: resumeThreadId ? null : expectedLaunchId,
        codexEndpoint,
        claudeBinary: this.claudeBinary,
        resumeThreadId,
      });
    this.diagnostic('terminal.launch.requested', {
      launchId: expectedLaunchId,
      provider,
      path: project.path,
      platform: this.platform,
      layout,
      background,
      slot,
      bounds,
      endpoint: provider === 'codex' ? codexEndpoint : undefined,
      resumeThreadId: resumeThreadId || undefined,
    });
    if (this.platform === 'win32') {
      const startProcess = `$process = Start-Process -FilePath 'cmd.exe' -WorkingDirectory ${powershellQuote(project.path)} -ArgumentList '/k', ${powershellQuote(command)}${background ? " -WindowStyle Minimized" : ''} -PassThru`;
      const placement = bounds ? [
        'Add-Type -TypeDefinition \"using System; using System.Runtime.InteropServices; public class RelayWindow { [DllImport(\\\"user32.dll\\\")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hgt, bool repaint); }\"',
        startProcess,
        '$null = $process.WaitForInputIdle(5000)',
        'Start-Sleep -Milliseconds 150',
        `$null = [RelayWindow]::MoveWindow($process.MainWindowHandle, ${bounds.left}, ${bounds.top}, ${bounds.right - bounds.left}, ${bounds.bottom - bounds.top}, $true)`,
        '$process.Id',
      ].join('; ') : `${startProcess}; $process.Id`;
      const script = placement;
      let terminalProcessId = null;
      try {
        const { stdout = '' } = await this.run('powershell.exe', ['-NoProfile', '-Command', script]);
        const parsedProcessId = Number.parseInt(stdout.trim(), 10);
        if (Number.isInteger(parsedProcessId) && parsedProcessId > 0) {
          terminalProcessId = parsedProcessId;
        }
      } catch (error) {
        cancelWorkspaceReservation?.();
        throw error;
      }
      const launchId = this.trackOwnedTerminal({
        launchId: expectedLaunchId,
        provider,
        path: project.path,
        terminalProcessId,
        expectedThreadId,
        cancelWorkspaceReservation,
      });
      if (!launchId) cancelWorkspaceReservation?.();
      this.diagnostic('terminal.launch.dispatched', {
        launchId,
        provider,
        path: project.path,
        platform: this.platform,
        terminalProcessId,
      });
      return {
        ...project,
        provider,
        command,
        layout,
        display: display || null,
        slot,
        bounds,
        launchId,
        expectedThreadId,
        terminalProcessId,
      };
    }
    const backgroundCommand = background
      ? '\nset miniaturized of launchedWindow to true'
      : '';
    const windowCaptureCommand = '\nset launchedWindow to first window whose selected tab is launchedTab\nset launchedWindowId to id of launchedWindow';
    const boundsAssignment = bounds
      ? `\nset bounds of window id launchedWindowId to {${bounds.left}, ${bounds.top}, ${bounds.right}, ${bounds.bottom}}\ndelay 0.4\nset bounds of window id launchedWindowId to {${bounds.left}, ${bounds.top}, ${bounds.right}, ${bounds.bottom}}`
      : '';
    const script = `tell application "Terminal"\n${background ? '' : 'activate\n'}set launchedTab to do script ${JSON.stringify(command)}${windowCaptureCommand}${boundsAssignment}${backgroundCommand}\nreturn launchedWindowId\nend tell`;
    let terminalWindowId = null;
    try {
      const { stdout = '' } = await this.run('osascript', ['-e', script]);
      const parsedWindowId = Number.parseInt(stdout.trim(), 10);
      if (Number.isInteger(parsedWindowId) && parsedWindowId > 0) {
        terminalWindowId = parsedWindowId;
      }
    } catch (error) {
      cancelWorkspaceReservation?.();
      throw error;
    }
    const launchId = this.trackOwnedTerminal({
      launchId: expectedLaunchId,
      provider,
      path: project.path,
      terminalWindowId,
      expectedThreadId,
      cancelWorkspaceReservation,
    });
    if (!launchId) cancelWorkspaceReservation?.();
    this.diagnostic('terminal.launch.dispatched', {
      launchId,
      provider,
      path: project.path,
      platform: this.platform,
      terminalWindowId,
    });
    return {
      ...project,
      provider,
      command,
      layout,
      display: display || null,
      slot,
      bounds,
      launchId,
      expectedThreadId,
      terminalWindowId,
    };
  }

  async closeOwnedTerminal(threadId) {
    if (this.closing) {
      throw new Error('Relay is closing and cannot change terminal sessions.');
    }
    const close = this.launchQueue.then(() => this.closeOwnedTerminalNow(threadId));
    this.launchQueue = close.catch(() => {});
    return close;
  }

  async closeOwnedLaunch(launchId) {
    if (this.closing) {
      throw new Error('Relay is closing and cannot change terminal sessions.');
    }
    const close = this.launchQueue.then(() => {
      const terminal = this.ownedTerminals.get(launchId);
      if (!terminal) {
        throw new Error('Relay could not verify an exact native terminal for this launch.');
      }
      return this.closeTrackedTerminalNow(terminal);
    });
    this.launchQueue = close.catch(() => {});
    return close;
  }

  async terminateMacTerminalWindow(terminal) {
    const expectedTtyCheck = terminal.terminalTty
      ? `\nif (tty of first tab of targetWindow) is not ${JSON.stringify(terminal.terminalTty)} then error "The recovered terminal identity changed."`
      : '';
    const inspectScript = `tell application "Terminal"\nif not (exists window id ${terminal.terminalWindowId}) then error "The terminal window is no longer open."\nset targetWindow to window id ${terminal.terminalWindowId}\nif (count of tabs of targetWindow) is not 1 then error "The terminal now contains multiple tabs."${expectedTtyCheck}\nreturn tty of first tab of targetWindow\nend tell`;
    const { stdout = '' } = await this.run(
      'osascript',
      ['-e', inspectScript],
      { timeout: TERMINAL_CLOSE_TIMEOUT_MS },
    );
    const tty = normalizeTerminalTty(stdout);
    const ttyName = terminalTtyName(tty);
    if (!tty || !ttyName) {
      throw new Error('The terminal TTY could not be verified.');
    }

    const { processIds } = await this.macTerminalProcessSnapshot(ttyName);
    if (processIds.length > 0) {
      try {
        await this.run(
          'kill',
          ['-9', ...processIds],
          { timeout: TERMINAL_CLOSE_TIMEOUT_MS },
        );
      } catch (error) {
        // kill exits 1 when a listed process already vanished between the snapshot and
        // the signal, or when the signal is refused for one of the enumerated targets.
        // The drain gate below, not this exit code, decides whether the TTY is clear.
        if (error?.code !== 1) throw error;
      }
    }

    await this.waitForMacTerminalProcessesToExit(ttyName);

    const closeScript = `tell application "Terminal"\nif exists window id ${terminal.terminalWindowId} then close window id ${terminal.terminalWindowId} saving no\nend tell`;
    await this.run('osascript', ['-e', closeScript], { timeout: TERMINAL_CLOSE_TIMEOUT_MS });
    return tty;
  }

  async macTerminalProcessSnapshot(ttyName) {
    // Darwin 25 accepts the pgrep and pkill -t filter but matches nothing, even while the
    // process table clearly lists processes on that TTY. ps reports the exact TTY
    // membership Relay must terminate, so it owns both enumeration and the drain gate.
    let output = '';
    try {
      const result = await this.run(
        'ps',
        ['-t', ttyName, '-o', 'pid='],
        { timeout: TERMINAL_CLOSE_TIMEOUT_MS },
      );
      output = result?.stdout ?? '';
    } catch (error) {
      // ps exits 1 with no output when the exact TTY carries no processes or its device
      // is already gone. Output alongside that exit code still counts as occupied, so an
      // unreadable process table fails closed instead of vacuously reporting success.
      if (error?.code !== 1) throw error;
      output = typeof error.stdout === 'string' ? error.stdout : '';
    }
    const text = String(output).trim();
    return { empty: text === '', processIds: terminalProcessIds(text) };
  }

  async waitForMacTerminalProcessesToExit(ttyName) {
    const deadline = this.now() + TERMINAL_PROCESS_DRAIN_TIMEOUT_MS;
    let emptyObservations = 0;
    while (this.now() <= deadline) {
      const { empty } = await this.macTerminalProcessSnapshot(ttyName);
      emptyObservations = empty ? emptyObservations + 1 : 0;
      if (emptyObservations >= 2) return;
      await this.delay(TERMINAL_PROCESS_DRAIN_POLL_MS);
    }
    throw new Error(`Processes on terminal ${ttyName} did not exit after SIGKILL.`);
  }

  async closeOwnedTerminalNow(threadId) {
    const terminal = [...this.ownedTerminals.values()].find((item) => item.threadId === threadId);
    if (!terminal) {
      throw new Error('Relay could not verify an exact native terminal for this session.');
    }
    return this.closeTrackedTerminalNow(terminal);
  }

  async closeTrackedTerminalNow(terminal) {
    const threadId = terminal.threadId;
    this.diagnostic('terminal.close.requested', {
      launchId: terminal.launchId,
      threadId,
      provider: terminal.provider,
      path: terminal.path,
      platform: this.platform,
      ownershipSource: terminal.ownershipSource,
    });
    try {
      if (this.platform === 'darwin' && terminal.terminalWindowId) {
        if (terminal.terminalTty && terminal.runtimeProcessId) {
          const { stdout = '' } = await this.run(
            'ps',
            ['-p', String(terminal.runtimeProcessId), '-o', 'tty='],
            { timeout: TERMINAL_CLOSE_TIMEOUT_MS },
          );
          if (normalizeTerminalTty(stdout) !== terminal.terminalTty) {
            throw new Error('The recovered terminal process identity changed.');
          }
        }
        const terminalTty = await this.terminateMacTerminalWindow(terminal);
        this.diagnostic('terminal.close.processes_terminated', {
          launchId: terminal.launchId,
          threadId,
          terminalWindowId: terminal.terminalWindowId,
          terminalTty,
        });
      } else if (this.platform === 'win32' && terminal.terminalProcessId) {
        await this.run(
          'taskkill.exe',
          ['/PID', String(terminal.terminalProcessId), '/T', '/F'],
          { timeout: TERMINAL_CLOSE_TIMEOUT_MS },
        );
      } else {
        throw new Error('The exact native terminal handle is unavailable.');
      }
    } catch (error) {
      this.diagnostic('terminal.close.failed', {
        launchId: terminal.launchId,
        threadId,
        platform: this.platform,
        error: error.message,
      });
      throw new Error(`Could not close the terminal: ${error.message}`);
    }
    this.forgetTrackedTerminal(terminal.launchId);
    const recoveryThreadId = threadId || terminal.expectedThreadId;
    if (recoveryThreadId) {
      // The provider connection can remain discoverable briefly after its terminal process
      // exits. Do not let the /api/threads recovery poll resurrect the window Relay just
      // closed and reserve the old conversation against a later disposable resume.
      this.recoveryRetryAt.set(recoveryThreadId, this.now() + this.recoveryRetryMs);
    }
    this.diagnostic('terminal.close.completed', {
      launchId: terminal.launchId,
      threadId,
      provider: terminal.provider,
      path: terminal.path,
      platform: this.platform,
      ownershipSource: terminal.ownershipSource,
    });
    return {
      launchId: terminal.launchId,
      threadId,
      provider: terminal.provider,
      path: terminal.path,
    };
  }

  async closeOwnedTerminals() {
    this.closing = true;
    await this.launchQueue;
    const windowIds = [...this.ownedTerminalWindowIds];
    const processIds = [...this.ownedTerminalProcessIds];
    for (const launchId of this.ownedTerminals.keys()) {
      this.releaseLaunchReservation(launchId);
    }
    this.diagnostic('terminal.shutdown.requested', {
      platform: this.platform,
      windowIds,
      processIds,
    });
    if (this.platform === 'darwin' && windowIds.length > 0) {
      for (const terminalWindowId of windowIds) {
        const terminal = [...this.ownedTerminals.values()].find((item) => (
          item.closeOnShutdown && item.terminalWindowId === terminalWindowId
        ));
        if (!terminal) continue;
        try {
          await this.terminateMacTerminalWindow(terminal);
        } catch (error) {
          this.diagnostic('terminal.shutdown.window_failed', {
            platform: this.platform,
            terminalWindowId,
            error: error.message,
          });
        }
      }
    }
    if (this.platform === 'win32') {
      for (const processId of processIds) {
        try {
          await this.run(
            'taskkill.exe',
            ['/PID', String(processId), '/T', '/F'],
            { timeout: TERMINAL_CLOSE_TIMEOUT_MS },
          );
        } catch (error) {
          this.diagnostic('terminal.shutdown.process_failed', { platform: this.platform, processId, error: error.message });
        }
      }
    }
    this.ownedTerminalWindowIds.clear();
    this.ownedTerminalProcessIds.clear();
    this.ownedTerminals.clear();
    this.diagnostic('terminal.shutdown.completed', {
      platform: this.platform,
      windowCount: windowIds.length,
      processCount: processIds.length,
    });
    return { windowCount: windowIds.length, processCount: processIds.length };
  }
}
