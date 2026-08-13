import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArtifactStore, isPathInside } from './artifacts.mjs';
import {
  decodeImageAttachments,
  MAX_IMAGE_ATTACHMENTS,
  MAX_TASK_REQUEST_BYTES,
  MAX_TOTAL_IMAGE_BYTES,
} from './attachments.mjs';
import { ClaudeBinaryResolver } from './claude-binary.mjs';
import { ClaudeExecutionRunner, sameWorkspacePath } from './claude-execution-runner.mjs';
import { ClaudeHookBridge } from './claude-hook-bridge.mjs';
import { ClaudeRuntimeStatus, isConfidentlyUnavailable } from './claude-runtime-status.mjs';
import { ClaudeRunner } from './claude-runner.mjs';
import { ClaudeSessionRegistry } from './claude-session-registry.mjs';
import { CodexAppServer } from './codex-app-server.mjs';
import { readCodexRuntimeStatus } from './codex-runtime-status.mjs';
import { RelayDatabase } from './database.mjs';
import { DiagnosticLog } from './diagnostics.mjs';
import { normalizeDesktopUpdateState } from './desktop-update-status.mjs';
import {
  DisposableTerminalPool,
  disposableTerminalRequirements,
  inspectCodexConversation,
} from './disposable-terminal-pool.mjs';
import { LaunchOwnershipRegistry } from './launch-ownership-registry.mjs';
import { CLAUDE_MODELS, validateExecutionSettings } from './model-catalog.mjs';
import { PlanCouncilRunner } from './plan-council-runner.mjs';
import { validatePlanCouncilConfig } from './plan-council-config.mjs';
import {
  buildPlanExecutionPrompt,
  planExecutionTitle,
  validatePlanExecution,
} from './plan-execution.mjs';
import { buildParallelCodexPrompt } from './parallel-batch.mjs';
import {
  breakdownInProgress,
  breakdownUpdateForDeletedTask,
  breakdownUpdateForTask,
  buildBreakdownPrompt,
  buildRefinementPrompt,
  MAX_BREAKDOWN_PROPOSALS,
  sanitizeProposalGraph,
} from './plan-breakdown.mjs';
import { PlanRunCoordinator } from './plan-run.mjs';
import {
  ClaudeUsageProbe,
  normalizeCodexUsage,
  ProviderUsageMonitor,
} from './provider-usage.mjs';
import {
  ProjectLauncher,
  claudeRelayCommand,
  cmdQuote,
  normalizeTerminalLayout,
  shellQuote,
  validateProjectPath,
} from './project-launcher.mjs';
import { isManualSessionTask, TaskQueue } from './queue.mjs';
import {
  resolveSubmissionThread,
  SESSION_NEVER_SEEN,
  submissionSessionProvider,
} from './session-resolution.mjs';
import { buildSessionFollowUp } from './task-continuation.mjs';
import { searchTaskDocuments } from './task-search.mjs';
import { TerminalCloseCoordinator } from './terminal-close-coordinator.mjs';
import { retainedSessionTaskForThread } from './terminal-control.mjs';
import { TerminalLaunchCoordinator } from './terminal-launch-coordinator.mjs';
import { TerminalRuntimeResolver } from './terminal-runtime-resolver.mjs';
import { taskTitleFromInput, titleFromPrompt } from './task-title.mjs';
import { normalizeUiPreferences } from './ui-preferences.mjs';
import { TurboPlanCouncilReviewer } from './turbo-plan-council.mjs';
import { validateTurboCouncilConfig } from './turbo-council-config.mjs';
import { TurboRunner } from './turbo-runner.mjs';
import { RelayRunner } from './relay-runner.mjs';
import { AgentUpdateCache } from './running-task-feed.mjs';
import {
  DEFAULT_RELAY_HOST,
  relayConfigDirectoryFromArgs,
  relayCodexPortFromArgs,
  relayPortFromArgs,
  relayServerEndpoint,
} from './server-options.mjs';
import {
  buildStandupPrompt,
  MAX_STANDUP_SOURCE_TASKS,
  selectStandupTasks,
  StandupGenerationError,
  StandupGenerator,
  validateStandupWindow,
} from './standup-generator.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_ROOT = join(APP_ROOT, 'public');
const dataDirectoryIndex = process.argv.indexOf('--relay-data-dir');
const DATA_ROOT = dataDirectoryIndex >= 0 && process.argv[dataDirectoryIndex + 1]
  ? resolve(process.argv[dataDirectoryIndex + 1])
  : join(APP_ROOT, '.data');
const CONFIG_ROOT = relayConfigDirectoryFromArgs();
const HOST = DEFAULT_RELAY_HOST;
const PORT = relayPortFromArgs();
const CODEX_PORT = relayCodexPortFromArgs();
const IS_DESKTOP = process.argv.includes('--relay-desktop');
const PLAN_COUNCIL_TERMINAL_EXECUTION = process.platform === 'darwin';
const CLAUDE_TASK_STEERING = PLAN_COUNCIL_TERMINAL_EXECUTION;
// The connection helper hands the user a command to paste into their own terminal, so it has to
// be quoted for the shell that will read it. cmd.exe gives single quotes no meaning at all, and
// the Claude binary now resolves to an absolute Windows path such as
// C:\Users\me\AppData\Roaming\npm\claude.cmd, which splits at its spaces without real quoting.
// Every other platform keeps shellQuote by reference, so its output cannot drift.
const LAUNCH_COMMAND_QUOTE = process.platform === 'win32' ? cmdQuote : shellQuote;
const MAX_CLAUDE_HOOK_BYTES = 10 * 1024 * 1024;
let relayEndpointUrl = null;

const diagnostics = new DiagnosticLog(join(DATA_ROOT, 'relay-diagnostics.jsonl'));
const diagnostic = (event, details) => diagnostics.write(event, details);
const claudeHookBridge = new ClaudeHookBridge({
  endpoint: () => relayEndpointUrl,
  diagnostic,
});
const database = new RelayDatabase(join(DATA_ROOT, 'relay.sqlite'), {
  projectConfigPath: join(CONFIG_ROOT, 'relay-config.sqlite'),
});
// The desktop app and a standalone `node src/server.mjs` can run at the same time and both
// discover the same live Codex and Claude sessions. Launch ownership used to be per-process and
// in memory only, so either backend could adopt and then close a terminal the other one owned.
// The shared configuration database is the only thing both processes already hold open.
const launchOwnership = new LaunchOwnershipRegistry({
  database: database.projectConfig.database,
  diagnostic,
  role: IS_DESKTOP ? 'desktop' : 'localhost',
  dataRoot: DATA_ROOT,
});
const artifacts = new ArtifactStore(join(DATA_ROOT, 'tasks'));
const codexAppServer = new CodexAppServer({
  diagnostic,
  publicEndpoint: `ws://${HOST}:${CODEX_PORT}`,
});
// Pin the exact claude binary once at startup so discovery and execution do not
// depend on the launching process PATH order (Finder or dock versus terminal).
const claudeBinaryResolver = new ClaudeBinaryResolver({ diagnostic });
const claudeBinaryPath = await claudeBinaryResolver.resolve();
const claudeRunner = new ClaudeRunner({ command: claudeBinaryPath });
const standupGenerator = new StandupGenerator({
  claudeCommand: claudeBinaryPath,
  diagnostic,
});
const claudeSessions = new ClaudeSessionRegistry({
  resolveCommand: (options) => claudeBinaryResolver.resolve(options),
});
// Resolve the exact owned single-tab Terminal.app window for a live Claude session so a
// queued turn can execute inside that interactive terminal on macOS. This reuses the same
// runtime identity plumbing as the terminal Close feature: ownership is gated by the
// launcher's tracked terminals, and the window id and tty are re-verified fresh per turn.
const terminalRuntimeResolver = new TerminalRuntimeResolver({ diagnostic });
const resolveClaudeTerminal = async (session) => {
  if (!session || session.provider !== 'claude' || !session.id) return null;
  const owned = projectLauncher.terminalForThread(session.id);
  if (!owned || owned.provider !== 'claude') return null;
  const [native] = await terminalRuntimeResolver.resolve([{
    id: session.id,
    provider: 'claude',
    cwd: session.cwd,
    pid: session.pid,
    source: session.source,
  }]);
  if (!native || native.threadId !== session.id) return null;
  if (!projectLauncher.refreshTerminalRuntimeIdentity(session.id, native)) return null;
  return {
    terminalWindowId: native.terminalWindowId,
    terminalTty: native.terminalTty,
    runtimeProcessId: native.runtimeProcessId,
    // Read AFTER the identity refresh above so the pid latch is current. Non-null only when this
    // process launched this terminal itself with explicit task settings and the same provider
    // process is still live; the executor uses it to skip an unnecessary restart.
    launchSettings: projectLauncher.provenClaudeLaunchSettings(session.id),
  };
};
const claudeExecution = new ClaudeExecutionRunner({
  sessions: claudeSessions,
  command: claudeBinaryPath,
  platform: process.platform,
  resolveTerminal: resolveClaudeTerminal,
  requestAttention: ({ thread }) => projectLauncher.requestTerminalAttention(thread),
  hookBridge: claudeHookBridge,
  diagnostic,
});
const planCouncil = new PlanCouncilRunner({
  claude: PLAN_COUNCIL_TERMINAL_EXECUTION ? claudeExecution : claudeRunner,
  codex: codexAppServer,
  artifacts,
  terminalExecution: PLAN_COUNCIL_TERMINAL_EXECUTION,
});
const turboCouncilReviewer = new TurboPlanCouncilReviewer({
  claude: PLAN_COUNCIL_TERMINAL_EXECUTION ? claudeExecution : claudeRunner,
  terminalExecution: PLAN_COUNCIL_TERMINAL_EXECUTION,
});
const turboRunner = new TurboRunner({ codex: codexAppServer, artifacts, councilReviewer: turboCouncilReviewer });
const runner = new RelayRunner({
  codex: codexAppServer,
  claude: claudeExecution,
  planCouncil,
  turbo: turboRunner,
});
const closingTerminalIds = new Set();

function sameWorkspace(left, right) {
  if (!left || !right) return false;
  return resolve(left) === resolve(right);
}

// Candidate sessions for dispatch-time idle routing: same provider, same workspace, live
// right now. Routing never crosses a workspace, so a routed task keeps its repo_path and
// stays in the same project queue.
//
// Both registries deliberately swallow discovery failures and serve last-known-good, which is
// exactly what makes task-add reliable. That same behaviour is wrong here: routing decides
// where to send a task based on which sessions are IDLE, and a cached `status` from before the
// outage is not evidence of anything. So when the forced refresh came back stale, report no
// candidates. The queue then leaves the task on the session the user selected, which is the
// documented behaviour and would otherwise be unreachable in production.
async function idleSessionCandidates(task) {
  if (!['codex', 'claude'].includes(task.provider)) return [];
  if (task.provider === 'claude') {
    const sessions = await claudeSessions.listSessions({ refresh: true });
    if (claudeSessions.stale) return [];
    return sessions.filter((session) => sameWorkspace(session.cwd, task.repo_path));
  }
  const threads = await codexAppServer.listConnectedThreads({ refresh: true });
  if (codexAppServer.threadsStale) return [];
  return threads.filter((thread) => sameWorkspace(thread.cwd, task.repo_path));
}

const projectLauncher = new ProjectLauncher({
  diagnostic,
  launchRegistry: launchOwnership,
  claudeBinary: claudeBinaryPath,
  ensureCodexReady: () => codexAppServer.start(),
  reserveCodexLaunch: (path, launchId) => codexAppServer.reserveLaunchClient(path, launchId),
  codexClientForThread: (threadId) => codexAppServer.runtimeClientForThread(threadId),
  claudeSettingsForSession: (sessionId) => claudeHookBridge.settingsForSession(sessionId),
});
codexAppServer.on('userInputRequested', ({ threadId, method }) => {
  void (async () => {
    const thread = codexAppServer.knownThread(threadId)
      || await codexAppServer.readConnectedThread(threadId);
    if (!thread) {
      diagnostic('terminal.attention.skipped', {
        threadId,
        provider: 'codex',
        reason: 'disconnected-thread',
        requestMethod: method,
      });
      return;
    }
    await projectLauncher.requestTerminalAttention(thread);
  })().catch((error) => {
    diagnostic('terminal.attention.failed', {
      threadId,
      provider: 'codex',
      requestMethod: method,
      error: error.message,
    });
  });
});
const terminalLaunchCoordinator = new TerminalLaunchCoordinator({
  launcher: projectLauncher,
  diagnostic,
  threadIdForLaunch: (launchId) => codexAppServer.threadIdForLaunch(launchId),
  listSessions: (provider) => provider === 'codex'
    ? codexAppServer.listConnectedThreads()
    : claudeSessions.listSessions({ refresh: true }),
});
const disposableTerminalPool = new DisposableTerminalPool({
  database,
  artifacts,
  coordinator: terminalLaunchCoordinator,
  launcher: projectLauncher,
  diagnostic,
  codexConversationState: (threadId) => inspectCodexConversation(threadId, {
    codexHome: codexAppServer.status().codexHome || undefined,
  }),
});
const queue = new TaskQueue({
  database,
  artifacts,
  runner,
  isThreadAvailable: (threadId) => !closingTerminalIds.has(threadId),
  listIdleSessions: idleSessionCandidates,
  terminalPool: disposableTerminalPool,
});

