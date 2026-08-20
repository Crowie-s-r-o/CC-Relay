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
    threadIdForLaunch = () => null,
    diagnostic = () => {},
    delay = wait,
    now = Date.now,
    pollMs = 500,
    timeoutMs = 15_000,
  }) {
    this.launcher = launcher;
    this.listSessions = listSessions;
    this.threadIdForLaunch = threadIdForLaunch;
    this.diagnostic = diagnostic;
    this.delay = delay;
    this.now = now;
    this.pollMs = pollMs;
    this.timeoutMs = timeoutMs;
    this.queue = Promise.resolve();
  }

  launch(path, provider, layout, options = {}) {
    const operation = this.queue.then(() => this.launchNow(path, provider, layout, options));
    this.queue = operation.catch(() => {});
    return operation;
  }

  async launchNow(path, provider, layout, options = {}) {
    const launched = await this.launcher.launch(path, provider, layout, options);
    if (!launched.launchId) return launched;
    if (launched.connectionStatus || launched.bindingError) {
      this.launcher.releaseLaunchReservation?.(launched.launchId);
      return launched;
    }

    try {
      let deadline = this.now() + this.timeoutMs;
      let candidateId = null;
      let observations = 0;
      let folderTrustAccepted = false;
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
        const exactCodexThreadId = provider === 'codex'
          ? this.threadIdForLaunch(launched.launchId)
          : null;
        const thread = sessions.find((item) => (
          item.provider === provider
          && canonicalPath(item.cwd) === canonicalPath(launched.path)
          && (provider === 'claude'
            ? item.id === (launched.expectedThreadId || launched.launchId)
            : item.launchId === launched.launchId
              || (exactCodexThreadId && item.id === exactCodexThreadId))
        ));
        if (thread?.id === candidateId) observations += 1;
        else {
          candidateId = thread?.id || null;
          observations = thread ? 1 : 0;
        }
        if (thread && observations >= 2) {
          try {
            this.launcher.bindOwnedTerminal(launched.launchId, thread);
          } catch (error) {
            this.diagnostic('terminal.binding.rejected', {
              launchId: launched.launchId,
              provider,
              path: launched.path,
              threadId: thread.id,
              error: error.message,
            });
            return {
              ...launched,
              connectionStatus: 'binding_rejected',
              bindingError: error.message,
              thread,
            };
          }
          return { ...launched, threadId: thread.id, thread };
        }
        if (
          !thread
          && provider === 'claude'
          && !folderTrustAccepted
          && typeof this.launcher.resolveClaudeFolderTrust === 'function'
        ) {
          let trust = null;
          try {
            trust = await this.launcher.resolveClaudeFolderTrust(launched.launchId);
          } catch (error) {
            this.diagnostic('terminal.binding.claude_folder_trust_failed', {
              launchId: launched.launchId,
              provider,
              path: launched.path,
              error: error.message,
            });
          }
          if (trust?.status === 'accepted') {
            folderTrustAccepted = true;
            // Claude starts session registration only after this prompt closes. Give that normal
            // startup its complete binding window instead of spending the pre-approval wait from
            // the same deadline.
            deadline = this.now() + this.timeoutMs;
            this.diagnostic('terminal.binding.claude_folder_trust_accepted', {
              launchId: launched.launchId,
              provider,
              path: launched.path,
            });
          }
        }
        await this.delay(this.pollMs);
      }
      this.diagnostic('terminal.binding.timed_out', {
        launchId: launched.launchId,
        provider,
        path: launched.path,
      });
      return folderTrustAccepted
        ? {
          ...launched,
          connectionStatus: 'timed_out',
          bindingError: 'Claude accepted the selected workspace, but its terminal session did not connect to CC Relay in time.',
        }
        : { ...launched, connectionStatus: 'timed_out' };
    } finally {
      this.launcher.releaseLaunchReservation?.(launched.launchId);
    }
  }
}
