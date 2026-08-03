import { randomBytes } from 'node:crypto';

const DEFAULT_HOOK_TIMEOUT_SECONDS = 1;
const MAX_PENDING_EVENTS = 100;

function hookHandler(url, timeout) {
  return {
    type: 'http',
    url,
    timeout,
  };
}

// Claude's transcript is an asynchronous persistence channel. These HTTP hooks provide a
// live observability channel while the transcript watcher remains the durable fallback.
export function claudeLiveHookSettings(url, {
  timeout = DEFAULT_HOOK_TIMEOUT_SECONDS,
} = {}) {
  const handler = () => hookHandler(url, timeout);
  const allTools = () => [{
    matcher: '*',
    hooks: [handler()],
  }];
  const everyEvent = () => [{
    hooks: [handler()],
  }];
  return {
    hooks: {
      UserPromptSubmit: everyEvent(),
      PreCompact: everyEvent(),
      PostCompact: everyEvent(),
      MessageDisplay: everyEvent(),
      PreToolUse: allTools(),
      PostToolUse: allTools(),
      PostToolUseFailure: allTools(),
      Stop: everyEvent(),
    },
  };
}

function defaultToken() {
  return randomBytes(24).toString('hex');
}

function normalizedSessionId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export class ClaudeHookBridge {
  constructor({
    endpoint = () => null,
    createToken = defaultToken,
    diagnostic = () => {},
    queue = queueMicrotask,
  } = {}) {
    this.endpoint = endpoint;
    this.createToken = createToken;
    this.diagnostic = diagnostic;
    this.queue = queue;
    this.bySession = new Map();
    this.byToken = new Map();
  }

  entryForSession(sessionId) {
    const id = normalizedSessionId(sessionId);
    if (!id) return null;
    let entry = this.bySession.get(id);
    if (!entry) {
      entry = {
        sessionId: id,
        token: this.createToken(),
        generation: 0,
        accepting: false,
        handler: null,
        pending: [],
      };
      this.bySession.set(id, entry);
      this.byToken.set(entry.token, entry);
    }
    return entry;
  }

  hookUrl(entry) {
    const endpoint = String(this.endpoint() || '').replace(/\/+$/, '');
    if (!endpoint || !entry) return null;
    return `${endpoint}/api/internal/claude-hooks/${entry.token}`;
  }

  settingsForSession(sessionId) {
    const entry = this.entryForSession(sessionId);
    const url = this.hookUrl(entry);
    return url ? claudeLiveHookSettings(url) : null;
  }

  register(sessionId) {
    const entry = this.entryForSession(sessionId);
    const url = this.hookUrl(entry);
    if (!entry || !url) return null;

    entry.generation += 1;
    entry.accepting = true;
    entry.handler = null;
    entry.pending = [];
    const generation = entry.generation;

    const deliver = (payload, handler) => {
      this.queue(() => {
        if (
          entry.generation !== generation
          || !entry.accepting
          || entry.handler !== handler
        ) return;
        try {
          const outcome = handler(payload);
          Promise.resolve(outcome).catch((error) => {
            this.diagnostic('claude.hook.handler_failed', {
              sessionId: entry.sessionId,
              event: payload?.hook_event_name,
              error: error.message,
            });
          });
        } catch (error) {
          this.diagnostic('claude.hook.handler_failed', {
            sessionId: entry.sessionId,
            event: payload?.hook_event_name,
            error: error.message,
          });
        }
      });
    };

    return {
      settings: claudeLiveHookSettings(url),
      activate: (handler) => {
        if (entry.generation !== generation || typeof handler !== 'function') return false;
        entry.handler = handler;
        const pending = entry.pending;
        entry.pending = [];
        for (const payload of pending) deliver(payload, handler);
        return true;
      },
      deactivate: () => {
        if (entry.generation !== generation) return false;
        entry.accepting = false;
        entry.handler = null;
        entry.pending = [];
        return true;
      },
    };
  }

  receive(token, payload) {
    const entry = this.byToken.get(String(token || ''));
    if (!entry || normalizedSessionId(payload?.session_id) !== entry.sessionId) {
      return false;
    }
    if (!entry.accepting) {
      return true;
    }
    if (typeof entry.handler !== 'function') {
      if (entry.pending.length >= MAX_PENDING_EVENTS) entry.pending.shift();
      entry.pending.push(payload);
      return true;
    }

    const handler = entry.handler;
    const generation = entry.generation;
    this.queue(() => {
      if (
        entry.generation !== generation
        || !entry.accepting
        || entry.handler !== handler
      ) return;
      try {
        const outcome = handler(payload);
        Promise.resolve(outcome).catch((error) => {
          this.diagnostic('claude.hook.handler_failed', {
            sessionId: entry.sessionId,
            event: payload?.hook_event_name,
            error: error.message,
          });
        });
      } catch (error) {
        this.diagnostic('claude.hook.handler_failed', {
          sessionId: entry.sessionId,
          event: payload?.hook_event_name,
          error: error.message,
        });
      }
    });
    return true;
  }

  clear() {
    this.bySession.clear();
    this.byToken.clear();
  }
}
