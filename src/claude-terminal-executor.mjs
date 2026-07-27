import { execFile as execFileCallback } from 'node:child_process';
import { dirname, resolve } from 'node:path';
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
  // Bracketed paste makes the interactive TUI insert multiline text literally. Terminal's
  // do script normally appends Return, but Claude can intentionally collapse a large paste
  // and leave it in the composer instead of accepting that Return. watchTurn detects that
  // no turn started and sends one separate blank command as a guarded submit nudge.
  await osascriptType(terminalWindowId, bracketedPastePayload(text));
}

async function defaultSubmit(terminalWindowId) {
  // In an existing Terminal tab, an empty do script is a distinct Return action. Keeping this
  // separate from the bracketed-paste Apple Event is required for Claude's large-paste widget.
  await osascriptType(terminalWindowId, '');
}

async function defaultRelaunch(terminalWindowId, command) {
  // Claude has already returned control to the shell in this exact tab. Terminal do script
  // executes the launch command and appends Return, so this does not depend on TUI key handling.
  await osascriptType(terminalWindowId, command);
}

function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

async function defaultTerminateProcess(pid) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
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

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function selectedTerminalModel(model) {
  if (!model || model === 'default') return null;
  return model === 'best' ? 'fable' : model;
}

function terminalExecutionSettings(task) {
  const model = selectedTerminalModel(task.model);
  const effort = typeof task.effort === 'string' && task.effort.trim()
    ? task.effort.trim()
    : null;
  const permissionMode = task.terminal_permission_mode === 'plan' ? 'plan' : null;
  const tools = Array.isArray(task.terminal_tools)
    ? [...new Set(task.terminal_tools.filter((tool) => typeof tool === 'string' && tool.trim()).map((tool) => tool.trim()))]
    : [];
  const addDirectories = permissionMode === 'plan'
    ? [...new Set(
      (task.attachments || [])
        .map((attachment) => attachment?.path)
        .filter((path) => typeof path === 'string' && path)
        .map((path) => dirname(path)),
    )]
    : [];
  return {
    model,
    effort,
    permissionMode,
    tools,
    addDirectories,
    apply: Boolean(model || effort || permissionMode || tools.length || addDirectories.length),
  };
}

function inactivityLimitLabel(milliseconds) {
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes >= 1) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const seconds = Math.max(1, Math.round(milliseconds / 1_000));
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

function terminalSettingsDescription({ model, effort, permissionMode }) {
  const modelText = model || 'the account default model';
  const effortText = effort ? `${effort} effort` : 'the account default effort';
  const permissionText = permissionMode === 'plan' ? ' in read-only plan mode' : '';
  return `${modelText} at ${effortText}${permissionText}`;
}

export function claudeTerminalRelaunchCommand({
  command = 'claude',
  sessionId,
  resumed = false,
  model = null,
  effort = null,
  permissionMode = null,
  tools = [],
  addDirectories = [],
} = {}) {
  return [
    shellQuote(command),
    ...(permissionMode
      ? ['--permission-mode', shellQuote(permissionMode)]
      : ['--dangerously-skip-permissions']),
    resumed ? '--resume' : '--session-id',
    shellQuote(sessionId),
    ...(model ? ['--model', shellQuote(model)] : []),
    ...(effort ? ['--effort', shellQuote(effort)] : []),
    ...(tools.length ? ['--tools', shellQuote(tools.join(','))] : []),
    ...addDirectories.flatMap((directory) => ['--add-dir', shellQuote(directory)]),
  ].join(' ');
}

