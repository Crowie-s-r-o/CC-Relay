import {
  entryFirstEvent,
  entryItem,
  entryLastEvent,
  eventEntryCategory,
  filterEventEntries,
  groupEventEntries,
  eventStreamStats,
} from './event-stream.js';
import { taskDurationLabel } from './task-time.js';
import { clipboardImageFiles } from './clipboard-images.js';

const EFFORT_DESCRIPTIONS = {
  low: 'Fastest for small, well-scoped work.',
  medium: 'Balanced speed and reasoning.',
  high: 'More analysis for difficult changes.',
  xhigh: 'Deeper reasoning for agentic work.',
  max: 'Maximum depth for the hardest tasks.',
  ultra: 'Maximum reasoning with proactive delegation.',
};

const MAX_IMAGE_ATTACHMENTS = 99;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function effortOptions(values) {
  return values.map((reasoningEffort) => ({
    reasoningEffort,
    description: EFFORT_DESCRIPTIONS[reasoningEffort] || '',
  }));
}

function catalogModel(model, displayName, description, options = {}) {
  return {
    model,
    displayName,
    description,
    isDefault: Boolean(options.isDefault),
    defaultReasoningEffort: options.defaultEffort || null,
    supportedReasoningEfforts: effortOptions(options.efforts || []),
  };
}

const FALLBACK_MODELS = {
  codex: [
    catalogModel('gpt-5.6-sol', 'GPT-5.6-Sol', 'Detail and polish for complex, open-ended work.', { isDefault: true, defaultEffort: 'low', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] }),
    catalogModel('gpt-5.6-terra', 'GPT-5.6-Terra', 'Fast everyday model for exploration and implementation.', { defaultEffort: 'medium', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] }),
    catalogModel('gpt-5.6-luna', 'GPT-5.6-Luna', 'Clear and repeatable work with predictable output.', { defaultEffort: 'medium', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }),
    catalogModel('gpt-5.5', 'GPT-5.5', 'Previous-generation general coding model.', { defaultEffort: 'medium', efforts: ['low', 'medium', 'high', 'xhigh'] }),
    catalogModel('gpt-5.4', 'GPT-5.4', 'Strong coding and tool use for pinned workflows.', { defaultEffort: 'medium', efforts: ['low', 'medium', 'high', 'xhigh'] }),
    catalogModel('gpt-5.4-mini', 'GPT-5.4-Mini', 'Smaller model for quick, narrow tasks.', { defaultEffort: 'medium', efforts: ['low', 'medium', 'high', 'xhigh'] }),
    catalogModel('gpt-5.3-codex-spark', 'GPT-5.3-Codex-Spark', 'Near-instant text-only iteration when available.', { defaultEffort: 'high', efforts: ['low', 'medium', 'high', 'xhigh'] }),
  ],
  claude: [
    catalogModel('default', 'Account default', 'Use the recommended Claude model for this account.', { isDefault: true, defaultEffort: 'high', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }),
    catalogModel('best', 'Best available', 'Use Fable when available, otherwise the latest Opus model.', { defaultEffort: 'high', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }),
    catalogModel('fable', 'Fable', 'Claude model for the hardest and longest-running tasks.', { defaultEffort: 'high', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }),
    catalogModel('opus', 'Opus', 'Latest Opus model for complex reasoning and implementation.', { defaultEffort: 'high', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }),
    catalogModel('sonnet', 'Sonnet', 'Latest Sonnet model for daily coding work.', { defaultEffort: 'high', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }),
    catalogModel('haiku', 'Haiku', 'Fast Claude model for simple and narrow tasks.'),
  ],
};

const state = {
  tasks: [],
  projects: [],
  activeProjectPath: localStorage.getItem('relay.activeProjectPath') || null,
  showAllTaskHistory: localStorage.getItem('relay.showAllTaskHistory') !== 'false',
  panelWidths: (() => {
    try {
      const saved = JSON.parse(localStorage.getItem('relay.panelWidths') || '{}');
      return {
        composer: Number.isFinite(saved.composer) ? saved.composer : 540,
        detail: Number.isFinite(saved.detail) ? saved.detail : 620,
      };
    } catch {
      return { composer: 540, detail: 620 };
    }
  })(),
  threads: [],
  providers: [],
  connection: null,
  status: null,
  selectedTaskId: null,
  selectedThreadId: null,
  selectedProvider: 'codex',
  taskMode: 'execute',
  reorderPending: false,
  loadPromise: null,
  threadLoadSequence: 0,
  submitting: false,
  prioritySubmit: false,
  draggedTaskId: null,
  assigningTaskId: null,
  preferIdleTerminal: localStorage.getItem('relay.preferIdleTerminal') === 'true',
  parallelTaskIds: new Set(),
  attachments: [],
  eventFilter: 'highlights',
  eventFollow: true,
  eventTaskId: null,
  selectedTaskEvents: [],
  selectedTaskForEvents: null,
  visibleEventEntries: [],
  expandedEventDetails: new Set(),
  modelCatalogs: {
    codex: FALLBACK_MODELS.codex,
    claude: FALLBACK_MODELS.claude,
  },
  executionSettings: {
    codex: { model: null, effort: '' },
    claude: { model: null, effort: '' },
  },
  planSettings: {
    authorModel: 'fable',
    authorEffort: 'max',
    reviewerModel: null,
    reviewerEffort: 'high',
  },
  turboSettings: {
    plannerModel: 'gpt-5.6-sol',
    plannerEffort: 'high',
    workerModel: 'gpt-5.6-luna',
    workerEffort: 'high',
    workerCount: 3,
  },
};

const elements = {
  form: document.querySelector('#task-form'),
  formMessage: document.querySelector('#form-message'),
  submitButton: document.querySelector('#task-submit-button'),
  codexStatus: document.querySelector('#codex-status'),
  codexStatusLabel: document.querySelector('#codex-status-label'),
  providerInput: document.querySelector('#provider-id'),
  modeTabs: [...document.querySelectorAll('.mode-tab')],
  executeConfig: document.querySelector('#execute-config'),
  planConfig: document.querySelector('#plan-config'),
  turboConfig: document.querySelector('#turbo-config'),
  providerTabs: [...document.querySelectorAll('.agent-tab')],
  providerCodexCount: document.querySelector('#provider-codex-count'),
  providerClaudeCount: document.querySelector('#provider-claude-count'),
  agentMessage: document.querySelector('#agent-message'),
  executionControls: document.querySelector('#execution-controls'),
  modelSelect: document.querySelector('#model-select'),
  modelHint: document.querySelector('#model-hint'),
  effortSelect: document.querySelector('#effort-select'),
  effortHint: document.querySelector('#effort-hint'),
  effortSliderValue: document.querySelector('#effort-slider-value'),
  effortSliderSteps: document.querySelector('#effort-slider-steps'),
  planAuthorModel: document.querySelector('#plan-author-model'),
  planReviewerModel: document.querySelector('#plan-reviewer-model'),
  planReviewerEffort: document.querySelector('#plan-reviewer-effort'),
  planClaudeReady: document.querySelector('#plan-claude-ready'),
  planCodexReady: document.querySelector('#plan-codex-ready'),
  turboPlannerModel: document.querySelector('#turbo-planner-model'),
  turboPlannerEffort: document.querySelector('#turbo-planner-effort'),
  turboWorkerModel: document.querySelector('#turbo-worker-model'),
  turboWorkerEffort: document.querySelector('#turbo-worker-effort'),
  turboWorkerCount: document.querySelector('#turbo-worker-count'),
  turboReadiness: document.querySelector('#turbo-readiness'),
  terminalPanel: document.querySelector('#terminal-panel'),
  terminalLegend: document.querySelector('#terminal-legend'),
  threadInput: document.querySelector('#thread-id'),
  terminalList: document.querySelector('#terminal-list'),
  sessionMessage: document.querySelector('#session-message'),
  sessionRefreshButton: document.querySelector('#session-refresh-button'),
  preferIdleTerminal: document.querySelector('#prefer-idle-terminal'),
  idleTerminalRoute: document.querySelector('#idle-terminal-route'),
  connectionHelp: document.querySelector('#connection-help'),
  connectionHelpTitle: document.querySelector('#connection-help-title'),
  connectionHelpCopy: document.querySelector('#connection-help-copy'),
  connectionCommandRow: document.querySelector('#connection-command-row'),
  launchCommand: document.querySelector('#launch-command'),
  copyCommandButton: document.querySelector('#copy-command-button'),
  launchTerminalButton: document.querySelector('#launch-terminal-button'),
  copyDiagnosticsButton: document.querySelector('#copy-diagnostics-button'),
  terminalLayoutEnabled: document.querySelector('#terminal-layout-enabled'),
  terminalLayoutColumns: document.querySelector('#terminal-layout-columns'),
  terminalLayoutRows: document.querySelector('#terminal-layout-rows'),
  terminalLayoutDisplay: document.querySelector('#terminal-layout-display'),
  pauseButton: document.querySelector('#pause-button'),
  refreshButton: document.querySelector('#refresh-button'),
  taskScopeButton: document.querySelector('#task-scope-button'),
  queueSummary: document.querySelector('#queue-summary'),
  taskList: document.querySelector('#task-list'),
  parallelBatchBar: document.querySelector('#parallel-batch-bar'),
  parallelSelectionCount: document.querySelector('#parallel-selection-count'),
  parallelSessionSelect: document.querySelector('#parallel-session-select'),
  parallelClearButton: document.querySelector('#parallel-clear-button'),
  parallelRunButton: document.querySelector('#parallel-run-button'),
  emptyDetail: document.querySelector('#empty-detail'),
  taskDetail: document.querySelector('#task-detail'),
  detailTitle: document.querySelector('#detail-title'),
  detailMeta: document.querySelector('#detail-meta'),
  detailActions: document.querySelector('#detail-actions'),
  detailPrompt: document.querySelector('#detail-prompt'),
  resultSection: document.querySelector('#result-section'),
  detailResult: document.querySelector('#detail-result'),
  detailEvents: document.querySelector('#detail-events'),
  eventSessionState: document.querySelector('#event-session-state'),
  eventSummary: document.querySelector('#event-summary'),
  eventMetrics: document.querySelector('#event-metrics'),
  eventFilters: [...document.querySelectorAll('[data-event-filter]')],
  copyEventsButton: document.querySelector('#copy-events-button'),
  followEventsButton: document.querySelector('#follow-events-button'),
  planPreview: document.querySelector('#plan-preview'),
  planStatus: document.querySelector('#plan-status'),
  planStageRail: document.querySelector('#plan-stage-rail'),
  planAgentSummary: document.querySelector('#plan-agent-summary'),
  planWaiting: document.querySelector('#plan-waiting'),
  planDraftSection: document.querySelector('#plan-draft-section'),
  planDraft: document.querySelector('#plan-draft'),
  planReviewSection: document.querySelector('#plan-review-section'),
  planReview: document.querySelector('#plan-review'),
  planFinalSection: document.querySelector('#plan-final-section'),
  planFinal: document.querySelector('#plan-final'),
  turboPreview: document.querySelector('#turbo-preview'),
  turboPreviewStatus: document.querySelector('#turbo-preview-status'),
  turboPreviewSummary: document.querySelector('#turbo-preview-summary'),
  turboTaskGraph: document.querySelector('#turbo-task-graph'),
  prompt: document.querySelector('#task-prompt'),
  promptLabel: document.querySelector('#prompt-label'),
  attachmentRoute: document.querySelector('#attachment-route'),
  attachmentCount: document.querySelector('#attachment-count'),
  attachmentDropzone: document.querySelector('#attachment-dropzone'),
  attachmentInput: document.querySelector('#image-input'),
  attachmentList: document.querySelector('#attachment-list'),
  detailAttachmentsSection: document.querySelector('#detail-attachments-section'),
  detailAttachmentsCount: document.querySelector('#detail-attachments-count'),
  detailAttachments: document.querySelector('#detail-attachments'),
  statusRelay: document.querySelector('#status-relay'),
  statusRelayValue: document.querySelector('#status-relay-value'),
  statusRelayDetail: document.querySelector('#status-relay-detail'),
  statusTerminals: document.querySelector('#status-terminals'),
  statusTerminalsValue: document.querySelector('#status-terminals-value'),
  statusTerminalsDetail: document.querySelector('#status-terminals-detail'),
  statusQueue: document.querySelector('#status-queue'),
  statusQueueValue: document.querySelector('#status-queue-value'),
  statusQueueDetail: document.querySelector('#status-queue-detail'),
  statusActive: document.querySelector('#status-active'),
  statusActiveValue: document.querySelector('#status-active-value'),
  statusActiveDetail: document.querySelector('#status-active-detail'),
  projectList: document.querySelector('#project-list'),
  addProjectButton: document.querySelector('#add-project-button'),
  addLaunchProjectButton: document.querySelector('#add-launch-project-button'),
  workspace: document.querySelector('.workspace'),
  composerQueueResizer: document.querySelector('#composer-queue-resizer'),
  queueDetailResizer: document.querySelector('#queue-detail-resizer'),
};

const storedTerminalLayout = (() => {
  try {
    return JSON.parse(localStorage.getItem('relay.terminalLayout') || 'null');
  } catch {
    return null;
  }
})();

function terminalLayout() {
  return {
    enabled: elements.terminalLayoutEnabled.checked,
    columns: Number(elements.terminalLayoutColumns.value),
    rows: Number(elements.terminalLayoutRows.value),
    display: Number(elements.terminalLayoutDisplay.value),
  };
}

function saveTerminalLayout() {
  localStorage.setItem('relay.terminalLayout', JSON.stringify(terminalLayout()));
}

async function loadTerminalDisplays() {
  if (storedTerminalLayout) {
    elements.terminalLayoutEnabled.checked = storedTerminalLayout.enabled !== false;
    elements.terminalLayoutColumns.value = storedTerminalLayout.columns || 3;
    elements.terminalLayoutRows.value = storedTerminalLayout.rows || 3;
  }
  const body = await api('/api/terminal-displays');
  const displays = body.displays || [];
  elements.terminalLayoutDisplay.innerHTML = displays.map((display, index) => (
    `<option value="${index}">${escapeHtml(display.name || `Monitor ${index + 1}`)} · ${display.width}×${display.height}${display.primary ? ' · Primary' : ''}</option>`
  )).join('') || '<option value="0">Primary monitor</option>';
  const selectedDisplay = Number(storedTerminalLayout?.display || 0);
  elements.terminalLayoutDisplay.value = String(Math.min(selectedDisplay, Math.max(0, displays.length - 1)));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || `Request failed with status ${response.status}.`);
  }
  return body;
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

