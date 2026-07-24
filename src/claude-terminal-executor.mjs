import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ClaudeExecutionError,
  consumeClaudeStreamMessage,
  taskPrompt,
} from './claude-execution-runner.mjs';
import {
  assistantRecordText,
  bracketedPastePayload,
  createTranscriptReader,
  fsTranscriptSource,
  injectionPromptIssue,
  isTurnFinalAssistantRecord,
  resolveClaudeTranscriptPath,
} from './claude-transcript-tail.mjs';

const execFile = promisify(execFileCallback);
const delay = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

// JXA passes the payload through argv, so no AppleScript string escaping is involved and
// leading dashes, quotes, and newlines survive intact (verified in the injection spike).
const INJECT_JXA = "function run(argv){var id=parseInt(argv[0],10);var text=argv[1];"
  + "var term=Application('Terminal');var win=term.windows.byId(id);"
  + "term.doScript(text,{in:win.tabs[0]});return 'ok';}";

async function osascriptType(terminalWindowId, payload) {
  await execFile(
    'osascript',
    ['-l', 'JavaScript', '-e', INJECT_JXA, String(terminalWindowId), payload],
    { timeout: 15_000 },
  );
}

async function defaultInject(terminalWindowId, text) {
  // Bracketed paste makes the interactive TUI insert multiline text literally, and the
  // carriage return that do script appends submits it as a single turn.
  await osascriptType(terminalWindowId, bracketedPastePayload(text));
}

async function defaultSendCancel(terminalWindowId) {
  // Best-effort interrupt: ESC stops the running turn in the Claude TUI. This is the same
  // Automation channel as injection; System Events keystrokes are Accessibility-gated and
  // were denied in the spike, so they are intentionally not used here.
  await osascriptType(terminalWindowId, String.fromCharCode(27));
}

function defaultOpenTranscript({ cwd, sessionId }) {
  return fsTranscriptSource(resolveClaudeTranscriptPath(cwd, sessionId));
}

// Drives a queued turn inside the interactive Claude terminal on macOS by typing the
// prompt into the exact owned Terminal.app window and mirroring the session transcript
// back into Relay's Task Activity. The run outcome matches the headless runner exactly:
// { finalResponse, sessionId, reportedSessionId, exitCode }.
export class ClaudeTerminalExecutor {
  constructor({
    sessions,
    resolveTerminal = null,
    inject = defaultInject,
    sendCancel = defaultSendCancel,
    openTranscript = defaultOpenTranscript,
    wait = delay,
    now = Date.now,
    readinessTimeoutMs = 15_000,
    submissionTimeoutMs = 20_000,
    pollMs = 800,
    idleGraceObservations = 4,
    finalIdleObservations = 2,
    sessionMissingGrace = 3,
    heartbeatMs = 30_000,
    turnCeilingMs = 45 * 60 * 1_000,
    maxPromptBytes = 100_000,
  } = {}) {
    this.sessions = sessions;
    this.resolveTerminal = resolveTerminal;
    this.inject = inject;
    this.sendCancel = sendCancel;
    this.openTranscript = openTranscript;
    this.wait = wait;
    this.now = now;
    this.readinessTimeoutMs = readinessTimeoutMs;
    this.submissionTimeoutMs = submissionTimeoutMs;
    this.pollMs = pollMs;
    this.idleGraceObservations = idleGraceObservations;
    this.finalIdleObservations = finalIdleObservations;
    this.sessionMissingGrace = sessionMissingGrace;
    this.heartbeatMs = heartbeatMs;
    this.turnCeilingMs = turnCeilingMs;
    this.maxPromptBytes = maxPromptBytes;
  }

  async runTurn(task, active, session, terminal, { onEvent, onStderr }) {
    const sessionId = task.thread_id;
    const source = this.openTranscript({ cwd: task.repo_path, sessionId });

    await this.ensureReady(task, active, onEvent);

    // Pre-flight prompt validation before typing (deterministic, pre-injection).
    const prompt = taskPrompt(task);
    const promptIssue = injectionPromptIssue(prompt, { maxBytes: this.maxPromptBytes });
    if (promptIssue) {
      throw new ClaudeExecutionError(`Relay cannot type this prompt into the terminal: ${promptIssue}`, { retryable: false });
    }

    // Re-verify the exact window and tty still belong to the live session's current pid,
    // immediately before typing. tty names are recycled by macOS, so a window resolved at
    // task start can belong to a different session by injection time. This runs a fresh
    // discovery read and aborts (retryable, pre-injection: nothing has been typed).
    await this.verifyTerminalIdentity(task, active, terminal);

    onEvent({
      event: {
        type: 'claude/started',
        provider: 'claude',
        sessionId,
        sessionMode: 'terminal',
        model: 'session default',
        effort: 'session default',
      },
      message: `Claude is running this turn inside the ${task.thread_name || sessionId} terminal, using that session's own model and effort.`,
    });

    const injectionOffset = Math.max(0, source.size());
    const reader = createTranscriptReader(source, injectionOffset);

    try {
      await this.inject(terminal.terminalWindowId, prompt);
    } catch (error) {
      // A do script osascript timeout can fire after Terminal.app already delivered and
      // processed the Apple Event, so the prompt may have been submitted. Never auto-retry
      // (that would run the turn twice); require an explicit manual retry.
      throw new ClaudeExecutionError(
        `Relay could not confirm it typed the prompt into the ${task.thread_name || sessionId} terminal: ${error.message}. The prompt may already be running, so Relay will not retry automatically. Check the terminal before retrying.`,
        { retryable: false },
      );
    }

    return this.watchTurn(task, active, terminal, source, reader, injectionOffset, { onEvent, onStderr });
  }

