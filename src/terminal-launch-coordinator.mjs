import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const wait = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

function canonicalPath(path) {
  try { return realpathSync(path); } catch { return resolve(path || '.'); }
}

export class TerminalLaunchCoordinator {
  constructor({
    launcher,
    listSessions,
    diagnostic = () => {},
    delay = wait,
    now = Date.now,
    pollMs = 500,
    timeoutMs = 15_000,
  }) {
    this.launcher = launcher;
    this.listSessions = listSessions;
    this.diagnostic = diagnostic;
    this.delay = delay;
    this.now = now;
    this.pollMs = pollMs;
    this.timeoutMs = timeoutMs;
    this.queue = Promise.resolve();
  }

  launch(path, provider, layout) {
    const operation = this.queue.then(() => this.launchNow(path, provider, layout));
    this.queue = operation.catch(() => {});
    return operation;
  }

  async launchNow(path, provider, layout) {
    const launched = await this.launcher.launch(path, provider, layout);
    if (!launched.launchId) return launched;

    try {
      const deadline = this.now() + this.timeoutMs;
      let candidateId = null;
      let observations = 0;
      while (this.now() < deadline) {
        let sessions;
        try {
          sessions = await this.listSessions(provider);
        } catch (error) {
          this.diagnostic('terminal.binding.discovery_failed', {
            launchId: launched.launchId,
            provider,
            path: launched.path,
            error: error.message,
          });
          await this.delay(this.pollMs);
          continue;
        }
        const thread = sessions.find((item) => (
          item.provider === provider
          && canonicalPath(item.cwd) === canonicalPath(launched.path)
          && (provider === 'claude'
            ? item.id === launched.launchId
            : item.launchId === launched.launchId)
        ));
        if (thread?.id === candidateId) observations += 1;
        else {
          candidateId = thread?.id || null;
          observations = thread ? 1 : 0;
        }
        if (thread && observations >= 2) {
          this.launcher.bindOwnedTerminal(launched.launchId, thread);
          return { ...launched, threadId: thread.id };
        }
        await this.delay(this.pollMs);
      }
      this.diagnostic('terminal.binding.timed_out', {
        launchId: launched.launchId,
        provider,
        path: launched.path,
      });
      return { ...launched, connectionStatus: 'timed_out' };
    } finally {
      this.launcher.releaseLaunchReservation?.(launched.launchId);
    }
  }
}