function projectProvider() {
  return state.taskMode === 'execute' ? state.selectedProvider : 'codex';
}

function normalizedPath(path) {
  return String(path || '').replace(/[\\/]+$/, '').replaceAll('\\', '/');
}

function compactProjectPath(path) {
  return normalizedPath(path).split('/').filter(Boolean).slice(-2).join(' / ');
}

function sameProjectPath(left, right) {
  return normalizedPath(left) === normalizedPath(right);
}

function activeProject() {
  return state.projects.find((project) => sameProjectPath(project.path, state.activeProjectPath)) || null;
}

function projectTasks() {
  if (state.showAllTaskHistory) return state.tasks;
  if (state.selectedThreadId) {
    return state.tasks.filter((task) => task.thread_id === state.selectedThreadId);
  }
  return state.activeProjectPath
    ? state.tasks.filter((task) => sameProjectPath(task.repo_path, state.activeProjectPath))
    : state.tasks;
}

function renderTaskScope() {
  const showingAll = state.showAllTaskHistory || (!state.selectedThreadId && !state.activeProjectPath);
  elements.taskScopeButton.hidden = !state.selectedThreadId && !state.activeProjectPath;
  elements.taskScopeButton.textContent = showingAll
    ? 'All history'
    : state.selectedThreadId ? 'This session' : 'This project';
  elements.taskScopeButton.setAttribute('aria-pressed', String(showingAll));
  elements.taskScopeButton.title = showingAll
    ? 'Show only tasks from the selected project'
    : 'Show task history from every project';
}

function projectThreads(provider = state.selectedProvider) {
  return state.threads.filter((thread) => (
    threadProvider(thread) === provider
    && (!state.activeProjectPath || sameProjectPath(thread.cwd, state.activeProjectPath))
  ));
}

function selectProject(path) {
  state.activeProjectPath = path || null;
  if (state.activeProjectPath) localStorage.setItem('relay.activeProjectPath', state.activeProjectPath);
  else localStorage.removeItem('relay.activeProjectPath');
  state.selectedThreadId = null;
  state.selectedTaskId = null;
  state.parallelTaskIds.clear();
  elements.taskDetail.hidden = true;
  elements.emptyDetail.hidden = false;
  renderProjects();
  renderThreads();
  renderTasks();
  renderStatus();
  renderTaskScope();
}

function renderProjects() {
  const supported = state.status?.capabilities?.projectLauncher === true;
  elements.addProjectButton.disabled = !supported;
  elements.addLaunchProjectButton.disabled = !supported;
  if (!supported) {
    elements.projectList.innerHTML = '<span class="project-empty">Restart Relay to enable project launching</span>';
    return;
  }
  if (!state.projects.length) {
    elements.projectList.innerHTML = '<span class="project-empty">Pin a folder for one-click terminal launch</span>';
    return;
  }
  elements.projectList.innerHTML = state.projects.map((project) => {
    const activity = projectActivity(project.path);
    return `
    <article class="project-chip ${sameProjectPath(project.path, state.activeProjectPath) ? 'selected' : ''}" data-activity="${activity.state}" data-project-id="${project.id}" data-project-path="${escapeHtml(project.path)}" title="${escapeHtml(project.path)}" tabindex="0" role="button" aria-pressed="${sameProjectPath(project.path, state.activeProjectPath)}">
      <span class="project-pin" aria-hidden="true">${escapeHtml(project.name.slice(0, 1).toUpperCase())}</span>
      <span class="project-copy"><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(compactProjectPath(project.path))}</small><span class="project-activity"><i aria-hidden="true"></i>${escapeHtml(activity.label)}</span></span>
      <span class="project-launchers">
        <button class="project-launch project-launch-codex" type="button" data-project-action="launch" data-provider="codex" aria-label="Launch Codex in ${escapeHtml(project.name)}"><span aria-hidden="true">&gt;_</span> Codex</button>
        <button class="project-launch project-launch-claude" type="button" data-project-action="launch" data-provider="claude" aria-label="Launch Claude in ${escapeHtml(project.name)}"><span class="project-launch-icon" aria-hidden="true">✳</span><span>Claude</span></button>
        <button class="project-unpin" type="button" data-project-action="delete" aria-label="Unpin ${escapeHtml(project.name)}">×</button>
      </span>
    </article>
  `;
  }).join('');
}

function projectActivity(path) {
  const tasks = state.tasks.filter((task) => sameProjectPath(task.repo_path, path));
  const running = tasks.filter((task) => task.status === 'running');
  const queued = tasks.filter((task) => task.status === 'queued');
  if (running.length > 0) {
    const task = running[0];
    return {
      state: 'running',
      label: `${running.length} running${queued.length ? ` · ${queued.length} waiting` : ''} · #${task.id} ${compactText(task.prompt, 34)}`,
    };
  }
  if (queued.length > 0) return { state: 'queued', label: `${queued.length} task${queued.length === 1 ? '' : 's'} waiting` };
  const latest = tasks.reduce((current, task) => !current || task.id > current.id ? task : current, null);
  if (latest && ['failed', 'interrupted'].includes(latest.status)) {
    return { state: 'error', label: `Needs attention · Task #${latest.id} ${latest.status}` };
  }
  return { state: 'idle', label: latest?.status === 'complete' ? `Idle · Last completed #${latest.id}` : 'Idle' };
}

function relayActivity(thread) {
  const direct = state.tasks.find((task) => task.status === 'running' && task.thread_id === thread.id);
  if (direct) return { state: 'running', label: `Task #${direct.id} · ${compactText(direct.prompt, 72)}` };
  const turbo = state.tasks.find((task) => task.status === 'running' && task.mode === 'turbo' && (
    task.turbo?.plannerThreadId === thread.id
    || task.turbo?.workers?.some((worker) => worker.threadId === thread.id)
  ));
  if (turbo) {
    const planner = turbo.turbo?.plannerThreadId === thread.id;
    return { state: 'running', label: `${planner ? 'Turbo planner' : 'Turbo worker'} · Task #${turbo.id}` };
  }
  const queued = state.tasks.filter((task) => task.status === 'queued' && task.thread_id === thread.id);
  if (queued.length > 0) return { state: 'queued', label: `${queued.length} assigned · Next #${queued[0].id} ${compactText(queued[0].prompt, 54)}` };
  return { state: thread.status === 'idle' ? 'idle' : thread.status, label: thread.status === 'idle' ? 'Idle · Ready for work' : compactText(thread.title || thread.preview, 72) };
}

async function loadProjects() {
  if (state.status?.capabilities?.projectLauncher !== true) {
    renderProjects();
    return;
  }
  const body = await api('/api/projects');
  state.projects = body.projects || [];
  if (state.activeProjectPath && !state.projects.some((project) => sameProjectPath(project.path, state.activeProjectPath))) {
    state.activeProjectPath = null;
    localStorage.removeItem('relay.activeProjectPath');
  }
  if (!state.activeProjectPath && state.projects.length) {
    const selectedThread = state.threads.find((thread) => thread.id === state.selectedThreadId);
    const initialProject = state.projects.find((project) => sameProjectPath(project.path, selectedThread?.cwd))
      || state.projects.find((project) => state.threads.some((thread) => sameProjectPath(project.path, thread.cwd)))
      || state.projects[0];
    state.activeProjectPath = initialProject.path;
    localStorage.setItem('relay.activeProjectPath', initialProject.path);
  }
  renderProjects();
  renderTaskScope();
}

async function chooseProject(launch) {
  const previousIds = new Set(state.threads.map((thread) => thread.id));
  elements.addProjectButton.disabled = true;
  elements.addLaunchProjectButton.disabled = true;
  try {
    const body = await api('/api/projects/choose', {
      method: 'POST',
      body: JSON.stringify({ launch, provider: projectProvider(), layout: terminalLayout() }),
    });
    if (!body.cancelled) {
      await loadProjects();
      selectProject(body.project.path);
      if (launch) await waitForProjectThread(body.project.path, projectProvider(), previousIds);
    }
  } catch (error) {
    elements.formMessage.textContent = error.message;
  } finally {
    renderProjects();
  }
}