async function steerRunningTask(task, prompt, attachments, { flushComposer = false } = {}) {
  const storedAttachments = queue.stageTaskAttachments(task.id, attachments);
  let steered;
  try {
    if (task.provider === 'claude') {
      if (!CLAUDE_TASK_STEERING) {
        throw new Error('Claude live updates require an interactive macOS terminal. Your message was not queued.');
      }
      steered = await claudeExecution.steer(task.id, prompt, storedAttachments, {
        flushComposer: flushComposer === true,
      });
    } else {
      steered = await codexAppServer.steer(task.id, prompt, storedAttachments);
    }
  } catch (error) {
    if (error.deliveryUncertain === true) {
      // The terminal Apple Event may have landed even when its acknowledgement did not. Keep
      // image files available to a possibly delivered Claude message instead of deleting paths
      // that the active turn may still read.
      try {
        queue.commitTaskAttachments(task.id, storedAttachments, 'Unconfirmed live-update reference images');
      } catch (recordError) {
        diagnostic('api.task.steer.uncertain_attachment_commit_failed', {
          taskId: task.id,
          error: recordError.message,
        });
      }
      try {
        const event = {
          type: 'claude/steer-uncertain',
          provider: 'claude',
          deliveryUncertain: true,
        };
        artifacts.appendRawEvent(task.id, event);
        database.addEvent(task.id, 'claude', error.message, event);
        queue.changed(task.id);
      } catch (recordError) {
        diagnostic('api.task.steer.uncertain_event_failed', {
          taskId: task.id,
          error: recordError.message,
        });
      }
    } else {
      try {
        queue.discardTaskAttachments(task.id, storedAttachments);
      } catch (discardError) {
        diagnostic('api.task.steer.attachment_discard_failed', {
          taskId: task.id,
          error: discardError.message,
        });
      }
    }
    throw error;
  }
  try {
    queue.commitTaskAttachments(task.id, storedAttachments);
  } catch (error) {
    // Provider delivery is already exact and durable. Preserve the success response so a local
    // documentation failure cannot encourage the user to send the same message twice.
    diagnostic('api.task.steer.attachment_commit_failed', {
      taskId: task.id,
      provider: task.provider,
      error: error.message,
    });
  }
  diagnostic('api.task.steered', {
    ...steered,
    provider: task.provider,
  });
  return steered;
}
// Planner v2 plan runs. A reconciler over the same queue, never a second scheduler.
const planRuns = new PlanRunCoordinator({ database, queue, diagnostic });
const terminalCloseCoordinator = new TerminalCloseCoordinator({
  launcher: projectLauncher,
  listTasks: terminalControlTasks,
  closingThreadIds: closingTerminalIds,
  readSession: (provider, threadId) => provider === 'codex'
    ? codexAppServer.readConnectedThread(threadId)
    : claudeSessions.readConnectedSession(threadId),
  onReleased: () => queue.schedule(),
});
const sseClients = new Set();
let desktopUpdateState = normalizeDesktopUpdateState({ status: 'unsupported' });
const agentUpdates = new AgentUpdateCache({
  latestEventId: (taskId) => database.latestEventId(taskId),
  listEventsSince: (taskId, sinceId, limit) => database.listEventsSince(taskId, sinceId, limit),
});

function terminalControlTasks() {
  const pendingRetryIds = queue.pendingRetryTaskIds();
  return database.listTasks().map((task) => (
    pendingRetryIds.has(task.id) ? { ...task, status: 'retrying' } : task
  ));
}

const CODEX_STATUS_REFRESH_MS = 30_000;

// Both provider probes are asynchronous and bounded. They used to be execFileSync, which
// blocked the whole event loop and therefore delayed every request including POST /api/tasks.
// Codex status used to be captured once at module load and never re-read, so a transient
// probe failure at boot disabled Codex until CC Relay was restarted. It now refreshes in the
// background while request handlers only ever read this cached value.
let runtimeStatus = { available: false, authenticated: false, version: null, pending: true };
let codexStatusPending = null;
let codexStatusTimer = null;
function refreshCodexStatus() {
  if (codexStatusPending) return codexStatusPending;
  codexStatusPending = readCodexRuntimeStatus()
    .then((status) => {
      runtimeStatus = status;
      return status;
    })
    .finally(() => {
      codexStatusPending = null;
    });
  return codexStatusPending;
}

function activateCodexRuntime(status) {
  if (!status.available || !status.authenticated) return Promise.resolve(false);
  return codexAppServer.start()
    .then(() => codexAppServer.listModels())
    .then(() => true)
    .catch((error) => {
      diagnostic('appserver.models.prewarm.failed', { error: error.message });
      return false;
    });
}

const claudeRuntime = new ClaudeRuntimeStatus({ command: claudeBinaryPath });
// Cache read only. Never spawns, never blocks, so it is safe on any request path.
const currentClaudeStatus = () => claudeRuntime.current();
const claudeUsageProbe = new ClaudeUsageProbe({
  command: claudeBinaryPath,
  cwd: DATA_ROOT,
});
const providerUsage = new ProviderUsageMonitor({
  readClaude: async () => {
    const status = await claudeRuntime.refresh();
    if (!providerIsReady(status)) throw new Error('Claude usage needs an authenticated CLI.');
    try {
      return await claudeUsageProbe.read();
    } catch (error) {
      diagnostic('provider.usage.claude.failed', { code: error.code, error: error.message });
      throw error;
    }
  },
  readCodex: async () => {
    const status = await refreshCodexStatus();
    if (!providerIsReady(status)) throw new Error('Codex usage needs an authenticated CLI.');
    try {
      return normalizeCodexUsage(await codexAppServer.readRateLimits());
    } catch (error) {
      diagnostic('provider.usage.codex.failed', { error: error.message });
      throw error;
    }
  },
  cancelClaude: () => claudeUsageProbe.cancel(),
});

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function sendError(response, statusCode, message, extra = {}) {
  sendJson(response, statusCode, { error: message, ...extra });
}

async function readJson(request, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  const contentLength = Number(request.headers['content-length'] || 0);
  if (contentLength > maxBytes) {
    throw new Error('Request body is too large. Reduce the attached images and try again.');
  }
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new Error('Request body is too large. Reduce the attached images and try again.');
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function taskIdFromPath(pathname) {
  const match = pathname.match(/^\/api\/tasks\/(\d+)(?:\/|$)/);
  return match ? Number(match[1]) : null;
}

function validateInstanceLimit(value, provider) {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 8) {
    throw new Error(`${provider} max instances must be a whole number from 1 to 8.`);
  }
  return limit;
}

function validateProjectColor(value) {
  if (value === null || value === '') return null;
  const color = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^#[\da-f]{6}$/.test(color)) {
    throw new Error('Project color must be a six-digit hex color.');
  }
  return color;
}

function validateTaskTerminalLayout(value) {
  if (!value || typeof value !== 'object') return null;
  const layout = normalizeTerminalLayout(value);
  return {
    ...(layout || { enabled: false }),
    background: value.background === true,
  };
}

function validateProjectTerminalLayout(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('Terminal window layout settings are required.');
  }
  if (typeof value.enabled !== 'boolean' || typeof value.background !== 'boolean') {
    throw new Error('Terminal layout and minimized launch choices must be true or false.');
  }
  const grid = normalizeTerminalLayout({ ...value, enabled: true });
  return {
    ...grid,
    enabled: value.enabled,
    background: value.background,
  };
}

const MAX_PLAN_NAME = 200;
const MAX_PLAN_CONTENT = 100_000;
const MAX_BREAKDOWN_GUIDANCE = 8_000;
const MAX_PROPOSAL_TITLE = 300;
const MAX_PROPOSAL_PROMPT = 12_000;

function validatePlanName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw new Error('A plan name is required.');
  if (name.length > MAX_PLAN_NAME) throw new Error(`Plan name must be ${MAX_PLAN_NAME} characters or fewer.`);
  return name;
}

function validatePlanContent(value) {
  const content = typeof value === 'string' ? value : '';
  if (content.length > MAX_PLAN_CONTENT) {
    throw new Error(`Plan content must be ${MAX_PLAN_CONTENT.toLocaleString('en-US')} characters or fewer.`);
  }
  return content;
}

// Normalize a client-supplied proposal list into stored {id, title, prompt, dependsOn}
// rows. Every proposal keeps a non-empty prompt; a blank title falls back to the prompt.
//
// The dependency graph is re-sanitized on every edit: duplicate ids are regenerated first
// (Finding 25), then references to ids that no longer exist are pruned, then any cycle the
// edit introduced is broken. Removing a step in the review UI is exactly what leaves a
// dangling reference behind, so this runs on the ordinary edit path, not only on parse.
function validateProposals(input) {
  if (!Array.isArray(input)) throw new Error('Proposals must be a list.');
  if (input.length > MAX_BREAKDOWN_PROPOSALS) {
    throw new Error(`A breakdown can hold at most ${MAX_BREAKDOWN_PROPOSALS} proposals.`);
  }
  const mapped = input.map((item, index) => {
    const prompt = typeof item?.prompt === 'string' ? item.prompt.trim() : '';
    if (!prompt) throw new Error(`Proposal ${index + 1} needs a task prompt.`);
    if (prompt.length > MAX_PROPOSAL_PROMPT) {
      throw new Error(`Proposal ${index + 1} is too long.`);
    }
    const rawTitle = typeof item?.title === 'string' ? item.title.trim() : '';
    const title = (rawTitle || titleFromPrompt(prompt)).slice(0, MAX_PROPOSAL_TITLE);
    const id = typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : randomUUID();
    const dependsOn = Array.isArray(item?.dependsOn) ? item.dependsOn : [];
    return { id, title, prompt, dependsOn };
  });
  return sanitizeProposalGraph(mapped);
}

// Treat a breakdown as in progress when its row is pending/running or its linked
// task is queued, running, or scheduled for an automatic retry (Finding 23).
function planBreakdownInProgress(breakdown) {
  if (!breakdown) return false;
  const retryScheduled = breakdown.task_id != null && queue.pendingRetryTaskIds().has(breakdown.task_id);
  const linkedTask = breakdown.task_id != null ? database.getTask(breakdown.task_id) : null;
  return breakdownInProgress(breakdown, { retryScheduled, taskStatus: linkedTask?.status || null });
}

// Both breakdown routes validate, then await the request body and the live session before
// they write anything, so two overlapping submissions can clear one early check and still
// both create a breakdown. This runs again synchronously immediately before the create, next
// to the write it protects, so the duplicate-breakdown guard defends itself.
function requireNoBreakdownInProgress(planId) {
  if (planBreakdownInProgress(database.latestPlanBreakdown(planId))) {
    throw Object.assign(
      new Error('This plan already has a breakdown in progress. Wait for it to finish or cancel it.'),
      { statusCode: 409 },
    );
  }
}

function breakdownSummary(breakdown) {
  if (!breakdown) return null;
  return {
    id: breakdown.id,
    status: breakdown.status,
    parsed: breakdown.parsed,
    proposalCount: Array.isArray(breakdown.proposals) ? breakdown.proposals.length : 0,
    attempt: database.breakdownAttempt(breakdown.plan_id, breakdown.id),
    updatedAt: breakdown.updated_at,
  };
}

// Refinement keeps every prior attempt, so each breakdown carries its 1-based ordinal.
function withBreakdownAttempt(breakdown) {
  if (!breakdown) return null;
  return { ...breakdown, attempt: database.breakdownAttempt(breakdown.plan_id, breakdown.id) };
}

function planWithBreakdown(plan) {
  if (!plan) return null;
  return {
    ...plan,
    breakdown: withBreakdownAttempt(database.latestPlanBreakdown(plan.id)),
    run: planRuns.view(plan.id),
  };
}

// The ids the user is currently reviewing. A refinement attempt hands them to the model
// and asks for them back unchanged, so a surviving step keeps its identity (and the
// user's selection) across attempts.
function knownProposalIds(breakdown) {
  return new Set((breakdown?.proposals || []).map((proposal) => proposal.id).filter(Boolean));
}

// See src/session-resolution.mjs for the three-tier policy this binds to the live registries.
function sessionResolutionDeps(sessionProvider, threadId) {
  const usesCodexSession = sessionProvider !== 'claude';
  return {
    findSession: (id) => (usesCodexSession
      ? codexAppServer.findConnectedThread(id)
      : claudeSessions.findSession(id)),
    knownSession: (id) => (usesCodexSession
      ? codexAppServer.knownThread(id)
      : claudeSessions.knownSession(id)),
    latestTaskForThread: (id) => database.latestTaskForThread(id),
    onDiscoveryError: (error) => diagnostic('api.task.enqueue.discovery_failed', {
      provider: sessionProvider,
      threadId,
      error: error.message,
    }),
  };
}

async function resolvePlanSession(provider, threadId) {
  return provider === 'claude'
    ? claudeSessions.readConnectedSession(threadId)
    : codexAppServer.readConnectedThread(threadId);
}