// Drives a queued turn inside the interactive Claude terminal on macOS by typing the
// prompt into the exact owned Terminal.app window and mirroring the session transcript
// back into Relay's Task Activity. The run outcome matches the headless runner exactly:
// { finalResponse, sessionId, reportedSessionId, exitCode }.
export class ClaudeTerminalExecutor {
  constructor({
    command = 'claude',
    sessions,
    resolveTerminal = null,
    inject = defaultInject,
    submit = defaultSubmit,
    relaunch = defaultRelaunch,
    terminateProcess = defaultTerminateProcess,
    isProcessAlive = defaultIsProcessAlive,
    sendCancel = defaultSendCancel,
    openTranscript = defaultOpenTranscript,
    wait = delay,
    now = Date.now,
    readinessTimeoutMs = 15_000,
    processExitTimeoutMs = 10_000,
    relaunchTimeoutMs = 20_000,
    relaunchSettleMs = 250,
    restartPollMs = 250,
    submissionTimeoutMs = 20_000,
    submitNudgeMs = 1_500,
    pollMs = 800,
    idleGraceObservations = 4,
    finalIdleObservations = 2,
    sessionMissingGrace = 3,
    heartbeatMs = 30_000,
    // Legacy name for the safety ceiling below. It once bounded total turn duration; it now
    // bounds continuous inactivity. Kept as the default source for inactivityCeilingMs so any
    // remaining caller keeps configuring the same guard.
    turnCeilingMs = 45 * 60 * 1_000,
    // The watcher fails a turn only after this much time with no observed activity at all:
    // no new transcript records, no busy session status, and no transcript growth. A session
    // that keeps working never fails on elapsed time alone; the user cancels it explicitly.
    inactivityCeilingMs = turnCeilingMs,
    maxPromptBytes = 100_000,
    statRetryAttempts = 3,
    statRetryDelayMs = 100,
  } = {}) {
    this.command = command;
    this.sessions = sessions;
    this.resolveTerminal = resolveTerminal;
    this.inject = inject;
    this.submit = submit;
    this.relaunch = relaunch;
    this.terminateProcess = terminateProcess;
    this.isProcessAlive = isProcessAlive;
    this.sendCancel = sendCancel;
    this.openTranscript = openTranscript;
    this.wait = wait;
    this.now = now;
    this.readinessTimeoutMs = readinessTimeoutMs;
    this.processExitTimeoutMs = processExitTimeoutMs;
    this.relaunchTimeoutMs = relaunchTimeoutMs;
    this.relaunchSettleMs = relaunchSettleMs;
    this.restartPollMs = restartPollMs;
    this.submissionTimeoutMs = submissionTimeoutMs;
    this.submitNudgeMs = submitNudgeMs;
    this.pollMs = pollMs;
    this.idleGraceObservations = idleGraceObservations;
    this.finalIdleObservations = finalIdleObservations;
    this.sessionMissingGrace = sessionMissingGrace;
    this.heartbeatMs = heartbeatMs;
    this.inactivityCeilingMs = inactivityCeilingMs;
    this.maxPromptBytes = maxPromptBytes;
    this.statRetryAttempts = statRetryAttempts;
    this.statRetryDelayMs = statRetryDelayMs;
  }