async function waitForProjectThread(path, provider, previousIds = new Set()) {
  const deadline = Date.now() + 15_000;
  let candidateId = null;
  let candidateObservations = 0;
  while (Date.now() < deadline) {
    await loadThreads({ silent: true });
    const matches = state.threads.filter((thread) => (
      threadProvider(thread) === provider
      && sameProjectPath(thread.cwd, path)
      && !previousIds.has(thread.id)
    ));
    const thread = matches[0];
    if (thread?.id === candidateId) {
      candidateObservations += 1;
    } else {
      candidateId = thread?.id || null;
      candidateObservations = thread ? 1 : 0;
    }
    if (thread && candidateObservations >= 2) {
      state.selectedProvider = provider;
      state.selectedThreadId = thread.id;
      renderProviderTabs();
      renderThreads();
      applyThreadSelection(thread.id);
      elements.formMessage.textContent = `${providerLabel(provider)} is ready in ${workspaceName(path)}.`;
      return thread;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  elements.formMessage.textContent = `The terminal opened, but ${providerLabel(provider)} has not connected yet. It will appear automatically when ready.`;
  return null;
}

async function launchProject(project, provider) {
  const previousIds = new Set(state.threads.map((thread) => thread.id));
  selectProject(project.path);
  await api(`/api/projects/${project.id}/launch`, {
    method: 'POST',
    body: JSON.stringify({ provider, layout: terminalLayout() }),
  });
  await loadProjects();
  await waitForProjectThread(project.path, provider, previousIds);
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function renderMarkdown(value) {
  const lines = String(value || '').replace(/\r\n/g, '\n').split('\n');
  const output = [];
  let list = null;
  let inCode = false;
  let codeLines = [];

  const closeList = () => {
    if (list) {
      output.push(`</${list}>`);
      list = null;
    }
  };

  for (const line of lines) {
    if (/^```/.test(line)) {
      closeList();
      if (inCode) {
        output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length + 2, 6);
      output.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
    } else if (unordered || ordered) {
      const nextList = unordered ? 'ul' : 'ol';
      if (list !== nextList) {
        closeList();
        list = nextList;
        output.push(`<${list}>`);
      }
      output.push(`<li>${renderInlineMarkdown((unordered || ordered)[1])}</li>`);
    } else if (/^>\s?/.test(line)) {
      closeList();
      output.push(`<blockquote>${renderInlineMarkdown(line.replace(/^>\s?/, ''))}</blockquote>`);
    } else if (line.trim()) {
      closeList();
      output.push(`<p>${renderInlineMarkdown(line.trim())}</p>`);
    } else {
      closeList();
    }
  }

  closeList();
  if (inCode) {
    output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  }
  return output.join('');
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () => reject(new Error(`Could not read ${file.name}.`)));
    reader.readAsDataURL(file);
  });
}

function renderAttachmentComposer() {
  const totalBytes = state.attachments.reduce((total, attachment) => total + attachment.size, 0);
  const available = state.status?.capabilities?.imageAttachments === true;
  elements.attachmentCount.textContent = `${state.attachments.length} / ${MAX_IMAGE_ATTACHMENTS}`;
  elements.attachmentCount.title = `${formatBytes(totalBytes)} attached`;
  elements.attachmentRoute.textContent = !state.status
    ? 'Checking local image support.'
    : !available
      ? 'Restart Relay once to enable image attachments.'
      : state.taskMode === 'plan'
        ? 'Sent to Claude and Codex throughout the review loop.'
        : 'Sent to the selected AI with the prompt.';
  const full = state.attachments.length >= MAX_IMAGE_ATTACHMENTS;
  elements.attachmentDropzone.dataset.state = !available ? 'unavailable' : full ? 'full' : 'ready';
  elements.attachmentInput.disabled = full || !available;
  elements.attachmentList.innerHTML = state.attachments.map((attachment, index) => `
    <article class="attachment-card">
      <img src="${attachment.data}" alt="Preview of ${escapeHtml(attachment.name)}">
      <span class="attachment-order">${String(index + 1).padStart(2, '0')}</span>
      <span class="attachment-card-copy">
        <strong title="${escapeHtml(attachment.name)}">${escapeHtml(attachment.name)}</strong>
        <small>${escapeHtml(formatBytes(attachment.size))}</small>
      </span>
      <button type="button" data-remove-attachment="${escapeHtml(attachment.id)}" aria-label="Remove ${escapeHtml(attachment.name)}">×</button>
    </article>
  `).join('');

  for (const button of elements.attachmentList.querySelectorAll('[data-remove-attachment]')) {
    button.addEventListener('click', () => {
      state.attachments = state.attachments.filter(
        (attachment) => attachment.id !== button.dataset.removeAttachment,
      );
      elements.formMessage.textContent = '';
      renderAttachmentComposer();
    });
  }
}

async function addImageFiles(fileList) {
  if (state.status?.capabilities?.imageAttachments !== true) {
    elements.formMessage.textContent = 'Restart Relay once to enable image attachments.';
    return;
  }
  const files = [...fileList];
  const errors = [];
  let totalBytes = state.attachments.reduce((total, attachment) => total + attachment.size, 0);

  for (const file of files) {
    if (state.attachments.length >= MAX_IMAGE_ATTACHMENTS) {
      errors.push(`Attach at most ${MAX_IMAGE_ATTACHMENTS} images.`);
      break;
    }
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      errors.push(`${file.name} is not PNG, JPEG, or WebP.`);
      continue;
    }
    if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
      errors.push(`${file.name} must be smaller than 5 MB.`);
      continue;
    }
    if (totalBytes + file.size > MAX_TOTAL_IMAGE_BYTES) {
      errors.push('Images may total at most 20 MB.');
      break;
    }
    const duplicate = state.attachments.some(
      (attachment) => attachment.name === file.name && attachment.size === file.size,
    );
    if (duplicate) {
      errors.push(`${file.name} is already attached.`);
      continue;
    }
    try {
      const data = await readFileAsDataUrl(file);
      state.attachments.push({
        id: globalThis.crypto?.randomUUID?.() || `image-${Date.now()}-${state.attachments.length}`,
        name: file.name,
        mimeType: file.type,
        size: file.size,
        data,
      });
      totalBytes += file.size;
    } catch (error) {
      errors.push(error.message);
    }
  }

  elements.formMessage.textContent = [...new Set(errors)].join(' ');
  renderAttachmentComposer();
}

function formatTime(value) {
  if (!value) {
    return '';
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatCardTime(value) {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value || '';
  return `${part('day')} ${part('month')} ${part('hour')}:${part('minute')}`;
}

function workspaceName(path) {
  const clean = String(path || '').replace(/\/$/, '');
  return clean.split('/').filter(Boolean).pop() || clean || 'Unknown workspace';
}

function compactText(value, limit) {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  return compact.length > limit ? `${compact.slice(0, limit - 3)}...` : compact;
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatEventTime(value) {
  if (!value) {
    return '';
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function formatEventDuration(entry) {
  const item = entryItem(entry);
  const startedAt = new Date(entryFirstEvent(entry)?.created_at || 0).getTime();
  const completedAt = new Date(entryLastEvent(entry)?.created_at || 0).getTime();
  const milliseconds = Number(item?.durationMs) > 0
    ? Number(item.durationMs)
    : Math.max(0, completedAt - startedAt);
  if (!milliseconds || !entry.completedEvent) {
    return '';
  }
  if (milliseconds < 1000) {
    return `${milliseconds} ms`;
  }
  if (milliseconds < 60_000) {
    return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
  }
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1000)}s`;
}

function eventProvider(entry, task) {
  for (const event of entry.events) {
    if (event.kind === 'queue' || event.kind === 'system') {
      return 'relay';
    }
    if (event.payload?.provider === 'claude' || event.kind === 'claude') {
      return 'claude';
    }
    if (event.payload?.provider === 'plan' || event.kind === 'plan') {
      return 'council';
    }
    if (event.payload?.provider === 'codex' || event.kind === 'codex') {
      return 'codex';
    }
  }
  return task?.mode === 'plan' ? 'council' : taskProvider(task || {});
}

function eventState(entry) {
  const item = entryItem(entry);
  const lastEvent = entryLastEvent(entry);
  const message = String(lastEvent?.message || '').toLowerCase();
  if (
    lastEvent?.kind === 'stderr'
    || lastEvent?.payload?.type === 'error'
    || item?.status === 'failed'
    || Number(item?.exitCode) > 0
    || /failed|cancelled|interrupted|error/.test(message)
  ) {
    return 'error';
  }
  if (entry.startedEvent && !entry.completedEvent) {
    return 'running';
  }
  if (item?.status === 'completed' || entry.completedEvent || /completed|ready|attached/.test(message)) {
    return 'success';
  }
  return 'neutral';
}

function eventStatusLabel(entry, fallback = 'Recorded') {
  const item = entryItem(entry);
  const stateName = eventState(entry);
  if (stateName === 'running') {
    return 'Running';
  }
  if (item?.type === 'commandExecution' && entry.completedEvent) {
    return Number(item.exitCode) > 0 ? `Exit ${item.exitCode}` : 'Exit 0';
  }
  if (stateName === 'error') {
    return 'Attention';
  }
  if (stateName === 'success') {
    return 'Complete';
  }
  return fallback;
}

function eventRelativePath(path, cwd) {
  const value = String(path || 'workspace file');
  const prefix = `${String(cwd || '').replace(/\/$/, '')}/`;
  return prefix !== '/' && value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function eventTextMarkup(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  const long = text.length > 700 || text.split('\n').length > 10;
  if (!long) {
    return `<div class="event-message-body">${escapeHtml(text)}</div>`;
  }
  return `
    <details class="event-long-copy">
      <summary>
        <span>${escapeHtml(compactText(text, 240))}</span>
        <b>Expand message</b>
      </summary>
      <div class="event-message-body">${escapeHtml(text)}</div>
    </details>
  `;
}

function eventOutputMarkup(output, { label = 'Output', open = false } = {}) {
  const text = String(output || '').trimEnd();
  if (!text) {
    return '';
  }
  const limit = 50_000;
  const omitted = Math.max(0, text.length - limit);
  const visibleText = omitted > 0
    ? `${text.slice(0, limit / 2)}\n\n[${omitted.toLocaleString()} characters omitted]\n\n${text.slice(-limit / 2)}`
    : text;
  const lines = text.split('\n').length;
  return `
    <details class="event-output" ${open ? 'open' : ''}>
      <summary><span>${escapeHtml(label)}</span><small>${lines} line${lines === 1 ? '' : 's'}</small></summary>
      <pre class="event-output-content">${escapeHtml(visibleText)}</pre>
    </details>
  `;
}

function toolResultText(result) {
  if (typeof result === 'string') {
    return result;
  }
  return (result?.content || []).map((item) => item?.text || '').filter(Boolean).join('\n');
}

function eventPresentation(entry, task) {
  const item = entryItem(entry);
  const lastEvent = entryLastEvent(entry);
  const payloadType = lastEvent?.payload?.type || '';
  const provider = eventProvider(entry, task);
  const duration = formatEventDuration(entry);
  const common = {
    provider,
    state: eventState(entry),
    status: eventStatusLabel(entry),
    duration,
    compact: false,
  };

  if (item?.type === 'commandExecution') {
    const command = item.command || item.commands?.join(' ') || 'Command details unavailable';
    const cwd = item.cwd || task?.repo_path;
    return {
      ...common,
      glyph: '$',
      title: 'Terminal command',
      body: `
        <div class="event-command"><code>${escapeHtml(command)}</code></div>
        <div class="event-command-meta">
          <span title="${escapeHtml(cwd)}">${escapeHtml(eventRelativePath(cwd, task?.repo_path) || workspaceName(cwd))}</span>
          ${duration ? `<span>${escapeHtml(duration)}</span>` : ''}
        </div>
        ${eventOutputMarkup(item.aggregatedOutput, { open: common.state === 'error' })}
      `,
    };
  }

  if (item?.type === 'fileChange') {
    const changes = item.changes || [];
    const diffs = changes.map((change) => change.diff).filter(Boolean).join('\n');
    return {
      ...common,
      glyph: '±',
      title: changes.length === 1 ? 'File changed' : 'Files changed',
      status: entry.startedEvent && !entry.completedEvent
        ? 'Editing'
        : `${changes.length || 1} update${changes.length === 1 ? '' : 's'}`,
      body: `
        <div class="event-file-list">
          ${changes.map((change) => `
            <span>
              <b>${escapeHtml(change.kind?.type === 'create' ? '+' : '~')}</b>
              <code title="${escapeHtml(change.path)}">${escapeHtml(eventRelativePath(change.path, task?.repo_path))}</code>
              <small>${escapeHtml(change.kind?.type || 'updated')}</small>
            </span>
          `).join('') || '<span><b>~</b><code>Workspace files</code><small>updated</small></span>'}
        </div>
        ${eventOutputMarkup(diffs, { label: 'View patch' })}
      `,
    };
  }

  if (item?.type === 'mcpToolCall') {
    const output = toolResultText(item.result);
    return {
      ...common,
      glyph: '◆',
      title: item.tool || 'Connected tool',
      status: item.status === 'failed' ? 'Failed' : eventStatusLabel(entry, 'Tool'),
      body: `
        <div class="event-tool-route"><span>${escapeHtml(item.server || 'Tool')}</span><b>/</b><strong>${escapeHtml(item.tool || 'call')}</strong></div>
        ${eventOutputMarkup(output, { open: item.status === 'failed' })}
        ${eventOutputMarkup(JSON.stringify(item.arguments || {}, null, 2), { label: 'Arguments' })}
      `,
    };
  }

  if (item?.type === 'webSearch') {
    return {
      ...common,
      glyph: '⌕',
      title: 'Web search',
      body: eventTextMarkup(item.query || item.action?.query || 'Search completed.'),
    };
  }

  if (item?.type === 'imageView') {
    return {
      ...common,
      glyph: '▧',
      title: 'Image inspected',
      body: `<div class="event-path"><code>${escapeHtml(eventRelativePath(item.path, task?.repo_path))}</code></div>`,
    };
  }

  if (item?.type === 'agentMessage') {
    const message = String(item.text || lastEvent?.message || '').trim();
    return {
      ...common,
      glyph: provider === 'claude' ? '✳' : '>_',
      title: `${providerLabel(provider)} message`,
      status: item.phase === 'final' || lastEvent?.kind === 'result' ? 'Final' : 'Update',
      body: message ? `<div class="event-message-body event-agent-message">${escapeHtml(message)}</div>` : '',
      headerless: provider === 'codex',
    };
  }

  if (item?.type === 'reasoning') {
    const summary = (item.summary || []).map((part) => part?.text || part).filter(Boolean).join('\n');
    return {
      ...common,
      glyph: '··',
      title: `${providerLabel(provider)} reasoning`,
      status: entry.completedEvent ? 'Complete' : 'Thinking',
      body: summary ? eventTextMarkup(summary) : '',
      compact: !summary,
    };
  }

  if (item?.type === 'userMessage') {
    return {
      ...common,
      glyph: '↗',
      title: 'Prompt delivered',
      status: entry.completedEvent ? 'Received' : 'Sending',
      body: '',
      compact: true,
    };
  }

  if (item?.type === 'contextCompaction') {
    return {
      ...common,
      glyph: '↯',
      title: 'Context compacted',
      status: 'Complete',
      body: '',
      compact: true,
    };
  }

  if (payloadType === 'turn/started' || payloadType === 'turn/completed') {
    return {
      ...common,
      glyph: '◎',
      title: payloadType === 'turn/started' ? 'Session started' : 'Session finished',
      status: payloadType === 'turn/started' ? 'Live' : 'Complete',
      body: '',
      compact: true,
    };
  }

  if (lastEvent?.kind === 'queue' || lastEvent?.kind === 'system') {
    return {
      ...common,
      glyph: 'R',
      title: lastEvent.kind === 'queue' ? 'Relay queue' : 'Relay system',
      body: eventTextMarkup(lastEvent.message),
      compact: true,
    };
  }

  if (lastEvent?.kind === 'stderr' || payloadType === 'error') {
    return {
      ...common,
      glyph: '!',
      title: 'Terminal warning',
      status: 'Attention',
      body: eventOutputMarkup(lastEvent.message, { label: 'Error details', open: true }),
    };
  }

  if (lastEvent?.kind === 'plan') {
    return {
      ...common,
      glyph: '⇄',
      title: 'Plan council',
      body: eventTextMarkup(lastEvent.message),
    };
  }

  if (payloadType === 'claude/started' || payloadType === 'claude/completed' || payloadType === 'claude/waiting') {
    return {
      ...common,
      glyph: '✳',
      title: payloadType === 'claude/waiting' ? 'Claude session busy' : 'Claude session',
      body: eventTextMarkup(lastEvent.message),
      compact: payloadType !== 'claude/waiting',
    };
  }

  return {
    ...common,
    glyph: provider === 'claude' ? '✳' : '>_',
    title: `${providerLabel(provider)} activity`,
    body: eventTextMarkup(lastEvent?.message || 'Activity recorded.'),
  };
}

function renderEventEntry(entry, task, index) {
  const presentation = eventPresentation(entry, task);
  const event = entryFirstEvent(entry);
  const timestamp = event?.created_at || '';
  const provider = presentation.provider === 'council' ? 'plan' : presentation.provider;
  return `
    <article class="event-entry event-entry-${escapeHtml(presentation.state)} event-provider-${escapeHtml(provider)} ${presentation.compact ? 'event-entry-compact' : ''} ${presentation.headerless ? 'event-entry-headerless' : ''}" data-entry-id="${escapeHtml(entry.id)}" data-category="${escapeHtml(eventEntryCategory(entry))}">
      <div class="event-trace" aria-hidden="true">
        <small>${String(index + 1).padStart(2, '0')}</small>
        <span>${presentation.glyph}</span>
      </div>
      <div class="event-card">
        ${presentation.headerless ? '' : `<header class="event-card-header">
          <span class="event-card-identity">
            <span class="event-provider-label">${escapeHtml(providerLabel(presentation.provider))}</span>
            <strong>${escapeHtml(presentation.title)}</strong>
          </span>
          <span class="event-card-meta">
            <span class="event-card-state">${escapeHtml(presentation.status)}</span>
            ${presentation.duration ? `<small>${escapeHtml(presentation.duration)}</small>` : ''}
            <time datetime="${escapeHtml(timestamp)}" title="${escapeHtml(new Date(timestamp).toLocaleString())}">${escapeHtml(formatEventTime(timestamp))}</time>
          </span>
        </header>`}
        ${presentation.body ? `<div class="event-card-body">${presentation.body}</div>` : ''}
      </div>
    </article>
  `;
}

function eventCopyText(entry, task) {
  const presentation = eventPresentation(entry, task);
  const event = entryFirstEvent(entry);
  const item = entryItem(entry);
  const lines = [
    `[${formatEventTime(event?.created_at)}] ${providerLabel(presentation.provider)} · ${presentation.title} · ${presentation.status}`,
  ];
  if (item?.type === 'commandExecution') {
    lines.push(item.command || 'Command details unavailable');
    if (item.aggregatedOutput) {
      lines.push(item.aggregatedOutput);
    }
  } else if (item?.type === 'agentMessage') {
    lines.push(item.text || entryLastEvent(entry)?.message || '');
  } else {
    lines.push(entryLastEvent(entry)?.message || '');
  }
  return lines.filter(Boolean).join('\n');
}

function updateEventControls() {
  for (const button of elements.eventFilters) {
    button.setAttribute('aria-pressed', String(button.dataset.eventFilter === state.eventFilter));
  }
  elements.followEventsButton.setAttribute('aria-pressed', String(state.eventFollow));
  elements.followEventsButton.querySelector('span').textContent = state.eventFollow ? 'Following' : 'Follow live';
}

function eventDisclosureKey(details) {
  const entry = details.closest('[data-entry-id]');
  if (!entry) return null;
  const disclosures = [...entry.querySelectorAll('details')];
  return `${entry.dataset.entryId}:${disclosures.indexOf(details)}`;
}

function rememberEventDisclosures() {
  for (const details of elements.detailEvents.querySelectorAll('details')) {
    const key = eventDisclosureKey(details);
    if (!key) continue;
    if (details.open) state.expandedEventDetails.add(key);
    else state.expandedEventDetails.delete(key);
  }
}

function restoreEventDisclosures() {
  for (const details of elements.detailEvents.querySelectorAll('details')) {
    const key = eventDisclosureKey(details);
    if (key && state.expandedEventDetails.has(key)) details.open = true;
  }
}

function renderEventStream(events, task, { forceBottom = false, resetDisclosures = false } = {}) {
  if (resetDisclosures) state.expandedEventDetails.clear();
  else rememberEventDisclosures();
  const previousScrollTop = elements.detailEvents.scrollTop;
  const grouped = groupEventEntries(events);
  const visible = filterEventEntries(grouped, state.eventFilter);
  const stats = eventStreamStats(grouped);
  state.selectedTaskEvents = events;
  state.selectedTaskForEvents = task;
  state.visibleEventEntries = visible;

  const stateLabels = {
    queued: 'Waiting',
    running: 'Live',
    complete: 'Finished',
    failed: 'Failed',
    cancelled: 'Cancelled',
    interrupted: 'Interrupted',
  };
  elements.eventSessionState.dataset.state = task.status;
  elements.eventSessionState.querySelector('span').textContent = stateLabels[task.status] || 'Recorded';
  elements.eventSummary.textContent = `${visible.length} of ${grouped.length} signals · ${events.length} raw events`;
  elements.eventMetrics.innerHTML = `
    <span><b>${stats.commands}</b><small>commands</small></span>
    <span><b>${stats.files}</b><small>file changes</small></span>
    <span><b>${stats.messages}</b><small>messages</small></span>
    <span class="${stats.errors ? 'has-errors' : ''}"><b>${stats.errors}</b><small>errors</small></span>
    ${stats.running ? `<span class="is-running"><b>${stats.running}</b><small>active</small></span>` : ''}
  `;
  elements.copyEventsButton.disabled = visible.length === 0;
  elements.detailEvents.innerHTML = visible.length === 0
    ? `<div class="events-empty"><span aria-hidden="true">⌁</span><strong>No ${escapeHtml(state.eventFilter)} activity yet</strong><small>New matching signals will appear here.</small></div>`
    : visible.map((entry, index) => renderEventEntry(entry, task, index)).join('');
  restoreEventDisclosures();

  if (forceBottom || state.eventFollow) {
    state.eventFollow = true;
    elements.detailEvents.scrollTop = elements.detailEvents.scrollHeight;
  } else {
    elements.detailEvents.scrollTop = previousScrollTop;
  }
  updateEventControls();
}

function setModuleState(module, value) {
  module.dataset.state = value;
}

function threadProvider(thread) {
  return thread.provider || 'codex';
}

function providerLabel(provider) {
  if (provider === 'claude') {
    return 'Claude';
  }
  if (provider === 'council') {
    return 'Plan council';
  }
  if (provider === 'relay') {
    return 'Relay';
  }
  return 'Codex';
}

function taskProvider(task) {
  return task.provider || 'codex';
}

function providerIcon(provider) {
  return provider === 'claude' ? '✳' : '&gt;_';
}

function providerIconClass(provider) {
  return provider === 'claude' ? 'agent-icon-claude' : 'agent-icon-codex';
}

function executionLabel(task) {
  if (task.mode === 'turbo') {
    const planner = `${task.turbo?.plannerModel || task.model || 'planner'} · ${task.turbo?.plannerEffort || task.effort || 'default'}`;
    const workers = `${task.turbo?.workerCount || task.turbo?.workers?.length || 0} workers · ${task.turbo?.workerModel || 'worker model'} · ${task.turbo?.workerEffort || 'default'}`;
    return `Turbo: ${planner} → ${workers}`;
  }
  if (task.mode === 'plan') {
    const author = `${task.author_model || 'Claude'} · ${task.author_effort || 'max'}`;
    const reviewer = `${task.reviewer_model || 'Codex'} · ${task.reviewer_effort || 'default'}`;
    return `${author} → ${reviewer}`;
  }
  const model = task.model || 'session model';
  const effort = task.effort ? `${task.effort} effort` : 'default effort';
  return `${model} · ${effort}`;
}

function taskCardExecutionLabel(task) {
  const base = task.mode === 'execute'
    ? `${task.model || 'session model'} · ${task.effort || 'default'}`
    : executionLabel(task);
  const attachments = task.attachments?.length ? ` · ${task.attachments.length} image${task.attachments.length === 1 ? '' : 's'}` : '';
  return `${base}${attachments} · ${workspaceName(task.repo_path)}`;
}

function taskCardDurationLabel(task) {
  return taskDurationLabel(task).replace(/^Took /, '');
}

function agentBadgeMarkup(task, sizeClass) {
  if (task.mode === 'plan') {
    return `
      <span class="agent-pair" aria-hidden="true">
        <span class="agent-icon agent-icon-claude ${sizeClass}">✳</span>
        <span class="agent-icon agent-icon-codex ${sizeClass}">&gt;_</span>
      </span>
    `;
  }
  const provider = taskProvider(task);
  return `<span class="agent-icon ${providerIconClass(provider)} ${sizeClass}" aria-hidden="true">${providerIcon(provider)}</span>`;
}

function selectedExecution() {
  return state.executionSettings[state.selectedProvider];
}

function selectedModel() {
  const settings = selectedExecution();
  return state.modelCatalogs[state.selectedProvider]
    .find((model) => model.model === settings.model) || null;
}

function renderExecutionControls() {
  const models = state.modelCatalogs[state.selectedProvider];
  const settings = selectedExecution();
  elements.executionControls.dataset.provider = state.selectedProvider;
  let model = models.find((item) => item.model === settings.model);
  if (!model) {
    model = models.find((item) => item.isDefault) || models[0];
    settings.model = model?.model || '';
    settings.effort = model?.defaultReasoningEffort || '';
  }

  elements.modelSelect.innerHTML = models.map((item) => `
    <option value="${escapeHtml(item.model)}">${escapeHtml(item.displayName)}${item.isDefault ? ' · default' : ''}</option>
  `).join('');
  elements.modelSelect.value = settings.model;
  elements.modelSelect.disabled = models.length === 0;
  elements.modelHint.textContent = model?.description || `No ${providerLabel(state.selectedProvider)} models available.`;

  const efforts = model?.supportedReasoningEfforts || [];
  const defaultEffort = model?.defaultReasoningEffort || null;
  if (settings.effort && !efforts.some((item) => item.reasoningEffort === settings.effort)) {
    settings.effort = '';
  }
  if (!settings.effort && efforts.length > 0) {
    settings.effort = efforts.some((item) => item.reasoningEffort === defaultEffort)
      ? defaultEffort
      : efforts[0].reasoningEffort;
  }
  const effortValues = efforts.map((item) => item.reasoningEffort);
  const effortIndex = Math.max(0, effortValues.indexOf(settings.effort));
  elements.effortSelect.min = '0';
  elements.effortSelect.max = String(Math.max(0, effortValues.length - 1));
  elements.effortSelect.value = String(effortIndex);
  elements.effortSelect.disabled = efforts.length === 0;
  elements.effortSelect.style.setProperty(
    '--effort-progress',
    `${effortValues.length > 1 ? (effortIndex / (effortValues.length - 1)) * 100 : 0}%`,
  );
  elements.effortSelect.dataset.values = JSON.stringify(effortValues);
  elements.effortSliderValue.textContent = settings.effort ? `${settings.effort} effort` : 'Unavailable';
  elements.effortSliderSteps.innerHTML = effortValues.map((effort, index) => `
    <i class="${index === effortIndex ? 'active' : ''}" title="${escapeHtml(effort)}"></i>
  `).join('');
  const selectedEffort = efforts.find((item) => item.reasoningEffort === settings.effort);
  elements.effortHint.textContent = selectedEffort?.description
    || 'This model does not expose effort control.';
}

function isClaudePlanReady() {
  return Boolean(state.status?.claude?.available && state.status?.claude?.authenticated);
}

function isDirectClaudeEnabled() {
  return state.status?.capabilities?.directClaudeExecution === true;
}

function hasSelectedCodexThread() {
  return state.threads.some(
    (thread) => thread.id === state.selectedThreadId && threadProvider(thread) === 'codex',
  );
}

function setReadiness(element, ready, readyText, missingText) {
  element.dataset.state = ready ? 'ready' : 'missing';
  element.innerHTML = `<i aria-hidden="true"></i> ${escapeHtml(ready ? readyText : missingText)}`;
}

function renderPlanControls() {
  const settings = state.planSettings;
  const models = state.modelCatalogs.codex;
  let model = models.find((item) => item.model === settings.reviewerModel);
  if (!model) {
    model = models.find((item) => item.isDefault) || models[0] || null;
    settings.reviewerModel = model?.model || '';
  }

  elements.planAuthorModel.value = settings.authorModel;
  elements.planReviewerModel.innerHTML = models.map((item) => `
    <option value="${escapeHtml(item.model)}">${escapeHtml(item.displayName)}${item.isDefault ? ' · default' : ''}</option>
  `).join('');
  elements.planReviewerModel.value = settings.reviewerModel;
  elements.planReviewerModel.disabled = models.length === 0;

  const efforts = model?.supportedReasoningEfforts || [];
  const defaultEffort = model?.defaultReasoningEffort || null;
  if (settings.reviewerEffort && !efforts.some((item) => item.reasoningEffort === settings.reviewerEffort)) {
    settings.reviewerEffort = efforts.some((item) => item.reasoningEffort === 'high') ? 'high' : '';
  }
  elements.planReviewerEffort.innerHTML = [
    `<option value="">${defaultEffort ? `Model default · ${escapeHtml(defaultEffort)}` : 'Model default'}</option>`,
    ...efforts.map((item) => `<option value="${escapeHtml(item.reasoningEffort)}">${escapeHtml(item.reasoningEffort)}</option>`),
  ].join('');
  elements.planReviewerEffort.value = settings.reviewerEffort;
  elements.planReviewerEffort.disabled = efforts.length === 0;

  setReadiness(
    elements.planClaudeReady,
    isClaudePlanReady(),
    `Claude CLI ready${state.status?.claude?.version ? ` · ${state.status.claude.version}` : ''}`,
    'Claude CLI needs sign-in and a Relay restart',
  );
  setReadiness(
    elements.planCodexReady,
    hasSelectedCodexThread(),
    'Codex review terminal selected',
    'Choose a connected Codex review terminal',
  );
}

function turboWorkerThreads() {
  const planner = state.threads.find((thread) => thread.id === state.selectedThreadId && threadProvider(thread) === 'codex');
  if (!planner) return [];
  return state.threads.filter((thread) => (
    threadProvider(thread) === 'codex'
    && thread.id !== planner.id
    && sameProjectPath(thread.cwd, planner.cwd)
  ));
}

function preferredTurboModel(models, requested, fragment) {
  return models.find((item) => item.model === requested)
    || models.find((item) => item.model.toLowerCase().includes(fragment))
    || models.find((item) => item.isDefault)
    || models[0]
    || null;
}

function turboEffortOptions(select, model, requested) {
  const efforts = model?.supportedReasoningEfforts || [];
  const value = efforts.some((item) => item.reasoningEffort === requested)
    ? requested
    : efforts.some((item) => item.reasoningEffort === 'high') ? 'high' : '';
  select.innerHTML = [
    `<option value="">Model default${model?.defaultReasoningEffort ? ` · ${escapeHtml(model.defaultReasoningEffort)}` : ''}</option>`,
    ...efforts.map((item) => `<option value="${escapeHtml(item.reasoningEffort)}">${escapeHtml(item.reasoningEffort)}</option>`),
  ].join('');
  select.value = value;
  select.disabled = efforts.length === 0;
  return value;
}

function renderTurboControls() {
  const settings = state.turboSettings;
  const models = state.modelCatalogs.codex;
  const plannerModel = preferredTurboModel(models, settings.plannerModel, 'sol');
  const workerModel = preferredTurboModel(models, settings.workerModel, 'luna');
  settings.plannerModel = plannerModel?.model || '';
  settings.workerModel = workerModel?.model || '';
  const options = models.map((item) => `<option value="${escapeHtml(item.model)}">${escapeHtml(item.displayName)}</option>`).join('');
  elements.turboPlannerModel.innerHTML = options;
  elements.turboWorkerModel.innerHTML = options;
  elements.turboPlannerModel.value = settings.plannerModel;
  elements.turboWorkerModel.value = settings.workerModel;
  elements.turboPlannerModel.disabled = models.length === 0;
  elements.turboWorkerModel.disabled = models.length === 0;
  settings.plannerEffort = turboEffortOptions(elements.turboPlannerEffort, plannerModel, settings.plannerEffort);
  settings.workerEffort = turboEffortOptions(elements.turboWorkerEffort, workerModel, settings.workerEffort);
  elements.turboWorkerCount.value = String(settings.workerCount);
  const available = turboWorkerThreads().length;
  const ready = hasSelectedCodexThread() && available >= settings.workerCount;
  elements.turboReadiness.dataset.state = ready ? 'ready' : 'missing';
  elements.turboReadiness.textContent = ready
    ? `Ready · 1 planner + ${settings.workerCount} workers`
    : `Need ${settings.workerCount + 1} terminals · ${hasSelectedCodexThread() ? available + 1 : 0} connected here`;
}

function updateSubmitState() {
  const hasThread = hasSelectedCodexThread();
  const ready = state.taskMode === 'plan'
    ? hasThread && isClaudePlanReady() && Boolean(state.planSettings.reviewerModel)
    : state.taskMode === 'turbo'
      ? hasThread && turboWorkerThreads().length >= state.turboSettings.workerCount
    : state.threads.some(
      (thread) => thread.id === state.selectedThreadId && threadProvider(thread) === state.selectedProvider,
    );
  elements.submitButton.disabled = state.submitting || !ready;
  elements.submitButton.textContent = state.submitting
    ? state.taskMode === 'plan' ? 'Starting council' : state.taskMode === 'turbo' ? 'Starting turbo' : 'Adding task'
    : state.taskMode === 'plan' ? 'Build reviewed plan' : state.taskMode === 'turbo' ? 'Plan and execute' : 'Add to queue';
}

function selectMode(mode, { focus = false } = {}) {
  if (!['execute', 'plan', 'turbo'].includes(mode)) {
    return;
  }
  state.taskMode = mode;
  for (const tab of elements.modeTabs) {
    const selected = tab.dataset.mode === mode;
    tab.classList.toggle('selected', selected);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  elements.executeConfig.hidden = mode !== 'execute';
  elements.planConfig.hidden = mode !== 'plan';
  elements.turboConfig.hidden = mode !== 'turbo';
  elements.promptLabel.textContent = mode === 'plan' ? 'Planning brief' : mode === 'turbo' ? 'Turbo objective' : 'Task prompt';
  elements.prompt.placeholder = mode === 'plan'
    ? 'Describe what should be built, the constraints, and the decisions the reviewed plan must settle.'
    : mode === 'turbo'
      ? 'Describe the complete outcome. The planner will produce a JSON dependency graph and Relay will dispatch it across worker terminals.'
    : 'Describe the outcome, constraints, and how the agent should verify the work.';
  elements.terminalLegend.textContent = mode === 'plan' ? 'Codex review terminal' : mode === 'turbo' ? 'Planner terminal' : 'Run in terminal';

  if ((mode === 'plan' || mode === 'turbo') && state.selectedProvider !== 'codex') {
    state.selectedProvider = 'codex';
    state.selectedThreadId = null;
  }
  renderProviderTabs();
  renderExecutionControls();
  renderPlanControls();
  renderTurboControls();
  renderAttachmentComposer();
  renderThreads();
  updateSubmitState();
  if (focus) {
    document.querySelector(`#mode-${mode}`)?.focus();
  }
}

async function loadModels(provider) {
  try {
    const body = await api(`/api/models?provider=${encodeURIComponent(provider)}`);
    if (Array.isArray(body.models) && body.models.length > 0) {
      state.modelCatalogs[provider] = body.models;
      if (provider === state.selectedProvider) {
        renderExecutionControls();
      }
      if (provider === 'codex') {
        renderPlanControls();
        renderTurboControls();
      }
    }
  } catch {
    if (provider === state.selectedProvider) {
      renderExecutionControls();
    }
    if (provider === 'codex') {
      renderPlanControls();
      renderTurboControls();
    }
  }
}

function providerInfo(provider) {
  const fromServer = state.providers.find((item) => item.id === provider);
  if (fromServer) {
    return fromServer;
  }
  const connectedCount = state.threads.filter((thread) => threadProvider(thread) === provider).length;
  return {
    id: provider,
    label: providerLabel(provider),
    available: provider === 'codex' && Boolean(state.connection?.connected),
    connectedCount,
  };
}

function renderProviderTabs() {
  const codex = providerInfo('codex');
  const claude = providerInfo('claude');
  elements.providerCodexCount.textContent = codex.connectedCount > 0
    ? `${codex.connectedCount} live`
    : codex.available ? 'Ready' : 'Unavailable';
  elements.providerClaudeCount.textContent = claude.connectedCount > 0
    ? `${claude.connectedCount} live`
    : claude.available
      ? isDirectClaudeEnabled() ? 'CLI ready' : 'Restart Relay'
      : 'Not connected';

  for (const tab of elements.providerTabs) {
    const selected = tab.dataset.provider === state.selectedProvider;
    const info = providerInfo(tab.dataset.provider);
    tab.classList.toggle('selected', selected);
    tab.dataset.state = info.connectedCount > 0 ? 'live' : info.available ? 'ready' : 'unavailable';
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }

  elements.providerInput.value = state.selectedProvider;
  elements.terminalPanel.setAttribute('aria-labelledby', `provider-${state.selectedProvider}`);
  elements.agentMessage.textContent = state.selectedProvider === 'codex'
    ? 'Uses your existing Codex login and selected live terminal.'
    : claude.available
      ? isDirectClaudeEnabled()
        ? 'Resumes the exact Claude conversation. Live execution appears in Relay.'
        : 'Restart Relay after active tasks finish to enable Claude session discovery.'
      : 'Claude CLI is not available to Relay yet.';
}

function renderStatus() {
  if (!state.status) {
    return;
  }

  const { codex, claude, paused, activeTaskId, activeTaskIds = [] } = state.status;
  const codexReady = Boolean(codex.available && codex.authenticated && codex.appServer?.connected);
  const claudeReady = Boolean(claude?.available && claude?.authenticated);
  const relayReady = codexReady || claudeReady;
  const scopedThreads = state.activeProjectPath
    ? state.threads.filter((thread) => sameProjectPath(thread.cwd, state.activeProjectPath))
    : state.threads;
  const scopedTasks = projectTasks();
  const connectedCount = scopedThreads.length;
  const codexCount = scopedThreads.filter((thread) => threadProvider(thread) === 'codex').length;
  const claudeCount = scopedThreads.filter((thread) => threadProvider(thread) === 'claude').length;
  const selectedProviderCount = scopedThreads.filter(
    (thread) => threadProvider(thread) === state.selectedProvider,
  ).length;
  const queuedCount = scopedTasks.filter((task) => task.status === 'queued').length;
  const runningTask = scopedTasks.find((task) => task.status === 'running') || null;

  elements.codexStatus.dataset.state = relayReady ? 'online' : 'offline';
  elements.codexStatusLabel.textContent = relayReady ? 'Relay online' : 'Relay unavailable';
  elements.pauseButton.textContent = paused ? 'Resume queue' : 'Pause queue';
  elements.pauseButton.classList.toggle('primary', paused);

  setModuleState(elements.statusRelay, relayReady ? 'online' : 'offline');
  elements.statusRelayValue.textContent = relayReady ? 'Online' : 'Unavailable';
  elements.statusRelayDetail.textContent = relayReady
    ? `${codexReady ? 'Codex ready' : 'Codex offline'} · ${claudeReady ? 'Claude ready' : 'Claude offline'}`
    : 'Check AI login and Relay server';

  setModuleState(elements.statusTerminals, connectedCount > 0 ? 'online' : 'idle');
  elements.statusTerminalsValue.textContent = `Codex ${codexCount} · Claude ${claudeCount}`;
  const selectedThread = state.threads.find((thread) => thread.id === state.selectedThreadId);
  elements.statusTerminalsDetail.textContent = selectedThread
    ? workspaceName(selectedThread.cwd)
    : connectedCount > 0
      ? `${connectedCount} live · ${selectedProviderCount} ${providerLabel(state.selectedProvider)}`
      : 'Waiting for Codex or Claude';

  const queueState = paused ? 'paused' : runningTask ? 'running' : 'idle';
  setModuleState(elements.statusQueue, queueState);
  elements.statusQueueValue.textContent = paused ? 'Paused' : runningTask ? 'Processing' : 'Ready';
  elements.statusQueueDetail.textContent = `${queuedCount} waiting · ${runningTask ? '1 running' : 'nothing running'}`;

  setModuleState(elements.statusActive, runningTask ? 'running' : 'idle');
  elements.statusActiveValue.textContent = runningTask ? `Task ${runningTask.id}` : 'Idle';
  elements.statusActiveDetail.textContent = runningTask
    ? compactText(runningTask.prompt, 54)
    : activeTaskIds.length > 0
      ? `Preparing ${activeTaskIds.length} active task${activeTaskIds.length === 1 ? '' : 's'}`
      : activeTaskId ? `Preparing task ${activeTaskId}` : 'Ready for the next task';

  elements.queueSummary.textContent = paused
    ? `${queuedCount} task${queuedCount === 1 ? '' : 's'} waiting while paused`
    : runningTask
      ? `Task ${runningTask.id} is running · ${queuedCount} waiting`
      : `${queuedCount} waiting · queue ready`;
}

function renderTasks() {
  const visibleTasks = projectTasks();
  if (visibleTasks.length === 0) {
    state.parallelTaskIds.clear();
    renderParallelBatchBar();
    elements.taskList.innerHTML = `
      <div class="queue-empty">
        <span aria-hidden="true">00</span>
        <strong>The queue is clear</strong>
        <p>${state.activeProjectPath ? `No tasks in ${escapeHtml(workspaceName(state.activeProjectPath))} yet.` : 'Choose a terminal and add the first prompt.'}</p>
      </div>
    `;
    return;
  }

  const queuedIds = visibleTasks.filter((task) => task.status === 'queued').map((task) => task.id);
  state.parallelTaskIds = new Set([...state.parallelTaskIds].filter((id) => queuedIds.includes(id)));
  renderParallelBatchBar();
  elements.taskList.innerHTML = visibleTasks.map((task) => {
    const queueIndex = queuedIds.indexOf(task.id);
    const queued = queueIndex !== -1;
    const assignable = queued && task.mode === 'execute' && task.provider === 'codex';
    const assignmentTargets = assignable ? state.threads.filter((thread) => (
      threadProvider(thread) === 'codex'
      && sameProjectPath(thread.cwd, task.repo_path)
      && thread.id !== task.thread_id
    )) : [];
    const reorderControls = queued ? `
      <span class="queue-reorder" aria-label="Reorder queued task">
        <button type="button" data-move="up" aria-label="Move task ${task.id} up" ${queueIndex === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" data-move="down" aria-label="Move task ${task.id} down" ${queueIndex === queuedIds.length - 1 ? 'disabled' : ''}>↓</button>
      </span>
    ` : '';
    return `
      <article
        class="task-card ${task.id === state.selectedTaskId ? 'selected' : ''} ${queued ? 'task-card-reorderable' : ''}"
        data-task-id="${task.id}"
        data-status="${escapeHtml(task.status)}"
        draggable="${queued}"
        tabindex="0"
        aria-label="Task ${task.id}, ${escapeHtml(task.status)}${queued ? ', draggable queue item' : ''}"
      >
        <div class="task-topline">
          <span class="task-identity">
            ${queued ? `<input class="parallel-task-check" type="checkbox" aria-label="Select task ${task.id} for parallel Codex execution" ${state.parallelTaskIds.has(task.id) ? 'checked' : ''}>` : ''}
            ${queued ? '<span class="drag-grip" aria-hidden="true">⠿</span>' : ''}
            ${agentBadgeMarkup(task, 'task-agent-icon')}
            <span class="task-number">#${String(task.id).padStart(3, '0')}</span>
          </span>
          <span class="task-top-actions">
            ${assignmentTargets.length ? `<button class="task-assign-button" type="button" data-show-assignment aria-expanded="${state.assigningTaskId === task.id}">Assign</button>` : ''}
            ${reorderControls}
            <span class="task-status status-${escapeHtml(task.status)}">${escapeHtml(task.status)}</span>
          </span>
        </div>
        <p class="task-prompt">${escapeHtml(task.prompt)}</p>
        ${state.assigningTaskId === task.id ? `
          <div class="task-assignment-options" aria-label="Assign task ${task.id} to another Relay">
            ${assignmentTargets.map((thread) => `<button type="button" data-assign-thread="${escapeHtml(thread.id)}">Relay ${relayNumber(thread)} <span>${escapeHtml(thread.status)}</span></button>`).join('')}
          </div>
        ` : ''}
        <div class="task-footer">
          <span class="task-footer-execution">${escapeHtml(taskCardExecutionLabel(task))}</span>
          <span class="task-footer-timing"><span class="task-duration" data-task-duration="${task.id}">${escapeHtml(taskCardDurationLabel(task))}</span><time>· ${escapeHtml(formatCardTime(task.created_at))}</time></span>
        </div>
      </article>
    `;
  }).join('');

  for (const card of elements.taskList.querySelectorAll('.task-card')) {
    const select = () => selectTask(Number(card.dataset.taskId));
    card.addEventListener('click', (event) => {
      if (!event.target.closest('button, input')) {
        select();
      }
    });
    card.addEventListener('keydown', (event) => {
      if (event.target.closest('button, input')) {
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select();
      }
    });

    for (const button of card.querySelectorAll('[data-move]')) {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        moveQueuedTask(Number(card.dataset.taskId), button.dataset.move === 'up' ? -1 : 1);
      });
    }

    card.querySelector('[data-show-assignment]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const taskId = Number(card.dataset.taskId);
      state.assigningTaskId = state.assigningTaskId === taskId ? null : taskId;
      renderTasks();
    });
    for (const button of card.querySelectorAll('[data-assign-thread]')) {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        assignTaskToThread(Number(card.dataset.taskId), button.dataset.assignThread);
      });
    }

    const parallelCheck = card.querySelector('.parallel-task-check');
    parallelCheck?.addEventListener('change', () => {
      const taskId = Number(card.dataset.taskId);
      if (parallelCheck.checked) state.parallelTaskIds.add(taskId);
      else state.parallelTaskIds.delete(taskId);
      renderParallelBatchBar();
    });

    if (card.dataset.status === 'queued') {
      card.addEventListener('dragstart', (event) => {
        if (event.target.closest('button, input')) {
          event.preventDefault();
          return;
        }
        state.draggedTaskId = Number(card.dataset.taskId);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', card.dataset.taskId);
        card.classList.add('dragging');
      });
      card.addEventListener('dragover', (event) => {
        const draggedId = state.draggedTaskId;
        if (!draggedId || draggedId === Number(card.dataset.taskId)) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const before = event.clientY < card.getBoundingClientRect().top + card.offsetHeight / 2;
        card.classList.toggle('drop-before', before);
        card.classList.toggle('drop-after', !before);
      });
      card.addEventListener('dragleave', () => {
        card.classList.remove('drop-before', 'drop-after');
      });
      card.addEventListener('drop', (event) => {
        event.preventDefault();
        const draggedId = state.draggedTaskId;
        const targetId = Number(card.dataset.taskId);
        const before = event.clientY < card.getBoundingClientRect().top + card.offsetHeight / 2;
        card.classList.remove('drop-before', 'drop-after');
        reorderQueuedDrop(draggedId, targetId, before);
      });
      card.addEventListener('dragend', () => {
        state.draggedTaskId = null;
        for (const item of elements.taskList.querySelectorAll('.task-card')) {
          item.classList.remove('dragging', 'drop-before', 'drop-after');
        }
      });
    }
  }
}

function relayNumber(thread) {
  const relays = state.threads.filter((item) => threadProvider(item) === 'codex');
  const index = relays.findIndex((item) => item.id === thread.id);
  return index === -1 ? '?' : index + 1;
}

function submissionThreadId() {
  if (!state.preferIdleTerminal || state.taskMode !== 'execute' || state.selectedProvider !== 'codex') {
    return state.selectedThreadId;
  }
  const selectedThread = state.threads.find((thread) => thread.id === state.selectedThreadId);
  const routePath = state.activeProjectPath || selectedThread?.cwd;
  const eligible = state.threads.filter((thread) => (
    threadProvider(thread) === 'codex'
    && (!routePath || sameProjectPath(thread.cwd, routePath))
  ));
  const selected = eligible.find((thread) => thread.id === state.selectedThreadId);
  if (selected?.status === 'idle') return selected.id;
  return eligible.find((thread) => thread.status === 'idle')?.id || state.selectedThreadId;
}

function canAssignTaskToThread(taskId, threadId) {
  const task = state.tasks.find((item) => item.id === taskId);
  const thread = state.threads.find((item) => item.id === threadId);
  return task?.status === 'queued'
    && task.mode === 'execute'
    && task.provider === 'codex'
    && threadProvider(thread || {}) === 'codex'
    && sameProjectPath(task.repo_path, thread?.cwd);
}

async function assignTaskToThread(taskId, threadId) {
  try {
    await api(`/api/tasks/${taskId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ threadId }),
    });
    state.assigningTaskId = null;
    await load();
  } catch (error) {
    window.alert(error.message);
  }
}

function renderParallelBatchBar() {
  const selectedCount = state.parallelTaskIds.size;
  const selectedThread = state.threads.find(
    (thread) => thread.id === state.selectedThreadId && threadProvider(thread) === 'codex',
  );
  elements.parallelBatchBar.hidden = selectedCount === 0;
  elements.parallelSelectionCount.textContent = `${selectedCount} selected`;
  elements.parallelSessionSelect.textContent = selectedThread
    ? `${workspaceName(selectedThread.cwd)} · ${selectedThread.title}`
    : 'Select a live Codex terminal';
  const supported = state.status?.capabilities?.parallelCodexBatch === true;
  elements.parallelRunButton.disabled = selectedCount < 2 || !selectedThread || !supported;
  elements.parallelRunButton.textContent = supported ? 'Run in parallel' : 'Restart Relay to enable';
}

async function runParallelBatch() {
  const settings = state.executionSettings.codex;
  elements.parallelRunButton.disabled = true;
  try {
    const body = await api('/api/tasks/parallel-codex', {
      method: 'POST',
      body: JSON.stringify({
        taskIds: [...state.parallelTaskIds],
        threadId: state.selectedThreadId,
        model: settings.model,
        effort: settings.effort || null,
      }),
    });
    state.parallelTaskIds.clear();
    state.selectedTaskId = body.task.id;
    await load();
  } catch (error) {
    elements.queueSummary.textContent = error.message;
    renderParallelBatchBar();
  }
}

function refreshTaskDurations() {
  const tasksById = new Map(state.tasks.map((task) => [task.id, task]));
  for (const element of elements.taskList.querySelectorAll('[data-task-duration]')) {
    const task = tasksById.get(Number(element.dataset.taskDuration));
    if (task) {
      element.textContent = taskCardDurationLabel(task);
    }
  }
}

async function reorderQueuedTasks(taskIds) {
  if (state.reorderPending) {
    return;
  }
  state.reorderPending = true;
  elements.taskList.dataset.reordering = 'true';
  try {
    await api('/api/queue/reorder', {
      method: 'POST',
      body: JSON.stringify({ taskIds }),
    });
    await load();
  } catch (error) {
    window.alert(error.message);
    await load();
  } finally {
    state.reorderPending = false;
    delete elements.taskList.dataset.reordering;
  }
}

function moveQueuedTask(taskId, direction) {
  const visibleIds = projectTasks().filter((task) => task.status === 'queued').map((task) => task.id);
  const from = visibleIds.indexOf(taskId);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= visibleIds.length) {
    return;
  }
  [visibleIds[from], visibleIds[to]] = [visibleIds[to], visibleIds[from]];
  reorderQueuedTasks(mergeProjectQueueOrder(visibleIds));
}

function reorderQueuedDrop(draggedId, targetId, before) {
  const visibleIds = projectTasks().filter((task) => task.status === 'queued').map((task) => task.id);
  if (!visibleIds.includes(draggedId) || !visibleIds.includes(targetId) || draggedId === targetId) {
    return;
  }
  const nextIds = visibleIds.filter((id) => id !== draggedId);
  const targetIndex = nextIds.indexOf(targetId);
  nextIds.splice(targetIndex + (before ? 0 : 1), 0, draggedId);
  reorderQueuedTasks(mergeProjectQueueOrder(nextIds));
}

function mergeProjectQueueOrder(projectTaskIds) {
  const projectIdSet = new Set(projectTaskIds);
  let projectIndex = 0;
  return state.tasks
    .filter((task) => task.status === 'queued')
    .map((task) => projectIdSet.has(task.id) ? projectTaskIds[projectIndex++] : task.id);
}

function actionButton(label, action, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.className = `button compact ${className}`.trim();
  button.addEventListener('click', action);
  return button;
}

function planStatusLabel(status) {
  const labels = {
    drafting: 'Claude drafting',
    reviewing: 'Codex reviewing',
    revising: 'Claude revising',
    complete: 'Complete',
    failed: 'Failed',
    cancelled: 'Cancelled',
    interrupted: 'Interrupted',
    queued: 'Queued',
    running: 'Starting',
  };
  return labels[status] || 'Preparing';
}

function renderPlanPreview(plan, task) {
  elements.planPreview.hidden = false;
  elements.resultSection.hidden = true;
  const status = plan?.status || task.status;
  elements.planStatus.textContent = planStatusLabel(status);
  elements.planStatus.dataset.state = status;

  const stages = plan?.stages || [
    { id: 'draft', label: 'Claude draft', provider: 'claude', status: 'pending' },
    { id: 'review', label: 'Codex review', provider: 'codex', status: 'pending' },
    { id: 'revision', label: 'Claude revision', provider: 'claude', status: 'pending' },
  ];
  elements.planStageRail.innerHTML = stages.map((stage, index) => `
    <div class="plan-stage" data-state="${escapeHtml(stage.status)}">
      <span class="plan-stage-number">0${index + 1}</span>
      <span class="agent-icon ${providerIconClass(stage.provider)}" aria-hidden="true">${providerIcon(stage.provider)}</span>
      <span><strong>${escapeHtml(stage.label)}</strong><small>${escapeHtml(stage.status)}</small></span>
    </div>
  `).join('');

  const author = plan?.author || {
    provider: task.author_provider,
    model: task.author_model,
    effort: task.author_effort,
  };
  const reviewer = plan?.reviewer || {
    provider: task.reviewer_provider,
    model: task.reviewer_model,
    effort: task.reviewer_effort,
  };
  elements.planAgentSummary.innerHTML = `
    <span><b>Author</b> Claude · ${escapeHtml(author.model || 'Fable')} · ${escapeHtml(author.effort || 'max')}</span>
    <i aria-hidden="true">→</i>
    <span><b>Reviewer</b> Codex · ${escapeHtml(reviewer.model || 'account model')} · ${escapeHtml(reviewer.effort || 'default')}</span>
    ${(task.attachments || []).length ? `<span><b>Images</b> ${(task.attachments || []).length} shared references</span>` : ''}
  `;

  const hasDraft = Boolean(plan?.draft);
  const hasReview = Boolean(plan?.review);
  const hasFinal = Boolean(plan?.finalPlan);
  elements.planDraftSection.hidden = !hasDraft;
  elements.planReviewSection.hidden = !hasReview;
  elements.planFinalSection.hidden = !hasFinal;
  elements.planDraft.innerHTML = hasDraft ? renderMarkdown(plan.draft) : '';
  elements.planReview.innerHTML = hasReview ? renderMarkdown(plan.review) : '';
  elements.planFinal.innerHTML = hasFinal ? renderMarkdown(plan.finalPlan) : '';
  elements.planWaiting.hidden = hasFinal;
  if (!hasFinal) {
    const planError = plan?.error || task.error;
    elements.planWaiting.textContent = planError || (
      status === 'queued'
        ? 'The council is queued. Claude will draft first, then Codex will review.'
        : status === 'reviewing'
          ? 'Claude finished the first draft. Codex is reviewing it now.'
          : status === 'revising'
            ? 'Codex finished the review. Claude is producing the final revised plan.'
            : 'The council is preparing the first draft.'
    );
    elements.planWaiting.dataset.state = planError ? 'error' : status;
  }
}

function renderTurboPreview(plan, task) {
  elements.turboPreview.hidden = false;
  elements.resultSection.hidden = task.status === 'running' || task.status === 'queued';
  elements.turboPreviewStatus.textContent = plan?.status || task.status;
  elements.turboPreviewStatus.dataset.state = plan?.status || task.status;
  elements.turboPreviewSummary.textContent = plan?.summary || 'The planner is producing a machine-readable dependency graph.';
  elements.turboTaskGraph.innerHTML = (plan?.tasks || []).map((item) => `
    <article data-state="${escapeHtml(item.status || 'pending')}">
      <span>${escapeHtml(item.id)}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <small>${item.dependsOn?.length ? `Waits for ${escapeHtml(item.dependsOn.join(', '))}` : 'Ready immediately'}${item.worker ? ` · Worker ${item.worker}` : ''}</small>
    </article>
  `).join('');
}

async function selectTask(taskId) {
  const eventTaskChanged = state.eventTaskId !== taskId;
  state.selectedTaskId = taskId;
  renderTasks();
  const { task, events, plan = null, turboPlan = null } = await api(`/api/tasks/${taskId}`);
  elements.emptyDetail.hidden = true;
  elements.taskDetail.hidden = false;
  elements.detailTitle.textContent = `Task ${String(task.id).padStart(3, '0')}`;
  elements.detailMeta.innerHTML = `
    <span class="task-status status-${escapeHtml(task.status)}">${escapeHtml(task.status)}</span>
    <span class="detail-agent">
      ${agentBadgeMarkup(task, 'detail-agent-icon')}
      ${escapeHtml(providerLabel(taskProvider(task)))}
    </span>
    <span>${escapeHtml(executionLabel(task))}</span>
    <span>${escapeHtml(workspaceName(task.repo_path))}</span>
    <span>${escapeHtml(formatTime(task.created_at))}</span>
  `;
  elements.detailPrompt.textContent = task.prompt;
  const attachments = task.attachments || [];
  elements.detailAttachmentsSection.hidden = attachments.length === 0;
  elements.detailAttachmentsCount.textContent = `${attachments.length} image${attachments.length === 1 ? '' : 's'}`;
  elements.detailAttachments.innerHTML = attachments.map((attachment, index) => `
    <a href="/api/tasks/${task.id}/attachments/${encodeURIComponent(attachment.id)}" target="_blank" rel="noreferrer" class="detail-attachment">
      <img src="/api/tasks/${task.id}/attachments/${encodeURIComponent(attachment.id)}" alt="${escapeHtml(attachment.name)}" loading="lazy">
      <span><b>${String(index + 1).padStart(2, '0')}</b><strong>${escapeHtml(attachment.name)}</strong><small>${escapeHtml(formatBytes(attachment.size))}</small></span>
    </a>
  `).join('');
  elements.detailResult.textContent = task.result || task.error || `Waiting for ${providerLabel(taskProvider(task))} to finish this task.`;
  elements.detailResult.dataset.empty = task.result || task.error ? 'false' : 'true';
  if (task.mode === 'plan') {
    renderPlanPreview(plan, task);
    elements.turboPreview.hidden = true;
  } else if (task.mode === 'turbo') {
    elements.planPreview.hidden = true;
    renderTurboPreview(turboPlan, task);
  } else {
    elements.planPreview.hidden = true;
    elements.turboPreview.hidden = true;
    elements.resultSection.hidden = false;
  }
  elements.detailActions.replaceChildren();

  if (task.status === 'queued' || task.status === 'running') {
    elements.detailActions.append(actionButton('Cancel', () => taskAction(task.id, 'cancel'), 'danger'));
  }
  if (['failed', 'cancelled', 'interrupted'].includes(task.status)) {
    elements.detailActions.append(actionButton('Retry', () => taskAction(task.id, 'retry'), 'primary'));
  }
  if (task.status !== 'running') {
    elements.detailActions.append(actionButton('Delete', () => deleteTask(task.id), 'danger quiet'));
  }

  state.eventTaskId = taskId;
  renderEventStream(events, task, { forceBottom: eventTaskChanged, resetDisclosures: eventTaskChanged });
}

async function loadSnapshot() {
  const [statusBody, tasksBody] = await Promise.all([
    api('/api/status'),
    api('/api/tasks'),
  ]);
  state.status = statusBody;
  state.tasks = tasksBody.tasks;
  await loadProjects();
  const launcherEnabled = state.status?.capabilities?.projectLauncher === true;
  elements.launchTerminalButton.disabled = !launcherEnabled;
  elements.launchTerminalButton.textContent = launcherEnabled ? 'Launch terminal' : 'Restart Relay to launch';

  const selectedTaskStillExists = state.selectedTaskId
    && projectTasks().some((task) => task.id === state.selectedTaskId);
  if (!selectedTaskStillExists) {
    state.selectedTaskId = projectTasks().find((task) => task.status === 'running')?.id || null;
  }

  if (!state.selectedTaskId) {
    elements.taskDetail.hidden = true;
    elements.emptyDetail.hidden = false;
  }

  renderStatus();
  renderTasks();
  renderPlanControls();
  renderTurboControls();
  renderAttachmentComposer();
  updateSubmitState();
  if (state.selectedTaskId) {
    await selectTask(state.selectedTaskId);
  }
}

async function load() {
  if (state.loadPromise) {
    return state.loadPromise;
  }
  state.loadPromise = loadSnapshot();
  try {
    return await state.loadPromise;
  } finally {
    state.loadPromise = null;
  }
}

function applyThreadSelection(threadId) {
  state.selectedThreadId = threadId;
  if (threadId) {
    state.showAllTaskHistory = false;
    localStorage.setItem('relay.showAllTaskHistory', 'false');
  }
  if (state.selectedTaskId && !projectTasks().some((task) => task.id === state.selectedTaskId)) {
    state.selectedTaskId = null;
    elements.taskDetail.hidden = true;
    elements.emptyDetail.hidden = false;
  }
  elements.threadInput.value = threadId || '';
  for (const option of elements.terminalList.querySelectorAll('.terminal-option')) {
    const selected = option.dataset.threadId === threadId;
    option.classList.toggle('selected', selected);
    option.setAttribute('aria-checked', String(selected));
  }
  renderStatus();
  renderTasks();
  renderTaskScope();
  renderPlanControls();
  renderTurboControls();
  updateSubmitState();
}

function selectProvider(provider, { focus = false } = {}) {
  if (provider === state.selectedProvider) {
    return;
  }
  state.selectedProvider = provider;
  state.selectedThreadId = null;
  renderProviderTabs();
  renderExecutionControls();
  renderThreads();
  loadModels(provider);
  if (focus) {
    document.querySelector(`#provider-${provider}`)?.focus();
  }
}

function renderThreads() {
  const visibleThreads = projectThreads();
  const isClaude = state.selectedProvider === 'claude';
  elements.idleTerminalRoute.hidden = isClaude || state.taskMode !== 'execute';
  elements.preferIdleTerminal.checked = state.preferIdleTerminal;
  const directClaudeEnabled = isDirectClaudeEnabled();
  const launcherEnabled = state.status?.capabilities?.projectLauncher === true;
  elements.launchTerminalButton.disabled = !launcherEnabled;
  elements.launchTerminalButton.textContent = launcherEnabled ? 'Launch terminal' : 'Restart Relay to launch';
  elements.terminalLegend.textContent = state.taskMode === 'plan'
    ? 'Codex review terminal'
    : state.taskMode === 'turbo' ? 'Planner terminal'
    : isClaude ? 'Run in Claude session' : 'Run in Codex terminal';
  elements.terminalList.setAttribute('aria-label', isClaude ? 'Live Claude Code sessions' : 'Connected Codex terminals');
  elements.launchCommand.textContent = isClaude
    ? state.connection?.claudeLaunchCommand || 'claude --dangerously-skip-permissions'
    : state.connection?.launchCommand || 'codex --dangerously-bypass-approvals-and-sandbox --remote ws://127.0.0.1:4769';
  elements.connectionHelpCopy.textContent = isClaude
    ? 'Starts Claude with all permission checks disabled. Use only in a project you fully trust.'
    : 'Starts Codex through Relay with approvals and sandboxing disabled. Use only in a project you fully trust.';
  const availableIds = new Set(visibleThreads.map((thread) => thread.id));
  if (!availableIds.has(state.selectedThreadId)) {
    state.selectedThreadId = visibleThreads[0]?.id || null;
    if (state.selectedThreadId) {
      state.showAllTaskHistory = false;
      localStorage.setItem('relay.showAllTaskHistory', 'false');
    }
  }

  if (visibleThreads.length === 0) {
    elements.terminalList.innerHTML = `
      <div class="terminal-empty">
        <span class="agent-icon ${isClaude ? 'agent-icon-claude' : 'agent-icon-codex'}" aria-hidden="true">${isClaude ? '✳' : '&gt;_'}</span>
        <div>
          <strong>${isClaude ? directClaudeEnabled ? 'No live Claude Code session' : 'Claude connection update is ready' : 'No Codex terminal connected'}${state.activeProjectPath ? ` in ${escapeHtml(workspaceName(state.activeProjectPath))}` : ''}</strong>
          <p>${isClaude ? directClaudeEnabled ? 'Open Claude in a project, then Relay will discover it automatically.' : 'Restart Relay after the running queue finishes to activate the new backend adapter.' : 'Open the connection instructions below, then refresh.'}</p>
        </div>
      </div>
    `;
    elements.threadInput.value = '';
    elements.sessionMessage.textContent = isClaude
      ? directClaudeEnabled
        ? '0 live Claude sessions. Relay checks the official Claude agent list.'
        : 'Claude discovery will activate on the next normal Relay restart.'
      : 'Relay is online and waiting for a Codex terminal.';
    updateSubmitState();
    elements.connectionHelp.open = true;
    elements.connectionHelpTitle.textContent = isClaude ? 'Open a Claude Code session' : 'Connect another Codex terminal';
    elements.connectionHelpCopy.textContent = isClaude
      ? directClaudeEnabled
        ? 'Runs Claude with all permission checks disabled. Use only in a project you fully trust. Relay then discovers the live session.'
        : 'The source update is complete. Keep the current queue running and restart Relay normally when it becomes idle.'
      : 'Runs Codex through Relay with approvals and sandboxing disabled. Use only in a project you fully trust.';
    elements.connectionCommandRow.hidden = false;
    renderProviderTabs();
    renderStatus();
    renderPlanControls();
    renderTurboControls();
    return;
  }

  elements.terminalList.innerHTML = visibleThreads.map((thread) => {
    const selected = thread.id === state.selectedThreadId;
    const provider = threadProvider(thread);
    const activity = relayActivity(thread);
    return `
      <button
        class="terminal-option ${selected ? 'selected' : ''}"
        type="button"
        role="radio"
        aria-checked="${selected}"
        data-thread-id="${escapeHtml(thread.id)}"
      >
        <span class="agent-icon ${provider === 'claude' ? 'agent-icon-claude' : 'agent-icon-codex'} terminal-agent-icon" aria-hidden="true">${provider === 'claude' ? '✳' : '&gt;_'}</span>
        <span class="terminal-choice" aria-hidden="true"><span></span></span>
        <span class="terminal-copy">
          <span class="terminal-primary">
            <strong>${escapeHtml(provider === 'claude' ? thread.title : `Relay ${relayNumber(thread)} · ${workspaceName(thread.cwd)}`)}</strong>
            <span class="terminal-state state-${escapeHtml(activity.state)}">${escapeHtml(activity.state)}</span>
          </span>
          <span class="terminal-preview">${escapeHtml(provider === 'claude' && activity.state === 'idle' ? `${workspaceName(thread.cwd)} · ${activity.label}` : activity.label)}</span>
          <span class="terminal-meta">${escapeHtml(thread.source)}${thread.pid ? ` · PID ${escapeHtml(thread.pid)}` : ''} · ${escapeHtml(thread.id.slice(0, 8))} · ${escapeHtml(thread.cwd)}</span>
        </span>
      </button>
    `;
  }).join('');

  for (const option of elements.terminalList.querySelectorAll('.terminal-option')) {
    option.addEventListener('click', () => applyThreadSelection(option.dataset.threadId));
    option.addEventListener('dragover', (event) => {
      if (!canAssignTaskToThread(state.draggedTaskId, option.dataset.threadId) || isClaude) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      option.classList.add('task-drop-target');
    });
    option.addEventListener('dragleave', () => option.classList.remove('task-drop-target'));
    option.addEventListener('drop', (event) => {
      event.preventDefault();
      option.classList.remove('task-drop-target');
      const taskId = state.draggedTaskId || Number(event.dataTransfer.getData('text/plain'));
      if (canAssignTaskToThread(taskId, option.dataset.threadId)) {
        assignTaskToThread(taskId, option.dataset.threadId);
      }
    });
    option.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) {
        return;
      }
      event.preventDefault();
      const options = [...elements.terminalList.querySelectorAll('.terminal-option')];
      const currentIndex = options.indexOf(option);
      const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
      const nextOption = options[(currentIndex + direction + options.length) % options.length];
      applyThreadSelection(nextOption.dataset.threadId);
      nextOption.focus();
    });
  }

  elements.threadInput.value = state.selectedThreadId;
  elements.sessionMessage.textContent = state.taskMode === 'plan'
    ? `${visibleThreads.length} live Codex terminal${visibleThreads.length === 1 ? '' : 's'}. Choose where the independent review should run.`
    : state.taskMode === 'turbo'
      ? `${visibleThreads.length} live Codex terminals. Choose the planner; Relay uses other terminals in this workspace as workers.`
    : `${visibleThreads.length} live ${providerLabel(state.selectedProvider)} session${visibleThreads.length === 1 ? '' : 's'}. Choose where this prompt should run.`;
  updateSubmitState();
  elements.connectionHelpTitle.textContent = isClaude
    ? 'Open another Claude Code session'
    : 'Connect another Codex terminal';
  elements.connectionHelpCopy.textContent = isClaude
    ? 'Runs Claude with all permission checks disabled. Use only in a project you fully trust.'
    : 'Runs Codex through Relay with approvals and sandboxing disabled. Use only in a project you fully trust.';
  elements.connectionCommandRow.hidden = false;
  renderProviderTabs();
  renderStatus();
  renderTasks();
  renderTaskScope();
  renderPlanControls();
  renderTurboControls();
}

