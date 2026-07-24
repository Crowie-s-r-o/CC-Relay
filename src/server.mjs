import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArtifactStore } from './artifacts.mjs';
import {
  decodeImageAttachments,
  MAX_IMAGE_ATTACHMENTS,
  MAX_TASK_REQUEST_BYTES,
  MAX_TOTAL_IMAGE_BYTES,
} from './attachments.mjs';
import { ClaudeBinaryResolver } from './claude-binary.mjs';
import { ClaudeExecutionRunner } from './claude-execution-runner.mjs';
import { ClaudeRuntimeStatus } from './claude-runtime-status.mjs';
import { ClaudeRunner } from './claude-runner.mjs';
import { ClaudeSessionRegistry } from './claude-session-registry.mjs';
import { CodexAppServer } from './codex-app-server.mjs';
import { RelayDatabase } from './database.mjs';
import { DiagnosticLog } from './diagnostics.mjs';
import { CLAUDE_MODELS, validateExecutionSettings } from './model-catalog.mjs';
import { PlanCouncilRunner } from './plan-council-runner.mjs';
import {
  buildPlanExecutionPrompt,
  planExecutionTitle,
  validatePlanExecution,
} from './plan-execution.mjs';
import { buildParallelCodexPrompt } from './parallel-batch.mjs';
import { ProjectLauncher, claudeRelayCommand, shellQuote, validateProjectPath } from './project-launcher.mjs';
import { TaskQueue } from './queue.mjs';
import { buildSessionFollowUp } from './task-continuation.mjs';
import { TerminalCloseCoordinator } from './terminal-close-coordinator.mjs';
import { TerminalLaunchCoordinator } from './terminal-launch-coordinator.mjs';
import { TerminalRuntimeResolver } from './terminal-runtime-resolver.mjs';
import { TurboPlanCouncilReviewer } from './turbo-plan-council.mjs';
import { validateTurboCouncilConfig } from './turbo-council-config.mjs';
import { TurboRunner } from './turbo-runner.mjs';
import { RelayRunner } from './relay-runner.mjs';
import { runningTaskFeed } from './running-task-feed.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_ROOT = join(APP_ROOT, 'public');
const dataDirectoryIndex = process.argv.indexOf('--relay-data-dir');
const DATA_ROOT = dataDirectoryIndex >= 0 && process.argv[dataDirectoryIndex + 1]
  ? resolve(process.argv[dataDirectoryIndex + 1])
  : join(APP_ROOT, '.data');
const HOST = '127.0.0.1';
const PORT = 4768;

const diagnostics = new DiagnosticLog(join(DATA_ROOT, 'relay-diagnostics.jsonl'));
const diagnostic = (event, details) => diagnostics.write(event, details);
const database = new RelayDatabase(join(DATA_ROOT, 'relay.sqlite'));
const artifacts = new ArtifactStore(join(DATA_ROOT, 'tasks'));
const codexAppServer = new CodexAppServer({ diagnostic });
// Pin the exact claude binary once at startup so discovery and execution do not
// depend on the launching process PATH order (Finder or dock versus terminal).
const claudeBinaryResolver = new ClaudeBinaryResolver({ diagnostic });
const claudeBinaryPath = await claudeBinaryResolver.resolve();
const claudeRunner = new ClaudeRunner({ command: claudeBinaryPath });
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
  return {
    terminalWindowId: native.terminalWindowId,
    terminalTty: native.terminalTty,
    runtimeProcessId: native.runtimeProcessId,
  };
};
const claudeExecution = new ClaudeExecutionRunner({
  sessions: claudeSessions,
  command: claudeBinaryPath,
  platform: process.platform,
  resolveTerminal: resolveClaudeTerminal,
});
const planCouncil = new PlanCouncilRunner({
  claude: claudeRunner,
  codex: codexAppServer,
  artifacts,
});
const turboCouncilReviewer = new TurboPlanCouncilReviewer({ claude: claudeRunner });
const turboRunner = new TurboRunner({ codex: codexAppServer, artifacts, councilReviewer: turboCouncilReviewer });
const runner = new RelayRunner({
  codex: codexAppServer,
  claude: claudeExecution,
  planCouncil,
  turbo: turboRunner,
});
const closingTerminalIds = new Set();
const queue = new TaskQueue({
  database,
  artifacts,
  runner,
  isThreadAvailable: (threadId) => !closingTerminalIds.has(threadId),
});
const projectLauncher = new ProjectLauncher({
  diagnostic,
  claudeBinary: claudeBinaryPath,
  ensureCodexReady: () => codexAppServer.start(),
  reserveCodexLaunch: (path, launchId) => codexAppServer.reserveLaunchClient(path, launchId),
  codexClientForThread: (threadId) => codexAppServer.runtimeClientForThread(threadId),
});
const terminalLaunchCoordinator = new TerminalLaunchCoordinator({
  launcher: projectLauncher,
  diagnostic,
  listSessions: (provider) => provider === 'codex'
    ? codexAppServer.listConnectedThreads()
    : claudeSessions.listSessions(),
});
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

