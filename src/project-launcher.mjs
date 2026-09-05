import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { TerminalRuntimeResolver, normalizeTerminalTty } from './terminal-runtime-resolver.mjs';
import { NativeTerminalScreenReader } from './native-terminal-screen.mjs';
import { openNativeTerminal } from './native-terminal-opener.mjs';
import {
  CLAUDE_TRUST_DIALOG_KEYS,
  isClaudeTrustDialogScreen,
} from './claude-folder-trust.mjs';
import { claudeLaunchSettingsRecord } from './claude-launch-settings.mjs';

const execFile = promisify(execFileCallback);
const TERMINAL_CLOSE_TIMEOUT_MS = 10_000;
const TERMINAL_PROCESS_DRAIN_TIMEOUT_MS = 2_000;
const TERMINAL_PROCESS_DRAIN_POLL_MS = 50;
const TERMINAL_ATTENTION_TIMEOUT_MS = 10_000;
const TERMINAL_SHELL_READY_POLL_COUNT = 200;
const TERMINAL_SHELL_READY_POLL_MS = 50;
const TERMINAL_WINDOW_MISSING = '__CC_RELAY_TERMINAL_WINDOW_MISSING__';
const CLAUDE_TRUST_SCREEN_TIMEOUT_MS = 5_000;
const SHARED_CODEX_ENDPOINT = 'ws://127.0.0.1:4769';

const DARWIN_CLAUDE_LAUNCH_SCREEN = `function run(argv) {
  var result = { ok: false, reason: 'unknown', text: '' };
  try {
    var id = parseInt(argv[0], 10);
    var terminal = Application('Terminal');
    if (!terminal.running()) { result.reason = 'terminal-not-running'; return JSON.stringify(result); }
    var window = terminal.windows.byId(id);
    var tabs = window.tabs();
    if (!tabs || tabs.length !== 1) { result.reason = 'tabs-unreadable'; return JSON.stringify(result); }
    var contents = tabs[0].contents();
    if (typeof contents !== 'string') { result.reason = 'contents-unreadable'; return JSON.stringify(result); }
    result.ok = true;
    result.reason = 'read';
    result.text = contents;
    return JSON.stringify(result);
  } catch (error) {
    result.reason = String(error);
    return JSON.stringify(result);
  }
}`;

// The second screen comparison closes the read-to-key race. If Claude redraws, the window closes,
// or the tab changes after classification, this script sends nothing and the coordinator polls
// again from a fresh snapshot.
const DARWIN_CLAUDE_TRUST_ACCEPT = `function run(argv) {
  var result = { ok: false, status: 'unknown' };
  try {
    var id = parseInt(argv[0], 10);
    var expected = argv[1];
    var keys = argv[2];
    var terminal = Application('Terminal');
    if (!terminal.running()) { result.status = 'terminal-not-running'; return JSON.stringify(result); }
    var window = terminal.windows.byId(id);
    var tabs = window.tabs();
    if (!tabs || tabs.length !== 1) { result.status = 'tabs-unreadable'; return JSON.stringify(result); }
    var contents = tabs[0].contents();
    if (typeof contents !== 'string') { result.status = 'contents-unreadable'; return JSON.stringify(result); }
    if (contents !== expected) { result.status = 'screen-changed'; return JSON.stringify(result); }
    terminal.doScript(keys, { in: tabs[0] });
    result.ok = true;
    result.status = 'accepted';
    return JSON.stringify(result);
  } catch (error) {
    result.status = String(error);
    return JSON.stringify(result);
  }
}`;
// A pending Codex CLI release makes the interactive TUI stop on an "Update available" prompt
// before it dials --remote, so a CC Relay-owned turn would wait forever for a session that never
// binds. The override is interactive-only: `codex exec` never shows the prompt and keeps its
// normal update check.
export const CODEX_UPDATE_PROMPT_OVERRIDE = '-c check_for_update_on_startup=false';
export const CODEX_RELAY_COMMAND = `codex --dangerously-bypass-approvals-and-sandbox --cd . --remote ${SHARED_CODEX_ENDPOINT} ${CODEX_UPDATE_PROMPT_OVERRIDE}`;
export const CLAUDE_RELAY_COMMAND = 'claude --dangerously-skip-permissions';

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

export function powershellQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function cmdQuote(value) {
  const text = String(value).replaceAll('"', '""');
  // Every Windows program splits its command line with the C runtime rules, where a backslash
  // run immediately before the closing quote escapes that quote. A project pinned at a drive
  // root canonicalizes to `D:\`, so the unescaped form would hand the provider CLI `D:` plus the
  // rest of the command line as one argument. Doubling only the trailing run keeps every other
  // backslash literal, which is what those same rules already do inside a quoted argument.
  return `"${text.replace(/\\+$/, (run) => run.repeat(2))}"`;
}

// taskkill reports a non-zero exit when the exact process identifier no longer exists, which is
// the normal outcome after a user closes the terminal window by hand. Both signals are accepted
// because each has a hole on its own: the numeric code is undocumented in the CC Relay test
// environment, and the message text is localized on non-English Windows installations.
//
// This never widens the close target. A REUSED identifier is found rather than missing, so it
// still takes the destructive path, and every other failure still throws.
export function windowsTerminalProcessMissing(error) {
  if (!error) return false;
  if (error.code === 128) return true;
  return /not found/i.test(`${error.stdout || ''}\n${error.stderr || ''}\n${error.message || ''}`);
}

// `ps -p` exits 1 with no output after the exact provider process has already exited. That is
// expected when the user kills Claude or closes its Terminal.app window before pool cleanup.
// Any stderr or other exit code remains a real inspection failure and keeps ownership reserved.
export function macTerminalRuntimeProcessMissing(error) {
  return Boolean(
    error
    && error.code === 1
    && !String(error.stdout || '').trim()
    && !String(error.stderr || '').trim()
  );
}

function terminalTtyName(value) {
  const tty = normalizeTerminalTty(value);
  if (!tty?.startsWith('/dev/')) return null;
  const name = tty.slice('/dev/'.length);
  return /^[a-zA-Z0-9._-]+$/.test(name) ? name : null;
}