async function loadThreads({ silent = false } = {}) {
  const requestSequence = ++state.threadLoadSequence;
  if (!silent) {
    elements.sessionRefreshButton.disabled = true;
    elements.sessionRefreshButton.textContent = 'Checking';
    elements.sessionMessage.textContent = 'Checking live terminal connections.';
  }
  try {
    const { threads, connection, providers = [] } = await api('/api/threads');
    if (requestSequence !== state.threadLoadSequence) {
      return;
    }
    state.threads = threads;
    state.connection = connection;
    state.providers = providers;
    renderThreads();
    renderParallelBatchBar();
  } catch (error) {
    if (!silent && requestSequence === state.threadLoadSequence) {
      state.threads = [];
      renderThreads();
      renderParallelBatchBar();
      elements.sessionMessage.textContent = error.message;
    }
  } finally {
    if (!silent && requestSequence === state.threadLoadSequence) {
      elements.sessionRefreshButton.disabled = false;
      elements.sessionRefreshButton.textContent = 'Refresh';
    }
  }
}

async function taskAction(taskId, action) {
  try {
    await api(`/api/tasks/${taskId}/${action}`, { method: 'POST' });
    await load();
  } catch (error) {
    window.alert(error.message);
  }
}

async function deleteTask(taskId) {
  if (!window.confirm('Delete this task from Relay?')) {
    return;
  }
  try {
    await api(`/api/tasks/${taskId}`, { method: 'DELETE' });
    state.selectedTaskId = null;
    elements.taskDetail.hidden = true;
    elements.emptyDetail.hidden = false;
    await load();
  } catch (error) {
    window.alert(error.message);
  }
}

elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  elements.formMessage.textContent = '';
  const runNow = state.prioritySubmit;
  state.prioritySubmit = false;
  const routedThreadId = submissionThreadId();
  if (!routedThreadId) {
    elements.formMessage.textContent = 'Choose a connected AI session first.';
    return;
  }

  if (state.taskMode === 'plan' && !isClaudePlanReady()) {
    elements.formMessage.textContent = 'Plan council needs a signed-in Claude CLI and a Relay restart.';
    return;
  }

  const formData = new FormData(elements.form);
  const execution = selectedExecution();
  const attachments = state.attachments.map((attachment) => ({
    name: attachment.name,
    mimeType: attachment.mimeType,
    data: attachment.data,
  }));
  const requestBody = state.taskMode === 'plan'
    ? {
      mode: 'plan',
      threadId: routedThreadId,
      prompt: formData.get('prompt'),
      authorProvider: 'claude',
      authorModel: state.planSettings.authorModel,
      authorEffort: state.planSettings.authorEffort,
      reviewerProvider: 'codex',
      reviewerModel: state.planSettings.reviewerModel,
      reviewerEffort: state.planSettings.reviewerEffort || null,
      attachments,
      runNow,
    }
    : state.taskMode === 'turbo'
      ? {
        mode: 'turbo',
        threadId: routedThreadId,
        prompt: formData.get('prompt'),
        plannerModel: state.turboSettings.plannerModel,
        plannerEffort: state.turboSettings.plannerEffort || null,
        workerModel: state.turboSettings.workerModel,
        workerEffort: state.turboSettings.workerEffort || null,
        workerCount: state.turboSettings.workerCount,
        attachments,
        runNow,
      }
      : {
      mode: 'execute',
      provider: state.selectedProvider,
      threadId: routedThreadId,
      prompt: formData.get('prompt'),
      model: execution.model,
      effort: execution.effort || null,
      attachments,
      runNow,
    };
  state.submitting = true;
  updateSubmitState();
  try {
    await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    });
    elements.prompt.value = '';
    state.attachments = [];
    renderAttachmentComposer();
    await load();
  } catch (error) {
    elements.formMessage.textContent = error.message;
  } finally {
    state.submitting = false;
    updateSubmitState();
  }
});