  // Readiness: the session must be present in claude agents --json and idle. A folder-trust
  // prompt session is not registered at all, so registration plus idle is a sufficient
  // input-ready signal (empirically verified). The transcript may not exist yet on a fresh
  // terminal's first turn; the tail reads from offset 0 once the file is created.
  async ensureReady(task, active, onEvent) {
    const sessionId = task.thread_id;
    const deadline = this.now() + this.readinessTimeoutMs;
    let announced = false;
    let missing = 0;
    while (this.now() < deadline) {
      if (active.cancelRequested) {
        throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
      }
      let current;
      try {
        current = await this.sessions.readConnectedSession(sessionId);
      } catch {
        current = null;
      }
      if (!current) {
        missing += 1;
        if (missing >= this.sessionMissingGrace) {
          throw new ClaudeExecutionError(
            `The selected Claude terminal for ${task.thread_name || sessionId} is no longer open. It disappeared before Relay could type the prompt, so nothing was sent. Reopen the terminal and retry.`,
            { retryable: false },
          );
        }
      } else {
        missing = 0;
        if (current.rawStatus !== 'busy') {
          return;
        }
        if (!announced) {
          onEvent({
            event: { type: 'claude/progress', provider: 'claude', sessionId },
            message: 'Waiting for the Claude terminal to become free before Relay types the prompt.',
          });
          announced = true;
        }
      }
      await this.wait(this.pollMs);
    }
    throw new ClaudeExecutionError(
      `The ${task.thread_name || sessionId} terminal is present but stayed busy and never became free to accept the prompt. Nothing was typed. Wait for it to finish, then retry.`,
      { retryable: true },
    );
  }

  // Immediately before typing, confirm the resolved window and tty still map to the live
  // session's current pid from a fresh discovery read. macOS recycles tty names, so a
  // window resolved at task start can belong to another session by now.
  async verifyTerminalIdentity(task, active, terminal) {
    if (typeof this.resolveTerminal !== 'function') {
      return;
    }
    if (active.cancelRequested) {
      throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
    }
    const current = await this.sessions.readConnectedSession(task.thread_id);
    if (!current) {
      throw new ClaudeExecutionError(
        `The selected Claude terminal for ${task.thread_name || task.thread_id} is no longer open. Nothing was typed. Reopen the terminal and retry.`,
        { retryable: false },
      );
    }
    let fresh = null;
    try {
      fresh = await this.resolveTerminal(current);
    } catch {
      fresh = null;
    }
    const mismatch = !fresh
      || fresh.terminalWindowId !== terminal.terminalWindowId
      || (terminal.terminalTty && fresh.terminalTty && fresh.terminalTty !== terminal.terminalTty)
      || (terminal.runtimeProcessId && fresh.runtimeProcessId && fresh.runtimeProcessId !== terminal.runtimeProcessId);
    if (mismatch) {
      throw new ClaudeExecutionError(
        `The ${task.thread_name || task.thread_id} terminal identity changed just before Relay could type. A Terminal window or tty was reused by another session, so Relay did not type anything. Retry to re-resolve the exact terminal.`,
        { retryable: true },
      );
    }
  }

