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

  recordDiagnostic(event, details = {}) {
    try {
      this.diagnostic(event, details);
    } catch {
      // Hook delivery must not depend on the diagnostics sink.
    }
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
    this.recordDiagnostic('claude.hook.registered', {
      sessionId: entry.sessionId,
      generation,
    });

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
            this.recordDiagnostic('claude.hook.handler_failed', {
              sessionId: entry.sessionId,
              event: payload?.hook_event_name,
              error: error.message,
            });
          });
        } catch (error) {
          this.recordDiagnostic('claude.hook.handler_failed', {
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
        this.recordDiagnostic('claude.hook.activated', {
          sessionId: entry.sessionId,
          generation,
          bufferedEvents: pending.length,
        });
        for (const payload of pending) deliver(payload, handler);
        return true;
      },
      deactivate: () => {
        if (entry.generation !== generation) return false;
        entry.accepting = false;
        entry.handler = null;
        entry.pending = [];
        this.recordDiagnostic('claude.hook.deactivated', {
          sessionId: entry.sessionId,
          generation,
        });
        return true;
      },
    };
  }

  receive(token, payload) {
    const entry = this.byToken.get(String(token || ''));
    if (!entry || normalizedSessionId(payload?.session_id) !== entry.sessionId) {
      this.recordDiagnostic('claude.hook.rejected', {
        reason: entry ? 'session-mismatch' : 'unknown-token',
        event: payload?.hook_event_name || null,
        sessionId: normalizedSessionId(payload?.session_id) || null,
      });
      return false;
    }
    if (['UserPromptSubmit', 'Stop'].includes(payload?.hook_event_name)) {
      this.recordDiagnostic('claude.hook.received', {
        sessionId: entry.sessionId,
        generation: entry.generation,
        event: payload.hook_event_name,
        agentScoped: Boolean(payload.agent_id),
        promptIdPresent: Boolean(payload.prompt_id),
        promptChars: payload.hook_event_name === 'UserPromptSubmit' && typeof payload.prompt === 'string'
          ? payload.prompt.length
          : undefined,
        finalChars: payload.hook_event_name === 'Stop' && typeof payload.last_assistant_message === 'string'
          ? payload.last_assistant_message.length
          : undefined,
        buffered: typeof entry.handler !== 'function',
      });
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
          this.recordDiagnostic('claude.hook.handler_failed', {
            sessionId: entry.sessionId,
            event: payload?.hook_event_name,
            error: error.message,
          });
        });
      } catch (error) {
        this.recordDiagnostic('claude.hook.handler_failed', {
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