  async runTurn(task, active, session, terminal, { onEvent, onStderr }) {
    const sessionId = task.thread_id;
    const source = this.openTranscript({ cwd: task.repo_path, sessionId });

    // Observe whether a transcript already exists BEFORE readiness. A freshly launched terminal
    // has none, so its first turn legitimately starts at offset 0; an established (resumed)
    // session has one. This is captured once at task start, decoupled in time from the offset
    // read below, because the same transient stat failure that makes size() return -1 also
    // makes a concurrent existence probe return false. Trusting them together would misread an
    // established session as fresh and replay its history (Issue 14).
    const resumed = this.transcriptPresent(source);

    await this.ensureReady(task, active, onEvent);

    // Pre-flight prompt validation before typing (deterministic, pre-injection).
    const prompt = taskPrompt(task);
    const promptIssue = injectionPromptIssue(prompt, { maxBytes: this.maxPromptBytes });
    if (promptIssue) {
      throw new ClaudeExecutionError(`Relay cannot type this prompt into the terminal: ${promptIssue}`, { retryable: false });
    }

    const settings = terminalExecutionSettings(task);
    let activeTerminal = terminal;
    if (settings.apply) {
      // Model and effort are process launch options in Claude Code. Restart only after proving
      // that the live pid still belongs to this exact window and tty. The same session is then
      // restored in the same tab with the task's selected launch flags.
      const verified = await this.verifyTerminalIdentity(task, active, activeTerminal, { requireIdle: true });
      if (!verified?.session || !verified?.terminal) {
        throw new ClaudeExecutionError(
          `Relay cannot apply the selected Claude model and effort because it could not resolve the exact ${task.thread_name || sessionId} terminal. Nothing was typed.`,
          { retryable: true },
        );
      }
      activeTerminal = await this.relaunchForTask(
        task,
        active,
        verified.session,
        verified.terminal,
        resumed,
        settings,
        onEvent,
      );
    }

    if (active.cancelRequested) {
      throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
    }

    // Re-verify the exact window and tty still belong to the live session's current pid
    // immediately before typing. This also validates the new pid after a settings relaunch.
    const injectionIdentity = await this.verifyTerminalIdentity(task, active, activeTerminal, { requireIdle: true });
    if (injectionIdentity?.terminal) activeTerminal = injectionIdentity.terminal;

    // Establish where this turn's transcript records begin. Computed before announcing the
    // turn so a pre-injection stat failure on a resumed session leaves no dangling started
    // event, and never has to fall back to offset 0 where a stale end_turn could complete the
    // task with an earlier response (Issue 14).
    const injectionOffset = await this.resolveInjectionOffset(task, active, source, resumed);

    onEvent({
      event: {
        type: 'claude/started',
        provider: 'claude',
        sessionId,
        sessionMode: 'terminal',
        model: settings.model || 'session default',
        effort: settings.effort || 'session default',
      },
      message: settings.apply
        ? `Claude is running this turn inside the ${task.thread_name || sessionId} terminal with ${terminalSettingsDescription(settings)}.`
        : `Claude is running this turn inside the ${task.thread_name || sessionId} terminal, using that session's existing model and effort.`,
    });

    const reader = createTranscriptReader(source, injectionOffset);

    try {
      await this.inject(activeTerminal.terminalWindowId, prompt);
    } catch (error) {
      // A do script osascript timeout can fire after Terminal.app already delivered and
      // processed the Apple Event, so the prompt may have been submitted. Never auto-retry
      // (that would run the turn twice); require an explicit manual retry.
      throw new ClaudeExecutionError(
        `Relay could not confirm it typed the prompt into the ${task.thread_name || sessionId} terminal: ${error.message}. The prompt may already be running, so Relay will not retry automatically. Check the terminal before retrying.`,
        { retryable: false },
      );
    }

    return this.watchTurn(task, active, activeTerminal, source, reader, injectionOffset, { onEvent, onStderr });
  }