  async watchTurn(task, active, terminal, source, reader, injectionOffset, { onEvent, onStderr }) {
    const sessionId = task.thread_id;
    const context = {
      cwd: task.repo_path,
      tools: new Map(),
      finalResponse: '',
      sessionId,
      reportedSessionId: null,
      error: null,
    };
    let started = false;
    let sawFinal = false;
    let finalText = '';
    let lastText = '';
    let idleObservations = 0;
    let missing = 0;
    const start = this.now();
    let lastHeartbeat = start;

    const drain = () => {
      for (const record of reader.poll()) {
        started = true;
        for (const emitted of consumeClaudeStreamMessage(record, context)) {
          onEvent(emitted);
        }
        if (record.type === 'assistant') {
          const text = assistantRecordText(record);
          if (text) lastText = text;
          if (isTurnFinalAssistantRecord(record)) {
            sawFinal = true;
            if (text) finalText = text;
          }
        }
      }
    };

    for (;;) {
      if (active.cancelRequested) {
        await this.cancelTurn(terminal, sessionId, onEvent);
        throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
      }

      if (this.now() - start > this.turnCeilingMs) {
        // Failures at or after injection are never auto-retried: the prompt already ran.
        throw new ClaudeExecutionError(
          `The Claude terminal turn in ${task.thread_name || sessionId} exceeded the Relay time limit. Check the terminal; retry manually if needed.`,
          { retryable: false },
        );
      }

      drain();

      const size = source.size();
      if (size >= 0 && size < injectionOffset) {
        throw new ClaudeExecutionError(
          `The Claude transcript for ${task.thread_name || sessionId} shrank below the turn start, so Relay can no longer trust the result. Retry when the terminal is stable.`,
          { retryable: false },
        );
      }

      let current;
      try {
        current = await this.sessions.readConnectedSession(sessionId);
      } catch {
        current = null;
      }
      if (!current) {
        // Discovery swallows transient errors into an empty list, which reads as a missing
        // session. Tolerate a few consecutive misses before concluding the terminal closed.
        missing += 1;
        if (missing >= this.sessionMissingGrace) {
          drain();
          if (sawFinal) {
            return this.finalize(task, finalText || lastText);
          }
          throw new ClaudeExecutionError(
            `The Claude terminal for ${task.thread_name || sessionId} closed before the turn produced a final response. The task may be incomplete; retry manually if needed.`,
            { retryable: false },
          );
        }
        await this.wait(this.pollMs);
        continue;
      }
      missing = 0;
      const busy = current.rawStatus === 'busy';
      if (busy) started = true;

      if (!started && this.now() - start > this.submissionTimeoutMs) {
        // Injection reported success but nothing ran. Do NOT fall back to headless: the
        // text may be sitting unsubmitted and a second execution would double it.
        throw new ClaudeExecutionError(
          `Relay sent the prompt to the ${task.thread_name || sessionId} terminal but the Claude session never started the turn. The terminal may be holding unsubmitted text. Open it, submit or clear the prompt, then retry.`,
          { retryable: false },
        );
      }

      if (started && !busy) {
        idleObservations += 1;
        if (sawFinal && idleObservations >= this.finalIdleObservations) {
          // Drain once more: a single API response is written as several records and a
          // thinking-only record can carry a terminal stop reason before the text record
          // flushes, so give the final text a chance to arrive before recording the result.
          drain();
          return this.finalize(task, finalText || lastText);
        }
        if (idleObservations >= this.idleGraceObservations) {
          // Idle for a sustained period with no turn-final record. This also fires when the
          // user presses ESC in the terminal, so never auto-retype the prompt.
          throw new ClaudeExecutionError(
            `The Claude turn in ${task.thread_name || sessionId} ended without a final response. The terminal may have been interrupted. Relay will not retype the prompt automatically; check the terminal and retry if needed.`,
            { retryable: false },
          );
        }
      } else {
        idleObservations = 0;
      }

      if (busy && this.now() - lastHeartbeat > this.heartbeatMs) {
        onEvent({
          event: { type: 'claude/progress', provider: 'claude', sessionId },
          message: `Claude is still working in the ${task.thread_name || sessionId} terminal.`,
        });
        lastHeartbeat = this.now();
      }

      await this.wait(this.pollMs);
    }
  }

  finalize(task, text) {
    const sessionId = task.thread_id;
    const finalResponse = typeof text === 'string' ? text.trim() : '';
    if (!finalResponse) {
      throw new ClaudeExecutionError(
        `The Claude turn in ${task.thread_name || sessionId} completed without any final text. Relay will not retype the prompt automatically; check the terminal and retry if needed.`,
        { retryable: false },
      );
    }
    return {
      finalResponse,
      sessionId,
      reportedSessionId: sessionId,
      exitCode: 0,
    };
  }

  async cancelTurn(terminal, sessionId, onEvent) {
    try {
      await this.sendCancel(terminal.terminalWindowId);
    } catch {
      // best effort only
    }
    onEvent({
      event: { type: 'claude/progress', provider: 'claude', sessionId },
      message: 'Cancellation requested. Relay stopped watching this terminal turn; the terminal may still be finishing it.',
    });
  }
}
