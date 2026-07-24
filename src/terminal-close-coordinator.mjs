import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { terminalControlState } from './terminal-control.mjs';

function canonicalPath(path) {
  try { return realpathSync(path); } catch { return resolve(path || '.'); }
}

export class TerminalCloseCoordinator {
  constructor({
    launcher,
    listTasks,
    readSession,
    closingThreadIds = new Set(),
    onReleased = () => {},
  }) {
    this.launcher = launcher;
    this.listTasks = listTasks;
    this.readSession = readSession;
    this.closingThreadIds = closingThreadIds;
    this.onReleased = onReleased;
  }

  controlState(threadId, tasks = this.listTasks()) {
    const ownedTerminal = this.launcher.terminalForThread(threadId);
    if (ownedTerminal && this.closingThreadIds.has(threadId)) {
      return { owned: true, canClose: false, reason: 'That terminal is already closing.' };
    }
    return terminalControlState(
      tasks,
      threadId,
      ownedTerminal,
    );
  }

  async close(threadId) {
    const ownedTerminal = this.launcher.terminalForThread(threadId);
    if (!ownedTerminal) {
      throw new Error('Relay could not verify an exact native terminal for this session.');
    }
    if (this.closingThreadIds.has(threadId)) {
      throw new Error('That terminal is already closing.');
    }
    this.closingThreadIds.add(threadId);
    try {
      const connectedThread = await this.readSession(ownedTerminal.provider, threadId);
      if (!connectedThread || canonicalPath(connectedThread.cwd) !== canonicalPath(ownedTerminal.path)) {
        throw new Error('That terminal session is no longer connected to Relay. Refresh the session list.');
      }
      if (
        typeof this.launcher.verifyTerminalForThread === 'function'
        && !(await this.launcher.verifyTerminalForThread(connectedThread))
      ) {
        throw new Error('The terminal process or native window changed. Refresh the session list before closing it.');
      }
      const control = terminalControlState(
        this.listTasks(),
        threadId,
        ownedTerminal,
      );
      if (!control.canClose) throw new Error(control.reason);
      return await this.launcher.closeOwnedTerminal(threadId);
    } finally {
      this.closingThreadIds.delete(threadId);
      this.onReleased();
    }
  }
}