  async relaunchForTask(task, active, session, terminal, resumed, settings, onEvent) {
    const sessionId = task.thread_id;
    const processId = Number(session.pid);
    if (!Number.isInteger(processId) || processId <= 0) {
      throw new ClaudeExecutionError(
        `Relay could not identify the Claude process in the ${task.thread_name || sessionId} terminal, so it did not change settings or type the prompt.`,
        { retryable: true },
      );
    }

    let alive;
    try {
      alive = await this.isProcessAlive(processId);
    } catch (error) {
      throw new ClaudeExecutionError(
        `Relay could not verify the Claude process in the ${task.thread_name || sessionId} terminal: ${error.message}. Nothing was typed.`,
        { retryable: true },
      );
    }
    if (!alive) {
      throw new ClaudeExecutionError(
        `The Claude process in the ${task.thread_name || sessionId} terminal exited before Relay could apply the selected model and effort. Nothing was typed.`,
        { retryable: true },
      );
    }
    if (active.cancelRequested) {
      throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
    }

    onEvent({
      event: { type: 'claude/progress', provider: 'claude', sessionId },
      message: `Restarting the ${task.thread_name || sessionId} Claude terminal with ${terminalSettingsDescription(settings)} before Relay types the prompt.`,
    });

    try {
      await this.terminateProcess(processId);
    } catch (error) {
      throw new ClaudeExecutionError(
        `Relay could not stop the existing Claude process in the ${task.thread_name || sessionId} terminal to apply the selected model and effort: ${error.message}. Nothing was typed.`,
        { retryable: false },
      );
    }

    const exitDeadline = this.now() + this.processExitTimeoutMs;
    let processExited = false;
    while (this.now() < exitDeadline) {
      try {
        if (!(await this.isProcessAlive(processId))) {
          processExited = true;
          break;
        }
      } catch (error) {
        throw new ClaudeExecutionError(
          `Relay could not confirm the old Claude process exited in the ${task.thread_name || sessionId} terminal: ${error.message}. Nothing was typed.`,
          { retryable: false },
        );
      }
      await this.wait(this.restartPollMs);
    }
    if (!processExited) {
      throw new ClaudeExecutionError(
        `The old Claude process in the ${task.thread_name || sessionId} terminal did not exit, so Relay could not safely apply the selected model and effort. Nothing was typed.`,
        { retryable: false },
      );
    }

    await this.wait(this.relaunchSettleMs);
    const command = claudeTerminalRelaunchCommand({
      command: this.command,
      sessionId,
      resumed,
      model: settings.model,
      effort: settings.effort,
      permissionMode: settings.permissionMode,
      tools: settings.tools,
      addDirectories: settings.addDirectories,
    });
    try {
      await this.relaunch(terminal.terminalWindowId, command);
    } catch (error) {
      throw new ClaudeExecutionError(
        `Relay could not confirm Claude restarted in the ${task.thread_name || sessionId} terminal with the selected model and effort: ${error.message}. The launch command may already have run, so Relay will not send it again or type the prompt. Check the terminal before retrying.`,
        { retryable: false },
      );
    }

    const relaunchDeadline = this.now() + this.relaunchTimeoutMs;
    while (this.now() < relaunchDeadline) {
      let current = null;
      try {
        current = await this.sessions.readConnectedSession(sessionId);
      } catch {
        current = null;
      }
      const newProcessId = Number(current?.pid);
      if (
        current
        && Number.isInteger(newProcessId)
        && newProcessId > 0
        && newProcessId !== processId
        && current.rawStatus !== 'busy'
      ) {
        const sameSession = current.id === sessionId
          && current.source === 'Claude interactive'
          && typeof current.cwd === 'string'
          && resolve(current.cwd) === resolve(task.repo_path);
        if (!sameSession) {
          throw new ClaudeExecutionError(
            `Claude restarted after the settings change, but the new process did not register as the same interactive session in the task workspace. Relay did not type the prompt.`,
            { retryable: false },
          );
        }
        let fresh = null;
        try {
          fresh = await this.resolveTerminal(current);
        } catch {
          fresh = null;
        }
        if (fresh) {
          const moved = fresh.terminalWindowId !== terminal.terminalWindowId
            || (terminal.terminalTty && fresh.terminalTty && fresh.terminalTty !== terminal.terminalTty);
          if (moved) {
            throw new ClaudeExecutionError(
              `Claude restarted for ${task.thread_name || sessionId}, but the session resolved to a different Terminal window or tty. Relay did not type the prompt.`,
              { retryable: false },
            );
          }
          if (
            fresh.runtimeProcessId
            && Number(fresh.runtimeProcessId) !== newProcessId
          ) {
            await this.wait(this.restartPollMs);
            continue;
          }
          onEvent({
            event: { type: 'claude/progress', provider: 'claude', sessionId },
            message: `The ${task.thread_name || sessionId} terminal is ready with ${terminalSettingsDescription(settings)}.`,
          });
          return fresh;
        }
      }
      await this.wait(this.restartPollMs);
    }

    throw new ClaudeExecutionError(
      `Claude did not become ready again in the ${task.thread_name || sessionId} terminal after Relay applied the selected model and effort. Relay did not type the prompt. Check the terminal before retrying.`,
      { retryable: false },
    );
  }