function terminalControlTasks() {
  const pendingRetryIds = queue.pendingRetryTaskIds();
  return database.listTasks().map((task) => (
    pendingRetryIds.has(task.id) ? { ...task, status: 'retrying' } : task
  ));
}

function codexStatus() {
  try {
    const version = execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim();
    execFileSync('codex', ['login', 'status'], { encoding: 'utf8', stdio: 'pipe' });
    return { available: true, authenticated: true, version };
  } catch (error) {
    return { available: false, authenticated: false, version: null, error: error.message };
  }
}

const runtimeStatus = codexStatus();

const claudeRuntime = new ClaudeRuntimeStatus({ command: claudeBinaryPath });
const currentClaudeStatus = (force = false) => claudeRuntime.current({ force });

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function sendError(response, statusCode, message) {
  sendJson(response, statusCode, { error: message });
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

function titleFromPrompt(prompt) {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
}

function serveStatic(pathname, response) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = resolve(PUBLIC_ROOT, `.${requested}`);
  if (!filePath.startsWith(`${PUBLIC_ROOT}/`) || !existsSync(filePath) || !statSync(filePath).isFile()) {
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
    !filePath.startsWith(`${attachmentRoot}/`)
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

function readPlanRecord(taskId) {
  const plan = artifacts.readPlan(taskId);
  if (!plan) return null;
  const artifactPath = artifacts.planPath(taskId);
  const finalPlan = typeof plan.finalPlan === 'string' ? plan.finalPlan.trim() : '';
  const normalized = { ...plan, artifactPath };
  if (plan.status === 'complete' && finalPlan) {
    const expected = `${finalPlan}\n`;
    const current = existsSync(artifactPath) ? readFileSync(artifactPath, 'utf8') : '';
    if (plan.version !== 2 || plan.artifactPath !== artifactPath || current !== expected) {
      normalized.version = 2;
      normalized.finalPlan = finalPlan;
      artifacts.writePlan(taskId, normalized);
    }
  }
  return normalized;
}

function servePlanArtifact(task, response) {
  readPlanRecord(task.id);
  const filePath = artifacts.planPath(task.id);
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

queue.on('changed', (change) => {
  if (change?.taskId) {
    const task = database.getTask(change.taskId);
    diagnostic('queue.task.changed', {
      taskId: task?.id,
      status: task?.status,
      threadId: task?.thread_id,
      provider: task?.provider,
      error: task?.error || undefined,
    });
  }
  broadcast(change);
});
codexAppServer.on('status', (status) => broadcast({ codex: status }));
codexAppServer.on('threads', () => broadcast({ threads: true }));
codexAppServer.on('notification', ({ method }) => {
  if (method.startsWith('thread/')) {
    broadcast({ threads: true });
  }
});

export const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${HOST}:${PORT}`);
  const { pathname } = url;

  try {
    if (request.method === 'GET' && pathname === '/api/status') {
      const projectPath = url.searchParams.get('projectPath')?.trim() || null;
      const tasks = database.listTasks();
      const claudeRuntimeStatus = currentClaudeStatus();
      sendJson(response, 200, {
        ...queue.status(projectPath),
        codex: { ...runtimeStatus, appServer: codexAppServer.status() },
        claude: claudeRuntimeStatus,
        capabilities: {
          directClaudeExecution: true,
          parallelClaudeExecution: true,
          imageAttachments: true,
          planCouncil: true,
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
          taskFollowUpAttachments: true,
          queuedTaskEditing: true,
          taskSteering: true,
          turboExecution: true,
        },
        taskCount: tasks.length,
        runningTasks: runningTaskFeed(tasks, (taskId) => database.listEvents(taskId, 1_000)),
        diagnostics: { endpoint: '/api/diagnostics', file: diagnostics.filePath },
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
          claudeLaunchCommand: claudeRelayCommand(null, shellQuote, claudeBinaryPath),
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
      broadcast({ threads: true });
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

    if (request.method === 'GET' && pathname === '/api/diagnostics') {
      sendJson(response, 200, { file: diagnostics.filePath, entries: diagnostics.tail(url.searchParams.get('limit')) });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/projects') {
      sendJson(response, 200, { projects: database.listProjects() });
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

    const projectMatch = pathname.match(/^\/api\/projects\/(\d+)(?:\/(launch))?$/);
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
        throw new Error('Relay must keep one Launchpad project selected. Add another project before unpinning this one.');
      }
      sendJson(response, 200, { deleted: database.deleteProject(Number(projectMatch[1])) });
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
      const submissionId = typeof body.submissionId === 'string' ? body.submissionId.trim() : null;
      if (!submissionId) {
        throw new Error('Task submission ID is required. Refresh Relay and try again.');
      }
      if (submissionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionId)) {
        throw new Error('Task submission ID is invalid.');
      }
      const attachments = decodeImageAttachments(body.attachments);
      const runNow = body.runNow === true;
      const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
      if (!threadId) {
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
      const thread = mode === 'plan' || mode === 'turbo' || provider === 'codex'
        ? await codexAppServer.readConnectedThread(threadId)
        : await claudeSessions.readConnectedSession(threadId);
      if (!thread) {
        diagnostic('api.task.enqueue.rejected', { mode, provider, threadId, reason: 'thread-not-connected' });
        throw new Error(provider === 'claude'
          ? 'That Claude Code session is no longer open. Refresh the session list.'
          : 'That terminal is not connected to Relay\'s shared Codex server. Refresh the session list.');
      }

      diagnostic('api.task.enqueue.validated', {
        mode,
        provider,
        threadId,
        repoPath: thread.cwd,
        threadStatus: thread.status,
      });

      if (mode === 'turbo') {
        const workerCount = Number(body.workerCount);
        if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > 8) {
          throw new Error('Turbo worker count must be between 1 and 8.');
        }
        const models = await codexAppServer.listModels();
        const planner = validateExecutionSettings({ model: body.plannerModel, effort: body.plannerEffort, models });
        const worker = validateExecutionSettings({ model: body.workerModel, effort: body.workerEffort, models });
        const connected = await codexAppServer.listConnectedThreads();
        const workerThreads = connected.filter((item) => (
          item.id !== thread.id && resolve(item.cwd) === resolve(thread.cwd)
        )).slice(0, workerCount);
        if (workerThreads.length < workerCount) {
          throw new Error(`Turbo mode needs the planner plus ${workerCount} other live Codex terminal${workerCount === 1 ? '' : 's'} in this workspace.`);
        }
        const claudeRuntimeStatus = currentClaudeStatus(body.councilEnabled === true);
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
        const task = queue.enqueue({
          title: titleFromPrompt(prompt), prompt, thread, provider: 'codex', mode, attachments, runNow,
          submissionId,
          model: planner.model, effort: planner.effort,
          turbo: {
            plannerThreadId: thread.id,
            plannerModel: planner.model,
            plannerEffort: planner.effort,
            workerModel: worker.model,
            workerEffort: worker.effort,
            workerCount,
            workers: workerThreads.map((item) => ({ threadId: item.id, title: item.title })),
            council,
          },
        });
        sendJson(response, 201, { task });
        return;
      }

      if (mode === 'plan') {
        if (body.councilEnabled !== true) {
          throw new Error('Plan council must be explicitly enabled for this task.');
        }
        const claudeRuntimeStatus = currentClaudeStatus(true);
        if (!claudeRuntimeStatus.available || !claudeRuntimeStatus.authenticated) {
          throw new Error('Plan council needs a signed-in Claude Code CLI. Run `claude auth login`; Relay will detect it automatically.');
        }
        const authorProvider = typeof body.authorProvider === 'string'
          ? body.authorProvider.trim()
          : 'claude';
        const reviewerProvider = typeof body.reviewerProvider === 'string'
          ? body.reviewerProvider.trim()
          : 'codex';
        if (authorProvider === reviewerProvider) {
          throw new Error('Plan council requires at least two different AI providers.');
        }
        if (authorProvider !== 'claude' || reviewerProvider !== 'codex') {
          throw new Error('The available plan route is Claude author to Codex reviewer.');
        }
        const authorModel = typeof body.authorModel === 'string'
          ? body.authorModel.trim()
          : 'fable';
        if (!['fable', 'opus'].includes(authorModel)) {
          throw new Error('Claude plan author must use Fable or Opus.');
        }
        const authorEffort = typeof body.authorEffort === 'string'
          ? body.authorEffort.trim()
          : 'max';
        if (authorEffort !== 'max') {
          throw new Error('Claude plan author must use max effort.');
        }
        const reviewer = validateExecutionSettings({
          model: body.reviewerModel,
          effort: body.reviewerEffort,
          models: await codexAppServer.listModels(),
        });
        if (!reviewer.model) {
          throw new Error('Choose a Codex reviewer model for Plan council.');
        }
        const task = queue.enqueue({
          title: titleFromPrompt(prompt),
          prompt,
          thread,
          provider: 'council',
          mode,
          council: {
            authorProvider,
            authorModel,
            authorEffort,
            reviewerProvider,
            reviewerModel: reviewer.model,
            reviewerEffort: reviewer.effort,
          },
          attachments,
          runNow,
          submissionId,
        });
        sendJson(response, 201, { task });
        return;
      }

      if (provider === 'claude') {
        const claudeRuntimeStatus = currentClaudeStatus(true);
        if (!claudeRuntimeStatus.available || !claudeRuntimeStatus.authenticated) {
          throw new Error('Claude execution needs a signed-in Claude Code CLI. Run `claude auth login`; Relay will detect it automatically.');
        }
        const execution = validateExecutionSettings({
          model: body.model,
          effort: body.effort,
          models: CLAUDE_MODELS,
        });
        const task = queue.enqueue({
          title: titleFromPrompt(prompt),
          prompt,
          thread,
          provider,
          mode,
          ...execution,
          attachments,
          runNow,
          submissionId,
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
        title: titleFromPrompt(prompt),
        prompt,
        thread,
        provider,
        mode,
        ...execution,
        attachments,
        runNow,
        submissionId,
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
      const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
      const thread = threadId ? await codexAppServer.readConnectedThread(threadId) : null;
      if (!thread) {
        throw new Error('Choose a live Codex terminal for parallel execution.');
      }
      tasks = taskIds.map((id) => database.getTask(id));
      if (tasks.some((task) => !task || task.status !== 'queued')) {
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
      if (task.mode !== 'execute' || task.provider !== 'codex') {
        throw new Error('Only a running direct Codex task can accept a live update.');
      }
      if (task.status !== 'running') {
        throw new Error('That task is no longer running. Your message was not queued.');
      }
      const storedAttachments = queue.stageTaskAttachments(task.id, attachments);
      let steered;
      try {
        steered = await codexAppServer.steer(task.id, prompt, storedAttachments);
      } catch (error) {
        queue.discardTaskAttachments(task.id, storedAttachments);
        throw error;
      }
      queue.commitTaskAttachments(task.id, storedAttachments);
      diagnostic('api.task.steered', steered);
      sendJson(response, 200, {
        task: database.getTask(task.id),
        steered: true,
        threadId: steered.threadId,
        turnId: steered.turnId,
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
      if (sourceTask.status === 'running') {
        if (sourceTask.provider !== 'codex') {
          throw new Error('Claude live turn updates are not available yet. Your message was not queued.');
        }
        const storedAttachments = queue.stageTaskAttachments(sourceTask.id, attachments);
        let steered;
        try {
          steered = await codexAppServer.steer(sourceTask.id, prompt, storedAttachments);
        } catch (error) {
          queue.discardTaskAttachments(sourceTask.id, storedAttachments);
          throw error;
        }
        queue.commitTaskAttachments(sourceTask.id, storedAttachments);
        diagnostic('api.task.steered', steered);
        sendJson(response, 200, {
          task: database.getTask(sourceTask.id),
          steered: true,
          threadId: steered.threadId,
          turnId: steered.turnId,
        });
        return;
      }
      if (sourceTask.provider === 'claude') {
        const claudeRuntimeStatus = currentClaudeStatus(true);
        if (!claudeRuntimeStatus.available || !claudeRuntimeStatus.authenticated) {
          throw new Error('Claude continuation needs a signed-in Claude Code CLI. Run `claude auth login`; Relay will detect it automatically.');
        }
      }
      const thread = sourceTask.provider === 'codex'
        ? await codexAppServer.readConnectedThread(sourceTask.thread_id)
        : await claudeSessions.readConnectedSession(sourceTask.thread_id);
      if (!thread) {
        throw new Error(sourceTask.provider === 'claude'
          ? 'The original Claude session is no longer open. Reopen that conversation before continuing.'
          : 'The original Codex Relay is no longer connected. Reconnect it before continuing.');
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
      }));
      diagnostic('api.task.follow_up_started', {
        sourceTaskId: sourceTask.id,
        threadId: task.thread_id,
        provider: task.provider,
        model: task.model,
        effort: task.effort,
      });
      sendJson(response, 202, {
        task,
        followUpStarted: true,
        threadId: task.thread_id,
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
        plan: task.mode === 'plan' ? readPlanRecord(taskId) : null,
        turboPlan: task.mode === 'turbo' ? artifacts.readTurboPlan(taskId) : null,
      });
      return;
    }

    if (request.method === 'PATCH' && /^\/api\/tasks\/\d+$/.test(pathname)) {
      const taskId = taskIdFromPath(pathname);
      const body = await readJson(request, MAX_TASK_REQUEST_BYTES);
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
      if (!prompt) throw new Error('Task prompt is required.');
      if (prompt.length > 12_000) throw new Error('Task prompt must be 12,000 characters or fewer.');
      const task = queue.edit(taskId, { title: titleFromPrompt(prompt), prompt });
      diagnostic('api.task.edited', { taskId, repoPath: task.repo_path, mode: task.mode, provider: task.provider });
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
      const plan = readPlanRecord(sourceTaskId);
      const body = await readJson(request);
      const provider = typeof body.provider === 'string' ? body.provider.trim() : '';
      if (!['codex', 'claude'].includes(provider)) {
        throw new Error('Choose whether Codex or Claude should execute the reviewed plan.');
      }
      const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
      const thread = provider === 'codex'
        ? await codexAppServer.readConnectedThread(threadId)
        : await claudeSessions.readConnectedSession(threadId);
      const finalPlan = validatePlanExecution({ sourceTask, plan, thread, provider });
      if (provider === 'claude') {
        const claudeRuntimeStatus = currentClaudeStatus(true);
        if (!claudeRuntimeStatus.available || !claudeRuntimeStatus.authenticated) {
          throw new Error('Claude execution needs a signed-in Claude Code CLI. Run `claude auth login`; Relay will detect it automatically.');
        }
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
          !filePath.startsWith(`${attachmentRoot}/`)
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
          planPath: artifacts.planPath(sourceTask.id),
        }),
        thread,
        provider,
        mode: 'execute',
        ...execution,
        attachments,
        continuedFromTaskId: sourceTask.id,
        runNow: body.runNow === true,
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
      if (task.mode === 'plan') {
        const body = await readJson(request);
        const requestedThreadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
        const reviewerThreadId = requestedThreadId || task.thread_id;
        const reviewerThread = reviewerThreadId
          ? await codexAppServer.readConnectedThread(reviewerThreadId)
          : null;
        if (!reviewerThread) {
          throw new Error('Choose a connected Codex Relay before resuming the Plan council.');
        }
        if (resolve(reviewerThread.cwd) !== resolve(task.repo_path)) {
          throw new Error('The Plan council reviewer must use a Relay in the same workspace.');
        }
        const plan = readPlanRecord(taskId);
        if (plan?.status !== 'complete') {
          const claudeRuntimeStatus = currentClaudeStatus(true);
          if (!claudeRuntimeStatus.available || !claudeRuntimeStatus.authenticated) {
            throw new Error('Plan council needs a signed-in Claude Code CLI. Run `claude auth login`; Relay will detect it automatically.');
          }
        }
        if (reviewerThread.id !== task.thread_id) {
          const reassigned = database.updateTask(taskId, {
            thread_id: reviewerThread.id,
            thread_name: reviewerThread.title,
            thread_source: reviewerThread.source,
          });
          artifacts.updateTaskAssignment(reassigned);
          database.addEvent(taskId, 'queue', `Plan council reviewer moved to ${reviewerThread.title}.`);
        }
      }
      sendJson(response, 200, { task: queue.retry(taskId) });
      return;
    }

    if (request.method === 'POST' && /^\/api\/tasks\/\d+\/assign$/.test(pathname)) {
      const taskId = taskIdFromPath(pathname);
      const task = database.getTask(taskId);
      if (!task) throw new Error('Task not found.');
      if (task.mode !== 'execute' || task.provider !== 'codex') {
        throw new Error('Only queued Codex tasks can be assigned to another terminal.');
      }
      const body = await readJson(request);
      const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
      const thread = threadId ? await codexAppServer.readConnectedThread(threadId) : null;
      if (!thread) throw new Error('That Codex terminal is no longer connected. Refresh and try again.');
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
    const statusCode = error instanceof SyntaxError ? 400 : 422;
    sendError(response, statusCode, error.message || 'Request failed.');
  }
});

server.once('error', (error) => {
  diagnostic('relay.listen.failed', { host: HOST, port: PORT, dataRoot: DATA_ROOT, error: error.message });
  console.error(`Relay could not listen at http://${HOST}:${PORT}: ${error.message}`);
  codexAppServer.close();
  database.close();
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  queue.start();
  diagnostic('relay.started', { host: HOST, port: PORT, dataRoot: DATA_ROOT });
  codexAppServer.start().catch((error) => {
    diagnostic('appserver.background_start.failed', { error: error.message });
    console.error(`Codex app-server could not start: ${error.message}`);
  });
  console.log(`Relay is running at http://${HOST}:${PORT}`);
  if (!runtimeStatus.available || !runtimeStatus.authenticated) {
    console.log('Codex is unavailable or not authenticated. Check `codex login status`.');
  }
});

export async function shutdown() {
  for (const client of sseClients) {
    client.end();
  }
  sseClients.clear();
  server.close();
  await queue.shutdown();
  await projectLauncher.closeOwnedTerminals();
  codexAppServer.close();
  database.close();
}

process.once('SIGINT', () => shutdown().catch(console.error));
process.once('SIGTERM', () => shutdown().catch(console.error));