elements.pauseButton.addEventListener('click', async () => {
  const action = state.status?.paused ? 'resume' : 'pause';
  try {
    await api(`/api/queue/${action}`, { method: 'POST' });
    await load();
  } catch (error) {
    window.alert(error.message);
  }
});

elements.refreshButton.addEventListener('click', load);
elements.taskScopeButton.addEventListener('click', () => {
  state.showAllTaskHistory = !state.showAllTaskHistory;
  localStorage.setItem('relay.showAllTaskHistory', String(state.showAllTaskHistory));
  state.selectedTaskId = null;
  state.parallelTaskIds.clear();
  elements.taskDetail.hidden = true;
  elements.emptyDetail.hidden = false;
  renderTaskScope();
  renderStatus();
  renderTasks();
});

function constrainPanelWidths(composer, detail) {
  const available = Math.max(elements.workspace.clientWidth - 64, 0);
  const minimumQueue = 320;
  const minimumComposer = 360;
  const minimumDetail = 420;
  const maxComposer = Math.max(minimumComposer, available - detail - minimumQueue);
  const nextComposer = Math.min(Math.max(composer, minimumComposer), maxComposer);
  const maxDetail = Math.max(minimumDetail, available - nextComposer - minimumQueue);
  return { composer: nextComposer, detail: Math.min(Math.max(detail, minimumDetail), maxDetail) };
}