async function defaultReadClaudeLaunchScreen(run, terminalWindowId) {
  const { stdout = '' } = await run(
    'osascript',
    ['-l', 'JavaScript', '-e', DARWIN_CLAUDE_LAUNCH_SCREEN, String(terminalWindowId)],
    { timeout: CLAUDE_TRUST_SCREEN_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout || '{}');
  return parsed?.ok && typeof parsed.text === 'string'
    ? { ok: true, reason: 'read', text: parsed.text }
    : { ok: false, reason: String(parsed?.reason || 'unreadable'), text: '' };
}

async function defaultAcceptClaudeFolderTrust(run, terminalWindowId, expectedScreen) {
  const { stdout = '' } = await run(
    'osascript',
    [
      '-l',
      'JavaScript',
      '-e',
      DARWIN_CLAUDE_TRUST_ACCEPT,
      String(terminalWindowId),
      expectedScreen,
      CLAUDE_TRUST_DIALOG_KEYS,
    ],
    { timeout: CLAUDE_TRUST_SCREEN_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout || '{}');
  return parsed?.ok && parsed.status === 'accepted'
    ? { ok: true, status: 'accepted' }
    : { ok: false, status: String(parsed?.status || 'unreadable') };
}

// Grid placement reads every Terminal window rectangle. The same window that answers null for
// its tabs can also refuse its bounds, and a one-expression pass would lose every rectangle
// because of one of them. Losing the whole pass only degrades slot choice, never a close
// target, but a degraded pass silently stacks new terminals on an occupied cell. Each window
// is therefore read on its own and an unreadable one contributes null, which
// normalizeMacTerminalWindowBounds() drops.
const DARWIN_TERMINAL_BOUNDS_INVENTORY = `const terminal = Application('Terminal');
function windowBounds() {
  var running = false;
  try { running = terminal.running(); } catch (error) { return []; }
  if (!running) return [];
  var windows = null;
  try { windows = terminal.windows(); } catch (error) { return []; }
  if (!windows) return [];
  var result = [];
  for (var index = 0; index < windows.length; index += 1) {
    var bounds = null;
    try { bounds = windows[index].bounds(); } catch (error) { bounds = null; }
    result.push(bounds || null);
  }
  return result;
}
JSON.stringify(windowBounds());`;

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
  launchSettings = null,
) {
  const command = resumeThreadId ? `codex resume ${quote(resumeThreadId)}` : 'codex';
  const launchArguments = [
    ...(launchSettings?.model ? [' --model ', quote(launchSettings.model)] : []),
    ...(launchSettings?.effort
      ? [' -c ', quote(`model_reasoning_effort=${JSON.stringify(launchSettings.effort)}`)]
      : []),
  ].join('');
  return `${command} --dangerously-bypass-approvals-and-sandbox --cd ${quote(path)} --remote ${endpoint}${launchArguments} ${CODEX_UPDATE_PROMPT_OVERRIDE}`;
}

export function claudeRelayCommand(
  sessionId = null,
  quote = shellQuote,
  binary = 'claude',
  resumeSessionId = null,
  settings = null,
  launchSettings = null,
) {
  // Pin the exact resolved binary so the interactive terminal runs the same
  // claude CC Relay discovered, instead of relying on shell PATH order. The bare
  // 'claude' default stays unquoted for backward compatibility.
  const bin = binary && binary !== 'claude' ? quote(binary) : 'claude';
  const sessionArgument = resumeSessionId
    ? ` --resume ${quote(resumeSessionId)}`
    : sessionId
      ? ` --session-id ${quote(sessionId)}`
      : '';
  const settingsArgument = settings
    ? ` --settings ${quote(JSON.stringify(settings))}`
    : '';
  // A task-owned launch carries the complete queued turn settings so the first provider process
  // is ready before prompt delivery. Plan mode replaces the unrestricted permission flag.
  const permissionArgument = launchSettings?.permissionMode
    ? ` --permission-mode ${quote(launchSettings.permissionMode)}`
    : ' --dangerously-skip-permissions';
  const launchArguments = [
    ...(launchSettings?.model ? [' --model ', quote(launchSettings.model)] : []),
    ...(launchSettings?.effort ? [' --effort ', quote(launchSettings.effort)] : []),
    ...(launchSettings?.tools?.length
      ? [' --tools ', quote(launchSettings.tools.join(','))]
      : []),
    ...(launchSettings?.addDirectories || [])
      .flatMap((directory) => [' --add-dir ', quote(directory)]),
  ].join('');
  return `${bin}${permissionArgument}${sessionArgument}${launchArguments}${settingsArgument}`;
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

export function normalizeMacTerminalWindowBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const left = Number(Array.isArray(bounds) ? bounds[0] : bounds.left ?? bounds.x);
  const top = Number(Array.isArray(bounds) ? bounds[1] : bounds.top ?? bounds.y);
  const right = Number(Array.isArray(bounds)
    ? bounds[2]
    : bounds.right ?? (Number(bounds.x) + Number(bounds.width)));
  const bottom = Number(Array.isArray(bounds)
    ? bounds[3]
    : bounds.bottom ?? (Number(bounds.y) + Number(bounds.height)));
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) {
    return null;
  }
  return { left, top, right, bottom };
}

function boundsOverlapArea(left, right) {
  const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  return width * height;
}