// Every Planner route that sends work to a session validates the same three things: the
// session is live now, it is open in the plan's own workspace, and Claude is usable when
// Claude was chosen. Plans are resolved by id without a project cross-check (Finding 24),
// so this workspace check is what keeps a plan's work inside its own project.
async function requirePlanSession(plan, provider, threadId) {
  if (!threadId) {
    throw new Error('Choose a live Codex or Claude session in this project.');
  }
  const thread = await resolvePlanSession(provider, threadId);
  if (!thread) {
    throw new Error(provider === 'claude'
      ? 'That Claude Code session is no longer open. Refresh the session list.'
      : 'That terminal is not connected to CC Relay\'s shared Codex server. Refresh the session list.');
  }
  if (resolve(thread.cwd) !== resolve(plan.repo_path)) {
    throw new Error('The selected session must be open in the same project as the plan.');
  }
  if (provider === 'claude') requireClaudeReady();
  return thread;
}

async function resolvePlannerTaskSession(plan, provider, body) {
  if (body.terminalLifecycle === 'disposable') {
    const projectPath = validateProjectPath(body.projectPath).path;
    if (resolve(projectPath) !== resolve(plan.repo_path)) {
      throw new Error('The automatic terminal must use the same project as the plan.');
    }
    if (!database.getProjectByPath(projectPath)) {
      throw new Error('Pin this plan project in CC Relay before running automatic work.');
    }
    if (provider === 'claude') requireClaudeReady('Claude Planner execution');
    return {
      disposable: true,
      terminalLifecycle: 'disposable',
      keepTerminalOpen: body.keepTerminalOpen === true,
      terminalLayout: validateTaskTerminalLayout(body.terminalLayout),
      thread: {
        id: null,
        provider,
        cwd: projectPath,
        title: `Automatic ${provider === 'claude' ? 'Claude' : 'Codex'} instance`,
        source: 'CC Relay managed terminal pool',
      },
      sessionId: `automatic:${provider}`,
    };
  }
  const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
  const thread = await requirePlanSession(plan, provider, threadId);
  return {
    disposable: false,
    terminalLifecycle: 'persistent',
    keepTerminalOpen: false,
    terminalLayout: null,
    thread,
    sessionId: thread.id,
  };
}

function planProvider(value, fallback = 'codex') {
  if (value === 'claude') return 'claude';
  if (value === 'codex') return 'codex';
  return fallback === 'claude' ? 'claude' : 'codex';
}

// Adding work must never fail because a background probe has not finished yet or just
// errored. Only a completed probe that actually reported a signed-out CLI blocks the add.
// Every other case is accepted and, if Claude really is unusable, the task fails at dispatch
// with a task-level message instead of losing the user's prompt at submission time.
function requireClaudeReady(action = 'Claude execution') {
  const claudeRuntimeStatus = currentClaudeStatus();
  // A stale-cache read is also a good moment to kick the background refresh.
  void claudeRuntime.refresh();
  if (isConfidentlyUnavailable(claudeRuntimeStatus)) {
    throw new Error(`${action} needs a signed-in Claude Code CLI. Run \`claude auth login\`; CC Relay will detect it automatically.`);
  }
  return claudeRuntimeStatus;
}

function providerIsReady(status) {
  return status?.available === true && status?.authenticated === true;
}

async function standupProviderAvailability(preferredProvider) {
  let codexStatus = runtimeStatus;
  let claudeStatus = currentClaudeStatus();
  if (preferredProvider === 'claude' && !providerIsReady(claudeStatus)) {
    claudeStatus = await claudeRuntime.refresh({ force: true });
  } else if (preferredProvider === 'codex' && !providerIsReady(codexStatus)) {
    codexStatus = await refreshCodexStatus();
  }
  if (!providerIsReady(codexStatus) && !providerIsReady(claudeStatus)) {
    [codexStatus, claudeStatus] = await Promise.all([
      refreshCodexStatus(),
      claudeRuntime.refresh({ force: true }),
    ]);
  }
  return {
    codex: providerIsReady(codexStatus),
    claude: providerIsReady(claudeStatus),
  };
}

function standupRecord(task) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    provider: task.provider,
    mode: task.mode,
    finishedAt: task.finished_at || task.created_at,
    prompts: database.listTaskPrompts(task.id),
    responses: database.listTaskResponses(task.id),
    outcome: task.status === 'failed'
      ? task.error || task.result || 'No failure details were recorded.'
      : task.result || task.error || 'No final outcome was recorded.',
  };
}

function serveStatic(pathname, response) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = resolve(PUBLIC_ROOT, `.${requested}`);
  if (!isPathInside(PUBLIC_ROOT, filePath) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    sendError(response, 404, 'Not found.');
    return;
  }

  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
  };
  const body = readFileSync(filePath);
  response.writeHead(200, {
    'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function serveTaskAttachment(task, attachment, response) {
  const attachmentRoot = resolve(artifacts.taskDirectory(task.id), 'attachments');
  const filePath = resolve(attachmentRoot, attachment.fileName);
  if (
    !isPathInside(attachmentRoot, filePath)
    || !existsSync(filePath)
    || !statSync(filePath).isFile()
  ) {
    sendError(response, 404, 'Image attachment not found.');
    return;
  }
  const body = readFileSync(filePath);
  response.writeHead(200, {
    'Content-Type': attachment.mimeType,
    'Content-Length': body.length,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
  });
  response.end(body);
}

function readPlanRecord(task) {
  const plan = artifacts.readPlan(task.id);
  if (!plan) return null;
  const artifactPath = artifacts.planPath(task.id, task.repo_path);
  const finalPlan = typeof plan.finalPlan === 'string' ? plan.finalPlan.trim() : '';
  const normalized = { ...plan, artifactPath };
  if (plan.status === 'complete' && finalPlan) {
    const expected = `${finalPlan}\n`;
    const current = existsSync(artifactPath) ? readFileSync(artifactPath, 'utf8') : '';
    if (plan.version !== 2 || plan.artifactPath !== artifactPath || current !== expected) {
      normalized.version = 2;
      normalized.finalPlan = finalPlan;
      artifacts.writePlan(task.id, normalized, { repoPath: task.repo_path });
    }
  }
  return normalized;
}

function servePlanArtifact(task, response) {
  readPlanRecord(task);
  const filePath = artifacts.planPath(task.id, task.repo_path);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    sendError(response, 404, 'Final reviewed plan not found.');
    return;
  }
  const body = readFileSync(filePath);
  response.writeHead(200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline; filename="plan.md"',
  });
  response.end(body);
}