  // Whether a transcript file already exists for this session. Observed once at task start to
  // decide fresh-vs-resumed; see the note at the top of runTurn for why this must not be
  // re-checked concurrently with a negative size() reading.
  transcriptPresent(source) {
    if (typeof source.exists === 'function' && source.exists()) {
      return true;
    }
    return source.size() >= 0;
  }

  // Byte offset where this turn's transcript records begin, read immediately before injecting.
  // A non-negative size is authoritative. A negative size on a fresh session (no transcript at
  // task start) legitimately means offset 0 (Issue 1). A negative size on a resumed session is
  // a transient stat failure: re-stat with a short bounded retry and use the recovered size,
  // because starting at offset 0 would replay the whole transcript and a stale end_turn record
  // could complete this turn with an earlier response. If it stays negative, fail retryably
  // pre-injection (nothing has been typed), so the queue re-runs the turn cleanly (Issue 14).
  async resolveInjectionOffset(task, active, source, resumed) {
    const size = source.size();
    if (size >= 0) {
      return size;
    }
    if (!resumed) {
      return 0;
    }
    for (let attempt = 0; attempt < this.statRetryAttempts; attempt += 1) {
      // Check cancellation each iteration, exactly like ensureReady. Without this, a cancel
      // arriving during the bounded re-stat is ignored, and a stat that stays negative would
      // throw the retryable transcript error below (not a cancelled error), which the queue
      // treats as failed-and-retryable and auto-requeues, re-injecting a cancelled task.
      if (active.cancelRequested) {
        throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
      }
      await this.wait(this.statRetryDelayMs);
      const retry = source.size();
      if (retry >= 0) {
        return retry;
      }
    }
    // A cancel that lands during the FINAL wait above is not seen by the loop-top check, so
    // re-check here before the retryable throw. Otherwise a cancelled task surfaces as the
    // retryable stat error and src/queue.mjs auto-requeues work the user cancelled (Issue 18).
    if (active.cancelRequested) {
      throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
    }
    throw new ClaudeExecutionError(
      `Relay could not read the size of the Claude transcript for ${task.thread_name || task.thread_id} before typing, so it will not risk replaying an earlier response as this turn's result. Nothing was typed. Retry when the terminal is stable.`,
      { retryable: true },
    );
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
    // A cancel that lands during the FINAL poll wait exits the loop via the deadline without
    // reaching the loop-top check, so re-check here before the retryable throw. Otherwise a
    // cancelled task surfaces as the retryable stayed-busy error and src/queue.mjs auto-requeues
    // work the user cancelled (Issue 18).
    if (active.cancelRequested) {
      throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
    }
    throw new ClaudeExecutionError(
      `The ${task.thread_name || sessionId} terminal is present but stayed busy and never became free to accept the prompt. Nothing was typed. Wait for it to finish, then retry.`,
      { retryable: true },
    );
  }