export function centeredWindowBounds(displays, windowBounds) {
  if (!Array.isArray(displays) || displays.length === 0 || !windowBounds) return null;
  const width = Number(windowBounds.right) - Number(windowBounds.left);
  const height = Number(windowBounds.bottom) - Number(windowBounds.top);
  if (!(width > 0) || !(height > 0)) return null;

  let selected = displays.find((display) => display?.primary) || displays[0];
  let selectedOverlap = 0;
  for (const display of displays) {
    if (
      !display
      || !Number.isFinite(Number(display.x))
      || !Number.isFinite(Number(display.y))
      || !(Number(display.width) > 0)
      || !(Number(display.height) > 0)
    ) continue;
    const overlap = boundsOverlapArea(windowBounds, {
      left: Number(display.x),
      top: Number(display.y),
      right: Number(display.x) + Number(display.width),
      bottom: Number(display.y) + Number(display.height),
    });
    if (overlap > selectedOverlap) {
      selected = display;
      selectedOverlap = overlap;
    }
  }

  const left = Math.round(Number(selected.x) + (Number(selected.width) - width) / 2);
  const top = Math.round(Number(selected.y) + (Number(selected.height) - height) / 2);
  return {
    left,
    top,
    right: Math.round(left + width),
    bottom: Math.round(top + height),
  };
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
  codexLaunchSettings = null,
  claudeBinary = 'claude',
  claudeSettings = null,
  claudeLaunchSettings = null,
  resumeThreadId = null,
} = {}) {
  if (!['codex', 'claude'].includes(provider)) {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }
  const command = provider === 'codex'
    ? codexRelayCommand(path, shellQuote, codexEndpoint, resumeThreadId, codexLaunchSettings)
    : claudeRelayCommand(
      claudeSessionId,
      shellQuote,
      claudeBinary,
      resumeThreadId,
      claudeSettings,
      claudeLaunchSettings,
    );
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
    terminalScreenReader = null,
    embeddedTerminalHost = null,
    createId = randomUUID,
    now = Date.now,
    delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    recoveryRetryMs = 15_000,
    claudeBinary = 'claude',
    claudeSettingsForSession = () => null,
    readClaudeLaunchScreen = null,
    acceptClaudeFolderTrust = null,
    // Cross-process launch ownership. Without it every guard below degrades to the historical
    // single-process behavior, which is exactly what the unit suites exercise.
    launchRegistry = null,
  } = {}) {
    this.run = run;
    this.embeddedTerminalHost = embeddedTerminalHost;
    this.platform = platform;
    this.diagnostic = diagnostic;
    this.launchRegistry = launchRegistry;
    this.claudeBinary = claudeBinary;
    this.claudeSettingsForSession = claudeSettingsForSession;
    this.readClaudeLaunchScreen = readClaudeLaunchScreen
      || ((terminalWindowId) => defaultReadClaudeLaunchScreen(this.run, terminalWindowId));
    this.acceptClaudeFolderTrust = acceptClaudeFolderTrust
      || ((terminalWindowId, expectedScreen) => (
        defaultAcceptClaudeFolderTrust(this.run, terminalWindowId, expectedScreen)
      ));
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
    this.terminalScreenReader = terminalScreenReader || new NativeTerminalScreenReader({
      run,
      platform,
    });
    this.gridSlots = new Map();
    this.launchQueue = Promise.resolve();
    this.ownedTerminalWindowIds = new Set();
    this.ownedTerminalProcessIds = new Set();
    this.ownedTerminals = new Map();
    this.recoveryRetryAt = new Map();
    this.closing = false;
  }

  // The registry is advisory. A shared configuration database that is locked, older than this
  // table, or unreadable must never break a launch, a binding, or a cleanup, so every call is
  // isolated and every failure falls back to the historical single-process behavior.
  recordOwnership(method, ...args) {
    const registry = this.launchRegistry;
    if (!registry || typeof registry[method] !== 'function') return null;
    try {
      return registry[method](...args);
    } catch (error) {
      this.diagnostic('terminal.ownership.registry_failed', { method, error: error.message });
      return null;
    }
  }

  diagnosticForeignOwner(event, details, owner) {
    this.diagnostic(event, {
      ...details,
      foreignPid: owner.pid,
      foreignInstanceId: owner.instanceId,
      foreignLaunchId: owner.launchId,
      foreignOwnershipSource: owner.ownershipSource,
      match: owner.reason,
    });
  }

  async foreignLaunchOwner(query, options = {}) {
    const registry = this.launchRegistry;
    if (!registry || typeof registry.foreignOwner !== 'function') return null;
    try {
      return await registry.foreignOwner(query, options);
    } catch (error) {
      this.diagnostic('terminal.ownership.registry_failed', {
        method: 'foreignOwner',
        error: error.message,
      });
      return null;
    }
  }

  trackOwnedTerminal({
    launchId = this.createId(),
    provider,
    path,
    terminalWindowId = null,
    terminalProcessId = null,
    terminalProcessStartedAt = null,
    terminalTty = null,
    runtimeProcessId = null,
    expectedThreadId = null,
    closeOnShutdown = true,
    ownershipSource = 'launch',
    cancelWorkspaceReservation = null,
    // What this exact Claude process was started with, when CC Relay itself built the command.
    // It stays null for every other entry point, including recovery and adoption, so a terminal
    // CC Relay did not launch in this process can never be treated as pre-configured.
    launchSettings = null,
    transport = null,
    taskId = null,
  }) {
    if (!terminalWindowId && !terminalProcessId) return null;
    const duplicate = [...this.ownedTerminals.values()].find((terminal) => (
      (terminalWindowId && terminal.terminalWindowId === terminalWindowId)
      || (terminalProcessId && terminal.terminalProcessId === terminalProcessId)
    ));
    if (duplicate && duplicate.launchId !== launchId) {
      throw new Error('That native terminal is already bound to another CC Relay session.');
    }
    this.ownedTerminals.set(launchId, {
      launchId,
      provider,
      path,
      threadId: null,
      terminalWindowId,
      terminalProcessId,
      terminalProcessStartedAt,
      terminalTty,
      runtimeProcessId,
      expectedThreadId,
      closeOnShutdown,
      ownershipSource,
      cancelWorkspaceReservation,
      launchSettings,
      transport,
      taskId,
      // Provider registration can precede the pool's task assignment, especially
      // while a council's second provider starts. Keep its startup target valid
      // until that assignment is saved, then require the persisted conversation.
      taskBindingPending: transport === 'pty' && Number.isSafeInteger(taskId) && taskId > 0,
      // Folder trust input is bounded per exact native launch. The coordinator already latches a
      // successful resolution, and this state makes the launcher method itself idempotent too.
      folderTrustResolution: null,
      // The runtime pid observed the FIRST time this launch resolved a live provider process.
      // It is what binds `launchSettings` to a specific process: if the pid later differs, some
      // other process is on that tty and the recorded settings prove nothing about it.
      launchSettingsProcessId: null,
    });
    if (closeOnShutdown && terminalWindowId) this.ownedTerminalWindowIds.add(terminalWindowId);
    if (closeOnShutdown && terminalProcessId) this.ownedTerminalProcessIds.add(terminalProcessId);
    this.recordOwnership('recordLaunch', {
      launchId,
      provider,
      path,
      threadId: null,
      expectedThreadId,
      terminalWindowId,
      terminalProcessId,
      runtimeProcessId,
      terminalTty,
      ownershipSource,
    });
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
    this.recordOwnership('removeLaunch', launchId);
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
      throw new Error('That terminal launch is not owned by this CC Relay instance.');
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
    this.recordOwnership('updateLaunch', launchId, { threadId });
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
      // A second live CC Relay backend shares provider discovery but not memory. Adopting a
      // terminal it launched gives two processes a claim on one window, and whichever acts
      // first closes a terminal the other still needs.
      let candidatePath = thread.cwd;
      try {
        candidatePath = validateProjectPath(thread.cwd).path;
      } catch {
        candidatePath = thread.cwd;
      }
      const ownershipQuery = {
        threadId: thread.id,
        provider: thread.provider,
        path: candidatePath,
        terminalWindowId: nativeTerminal.terminalWindowId,
        terminalProcessId: nativeTerminal.terminalProcessId,
        runtimeProcessId: nativeTerminal.runtimeProcessId,
        terminalTty: nativeTerminal.terminalTty,
      };
      const foreignOwner = await this.foreignLaunchOwner(ownershipQuery);
      if (foreignOwner) {
        this.diagnosticForeignOwner('terminal.recovery.skipped_foreign_owner', {
          threadId: thread.id,
          provider: thread.provider,
          path: thread.cwd,
          terminalWindowId: nativeTerminal.terminalWindowId,
          terminalTty: nativeTerminal.terminalTty,
        }, foreignOwner);
        continue;
      }
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
        // Two backends can poll provider discovery in the same instant. The claim is now
        // written, so an earlier foreign claim settles the tie in exactly one direction.
        const contender = await this.foreignLaunchOwner(ownershipQuery, {
          precedingLaunchId: launchId,
        });
        if (contender) {
          this.forgetTrackedTerminal(launchId);
          this.diagnosticForeignOwner('terminal.recovery.skipped_foreign_owner', {
            launchId,
            threadId: thread.id,
            provider: thread.provider,
            path: thread.cwd,
            terminalWindowId: nativeTerminal.terminalWindowId,
            terminalTty: nativeTerminal.terminalTty,
            contended: true,
          }, contender);
          continue;
        }
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

  // Owned launches start with threadId = null, so a lookup by a missing conversation ID must
  // never fall through to "the first launch that is still binding". Every caller here would
  // otherwise act on somebody else's terminal, including the close path.
  ownedTerminalForThread(threadId) {
    if (typeof threadId !== 'string' || !threadId.trim()) return null;
    return [...this.ownedTerminals.values()].find((item) => item.threadId === threadId) || null;
  }

  async verifyTerminalForThread(thread) {
    const terminal = this.ownedTerminalForThread(thread?.id);
    if (!terminal) return false;
    if (terminal.transport === 'pty') return this.embeddedTerminalHost.isAlive(terminal.launchId);
    if (terminal.ownershipSource !== 'runtime') return true;
    // A runtime adoption is the only ownership this process did not create by launching. If a
    // second live backend has since claimed the same launch, drop the adoption instead of
    // re-verifying a terminal that is not ours to act on.
    const foreignOwner = await this.foreignOwnerOfAdoption(terminal);
    if (foreignOwner) {
      this.forgetTrackedTerminal(terminal.launchId);
      this.diagnosticForeignOwner('terminal.recovery.skipped_foreign_owner', {
        launchId: terminal.launchId,
        threadId: terminal.threadId,
        provider: terminal.provider,
        path: terminal.path,
        stage: 'verify',
      }, foreignOwner);
      return false;
    }
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

  // Only a launch this process adopted at runtime can belong to another backend. A launch this
  // process started natively is proven ours by the native launch itself.
  async foreignOwnerOfAdoption(terminal) {
    if (!terminal || terminal.ownershipSource !== 'runtime') return null;
    // An adopted terminal already has a proven conversation and native identity, so only a
    // foreign claim on that exact identity may take it away. A foreign launch still binding
    // elsewhere in the same project says nothing about this terminal, and honoring it here
    // would make an unrelated terminal briefly unverifiable and unclosable.
    return this.foreignLaunchOwner({
      threadId: terminal.threadId,
      provider: terminal.provider,
      path: terminal.path,
      terminalWindowId: terminal.terminalWindowId,
      terminalProcessId: terminal.terminalProcessId,
      runtimeProcessId: terminal.runtimeProcessId,
      terminalTty: terminal.terminalTty,
    }, { includePendingClaims: false });
  }

  refreshTerminalRuntimeIdentity(threadId, current) {
    const terminal = this.ownedTerminalForThread(threadId);
    if (!terminal || !current) return false;
    const sameTerminal = current.terminalWindowId === terminal.terminalWindowId
      && (!terminal.terminalTty || current.terminalTty === terminal.terminalTty);
    if (!sameTerminal) return false;
    const previousRuntimeProcessId = terminal.runtimeProcessId;
    terminal.terminalTty ||= current.terminalTty || null;
    terminal.runtimeProcessId = current.runtimeProcessId || null;
    // Latch the FIRST provider process observed on this launch. That process is the one CC Relay's
    // own launch command started in this exact tab, so it is the only one the recorded settings
    // describe. The latch is never rewritten: a later pid is a different process, and
    // provenClaudeLaunchSettings() then reports nothing rather than a stale claim.
    if (terminal.launchSettings && !terminal.launchSettingsProcessId && terminal.runtimeProcessId) {
      terminal.launchSettingsProcessId = terminal.runtimeProcessId;
    }
    this.recordOwnership('updateLaunch', terminal.launchId, {
      terminalTty: terminal.terminalTty,
      runtimeProcessId: terminal.runtimeProcessId,
    });
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

  // What the live Claude process in this owned terminal was provably started with, or null.
  //
  // Read-time comparison, deliberately: several call paths refresh `runtimeProcessId` on their
  // own, so a scheme that cleared the record on a pid change would have holes. Comparing here
  // means every one of those paths fails safe without knowing this feature exists.
  provenClaudeLaunchSettings(threadId) {
    const terminal = this.ownedTerminalForThread(threadId);
    if (!terminal || terminal.provider !== 'claude') return null;
    if (!terminal.launchSettings || !terminal.launchSettingsProcessId) return null;
    if (terminal.runtimeProcessId !== terminal.launchSettingsProcessId) return null;
    return terminal.launchSettings;
  }

  terminalForThread(threadId) {
    const terminal = this.ownedTerminalForThread(threadId);
    if (!terminal) return null;
    return {
      launchId: terminal.launchId,
      threadId: terminal.threadId,
      provider: terminal.provider,
      path: terminal.path,
      ...(terminal.transport ? { transport: terminal.transport } : {}),
      ...(terminal.transport === 'pty' ? { taskId: terminal.taskId } : {}),
    };
  }

  confirmTaskTerminalBinding(launchId, taskId, threadId) {
    const terminal = this.ownedTerminals.get(launchId);
    if (terminal?.transport !== 'pty') return;
    if (terminal.taskId !== taskId || terminal.threadId !== threadId) {
      throw new Error('The saved task assignment does not match its owned terminal launch.');
    }
    terminal.taskBindingPending = false;
  }

  pendingEmbeddedTerminalsForTask(task) {
    if (!task || !['running', 'queued'].includes(task.status)) return [];
    const providers = task.mode === 'plan' ? ['codex', 'claude']
      : task.mode === 'turbo' ? ['codex', 'claude'] : [task.provider];
    return [...this.ownedTerminals.values()].filter((terminal) => terminal.transport === 'pty'
      && terminal.taskId === task.id && (!terminal.threadId || terminal.taskBindingPending) && terminal.path === task.repo_path
      && providers.includes(terminal.provider) && this.embeddedTerminalHost.isAlive(terminal.launchId));
  }

  async resolveEmbeddedClaudeTerminal(session) {
    const owned = this.ownedTerminalForThread(session?.id);
    if (owned?.transport !== 'pty') return null;
    const target = await this.embeddedTerminalHost.resolveClaudeTerminal(owned, session);
    if (!target || this.ownedTerminals.get(owned.launchId) !== owned) return null;
    owned.runtimeProcessId = target.runtimeProcessId;
    if (owned.launchSettings && !owned.launchSettingsProcessId) owned.launchSettingsProcessId = target.runtimeProcessId;
    this.recordOwnership('updateLaunch', owned.launchId, { runtimeProcessId: target.runtimeProcessId });
    return { ...target, launchSettings: this.provenClaudeLaunchSettings(session.id) };
  }

  async readTerminalScreen(threadId, thread = null) {
    if (this.platform !== 'darwin') {
      return { state: 'unsupported', reason: 'unsupported-platform', text: '', busy: false };
    }
    const terminal = this.ownedTerminalForThread(threadId);
    if (!terminal) {
      return { state: 'unavailable', reason: 'terminal-unowned', text: '', busy: false };
    }
    let expectedThreadMatches = thread === null;
    if (thread?.id === threadId && thread.provider === terminal.provider) {
      try {
        expectedThreadMatches = validateProjectPath(thread.cwd).path === terminal.path;
      } catch {
        expectedThreadMatches = false;
      }
    }
    if (!expectedThreadMatches) {
      return { state: 'unavailable', reason: 'task-mismatch', text: '', busy: false };
    }
    if (terminal.ownershipSource === 'runtime') {
      const foreignOwner = await this.foreignOwnerOfAdoption(terminal);
      if (foreignOwner) {
        this.forgetTrackedTerminal(terminal.launchId);
        this.diagnosticForeignOwner('terminal.screen.skipped_foreign_owner', {
          launchId: terminal.launchId,
          threadId: terminal.threadId,
          provider: terminal.provider,
          path: terminal.path,
        }, foreignOwner);
        return { state: 'unavailable', reason: 'foreign-owner', text: '', busy: false };
      }
    }
    if (terminal.terminalWindowId && !terminal.terminalTty && thread) {
      let resolved = [];
      try {
        resolved = await this.runtimeResolver.resolve([thread]);
      } catch (error) {
        this.diagnostic('terminal.screen.identity_resolution_failed', {
          launchId: terminal.launchId,
          threadId,
          provider: terminal.provider,
          error: error.message,
        });
      }
      const currentIdentity = resolved.find((item) => (
        item.threadId === threadId
        && item.terminalWindowId === terminal.terminalWindowId
      ));
      if (
        currentIdentity
        && currentIdentity.terminalTty
        && this.ownedTerminals.get(terminal.launchId) === terminal
        && this.refreshTerminalRuntimeIdentity(threadId, currentIdentity)
      ) {
        this.diagnostic('terminal.screen.identity_resolved', {
          launchId: terminal.launchId,
          threadId,
          provider: terminal.provider,
          terminalWindowId: terminal.terminalWindowId,
          terminalTty: terminal.terminalTty,
        });
      }
    }
    if (!terminal.terminalWindowId || !terminal.terminalTty) {
      return { state: 'unavailable', reason: 'identity-unverified', text: '', busy: false };
    }

    const identity = {
      terminalWindowId: terminal.terminalWindowId,
      terminalTty: terminal.terminalTty,
    };
    const snapshot = await this.terminalScreenReader.read(identity);
    const current = this.ownedTerminals.get(terminal.launchId);
    if (
      current !== terminal
      || current.threadId !== threadId
      || current.terminalWindowId !== identity.terminalWindowId
      || current.terminalTty !== identity.terminalTty
    ) {
      return { state: 'unavailable', reason: 'ownership-changed', text: '', busy: false };
    }
    if (terminal.ownershipSource === 'runtime') {
      const foreignOwner = await this.foreignOwnerOfAdoption(terminal);
      if (foreignOwner) {
        this.forgetTrackedTerminal(terminal.launchId);
        return { state: 'unavailable', reason: 'foreign-owner', text: '', busy: false };
      }
    }
    const final = this.ownedTerminals.get(terminal.launchId);
    if (
      final !== terminal
      || final.threadId !== threadId
      || final.terminalWindowId !== identity.terminalWindowId
      || final.terminalTty !== identity.terminalTty
    ) {
      return { state: 'unavailable', reason: 'ownership-changed', text: '', busy: false };
    }
    return {
      ...snapshot,
      provider: terminal.provider,
      source: 'Terminal.app',
    };
  }

  async openOriginalTerminal(thread, { isCurrent = () => true } = {}) {
    if (this.closing) throw new Error('CC Relay is closing.');
    const open = this.launchQueue.then(async () => {
      const terminal = this.ownedTerminalForThread(thread?.id);
      if (!terminal || terminal.provider !== thread.provider
        || validateProjectPath(thread.cwd).path !== terminal.path || !isCurrent()) {
        throw new Error('The original terminal is no longer owned by this task.');
      }
      const identity = { ...terminal };
      if (terminal.transport === 'pty') {
        return { state: this.embeddedTerminalHost.isAlive(terminal.launchId) ? 'embedded' : 'unavailable',
          launchId: terminal.launchId, threadId: terminal.threadId, transport: 'pty' };
      }
      if (this.platform === 'darwin') {
        if (await this.foreignOwnerOfAdoption(terminal)) {
          throw new Error('The terminal belongs to another Relay process.');
        }
        const resolved = await this.runtimeResolver.resolve([thread]);
        const current = resolved.find((item) => item.threadId === thread.id);
        if (!current || current.terminalWindowId !== identity.terminalWindowId
          || !current.terminalTty
          || (identity.terminalTty && current.terminalTty !== identity.terminalTty)) {
          throw new Error('The original terminal process and window could not be verified.');
        }
        identity.terminalTty = current.terminalTty;
        if (await this.foreignOwnerOfAdoption(terminal)) {
          throw new Error('The terminal belongs to another Relay process.');
        }
      }
      if (this.closing || !isCurrent() || this.ownedTerminals.get(identity.launchId) !== terminal
        || terminal.threadId !== thread.id || terminal.terminalWindowId !== identity.terminalWindowId
        || terminal.terminalProcessId !== identity.terminalProcessId) {
        throw new Error('The task terminal changed before it could be opened.');
      }
      await openNativeTerminal({ platform: this.platform, run: this.run, terminal: identity });
      this.diagnostic('terminal.original.opened', {
        launchId: identity.launchId, threadId: thread.id, provider: thread.provider,
      });
      return { state: 'opened', provider: thread.provider };
    });
    this.launchQueue = open.catch(() => {});
    return open;
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

  // Claude does not register a discoverable interactive session until its first-use folder trust
  // prompt is answered. The binding coordinator calls this only for the exact fresh launch it is
  // already waiting on. Unknown screens receive no input, and the default key sender compares the
  // complete screen again immediately before it sends the explicit option 1.
  async resolveClaudeFolderTrust(launchId) {
    const terminal = this.ownedTerminals.get(launchId);
    if (
      this.closing
      || (this.platform !== 'darwin' && terminal?.transport !== 'pty')
      || !terminal
      || terminal.provider !== 'claude'
      || terminal.ownershipSource !== 'launch'
      || terminal.threadId
      || (terminal.transport !== 'pty' && (!Number.isInteger(Number(terminal.terminalWindowId))
        || Number(terminal.terminalWindowId) <= 0))
    ) {
      return { status: 'not-eligible' };
    }
    if (terminal.folderTrustResolution === 'accepted') {
      return { status: 'already-accepted' };
    }
    if (terminal.folderTrustResolution === 'resolving') {
      return { status: 'resolution-in-progress' };
    }
    if (terminal.folderTrustResolution === 'ambiguous') {
      return { status: 'ambiguous' };
    }

    let screen;
    try {
      screen = terminal.transport === 'pty'
        ? await this.embeddedTerminalHost.readScreen(launchId)
        : await this.readClaudeLaunchScreen(terminal.terminalWindowId);
    } catch (error) {
      this.diagnostic('terminal.launch.claude_folder_trust_inspection_failed', {
        launchId,
        path: terminal.path,
        error: error.message,
      });
      return { status: 'unreadable' };
    }
    if (!screen?.ok || typeof screen.text !== 'string') {
      return { status: 'unreadable' };
    }
    // The screen read is an await. Re-prove that this exact launch is still owned and unbound
    // before any classification can authorize an input action.
    if (
      this.closing
      || this.ownedTerminals.get(launchId) !== terminal
      || terminal.threadId
    ) {
      return { status: 'not-eligible' };
    }
    if (!isClaudeTrustDialogScreen(screen.text)) {
      return { status: 'not-present' };
    }

    this.diagnostic('terminal.launch.claude_folder_trust_detected', {
      launchId,
      path: terminal.path,
    });
    terminal.folderTrustResolution = 'resolving';
    let accepted;
    try {
      if (terminal.transport === 'pty') {
        const fresh = await this.embeddedTerminalHost.readScreen(launchId);
        if (this.closing || this.ownedTerminals.get(launchId) !== terminal || terminal.threadId
          || !fresh.ok || fresh.text !== screen.text) {
          accepted = { status: 'screen-changed' };
        } else {
          this.embeddedTerminalHost.write(launchId, '1\r');
          accepted = { ok: true, status: 'accepted' };
        }
      } else {
        accepted = await this.acceptClaudeFolderTrust(terminal.terminalWindowId, screen.text);
      }
    } catch (error) {
      // An osascript timeout can happen after Terminal accepted the Apple Event. Do not risk a
      // second option key when delivery is ambiguous.
      terminal.folderTrustResolution = 'ambiguous';
      this.diagnostic('terminal.launch.claude_folder_trust_failed', {
        launchId,
        path: terminal.path,
        error: error.message,
      });
      return { status: 'unreadable' };
    }
    if (!accepted?.ok || accepted.status !== 'accepted') {
      // Every structured non-success result is returned before doScript in the atomic JXA. It is
      // therefore safe for a later poll to inspect a new screen and try again if still needed.
      terminal.folderTrustResolution = null;
      const status = accepted?.status === 'screen-changed' ? 'screen-changed' : 'unreadable';
      this.diagnostic('terminal.launch.claude_folder_trust_not_sent', {
        launchId,
        path: terminal.path,
        reason: String(accepted?.status || 'unreadable'),
      });
      return { status };
    }

    terminal.folderTrustResolution = 'accepted';
    this.diagnostic('terminal.launch.claude_folder_trust_accepted', {
      launchId,
      path: terminal.path,
      choice: 'trust',
    });
    return { status: 'accepted' };
  }

  retainOwnedLaunch(launchId) {
    const terminal = this.ownedTerminals.get(launchId);
    if (!terminal) {
      throw new Error('CC Relay could not verify an exact native terminal for this launch.');
    }
    terminal.closeOnShutdown = false;
    if (terminal.terminalWindowId) {
      this.ownedTerminalWindowIds.delete(terminal.terminalWindowId);
    }
    if (terminal.terminalProcessId) {
      this.ownedTerminalProcessIds.delete(terminal.terminalProcessId);
    }
    this.releaseLaunchReservation(launchId);
    this.diagnostic('terminal.launch.retained', {
      launchId,
      threadId: terminal.threadId,
      provider: terminal.provider,
      path: terminal.path,
    });
    return this.terminalForLaunch(launchId);
  }

  async requestTerminalAttention(thread) {
    if (this.closing) return false;
    const attention = this.launchQueue.then(() => this.requestTerminalAttentionNow(thread));
    this.launchQueue = attention.catch(() => {});
    return attention;
  }

  async requestTerminalAttentionNow(thread) {
    const terminal = this.ownedTerminalForThread(thread?.id);
    if (terminal?.transport === 'pty' && terminal.provider === thread.provider) {
      return this.embeddedTerminalHost.isAlive(terminal.launchId);
    }
    if (!terminal || terminal.provider !== thread?.provider) {
      this.diagnostic('terminal.attention.skipped', {
        threadId: thread?.id,
        provider: thread?.provider,
        reason: 'unowned-terminal',
      });
      return false;
    }
    if (this.platform !== 'darwin') {
      this.diagnostic('terminal.attention.skipped', {
        threadId: thread.id,
        provider: thread.provider,
        reason: 'unsupported-platform',
      });
      return false;
    }

    try {
      const [current] = await this.runtimeResolver.resolve([thread]);
      const exactTerminal = current
        && current.threadId === thread.id
        && current.terminalWindowId === terminal.terminalWindowId
        && (!terminal.terminalTty || current.terminalTty === terminal.terminalTty);
      if (!exactTerminal || !this.refreshTerminalRuntimeIdentity(thread.id, current)) {
        this.diagnostic('terminal.attention.skipped', {
          launchId: terminal.launchId,
          threadId: thread.id,
          provider: thread.provider,
          reason: 'identity-unverified',
        });
        return false;
      }

      const windowBounds = await this.macTerminalWindowBounds(terminal);
      const bounds = centeredWindowBounds(await this.listDisplays(), windowBounds);
      if (!bounds) {
        throw new Error('The terminal window or display bounds could not be read.');
      }
      const expectedTtyCheck = terminal.terminalTty
        ? `\nif (tty of first tab of targetWindow) is not ${JSON.stringify(terminal.terminalTty)} then error "The terminal identity changed."`
        : '';
      const script = `beep 1\ntell application "Terminal"\nif not (exists window id ${terminal.terminalWindowId}) then error "The terminal window is no longer open."\nset targetWindow to window id ${terminal.terminalWindowId}\nif (count of tabs of targetWindow) is not 1 then error "The terminal now contains multiple tabs."${expectedTtyCheck}\nactivate\nset visible of targetWindow to true\nset miniaturized of targetWindow to false\nset bounds of targetWindow to {${bounds.left}, ${bounds.top}, ${bounds.right}, ${bounds.bottom}}\nset index of targetWindow to 1\nset frontmost of targetWindow to true\nend tell`;
      await this.run(
        'osascript',
        ['-e', script],
        { timeout: TERMINAL_ATTENTION_TIMEOUT_MS },
      );
      this.diagnostic('terminal.attention.completed', {
        launchId: terminal.launchId,
        threadId: thread.id,
        provider: thread.provider,
        terminalWindowId: terminal.terminalWindowId,
        terminalTty: terminal.terminalTty,
        bounds,
      });
      return true;
    } catch (error) {
      this.diagnostic('terminal.attention.failed', {
        launchId: terminal.launchId,
        threadId: thread.id,
        provider: thread.provider,
        error: error.message,
      });
      return false;
    }
  }

  async macTerminalWindowBounds(terminal) {
    const expectedTtyCheck = terminal.terminalTty
      ? `\nif (tty of first tab of targetWindow) is not ${JSON.stringify(terminal.terminalTty)} then error "The terminal identity changed."`
      : '';
    const script = `tell application "Terminal"\nif not (exists window id ${terminal.terminalWindowId}) then error "The terminal window is no longer open."\nset targetWindow to window id ${terminal.terminalWindowId}\nif (count of tabs of targetWindow) is not 1 then error "The terminal now contains multiple tabs."${expectedTtyCheck}\nset windowBounds to bounds of targetWindow\nreturn (item 1 of windowBounds as text) & "," & (item 2 of windowBounds as text) & "," & (item 3 of windowBounds as text) & "," & (item 4 of windowBounds as text)\nend tell`;
    const { stdout = '' } = await this.run(
      'osascript',
      ['-e', script],
      { timeout: TERMINAL_ATTENTION_TIMEOUT_MS },
    );
    const [left, top, right, bottom] = String(stdout).trim().split(',').map(Number);
    if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) {
      throw new Error('The terminal window returned invalid bounds.');
    }
    return { left, top, right, bottom };
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
      const { stdout } = await this.run(
        'powershell.exe',
        ['-NoProfile', '-Command', script],
        { timeout: TERMINAL_ATTENTION_TIMEOUT_MS },
      );
      const parsed = JSON.parse(stdout.trim() || '[]');
      return Array.isArray(parsed) ? parsed : [parsed];
    }
    const script = `ObjC.import('AppKit');
const screens = $.NSScreen.screens.js;
const primaryFrame = $.NSScreen.mainScreen.frame;
const terminalCoordinateTop = primaryFrame.origin.y + primaryFrame.size.height;
JSON.stringify(screens.map((screen, index) => {
  const frame = screen.visibleFrame;
  return {
    name: ObjC.unwrap(screen.localizedName) || \`Display \${index + 1}\`,
    x: Math.round(frame.origin.x),
    y: Math.round(terminalCoordinateTop - frame.origin.y - frame.size.height),
    width: Math.round(frame.size.width),
    height: Math.round(frame.size.height),
    primary: index === 0,
  };
}));`;
    const { stdout } = await this.run(
      'osascript',
      ['-l', 'JavaScript', '-e', script],
      { timeout: TERMINAL_ATTENTION_TIMEOUT_MS },
    );
    return JSON.parse(stdout.trim() || '[]');
  }

  async listTerminalWindowBounds() {
    if (this.platform !== 'darwin') return [];
    const { stdout } = await this.run('osascript', ['-l', 'JavaScript', '-e', DARWIN_TERMINAL_BOUNDS_INVENTORY]);
    const parsed = JSON.parse(stdout.trim() || '[]');
    return Array.isArray(parsed)
      ? parsed.map(normalizeMacTerminalWindowBounds).filter(Boolean)
      : [];
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
        "$picker.Description = 'Choose a project folder for CC Relay'",
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
        'POSIX path of (choose folder with prompt "Choose a project folder for CC Relay")',
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
      throw new Error('CC Relay is closing and cannot launch another terminal.');
    }
    const launch = this.launchQueue.then(() => this.launchNow(path, provider, requestedLayout, options));
    this.launchQueue = launch.catch(() => {});
    return launch;
  }

  async launchNow(path, provider, requestedLayout = null, {
    taskId = null,
    resumeThreadId = null,
    initializeThreadId = null,
    // Codex receives model and effort on its first TUI command so a newly opened planner or
    // worker window identifies the settings that its app-server turn will use.
    codexLaunchSettings = null,
    // A task-owned Claude launch passes the queued turn settings here so the first command is
    // already configured. Interactive Launchpad launches never set it, which is what
    // keeps the user-facing "Launch Claude in project" command exactly as documented.
    claudeLaunchSettings = null,
  } = {}) {
    this.ensureSupported();
    const project = validateProjectPath(path);
    if (!['codex', 'claude'].includes(provider)) {
      throw new Error(`Unsupported AI provider: ${provider}`);
    }
    if (claudeLaunchSettings && provider !== 'claude') {
      throw new Error('Only a Claude terminal launch can carry Claude settings.');
    }
    if (codexLaunchSettings && provider !== 'codex') {
      throw new Error('Only a Codex terminal launch can carry model and effort settings.');
    }
    if (initializeThreadId && provider !== 'claude') {
      throw new Error('Only Claude can initialize a saved session UUID.');
    }
    if (initializeThreadId && resumeThreadId) {
      throw new Error('A terminal launch cannot initialize and resume the same session.');
    }
    if (provider === 'codex') {
      this.diagnostic('terminal.launch.waiting_for_codex', { path: project.path });
      await this.ensureCodexReady();
      this.diagnostic('terminal.launch.codex_ready', { path: project.path });
    }
    const expectedLaunchId = this.createId();
    const requestedThreadId = initializeThreadId || resumeThreadId;
    const expectedThreadId = typeof requestedThreadId === 'string' && requestedThreadId.trim()
      ? requestedThreadId.trim()
      : expectedLaunchId;
    const embedded = this.embeddedTerminalHost && Number.isSafeInteger(taskId) && taskId > 0;
    const layout = embedded ? null : normalizeTerminalLayout(requestedLayout);
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
    const claudeSettings = provider === 'claude'
      ? this.claudeSettingsForSession(expectedThreadId)
      : null;
    const command = this.platform === 'win32'
      ? provider === 'codex'
        ? codexRelayCommand(project.path, cmdQuote, codexEndpoint, resumeThreadId, codexLaunchSettings)
        : claudeRelayCommand(
          initializeThreadId || (resumeThreadId ? null : expectedLaunchId),
          cmdQuote,
          this.claudeBinary,
          resumeThreadId,
          claudeSettings,
          claudeLaunchSettings,
        )
      : terminalCommand(project.path, provider, {
        claudeSessionId: initializeThreadId || (resumeThreadId ? null : expectedLaunchId),
        codexEndpoint,
        codexLaunchSettings,
        claudeBinary: this.claudeBinary,
        claudeSettings,
        claudeLaunchSettings,
        resumeThreadId,
      });
    // The exact structured fact the executor later compares against, recorded only when CC Relay
    // built this command itself. Storing the hook payload as its serialized form makes the later
    // comparison total: a different endpoint or a missing bridge cannot look like a match.
    const launchSettingsRecord = provider === 'claude' && claudeLaunchSettings
      ? claudeLaunchSettingsRecord(claudeLaunchSettings, claudeSettings)
      : null;
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
      initializeThreadId: initializeThreadId || undefined,
      launchModel: launchSettingsRecord?.model || codexLaunchSettings?.model || undefined,
      launchEffort: launchSettingsRecord?.effort || codexLaunchSettings?.effort || undefined,
    });
    if (embedded) {
      try {
        const { processId, tty } = this.embeddedTerminalHost.launch({
          launchId: expectedLaunchId, provider, path: project.path, command,
        });
        this.trackOwnedTerminal({
          launchId: expectedLaunchId, provider, path: project.path,
          terminalProcessId: processId, terminalTty: tty, expectedThreadId,
          transport: 'pty', taskId, cancelWorkspaceReservation, launchSettings: launchSettingsRecord,
        });
        return { launchId: expectedLaunchId, expectedThreadId, provider, path: project.path,
          terminalProcessId: processId, transport: 'pty', command };
      } catch (error) {
        await this.embeddedTerminalHost.close(expectedLaunchId);
        cancelWorkspaceReservation?.();
        throw error;
      }
    }
    if (this.platform === 'win32') {
      // cmd.exe /K strips the first character and the last quote of its command line whenever
      // that line begins with a quote, which is exactly what a resolved `claude.cmd` path
      // produces. One extra wrapping pair makes that rule consume the wrapper instead of a real
      // argument quote, and it is lossless for a command that does not begin with a quote.
      // An explicit console host gives each owned launch its own native window, even when
      // Windows Terminal is the default app. A shared Terminal window cannot safely identify
      // the task's tab through a shell PID. Keep the original CLI inside this OS console.
      const startProcess = `$process = Start-Process -FilePath 'conhost.exe' -WorkingDirectory ${powershellQuote(project.path)} -ArgumentList 'cmd.exe', '/k', ${powershellQuote(`"${command}"`)}${background ? " -WindowStyle Minimized" : ''} -PassThru`;
      // A minimized launch has no visible rectangle, so grid placement is skipped rather than
      // moved on an iconic window. Windows keeps the grid for foreground launches only.
      const placeWindow = Boolean(bounds) && !background;
      // PowerShell has no backslash escape, so a literal double quote inside this script would
      // terminate its enclosing string before the C# source reached the compiler. The whole
      // script therefore stays free of double quotes and builds the one the DllImport attribute
      // needs from [char]34.
      const windowType = "Add-Type -TypeDefinition ('using System; using System.Runtime.InteropServices; public class RelayWindow { [DllImport(' + [char]34 + 'user32.dll' + [char]34 + ')] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hgt, bool repaint); }')";
      // cmd.exe is a console process, so WaitForInputIdle always fails against it. Poll the
      // cached window handle instead and leave the window where Windows put it when the console
      // never reports one. Placement can never fail the launch or orphan the terminal.
      const placement = placeWindow ? [
        windowType,
        `for ($poll = 0; $poll -lt 40 -and $process.MainWindowHandle -eq [IntPtr]::Zero; $poll++) { Start-Sleep -Milliseconds 50; $process.Refresh() }`,
        `if ($process.MainWindowHandle -ne [IntPtr]::Zero) { $null = [RelayWindow]::MoveWindow($process.MainWindowHandle, ${bounds.left}, ${bounds.top}, ${bounds.right - bounds.left}, ${bounds.bottom - bounds.top}, $true) }`,
      ].join('; ') : '';
      const script = [
        "$ErrorActionPreference = 'Stop'",
        startProcess,
        ...(placement ? [`try { ${placement} } catch { }`] : []),
        "try { ($process.Id.ToString() + '|' + $process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()) } catch { $process.Id }",
      ].join('; ');
      let terminalProcessId = null;
      let terminalProcessStartedAt = null;
      try {
        const { stdout = '' } = await this.run('powershell.exe', ['-NoProfile', '-Command', script]);
        const [processIdText, startedAt] = stdout.trim().split('|');
        const parsedProcessId = Number.parseInt(processIdText, 10);
        if (Number.isInteger(parsedProcessId) && parsedProcessId > 0) {
          terminalProcessId = parsedProcessId;
          terminalProcessStartedAt = /^\d{15,20}$/.test(startedAt || '') ? startedAt : null;
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
        terminalProcessStartedAt,
        expectedThreadId,
        cancelWorkspaceReservation,
        launchSettings: launchSettingsRecord,
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
    // Opening a new Terminal window and submitting a real command in one do script call races
    // login-shell startup. A slow Fish configuration can consume the appended Return while
    // retaining the command text, leaving the provider command visibly held at the shell prompt.
    // An empty do script is a shell-ready barrier: Terminal keeps the tab busy until that no-op
    // reaches the shell. Submit the provider command only after the exact new tab becomes idle.
    const shellReadyBarrier = `\nset shellReady to false\nrepeat with shellPoll from 1 to ${TERMINAL_SHELL_READY_POLL_COUNT}\nif not (busy of launchedTab) then\nset shellReady to true\nexit repeat\nend if\ndelay ${TERMINAL_SHELL_READY_POLL_MS / 1000}\nend repeat`;
    const commandSubmission = `\nif shellReady then\ndo script ${JSON.stringify(command)} in launchedTab\nend if`;
    const script = `tell application "Terminal"\n${background ? '' : 'activate\n'}set launchedTab to do script ""${windowCaptureCommand}${boundsAssignment}${backgroundCommand}${shellReadyBarrier}${commandSubmission}\nreturn (launchedWindowId as text) & "|" & (shellReady as text)\nend tell`;
    let terminalWindowId = null;
    let shellReady = true;
    try {
      const { stdout = '' } = await this.run('osascript', ['-e', script]);
      const [windowIdText, shellReadyText = 'true'] = stdout.trim().split('|');
      const parsedWindowId = Number.parseInt(windowIdText, 10);
      if (Number.isInteger(parsedWindowId) && parsedWindowId > 0) {
        terminalWindowId = parsedWindowId;
      }
      shellReady = shellReadyText.trim() !== 'false';
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
      // A shell that never became ready never received the provider command, so nothing was
      // launched with these settings and the record would be a lie.
      launchSettings: shellReady ? launchSettingsRecord : null,
    });
    if (!launchId) cancelWorkspaceReservation?.();
    this.diagnostic('terminal.launch.dispatched', {
      launchId,
      provider,
      path: project.path,
      platform: this.platform,
      terminalWindowId,
      shellReady,
    });
    const shellStartupError = shellReady
      ? null
      : `The new terminal shell did not become ready before CC Relay could start ${provider === 'codex' ? 'Codex' : 'Claude'}.`;
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
      ...(shellStartupError ? {
        connectionStatus: 'shell_not_ready',
        bindingError: shellStartupError,
      } : {}),
    };
  }

  async closeOwnedTerminal(threadId) {
    if (this.closing) {
      throw new Error('CC Relay is closing and cannot change terminal sessions.');
    }
    const close = this.launchQueue.then(() => this.closeOwnedTerminalNow(threadId));
    this.launchQueue = close.catch(() => {});
    return close;
  }

  async closeOwnedLaunch(launchId) {
    if (this.closing) {
      throw new Error('CC Relay is closing and cannot change terminal sessions.');
    }
    const close = this.launchQueue.then(() => {
      const terminal = this.ownedTerminals.get(launchId);
      if (!terminal) {
        throw new Error('CC Relay could not verify an exact native terminal for this launch.');
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
    const inspectScript = `tell application "Terminal"\nif not (exists window id ${terminal.terminalWindowId}) then return ${JSON.stringify(TERMINAL_WINDOW_MISSING)}\nset targetWindow to window id ${terminal.terminalWindowId}\nif (count of tabs of targetWindow) is not 1 then error "The terminal now contains multiple tabs."${expectedTtyCheck}\nreturn tty of first tab of targetWindow\nend tell`;
    const { stdout = '' } = await this.run(
      'osascript',
      ['-e', inspectScript],
      { timeout: TERMINAL_CLOSE_TIMEOUT_MS },
    );
    if (String(stdout).trim() === TERMINAL_WINDOW_MISSING) return null;
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
    // membership CC Relay must terminate, so it owns both enumeration and the drain gate.
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
    const terminal = this.ownedTerminalForThread(threadId);
    if (!terminal) {
      throw new Error('CC Relay could not verify an exact native terminal for this session.');
    }
    return this.closeTrackedTerminalNow(terminal);
  }

  async closeTrackedTerminalNow(terminal) {
    const threadId = terminal.threadId;
    // Last gate before a destructive native action. An adoption that another live backend has
    // claimed since it was made is released here instead of killing that backend's terminal.
    const foreignOwner = await this.foreignOwnerOfAdoption(terminal);
    if (foreignOwner) {
      this.forgetTrackedTerminal(terminal.launchId);
      this.diagnosticForeignOwner('terminal.close.skipped_foreign_owner', {
        launchId: terminal.launchId,
        threadId,
        provider: terminal.provider,
        path: terminal.path,
      }, foreignOwner);
      throw new Error(
        `That terminal belongs to another running CC Relay backend (process ${foreignOwner.pid}). CC Relay left it open.`,
      );
    }
    this.diagnostic('terminal.close.requested', {
      launchId: terminal.launchId,
      threadId,
      provider: terminal.provider,
      path: terminal.path,
      platform: this.platform,
      ownershipSource: terminal.ownershipSource,
    });
    try {
      if (terminal.transport === 'pty') {
        await this.embeddedTerminalHost.close(terminal.launchId);
      } else if (this.platform === 'darwin' && terminal.terminalWindowId) {
        if (terminal.terminalTty && terminal.runtimeProcessId) {
          try {
            const { stdout = '' } = await this.run(
              'ps',
              ['-p', String(terminal.runtimeProcessId), '-o', 'tty='],
              { timeout: TERMINAL_CLOSE_TIMEOUT_MS },
            );
            if (normalizeTerminalTty(stdout) !== terminal.terminalTty) {
              throw new Error('The recovered terminal process identity changed.');
            }
          } catch (error) {
            if (!macTerminalRuntimeProcessMissing(error)) throw error;
            this.diagnostic('terminal.close.runtime_already_exited', {
              launchId: terminal.launchId,
              threadId,
              terminalWindowId: terminal.terminalWindowId,
              terminalTty: terminal.terminalTty,
              runtimeProcessId: terminal.runtimeProcessId,
            });
          }
        }
        const terminalTty = await this.terminateMacTerminalWindow(terminal);
        if (terminalTty) {
          this.diagnostic('terminal.close.processes_terminated', {
            launchId: terminal.launchId,
            threadId,
            terminalWindowId: terminal.terminalWindowId,
            terminalTty,
          });
        } else {
          this.diagnostic('terminal.close.already_exited', {
            launchId: terminal.launchId,
            threadId,
            platform: this.platform,
            terminalWindowId: terminal.terminalWindowId,
          });
        }
      } else if (this.platform === 'win32' && terminal.terminalProcessId) {
        try {
          await this.run(
            'taskkill.exe',
            ['/PID', String(terminal.terminalProcessId), '/T', '/F'],
            { timeout: TERMINAL_CLOSE_TIMEOUT_MS },
          );
        } catch (error) {
          // A window the user already closed by hand must still release its ownership and its
          // project pool slot. macOS reaches the same outcome through `if exists window id ...`,
          // so this is platform parity, not a weaker close. Every other taskkill failure keeps
          // throwing and keeps the launch owned for a safe retry.
          if (!windowsTerminalProcessMissing(error)) throw error;
          this.diagnostic('terminal.close.already_exited', {
            launchId: terminal.launchId,
            threadId,
            platform: this.platform,
            terminalProcessId: terminal.terminalProcessId,
            error: error.message,
          });
        }
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
      // exits. Do not let the /api/threads recovery poll resurrect the window CC Relay just
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
    for (const terminal of [...this.ownedTerminals.values()]) {
      if (terminal.transport !== 'pty') continue;
      this.releaseLaunchReservation(terminal.launchId);
      await this.embeddedTerminalHost.close(terminal.launchId);
      this.forgetTrackedTerminal(terminal.launchId);
    }
    await this.embeddedTerminalHost?.shutdown();
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
    // Shutdown never closes a launch this process adopted at runtime, because adoption sets
    // closeOnShutdown = false. It must still drop every claim so a surviving backend can adopt.
    this.recordOwnership('clearOwnLaunches');
    this.diagnostic('terminal.shutdown.completed', {
      platform: this.platform,
      windowCount: windowIds.length,
      processCount: processIds.length,
    });
    return { windowCount: windowIds.length, processCount: processIds.length };
  }
}