function broadcast(change) {
  const payload = `event: change\ndata: ${JSON.stringify(change)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

export function setDesktopUpdateState(value = {}) {
  if (!IS_DESKTOP) return false;
  desktopUpdateState = normalizeDesktopUpdateState(value);
  broadcast({ desktopUpdate: true });
  return true;
}

// Reconcile a plan breakdown against the terminal state of its linked queue task.
// A breakdown runs as an ordinary `mode: breakdown` queue task on the chosen live
// session; when it settles, its raw response is parsed into review-ready proposals
// stored on the plan. This never creates tasks: unparseable output leaves the raw
// response surfaced and no proposals. Returns true when the breakdown record changed.
function syncPlanBreakdown(taskId) {
  const breakdown = database.breakdownForTask(taskId);
  if (!breakdown) return false;
  const task = database.getTask(taskId);
  // The task row is gone, which means the user deleted it from the queue. Fail the attempt
  // so the plan is not locked out of every breakdown, refine, and run route forever.
  if (!task) {
    const deletion = breakdownUpdateForDeletedTask(breakdown);
    if (!deletion) return false;
    database.updatePlanBreakdown(breakdown.id, deletion);
    diagnostic('plan.breakdown.task_deleted', { breakdownId: breakdown.id, taskId });
    return true;
  }
  // A refinement attempt is asked to echo the ids it was given, so the proposals the user
  // is reviewing keep their identity when the revision lands.
  const previous = database.breakdownsForPlan(breakdown.plan_id)
    .find((candidate) => candidate.id !== breakdown.id && candidate.proposals.length > 0);
  const changes = breakdownUpdateForTask(task, breakdown, { knownIds: knownProposalIds(previous) });
  if (!changes) return false;
  database.updatePlanBreakdown(breakdown.id, changes);
  diagnostic('plan.breakdown.synced', {
    breakdownId: breakdown.id,
    taskId,
    status: changes.status || breakdown.status,
    parsed: changes.parsed,
  });
  return true;
}

queue.on('changed', (change) => {
  let plansChanged = false;
  if (change?.taskId) {
    const task = database.getTask(change.taskId);
    diagnostic('queue.task.changed', {
      taskId: task?.id,
      status: task?.status,
      threadId: task?.thread_id,
      provider: task?.provider,
      error: task?.error || undefined,
    });
    plansChanged = syncPlanBreakdown(change.taskId);
    // Plan runs reconcile off the same signal. The coordinator is re-entrancy safe: this
    // listener fires synchronously from inside queue.enqueue while a run is still fanning
    // its ready steps out.
    if (planRuns.reconcileForTask(change.taskId)) plansChanged = true;
  }
  broadcast(plansChanged ? { ...change, plans: true } : change);
});
codexAppServer.on('status', (status) => broadcast({ codex: status }));
codexAppServer.on('threads', () => broadcast({ threads: true }));
providerUsage.on('changed', () => broadcast({ providerUsage: true }));
codexAppServer.on('notification', ({ method }) => {
  if (method.startsWith('thread/')) {
    broadcast({ threads: true });
  }
});

export const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${HOST}:${PORT}`);
  const { pathname } = url;

  try {
    const claudeHookMatch = pathname.match(/^\/api\/internal\/claude-hooks\/([a-f0-9]{48})$/);
    if (request.method === 'POST' && claudeHookMatch) {
      const body = await readJson(request, MAX_CLAUDE_HOOK_BYTES);
      response.writeHead(204);
      response.once('finish', () => {
        claudeHookBridge.receive(claudeHookMatch[1], body);
      });
      response.end();
      return;
    }

    if (request.method === 'GET' && pathname === '/api/status') {
      const projectPath = url.searchParams.get('projectPath')?.trim() || null;
      const tasks = database.listTasks();
      const claudeRuntimeStatus = currentClaudeStatus();
      sendJson(response, 200, {
        ...queue.status(projectPath),
        codex: { ...runtimeStatus, appServer: codexAppServer.status() },
        claude: claudeRuntimeStatus,
        providerUsage: providerUsage.current(),
        desktopUpdate: desktopUpdateState,
        capabilities: {
          directClaudeExecution: true,
          parallelClaudeExecution: true,
          imageAttachments: true,
          planCouncil: true,
          planCouncilProviderOrder: true,
          planCouncilTerminalExecution: PLAN_COUNCIL_TERMINAL_EXECUTION,
          planCouncilResume: true,
          planArtifacts: true,
          planExecution: true,
          turboPlanCouncil: true,
          projectQueueIsolation: true,
          queueReorder: true,
          projectLauncher: true,
          terminalControl: true,
          parallelCodexBatch: true,
          taskContinuation: true,
          taskDirectFollowUp: true,
          taskFullTextSearch: true,
          taskFollowUpAttachments: true,
          queuedTaskEditing: true,
          queuedTaskNaming: true,
          queuedTaskProviderSwitch: true,
          retryTaskExecutionSettings: true,
          queuedClaudeAssignment: true,
          taskSteering: true,
          claudeTaskSteering: CLAUDE_TASK_STEERING,
          claudeSteerOutbox: CLAUDE_TASK_STEERING,
          turboExecution: true,
          planner: true,
          plannerV2: true,
          dispatchIdleRouting: true,
          instantTaskAdd: true,
          disposableTerminalPools: true,
          resumableDisposableSessions: true,
          retainedTerminalSessions: true,
          liveTerminalRetention: true,
          manualSessionTasks: true,
          sharedProjectConfig: true,
          projectTerminalSettings: true,
          providerUsage: true,
          projectColors: true,
          aiStandupGeneration: true,
          aiStandupChangelog: true,
          crossProcessLaunchOwnership: true,
          desktopUpdates: IS_DESKTOP,
        },
        taskCount: tasks.length,
        runningTasks: agentUpdates.feed(tasks),
        diagnostics: { endpoint: '/api/diagnostics', file: diagnostics.filePath },
        // Another CC Relay backend is heartbeating against the shared configuration database.
        // Terminal ownership stays correct either way; this only lets the interface say so.
        dualBackendDetected: launchOwnership.dualBackendDetected(),
        projectConfig: { file: database.projectConfigPath },
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/threads') {
      const claudeRuntimeStatus = currentClaudeStatus();
      const [codexResult, claudeResult] = await Promise.allSettled([
        codexAppServer.listConnectedThreads(),
        claudeSessions.listSessions(),
      ]);
      const codexThreads = codexResult.status === 'fulfilled' ? codexResult.value : [];
      const claudeThreads = claudeResult.status === 'fulfilled' ? claudeResult.value : [];
      const discoveredThreads = [...codexThreads, ...claudeThreads];
      await projectLauncher.recoverConnectedTerminals(discoveredThreads);
      const tasks = terminalControlTasks();
      const threads = discoveredThreads.map((thread) => ({
        ...thread,
        terminalControl: terminalCloseCoordinator.controlState(thread.id, tasks),
      }));
      sendJson(response, 200, {
        threads,
        providers: [
          {
            id: 'codex',
            label: 'Codex',
            available: codexAppServer.status().connected,
            connectedCount: codexThreads.length,
          },
          {
            id: 'claude',
            label: 'Claude',
            available: claudeRuntimeStatus.available && claudeRuntimeStatus.authenticated,
            connectedCount: claudeThreads.length,
            planCapable: claudeRuntimeStatus.available && claudeRuntimeStatus.authenticated,
          },
        ],
        connection: {
          ...codexAppServer.status(),
          claudeLaunchCommand: claudeRelayCommand(null, LAUNCH_COMMAND_QUOTE, claudeBinaryPath),
          claudeDiscoveryError: claudeSessions.lastError,
          codexDiscoveryError: codexResult.status === 'rejected' ? codexResult.reason.message : null,
        },
      });
      return;
    }

    const terminalMatch = pathname.match(/^\/api\/terminals\/([^/]+)$/);
    if (request.method === 'DELETE' && terminalMatch) {
      const threadId = decodeURIComponent(terminalMatch[1]);
      const terminal = await terminalCloseCoordinator.close(threadId);
      // The close already succeeded, so a failed bookkeeping write must never surface as an error.
      let closedTaskId = null;
      try {
        const retained = retainedSessionTaskForThread(database.listTasks(), threadId);
        if (retained) {
          database.addEvent(retained.id, 'queue', 'The retained terminal window was closed from CC Relay.');
          closedTaskId = retained.id;
        }
      } catch {}
      broadcast(closedTaskId
        ? { threads: true, tasks: true, taskId: closedTaskId }
        : { threads: true });
      sendJson(response, 200, { closed: true, terminal });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/models') {
      const provider = url.searchParams.get('provider') || 'codex';
      if (provider === 'codex') {
        sendJson(response, 200, {
          provider,
          available: codexAppServer.status().connected,
          models: await codexAppServer.listModels(),
        });
        return;
      }
      if (provider === 'claude') {
        const claudeRuntimeStatus = currentClaudeStatus();
        sendJson(response, 200, {
          provider,
          available: claudeRuntimeStatus.available && claudeRuntimeStatus.authenticated,
          models: CLAUDE_MODELS,
        });
        return;
      }
      throw new Error(`Unsupported AI provider: ${provider}`);
    }

    if (request.method === 'GET' && pathname === '/api/tasks/search') {
      const requestedPath = url.searchParams.get('projectPath')?.trim() || '';
      if (!requestedPath) {
        throw new Error('Select a Launchpad project before searching tasks.');
      }
      const query = url.searchParams.get('query')?.trim().slice(0, 200) || '';
      const search = searchTaskDocuments(
        database.listTaskSearchDocuments(resolve(requestedPath)),
        query,
      );
      sendJson(response, 200, search);
      return;
    }

    if (request.method === 'GET' && pathname === '/api/tasks') {
      const tasks = database.listTasks().map((task) => {
        if (task.mode !== 'turbo') return task;
        let plan = null;
        try {
          plan = artifacts.readTurboPlan(task.id);
        } catch {
          plan = null;
        }
        return {
          ...task,
          turboPlanSummary: {
            status: plan?.status || null,
            summary: plan?.summary || '',
            taskCount: Array.isArray(plan?.tasks) ? plan.tasks.length : 0,
          },
        };
      });
      sendJson(response, 200, { tasks });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/standup/generate') {
      const body = await readJson(request, 64 * 1024);
      const requestedPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : '';
      if (!requestedPath) {
        throw new StandupGenerationError('Select a Launchpad project before generating a standup.');
      }
      const projectPath = resolve(requestedPath);
      const project = database.getProjectByPath(projectPath);
      if (!project) {
        throw new StandupGenerationError(
          'The selected project is no longer pinned in CC Relay.',
          { statusCode: 404 },
        );
      }
      const preferredProvider = body.provider === 'claude' ? 'claude' : 'codex';
      if (body.provider && !['codex', 'claude'].includes(body.provider)) {
        throw new StandupGenerationError('Choose Codex or Claude for standup generation.');
      }
      const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : null;
      if (threadId && threadId.length > 512) {
        throw new StandupGenerationError('The selected CC Relay identifier is invalid.');
      }
      const window = validateStandupWindow({ start: body.start, end: body.end });
      const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
        ? body.date
        : window.start.slice(0, 10);
      const tasks = selectStandupTasks(database.listTasks(), {
        projectPath: project.path,
        threadId,
        start: window.start,
        end: window.end,
      });
      if (tasks.length === 0) {
        throw new StandupGenerationError('No completed work was recorded for that day and scope.');
      }
      const includedTasks = tasks.slice(-MAX_STANDUP_SOURCE_TASKS);
      const omittedTaskCount = tasks.length - includedTasks.length;
      const records = includedTasks.map(standupRecord);
      const promptCount = records.reduce((total, record) => total + record.prompts.length, 0);
      const responseCount = records.reduce((total, record) => total + record.responses.length, 0);
      const availability = await standupProviderAvailability(preferredProvider);
      const generated = await standupGenerator.generate(buildStandupPrompt(records, {
        date,
        projectName: project.name,
        scopeLabel: threadId ? 'This CC Relay' : 'All Relays',
        omittedTaskCount,
      }), {
        preferredProvider,
        availability,
        metadata: {
          projectPath: project.path,
          taskCount: tasks.length,
          promptCount,
          responseCount,
        },
      });
      sendJson(response, 200, {
        ...generated,
        date,
        taskCount: tasks.length,
        includedTaskCount: includedTasks.length,
        promptCount,
        responseCount,
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/diagnostics') {
      sendJson(response, 200, { file: diagnostics.filePath, entries: diagnostics.tail(url.searchParams.get('limit')) });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/projects') {
      sendJson(response, 200, {
        projects: database.listProjects(),
        activeProjectPath: database.activeProjectPath(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/ui-preferences') {
      sendJson(response, 200, { preferences: database.uiPreferences() });
      return;
    }

    if (request.method === 'PATCH' && pathname === '/api/ui-preferences') {
      const body = await readJson(request, 16 * 1024);
      const preferences = normalizeUiPreferences(body);
      if (!preferences) throw new Error('Valid panel widths are required.');
      sendJson(response, 200, { preferences: database.setUiPreferences(preferences) });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/terminal-displays') {
      sendJson(response, 200, { displays: await projectLauncher.listDisplays() });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/projects') {
      const body = await readJson(request);
      const project = database.addProject(validateProjectPath(body.path));
      sendJson(response, 201, { project });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/projects/active') {
      const body = await readJson(request);
      const path = typeof body.path === 'string' ? body.path.trim() : '';
      if (!path) throw new Error('A pinned project path is required.');
      sendJson(response, 200, { activeProjectPath: database.setActiveProjectPath(path) });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/projects/choose') {
      const body = await readJson(request);
      const chosen = await projectLauncher.chooseFolder();
      if (!chosen) {
        sendJson(response, 200, { cancelled: true });
        return;
      }
      const project = database.addProject(chosen);
      const launched = body.launch === true
        ? await terminalLaunchCoordinator.launch(project.path, body.provider || 'codex', body.layout)
        : null;
      if (launched) database.markProjectLaunched(project.id);
      sendJson(response, 200, { project, launched });
      return;
    }

    if (request.method === 'PATCH' && pathname === '/api/projects/terminal-layout') {
      const body = await readJson(request);
      const projects = database.updateAllProjectTerminalLayouts(
        validateProjectTerminalLayout(body.terminalLayout),
      );
      broadcast({ projects: true });
      sendJson(response, 200, { projects });
      return;
    }

    const projectMatch = pathname.match(/^\/api\/projects\/(\d+)(?:\/(launch|settings|color))?$/);
    if (request.method === 'PATCH' && projectMatch?.[2] === 'color') {
      const body = await readJson(request);
      const project = database.updateProjectColor(
        Number(projectMatch[1]),
        validateProjectColor(body.color),
      );
      broadcast({ projects: true });
      sendJson(response, 200, { project });
      return;
    }

    if (request.method === 'PATCH' && projectMatch?.[2] === 'settings') {
      const body = await readJson(request);
      if (typeof body.keepTerminalOpen !== 'boolean') {
        throw new Error('Keep task terminals open must be true or false.');
      }
      if (typeof body.preferIdleTerminal !== 'boolean') {
        throw new Error('Idle CC Relay routing must be true or false.');
      }
      const project = database.updateProjectTerminalSettings(Number(projectMatch[1]), {
        keepTerminalOpen: body.keepTerminalOpen,
        preferIdleTerminal: body.preferIdleTerminal,
        terminalLayout: validateProjectTerminalLayout(body.terminalLayout),
      });
      broadcast({ projects: true });
      sendJson(response, 200, { project });
      return;
    }

    if (request.method === 'PATCH' && projectMatch && !projectMatch[2]) {
      const body = await readJson(request);
      const projectId = Number(projectMatch[1]);
      const existingProject = database.getProject(projectId);
      if (!existingProject) throw new Error('Pinned project not found.');
      const codex = validateInstanceLimit(body.maxCodexInstances, 'Codex');
      const claude = validateInstanceLimit(body.maxClaudeInstances, 'Claude');
      const blockedTask = database.listTasks().find((task) => {
        if (
          task.status !== 'queued'
          || task.terminal_lifecycle !== 'disposable'
          || resolve(task.repo_path) !== resolve(existingProject.path)
        ) return false;
        const required = disposableTerminalRequirements(task);
        return required.codex > codex || required.claude > claude;
      });
      if (blockedTask) {
        const required = disposableTerminalRequirements(blockedTask);
        throw new Error(
          `Task ${blockedTask.id} is already queued and needs ${required.codex} Codex and ${required.claude} Claude instances. Finish or cancel it before lowering these limits.`,
        );
      }
      const project = database.updateProjectInstanceLimits(Number(projectMatch[1]), {
        codex,
        claude,
      });
      queue.schedule();
      broadcast({ projects: true });
      sendJson(response, 200, { project });
      return;
    }

    if (request.method === 'POST' && projectMatch?.[2] === 'launch') {
      const project = database.listProjects().find((item) => item.id === Number(projectMatch[1]));
      if (!project) throw new Error('Pinned project not found.');
      const body = await readJson(request);
      const provider = body.provider || 'codex';
      diagnostic('api.project.launch.requested', { projectId: project.id, path: project.path, provider });
      const launched = await terminalLaunchCoordinator.launch(project.path, provider, body.layout);
      sendJson(response, 200, { project: database.markProjectLaunched(project.id), launched });
      return;
    }

    if (request.method === 'DELETE' && projectMatch && !projectMatch[2]) {
      if (database.listProjects().length <= 1) {
        throw new Error('CC Relay must keep one Launchpad project selected. Add another project before unpinning this one.');
      }
      sendJson(response, 200, { deleted: database.deleteProject(Number(projectMatch[1])) });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/plans') {
      const projectPath = url.searchParams.get('projectPath')?.trim() || '';
      if (!projectPath) {
        throw new Error('A project is required to list its plans.');
      }
      const plans = database.listPlans(projectPath).map((plan) => ({
        ...plan,
        breakdown: breakdownSummary(database.latestPlanBreakdown(plan.id)),
        run: planRuns.summary(plan.id),
      }));
      sendJson(response, 200, { plans });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/plans') {
      const body = await readJson(request, MAX_TASK_REQUEST_BYTES);
      const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : '';
      if (!projectPath) {
        throw new Error('A project is required to save a plan.');
      }
      const plan = database.createPlan({
        repoPath: projectPath,
        name: validatePlanName(body.name),
        content: validatePlanContent(body.content),
      });
      diagnostic('api.plan.created', { planId: plan.id, repoPath: projectPath });
      sendJson(response, 201, { plan: planWithBreakdown(plan) });
      return;
    }

    const planMatch = pathname.match(/^\/api\/plans\/(\d+)$/);
    const planBreakdownMatch = pathname.match(/^\/api\/plans\/(\d+)\/breakdown$/);
    const planBreakdownQueueMatch = pathname.match(/^\/api\/plans\/(\d+)\/breakdown\/queue$/);
    const planBreakdownRefineMatch = pathname.match(/^\/api\/plans\/(\d+)\/breakdown\/refine$/);
    const planRunMatch = pathname.match(/^\/api\/plans\/(\d+)\/run$/);
    const planRunStopMatch = pathname.match(/^\/api\/plans\/(\d+)\/run\/stop$/);

    if (request.method === 'GET' && planMatch) {
      const plan = database.getPlan(Number(planMatch[1]));
      if (!plan) {
        sendError(response, 404, 'Plan not found.');
        return;
      }
      // Reading an active run also repairs it. The reconciler is idempotent and the
      // per-step submission id is deterministic, so this can only ever finish work a
      // missed queue event left behind; it is the same repair role the visible-page
      // refresh plays for the task list.
      planRuns.reconcilePlan(plan.id);
      sendJson(response, 200, { plan: planWithBreakdown(plan) });
      return;
    }

    if (request.method === 'PATCH' && planMatch) {
      const plan = database.getPlan(Number(planMatch[1]));
      if (!plan) {
        sendError(response, 404, 'Plan not found.');
        return;
      }
      const body = await readJson(request, MAX_TASK_REQUEST_BYTES);
      const changes = {};
      if (body.name !== undefined) changes.name = validatePlanName(body.name);
      if (body.content !== undefined) changes.content = validatePlanContent(body.content);
      const updated = database.updatePlan(plan.id, changes);
      diagnostic('api.plan.updated', { planId: plan.id, fields: Object.keys(changes) });
      sendJson(response, 200, { plan: planWithBreakdown(updated) });
      return;
    }

    if (request.method === 'DELETE' && planMatch) {
      const plan = database.getPlan(Number(planMatch[1]));
      if (!plan) {
        sendError(response, 404, 'Plan not found.');
        return;
      }
      // Best effort: free the session by cancelling a still-active breakdown task.
      for (const breakdown of database.breakdownsForPlan(plan.id)) {
        if (breakdown.task_id) {
          try { queue.cancel(breakdown.task_id); } catch {}
        }
      }
      // Stop the run and cancel its still-queued steps before the cascade removes the
      // rows. Leaving that to ON DELETE CASCADE would orphan queued step tasks that
      // nothing owns any more.
      planRuns.release(plan.id);
      const deleted = database.deletePlan(plan.id);
      diagnostic('api.plan.deleted', { planId: plan.id, deleted });
      sendJson(response, 200, { deleted });
      return;
    }

    if (request.method === 'POST' && planBreakdownMatch) {
      const plan = database.getPlan(Number(planBreakdownMatch[1]));
      if (!plan) {
        sendError(response, 404, 'Plan not found.');
        return;
      }
      const body = await readJson(request, MAX_TASK_REQUEST_BYTES);
      const provider = planProvider(body.provider);
      const guidance = typeof body.guidance === 'string' ? body.guidance.trim() : '';
      if (guidance.length > MAX_BREAKDOWN_GUIDANCE) {
        throw new Error(`Breakdown guidance must be ${MAX_BREAKDOWN_GUIDANCE.toLocaleString('en-US')} characters or fewer.`);
      }
      requireNoBreakdownInProgress(plan.id);
      const session = await resolvePlannerTaskSession(plan, provider, body);
      const thread = session.thread;
      requireNoBreakdownInProgress(plan.id);
      const breakdown = database.createPlanBreakdown({
        planId: plan.id,
        provider,
        sessionId: session.sessionId,
        sessionLabel: thread.title || session.sessionId,
        guidance: guidance || null,
        status: 'pending',
      });
      let task;
      try {
        task = queue.enqueue({
          title: `Plan breakdown · ${plan.name}`.slice(0, 118),
          prompt: buildBreakdownPrompt({ plan, guidance }),
          thread,
          provider,
          mode: 'breakdown',
          repoPath: plan.repo_path,
          terminalLifecycle: session.terminalLifecycle,
          keepTerminalOpen: session.keepTerminalOpen,
          terminalLayout: session.terminalLayout,
          submissionId: randomUUID(),
        });
      } catch (error) {
        database.updatePlanBreakdown(breakdown.id, { status: 'failed', error: error.message });
        throw error;
      }
      const linked = database.updatePlanBreakdown(breakdown.id, { task_id: task.id });
      diagnostic('api.plan.breakdown.requested', {
        planId: plan.id,
        breakdownId: breakdown.id,
        taskId: task.id,
        provider,
        threadId: session.sessionId,
        repoPath: plan.repo_path,
      });
      sendJson(response, 201, {
        plan: planWithBreakdown(database.getPlan(plan.id)),
        breakdown: withBreakdownAttempt(linked),
      });
      return;
    }

    // Refinement is a NEW breakdown attempt that revises the proposals the user is
    // actually looking at, including their own edits, instead of restarting from the plan.
    // History is kept: prior attempts stay in plan_breakdowns and the newest is current.
    if (request.method === 'POST' && planBreakdownRefineMatch) {
      const plan = database.getPlan(Number(planBreakdownRefineMatch[1]));
      if (!plan) {
        sendError(response, 404, 'Plan not found.');
        return;
      }
      const body = await readJson(request, MAX_TASK_REQUEST_BYTES);
      const feedback = typeof body.feedback === 'string' ? body.feedback.trim() : '';
      if (!feedback) {
        throw new Error('Describe what should change before refining the breakdown.');
      }
      if (feedback.length > MAX_BREAKDOWN_GUIDANCE) {
        throw new Error(`Refinement feedback must be ${MAX_BREAKDOWN_GUIDANCE.toLocaleString('en-US')} characters or fewer.`);
      }
      const current = database.latestPlanBreakdown(plan.id);
      if (!current || current.proposals.length === 0) {
        throw new Error('Run a breakdown with at least one task before refining it.');
      }
      requireNoBreakdownInProgress(plan.id);
      const provider = planProvider(body.provider, current.provider);
      const session = await resolvePlannerTaskSession(plan, provider, {
        ...body,
        threadId: typeof body.threadId === 'string' && body.threadId.trim()
          ? body.threadId.trim()
          : current.session_id || '',
      });
      const thread = session.thread;
      requireNoBreakdownInProgress(plan.id);
      const refined = database.createPlanBreakdown({
        planId: plan.id,
        provider,
        sessionId: session.sessionId,
        sessionLabel: thread.title || session.sessionId,
        guidance: feedback,
        status: 'pending',
      });
      let task;
      try {
        task = queue.enqueue({
          title: `Plan refinement · ${plan.name}`.slice(0, 118),
          prompt: buildRefinementPrompt({
            plan,
            proposals: current.proposals,
            feedback,
            guidance: current.guidance,
          }),
          thread,
          provider,
          mode: 'breakdown',
          repoPath: plan.repo_path,
          terminalLifecycle: session.terminalLifecycle,
          keepTerminalOpen: session.keepTerminalOpen,
          terminalLayout: session.terminalLayout,
          submissionId: randomUUID(),
        });
      } catch (error) {
        database.updatePlanBreakdown(refined.id, { status: 'failed', error: error.message });
        throw error;
      }
      const linked = database.updatePlanBreakdown(refined.id, { task_id: task.id });
      diagnostic('api.plan.breakdown.refine_requested', {
        planId: plan.id,
        breakdownId: refined.id,
        previousBreakdownId: current.id,
        taskId: task.id,
        provider,
        threadId: session.sessionId,
        proposals: current.proposals.length,
      });
      sendJson(response, 201, {
        plan: planWithBreakdown(database.getPlan(plan.id)),
        breakdown: withBreakdownAttempt(linked),
      });
      return;
    }

    if (request.method === 'PATCH' && planBreakdownMatch) {
      const plan = database.getPlan(Number(planBreakdownMatch[1]));
      if (!plan) {
        sendError(response, 404, 'Plan not found.');
        return;
      }
      const breakdown = database.latestPlanBreakdown(plan.id);
      if (!breakdown) {
        throw new Error('This plan has no breakdown proposals to edit yet.');
      }
      // Only a completed breakdown owns editable proposals. Rejecting edits in any
      // other state keeps the never-overwrite-user-edits guarantee unconditional:
      // otherwise an edit made while the row is 'failed' would be clobbered when a
      // queued automatic retry later transitions the row into 'complete' (Finding 22).
      if (breakdown.status !== 'complete') {
        sendError(response, 409, 'Proposals can only be edited after the breakdown completes.');
        return;
      }
      const body = await readJson(request, MAX_TASK_REQUEST_BYTES);
      const { proposals, notes } = validateProposals(body.proposals);
      const updated = database.setBreakdownProposals(breakdown.id, proposals, notes);
      sendJson(response, 200, { breakdown: withBreakdownAttempt(updated) });
      return;
    }

    if (request.method === 'POST' && planBreakdownQueueMatch) {
      const plan = database.getPlan(Number(planBreakdownQueueMatch[1]));
      if (!plan) {
        sendError(response, 404, 'Plan not found.');
        return;
      }
      const body = await readJson(request, MAX_TASK_REQUEST_BYTES);
      const { proposals } = validateProposals(body.proposals);
      if (proposals.length === 0) {
        throw new Error('Select at least one task to queue.');
      }
      const provider = planProvider(body.provider);
      const session = await resolvePlannerTaskSession(plan, provider, body);
      const thread = session.thread;
      const execution = validateExecutionSettings({
        model: body.model,
        effort: body.effort,
        models: provider === 'codex' ? await codexAppServer.listModels() : CLAUDE_MODELS,
      });
      const created = [];
      for (const proposal of proposals) {
        const task = queue.enqueue({
          title: proposal.title,
          prompt: proposal.prompt,
          thread,
          provider,
          mode: 'execute',
          ...execution,
          repoPath: plan.repo_path,
          terminalLifecycle: session.terminalLifecycle,
          keepTerminalOpen: session.keepTerminalOpen,
          terminalLayout: session.terminalLayout,
          submissionId: randomUUID(),
        });
        database.addEvent(task.id, 'queue', `Queued from Planner breakdown of "${plan.name}".`);
        created.push(task);
      }
      diagnostic('api.plan.breakdown.queued', {
        planId: plan.id,
        count: created.length,
        provider,
        threadId: session.sessionId,
        repoPath: plan.repo_path,
      });
      sendJson(response, 201, { tasks: created });
      return;
    }

    // Start an orchestrated plan run. The run engine is a reconciler over the ordinary
    // queue: a step whose dependencies are complete becomes a normal mode 'execute' task
    // through the same enqueue path the composer uses, carrying preferIdleTerminal so
    // independent steps fan out across idle same-workspace sessions.
    if (request.method === 'POST' && planRunMatch) {
      const plan = database.getPlan(Number(planRunMatch[1]));
      if (!plan) {
        sendError(response, 404, 'Plan not found.');
        return;
      }
      // Fail fast with the specific reason. This is an early read for a good message only:
      // planRuns.start() re-checks the same conflict synchronously next to the write, so two
      // overlapping submissions cannot both get past this and mint two task sets.
      planRuns.reconcilePlan(plan.id);
      const startConflict = planRuns.startConflict(plan.id);
      if (startConflict) {
        sendError(response, 409, startConflict);
        return;
      }
      const breakdown = database.latestPlanBreakdown(plan.id);
      if (!breakdown || breakdown.status !== 'complete' || breakdown.proposals.length === 0) {
        throw new Error('Run a breakdown with at least one task before running the plan.');
      }
      const body = await readJson(request, MAX_TASK_REQUEST_BYTES);
      const proposalIds = body.proposalIds === undefined || body.proposalIds === null
        ? breakdown.proposals.map((proposal) => proposal.id)
        : body.proposalIds;
      if (!Array.isArray(proposalIds)) {
        throw new Error('Selected step ids must be a list.');
      }
      const selected = new Set(proposalIds.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean));
      if (selected.size === 0) {
        throw new Error('Select at least one step to run.');
      }
      const known = new Set(breakdown.proposals.map((proposal) => proposal.id));
      const unknown = [...selected].filter((id) => !known.has(id));
      if (unknown.length > 0) {
        throw new Error('Those steps are no longer part of this breakdown. Reload the Planner and try again.');
      }
      const proposals = breakdown.proposals.filter((proposal) => selected.has(proposal.id));
      const provider = planProvider(body.provider);
      const session = await resolvePlannerTaskSession(plan, provider, body);
      const thread = session.thread;
      const execution = validateExecutionSettings({
        model: body.model,
        effort: body.effort,
        models: provider === 'codex' ? await codexAppServer.listModels() : CLAUDE_MODELS,
      });
      const run = planRuns.start({
        plan,
        breakdown,
        proposals,
        thread,
        sessionId: session.sessionId,
        provider,
        preferIdleTerminal: body.preferIdleTerminal === true && !session.disposable,
        terminalLifecycle: session.terminalLifecycle,
        keepTerminalOpen: session.keepTerminalOpen,
        terminalLayout: session.terminalLayout,
        model: execution.model ?? null,
        effort: execution.effort ?? null,
      });
      diagnostic('api.plan.run.started', {
        planId: plan.id,
        runId: run.id,
        steps: proposals.length,
        provider,
        threadId: session.sessionId,
        preferIdleTerminal: body.preferIdleTerminal === true && !session.disposable,
        repoPath: plan.repo_path,
      });
      broadcast({ plans: true });
      sendJson(response, 201, {
        plan: planWithBreakdown(database.getPlan(plan.id)),
        run: planRuns.view(plan.id),
      });
      return;
    }

    // Stop means: enqueue nothing further. Steps that are already queued or running are
    // deliberately left alone and stay individually cancellable through the normal task
    // cancel. Idempotent, so a second stop during the drain is never an error.
    if (request.method === 'POST' && planRunStopMatch) {
      const plan = database.getPlan(Number(planRunStopMatch[1]));
      if (!plan) {
        sendError(response, 404, 'Plan not found.');
        return;
      }
      const stopped = planRuns.stop(plan.id);
      if (!stopped) {
        sendError(response, 409, 'There is no active plan run to stop.');
        return;
      }
      diagnostic('api.plan.run.stopped', { planId: plan.id, runId: stopped.id });
      broadcast({ plans: true });
      sendJson(response, 200, {
        plan: planWithBreakdown(database.getPlan(plan.id)),
        run: planRuns.view(plan.id),
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/tasks') {
      const body = await readJson(request, MAX_TASK_REQUEST_BYTES);
      const mode = typeof body.mode === 'string' ? body.mode.trim() : 'execute';
      if (!['execute', 'plan', 'turbo'].includes(mode)) {
        throw new Error(`Unsupported task mode: ${mode}`);
      }
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
      if (!prompt) {
        throw new Error('Task prompt is required.');
      }
      const title = taskTitleFromInput(
        Object.hasOwn(body, 'title') ? body.title : undefined,
        prompt,
      );
      const submissionId = typeof body.submissionId === 'string' ? body.submissionId.trim() : null;
      if (!submissionId) {
        throw new Error('Task submission ID is required. Refresh CC Relay and try again.');
      }
      if (submissionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionId)) {
        throw new Error('Task submission ID is invalid.');
      }
      const attachments = decodeImageAttachments(body.attachments);
      const runNow = body.runNow === true;
      const terminalLifecycle = body.terminalLifecycle === 'disposable'
        ? 'disposable'
        : 'persistent';
      const disposable = terminalLifecycle === 'disposable';
      const keepTerminalOpen = disposable && body.keepTerminalOpen === true;
      const manualCompletion = disposable
        && keepTerminalOpen
        && mode === 'execute'
        && body.manualCompletion === true;
      const terminalLayout = disposable ? validateTaskTerminalLayout(body.terminalLayout) : null;
      // Run now pins the task to the visibly selected terminal, so it deliberately opts out
      // of idle routing. Plan council occupies both of its providers and never reroutes.
      const preferIdleTerminal = body.preferIdleTerminal === true
        && mode === 'execute'
        && !runNow
        && !disposable;
      const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
      if (!disposable && !threadId) {
        throw new Error('A connected AI session is required.');
      }
      const provider = mode === 'execute' && typeof body.provider === 'string'
        ? body.provider.trim()
        : mode === 'execute' ? 'codex' : mode === 'turbo' ? 'codex' : 'council';
      if (mode === 'execute' && !['codex', 'claude'].includes(provider)) {
        throw new Error(`Unsupported AI provider: ${provider}`);
      }
      const existingSubmission = database.getTaskBySubmissionId(submissionId);
      if (existingSubmission) {
        const sameSubmission = existingSubmission.prompt === prompt
          && existingSubmission.title === title
          && existingSubmission.mode === mode
          && existingSubmission.provider === provider;
        if (!sameSubmission) {
          throw new Error('That submission ID was already used for different work.');
        }
        diagnostic('api.task.enqueue.duplicate', {
          submissionId,
          taskId: existingSubmission.id,
          mode,
          provider,
        });
        sendJson(response, 200, { task: existingSubmission, duplicateSubmission: true });
        return;
      }
      const sessionProvider = submissionSessionProvider(mode, provider);
      let resolvedSession = { source: 'automatic-pool', thread: null };
      let thread;
      if (disposable) {
        const requestedProjectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : '';
        if (!requestedProjectPath) {
          throw new Error('A project is required for automatic terminal execution.');
        }
        const projectPath = validateProjectPath(requestedProjectPath).path;
        const project = database.getProjectByPath(projectPath);
        if (!project) {
          throw new Error('Pin this project in CC Relay before adding automatic terminal work.');
        }
        thread = {
          id: null,
          provider: sessionProvider,
          cwd: project.path,
          title: `Automatic ${sessionProvider === 'claude' ? 'Claude' : 'Codex'} instance`,
          source: 'CC Relay managed terminal pool',
        };
        resolvedSession = { source: 'automatic-pool', thread };
      } else {
        resolvedSession = await resolveSubmissionThread(
          sessionProvider,
          threadId,
          sessionResolutionDeps(sessionProvider, threadId),
        );
        thread = resolvedSession.thread;
        if (!thread) {
          diagnostic('api.task.enqueue.rejected', { mode, provider, threadId, reason: 'thread-never-seen' });
          throw new Error(SESSION_NEVER_SEEN[sessionProvider]);
        }
      }

      diagnostic('api.task.enqueue.validated', {
        mode,
        provider,
        threadId,
        repoPath: thread.cwd,
        threadStatus: thread.status,
        resolvedFrom: resolvedSession.source,
        preferIdleTerminal,
        terminalLifecycle,
        keepTerminalOpen,
        manualCompletion,
      });

      if (mode === 'turbo') {
        const workerCount = Number(body.workerCount);
        if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > 8) {
          throw new Error('Turbo worker count must be between 1 and 8.');
        }
        const models = await codexAppServer.listModels();
        const planner = validateExecutionSettings({ model: body.plannerModel, effort: body.plannerEffort, models });
        const worker = validateExecutionSettings({ model: body.workerModel, effort: body.workerEffort, models });
        let workerThreads = [];
        if (!disposable) {
          const connected = await codexAppServer.listConnectedThreads();
          workerThreads = connected.filter((item) => (
            item.id !== thread.id && resolve(item.cwd) === resolve(thread.cwd)
          )).slice(0, workerCount);
          if (workerThreads.length < workerCount) {
            throw new Error(`Turbo mode needs the planner plus ${workerCount} other live Codex terminal${workerCount === 1 ? '' : 's'} in this workspace.`);
          }
        }
        const claudeRuntimeStatus = currentClaudeStatus();
        const council = validateTurboCouncilConfig({
          enabled: body.councilEnabled,
          order: body.councilOrder ?? body.order,
          authorProvider: body.councilAuthorProvider ?? body.authorProvider,
          authorModel: body.councilAuthorModel,
          authorEffort: body.councilAuthorEffort,
          reviewerProvider: body.councilReviewerProvider ?? body.reviewerProvider,
          reviewerModel: body.councilReviewerModel,
          reviewerEffort: body.councilReviewerEffort,
        }, { claudeStatus: claudeRuntimeStatus, codexModels: models, claudeModels: CLAUDE_MODELS });
        diagnostic('api.turbo.council.configured', {
          councilEnabled: council.enabled,
          enabled: council.enabled,
          order: council.order,
          authorProvider: council.enabled ? council.authorProvider : undefined,
          authorModel: council.enabled ? council.authorModel : undefined,
          authorEffort: council.enabled ? council.authorEffort : undefined,
          reviewerProvider: council.enabled ? council.reviewerProvider : undefined,
          reviewerModel: council.enabled ? council.reviewerModel : undefined,
          reviewerEffort: council.enabled ? council.reviewerEffort : undefined,
        });
        const taskInput = {
          title, prompt, thread, provider: 'codex', mode, attachments, runNow,
          submissionId,
          model: planner.model, effort: planner.effort,
          repoPath: thread.cwd,
          terminalLifecycle,
          keepTerminalOpen,
          terminalLayout,
          turbo: {
            plannerThreadId: thread.id || null,
            plannerModel: planner.model,
            plannerEffort: planner.effort,
            workerModel: worker.model,
            workerEffort: worker.effort,
            workerCount,
            workers: workerThreads.map((item) => ({ threadId: item.id, title: item.title })),
            council,
            councilTerminalExecution: disposable && PLAN_COUNCIL_TERMINAL_EXECUTION,
          },
        };
        const capacityIssue = disposableTerminalPool.capacityIssue({
          ...taskInput,
          repo_path: thread.cwd,
          terminal_lifecycle: terminalLifecycle,
        });
        if (capacityIssue) throw new Error(capacityIssue);
        const task = queue.enqueue(taskInput);
        sendJson(response, 201, { task });
        return;
      }

      if (mode === 'plan') {
        if (body.councilEnabled !== true) {
          throw new Error('Plan council must be explicitly enabled for this task.');
        }
        const claudeRuntimeStatus = requireClaudeReady('Plan council');
        const council = validatePlanCouncilConfig({
          councilEnabled: body.councilEnabled,
          councilOrder: body.councilOrder ?? body.order,
          authorProvider: body.authorProvider,
          authorModel: body.authorModel,
          authorEffort: body.authorEffort,
          reviewerProvider: body.reviewerProvider,
          reviewerModel: body.reviewerModel,
          reviewerEffort: body.reviewerEffort,
        }, {
          claudeReady: true,
          claudeStatus: claudeRuntimeStatus,
          codexModels: await codexAppServer.listModels(),
          claudeModels: CLAUDE_MODELS,
        });
        let claudeThread = null;
        if (PLAN_COUNCIL_TERMINAL_EXECUTION && !disposable) {
          const authorThreadId = typeof body.authorThreadId === 'string'
            ? body.authorThreadId.trim()
            : '';
          if (!authorThreadId) {
            throw new Error('Choose a connected Claude council terminal for Plan council.');
          }
          const resolvedClaude = await resolveSubmissionThread(
            'claude',
            authorThreadId,
            sessionResolutionDeps('claude', authorThreadId),
          );
          claudeThread = resolvedClaude.thread;
          if (!claudeThread) {
            throw new Error('CC Relay has never seen that Claude council terminal. Refresh the session list.');
          }
          if (resolve(claudeThread.cwd) !== resolve(thread.cwd)) {
            throw new Error('The Claude and Codex council terminals must be open in the same workspace.');
          }
          const ownedClaudeTerminal = projectLauncher.terminalForThread(claudeThread.id);
          if (!ownedClaudeTerminal || ownedClaudeTerminal.provider !== 'claude') {
            throw new Error(
              'Plan council needs a Claude CC Relay launched by CC Relay so it can type into that exact terminal. Launch Claude here, then select it as the council terminal.',
            );
          }
        }
        diagnostic('api.plan.council.sessions', {
          terminalExecution: PLAN_COUNCIL_TERMINAL_EXECUTION,
          order: council.order,
          authorProvider: council.authorProvider,
          reviewerProvider: council.reviewerProvider,
          claudeThreadId: claudeThread?.id || null,
          codexThreadId: thread.id,
          repoPath: thread.cwd,
        });
        const task = queue.enqueue({
          title,
          prompt,
          thread,
          provider: 'council',
          mode,
          council: {
            authorProvider: council.authorProvider,
            ...(claudeThread ? { authorThread: claudeThread } : {}),
            authorModel: council.authorModel,
            authorEffort: council.authorEffort,
            reviewerProvider: council.reviewerProvider,
            reviewerModel: council.reviewerModel,
            reviewerEffort: council.reviewerEffort,
          },
          attachments,
          runNow,
          submissionId,
          repoPath: thread.cwd,
          terminalLifecycle,
          keepTerminalOpen,
          terminalLayout,
        });
        sendJson(response, 201, { task });
        return;
      }

      if (provider === 'claude') {
        const claudeRuntimeStatus = requireClaudeReady('Claude execution');
        const execution = validateExecutionSettings({
          model: body.model,
          effort: body.effort,
          models: CLAUDE_MODELS,
        });
        const task = queue.enqueue({
          title,
          prompt,
          thread,
          provider,
          mode,
          ...execution,
          attachments,
          runNow,
          submissionId,
          preferIdleTerminal,
          repoPath: thread.cwd,
          terminalLifecycle,
          keepTerminalOpen,
          manualCompletion,
          terminalLayout,
        });
        sendJson(response, 201, { task });
        return;
      }
      const execution = validateExecutionSettings({
        model: body.model,
        effort: body.effort,
        models: await codexAppServer.listModels(),
      });
      const task = queue.enqueue({
        title,
        prompt,
        thread,
        provider,
        mode,
        ...execution,
        attachments,
        runNow,
        submissionId,
        preferIdleTerminal,
        repoPath: thread.cwd,
        terminalLifecycle,
        keepTerminalOpen,
        manualCompletion,
        terminalLayout,
      });
      sendJson(response, 201, { task });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/tasks/parallel-codex') {
      const body = await readJson(request);
      const taskIds = Array.isArray(body.taskIds) ? body.taskIds.map(Number) : [];
      if (taskIds.length < 2 || new Set(taskIds).size !== taskIds.length) {
        throw new Error('Select at least two different queued tasks.');
      }
      let tasks = taskIds.map((id) => database.getTask(id));
      if (tasks.some((task) => !task || task.status !== 'queued')) {
        throw new Error('Only tasks that are still queued can be bundled. Refresh and try again.');
      }
      // Only ordinary direct work can be folded into one Codex command. A Planner
      // breakdown, a Plan council, or a Turbo task carries machinery its owner still
      // tracks by task id, and bundling one would delete that task out from under it.
      if (tasks.some((task) => task.mode !== 'execute' || task.terminal_lifecycle === 'disposable')) {
        throw new Error('Only legacy direct Execute tasks assigned to a live terminal can be bundled.');
      }
      const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
      const thread = threadId ? await codexAppServer.readConnectedThread(threadId) : null;
      if (!thread) {
        throw new Error('Choose a live Codex terminal for parallel execution.');
      }
      tasks = taskIds.map((id) => database.getTask(id));
      if (tasks.some((task) => (
        !task
        || task.status !== 'queued'
        || task.mode !== 'execute'
        || task.terminal_lifecycle === 'disposable'
      ))) {
        throw new Error('The queue changed while the parallel batch was being prepared.');
      }
      tasks.sort((left, right) => left.position - right.position || left.id - right.id);
      if (tasks.some((task) => resolve(task.repo_path) !== resolve(thread.cwd))) {
        throw new Error('Selected tasks must use the same workspace as the selected Codex terminal.');
      }
      const execution = validateExecutionSettings({
        model: body.model,
        effort: body.effort,
        models: await codexAppServer.listModels(),
      });
      const prompt = buildParallelCodexPrompt(tasks);
      const attachments = tasks.flatMap((task) => task.attachments.map((attachment) => ({
        name: `task-${task.id}-${attachment.name}`,
        mimeType: attachment.mimeType,
        extension: attachment.fileName.split('.').at(-1),
        data: readFileSync(attachment.path),
      })));
      if (attachments.length > MAX_IMAGE_ATTACHMENTS) {
        throw new Error(`The selected tasks contain more than ${MAX_IMAGE_ATTACHMENTS} images in total.`);
      }
      if (attachments.reduce((total, attachment) => total + attachment.data.length, 0) > MAX_TOTAL_IMAGE_BYTES) {
        throw new Error('The selected task images exceed the 20 MB combined limit.');
      }
      const bundledTask = queue.enqueue({
        title: titleFromPrompt(prompt),
        prompt,
        thread,
        provider: 'codex',
        mode: 'execute',
        ...execution,
        attachments,
      });
      for (const task of tasks) queue.delete(task.id);
      database.addEvent(
        bundledTask.id,
        'queue',
        `${tasks.length} queued tasks bundled into one Codex command for parallel sub-agents.`,
      );
      sendJson(response, 201, { task: database.getTask(bundledTask.id), bundledTaskIds: taskIds });
      return;
    }

    if (request.method === 'POST' && /^\/api\/tasks\/\d+\/steer$/.test(pathname)) {
      const taskId = taskIdFromPath(pathname);
      const task = database.getTask(taskId);
      if (!task) throw new Error('Task not found.');
      const body = await readJson(request, MAX_TASK_REQUEST_BYTES);
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
      if (!prompt) throw new Error('Write a follow-up before sending it.');
      const attachments = decodeImageAttachments(body.attachments);
      if (task.mode !== 'execute' || !['codex', 'claude'].includes(task.provider)) {
        throw new Error('Only a running direct Codex or Claude task can accept a live update.');
      }
      if (task.status !== 'running') {
        throw new Error('That task is no longer running. Your message was not queued.');
      }
      const steered = await steerRunningTask(task, prompt, attachments, {
        flushComposer: body.flushComposer === true,
      });
      sendJson(response, 200, {
        task: database.getTask(task.id),
        steered: true,
        threadId: steered.threadId,
        turnId: steered.turnId ?? null,
      });
      return;
    }

    if (request.method === 'POST' && /^\/api\/tasks\/\d+\/(?:continue|follow-up)$/.test(pathname)) {
      const sourceTaskId = taskIdFromPath(pathname);
      const sourceTask = database.getTask(sourceTaskId);
      if (!sourceTask) throw new Error('Task not found.');
      const body = await readJson(request, MAX_TASK_REQUEST_BYTES);
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
      if (!prompt) throw new Error('Write a follow-up before sending it.');
      const attachments = decodeImageAttachments(body.attachments);
      if (sourceTask.mode !== 'execute' || !['codex', 'claude'].includes(sourceTask.provider)) {
        throw new Error('Only direct Codex or Claude tasks can continue in one terminal session.');
      }
      if (isManualSessionTask(sourceTask) && sourceTask.status === 'complete') {
        throw new Error('This terminal session task is complete and cannot accept more messages.');
      }
      if (sourceTask.status === 'running') {
        const steered = await steerRunningTask(sourceTask, prompt, attachments, {
          flushComposer: body.flushComposer === true,
        });
        sendJson(response, 200, {
          task: database.getTask(sourceTask.id),
          steered: true,
          threadId: steered.threadId,
          turnId: steered.turnId ?? null,
        });
        return;
      }
      if (sourceTask.provider === 'claude') {
        const claudeRuntimeStatus = requireClaudeReady('Claude continuation');
      }
      const retainedThread = sourceTask.terminal_lifecycle === 'disposable'
        && sourceTask.keep_terminal_open
        && sourceTask.thread_id
        ? sourceTask.provider === 'codex'
          ? await codexAppServer.readConnectedThread(sourceTask.thread_id)
          : await claudeSessions.readConnectedSession(sourceTask.thread_id)
        : null;
      if (!['open', 'complete', 'failed', 'cancelled', 'interrupted'].includes(sourceTask.status)) {
        throw new Error('That task is not ready to continue yet.');
      }
      const resumeDisposable = sourceTask.terminal_lifecycle === 'disposable' && !retainedThread;
      if (resumeDisposable && !sourceTask.thread_id) {
        throw new Error('The original conversation was not established, so it cannot be resumed.');
      }
      const connectedThread = resumeDisposable
        ? null
        : retainedThread || (sourceTask.provider === 'codex'
          ? await codexAppServer.readConnectedThread(sourceTask.thread_id)
          : await claudeSessions.readConnectedSession(sourceTask.thread_id));
      const thread = connectedThread || (resumeDisposable ? {
        id: sourceTask.thread_id,
        provider: sourceTask.provider,
        cwd: sourceTask.repo_path,
        title: sourceTask.thread_name || `Resumed ${sourceTask.provider} conversation`,
        source: 'CC Relay managed terminal pool',
        status: 'idle',
      } : null);
      if (!thread) {
        throw new Error(sourceTask.provider === 'claude'
          ? 'The original Claude session is no longer open. Reopen that conversation before continuing.'
          : 'The original Codex CC Relay is no longer connected. Reconnect it before continuing.');
      }
      if (thread.status !== 'idle') {
        throw new Error('That terminal is currently busy. Finish its active work, then send again. Your follow-up was not queued.');
      }
      const execution = validateExecutionSettings({
        model: sourceTask.model,
        effort: sourceTask.effort,
        models: sourceTask.provider === 'codex' ? await codexAppServer.listModels() : CLAUDE_MODELS,
      });
      const task = queue.startFollowUp(buildSessionFollowUp({
        sourceTask,
        prompt,
        thread,
        execution,
        attachments,
      }), { resumeDisposable });
      diagnostic('api.task.follow_up_started', {
        sourceTaskId: sourceTask.id,
        threadId: task.thread_id,
        provider: task.provider,
        model: task.model,
        effort: task.effort,
        resumedDisposableSession: resumeDisposable,
      });
      sendJson(response, 202, {
        task,
        followUpStarted: true,
        threadId: task.thread_id,
        resumedDisposableSession: resumeDisposable,
      });
      return;
    }

    if (request.method === 'GET' && /^\/api\/tasks\/\d+\/attachments\/image-\d+$/.test(pathname)) {
      const taskId = taskIdFromPath(pathname);
      const task = database.getTask(taskId);
      const attachmentId = pathname.split('/').at(-1);
      const attachment = task?.attachments.find((item) => item.id === attachmentId);
      if (!task || !attachment) {
        sendError(response, 404, 'Image attachment not found.');
        return;
      }
      serveTaskAttachment(task, attachment, response);
      return;
    }

    if (request.method === 'GET' && /^\/api\/tasks\/\d+\/plan$/.test(pathname)) {
      const taskId = taskIdFromPath(pathname);
      const task = database.getTask(taskId);
      if (!task || task.mode !== 'plan') {
        sendError(response, 404, 'Plan council task not found.');
        return;
      }
      servePlanArtifact(task, response);
      return;
    }

    if (request.method === 'GET' && /^\/api\/tasks\/\d+$/.test(pathname)) {
      const taskId = taskIdFromPath(pathname);
      const task = database.getTask(taskId);
      if (!task) {
        sendError(response, 404, 'Task not found.');
        return;
      }
      sendJson(response, 200, {
        task,
        events: database.listEvents(taskId),
        prompts: database.listTaskPrompts(taskId),
        responses: database.listTaskResponses(taskId),
        plan: task.mode === 'plan' ? readPlanRecord(task) : null,
        turboPlan: task.mode === 'turbo' ? artifacts.readTurboPlan(taskId) : null,
      });
      return;
    }

    if (request.method === 'PATCH' && /^\/api\/tasks\/\d+$/.test(pathname)) {
      const taskId = taskIdFromPath(pathname);
      const body = await readJson(request, MAX_TASK_REQUEST_BYTES);
      const currentTask = database.getTask(taskId);
      if (!currentTask) throw new Error('Task not found.');
      const promptProvided = Object.hasOwn(body, 'prompt');
      const titleProvided = Object.hasOwn(body, 'title');
      if (!promptProvided && !titleProvided && !Object.hasOwn(body, 'provider')) {
        throw new Error('A task name, prompt, or execution setting is required.');
      }
      if (promptProvided && typeof body.prompt !== 'string') {
        throw new Error('Task prompt must be text.');
      }
      const prompt = promptProvided ? body.prompt.trim() : currentTask.prompt;
      if (!prompt) throw new Error('Task prompt is required.');
      if (prompt.length > 12_000) throw new Error('Task prompt must be 12,000 characters or fewer.');
      const title = titleProvided
        ? taskTitleFromInput(body.title, prompt)
        : promptProvided ? titleFromPrompt(prompt) : currentTask.title;
      const changes = { title, prompt };
      if (Object.hasOwn(body, 'provider')) {
        const provider = typeof body.provider === 'string' ? body.provider.trim() : '';
        if (!['codex', 'claude'].includes(provider)) {
          throw new Error(`Unsupported AI provider: ${provider}`);
        }
        if (provider === 'claude') requireClaudeReady('Claude execution');
        const execution = validateExecutionSettings({
          model: body.model,
          effort: body.effort,
          models: provider === 'codex' ? await codexAppServer.listModels() : CLAUDE_MODELS,
        });
        Object.assign(changes, { provider, ...execution });
      } else if (Object.hasOwn(body, 'model') || Object.hasOwn(body, 'effort')) {
        throw new Error('Choose an AI provider when changing execution settings.');
      }
      const task = queue.edit(taskId, changes);
      diagnostic('api.task.edited', {
        taskId,
        repoPath: task.repo_path,
        mode: task.mode,
        provider: task.provider,
        title: task.title,
      });
      sendJson(response, 200, { task });
      return;
    }

    if (request.method === 'POST' && /^\/api\/tasks\/\d+\/keep-terminal-open$/.test(pathname)) {
      const taskId = taskIdFromPath(pathname);
      const task = queue.keepTerminalOpen(taskId);
      diagnostic('api.task.terminal_retention_enabled', {
        taskId,
        repoPath: task.repo_path,
        mode: task.mode,
      });
      sendJson(response, 200, { task });
      return;
    }

    if (request.method === 'POST' && /^\/api\/tasks\/\d+\/complete-session$/.test(pathname)) {
      const taskId = taskIdFromPath(pathname);
      const task = queue.completeSession(taskId);
      diagnostic('api.task.session_completed', {
        taskId,
        repoPath: task.repo_path,
        provider: task.provider,
      });
      sendJson(response, 200, { task });
      return;
    }

    if (request.method === 'POST' && /^\/api\/tasks\/\d+\/cancel$/.test(pathname)) {
      const taskId = taskIdFromPath(pathname);
      queue.cancel(taskId);
      sendJson(response, 200, { task: database.getTask(taskId) });
      return;
    }

    if (request.method === 'POST' && /^\/api\/tasks\/\d+\/execute-plan$/.test(pathname)) {
      const sourceTaskId = taskIdFromPath(pathname);
      const sourceTask = database.getTask(sourceTaskId);
      if (!sourceTask) throw new Error('Plan council task not found.');
      const plan = readPlanRecord(sourceTask);
      const body = await readJson(request);
      const provider = typeof body.provider === 'string' ? body.provider.trim() : '';
      if (!['codex', 'claude'].includes(provider)) {
        throw new Error('Choose whether Codex or Claude should execute the reviewed plan.');
      }
      const terminalLifecycle = body.terminalLifecycle === 'disposable'
        ? 'disposable'
        : 'persistent';
      const disposable = terminalLifecycle === 'disposable';
      const keepTerminalOpen = disposable && body.keepTerminalOpen === true;
      const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
      let thread;
      if (disposable) {
        const projectPath = validateProjectPath(body.projectPath).path;
        if (resolve(projectPath) !== resolve(sourceTask.repo_path)) {
          throw new Error('The reviewed plan must execute in its original project.');
        }
        thread = {
          id: null,
          provider,
          cwd: projectPath,
          title: `Automatic ${provider === 'codex' ? 'Codex' : 'Claude'} instance`,
          source: 'CC Relay managed terminal pool',
        };
      } else {
        thread = provider === 'codex'
          ? await codexAppServer.readConnectedThread(threadId)
          : await claudeSessions.readConnectedSession(threadId);
      }
      const finalPlan = validatePlanExecution({ sourceTask, plan, thread, provider });
      if (provider === 'claude') {
        const claudeRuntimeStatus = requireClaudeReady('Claude execution');
      }
      const execution = validateExecutionSettings({
        model: body.model,
        effort: body.effort,
        models: provider === 'codex' ? await codexAppServer.listModels() : CLAUDE_MODELS,
      });
      const attachmentRoot = resolve(artifacts.taskDirectory(sourceTask.id), 'attachments');
      const attachments = sourceTask.attachments.map((attachment) => {
        const filePath = resolve(attachmentRoot, attachment.fileName || '');
        if (
          !isPathInside(attachmentRoot, filePath)
          || !existsSync(filePath)
          || !statSync(filePath).isFile()
        ) {
          throw new Error(`Reference image is missing: ${attachment.name}`);
        }
        return {
          name: attachment.name,
          mimeType: attachment.mimeType,
          extension: extname(attachment.fileName || filePath).slice(1),
          data: readFileSync(filePath),
        };
      });
      const executionTask = queue.enqueue({
        title: planExecutionTitle(sourceTask),
        prompt: buildPlanExecutionPrompt({
          sourceTask,
          plan: { ...plan, finalPlan },
          planPath: artifacts.planPath(sourceTask.id, sourceTask.repo_path),
        }),
        thread,
        provider,
        mode: 'execute',
        ...execution,
        attachments,
        continuedFromTaskId: sourceTask.id,
        runNow: body.runNow === true,
        repoPath: thread.cwd,
        terminalLifecycle,
        keepTerminalOpen,
        terminalLayout: disposable ? validateTaskTerminalLayout(body.terminalLayout) : null,
      });
      database.addEvent(
        executionTask.id,
        'queue',
        `Reviewed plan from Task ${sourceTask.id} queued on ${provider === 'codex' ? 'Codex' : 'Claude'}.`,
      );
      diagnostic('api.plan.execution.queued', {
        sourceTaskId,
        taskId: executionTask.id,
        provider,
        threadId: thread.id,
        repoPath: thread.cwd,
      });
      sendJson(response, 201, { task: database.getTask(executionTask.id), sourceTaskId });
      return;
    }

    if (request.method === 'POST' && /^\/api\/tasks\/\d+\/retry$/.test(pathname)) {
      const taskId = taskIdFromPath(pathname);
      const task = database.getTask(taskId);
      if (!task) throw new Error('Task not found.');
      if (!['failed', 'cancelled', 'interrupted'].includes(task.status)) {
        throw new Error('Only failed, cancelled, or interrupted tasks can be retried.');
      }
      const body = await readJson(request);
      const retryExecutionRequested = ['provider', 'model', 'effort']
        .some((field) => Object.hasOwn(body, field));
      let retryExecution = null;
      if (retryExecutionRequested) {
        if (task.mode !== 'execute' || task.terminal_lifecycle !== 'disposable') {
          throw new Error('Only automatic Execute tasks can change executor or effort when retrying.');
        }
        const provider = typeof body.provider === 'string' ? body.provider.trim() : '';
        if (!['codex', 'claude'].includes(provider)) {
          throw new Error('Choose Codex or Claude as the retry executor.');
        }
        if (provider === 'claude') requireClaudeReady('Claude execution');
        const execution = validateExecutionSettings({
          model: body.model,
          effort: body.effort,
          models: provider === 'codex' ? await codexAppServer.listModels() : CLAUDE_MODELS,
        });
        retryExecution = { provider, ...execution };
      }
      let reuseRetainedTerminal = false;
      if (
        task.mode === 'execute'
        && task.terminal_lifecycle === 'disposable'
        && task.keep_terminal_open
        && task.thread_id
        && (!retryExecution || retryExecution.provider === task.provider)
      ) {
        const retainedThread = task.provider === 'codex'
          ? await codexAppServer.readConnectedThread(task.thread_id)
          : await claudeSessions.readConnectedSession(task.thread_id);
        if (retainedThread) {
          // Windows reports the retained terminal's cwd in whatever drive-letter and path case
          // the shell recorded, so a verbatim resolved comparison rejects the very terminal
          // CC Relay opened. POSIX keeps the exact byte comparison this replaces.
          if (!sameWorkspacePath(retainedThread.cwd, task.repo_path)) {
            throw new Error('The retained terminal is no longer open in this task project.');
          }
          if (retainedThread.status !== 'idle') {
            throw new Error('The retained terminal is still busy. Wait for it to become idle before retrying.');
          }
          reuseRetainedTerminal = true;
        }
      }
      if (task.mode === 'plan' && task.terminal_lifecycle !== 'disposable') {
        const requestedThreadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
        const requestedAuthorThreadId = typeof body.authorThreadId === 'string'
          ? body.authorThreadId.trim()
          : '';
        const reviewerThreadId = requestedThreadId || task.thread_id;
        const reviewerThread = reviewerThreadId
          ? await codexAppServer.readConnectedThread(reviewerThreadId)
          : null;
        if (!reviewerThread) {
          throw new Error('Choose a connected Codex council CC Relay before resuming the Plan council.');
        }
        if (resolve(reviewerThread.cwd) !== resolve(task.repo_path)) {
          throw new Error('The Plan council Codex terminal must use a CC Relay in the same workspace.');
        }
        const plan = readPlanRecord(task);
        if (plan?.status !== 'complete') {
          const claudeRuntimeStatus = requireClaudeReady('Plan council');
          if (PLAN_COUNCIL_TERMINAL_EXECUTION) {
            const authorThreadId = requestedAuthorThreadId || task.author_thread_id;
            const authorThread = authorThreadId
              ? await claudeSessions.readConnectedSession(authorThreadId)
              : null;
            if (!authorThread) {
              throw new Error('Choose a connected Claude council terminal before resuming the Plan council.');
            }
            if (resolve(authorThread.cwd) !== resolve(task.repo_path)) {
              throw new Error('The Plan council Claude terminal must use a CC Relay in the same workspace.');
            }
            const ownedAuthorTerminal = projectLauncher.terminalForThread(authorThread.id);
            if (!ownedAuthorTerminal || ownedAuthorTerminal.provider !== 'claude') {
              throw new Error('The Plan council must use a Claude terminal launched by CC Relay.');
            }
            if (authorThread.id !== task.author_thread_id) {
              const reassigned = database.updateTask(taskId, {
                author_thread_id: authorThread.id,
                author_thread_name: authorThread.title,
                author_thread_source: authorThread.source,
              });
              artifacts.updateCouncilAuthorAssignment(reassigned);
              database.addEvent(taskId, 'queue', `Plan council Claude terminal moved to ${authorThread.title}.`);
            }
          }
        }
        if (reviewerThread.id !== task.thread_id) {
          const reassigned = database.updateTask(taskId, {
            thread_id: reviewerThread.id,
            thread_name: reviewerThread.title,
            thread_source: reviewerThread.source,
          });
          artifacts.updateTaskAssignment(reassigned);
          database.addEvent(taskId, 'queue', `Plan council Codex terminal moved to ${reviewerThread.title}.`);
        }
      }
      sendJson(response, 200, {
        task: queue.retry(taskId, { reuseRetainedTerminal, execution: retryExecution }),
      });
      return;
    }

    if (request.method === 'POST' && /^\/api\/tasks\/\d+\/assign$/.test(pathname)) {
      const taskId = taskIdFromPath(pathname);
      const task = database.getTask(taskId);
      if (!task) throw new Error('Task not found.');
      if (task.mode !== 'execute' || !['codex', 'claude'].includes(task.provider)) {
        throw new Error('Only queued Execute tasks can be assigned to another terminal.');
      }
      const body = await readJson(request);
      const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
      const thread = threadId
        ? task.provider === 'codex'
          ? await codexAppServer.readConnectedThread(threadId)
          : await claudeSessions.readConnectedSession(threadId)
        : null;
      if (!thread) {
        throw new Error(
          task.provider === 'claude'
            ? 'That Claude terminal is no longer open. Choose another live Claude CC Relay.'
            : 'That Codex terminal is no longer connected. Choose another live CC Relay.',
        );
      }
      if (resolve(task.repo_path) !== resolve(thread.cwd)) {
        throw new Error('Tasks can only move between terminals in the same workspace.');
      }
      sendJson(response, 200, { task: queue.assign(taskId, thread) });
      return;
    }

    if (request.method === 'DELETE' && /^\/api\/tasks\/\d+$/.test(pathname)) {
      const taskId = taskIdFromPath(pathname);
      if (!queue.delete(taskId)) {
        sendError(response, 404, 'Task not found.');
        return;
      }
      sendJson(response, 200, { deleted: true });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/queue/pause') {
      const body = await readJson(request);
      const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : '';
      queue.pause(projectPath);
      sendJson(response, 200, queue.status(projectPath));
      return;
    }

    if (request.method === 'POST' && pathname === '/api/queue/resume') {
      const body = await readJson(request);
      const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : '';
      queue.resume(projectPath);
      sendJson(response, 200, queue.status(projectPath));
      return;
    }

    if (request.method === 'POST' && pathname === '/api/queue/reorder') {
      const body = await readJson(request);
      if (!Array.isArray(body.expectedTaskIds)) {
        throw new Error('expectedTaskIds is required for queue reorder.');
      }
      const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : '';
      if (!projectPath) {
        throw new Error('projectPath is required for queue reorder.');
      }
      const tasks = queue.reorder(body.taskIds, body.expectedTaskIds, projectPath);
      sendJson(response, 200, { tasks });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      response.write(`event: ready\ndata: ${JSON.stringify(queue.status())}\n\n`);
      sseClients.add(response);
      request.on('close', () => sseClients.delete(response));
      return;
    }

    if (pathname.startsWith('/api/')) {
      sendError(response, 404, 'API route not found.');
      return;
    }

    serveStatic(pathname, response);
  } catch (error) {
    diagnostic('api.request.failed', { method: request.method, pathname, error: error.message });
    // A guard that has to run synchronously next to the write it protects cannot reach the
    // route's own sendError, so it carries its status code on the error instead.
    const statusCode = error instanceof SyntaxError ? 400 : error.statusCode || 422;
    /*
     * A live update the provider terminal may already have accepted stays a rejection: CC
     * Relay did not confirm it and will not send it again. The client still has to tell it
     * apart from a delivery that provably never happened, because retaining that text in a
     * composer invites the duplicate turn the no-queue contract forbids. Response shape
     * only. Nothing about the outcome, the status code, or the retry policy changes.
     */
    sendError(
      response,
      statusCode,
      error.message || 'Request failed.',
      {
        ...(error.deliveryUncertain === true ? { deliveryUncertain: true } : {}),
        ...(error.composerBlocked === true ? { composerBlocked: true } : {}),
      },
    );
  }
});

let resolveServerReady;
let rejectServerReady;
export const serverReady = new Promise((resolveReady, rejectReady) => {
  resolveServerReady = resolveReady;
  rejectServerReady = rejectReady;
});
// Standalone server launches do not consume this promise. Keep a failed bind from
// becoming an unhandled rejection while still allowing Electron to await it.
serverReady.catch(() => {});

server.once('error', (error) => {
  rejectServerReady(error);
  diagnostic('relay.listen.failed', {
    host: HOST,
    port: error.port ?? PORT,
    requestedPort: PORT,
    dataRoot: DATA_ROOT,
    projectConfigFile: database.projectConfigPath,
    error: error.message,
  });
  console.error(`CC Relay could not listen at http://${HOST}:${PORT}: ${error.message}`);
  codexAppServer.close();
  database.close();
  process.exitCode = 1;
});

diagnostic('relay.listen.requested', {
  host: HOST,
  requestedPort: PORT,
  portSelection: PORT === 0 ? 'operating-system' : 'fixed',
  dataRoot: DATA_ROOT,
  projectConfigFile: database.projectConfigPath,
});
server.listen(PORT, HOST, () => {
  const endpoint = relayServerEndpoint(server, HOST);
  relayEndpointUrl = endpoint.url;
  // Registered only once this process owns its port. A start that fails on a busy port must not
  // leave a claim behind that another backend would have to time out.
  launchOwnership.start().catch((error) => {
    diagnostic('launch.registry.failed', { operation: 'start', error: error.message });
  });
  queue.start();
  // After queue recovery, not before: recoverInterruptedTasks() marks tasks that died with
  // the server as `interrupted` without emitting a queue change, so nothing else would tell
  // a plan run that its steps are gone. An interrupted step is a failure with no scheduled
  // retry, so its dependents block and the user can retry the task to re-arm it.
  planRuns.reconcileAll();
  diagnostic('relay.started', {
    host: endpoint.host,
    port: endpoint.port,
    requestedPort: PORT,
    dataRoot: DATA_ROOT,
    projectConfigFile: database.projectConfigPath,
  });
  codexAppServer.start().catch((error) => {
    diagnostic('appserver.background_start.failed', { error: error.message });
    console.error(`Codex app-server could not start: ${error.message}`);
  });
  // Provider readiness is probed in the background from here on. Ordinary status and queue
  // requests never spawn probes. The explicit standup action launches one isolated AI run.
  claudeRuntime.start();
  providerUsage.start();
  refreshCodexStatus().then((status) => {
    if (!status.available || !status.authenticated) {
      console.log('Codex is unavailable or not authenticated. Check `codex login status`.');
      return;
    }
    // Warm the model list so the first Codex, Plan council, or Turbo submission after a
    // restart does not pay the paginated model/list round trip.
    void activateCodexRuntime(status);
  });
  codexStatusTimer = setInterval(() => {
    void refreshCodexStatus().then((status) => activateCodexRuntime(status));
  }, CODEX_STATUS_REFRESH_MS);
  codexStatusTimer.unref?.();
  console.log(`CC Relay is running at ${endpoint.url}`);
  resolveServerReady(endpoint);
});

export async function shutdown() {
  providerUsage.stop();
  claudeRuntime.stop();
  relayEndpointUrl = null;
  claudeHookBridge.clear();
  standupGenerator.cancel();
  if (codexStatusTimer) {
    clearInterval(codexStatusTimer);
    codexStatusTimer = null;
  }
  for (const client of sseClients) {
    client.end();
  }
  sseClients.clear();
  server.close();
  await queue.shutdown();
  await projectLauncher.closeOwnedTerminals();
  launchOwnership.stop();
  codexAppServer.close();
  database.close();
}

process.once('SIGINT', () => shutdown().catch(console.error));
process.once('SIGTERM', () => shutdown().catch(console.error));