function applyPanelWidths({ persist = false } = {}) {
  state.panelWidths = constrainPanelWidths(state.panelWidths.composer, state.panelWidths.detail);
  elements.workspace.style.setProperty('--composer-width', `${state.panelWidths.composer}px`);
  elements.workspace.style.setProperty('--detail-width', `${state.panelWidths.detail}px`);
  elements.composerQueueResizer.setAttribute('aria-valuenow', String(Math.round(state.panelWidths.composer)));
  elements.queueDetailResizer.setAttribute('aria-valuenow', String(Math.round(state.panelWidths.detail)));
  elements.composerQueueResizer.setAttribute('aria-valuemin', '360');
  elements.composerQueueResizer.setAttribute('aria-valuemax', String(Math.round(Math.max(360, elements.workspace.clientWidth - state.panelWidths.detail - 384))));
  elements.composerQueueResizer.setAttribute('aria-valuetext', `Prompt panel ${Math.round(state.panelWidths.composer)} pixels wide`);
  elements.queueDetailResizer.setAttribute('aria-valuemin', '420');
  elements.queueDetailResizer.setAttribute('aria-valuemax', String(Math.round(Math.max(420, elements.workspace.clientWidth - state.panelWidths.composer - 384))));
  elements.queueDetailResizer.setAttribute('aria-valuetext', `Activity panel ${Math.round(state.panelWidths.detail)} pixels wide`);
  if (persist) localStorage.setItem('relay.panelWidths', JSON.stringify(state.panelWidths));
}

