import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import headless from '@xterm/headless';
import serialization from '@xterm/addon-serialize';

const execFile = promisify(execFileCallback);
const require = createRequire(import.meta.url);
const { Terminal } = headless;
const { SerializeAddon } = serialization;
const MAX_PENDING_BYTES = 4 * 1024 * 1024;
const quote = (value) => `'${String(value).replaceAll("'", `'\\''`)}'`;

export function terminalInputTarget(terminal) {
  return terminal?.transport === 'pty' ? terminal.terminalId : terminal?.terminalWindowId;
}

export function isEmbeddedTerminalTarget(target) {
  return typeof target === 'string' && target.startsWith('pty:');
}

export function embeddedShellCommand(command, platform = process.platform) {
  if (platform === 'win32') {
    return { file: process.env.ComSpec || 'cmd.exe', args: `/d /s /k "${command}"` };
  }
  const file = process.env.SHELL || '/bin/sh';
  // Keep the same PTY alive when Claude returns to its shell for a settings restart.
  // A login shell also supplies the installed CLI PATH when Relay starts from the Dock.
  return { file, args: ['-l', '-c', `${command}; exec ${quote(file)} -l`] };
}

export class EmbeddedTerminalHost {
  constructor({ spawn = null, platform = process.platform, run = execFile } = {}) {
    Object.assign(this, { spawn, platform, run });
    this.sessions = new Map();
    this.closing = false;
  }

  launch({ launchId, provider, path, command }) {
    if (this.closing || this.sessions.has(launchId)) throw new Error('Terminal launch is no longer available.');
    const spawn = this.spawn || require('node-pty').spawn;
    const shell = embeddedShellCommand(command, this.platform);
    const terminal = new Terminal({ cols: 120, rows: 36, scrollback: 2000, allowProposedApi: true });
    const serializer = new SerializeAddon();
    terminal.loadAddon(serializer);
    let pty;
    try {
      pty = spawn(shell.file, shell.args, {
        name: 'xterm-256color', cols: terminal.cols, rows: terminal.rows, cwd: path,
      });
    } catch (error) {
      terminal.dispose();
      throw error;
    }
    const session = {
      launchId, provider, path, pty, terminal, serializer,
      alive: true, pendingBytes: 0, sequence: 0, listeners: new Set(),
    };
    session.exited = new Promise((done) => { session.resolveExit = done; });
    this.sessions.set(launchId, session);
    // The server emulator answers device queries even when no renderer is attached.
    // The renderer suppresses these replies, so one query gets exactly one answer.
    terminal.onData((data) => { if (session.alive) pty.write(data); });
    pty.onData((data) => {
      if (!session.alive) return;
      session.pendingBytes += Buffer.byteLength(data);
      if (session.pendingBytes > MAX_PENDING_BYTES) pty.pause();
      terminal.write(data, () => {
        session.pendingBytes -= Buffer.byteLength(data);
        if (session.pendingBytes < MAX_PENDING_BYTES / 2 && session.alive) pty.resume();
        session.sequence += 1;
        for (const listener of session.listeners) listener({ type: 'data', data, sequence: session.sequence });
      });
    });
    pty.onExit(({ exitCode, signal }) => {
      session.alive = false;
      session.resolveExit();
      for (const listener of session.listeners) listener({ type: 'exit', exitCode, signal });
      session.listeners.clear();
    });
    return { processId: pty.pid, tty: typeof pty.pty === 'string' ? pty.pty : null };
  }

  get(launchId) { return this.sessions.get(launchId) || null; }
  isAlive(launchId) { return this.get(launchId)?.alive === true; }

  // Subscribe and serialize in one synchronous step after the parser drains. Data queued
  // during the await is either included in the snapshot or delivered after it, never lost.
  async attach(launchId, listener) {
    const session = this.get(launchId);
    if (!session?.alive) throw new Error('The original terminal has closed.');
    await new Promise((done) => session.terminal.write('', done));
    if (this.get(launchId) !== session || !session.alive) throw new Error('The original terminal has closed.');
    listener({ type: 'snapshot', data: session.serializer.serialize(),
      cols: session.terminal.cols, rows: session.terminal.rows, sequence: session.sequence });
    session.listeners.add(listener);
    return () => session.listeners.delete(listener);
  }

  write(launchId, data) {
    const session = this.get(launchId);
    if (!session?.alive) throw new Error('The original terminal has closed.');
    session.pty.write(data);
  }

  resize(launchId, cols, rows) {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || cols > 500 || rows < 2 || rows > 250) {
      throw new Error('Invalid terminal dimensions.');
    }
    const session = this.get(launchId);
    if (!session?.alive) throw new Error('The original terminal has closed.');
    if (session.terminal.cols === cols && session.terminal.rows === rows) return;
    session.terminal.resize(cols, rows);
    session.pty.resize(cols, rows);
  }

  async readScreen(launchId) {
    const session = this.get(launchId);
    if (!session?.alive) return { ok: false, text: '', reason: 'terminal-closed' };
    await new Promise((done) => session.terminal.write('', done));
    if (this.get(launchId) !== session || !session.alive) return { ok: false, text: '', reason: 'terminal-closed' };
    const buffer = session.terminal.buffer.active;
    const lines = [];
    for (let i = buffer.viewportY; i < buffer.viewportY + session.terminal.rows; i += 1) {
      lines.push(buffer.getLine(i)?.translateToString(true) || '');
    }
    return { ok: true, text: lines.join('\n'), reason: 'read' };
  }

  // A discovered provider PID must still descend from this exact live PTY shell.
  // Numeric PIDs alone are never enough to bind or inject into another session.
  async ownsProcess(launchId, pid) {
    const session = this.get(launchId);
    if (!session?.alive || !Number.isInteger(pid) || pid <= 0) return false;
    try {
      const { stdout } = this.platform === 'win32'
        ? await this.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          'Get-CimInstance Win32_Process | ForEach-Object { "{0} {1}" -f $_.ProcessId, $_.ParentProcessId }'], { timeout: 5000, maxBuffer: 1024 * 1024 })
        : await this.run('ps', ['-ax', '-o', 'pid=,ppid='], { timeout: 5000, maxBuffer: 1024 * 1024 });
      if (this.get(launchId) !== session || !session.alive) return false;
      const parents = new Map(stdout.trim().split('\n').map((line) => line.trim().split(/\s+/).map(Number)));
      const visited = new Set();
      for (let current = pid; current > 0 && !visited.has(current); current = parents.get(current)) {
        if (current === session.pty.pid) return true;
        visited.add(current);
      }
    } catch { /* An unreadable process tree cannot authorize terminal input. */ }
    return false;
  }

  async resolveClaudeTerminal(owned, session) {
    const slot = this.get(owned?.launchId);
    if (!slot || slot.provider !== 'claude' || owned.threadId !== session.id
      || resolve(slot.path) !== resolve(session.cwd) || !await this.ownsProcess(owned.launchId, session.pid)) return null;
    return { transport: 'pty', terminalId: `pty:${owned.launchId}`,
      terminalTty: slot.pty.pty || null, runtimeProcessId: session.pid };
  }

  input(target, data) {
    if (!isEmbeddedTerminalTarget(target)) throw new Error('Invalid embedded terminal identity.');
    this.write(target.slice(4), data);
  }

  async close(launchId) {
    const session = this.get(launchId);
    if (!session) return false;
    // The live handle owns this process. Await its exit so shutdown never leaves a
    // child behind or disposes the parser while output is still draining.
    const waitForExit = async (milliseconds) => {
      let timer;
      try { await Promise.race([session.exited, new Promise((done) => { timer = setTimeout(done, milliseconds); })]); }
      finally { clearTimeout(timer); }
    };
    if (session.alive) {
      session.pty.kill();
      await waitForExit(1500);
      if (session.alive) { session.pty.kill('SIGKILL'); await waitForExit(1500); }
      if (session.alive) throw new Error('The owned terminal did not exit.');
    }
    this.sessions.delete(launchId);
    session.alive = false;
    for (const listener of session.listeners) listener({ type: 'exit' });
    session.listeners.clear();
    session.terminal.dispose();
    return true;
  }

  async shutdown() {
    this.closing = true;
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)));
  }
}
