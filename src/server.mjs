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
import { ClaudeExecutionRunner } from './claude-execution-runner.mjs';
import { ClaudeRunner } from './claude-runner.mjs';
import { ClaudeSessionRegistry } from './claude-session-registry.mjs';
import { CodexAppServer } from './codex-app-server.mjs';
import { RelayDatabase } from './database.mjs';
import { DiagnosticLog } from './diagnostics.mjs';
import { CLAUDE_MODELS, validateExecutionSettings } from './model-catalog.mjs';
import { PlanCouncilRunner } from './plan-council-runner.mjs';
import { buildParallelCodexPrompt } from './parallel-batch.mjs';
import { ProjectLauncher, validateProjectPath } from './project-launcher.mjs';
import { TaskQueue } from './queue.mjs';
import { TurboRunner } from './turbo-runner.mjs';
import { RelayRunner } from './relay-runner.mjs';

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
const claudeRunner = new ClaudeRunner();
const claudeSessions = new ClaudeSessionRegistry();
const claudeExecution = new ClaudeExecutionRunner({ sessions: claudeSessions });
const planCouncil = new PlanCouncilRunner({
  claude: claudeRunner,
  codex: codexAppServer,
  artifacts,
});
const turboRunner = new TurboRunner({ codex: codexAppServer, artifacts });
const runner = new RelayRunner({
  codex: codexAppServer,
  claude: claudeExecution,
  planCouncil,
  turbo: turboRunner,
});
const queue = new TaskQueue({ database, artifacts, runner });
const projectLauncher = new ProjectLauncher({ diagnostic });
const sseClients = new Set();

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

function claudeStatus() {
  try {
    const version = execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim();
    const auth = JSON.parse(execFileSync(
      'claude',
      ['auth', 'status', '--json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ));
    return {
      available: true,
      authenticated: auth.loggedIn === true,
      version,
      authMethod: auth.authMethod || null,
      subscriptionType: auth.subscriptionType || null,
    };
  } catch (error) {
    return { available: false, authenticated: false, version: null, error: error.message };
  }
}

const claudeRuntimeStatus = claudeStatus();

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
      sendJson(response, 200, {
        ...queue.status(),
        codex: { ...runtimeStatus, appServer: codexAppServer.status() },
        claude: claudeRuntimeStatus,
        capabilities: {
          directClaudeExecution: true,
          imageAttachments: true,
          planCouncil: true,
          queueReorder: true,
          projectLauncher: true,
          parallelCodexBatch: true,
          turboExecution: true,
        },
        taskCount: database.listTasks().length,
        diagnostics: { endpoint: '/api/diagnostics', file: diagnostics.filePath },
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/threads') {
      const [codexResult, claudeResult] = await Promise.allSettled([
        codexAppServer.listConnectedThreads(),
        claudeSessions.listSessions(),
      ]);
      const codexThreads = codexResult.status === 'fulfilled' ? codexResult.value : [];
      const claudeThreads = claudeResult.status === 'fulfilled' ? claudeResult.value : [];
      const threads = [...codexThreads, ...claudeThreads];
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
          claudeLaunchCommand: 'claude --dangerously-skip-permissions',
          claudeDiscoveryError: claudeSessions.lastError,
          codexDiscoveryError: codexResult.status === 'rejected' ? codexResult.reason.message : null,
        },
      });
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
      sendJson(response, 200, { tasks: database.listTasks() });
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
        ? await projectLauncher.launch(project.path, body.provider || 'codex', body.layout)
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
      const launched = await projectLauncher.launch(project.path, provider, body.layout);
      sendJson(response, 200, { project: database.markProjectLaunched(project.id), launched });
      return;
    }

    if (request.method === 'DELETE' && projectMatch && !projectMatch[2]) {
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
        const task = queue.enqueue({
          title: titleFromPrompt(prompt), prompt, thread, provider: 'codex', mode, attachments, runNow,
          model: planner.model, effort: planner.effort,
          turbo: {
            plannerThreadId: thread.id,
            plannerModel: planner.model,
            plannerEffort: planner.effort,
            workerModel: worker.model,
            workerEffort: worker.effort,
            workerCount,
            workers: workerThreads.map((item) => ({ threadId: item.id, title: item.title })),
          },
        });
        sendJson(response, 201, { task });
        return;
      }

      if (mode === 'plan') {
        if (!claudeRuntimeStatus.available || !claudeRuntimeStatus.authenticated) {
          throw new Error('Plan council needs a signed-in Claude Code CLI. Run `claude auth login`, then restart Relay.');
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
        });
        sendJson(response, 201, { task });
        return;
      }

      if (provider === 'claude') {
        if (!claudeRuntimeStatus.available || !claudeRuntimeStatus.authenticated) {
          throw new Error('Claude execution needs a signed-in Claude Code CLI. Run `claude auth login`, then restart Relay.');
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
        plan: task.mode === 'plan' ? artifacts.readPlan(taskId) : null,
        turboPlan: task.mode === 'turbo' ? artifacts.readTurboPlan(taskId) : null,
      });
      return;
    }

    if (request.method === 'POST' && /^\/api\/tasks\/\d+\/cancel$/.test(pathname)) {
      const taskId = taskIdFromPath(pathname);
      queue.cancel(taskId);
      sendJson(response, 200, { task: database.getTask(taskId) });
      return;
    }

    if (request.method === 'POST' && /^\/api\/tasks\/\d+\/retry$/.test(pathname)) {
      const taskId = taskIdFromPath(pathname);
      sendJson(response, 200, { task: queue.retry(taskId) });
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
      queue.pause();
      sendJson(response, 200, queue.status());
      return;
    }

    if (request.method === 'POST' && pathname === '/api/queue/resume') {
      queue.resume();
      sendJson(response, 200, queue.status());
      return;
    }

    if (request.method === 'POST' && pathname === '/api/queue/reorder') {
      const body = await readJson(request);
      const tasks = queue.reorder(body.taskIds);
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

queue.start();
diagnostic('relay.started', { host: HOST, port: PORT, dataRoot: DATA_ROOT });
codexAppServer.start().catch((error) => {
  diagnostic('appserver.background_start.failed', { error: error.message });
  console.error(`Codex app-server could not start: ${error.message}`);
});

server.listen(PORT, HOST, () => {
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
  codexAppServer.close();
  database.close();
}

process.once('SIGINT', () => shutdown().catch(console.error));
process.once('SIGTERM', () => shutdown().catch(console.error));
