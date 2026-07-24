import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const RUNTIME_INSPECTION_TIMEOUT_MS = 5_000;
const RUNTIME_INSPECTION_MAX_BUFFER = 2 * 1024 * 1024;
const INSPECTION_OPTIONS = {
  timeout: RUNTIME_INSPECTION_TIMEOUT_MS,
  maxBuffer: RUNTIME_INSPECTION_MAX_BUFFER,
};

const DARWIN_TERMINAL_INVENTORY = `const terminal = Application('Terminal');
JSON.stringify(terminal.running() ? terminal.windows().map((window) => ({
  id: window.id(),
  tabs: window.tabs().map((tab) => ({ tty: tab.tty() })),
})) : []);`;

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeTerminalTty(value) {
  const tty = typeof value === 'string' ? value.trim() : '';
  if (!tty || tty === '?' || tty === '??') return null;
  return tty.startsWith('/dev/') ? tty : `/dev/${tty}`;
}

export function codexProcessIdFromLsof(output, { clientPort, serverPort }) {
  const localPort = positiveInteger(clientPort);
  const relayPort = positiveInteger(serverPort);
  if (!localPort || !relayPort || typeof output !== 'string') return null;

  const expected = `127.0.0.1:${localPort}->127.0.0.1:${relayPort}`;
  let processId = null;
  let command = '';
  const matches = new Set();
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('p')) {
      processId = positiveInteger(line.slice(1));
      command = '';
    } else if (line.startsWith('c')) {
      command = line.slice(1).trim().toLowerCase();
    } else if (line.startsWith('n') && line.slice(1) === expected && processId && command.includes('codex')) {
      matches.add(processId);
    }
  }
  return matches.size === 1 ? [...matches][0] : null;
}

export function processTtysFromPs(output) {
  const result = new Map();
  if (typeof output !== 'string') return result;
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(\S+)$/);
    if (!match) continue;
    const processId = positiveInteger(match[1]);
    const tty = normalizeTerminalTty(match[2]);
    if (processId && tty) result.set(processId, tty);
  }
  return result;
}

export function singleTabTerminalForTty(inventory, value) {
  const tty = normalizeTerminalTty(value);
  if (!tty || !Array.isArray(inventory)) return null;
  const matches = [];
  for (const window of inventory) {
    const terminalWindowId = positiveInteger(window?.id);
    const tabs = Array.isArray(window?.tabs) ? window.tabs : [];
    if (!terminalWindowId) continue;
    for (const tab of tabs) {
      if (normalizeTerminalTty(tab?.tty) === tty) {
        matches.push({ terminalWindowId, terminalTty: tty, tabCount: tabs.length });
      }
    }
  }
  if (matches.length !== 1 || matches[0].tabCount !== 1) return null;
  return {
    terminalWindowId: matches[0].terminalWindowId,
    terminalTty: matches[0].terminalTty,
  };
}

export class TerminalRuntimeResolver {
  constructor({
    run = execFile,
    platform = process.platform,
    codexClientForThread = () => null,
    diagnostic = () => {},
  } = {}) {
    this.run = run;
    this.platform = platform;
    this.codexClientForThread = codexClientForThread;
    this.diagnostic = diagnostic;
  }

  async resolve(threads) {
    if (this.platform !== 'darwin' || !Array.isArray(threads) || threads.length === 0) return [];

    const candidates = [];
    const codexCandidates = [];
    for (const thread of threads) {
      if (!thread?.id || !thread?.cwd) continue;
      if (thread.provider === 'claude') {
        const processId = positiveInteger(thread.pid);
        if (processId && thread.source === 'Claude interactive') {
          candidates.push({ thread, processId });
        }
      } else if (thread.provider === 'codex') {
        const client = this.codexClientForThread(thread.id);
        if (client) codexCandidates.push({ thread, client });
      }
    }

    let lsofOutput = '';
    if (codexCandidates.length > 0) {
      try {
        ({ stdout: lsofOutput = '' } = await this.run(
          'lsof',
          ['-nP', '-iTCP', '-sTCP:ESTABLISHED', '-Fpctn'],
          INSPECTION_OPTIONS,
        ));
      } catch (error) {
        this.diagnostic('terminal.recovery.socket_inspection_failed', { error: error.message });
      }
    }
    for (const candidate of codexCandidates) {
      const processId = codexProcessIdFromLsof(lsofOutput, candidate.client);
      if (processId) candidates.push({ thread: candidate.thread, processId });
    }
    if (candidates.length === 0) return [];

    const processIds = [...new Set(candidates.map((candidate) => candidate.processId))];
    let ttyOutput;
    let terminalOutput;
    try {
      [{ stdout: ttyOutput = '' }, { stdout: terminalOutput = '[]' }] = await Promise.all([
        this.run('ps', ['-p', processIds.join(','), '-o', 'pid=,tty='], INSPECTION_OPTIONS),
        this.run('osascript', ['-l', 'JavaScript', '-e', DARWIN_TERMINAL_INVENTORY], INSPECTION_OPTIONS),
      ]);
    } catch (error) {
      this.diagnostic('terminal.recovery.native_inspection_failed', { error: error.message });
      return [];
    }

    let inventory;
    try {
      inventory = JSON.parse(terminalOutput || '[]');
    } catch (error) {
      this.diagnostic('terminal.recovery.inventory_invalid', { error: error.message });
      return [];
    }
    const processTtys = processTtysFromPs(ttyOutput);
    const resolved = candidates.map(({ thread, processId }) => {
      const terminal = singleTabTerminalForTty(inventory, processTtys.get(processId));
      return terminal ? {
        threadId: thread.id,
        provider: thread.provider,
        path: thread.cwd,
        runtimeProcessId: processId,
        ...terminal,
      } : null;
    }).filter(Boolean);

    const windowCounts = new Map();
    for (const terminal of resolved) {
      windowCounts.set(terminal.terminalWindowId, (windowCounts.get(terminal.terminalWindowId) || 0) + 1);
    }
    return resolved.filter((terminal) => windowCounts.get(terminal.terminalWindowId) === 1);
  }
}