  // Immediately before typing, confirm the resolved window and tty still map to the live
  // session's current pid from a fresh discovery read. macOS recycles tty names, so a
  // window resolved at task start can belong to another session by now.
  async verifyTerminalIdentity(task, active, terminal, { requireIdle = false } = {}) {
    if (typeof this.resolveTerminal !== 'function') {
      return null;
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
    if (requireIdle && current.rawStatus === 'busy') {
      throw new ClaudeExecutionError(
        `The ${task.thread_name || task.thread_id} Claude terminal became busy before Relay could type. Relay did not stop the process or type the prompt. Wait for it to finish, then retry.`,
        { retryable: true },
      );
    }
    let fresh = null;
    let resolutionFailed = false;
    try {
      fresh = await this.resolveTerminal(current);
    } catch {
      resolutionFailed = true;
    }
    if (resolutionFailed || !fresh) {
      // Re-resolution flaked (threw, or returned nothing) rather than proving another session
      // took the window. A native-resolution flake at task start silently falls back to the
      // headless path in the runner; here, inside the executor which has no headless path, we
      // fail retryably so a re-run re-resolves the terminal from scratch (and that re-run
      // itself falls back to headless if resolution flakes again). Both paths recover; the
      // message must not imply a recycled-window mismatch, which this flake has not proven.
      throw new ClaudeExecutionError(
        `Relay could not re-verify the ${task.thread_name || task.thread_id} terminal before typing, so it did not type anything. Retry to re-resolve the exact terminal.`,
        { retryable: true },
      );
    }
    const mismatch = fresh.terminalWindowId !== terminal.terminalWindowId
      || (terminal.terminalTty && fresh.terminalTty && fresh.terminalTty !== terminal.terminalTty)
      || (terminal.runtimeProcessId && fresh.runtimeProcessId && fresh.runtimeProcessId !== terminal.runtimeProcessId);
    if (mismatch) {
      throw new ClaudeExecutionError(
        `The ${task.thread_name || task.thread_id} terminal identity changed just before Relay could type. A Terminal window or tty was reused by another session, so Relay did not type anything. Retry to re-resolve the exact terminal.`,
        { retryable: true },
      );
    }
    return { session: current, terminal: fresh };
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
    let awaitingInput = false;
    let missing = 0;
    let submitNudged = false;
    const start = this.now();
    let lastHeartbeat = start;
    // The safety ceiling measures continuous inactivity, not total turn duration. A team of
    // sub-agents can legitimately work for hours, and task 320 proved that a wall-clock ceiling
    // fails such a turn while the session is still visibly busy. Every live signal below
    // (transcript records, busy status, transcript growth) refreshes this timestamp.
    let lastActivity = start;
    let lastObservedSize = injectionOffset;

    const drain = () => {
      let consumed = false;
      for (const record of reader.poll()) {
        consumed = true;
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
      if (consumed) lastActivity = this.now();
      return consumed;
    };

    for (;;) {
      if (active.cancelRequested) {
        await this.cancelTurn(terminal, sessionId, onEvent);
        throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
      }

      if (this.now() - lastActivity > this.inactivityCeilingMs) {
        // Only a stalled turn reaches this. An unanswered interactive prompt accrues inactivity
        // exactly like a dead one, so an abandoned question still releases the task and session
        // within the same bound. Failures at or after injection are never auto-retried: the
        // prompt already ran.
        throw new ClaudeExecutionError(
          `The Claude terminal turn in ${task.thread_name || sessionId} showed no activity for ${inactivityLimitLabel(this.inactivityCeilingMs)}, so Relay stopped watching it. Check the terminal; retry manually if needed.`,
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
      if (size >= 0) {
        // A negative size is an unreadable stat, not evidence of a stalled turn, so it never
        // moves the baseline. Growth is activity even before those bytes parse into records.
        if (size > lastObservedSize) lastActivity = this.now();
        lastObservedSize = size;
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
      if (busy) {
        started = true;
        // The single most reliable long-run signal. A sub-agent fleet can run for many minutes
        // without writing a parent transcript record, and this is what keeps that turn alive.
        lastActivity = this.now();
      }
      if (busy && awaitingInput) {
        awaitingInput = false;
        onEvent({
          event: { type: 'claude/input-resumed', provider: 'claude', sessionId },
          message: `Claude received terminal input and resumed the turn in ${task.thread_name || sessionId}.`,
        });
      }

      if (!started && !submitNudged && this.now() - start >= this.submitNudgeMs) {
        // Claude's large-paste widget can keep bracketed text in the composer even though
        // Terminal accepted the original do script Apple Event. Before sending a separate
        // Return, re-verify the exact live session/window/tty and then check both transcript
        // growth and busy state again. This closes the race where the first Return was merely
        // slow: if any evidence of a turn appears, never send the second action.
        try {
          await this.verifyTerminalIdentity(task, active, terminal);
        } catch (error) {
          if (error.cancelled) {
            await this.cancelTurn(terminal, sessionId, onEvent);
            throw error;
          }
          throw new ClaudeExecutionError(
            `Relay pasted the prompt into the ${task.thread_name || sessionId} terminal, but could not safely re-verify that exact terminal before sending an extra submit action. Relay did not send the extra action and will not retry automatically because the original submit may have started. Check or clear the terminal before retrying. ${error.message}`,
            { retryable: false },
          );
        }

        drain();
        if (started || reader.offset > injectionOffset || source.size() > injectionOffset) {
          started = true;
          continue;
        }

        let latest;
        try {
          latest = await this.sessions.readConnectedSession(sessionId);
        } catch {
          latest = null;
        }
        if (!latest) {
          throw new ClaudeExecutionError(
            `Relay pasted the prompt into the ${task.thread_name || sessionId} terminal, but the session disappeared before Relay could safely send an extra submit action. Relay did not send the extra action and will not retry automatically because the original submit may have started. Check or clear the terminal before retrying.`,
            { retryable: false },
          );
        }
        if (latest.rawStatus === 'busy') {
          started = true;
          continue;
        }
        if (active.cancelRequested) {
          await this.cancelTurn(terminal, sessionId, onEvent);
          throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
        }

        try {
          await this.submit(terminal.terminalWindowId);
        } catch (error) {
          throw new ClaudeExecutionError(
            `Relay pasted the prompt into the ${task.thread_name || sessionId} terminal but could not confirm the separate submit action: ${error.message}. The prompt may now be running, so Relay will not retry automatically. Check the terminal before retrying.`,
            { retryable: false },
          );
        }
        submitNudged = true;
        onEvent({
          event: { type: 'claude/progress', provider: 'claude', sessionId },
          message: `Relay saw no evidence that the pasted turn had started in the ${task.thread_name || sessionId} terminal, so it sent one separate submit action.`,
        });
      }

      if (!started && this.now() - start > this.submissionTimeoutMs) {
        // Paste and the guarded submit action both reported success but nothing ran. Do NOT
        // fall back to headless: the text may still be sitting in the composer and a second
        // execution would duplicate it.
        throw new ClaudeExecutionError(
          submitNudged
            ? `Relay pasted the prompt into the ${task.thread_name || sessionId} terminal and sent a separate submit action, but the Claude session still never started the turn. The terminal may be holding unsubmitted text. Open it, submit or clear the prompt, then retry.`
            : `Relay sent the prompt to the ${task.thread_name || sessionId} terminal but the Claude session never started the turn. The terminal may be holding unsubmitted text. Open it, submit or clear the prompt, then retry.`,
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
        if (!awaitingInput && idleObservations >= this.idleGraceObservations) {
          // Interactive Claude reports idle while an AskUserQuestion selector is open. The
          // transcript may not flush that tool-use record until after the user answers, so
          // idle without a final record is a pause, not a terminal outcome. Keep ownership of
          // the task and session until activity resumes, a final record arrives, the terminal
          // closes, cancellation is requested, or the pause itself accrues a full inactivity
          // window and reaches the safety ceiling.
          awaitingInput = true;
          onEvent({
            event: { type: 'claude/input-required', provider: 'claude', sessionId },
            message: `Claude paused in the ${task.thread_name || sessionId} terminal and may be waiting for your input. Check that terminal to continue; Relay will keep this task running.`,
          });
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