function attachWorkspaceResizer(handle, side) {
  const resizeBy = (delta) => {
    if (side === 'composer') state.panelWidths.composer += delta;
    else state.panelWidths.detail -= delta;
    applyPanelWidths({ persist: true });
  };
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const startX = event.clientX;
    const startingWidths = { ...state.panelWidths };
    handle.setPointerCapture(event.pointerId);
    document.body.dataset.resizingPanels = 'true';
    const move = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      state.panelWidths = side === 'composer'
        ? { ...startingWidths, composer: startingWidths.composer + delta }
        : { ...startingWidths, detail: startingWidths.detail - delta };
      applyPanelWidths();
    };
    const finish = (finishEvent) => {
      if (finishEvent?.pointerId != null && finishEvent.pointerId !== event.pointerId) return;
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      handle.removeEventListener('lostpointercapture', finish);
      delete document.body.dataset.resizingPanels;
      applyPanelWidths({ persist: true });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('lostpointercapture', finish);
  });
  handle.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    resizeBy(event.key === 'ArrowRight' ? 20 : -20);
  });
}

attachWorkspaceResizer(elements.composerQueueResizer, 'composer');
attachWorkspaceResizer(elements.queueDetailResizer, 'detail');
applyPanelWidths();
window.addEventListener('resize', () => applyPanelWidths());
elements.parallelClearButton.addEventListener('click', () => {
  state.parallelTaskIds.clear();
  renderTasks();
});
elements.parallelRunButton.addEventListener('click', runParallelBatch);
elements.sessionRefreshButton.addEventListener('click', loadThreads);
elements.preferIdleTerminal.addEventListener('change', () => {
  state.preferIdleTerminal = elements.preferIdleTerminal.checked;
  localStorage.setItem('relay.preferIdleTerminal', String(state.preferIdleTerminal));
});
elements.addProjectButton.addEventListener('click', () => chooseProject(false));
elements.addLaunchProjectButton.addEventListener('click', () => chooseProject(true));
elements.projectList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-project-action]');
  const chip = event.target.closest('[data-project-id]');
  if (!chip) return;
  const id = Number(chip.dataset.projectId);
  const project = state.projects.find((item) => item.id === id);
  if (!button) {
    if (project) selectProject(project.path);
    return;
  }
  button.disabled = true;
  try {
    if (button.dataset.projectAction === 'delete') {
      await api(`/api/projects/${id}`, { method: 'DELETE' });
      await loadProjects();
      return;
    }
    await launchProject(project, button.dataset.provider);
  } catch (error) {
    elements.formMessage.textContent = error.message;
    button.disabled = false;
  }
});
elements.projectList.addEventListener('keydown', (event) => {
  const chip = event.target.closest('[data-project-id]');
  if (!chip || event.target.closest('button') || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  const project = state.projects.find((item) => item.id === Number(chip.dataset.projectId));
  if (project) selectProject(project.path);
});
elements.modelSelect.addEventListener('input', () => {
  const settings = selectedExecution();
  settings.model = elements.modelSelect.value;
  settings.effort = '';
  renderExecutionControls();
});
elements.effortSelect.addEventListener('input', () => {
  const values = JSON.parse(elements.effortSelect.dataset.values || '[""]');
  selectedExecution().effort = values[Number(elements.effortSelect.value)] || '';
  renderExecutionControls();
});
elements.attachmentInput.addEventListener('change', async () => {
  await addImageFiles(elements.attachmentInput.files || []);
  elements.attachmentInput.value = '';
});
elements.attachmentDropzone.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && !elements.attachmentInput.disabled) {
    event.preventDefault();
    elements.attachmentInput.click();
  }
});
elements.attachmentDropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  elements.attachmentDropzone.dataset.dragging = 'true';
  event.dataTransfer.dropEffect = 'copy';
});
elements.attachmentDropzone.addEventListener('dragleave', () => {
  delete elements.attachmentDropzone.dataset.dragging;
});
elements.attachmentDropzone.addEventListener('drop', async (event) => {
  event.preventDefault();
  delete elements.attachmentDropzone.dataset.dragging;
  await addImageFiles(event.dataTransfer.files || []);
});
elements.planAuthorModel.addEventListener('input', () => {
  state.planSettings.authorModel = elements.planAuthorModel.value;
  renderPlanControls();
});
elements.planReviewerModel.addEventListener('input', () => {
  state.planSettings.reviewerModel = elements.planReviewerModel.value;
  state.planSettings.reviewerEffort = 'high';
  renderPlanControls();
  updateSubmitState();
});
elements.planReviewerEffort.addEventListener('change', () => {
  state.planSettings.reviewerEffort = elements.planReviewerEffort.value;
  renderPlanControls();
});
elements.turboPlannerModel.addEventListener('input', () => {
  state.turboSettings.plannerModel = elements.turboPlannerModel.value;
  state.turboSettings.plannerEffort = 'high';
  renderTurboControls();
  updateSubmitState();
});
elements.turboPlannerEffort.addEventListener('change', () => {
  state.turboSettings.plannerEffort = elements.turboPlannerEffort.value;
});
elements.turboWorkerModel.addEventListener('input', () => {
  state.turboSettings.workerModel = elements.turboWorkerModel.value;
  state.turboSettings.workerEffort = 'high';
  renderTurboControls();
  updateSubmitState();
});
elements.turboWorkerEffort.addEventListener('change', () => {
  state.turboSettings.workerEffort = elements.turboWorkerEffort.value;
});
elements.turboWorkerCount.addEventListener('input', () => {
  state.turboSettings.workerCount = Math.min(8, Math.max(1, Number(elements.turboWorkerCount.value) || 1));
  renderTurboControls();
  updateSubmitState();
});
elements.prompt.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
    return;
  }
  event.preventDefault();
  if (elements.submitButton.disabled) {
    elements.formMessage.textContent = state.taskMode === 'plan'
      ? !isClaudePlanReady()
        ? 'Plan council needs a signed-in Claude CLI and a Relay restart.'
        : 'Choose a connected Codex review terminal before sending.'
      : state.taskMode === 'turbo'
        ? `Turbo needs one planner and ${state.turboSettings.workerCount} worker terminals connected in this workspace.`
      : state.selectedProvider === 'claude'
        ? 'Connect a Claude session before sending.'
        : 'Choose a connected terminal before sending.';
    return;
  }
  state.prioritySubmit = event.ctrlKey;
  elements.form.requestSubmit();
});
elements.form.addEventListener('paste', async (event) => {
  const imageFiles = clipboardImageFiles(event.clipboardData);
  if (imageFiles.length === 0) {
    return;
  }
  event.preventDefault();
  await addImageFiles(imageFiles);
});
for (const tab of elements.modeTabs) {
  tab.addEventListener('click', () => selectMode(tab.dataset.mode));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const currentIndex = elements.modeTabs.indexOf(tab);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? elements.modeTabs.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + elements.modeTabs.length) % elements.modeTabs.length;
    selectMode(elements.modeTabs[nextIndex].dataset.mode, { focus: true });
  });
}
for (const tab of elements.providerTabs) {
  tab.addEventListener('click', () => selectProvider(tab.dataset.provider));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const currentIndex = elements.providerTabs.indexOf(tab);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? elements.providerTabs.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + elements.providerTabs.length) % elements.providerTabs.length;
    selectProvider(elements.providerTabs[nextIndex].dataset.provider, { focus: true });
  });
}
elements.copyCommandButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(elements.launchCommand.textContent);
    elements.copyCommandButton.textContent = 'Copied';
  } catch {
    elements.copyCommandButton.textContent = 'Copy failed';
  }
  setTimeout(() => {
    elements.copyCommandButton.textContent = 'Copy';
  }, 1200);
});
elements.copyDiagnosticsButton.addEventListener('click', async () => {
  elements.copyDiagnosticsButton.disabled = true;
  try {
    const body = await api('/api/diagnostics?limit=500');
    const text = body.entries.map((entry) => JSON.stringify(entry)).join('\n');
    await navigator.clipboard.writeText(text);
    elements.copyDiagnosticsButton.textContent = `Copied ${body.entries.length} logs`;
    elements.formMessage.textContent = `Diagnostics copied from ${body.file}.`;
  } catch (error) {
    elements.copyDiagnosticsButton.textContent = 'Copy failed';
    elements.formMessage.textContent = error.message;
  } finally {
    setTimeout(() => {
      elements.copyDiagnosticsButton.disabled = false;
      elements.copyDiagnosticsButton.textContent = 'Copy diagnostics';
    }, 1600);
  }
});
elements.launchTerminalButton.addEventListener('click', async () => {
  let project = activeProject();
  const selectedThread = state.threads.find((thread) => thread.id === state.selectedThreadId);
  if (!project && selectedThread?.cwd) {
    try {
      const body = await api('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ path: selectedThread.cwd }),
      });
      project = body.project;
      await loadProjects();
    } catch (error) {
      elements.formMessage.textContent = error.message;
      return;
    }
  }
  if (!project) {
    await chooseProject(true);
    return;
  }
  elements.launchTerminalButton.disabled = true;
  try {
    await launchProject(project, projectProvider());
  } catch (error) {
    elements.formMessage.textContent = error.message;
  } finally {
    elements.launchTerminalButton.disabled = false;
  }
});

for (const control of [
  elements.terminalLayoutEnabled,
  elements.terminalLayoutColumns,
  elements.terminalLayoutRows,
  elements.terminalLayoutDisplay,
]) {
  control.addEventListener('change', saveTerminalLayout);
}

for (const button of elements.eventFilters) {
  button.addEventListener('click', () => {
    state.eventFilter = button.dataset.eventFilter;
    renderEventStream(state.selectedTaskEvents, state.selectedTaskForEvents);
  });
}

elements.copyEventsButton.addEventListener('click', async () => {
  const text = state.visibleEventEntries
    .map((entry) => eventCopyText(entry, state.selectedTaskForEvents))
    .join('\n\n');
  try {
    await navigator.clipboard.writeText(text);
    elements.copyEventsButton.textContent = 'Copied';
  } catch {
    elements.copyEventsButton.textContent = 'Copy failed';
  }
  setTimeout(() => {
    elements.copyEventsButton.textContent = 'Copy log';
  }, 1200);
});

elements.followEventsButton.addEventListener('click', () => {
  state.eventFollow = !state.eventFollow;
  if (state.eventFollow) {
    elements.detailEvents.scrollTop = elements.detailEvents.scrollHeight;
  }
  updateEventControls();
});

elements.detailEvents.addEventListener('scroll', () => {
  const distanceFromBottom = elements.detailEvents.scrollHeight
    - elements.detailEvents.scrollTop
    - elements.detailEvents.clientHeight;
  const following = distanceFromBottom < 36;
  if (state.eventFollow !== following) {
    state.eventFollow = following;
    updateEventControls();
  }
});

elements.detailEvents.addEventListener('toggle', (event) => {
  if (!(event.target instanceof HTMLDetailsElement)) return;
  const key = eventDisclosureKey(event.target);
  if (!key) return;
  if (event.target.open) state.expandedEventDetails.add(key);
  else state.expandedEventDetails.delete(key);
}, true);

const events = new EventSource('/api/events');
let refreshTimer = null;
events.addEventListener('change', (event) => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    let change = {};
    try {
      change = JSON.parse(event.data);
    } catch {}
    const operations = [load()];
    if (change.threads) {
      operations.push(loadThreads());
    }
    Promise.all(operations).catch(console.error);
  }, 150);
});

renderProviderTabs();
renderExecutionControls();
renderPlanControls();
renderTurboControls();
renderAttachmentComposer();
updateSubmitState();
Promise.all([load(), loadThreads(), loadModels('codex'), loadModels('claude'), loadTerminalDisplays()]).catch((error) => {
  elements.queueSummary.textContent = error.message;
});

setInterval(() => {
  loadThreads({ silent: true }).catch(console.error);
}, 4_000);

setInterval(() => {
  if (document.visibilityState === 'visible') {
    load().catch(console.error);
  }
}, 2_000);

setInterval(refreshTaskDurations, 1_000);
