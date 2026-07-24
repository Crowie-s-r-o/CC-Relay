import {
  entryFirstEvent,
  entryItem,
  entryLastEvent,
  eventEntryCategory,
  filterEventEntries,
  groupEventEntries,
  eventStreamStats,
} from './event-stream.js';
import { taskDurationLabel, formatElapsedDuration } from './task-time.js';
import { clipboardImageFiles } from './clipboard-images.js';
import { parallelClaudeRestartRequired, projectQueueRestartRequired } from './project-queue-state.js';
import { terminalClosePresentation } from './terminal-close-state.js';
import { idleExecutionThreadId, runningDirectTask, selectedExecutionProvider, selectedWorkflowMode } from './task-routing.js';
import { activityBuckets, periodRange, shiftPeriod, taskHistoryStats, tasksForScope, tasksInPeriod } from './task-history.js';
import {
  buildQueueReorderRequest,
  createQueueSnapshot,
  dropVisibleTask,
  moveVisibleTask,
  queuedTaskIds,
} from './queue-reorder.js';
import { turboPlanMarker, turboWaitingCopy } from './turbo-state.js';
import {
  graphProgressPresentation,
  normalizeTurboPackage,
  pendingPackageState,
  resolvePackageWorker,
  turboParentManifest,
} from './turbo-graph.js';
import {
  normalizeTurboCouncilSettings,
  turboCouncilReadiness,
  turboCouncilRequest,
} from './turbo-council-state.js';
import {
  executionSettingsForThread,
  freshProjectComposerState,
  hydrateThreadExecutionSettings,
  ProjectComposerStore,
  providerEligibleForComposer,
  rememberThreadExecution,
} from './project-composer-state.js';
import {
  continuationPresentation,
  continuationSubmission,
} from './task-continuation-state.js';

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

const initialComposerState = freshProjectComposerState();

const state = {
  tasks: [],
  runningTasks: [],
  projects: [],
  activeProjectPath: localStorage.getItem('relay.activeProjectPath') || null,
  taskScope: 'workspace',
  taskView: localStorage.getItem('relay.taskView') === 'history' ? 'history' : 'queue',
  historyPeriod: ['day', 'week', 'month'].includes(localStorage.getItem('relay.historyPeriod'))
    ? localStorage.getItem('relay.historyPeriod') : 'week',
  historyAnchor: new Date(),
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
  terminalHeight: (() => {
    const value = Number(localStorage.getItem('relay.terminalHeight'));
    return Number.isFinite(value) && value >= 180 ? value : null;
  })(),
  threads: [],
  providers: [],
  connection: null,
  status: null,
  selectedTaskId: null,
  selectedThreadId: initialComposerState.selectedThreadId,
  selectedProvider: initialComposerState.selectedProvider,
  taskMode: initialComposerState.taskMode,
  projectComposerStore: new ProjectComposerStore(),
  reorderPending: false,
  loadPromise: null,
  taskLoadSequence: 0,
  threadLoadSequence: 0,
  submitting: false,
  pendingSubmission: null,
  prioritySubmit: false,
  draggedTaskId: null,
  queueDrag: null,
  assigningTaskId: null,
  closingThreadId: null,
  closingThreadLabel: null,
  preferIdleTerminal: localStorage.getItem('relay.preferIdleTerminal') === 'true',
  parallelTaskIds: new Set(),
  attachments: initialComposerState.attachments,
  eventFilter: 'all',
  eventFollow: true,
  eventTaskId: null,
  selectedTaskEvents: [],
  selectedTaskForEvents: null,
  visibleEventEntries: [],
  expandedEventDetails: new Set(),
  eventOutputScroll: new Map(),
  continuationDrafts: new Map(),
  continuationAttachments: new Map(),
  continuationSubmitting: false,
  planExecutionSubmitting: false,
  editingTaskId: null,
  taskEditSubmitting: false,
  planExecutionTargets: new Map(),
  detailCopyContent: {},
  modelCatalogs: {
    codex: FALLBACK_MODELS.codex,
    claude: FALLBACK_MODELS.claude,
  },
  executionSettings: initialComposerState.executionSettings,
  threadExecutionSettings: initialComposerState.threadExecutionSettings,
  planSettings: initialComposerState.planSettings,
  turboSettings: initialComposerState.turboSettings,
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
  turboConfig: document.querySelector('#turbo-config'),
  providerTabs: [...document.querySelectorAll('.agent-tab')],
  providerCodexCount: document.querySelector('#provider-codex-count'),
  providerClaudeCount: document.querySelector('#provider-claude-count'),
  executionControls: document.querySelector('#execution-controls'),
  modelSelect: document.querySelector('#model-select'),
  modelHint: document.querySelector('#model-hint'),
  effortSelect: document.querySelector('#effort-select'),
  effortHint: document.querySelector('#effort-hint'),
  effortSliderValue: document.querySelector('#effort-slider-value'),
  effortSliderSteps: document.querySelector('#effort-slider-steps'),
  planAuthorModel: document.querySelector('#plan-author-model'),
  planCouncilEnabled: document.querySelector('#plan-council-enabled'),
  planCouncilRoute: document.querySelector('#plan-council-route'),
  planCouncilReadiness: document.querySelector('#plan-council-readiness'),
  planReviewerModel: document.querySelector('#plan-reviewer-model'),
  planReviewerEffort: document.querySelector('#plan-reviewer-effort'),
  planClaudeReady: document.querySelector('#plan-claude-ready'),
  planCodexReady: document.querySelector('#plan-codex-ready'),
  turboPlannerModel: document.querySelector('#turbo-planner-model'),
  turboPlannerEffort: document.querySelector('#turbo-planner-effort'),
  turboWorkerModel: document.querySelector('#turbo-worker-model'),
  turboWorkerEffort: document.querySelector('#turbo-worker-effort'),
  turboWorkerCount: document.querySelector('#turbo-worker-count'),
  turboCouncilEnabled: document.querySelector('#turbo-council-enabled'),
  turboCouncilHelpButton: document.querySelector('#turbo-council-help-button'),
  turboCouncilHelp: document.querySelector('#turbo-council-help'),
  turboCouncilOrder: document.querySelector('#turbo-council-order'),
  turboCouncilOrderButtons: [...document.querySelectorAll('[data-council-first]')],
  turboCouncilRoute: document.querySelector('#turbo-council-route'),
  turboCouncilCodexRole: document.querySelector('#turbo-council-codex-role'),
  turboCouncilClaudeRole: document.querySelector('#turbo-council-claude-role'),
  turboCouncilCodexCopy: document.querySelector('#turbo-council-codex-copy'),
  turboCouncilClaudeCopy: document.querySelector('#turbo-council-claude-copy'),
  turboCouncilReviewStep: document.querySelector('#turbo-council-review-step'),
  turboCouncilReviewerModel: document.querySelector('#turbo-council-reviewer-model'),
  turboCouncilReviewerEffort: document.querySelector('#turbo-council-reviewer-effort'),
  turboReadiness: document.querySelector('#turbo-readiness'),
  turboNote: document.querySelector('#turbo-note'),
  terminalPanel: document.querySelector('#terminal-panel'),
  terminalLegend: document.querySelector('#terminal-legend'),
  threadInput: document.querySelector('#thread-id'),
  terminalList: document.querySelector('#terminal-list'),
  sessionMessage: document.querySelector('#session-message'),
  preferIdleTerminal: document.querySelector('#prefer-idle-terminal'),
  idleTerminalRoute: document.querySelector('#idle-terminal-route'),
  connectionHelp: document.querySelector('#connection-help'),
  connectionHelpTitle: document.querySelector('#connection-help-title'),
  connectionHelpCopy: document.querySelector('#connection-help-copy'),
  connectionCommandRow: document.querySelector('#connection-command-row'),
  terminalSettingsButton: document.querySelector('#terminal-settings-button'),
  terminalSettingsModal: document.querySelector('#terminal-settings-modal'),
  terminalSettingsClose: document.querySelector('#terminal-settings-close'),
  launchCommand: document.querySelector('#launch-command'),
  copyCommandButton: document.querySelector('#copy-command-button'),
  launchCodexButton: document.querySelector('#launch-codex-button'),
  launchClaudeButton: document.querySelector('#launch-claude-button'),
  terminalCloseRow: document.querySelector('#terminal-close-row'),
  terminalCloseLabel: document.querySelector('#terminal-close-label'),
  terminalCloseReason: document.querySelector('#terminal-close-reason'),
  closeTerminalButton: document.querySelector('#close-terminal-button'),
  copyDiagnosticsButton: document.querySelector('#copy-diagnostics-button'),
  terminalLayoutEnabled: document.querySelector('#terminal-layout-enabled'),
  terminalLayoutColumns: document.querySelector('#terminal-layout-columns'),
  terminalLayoutRows: document.querySelector('#terminal-layout-rows'),
  terminalLayoutDisplay: document.querySelector('#terminal-layout-display'),
  terminalLaunchBackground: document.querySelector('#terminal-launch-background'),
  pauseButton: document.querySelector('#pause-button'),
  taskScopeButton: document.querySelector('#task-scope-button'),
  taskViewButtons: [...document.querySelectorAll('[data-task-view]')],
  queueSummary: document.querySelector('#queue-summary'),
  taskList: document.querySelector('#task-list'),
  historyLedger: document.querySelector('#history-ledger'),
  historyPeriodButtons: [...document.querySelectorAll('[data-history-period]')],
  historyPrevious: document.querySelector('#history-previous'),
  historyToday: document.querySelector('#history-today'),
  historyNext: document.querySelector('#history-next'),
  historyPeriodLabel: document.querySelector('#history-period-label'),
  historyPeriodCaption: document.querySelector('#history-period-caption'),
  historyMetrics: document.querySelector('#history-metrics'),
  historyActivity: document.querySelector('#history-activity'),
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
  promptSection: document.querySelector('#prompt-section'),
  detailPrompt: document.querySelector('#detail-prompt'),
  detailPromptPreview: document.querySelector('#detail-prompt-preview'),
  resultSection: document.querySelector('#result-section'),
  detailResult: document.querySelector('#detail-result'),
  detailResultPreview: document.querySelector('#detail-result-preview'),
  contentCopyButtons: [...document.querySelectorAll('[data-copy-content]')],
  detailEvents: document.querySelector('#detail-events'),
  eventSessionState: document.querySelector('#event-session-state'),
  eventSummary: document.querySelector('#event-summary'),
  eventMetrics: document.querySelector('#event-metrics'),
  termRelay: document.querySelector('#term-relay'),
  termProvider: document.querySelector('#term-provider'),
  termEffort: document.querySelector('#term-effort'),
  termDuration: document.querySelector('#term-duration'),
  eventFilters: [...document.querySelectorAll('[data-event-filter]')],
  copyEventsButton: document.querySelector('#copy-events-button'),
  followEventsButton: document.querySelector('#follow-events-button'),
  continuationForm: document.querySelector('#task-continuation-form'),
  continuationContext: document.querySelector('#task-continuation-context'),
  continuationState: document.querySelector('#task-continuation-state'),
  continuationAttach: document.querySelector('#task-continuation-attach'),
  continuationAttachments: document.querySelector('#task-continuation-attachments'),
  continuationAttachmentInput: document.querySelector('#task-continuation-image-input'),
  continuationAttachmentCount: document.querySelector('#task-continuation-attachment-count'),
  continuationClearImages: document.querySelector('#task-continuation-clear-images'),
  continuationInput: document.querySelector('#task-continuation-input'),
  continuationSend: document.querySelector('#task-continuation-send'),
  continuationMessage: document.querySelector('#task-continuation-message'),
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
  planArtifactRow: document.querySelector('#plan-artifact-row'),
  planArtifactPath: document.querySelector('#plan-artifact-path'),
  planArtifactLink: document.querySelector('#plan-artifact-link'),
  planExecutionPanel: document.querySelector('#plan-execution-panel'),
  planExecutionRelay: document.querySelector('#plan-execution-relay'),
  planExecutionButton: document.querySelector('#plan-execution-button'),
  planExecutionMessage: document.querySelector('#plan-execution-message'),
  planFinal: document.querySelector('#plan-final'),
  turboPreview: document.querySelector('#turbo-preview'),
  turboPreviewStatus: document.querySelector('#turbo-preview-status'),
  turboPreviewSummary: document.querySelector('#turbo-preview-summary'),
  turboGraphProgress: document.querySelector('#turbo-graph-progress'),
  turboGraphProgressbar: document.querySelector('#turbo-graph-progressbar'),
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
  taskEditModal: document.querySelector('#task-edit-modal'),
  taskEditPrompt: document.querySelector('#task-edit-prompt'),
  taskEditMessage: document.querySelector('#task-edit-message'),
  taskEditClose: document.querySelector('#task-edit-close'),
  taskEditCancel: document.querySelector('#task-edit-cancel'),
  taskEditSave: document.querySelector('#task-edit-save'),
  headerRunningTasks: document.querySelector('#header-running-tasks'),
  projectList: document.querySelector('#project-list'),
  addProjectButton: document.querySelector('#add-project-button'),
  addLaunchProjectButton: document.querySelector('#add-launch-project-button'),
  workspace: document.querySelector('.workspace'),
  composerQueueResizer: document.querySelector('#composer-queue-resizer'),
  queueDetailResizer: document.querySelector('#queue-detail-resizer'),
  terminalHeightResizer: document.querySelector('#terminal-height-resizer'),
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
    background: elements.terminalLaunchBackground.checked,
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
    elements.terminalLaunchBackground.checked = storedTerminalLayout.background === true;
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
  return tasksForScope(state.tasks, {
    projectPath: state.activeProjectPath,
    taskScope: state.taskScope,
    threadId: state.selectedThreadId,
  });
}

function renderTaskScope() {
  if (state.taskScope === 'relay' && !state.selectedThreadId) {
    state.taskScope = 'workspace';
  }
  elements.taskScopeButton.hidden = !state.selectedThreadId && !state.activeProjectPath;
  const labels = {
    relay: 'This Relay',
    workspace: 'All Relays',
  };
  elements.taskScopeButton.textContent = labels[state.taskScope];
  elements.taskScopeButton.setAttribute('aria-label', `Task scope: ${labels[state.taskScope]}. Click to change.`);
  elements.taskScopeButton.title = 'Switch between this Relay and every Relay in this project';
}

function projectThreads(provider = state.selectedProvider) {
  return state.threads.filter((thread) => (
    (!provider || threadProvider(thread) === provider)
    && (!state.activeProjectPath || sameProjectPath(thread.cwd, state.activeProjectPath))
  ));
}

function saveProjectComposerState(path = state.activeProjectPath) {
  state.projectComposerStore.save(path, {
    prompt: elements.prompt.value,
    attachments: state.attachments,
    selectedThreadId: state.selectedThreadId,
    selectedProvider: state.selectedProvider,
    taskMode: state.taskMode,
    executionSettings: state.executionSettings,
    threadExecutionSettings: state.threadExecutionSettings,
    planSettings: state.planSettings,
    turboSettings: state.turboSettings,
  });
}

function restoreProjectComposerState(path) {
  const session = state.projectComposerStore.load(path);
  elements.prompt.value = session.prompt;
  elements.formMessage.textContent = '';
  state.attachments = session.attachments;
  state.selectedThreadId = session.selectedThreadId;
  state.selectedProvider = session.selectedProvider;
  state.taskMode = session.taskMode;
  state.taskScope = 'workspace';
  state.executionSettings = session.executionSettings;
  state.threadExecutionSettings = session.threadExecutionSettings || {};
  state.planSettings = session.planSettings;
  state.turboSettings = session.turboSettings;
}

function selectProject(path) {
  if (!path) return;
  const project = state.projects.find((item) => sameProjectPath(item.path, path));
  if (!project || sameProjectPath(project.path, state.activeProjectPath)) return;
  if (state.activeProjectPath) saveProjectComposerState();
  state.activeProjectPath = project.path;
  localStorage.setItem('relay.activeProjectPath', state.activeProjectPath);
  restoreProjectComposerState(state.activeProjectPath);
  state.selectedTaskId = null;
  state.parallelTaskIds.clear();
  elements.taskDetail.hidden = true;
  elements.emptyDetail.hidden = false;
  selectMode(state.taskMode);
  renderProjects();
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
        <button class="project-launch project-launch-claude" type="button" data-project-action="launch" data-provider="claude" aria-label="Launch Claude in ${escapeHtml(project.name)}"><svg class="project-launch-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2" /></svg><span>Claude</span></button>
        <button class="project-unpin" type="button" data-project-action="delete" aria-label="Unpin ${escapeHtml(project.name)}" ${state.projects.length === 1 ? 'disabled title="Add another project before unpinning the selected project"' : ''}>×</button>
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
  if (queued.length > 0) {
    const otherProjectRunning = state.tasks.some((task) => (
      task.status === 'running' && !sameProjectPath(task.repo_path, path)
    ));
    const pausedProjectPaths = state.status?.pausedProjectPaths;
    const projectPaused = Array.isArray(pausedProjectPaths)
      ? pausedProjectPaths.some((pausedPath) => sameProjectPath(pausedPath, path))
      : state.status?.paused === true;
    const staleScheduler = projectQueueRestartRequired({
      supported: state.status?.capabilities?.projectQueueIsolation,
      paused: projectPaused,
      queuedCount: queued.length,
      projectRunning: false,
      otherProjectRunning,
    });
    const staleClaudeScheduler = parallelClaudeRestartRequired({
      supported: state.status?.capabilities?.parallelClaudeExecution,
      queuedTasks: queued,
      runningTasks: state.tasks,
    });
    return {
      state: 'queued',
      label: staleClaudeScheduler
        ? `${queued.length} waiting · Restart Relay for parallel Claude projects`
        : staleScheduler
        ? `${queued.length} waiting · Restart Relay for separate project queues`
        : `${queued.length} task${queued.length === 1 ? '' : 's'} waiting`,
    };
  }
  const latest = tasks.reduce((current, task) => !current || task.id > current.id ? task : current, null);
  if (latest && ['failed', 'interrupted'].includes(latest.status)) {
    return { state: 'error', label: `Needs attention · Task #${latest.id} ${latest.status}` };
  }
  return { state: 'idle', label: latest?.status === 'complete' ? `Idle · Last completed #${latest.id}` : 'Idle' };
}

function relayActivity(thread) {
  const direct = runningDirectTask(state.tasks, thread.id);
  if (direct) return { state: 'running', label: `Task #${direct.id} · ${compactText(direct.prompt, 72)}` };
  const codexOwnsCouncilStage = (task) => {
    const order = task.turbo?.council?.order || ['codex', 'claude'];
    const planStatus = task.turboPlanSummary?.status;
    return planStatus === 'planning' ? order[0] === 'codex' : planStatus === 'reviewing' ? order[1] === 'codex' : false;
  };
  const planningAhead = state.tasks
    .filter((task) => task.status === 'queued' && task.mode === 'turbo'
      && task.turbo?.plannerThreadId === thread.id
      && codexOwnsCouncilStage(task))
    .sort((left, right) => left.position - right.position || left.id - right.id)[0];
  if (planningAhead) return { state: 'planning', label: `Planning ahead · Task #${planningAhead.id}` };
  const workerTurbo = state.tasks.find((task) => task.status === 'running' && task.mode === 'turbo'
    && task.turbo?.workers?.some((worker) => worker.threadId === thread.id));
  if (workerTurbo) return { state: 'running', label: `Turbo worker · Task #${workerTurbo.id}` };
  const plannerTurbo = state.tasks.find((task) => task.status === 'running' && task.mode === 'turbo'
    && task.turbo?.plannerThreadId === thread.id);
  if (plannerTurbo && codexOwnsCouncilStage(plannerTurbo)) {
    return { state: 'planning', label: `Turbo planner · Task #${plannerTurbo.id}` };
  }
  if (plannerTurbo) return { state: 'idle', label: 'Idle · Ready for work' };
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
  if (state.projects.length && !state.projects.some((project) => sameProjectPath(project.path, state.activeProjectPath))) {
    const selectedThread = state.threads.find((thread) => thread.id === state.selectedThreadId);
    const initialProject = state.projects.find((project) => sameProjectPath(project.path, selectedThread?.cwd))
      || state.projects.find((project) => state.threads.some((thread) => sameProjectPath(project.path, thread.cwd)))
      || state.projects[0];
    selectProject(initialProject.path);
  }
  renderProjects();
  renderTaskScope();
}

async function chooseProject(launch, provider = projectProvider()) {
  const previousIds = new Set(state.threads.map((thread) => thread.id));
  elements.addProjectButton.disabled = true;
  elements.addLaunchProjectButton.disabled = true;
  try {
    const body = await api('/api/projects/choose', {
      method: 'POST',
      body: JSON.stringify({ launch, provider, layout: terminalLayout() }),
    });
    if (!body.cancelled) {
      await loadProjects();
      selectProject(body.project.path);
      if (launch) {
        await finishTerminalLaunch(body.project, provider, body.launched, previousIds);
      }
    }
  } catch (error) {
    elements.formMessage.textContent = error.message;
  } finally {
    renderProjects();
  }
}

function terminalLaunchTimeoutMessage(provider) {
  if (provider === 'codex') {
    return 'Could not open a Codex Relay. If Codex says an update is required in the terminal, update Codex, then try again.';
  }
  return 'Could not open a Claude Relay. Check the terminal for details, then try again.';
}

async function finishTerminalLaunch(project, provider, launched, previousIds) {
  if (launched?.connectionStatus === 'timed_out') {
    elements.formMessage.textContent = terminalLaunchTimeoutMessage(provider);
    return;
  }
  const thread = await waitForProjectThread(project.path, provider, previousIds);
  await syncLaunchedTerminalControl(launched, thread);
}

async function syncLaunchedTerminalControl(launched, thread) {
  if (!launched?.launchId || !thread) return;
  if (launched.threadId !== thread.id) {
    elements.formMessage.textContent = `${providerLabel(threadProvider(thread))} connected, but Relay could not verify its exact native window. Close is unavailable for this session.`;
    return;
  }
  await loadThreads({ silent: true });
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
      if (!providerEligibleForComposer(state, provider)) {
        elements.formMessage.textContent = incompatibleComposerProviderMessage(provider, path);
        return thread;
      }
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
  const body = await api(`/api/projects/${project.id}/launch`, {
    method: 'POST',
    body: JSON.stringify({ provider, layout: terminalLayout() }),
  });
  await loadProjects();
  await finishTerminalLaunch(project, provider, body.launched, previousIds);
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
      : isExecuteCouncilEnabled()
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

async function mergeImageFiles(fileList, existingAttachments) {
  const files = [...fileList];
  const attachments = [...existingAttachments];
  const errors = [];
  let totalBytes = attachments.reduce((total, attachment) => total + attachment.size, 0);

  for (const file of files) {
    if (attachments.length >= MAX_IMAGE_ATTACHMENTS) {
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
    const duplicate = attachments.some(
      (attachment) => attachment.name === file.name && attachment.size === file.size,
    );
    if (duplicate) {
      errors.push(`${file.name} is already attached.`);
      continue;
    }
    try {
      const data = await readFileAsDataUrl(file);
      attachments.push({
        id: globalThis.crypto?.randomUUID?.() || `image-${Date.now()}-${attachments.length}`,
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

  return { attachments, errors: [...new Set(errors)] };
}

async function addImageFiles(fileList) {
  if (state.status?.capabilities?.imageAttachments !== true) {
    elements.formMessage.textContent = 'Restart Relay once to enable image attachments.';
    return;
  }
  const result = await mergeImageFiles(fileList, state.attachments);
  state.attachments = result.attachments;
  elements.formMessage.textContent = result.errors.join(' ');
  renderAttachmentComposer();
}

function followUpAttachmentsAvailable() {
  return state.status?.capabilities?.imageAttachments === true
    && state.status?.capabilities?.taskFollowUpAttachments === true;
}

async function addContinuationImageFiles(fileList) {
  const task = state.selectedTaskForEvents;
  if (!task) return;
  if (!followUpAttachmentsAvailable()) {
    elements.continuationMessage.dataset.kind = 'error';
    elements.continuationMessage.textContent = 'Restart Relay to add images to follow-up messages.';
    renderTaskContinuation(task);
    return;
  }
  const current = state.continuationAttachments.get(task.id) || [];
  const result = await mergeImageFiles(fileList, current);
  state.continuationAttachments.set(task.id, result.attachments);
  elements.continuationMessage.dataset.kind = result.errors.length > 0 ? 'error' : 'hint';
  if (result.errors.length > 0) elements.continuationMessage.textContent = result.errors.join(' ');
  renderTaskContinuation(task);
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
      <summary><span class="term-tap">${escapeHtml(label)}</span><small>${lines} line${lines === 1 ? '' : 's'}</small></summary>
      <pre class="event-output-content">${escapeHtml(visibleText)}</pre>
    </details>
  `;
}

// Tokyo Night shell tokenizer: colorizes a command line into program/args/flags/
// numbers/strings/operators. Each token is escaped before it reaches the DOM.
function highlightCommand(command) {
  const text = String(command || '');
  const tokenRe = /("[^"]*"|'[^']*'|\|\||&&|[|;&><]|\S+|\s+)/g;
  const tokens = text.match(tokenRe) || [];
  let firstWord = true;
  let out = '';
  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      out += escapeHtml(token);
      continue;
    }
    const esc = escapeHtml(token);
    if (token.startsWith('"') || token.startsWith("'")) {
      out += `<span class="tk-str">${esc}</span>`;
    } else if (token === '||' || token === '&&' || /^[|;&><]$/.test(token)) {
      out += `<span class="tk-op">${esc}</span>`;
      firstWord = true;
      continue;
    } else if (token.startsWith('-')) {
      out += `<span class="tk-flag">${esc}</span>`;
    } else if (/^\d/.test(token)) {
      out += `<span class="tk-num">${esc}</span>`;
    } else if (firstWord) {
      out += `<span class="tk-prog">${esc}</span>`;
    } else {
      out += `<span class="tk-arg">${esc}</span>`;
    }
    firstWord = false;
  }
  return out;
}

// Compact elapsed label used by the terminal status bar duration segment.
function terminalDurationLabel(task) {
  const elapsed = formatElapsedDuration(task?.started_at, task?.finished_at);
  if (elapsed) {
    return elapsed;
  }
  return task?.status === 'queued' ? 'queued' : 'idle';
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
  const stateName = eventState(entry);
  const completed = Boolean(entry.completedEvent);
  const common = {
    provider,
    state: stateName,
    status: eventStatusLabel(entry),
    duration,
  };

  if (item?.type === 'commandExecution') {
    const command = item.command || item.commands?.join(' ') || 'Command details unavailable';
    const cwd = item.cwd || task?.repo_path;
    return {
      ...common,
      kind: 'command',
      glyph: '$',
      title: 'Terminal command',
      command,
      promptPath: `~/${workspaceName(cwd)}`,
      completed,
      exitOk: stateName !== 'error',
      outputMarkup: eventOutputMarkup(item.aggregatedOutput, { label: 'output', open: stateName === 'error' }),
    };
  }

  if (item?.type === 'fileChange') {
    const changes = item.changes || [];
    const diffs = changes.map((change) => change.diff).filter(Boolean).join('\n');
    const list = changes.length
      ? changes.map((change) => ({
          glyph: change.kind?.type === 'create' ? '+' : '~',
          path: eventRelativePath(change.path, task?.repo_path),
          full: change.path || '',
          note: change.kind?.type || 'updated',
        }))
      : [{ glyph: '~', path: 'workspace files', full: '', note: 'updated' }];
    return {
      ...common,
      kind: 'file',
      glyph: '±',
      title: changes.length === 1 ? 'File changed' : 'Files changed',
      status: entry.startedEvent && !entry.completedEvent
        ? 'editing'
        : `${changes.length || 1} update${changes.length === 1 ? '' : 's'}`,
      changes: list,
      patchMarkup: eventOutputMarkup(diffs, { label: 'patch' }),
    };
  }

  if (item?.type === 'mcpToolCall') {
    const output = toolResultText(item.result);
    return {
      ...common,
      kind: 'tool',
      glyph: '◆',
      title: item.tool || 'Connected tool',
      status: item.status === 'failed' ? 'failed' : eventStatusLabel(entry, 'tool'),
      inline: `<span class="term-route">${escapeHtml(item.server || 'tool')}<b>/</b>${escapeHtml(item.tool || 'call')}</span>`,
      // Arguments first so its disclosure keeps slot 0 while streamed output appears at slot 1.
      body: `${eventOutputMarkup(JSON.stringify(item.arguments || {}, null, 2), { label: 'arguments' })}${eventOutputMarkup(output, { label: 'output', open: item.status === 'failed' })}`,
    };
  }

  if (item?.type === 'webSearch') {
    const query = item.query || item.action?.query || 'search completed';
    return {
      ...common,
      kind: 'search',
      glyph: '⌕',
      title: 'web search',
      inline: `<span class="tk-str">${escapeHtml(`"${query}"`)}</span>`,
    };
  }

  if (item?.type === 'imageView') {
    return {
      ...common,
      kind: 'image',
      glyph: '▧',
      title: 'inspected',
      inline: `<code class="term-inline-path">${escapeHtml(eventRelativePath(item.path, task?.repo_path))}</code>`,
    };
  }

  if (item?.type === 'agentMessage') {
    const message = String(item.text || lastEvent?.message || '').trim();
    return {
      ...common,
      kind: 'message',
      glyph: provider === 'claude' ? '✳' : '>_',
      title: `${providerLabel(provider)} message`,
      status: item.phase === 'final' || lastEvent?.kind === 'result' ? 'final' : 'update',
      message,
      headerless: provider === 'codex',
    };
  }

  if (item?.type === 'reasoning') {
    const summary = (item.summary || []).map((part) => part?.text || part).filter(Boolean).join('\n');
    return {
      ...common,
      kind: 'reasoning',
      glyph: '··',
      title: `${providerLabel(provider)} reasoning`,
      status: entry.completedEvent ? 'Complete' : 'Thinking',
      label: providerLabel(provider).toLowerCase(),
      streaming: Boolean(entry.startedEvent && !entry.completedEvent),
      preview: summary,
    };
  }

  if (item?.type === 'userMessage') {
    const message = (item.content || [])
      .filter((part) => part?.type === 'text')
      .map((part) => part.text || '')
      .filter(Boolean)
      .join('\n')
      .trim();
    return {
      ...common,
      kind: 'note',
      quiet: true,
      glyph: '↗',
      title: String(item.clientId || '').startsWith('relay-steer-') ? 'Turn updated' : 'Prompt delivered',
      status: entry.completedEvent ? 'received' : 'sending',
      body: message ? eventTextMarkup(message) : '',
    };
  }

  if (item?.type === 'contextCompaction') {
    return {
      ...common,
      kind: 'note',
      quiet: true,
      glyph: '↯',
      title: 'Context compacted',
      status: 'complete',
      body: '',
    };
  }

  if (payloadType === 'turn/started' || payloadType === 'turn/completed') {
    return {
      ...common,
      kind: 'note',
      quiet: true,
      glyph: '◎',
      title: payloadType === 'turn/started' ? 'Session started' : 'Session finished',
      status: payloadType === 'turn/started' ? 'live' : 'complete',
      body: '',
    };
  }

  if (lastEvent?.kind === 'queue' || lastEvent?.kind === 'system') {
    return {
      ...common,
      kind: 'note',
      quiet: true,
      glyph: '●',
      title: lastEvent.kind === 'queue' ? 'Relay queue' : 'Relay system',
      body: eventTextMarkup(lastEvent.message),
    };
  }

  if (lastEvent?.kind === 'stderr' || payloadType === 'error') {
    return {
      ...common,
      kind: 'error',
      glyph: '✗',
      title: 'Terminal warning',
      status: 'attention',
      body: eventOutputMarkup(lastEvent.message, { label: 'error details', open: true }),
    };
  }

  if (lastEvent?.kind === 'plan') {
    return {
      ...common,
      kind: 'note',
      glyph: '⇄',
      title: 'Plan council',
      body: eventTextMarkup(lastEvent.message),
    };
  }

  if (payloadType === 'claude/started'
    || payloadType === 'claude/completed'
    || payloadType === 'claude/waiting'
    || payloadType === 'claude/progress'
    || payloadType === 'claude/session-initializing') {
    const waiting = payloadType === 'claude/waiting';
    // claude/progress carries healthy terminal-turn heartbeats and cancellation notices.
    // Render it as a quiet note so a long turn does not accumulate warning-styled entries.
    const progress = payloadType === 'claude/progress';
    return {
      ...common,
      kind: waiting ? 'error' : 'note',
      quiet: progress || (payloadType !== 'claude/waiting' && payloadType !== 'claude/session-initializing'),
      glyph: '✳',
      title: (waiting || progress) ? 'Claude session busy' : 'Claude session',
      status: (waiting || progress) ? 'waiting' : common.status,
      body: waiting
        ? eventOutputMarkup(lastEvent.message, { label: 'details', open: true })
        : eventTextMarkup(lastEvent.message),
    };
  }

  return {
    ...common,
    kind: 'note',
    glyph: provider === 'claude' ? '✳' : '>_',
    title: `${providerLabel(provider)} activity`,
    body: eventTextMarkup(lastEvent?.message || 'Activity recorded.'),
  };
}

function renderEventEntry(entry, task, index) {
  const presentation = eventPresentation(entry, task);
  const providerClass = presentation.provider === 'council' ? 'plan' : presentation.provider;
  const time = formatEventTime(entryFirstEvent(entry)?.created_at);
  const classes = [
    'event-entry',
    `event-entry-${escapeHtml(presentation.state)}`,
    `event-provider-${escapeHtml(providerClass)}`,
    `event-kind-${escapeHtml(presentation.kind)}`,
    presentation.quiet ? 'event-entry-quiet' : '',
    presentation.headerless ? 'event-entry-headerless' : '',
  ].filter(Boolean).join(' ');
  return `
    <article class="${classes}" data-entry-id="${escapeHtml(entry.id)}" data-category="${escapeHtml(eventEntryCategory(entry))}">
      <span class="term-ln" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
      <div class="term-line">${renderEventEntryInner(presentation, time)}</div>
    </article>
  `;
}

function renderEventEntryInner(p, time) {
  if (p.kind === 'command') {
    const exit = p.completed
      ? `<span class="term-exit ${p.exitOk ? 'is-ok' : 'is-fail'}">${p.exitOk ? '✓' : '✗'} ${escapeHtml(p.status)}</span>`
      : '<span class="term-exit is-run">running</span>';
    return `
      <div class="term-cmd-row">
        <span class="term-path">${escapeHtml(p.promptPath)}</span><span class="term-caret" aria-hidden="true">❯</span>
        <span class="term-cmd">${highlightCommand(p.command)}</span>
      </div>
      <div class="term-metaline">
        ${exit}
        ${p.duration ? `<span class="term-sep" aria-hidden="true">·</span><span>${escapeHtml(p.duration)}</span>` : ''}
        <span class="term-sep" aria-hidden="true">·</span><span>${escapeHtml(time)}</span>
      </div>
      ${p.outputMarkup || ''}
    `;
  }

  if (p.kind === 'reasoning') {
    const stateMarkup = p.streaming
      ? 'thinking<span class="term-cursor" aria-hidden="true">▍</span>'
      : `reasoned${p.duration ? ` for ${escapeHtml(p.duration)}` : ''}`;
    return `
      <div class="term-reason-row">
        <span class="term-reason-bar" aria-hidden="true">┊</span>
        <span class="term-reason-label">${escapeHtml(p.label)}</span>
        <span class="term-reason-state">${stateMarkup}</span>
        <time class="term-time">${escapeHtml(time)}</time>
      </div>
      ${p.preview ? `<p class="term-reason-preview">${escapeHtml(p.preview)}${p.streaming ? '<span class="term-cursor" aria-hidden="true">▍</span>' : ''}</p>` : ''}
    `;
  }

  if (p.kind === 'message') {
    // An empty message (e.g. a headerless Codex agentMessage with no text) would
    // otherwise render a blank numbered line: always keep a compact header line.
    if (!p.message) {
      return `
        <div class="term-signal-row">
          <span class="term-glyph" aria-hidden="true">${escapeHtml(p.glyph)}</span>
          <span class="term-signal-title">${escapeHtml(providerLabel(p.provider))} message</span>
          <span class="term-signal-state">${escapeHtml(p.status)}</span>
          <time class="term-time">${escapeHtml(time)}</time>
        </div>`;
    }
    const head = p.headerless ? '' : `
      <div class="term-signal-row term-response-head">
        <span class="term-glyph" aria-hidden="true">${escapeHtml(p.glyph)}</span>
        <span class="term-signal-title">${escapeHtml(providerLabel(p.provider))} message</span>
        <span class="term-signal-state">${escapeHtml(p.status)}</span>
        <time class="term-time">${escapeHtml(time)}</time>
      </div>`;
    return `${head}<div class="term-response ${p.headerless ? 'is-headerless' : ''}"><div class="event-message-body term-response-body">${escapeHtml(p.message)}</div></div>`;
  }

  const inline = p.inline ? `<span class="term-signal-inline">${p.inline}</span>` : '';
  const status = p.status ? `<span class="term-signal-state">${escapeHtml(p.status)}</span>` : '';
  const row = `
    <div class="term-signal-row">
      <span class="term-glyph" aria-hidden="true">${escapeHtml(p.glyph)}</span>
      <span class="term-signal-title">${escapeHtml(p.title)}</span>
      ${inline}
      ${status}
      <time class="term-time">${escapeHtml(time)}</time>
    </div>`;

  if (p.kind === 'file') {
    const files = p.changes.map((change) => `
      <span class="term-fileitem">
        <b class="term-file-glyph ${change.glyph === '+' ? 'is-add' : 'is-mod'}" aria-hidden="true">${escapeHtml(change.glyph)}</b>
        <code title="${escapeHtml(change.full)}">${escapeHtml(change.path)}</code>
        <small>${escapeHtml(change.note)}</small>
      </span>`).join('');
    return `${row}<div class="term-filelist">${files}</div>${p.patchMarkup || ''}`;
  }

  return `${row}${p.body || ''}`;
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
  } else if (item?.type === 'reasoning') {
    lines.push((item.summary || []).map((part) => part?.text || part).filter(Boolean).join('\n'));
  } else if (item?.type === 'userMessage') {
    lines.push((item.content || [])
      .filter((part) => part?.type === 'text')
      .map((part) => part.text || '')
      .filter(Boolean)
      .join('\n'));
  } else if (item?.type === 'mcpToolCall') {
    lines.push(`${item.server || 'tool'}/${item.tool || 'call'}`);
    const args = JSON.stringify(item.arguments || {}, null, 2);
    if (args && args !== '{}') {
      lines.push(`arguments: ${args}`);
    }
    const result = toolResultText(item.result);
    if (result) {
      lines.push(result);
    }
  } else if (item?.type === 'webSearch') {
    lines.push(item.query || item.action?.query || '');
  } else if (item?.type === 'imageView') {
    lines.push(eventRelativePath(item.path, task?.repo_path));
  } else if (item?.type === 'fileChange' && (item.changes || []).length) {
    for (const change of item.changes) {
      lines.push(`${change.kind?.type === 'create' ? '+' : '~'} ${eventRelativePath(change.path, task?.repo_path)}`);
      if (change.diff) {
        lines.push(change.diff);
      }
    }
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

// Fills the tmux-style terminal status bar from real task state. Every segment is
// data-driven; unknown segments hide rather than inventing a value.
function renderTerminalStatusBar(task) {
  if (!elements.termRelay) {
    return;
  }
  const relay = taskRelayLabel(task);
  if (relay && relay !== 'Unassigned Relay') {
    elements.termRelay.hidden = false;
    elements.termRelay.textContent = relay;
  } else {
    elements.termRelay.hidden = true;
    elements.termRelay.textContent = '';
  }

  const barProvider = task?.mode === 'plan' ? 'council' : taskProvider(task || {});
  elements.termProvider.textContent = `${providerLabel(barProvider).toLowerCase()} · ${task?.model || 'session model'}`;

  if (task?.effort) {
    elements.termEffort.hidden = false;
    elements.termEffort.textContent = `${task.effort} effort`;
  } else {
    elements.termEffort.hidden = true;
    elements.termEffort.textContent = '';
  }

  elements.termDuration.dataset.termDuration = String(task?.id ?? '');
  elements.termDuration.textContent = terminalDurationLabel(task);
}

function taskContinuationSession(task) {
  return state.threads.find((thread) => (
    thread.id === task?.thread_id
    && threadProvider(thread) === task?.provider
    && sameProjectPath(thread.cwd, task?.repo_path)
  )) || null;
}

function isFailedSessionFollowUp(task) {
  return String(task?.error || '').startsWith('Same-session follow-up');
}

function resizeContinuationInput() {
  elements.continuationInput.style.height = 'auto';
  elements.continuationInput.style.height = `${Math.min(elements.continuationInput.scrollHeight, 92)}px`;
}

function renderTaskContinuation(task, { taskChanged = false } = {}) {
  const direct = task?.mode === 'execute' && ['codex', 'claude'].includes(task.provider);
  elements.continuationForm.hidden = !direct;
  if (!direct) return;
  elements.continuationForm.dataset.provider = task.provider;
  if (taskChanged || elements.continuationMessage.dataset.taskId !== String(task.id)) {
    elements.continuationInput.value = state.continuationDrafts.get(task.id) || '';
    elements.continuationMessage.dataset.taskId = String(task.id);
    elements.continuationMessage.dataset.kind = 'hint';
  }

  const session = taskContinuationSession(task);
  const supportsDirectFollowUp = state.status?.capabilities?.taskDirectFollowUp === true;
  const supportsTaskSteering = state.status?.capabilities?.taskSteering === true;
  const busy = ['queued', 'running'].includes(task.status)
    || (session && session.status !== 'idle')
    || state.tasks.some((candidate) => (
      candidate.id !== task.id
      && candidate.thread_id === task.thread_id
      && ['queued', 'running'].includes(candidate.status)
    ));
  const submitting = state.continuationSubmitting;
  const presentation = continuationPresentation({
    supportsDirectFollowUp,
    supportsTaskSteering,
    sessionConnected: Boolean(session),
    busy,
    taskRunning: task.status === 'running',
    provider: task.provider,
    submitting,
    prompt: elements.continuationInput.value,
  });
  const relay = taskRelayLabel(task);
  elements.continuationContext.textContent = `${relay} · ${providerLabel(task.provider)} · ${task.model || 'session model'} · ${task.effort || 'default'} effort`;
  elements.continuationState.dataset.state = presentation.state;
  elements.continuationState.textContent = presentation.label;
  elements.continuationInput.disabled = presentation.inputDisabled;
  const attachments = state.continuationAttachments.get(task.id) || [];
  const attachmentsAvailable = followUpAttachmentsAvailable();
  elements.continuationAttach.dataset.state = attachmentsAvailable ? 'ready' : 'unavailable';
  elements.continuationAttach.title = attachmentsAvailable
    ? 'Add PNG, JPEG, or WebP images'
    : 'Restart Relay to add images to follow-up messages';
  elements.continuationAttachmentInput.disabled = presentation.inputDisabled
    || !attachmentsAvailable
    || attachments.length >= MAX_IMAGE_ATTACHMENTS;
  elements.continuationAttachmentCount.textContent = attachments.length === 0
    ? 'No images attached'
    : `${attachments.length} image${attachments.length === 1 ? '' : 's'} attached`;
  elements.continuationAttachments.hidden = attachments.length === 0;
  elements.continuationClearImages.hidden = attachments.length === 0;
  elements.continuationClearImages.disabled = presentation.inputDisabled;
  elements.continuationSend.querySelector('span').textContent = presentation.buttonLabel;
  if (!['error', 'success'].includes(elements.continuationMessage.dataset.kind)) {
    elements.continuationMessage.textContent = presentation.hint;
  }
  resizeContinuationInput();
  elements.continuationSend.disabled = presentation.sendDisabled;
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

function rememberEventOutputScroll() {
  for (const output of elements.detailEvents.querySelectorAll('pre.event-output-content')) {
    const details = output.closest('details');
    const key = details && eventDisclosureKey(details);
    if (!key) continue;
    const remaining = output.scrollHeight - output.clientHeight - output.scrollTop;
    state.eventOutputScroll.set(key, {
      top: output.scrollTop,
      follow: remaining < 12,
    });
  }
}

function restoreEventOutputScroll() {
  for (const output of elements.detailEvents.querySelectorAll('pre.event-output-content')) {
    const details = output.closest('details');
    const key = details && eventDisclosureKey(details);
    const remembered = key && state.eventOutputScroll.get(key);
    if (!remembered) continue;
    output.scrollTop = remembered.follow ? output.scrollHeight : remembered.top;
  }
}

function renderEventStream(events, task, { forceBottom = false, resetDisclosures = false } = {}) {
  if (resetDisclosures) {
    state.expandedEventDetails.clear();
    state.eventOutputScroll.clear();
  } else {
    rememberEventDisclosures();
    rememberEventOutputScroll();
  }
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
  elements.eventSummary.textContent = `${visible.length}/${grouped.length} signals`;
  elements.eventSummary.title = `${visible.length} of ${grouped.length} signals · ${events.length} raw events`;
  renderTerminalStatusBar(task);
  elements.eventMetrics.innerHTML = `
    <span><b>${stats.thinkingTokens.toLocaleString()}</b><small>thinking tokens</small></span>
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
  restoreEventOutputScroll();

  if (forceBottom || state.eventFollow) {
    state.eventFollow = true;
    elements.detailEvents.scrollTop = elements.detailEvents.scrollHeight;
  } else {
    elements.detailEvents.scrollTop = previousScrollTop;
  }
  updateEventControls();
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

function threadDisplayName(thread) {
  if (!thread) return 'terminal';
  return threadProvider(thread) === 'claude' ? thread.title : `Relay ${relayNumber(thread)}`;
}

function executionLabel(task) {
  if (task.mode === 'turbo') {
    const planner = `${task.turbo?.plannerModel || task.model || 'planner'} · ${task.turbo?.plannerEffort || task.effort || 'default'}`;
    const workers = `${task.turbo?.workerCount || task.turbo?.workers?.length || 0} workers · ${task.turbo?.workerModel || 'worker model'} · ${task.turbo?.workerEffort || 'default'}`;
    const council = task.turbo?.council?.enabled || task.turbo?.councilEnabled;
    const order = task.turbo?.council?.order || ['codex', 'claude'];
    const route = order.map(providerLabel).join(' → ');
    return `Turbo: ${council ? `${route} council` : `Codex ${planner}`} → ${workers}`;
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

function taskRelayLabel(task) {
  const thread = state.threads.find((item) => item.id === task.thread_id);
  if (thread && threadProvider(thread) === 'codex') return `Relay ${relayNumber(thread)}`;
  if (thread) return `Claude · ${thread.title || 'session'}`;
  if (task.thread_name) return task.provider === 'codex' ? `Relay · ${task.thread_name}` : `Claude · ${task.thread_name}`;
  return task.mode === 'turbo' ? 'Multiple Relays' : 'Unassigned Relay';
}

function turboIdentity(threadId, storedTitle, fallback = 'Unassigned') {
  const thread = threadId ? state.threads.find((item) => item.id === threadId) : null;
  if (thread && threadProvider(thread) === 'codex') {
    return {
      label: `Relay ${relayNumber(thread)}`,
      className: relayColorClass(thread.id),
      connected: true,
    };
  }
  return {
    label: storedTitle || fallback,
    className: '',
    connected: false,
  };
}

function turboPlannerIdentity(task) {
  const manifest = turboParentManifest(task);
  return turboIdentity(manifest.planner.threadId, manifest.planner.title, 'Planner');
}

function turboFleetMarkup(task) {
  if (task.mode !== 'turbo') return '';
  const manifest = turboParentManifest(task);
  const planner = turboIdentity(manifest.planner.threadId, manifest.planner.title, 'Planner');
  const workers = manifest.workers.map((worker) => turboIdentity(worker.threadId, worker.title, `Worker ${worker.slot}`));
  return `
    <div class="turbo-fleet" aria-label="Turbo Relay fleet">
      <span class="turbo-fleet-role">Planner</span>
      <span class="turbo-fleet-chip ${planner.className || 'turbo-fleet-chip-neutral'}">${escapeHtml(planner.label)}</span>
      <span class="turbo-fleet-divider" aria-hidden="true">→</span>
      <span class="turbo-fleet-role">Executes on</span>
      <span class="turbo-fleet-workers">
        ${workers.length
          ? workers.map((worker) => `<span class="turbo-fleet-chip ${worker.className || 'turbo-fleet-chip-neutral'}">${escapeHtml(worker.label)}</span>`).join('')
          : '<span class="turbo-fleet-chip turbo-fleet-chip-neutral">No workers assigned</span>'}
      </span>
    </div>
  `;
}

function taskCardDurationLabel(task) {
  return taskDurationLabel(task).replace(/^Took /, '');
}

function formatHistoryRuntime(milliseconds) {
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return milliseconds > 0 ? '<1m' : '0m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

function historyPeriodLabel(period, anchor) {
  const { start, end } = periodRange(period, anchor);
  if (period === 'day') {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    }).format(start);
  }
  if (period === 'month') {
    return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(start);
  }
  const inclusiveEnd = new Date(end);
  inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
  const sameMonth = start.getMonth() === inclusiveEnd.getMonth();
  const startLabel = new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', ...(start.getFullYear() !== inclusiveEnd.getFullYear() ? { year: 'numeric' } : {}),
  }).format(start);
  const endLabel = new Intl.DateTimeFormat(undefined, {
    month: sameMonth ? undefined : 'short', day: 'numeric', year: 'numeric',
  }).format(inclusiveEnd);
  return `${startLabel} – ${endLabel}`;
}

function historyBucketLabel(bucket, period) {
  if (period === 'day') {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(bucket.start);
  }
  if (period === 'week') {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(bucket.start);
  }
  return String(bucket.start.getDate());
}

function historyDateHeading(value) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
  }).format(new Date(value));
}

function renderHistoryLedger(scopedTasks, visibleTasks) {
  const historyActive = state.taskView === 'history';
  elements.historyLedger.hidden = !historyActive;
  for (const button of elements.taskViewButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.taskView === state.taskView));
  }
  if (!historyActive) return;

  for (const button of elements.historyPeriodButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.historyPeriod === state.historyPeriod));
  }
  const stats = taskHistoryStats(visibleTasks);
  elements.historyPeriodLabel.textContent = historyPeriodLabel(state.historyPeriod, state.historyAnchor);
  elements.historyPeriodCaption.textContent = `${visibleTasks.length} task${visibleTasks.length === 1 ? '' : 's'} in the selected ${state.historyPeriod}`;
  elements.historyMetrics.innerHTML = `
    <span><small>Tasks</small><strong>${stats.total}</strong></span>
    <span><small>Completed</small><strong>${stats.successful}</strong></span>
    <span><small>Success</small><strong>${stats.successRate === null ? '–' : `${stats.successRate}%`}</strong></span>
    <span><small>Runtime</small><strong>${formatHistoryRuntime(stats.runtimeMs)}</strong></span>
  `;
  const buckets = activityBuckets(scopedTasks, state.historyPeriod, state.historyAnchor);
  const maximum = Math.max(1, ...buckets.map(({ count }) => count));
  elements.historyActivity.innerHTML = buckets.map((bucket) => `
    <span class="history-activity-cell" style="--activity: ${bucket.count / maximum}" title="${bucket.count} task${bucket.count === 1 ? '' : 's'}" aria-label="${escapeHtml(historyBucketLabel(bucket, state.historyPeriod))}: ${bucket.count} task${bucket.count === 1 ? '' : 's'}">
      <i aria-hidden="true"></i>
      <small>${escapeHtml(historyBucketLabel(bucket, state.historyPeriod))}</small>
    </span>
  `).join('');
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
  return executionSettingsForThread(state, state.selectedProvider, state.selectedThreadId);
}

function updateSelectedExecution(settings) {
  rememberThreadExecution(state, state.selectedProvider, state.selectedThreadId, settings);
}

function selectedModel() {
  const settings = selectedExecution();
  return state.modelCatalogs[state.selectedProvider]
    .find((model) => model.model === settings.model) || null;
}

function isExecuteCouncilEnabled() {
  return state.taskMode === 'execute' && state.planSettings.enabled;
}

function incompatibleComposerProviderMessage(provider, path = null) {
  const prefix = path ? `${providerLabel(provider)} is connected in ${workspaceName(path)}. ` : '';
  return isExecuteCouncilEnabled()
    ? `${prefix}The interactive Claude session is listed as Execute only. Plan council stays enabled and uses the signed-in Claude CLI automatically; choose a Codex Relay for review.`
    : `${prefix}Forward-planning Turbo keeps its Codex planner Relay selected.`;
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
  elements.effortSelect.step = '1';
  elements.effortSelect.value = String(effortIndex);
  elements.effortSelect.disabled = efforts.length === 0;
  elements.effortSelect.dataset.values = JSON.stringify(effortValues);
  elements.effortSelect.setAttribute('aria-valuetext', settings.effort ? `${settings.effort} effort` : 'Unavailable');
  elements.effortSliderValue.textContent = settings.effort ? `${settings.effort} effort` : 'Unavailable';
  elements.effortSliderSteps.innerHTML = effortValues.map((effort, index) => `
    <i class="${index === effortIndex ? 'active' : ''}" title="${escapeHtml(effort)}"></i>
  `).join('');
  elements.effortSelect.style.setProperty('--effort-progress', `${effortValues.length > 1 ? (effortIndex / (effortValues.length - 1)) * 100 : 0}%`);
  const selectedEffort = efforts.find((item) => item.reasoningEffort === settings.effort);
  elements.effortHint.textContent = selectedEffort?.description
    || 'This model does not expose effort control.';
  elements.executionControls.hidden = state.taskMode !== 'execute' || isExecuteCouncilEnabled();
}

function isClaudePlanReady() {
  return Boolean(state.status?.claude?.available && state.status?.claude?.authenticated);
}

function claudePlanIssue() {
  if (state.status?.capabilities?.planCouncil !== true) {
    return 'Restart Relay to enable Plan council';
  }
  if (state.status?.claude?.available !== true) {
    return 'Claude Code CLI is unavailable';
  }
  if (state.status?.claude?.authenticated !== true) {
    return 'Claude CLI is signed out. Run claude auth login; Relay will detect it automatically';
  }
  return '';
}

function isDirectClaudeEnabled() {
  return state.status?.capabilities?.directClaudeExecution === true;
}

function hasSelectedCodexThread() {
  return state.threads.some(
    (thread) => thread.id === state.selectedThreadId
      && threadProvider(thread) === 'codex'
      && (!state.activeProjectPath || sameProjectPath(thread.cwd, state.activeProjectPath)),
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
  elements.planCouncilEnabled.checked = settings.enabled;
  elements.planCouncilRoute.hidden = !settings.enabled;
  elements.planCouncilReadiness.hidden = !settings.enabled;

  setReadiness(
    elements.planClaudeReady,
    isClaudePlanReady(),
    `Claude author ready via CLI${state.status?.claude?.version ? ` · ${state.status.claude.version}` : ''}`,
    claudePlanIssue(),
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

function turboCouncilCatalogs() {
  return { codex: state.modelCatalogs.codex, claude: state.modelCatalogs.claude };
}

function syncTurboCouncilSettings() {
  const normalized = normalizeTurboCouncilSettings(state.turboSettings, turboCouncilCatalogs());
  state.turboSettings.councilOrder = normalized.councilOrder;
  state.turboSettings.councilClaudeModel = normalized.councilClaudeModel;
  state.turboSettings.councilClaudeEffort = normalized.councilClaudeEffort;
  return normalized;
}

function turboCouncilIssue() {
  const settings = syncTurboCouncilSettings();
  const readiness = turboCouncilReadiness({
    enabled: settings.councilEnabled,
    claudeReady: isClaudePlanReady(),
    claudeIssue: claudePlanIssue(),
    authorModel: settings.councilAuthorModel,
    reviewerModel: settings.councilReviewerModel,
  });
  return readiness.ready ? '' : readiness.reason;
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
  const council = syncTurboCouncilSettings();
  const claudeModels = state.modelCatalogs.claude;
  const claudeModel = claudeModels.find((item) => item.model === council.councilClaudeModel) || claudeModels[0] || null;
  const reviewerOptions = claudeModels.map((item) => `<option value="${escapeHtml(item.model)}">${escapeHtml(item.displayName)}${item.isDefault ? ' · default' : ''}</option>`).join('');
  elements.turboCouncilEnabled.checked = council.councilEnabled;
  elements.turboCouncilRoute.hidden = !council.councilEnabled;
  elements.turboCouncilRoute.dataset.enabled = String(council.councilEnabled);
  elements.turboCouncilRoute.dataset.first = council.councilFirstProvider;
  elements.turboCouncilRoute.setAttribute('aria-label', `${providerLabel(council.councilAuthorProvider)} authors the graph, then ${providerLabel(council.councilReviewerProvider)} reviews it`);
  elements.turboCouncilOrder.hidden = !council.councilEnabled;
  for (const button of elements.turboCouncilOrderButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.councilFirst === council.councilFirstProvider));
  }
  elements.turboCouncilCodexRole.textContent = `${council.councilFirstProvider === 'codex' ? '01 Author' : '02 Reviewer'}`;
  elements.turboCouncilClaudeRole.textContent = `${council.councilFirstProvider === 'claude' ? '01 Author' : '02 Reviewer'}`;
  elements.turboCouncilCodexCopy.textContent = council.councilFirstProvider === 'codex'
    ? 'Inspects the project and builds the execution graph.'
    : 'Checks dependencies, ownership, risk, and verification.';
  elements.turboCouncilClaudeCopy.textContent = council.councilFirstProvider === 'claude'
    ? 'Inspects the project and builds the execution graph.'
    : 'Checks dependencies, ownership, risk, and verification.';
  elements.turboCouncilReviewerModel.innerHTML = reviewerOptions;
  elements.turboCouncilReviewerModel.value = council.councilClaudeModel;
  elements.turboCouncilReviewerModel.disabled = claudeModels.length === 0;
  const reviewerEfforts = claudeModel?.supportedReasoningEfforts || [];
  const reviewerEffortValues = reviewerEfforts
    .map((item) => typeof item === 'string' ? item : item.reasoningEffort)
    .filter(Boolean);
  elements.turboCouncilReviewerEffort.innerHTML = [
    `<option value="">Model default${claudeModel?.defaultReasoningEffort ? ` · ${escapeHtml(claudeModel.defaultReasoningEffort)}` : ''}</option>`,
    ...reviewerEffortValues.map((effort) => `<option value="${escapeHtml(effort)}">${escapeHtml(effort)}</option>`),
  ].join('');
  elements.turboCouncilReviewerEffort.value = council.councilClaudeEffort;
  elements.turboCouncilReviewerEffort.disabled = reviewerEffortValues.length === 0;
  const available = turboWorkerThreads().length;
  const councilIssue = turboCouncilIssue();
  const ready = hasSelectedCodexThread() && available >= settings.workerCount && !councilIssue;
  elements.turboReadiness.dataset.state = ready ? 'ready' : 'missing';
  elements.turboReadiness.textContent = ready
    ? `Ready · ${council.councilEnabled ? council.councilOrder.map(providerLabel).join(' → ') : 'Codex'} + ${settings.workerCount} workers`
    : councilIssue || `Need ${settings.workerCount + 1} terminals · ${hasSelectedCodexThread() ? available + 1 : 0} connected here`;
  elements.turboNote.textContent = !council.councilEnabled
    ? 'The selected Codex Relay plans in read-only mode. Relay reads its JSON graph and dispatches ready tasks across the worker fleet.'
    : council.councilFirstProvider === 'claude'
      ? 'Claude authors the graph first. The selected Codex Relay reviews and corrects it before Relay dispatches workers.'
      : 'The selected Codex Relay authors the graph first. Claude reviews and corrects it before Relay dispatches workers.';
}

function updateSubmitState() {
  const hasThread = hasSelectedCodexThread();
  const ready = isExecuteCouncilEnabled()
    ? state.planSettings.enabled && hasThread && isClaudePlanReady() && Boolean(state.planSettings.reviewerModel)
    : state.taskMode === 'turbo'
      ? hasThread && turboWorkerThreads().length >= state.turboSettings.workerCount && !turboCouncilIssue()
    : state.threads.some(
      (thread) => thread.id === state.selectedThreadId && threadProvider(thread) === state.selectedProvider,
    );
  elements.submitButton.disabled = state.submitting || !ready;
  elements.submitButton.textContent = state.submitting
    ? isExecuteCouncilEnabled() ? 'Starting council' : state.taskMode === 'turbo' ? 'Starting turbo' : 'Adding task'
    : isExecuteCouncilEnabled()
      ? 'Build reviewed plan'
      : state.taskMode === 'turbo' ? 'Plan and execute' : 'Add to queue';
}

function renderPromptCopy() {
  elements.promptLabel.textContent = isExecuteCouncilEnabled()
    ? 'Planning brief'
    : state.taskMode === 'turbo' ? 'Turbo objective' : 'Task prompt';
  elements.prompt.placeholder = isExecuteCouncilEnabled()
    ? 'Describe what should be built, the constraints, and the decisions the reviewed plan must settle.'
    : state.taskMode === 'turbo'
      ? 'Describe the complete outcome. The planner will produce a JSON dependency graph and Relay will dispatch it across worker terminals.'
      : 'Describe the outcome, constraints, and how the agent should verify the work.';
}

function selectMode(mode, { focus = false } = {}) {
  if (!['execute', 'turbo'].includes(mode)) {
    return;
  }
  state.taskMode = mode;
  if (mode !== 'execute') {
    state.planSettings.enabled = false;
  }
  for (const tab of elements.modeTabs) {
    const selected = tab.dataset.mode === mode;
    tab.classList.toggle('selected', selected);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  elements.executeConfig.hidden = mode !== 'execute';
  elements.turboConfig.hidden = mode !== 'turbo';
  renderPromptCopy();
  elements.terminalLegend.textContent = mode === 'turbo' ? 'Planner terminal' : 'Run in terminal';

  if (!providerEligibleForComposer(state, state.selectedProvider)) {
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
      if (provider === 'claude') {
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
    if (provider === 'claude') {
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
    tab.disabled = false;
    tab.classList.toggle('selected', selected);
    tab.dataset.state = info.connectedCount > 0 ? 'live' : info.available ? 'ready' : 'unavailable';
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }

  elements.providerInput.value = state.selectedProvider;
  elements.terminalPanel.setAttribute('aria-labelledby', `provider-${state.selectedProvider}`);
}

function isActiveProjectPaused() {
  if (!state.activeProjectPath) return false;
  return (state.status?.pausedProjectPaths || []).some(
    (path) => sameProjectPath(path, state.activeProjectPath),
  );
}

function renderHeaderRunningTasks() {
  const running = state.runningTasks || [];
  if (running.length === 0) {
    if (elements.headerRunningTasks.dataset.signature === 'empty') return;
    elements.headerRunningTasks.dataset.signature = 'empty';
    elements.headerRunningTasks.innerHTML = `
      <div class="header-running-empty">
        <i aria-hidden="true"></i>
        <span>No tasks running</span>
      </div>
    `;
    return;
  }

  const signature = JSON.stringify(running.map((task) => [
    task.id,
    task.repo_path,
    task.thread_id,
    task.thread_name,
    task.prompt,
    task.latestAgentUpdate?.provider,
    task.latestAgentUpdate?.text,
    taskRelayLabel(task),
  ]));
  if (elements.headerRunningTasks.dataset.signature === signature) return;
  const previousScrollLeft = elements.headerRunningTasks.scrollLeft;
  const focusedTaskId = document.activeElement?.closest?.('[data-running-task-id]')?.dataset.runningTaskId;
  elements.headerRunningTasks.dataset.signature = signature;
  elements.headerRunningTasks.innerHTML = running.map((task) => {
    const update = task.latestAgentUpdate;
    const updateProvider = update?.provider || taskProvider(task);
    const project = workspaceName(task.repo_path);
    const relay = taskRelayLabel(task);
    const response = update?.text || 'Waiting for the first agent response';
    return `
      <button
        class="header-running-task"
        type="button"
        data-running-task-id="${task.id}"
        data-provider="${escapeHtml(taskProvider(task))}"
      >
        <span class="header-running-task-topline">
          <i aria-hidden="true"></i>
          <b>Task ${String(task.id).padStart(3, '0')}</b>
          <span title="${escapeHtml(task.repo_path)}">${escapeHtml(project)} · ${escapeHtml(relay)}</span>
          <time data-header-running-duration="${task.id}">${escapeHtml(taskDurationLabel(task))}</time>
        </span>
        <strong title="${escapeHtml(task.prompt)}">${escapeHtml(compactText(task.prompt, 120))}</strong>
        <span class="header-running-response" data-provider="${escapeHtml(updateProvider)}" title="${escapeHtml(response)}">
          <b>${escapeHtml(providerLabel(updateProvider))}</b>
          <span>${escapeHtml(compactText(response, 260))}</span>
        </span>
      </button>
    `;
  }).join('');
  elements.headerRunningTasks.scrollLeft = previousScrollLeft;
  if (focusedTaskId) {
    elements.headerRunningTasks
      .querySelector(`[data-running-task-id="${focusedTaskId}"]`)
      ?.focus({ preventScroll: true });
  }
}

function renderStatus() {
  if (!state.status) {
    return;
  }

  const { codex, claude } = state.status;
  const paused = isActiveProjectPaused();
  const codexReady = Boolean(codex.available && codex.authenticated && codex.appServer?.connected);
  const claudeReady = Boolean(claude?.available && claude?.authenticated);
  const relayReady = codexReady || claudeReady;
  const scopedTasks = projectTasks();
  const queuedCount = scopedTasks.filter((task) => task.status === 'queued').length;
  const runningTask = scopedTasks.find((task) => task.status === 'running') || null;
  const staleProjectScheduler = projectQueueRestartRequired({
    supported: state.status.capabilities?.projectQueueIsolation,
    paused,
    queuedCount,
    projectRunning: Boolean(runningTask),
    otherProjectRunning: state.tasks.some((task) => (
      task.status === 'running' && !sameProjectPath(task.repo_path, state.activeProjectPath)
    )),
  });
  const staleClaudeScheduler = parallelClaudeRestartRequired({
    supported: state.status.capabilities?.parallelClaudeExecution,
    queuedTasks: scopedTasks,
    runningTasks: state.tasks,
  });

  elements.codexStatus.dataset.state = relayReady ? 'online' : 'offline';
  elements.codexStatusLabel.textContent = relayReady ? 'Relay online' : 'Relay unavailable';
  elements.pauseButton.textContent = paused ? 'Resume queue' : 'Pause queue';
  elements.pauseButton.classList.toggle('primary', paused);
  elements.pauseButton.disabled = !state.activeProjectPath;
  elements.pauseButton.title = state.activeProjectPath ? '' : 'Select a project to pause its queue';

  renderHeaderRunningTasks();

  if (state.taskView === 'history') {
    const historyCount = tasksInPeriod(scopedTasks, state.historyPeriod, state.historyAnchor).length;
    elements.queueSummary.textContent = `${historyCount} task${historyCount === 1 ? '' : 's'} in selected ${state.historyPeriod}`;
  } else {
    elements.queueSummary.textContent = staleClaudeScheduler
      ? `Restart Relay to run Claude simultaneously across projects · ${queuedCount} waiting`
      : staleProjectScheduler
      ? `Restart Relay to activate this project's independent queue · ${queuedCount} waiting`
      : paused
      ? `${queuedCount} task${queuedCount === 1 ? '' : 's'} waiting while paused`
      : runningTask
        ? `Task ${runningTask.id} is running · ${queuedCount} waiting`
        : `${queuedCount} waiting · queue ready`;
  }
}

function renderTasks() {
  if (state.queueDrag) {
    return;
  }
  const scopedTasks = projectTasks();
  const visibleTasks = state.taskView === 'history'
    ? tasksInPeriod(scopedTasks, state.historyPeriod, state.historyAnchor)
      .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
    : [...scopedTasks].sort((left, right) => {
      const statusRank = (task) => task.status === 'running' ? 0 : task.status === 'queued' ? 1 : 2;
      const rankDifference = statusRank(left) - statusRank(right);
      if (rankDifference !== 0) return rankDifference;
      if (left.status === 'queued' && right.status === 'queued') {
        return left.position - right.position || left.id - right.id;
      }
      return right.id - left.id;
    });
  renderHistoryLedger(scopedTasks, visibleTasks);
  if (visibleTasks.length === 0) {
    state.parallelTaskIds.clear();
    renderParallelBatchBar();
    elements.taskList.innerHTML = `
      <div class="queue-empty">
        <span aria-hidden="true">00</span>
        <strong>${state.taskView === 'history' ? 'No tasks in this period' : 'The queue is clear'}</strong>
        <p>${state.taskView === 'history' ? 'Choose another date or a wider period.' : state.activeProjectPath ? `No tasks in ${escapeHtml(workspaceName(state.activeProjectPath))} yet.` : 'Choose a terminal and add the first prompt.'}</p>
      </div>
    `;
    return;
  }

  const historyActive = state.taskView === 'history';
  const queuedIds = historyActive ? [] : visibleTasks.filter((task) => task.status === 'queued').map((task) => task.id);
  state.parallelTaskIds = new Set([...state.parallelTaskIds].filter((id) => queuedIds.includes(id)));
  renderParallelBatchBar();
  let previousHistoryDate = '';
  elements.taskList.innerHTML = visibleTasks.map((task) => {
    const historyDate = historyActive ? new Date(task.created_at).toDateString() : '';
    const dateHeading = historyActive && historyDate !== previousHistoryDate
      ? `<div class="history-date-heading"><span>${escapeHtml(historyDateHeading(task.created_at))}</span><i></i></div>` : '';
    previousHistoryDate = historyDate;
    const queueIndex = queuedIds.indexOf(task.id);
    const queued = queueIndex !== -1;
    const turboMarker = turboPlanMarker(task);
    const turboPlanner = task.mode === 'turbo' ? turboPlannerIdentity(task) : null;
    const assignable = queued && task.mode === 'execute' && task.provider === 'codex';
    const assignmentTargets = assignable ? state.threads.filter((thread) => (
      threadProvider(thread) === 'codex'
      && sameProjectPath(thread.cwd, task.repo_path)
      && thread.id !== task.thread_id
    )) : [];
    const reorderable = queued && !historyActive && Boolean(state.activeProjectPath);
    const reorderControls = reorderable ? `
      <span class="queue-reorder" aria-label="Reorder queued task">
        <button type="button" data-move="up" aria-label="Move task ${task.id} up" ${queueIndex === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" data-move="down" aria-label="Move task ${task.id} down" ${queueIndex === queuedIds.length - 1 ? 'disabled' : ''}>↓</button>
      </span>
    ` : '';
    return `${dateHeading}
      <article
        class="task-card ${task.id === state.selectedTaskId ? 'selected' : ''} ${reorderable ? 'task-card-reorderable' : ''}"
        data-task-id="${task.id}"
        data-status="${escapeHtml(task.status)}"
        data-mode="${escapeHtml(task.mode || 'execute')}"
        tabindex="0"
        aria-label="Task ${task.id}, ${escapeHtml(task.status)}${queued ? ', draggable queue item' : ''}"
      >
        <div class="task-topline">
          <span class="task-identity">
            ${queued ? `<input class="parallel-task-check" type="checkbox" aria-label="Select task ${task.id} for parallel Codex execution" ${state.parallelTaskIds.has(task.id) ? 'checked' : ''}>` : ''}
            ${reorderable ? '<span class="drag-grip" draggable="true" role="button" tabindex="0" aria-label="Drag task to reorder">⠿</span>' : ''}
            ${agentBadgeMarkup(task, 'task-agent-icon')}
            <span class="task-number">#${String(task.id).padStart(3, '0')}</span>
            ${task.continued_from_task_id ? `<span class="task-parent-link">↳ #${String(task.continued_from_task_id).padStart(3, '0')}</span>` : ''}
          </span>
          <span class="task-top-actions">
            ${assignmentTargets.length ? `<button class="task-assign-button" type="button" data-show-assignment aria-expanded="${state.assigningTaskId === task.id}">Assign</button>` : ''}
            ${reorderControls}
            ${turboMarker ? `<span class="turbo-plan-marker turbo-plan-marker-${escapeHtml(turboMarker.phase)}" title="${escapeHtml(turboMarker.label)}" aria-label="Turbo stage: ${escapeHtml(turboMarker.label)}">${escapeHtml(turboMarker.label)}</span>` : ''}
            <span class="task-status status-${escapeHtml(task.status)}">${escapeHtml(task.status)}</span>
          </span>
        </div>
        <p class="task-prompt">${escapeHtml(task.prompt)}</p>
        ${turboFleetMarkup(task)}
        ${state.assigningTaskId === task.id ? `
          <div class="task-assignment-options" aria-label="Assign task ${task.id} to another Relay">
            ${assignmentTargets.map((thread) => `<button type="button" data-assign-thread="${escapeHtml(thread.id)}">Relay ${relayNumber(thread)} <span>${escapeHtml(thread.status)}</span></button>`).join('')}
          </div>
        ` : ''}
        <div class="task-footer">
          <span class="task-footer-execution"><span class="task-relay-name ${turboPlanner ? turboPlanner.className : relayColorClass(task.thread_id)}">${escapeHtml(turboPlanner ? `Planner ${turboPlanner.label}` : taskRelayLabel(task))}</span><span aria-hidden="true"> · </span>${escapeHtml(taskCardExecutionLabel(task))}</span>
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

    if (card.dataset.status === 'queued' && !historyActive && state.activeProjectPath) {
      const grip = card.querySelector('.drag-grip');
      grip?.addEventListener('dragstart', (event) => {
        if (state.reorderPending || state.queueDrag) {
          event.preventDefault();
          return;
        }
        const projectQueueIds = queuedTaskIds(projectTasks());
        const snapshot = createQueueSnapshot(projectQueueIds);
        const draggedId = Number(card.dataset.taskId);
        state.queueDrag = { snapshot, draggedId, expectedTaskIds: snapshot.expectedTaskIds, visibleTaskIds: snapshot.visibleTaskIds, targetId: null, edge: null, submitted: false };
        state.draggedTaskId = draggedId;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', card.dataset.taskId);
        card.classList.add('dragging');
      });
      grip?.addEventListener('dragend', () => {
        cleanupQueueDrag();
      });
      card.addEventListener('dragover', (event) => {
        const drag = state.queueDrag;
        const targetId = Number(card.dataset.taskId);
        if (!drag || drag.submitted) {
          return;
        }
        if (drag.draggedId === targetId) {
          clearQueueDropMarkers();
          drag.targetId = null;
          drag.edge = null;
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const before = event.clientY < card.getBoundingClientRect().top + card.offsetHeight / 2;
        clearQueueDropMarkers();
        drag.targetId = targetId;
        drag.edge = before ? 'before' : 'after';
        card.classList.add(before ? 'drop-before' : 'drop-after');
      });
      card.addEventListener('dragleave', (event) => {
        if (!event.relatedTarget || !card.contains(event.relatedTarget)) {
          clearQueueDropMarkers();
        }
      });
      card.addEventListener('drop', (event) => {
        event.preventDefault();
        const drag = state.queueDrag;
        const targetId = Number(card.dataset.taskId);
        if (!drag || drag.draggedId === targetId || drag.submitted) {
          cleanupQueueDrag();
          return;
        }
        const before = event.clientY < card.getBoundingClientRect().top + card.offsetHeight / 2;
        drag.targetId = targetId;
        drag.edge = before ? 'before' : 'after';
        const nextGlobalIds = dropVisibleTask(drag.snapshot, drag.draggedId, drag.targetId, drag.edge);
        if (!nextGlobalIds) {
          cleanupQueueDrag();
          return;
        }
        drag.submitted = true;
        reorderQueuedTasks(drag.snapshot, nextGlobalIds);
      });
    }
  }
}

function clearQueueDropMarkers() {
  for (const item of elements.taskList.querySelectorAll('.task-card')) {
    item.classList.remove('drop-before', 'drop-after');
  }
}

function cleanupQueueDrag() {
  clearQueueDropMarkers();
  for (const item of elements.taskList.querySelectorAll('.task-card')) {
    item.classList.remove('dragging');
  }
  state.queueDrag = null;
  state.draggedTaskId = null;
}

function relayNumber(thread) {
  const relays = state.threads.filter((item) => threadProvider(item) === 'codex');
  const index = relays.findIndex((item) => item.id === thread.id);
  return index === -1 ? '?' : index + 1;
}

function relayColorClass(threadId) {
  const thread = state.threads.find((item) => item.id === threadId);
  if (!thread || threadProvider(thread) !== 'codex') return '';
  const number = relayNumber(thread);
  return Number.isInteger(number) ? `relay-color-${((number - 1) % 6) + 1}` : '';
}

function providerSupportsIdleRouting(provider = state.selectedProvider) {
  return provider === 'codex'
    || (provider === 'claude' && state.status?.capabilities?.parallelClaudeExecution === true);
}

function submissionThreadId({ runNow = false } = {}) {
  if (runNow || isExecuteCouncilEnabled() || !state.preferIdleTerminal || state.taskMode !== 'execute' || !providerSupportsIdleRouting()) {
    return state.selectedThreadId;
  }
  const selectedThread = state.threads.find((thread) => thread.id === state.selectedThreadId);
  const routePath = state.activeProjectPath || selectedThread?.cwd;
  return idleExecutionThreadId({
    threads: state.threads.map((thread) => ({ ...thread, provider: threadProvider(thread) })),
    tasks: state.tasks,
    selectedThreadId: state.selectedThreadId,
    provider: state.selectedProvider,
    routePath,
    sameProjectPath,
  }) || state.selectedThreadId;
}

async function settleIdleSubmissionThread({ runNow = false } = {}) {
  const immediate = submissionThreadId({ runNow });
  if (runNow || !state.preferIdleTerminal || state.taskMode !== 'execute' || !providerSupportsIdleRouting()) return immediate;
  const selected = state.threads.find((thread) => thread.id === state.selectedThreadId);
  if (immediate !== state.selectedThreadId || selected?.status === 'idle') return immediate;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    await loadThreads();
    const routed = submissionThreadId({ runNow });
    if (routed !== state.selectedThreadId) return routed;
  }
  return submissionThreadId({ runNow });
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
    if (state.queueDrag) cleanupQueueDrag();
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
  elements.parallelBatchBar.hidden = state.taskView === 'history' || selectedCount === 0;
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
  const runningById = new Map(state.runningTasks.map((task) => [task.id, task]));
  for (const element of elements.headerRunningTasks.querySelectorAll('[data-header-running-duration]')) {
    const task = runningById.get(Number(element.dataset.headerRunningDuration));
    if (task) {
      element.textContent = taskDurationLabel(task);
    }
  }
  const selected = state.selectedTaskForEvents;
  if (selected && elements.termDuration) {
    const fresh = tasksById.get(selected.id) || selected;
    elements.termDuration.textContent = terminalDurationLabel(fresh);
  }
}

async function reorderQueuedTasks(snapshot, taskIds) {
  if (state.reorderPending || !state.activeProjectPath) {
    return;
  }
  const request = buildQueueReorderRequest(snapshot, taskIds);
  if (!request) return;
  state.reorderPending = true;
  elements.taskList.dataset.reordering = 'true';
  try {
    await api('/api/queue/reorder', {
      method: 'POST',
      body: JSON.stringify({ ...request, projectPath: state.activeProjectPath }),
    });
    cleanupQueueDrag();
    await load();
  } catch (error) {
    cleanupQueueDrag();
    elements.queueSummary.textContent = /queue changed/i.test(error.message)
      ? 'Queue changed elsewhere. Refreshed; try again.'
      : error.message;
    await load();
  } finally {
    state.reorderPending = false;
    delete elements.taskList.dataset.reordering;
  }
}

function moveQueuedTask(taskId, direction) {
  if (state.reorderPending || state.queueDrag) {
    return;
  }
  if (!state.activeProjectPath) return;
  const snapshot = createQueueSnapshot(queuedTaskIds(projectTasks()));
  const nextProjectIds = moveVisibleTask(snapshot, taskId, direction);
  if (nextProjectIds) reorderQueuedTasks(snapshot, nextProjectIds);
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

function setDetailCopyContent(content = {}) {
  state.detailCopyContent = content;
  for (const button of elements.contentCopyButtons) {
    button.textContent = 'Copy';
    button.disabled = !String(content[button.dataset.copyContent] || '').trim();
  }
}

async function copyDetailContent(button) {
  const text = state.detailCopyContent[button.dataset.copyContent];
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Copy failed';
  }
  setTimeout(() => {
    button.textContent = 'Copy';
  }, 1200);
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
  const planArtifactsSupported = state.status?.capabilities?.planArtifacts === true;
  elements.planDraftSection.hidden = !hasDraft;
  elements.planReviewSection.hidden = !hasReview;
  elements.planFinalSection.hidden = !hasFinal;
  elements.planArtifactRow.hidden = !hasFinal;
  elements.planExecutionPanel.hidden = !hasFinal;
  elements.planDraft.innerHTML = hasDraft ? renderMarkdown(plan.draft) : '';
  elements.planReview.innerHTML = hasReview ? renderMarkdown(plan.review) : '';
  elements.planFinal.innerHTML = hasFinal ? renderMarkdown(plan.finalPlan) : '';
  if (hasFinal) {
    elements.planArtifactPath.textContent = plan.artifactPath || `.data/tasks/${task.id}/plan.md`;
    elements.planArtifactLink.textContent = planArtifactsSupported ? 'Open plan.md' : 'Restart to open';
    elements.planArtifactLink.setAttribute('aria-disabled', String(!planArtifactsSupported));
    if (planArtifactsSupported) {
      elements.planArtifactLink.href = `/api/tasks/${task.id}/plan`;
      elements.planArtifactLink.removeAttribute('title');
    } else {
      elements.planArtifactLink.removeAttribute('href');
      elements.planArtifactLink.title = 'Restart Relay to enable the canonical plan file route.';
    }
  } else {
    elements.planArtifactPath.textContent = '';
    elements.planArtifactLink.removeAttribute('href');
    elements.planArtifactLink.removeAttribute('aria-disabled');
  }
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
  const displayTask = plan ? { ...task, turboPlan: plan } : task;
  const waitingCopy = turboWaitingCopy(displayTask);
  const packages = Array.isArray(plan?.tasks) ? plan.tasks.map(normalizeTurboPackage) : [];
  const graphPresentation = graphProgressPresentation(plan, task);
  const progress = graphPresentation.progress;
  const completedIds = packages.filter((item) => item.status === 'complete').map((item) => item.id);
  const previewStatus = graphPresentation.indeterminate
    ? graphPresentation.state
    : plan?.status || task.status;
  elements.turboPreview.hidden = false;
  elements.resultSection.hidden = task.status === 'running' || task.status === 'queued';
  elements.turboPreviewStatus.textContent = previewStatus;
  elements.turboPreviewStatus.dataset.state = previewStatus;
  elements.turboPreviewSummary.textContent = graphPresentation.indeterminate && graphPresentation.state === 'planning'
    ? 'The planner is building the dependency graph. Worker packages will appear here when the graph is ready.'
    : ['planning', 'reviewing', 'ready'].includes(turboPlanMarker(displayTask)?.phase)
    ? waitingCopy
    : plan?.summary || waitingCopy || 'The planner is producing a machine-readable dependency graph.';
  if (elements.turboGraphProgress) {
    elements.turboGraphProgress.textContent = graphPresentation.label;
    elements.turboGraphProgress.dataset.state = graphPresentation.state;
  }
  if (elements.turboGraphProgressbar) {
    elements.turboGraphProgressbar.setAttribute('aria-label', graphPresentation.ariaLabel);
    elements.turboGraphProgressbar.dataset.indeterminate = String(graphPresentation.indeterminate);
    elements.turboGraphProgressbar.setAttribute('aria-busy', String(graphPresentation.indeterminate));
    if (graphPresentation.indeterminate) {
      elements.turboGraphProgressbar.removeAttribute('aria-valuenow');
      elements.turboGraphProgressbar.removeAttribute('aria-valuemax');
    } else {
      elements.turboGraphProgressbar.setAttribute('aria-valuenow', String(progress.complete));
      elements.turboGraphProgressbar.setAttribute('aria-valuemax', String(Math.max(progress.total, 1)));
    }
    elements.turboGraphProgressbar.style.setProperty('--turbo-progress', progress.total ? String((progress.complete / progress.total) * 100) : '0');
  }
  elements.turboTaskGraph.setAttribute('role', 'list');
  elements.turboTaskGraph.dataset.planning = graphPresentation.indeterminate ? 'true' : 'false';
  if (!packages.length && graphPresentation.indeterminate) {
    elements.turboTaskGraph.innerHTML = [1, 2, 3].map((index) => `
      <div class="turbo-graph-skeleton" aria-hidden="true"><span></span><i></i><b></b></div>
    `).join('');
    return;
  }
  const planWorkers = plan?.workers || task.turbo?.workers || [];
  elements.turboTaskGraph.innerHTML = packages.map((item) => {
    const itemState = item.status;
    const pendingState = pendingPackageState(item, completedIds);
    const incomplete = item.dependsOn.filter((dependency) => !completedIds.includes(String(dependency)));
    const resolvedWorker = resolvePackageWorker(item, { workers: planWorkers });
    const ownerThread = resolvedWorker?.threadId
      ? state.threads.find((thread) => thread.id === resolvedWorker.threadId)
      : null;
    const owner = ownerThread && threadProvider(ownerThread) === 'codex'
      ? { label: `Relay ${relayNumber(ownerThread)}`, className: relayColorClass(ownerThread.id) }
      : { label: resolvedWorker?.title || 'Unassigned Relay', className: '' };
    const displayState = itemState === 'pending' ? pendingState : itemState;
    const stateIcon = displayState === 'complete' ? '✓' : displayState === 'failed' ? '!' : displayState === 'running' ? '' : '•';
    const stateLabel = displayState === 'complete'
      ? 'Completed'
      : displayState === 'failed'
        ? `Failed${item.error ? `: ${item.error}` : ''}`
        : displayState === 'running'
          ? 'In progress'
          : displayState === 'blocked'
            ? `Blocked by ${incomplete.join(', ')}`
            : 'Ready to dispatch';
    return `
      <article class="turbo-graph-node" data-state="${escapeHtml(itemState)}" role="listitem">
        <span class="turbo-graph-state turbo-graph-state-${escapeHtml(displayState)}" aria-label="${escapeHtml(stateLabel)}">
          ${displayState === 'running' ? `<i class="turbo-graph-spinner" style="--spinner-phase: -${Math.round(performance.now())}ms" aria-hidden="true"></i>` : `<b aria-hidden="true">${stateIcon}</b>`}
          <span class="sr-only">${escapeHtml(stateLabel)}</span>
        </span>
        <div class="turbo-graph-copy">
          <code title="${escapeHtml(item.id)}">${escapeHtml(item.id)}</code>
          <strong title="${escapeHtml(item.title || '')}">${escapeHtml(item.title || 'Untitled package')}</strong>
          <small>${escapeHtml(stateLabel)}${item.dependsOn.length && displayState !== 'blocked' ? ` · After ${escapeHtml(item.dependsOn.join(', '))}` : ''}${item.error && displayState === 'failed' ? ` · ${escapeHtml(item.error)}` : ''}</small>
        </div>
        <span class="turbo-graph-owner ${owner.className || 'turbo-graph-owner-neutral'}">${escapeHtml(owner.label)}</span>
      </article>
    `;
  }).join('');
}

async function selectTask(taskId) {
  const requestSequence = ++state.taskLoadSequence;
  const eventTaskChanged = state.eventTaskId !== taskId;
  state.selectedTaskId = taskId;
  setDetailCopyContent();
  renderTasks();
  if (eventTaskChanged) {
    elements.continuationForm.hidden = true;
    elements.continuationInput.disabled = true;
  }
  const { task, events, plan = null, turboPlan = null } = await api(`/api/tasks/${taskId}`);
  if (requestSequence !== state.taskLoadSequence || state.selectedTaskId !== taskId) return;
  elements.emptyDetail.hidden = true;
  elements.taskDetail.hidden = false;
  applyTerminalHeight();
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
    ${task.continued_from_task_id ? `<span class="detail-continuation-link">Continues Task #${task.continued_from_task_id}</span>` : ''}
  `;
  elements.detailPrompt.textContent = task.prompt;
  elements.detailPromptPreview.textContent = compactText(task.prompt, 96);
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
  elements.detailResultPreview.textContent = task.result
    ? compactText(task.result, 96)
    : task.error ? compactText(task.error, 96) : `${task.status} · response pending`;
  elements.detailResult.dataset.empty = task.result || task.error ? 'false' : 'true';
  setDetailCopyContent({
    prompt: task.prompt,
    result: task.result || task.error || '',
    planDraft: plan?.draft || '',
    planReview: plan?.review || '',
    planFinal: plan?.finalPlan || '',
  });
  if (eventTaskChanged) {
    elements.promptSection.open = false;
    elements.resultSection.open = Boolean(task.result || task.error);
  }
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

  if (task.status === 'queued') {
    const editButton = actionButton('Edit', () => openTaskEditor(task), 'quiet');
    const editingSupported = state.status?.capabilities?.queuedTaskEditing === true;
    const preparing = state.status?.planningTaskIds?.includes(task.id);
    editButton.disabled = !editingSupported || preparing;
    editButton.title = !editingSupported
      ? 'Restart Relay to edit queued tasks.'
      : preparing ? 'This task is already being prepared. Cancel it before editing.' : '';
    elements.detailActions.append(editButton);
  }
  if (task.status === 'queued' || task.status === 'running') {
    elements.detailActions.append(actionButton('Cancel', () => taskAction(task.id, 'cancel'), 'danger'));
  }
  if (['failed', 'cancelled', 'interrupted'].includes(task.status) && !isFailedSessionFollowUp(task)) {
    const retryTarget = task.mode === 'plan' ? selectedPlanReviewThread(task) : null;
    const retryLabel = retryTarget ? `Resume on Relay ${relayNumber(retryTarget)}` : task.mode === 'plan' ? 'Resume council' : 'Retry';
    const retryButton = actionButton(
      retryLabel,
      () => {
        const currentTarget = task.mode === 'plan' ? selectedPlanReviewThread(task) : null;
        return taskAction(task.id, 'retry', currentTarget ? { threadId: currentTarget.id } : null);
      },
      'primary',
    );
    if (task.mode === 'plan') retryButton.dataset.planRetry = String(task.id);
    elements.detailActions.append(retryButton);
  }
  if (task.status !== 'running') {
    elements.detailActions.append(actionButton('Delete', () => deleteTask(task.id), 'danger quiet'));
  }
  refreshPlanTaskActions(task);

  state.eventTaskId = taskId;
  renderTaskContinuation(task, { taskChanged: eventTaskChanged });
  renderEventStream(events, task, { forceBottom: eventTaskChanged, resetDisclosures: eventTaskChanged });
}

async function loadSnapshot() {
  const statusPath = state.activeProjectPath
    ? `/api/status?projectPath=${encodeURIComponent(state.activeProjectPath)}`
    : '/api/status';
  const [statusBody, tasksBody] = await Promise.all([
    api(statusPath),
    api('/api/tasks'),
  ]);
  state.status = statusBody;
  state.tasks = tasksBody.tasks;
  state.runningTasks = statusBody.runningTasks
    || state.tasks.filter((task) => task.status === 'running');
  await loadProjects();
  hydrateThreadExecutionSettings(state, state.tasks);
  renderExecutionControls();
  const launcherEnabled = state.status?.capabilities?.projectLauncher === true;
  elements.launchCodexButton.disabled = !launcherEnabled;
  elements.launchClaudeButton.disabled = !launcherEnabled;
  renderTerminalCloseControl();

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
  const thread = state.threads.find((item) => item.id === threadId);
  const provider = thread ? threadProvider(thread) : state.selectedProvider;
  if (thread && !providerEligibleForComposer(state, provider)) {
    elements.formMessage.textContent = incompatibleComposerProviderMessage(provider);
    return;
  }
  const providerChanged = provider !== state.selectedProvider;
  if (providerChanged) {
    state.selectedProvider = provider;
    state.taskScope = 'workspace';
    renderProviderTabs();
    renderPromptCopy();
    renderAttachmentComposer();
    loadModels(provider);
  }
  state.selectedThreadId = threadId;
  renderExecutionControls();
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
  renderTerminalCloseControl();
  renderPlanControls();
  renderTurboControls();
  refreshPlanTaskActions();
  updateSubmitState();
}

function renderTerminalCloseControl() {
  const supported = state.status?.capabilities?.terminalControl === true;
  const thread = state.threads.find((item) => item.id === state.selectedThreadId) || null;
  const control = thread?.terminalControl || null;
  const closing = Boolean(state.closingThreadId);
  const presentation = terminalClosePresentation({
    supported,
    threadLabel: closing ? state.closingThreadLabel : thread ? threadDisplayName(thread) : null,
    control,
    closing,
  });

  elements.terminalCloseRow.dataset.state = presentation.state;
  elements.terminalCloseLabel.textContent = presentation.label;
  elements.terminalCloseReason.textContent = presentation.reason;
  elements.closeTerminalButton.textContent = presentation.buttonLabel;
  elements.closeTerminalButton.disabled = presentation.disabled;
  elements.closeTerminalButton.setAttribute('aria-label', presentation.label);
  elements.closeTerminalButton.title = presentation.reason;
}

async function closeSelectedTerminal() {
  const thread = state.threads.find((item) => item.id === state.selectedThreadId);
  if (!thread || state.closingThreadId) return;
  const control = thread.terminalControl;
  if (control?.canClose !== true) {
    elements.formMessage.textContent = control?.reason || 'This terminal cannot be closed from Relay.';
    return;
  }
  const label = threadDisplayName(thread);
  if (!window.confirm(`Close ${label} and its native terminal window? The connected session will end.`)) return;
  state.closingThreadId = thread.id;
  state.closingThreadLabel = label;
  renderTerminalCloseControl();
  try {
    await api(`/api/terminals/${encodeURIComponent(thread.id)}`, { method: 'DELETE' });
    state.threads = state.threads.filter((item) => item.id !== thread.id);
    if (state.selectedThreadId === thread.id) state.selectedThreadId = null;
    elements.formMessage.textContent = `${label} and its terminal window were closed.`;
    renderThreads();
  } catch (error) {
    elements.formMessage.textContent = error.message;
  } finally {
    state.closingThreadId = null;
    state.closingThreadLabel = null;
    renderTerminalCloseControl();
  }
}

function selectProvider(provider, { focus = false } = {}) {
  const councilClosed = isExecuteCouncilEnabled() && provider !== 'codex';
  if (councilClosed) {
    state.planSettings.enabled = false;
  }
  if (provider === state.selectedProvider) {
    return;
  }
  state.selectedProvider = provider;
  state.selectedThreadId = null;
  state.taskScope = 'workspace';
  renderProviderTabs();
  renderExecutionControls();
  renderPlanControls();
  renderPromptCopy();
  renderAttachmentComposer();
  renderThreads();
  loadModels(provider);
  if (councilClosed) {
    elements.formMessage.textContent = 'Plan council turned off. Claude selected for direct execution.';
  }
  if (focus) {
    document.querySelector(`#provider-${provider}`)?.focus();
  }
}

function renderThreads() {
  if (!providerEligibleForComposer(state, state.selectedProvider)) {
    state.selectedProvider = 'codex';
    const selectedThread = state.threads.find((thread) => thread.id === state.selectedThreadId);
    if (selectedThread && threadProvider(selectedThread) !== 'codex') {
      state.selectedThreadId = null;
    }
    renderProviderTabs();
  }
  const directExecute = state.taskMode === 'execute' && !isExecuteCouncilEnabled();
  const selectableThreads = projectThreads(directExecute ? null : 'codex');
  const councilClaudeThreads = isExecuteCouncilEnabled() ? projectThreads('claude') : [];
  const visibleThreads = [...selectableThreads, ...councilClaudeThreads];
  const isClaude = state.selectedProvider === 'claude';
  elements.idleTerminalRoute.hidden = isClaude || state.taskMode !== 'execute' || isExecuteCouncilEnabled();
  elements.preferIdleTerminal.checked = state.preferIdleTerminal;
  const directClaudeEnabled = isDirectClaudeEnabled();
  const launcherEnabled = state.status?.capabilities?.projectLauncher === true;
  elements.launchCodexButton.disabled = !launcherEnabled;
  elements.launchClaudeButton.disabled = !launcherEnabled;
  elements.launchClaudeButton.title = isExecuteCouncilEnabled()
    ? 'Launches a separate interactive Claude session. Plan council uses the signed-in Claude CLI automatically.'
    : '';
  elements.terminalLegend.textContent = isExecuteCouncilEnabled()
    ? 'Codex review Relay'
    : state.taskMode === 'turbo'
      ? state.turboSettings.councilEnabled && state.turboSettings.councilOrder?.[0] === 'claude'
        ? 'Codex council review Relay'
        : 'Planner Relay'
    : 'Choose a Relay';
  elements.terminalList.setAttribute(
    'aria-label',
    directExecute
      ? 'Connected Codex and Claude sessions'
      : isExecuteCouncilEnabled()
        ? 'Codex review Relays and Execute-only Claude sessions'
        : 'Connected Codex terminals',
  );
  elements.launchCommand.textContent = isClaude
    ? state.connection?.claudeLaunchCommand || 'claude --dangerously-skip-permissions'
    : state.connection?.launchCommand || 'codex --dangerously-bypass-approvals-and-sandbox --cd . --remote ws://127.0.0.1:4769';
  elements.connectionHelpCopy.textContent = isClaude
    ? 'Starts Claude with all permission checks disabled. Use only in a project you fully trust.'
    : 'Starts Codex through Relay with approvals and sandboxing disabled. Use only in a project you fully trust.';
  const availableIds = new Set(selectableThreads.map((thread) => thread.id));
  const previouslySelectedThreadId = state.selectedThreadId;
  if (!availableIds.has(state.selectedThreadId)) {
    state.selectedThreadId = selectableThreads[0]?.id || null;
    const selectedThread = selectableThreads[0];
    const selectedThreadProvider = selectedThread ? threadProvider(selectedThread) : state.selectedProvider;
    if (directExecute && selectedThread && selectedThreadProvider !== state.selectedProvider) {
      state.selectedProvider = selectedThreadProvider;
      renderExecutionControls();
      loadModels(state.selectedProvider);
      renderProviderTabs();
      return renderThreads();
    }
  }
  if (state.selectedThreadId !== previouslySelectedThreadId) {
    renderExecutionControls();
  }
  renderTerminalCloseControl();
  refreshPlanTaskActions();

  if (visibleThreads.length === 0) {
    elements.terminalList.innerHTML = `
      <div class="terminal-empty">
        <span class="agent-icon ${isClaude ? 'agent-icon-claude' : 'agent-icon-codex'}" aria-hidden="true">${isClaude ? '✳' : '&gt;_'}</span>
        <div>
          <strong>${isClaude ? directClaudeEnabled ? 'No live Claude Code session' : 'Claude connection update is ready' : 'No Codex terminal connected'}${state.activeProjectPath ? ` in ${escapeHtml(workspaceName(state.activeProjectPath))}` : ''}</strong>
          <p>${isClaude ? directClaudeEnabled ? 'Open Claude in a project, then Relay will discover it automatically.' : 'Restart Relay after the running queue finishes to activate the new backend adapter.' : 'Open the connection instructions below. Relay will discover the terminal automatically.'}</p>
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
    refreshPlanTaskActions();
    return;
  }

  elements.terminalList.innerHTML = visibleThreads.map((thread) => {
    const provider = threadProvider(thread);
    const executeOnly = isExecuteCouncilEnabled() && provider === 'claude';
    const selected = !executeOnly && thread.id === state.selectedThreadId;
    const activity = relayActivity(thread);
    const displayState = executeOnly ? 'execute only' : activity.state;
    const preview = executeOnly
      ? 'Connected for Execute · Plan council uses the signed-in Claude CLI automatically'
      : provider === 'claude' && activity.state === 'idle'
        ? `${workspaceName(thread.cwd)} · ${activity.label}`
        : activity.label;
    return `
      <button
        class="terminal-option ${selected ? 'selected' : ''} ${executeOnly ? 'terminal-option-informational' : ''} ${relayColorClass(thread.id)}"
        type="button"
        role="radio"
        aria-checked="${selected}"
        ${executeOnly ? 'aria-disabled="true" disabled' : ''}
        data-thread-id="${escapeHtml(thread.id)}"
      >
        <span class="agent-icon ${provider === 'claude' ? 'agent-icon-claude' : 'agent-icon-codex'} terminal-agent-icon" aria-hidden="true">${provider === 'claude' ? '✳' : '&gt;_'}</span>
        <span class="terminal-state state-${escapeHtml(executeOnly ? 'idle' : activity.state)}">${escapeHtml(displayState)}</span>
        <span class="terminal-choice" aria-hidden="true"><span></span></span>
          <span class="terminal-copy">
            <span class="terminal-primary">
              <strong title="${escapeHtml(provider === 'claude' ? thread.title : `Relay ${relayNumber(thread)}`)}">${escapeHtml(provider === 'claude' ? thread.title : `Relay ${relayNumber(thread)}`)}</strong>
            </span>
            <span class="terminal-preview">${escapeHtml(preview)}</span>
            <span class="terminal-bottomline">
              <span class="terminal-meta" title="${escapeHtml(thread.cwd)}">${escapeHtml(workspaceName(thread.cwd))} · ${escapeHtml(thread.source)} · ${escapeHtml(thread.id.slice(0, 8))}</span>
            </span>
          </span>
      </button>
    `;
  }).join('');

  for (const option of elements.terminalList.querySelectorAll('.terminal-option')) {
    option.addEventListener('click', () => applyThreadSelection(option.dataset.threadId));
    option.addEventListener('dragover', (event) => {
      if (!canAssignTaskToThread(state.draggedTaskId, option.dataset.threadId) || threadProvider(state.threads.find((thread) => thread.id === option.dataset.threadId)) === 'claude') return;
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
      const options = [...elements.terminalList.querySelectorAll('.terminal-option:not(:disabled)')];
      const currentIndex = options.indexOf(option);
      const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
      const nextOption = options[(currentIndex + direction + options.length) % options.length];
      applyThreadSelection(nextOption.dataset.threadId);
      nextOption.focus();
    });
  }

  elements.threadInput.value = state.selectedThreadId;
  elements.sessionMessage.textContent = isExecuteCouncilEnabled()
    ? `${selectableThreads.length} live Codex Relay${selectableThreads.length === 1 ? '' : 's'} available for review. ${councilClaudeThreads.length} interactive Claude session${councilClaudeThreads.length === 1 ? '' : 's'} shown as Execute only; Plan council authors and revises through the signed-in Claude CLI automatically.`
    : state.taskMode === 'turbo'
      ? `${visibleThreads.length} live Codex terminals. Choose the ${state.turboSettings.councilEnabled && state.turboSettings.councilOrder?.[0] === 'claude' ? 'Codex reviewer' : 'planner'}; Relay uses other terminals in this workspace as workers.`
    : `${visibleThreads.length} live Relay session${visibleThreads.length === 1 ? '' : 's'}. Select one to choose its provider, model, and effort.`;
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
  if (state.selectedTaskForEvents) {
    renderTaskContinuation(state.selectedTaskForEvents);
  }
}

async function loadThreads({ silent = true } = {}) {
  const requestSequence = ++state.threadLoadSequence;
  if (!silent) {
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
  }
}

function selectedPlanReviewThread(task) {
  const thread = state.threads.find((item) => item.id === state.selectedThreadId) || null;
  return thread
    && threadProvider(thread) === 'codex'
    && sameProjectPath(thread.cwd, task.repo_path)
    ? thread
    : null;
}

function eligiblePlanExecutionThreads(task) {
  return state.threads.filter((thread) => (
    ['codex', 'claude'].includes(threadProvider(thread))
    && sameProjectPath(thread.cwd, task.repo_path)
  ));
}

function selectedPlanExecutionTarget(task) {
  const threads = eligiblePlanExecutionThreads(task);
  const renderedThreadId = elements.planExecutionRelay.dataset.taskId === String(task.id)
    ? elements.planExecutionRelay.value
    : '';
  const preferredThreadId = renderedThreadId
    || state.planExecutionTargets.get(task.id)
    || state.selectedThreadId;
  return threads.find((thread) => thread.id === preferredThreadId) || threads[0] || null;
}

function renderPlanExecutionOptions(task) {
  const threads = eligiblePlanExecutionThreads(task);
  const target = selectedPlanExecutionTarget(task);
  elements.planExecutionRelay.replaceChildren();
  if (threads.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No opened Relay in this workspace';
    elements.planExecutionRelay.append(option);
  } else {
    for (const thread of threads) {
      const option = document.createElement('option');
      option.value = thread.id;
      option.textContent = `${threadDisplayName(thread)} · ${providerLabel(threadProvider(thread))}`;
      elements.planExecutionRelay.append(option);
    }
  }
  elements.planExecutionRelay.dataset.taskId = String(task.id);
  elements.planExecutionRelay.value = target?.id || '';
  if (target) state.planExecutionTargets.set(task.id, target.id);
  return target;
}

function planExecutionIssue(task, target = selectedPlanExecutionTarget(task)) {
  if (state.status?.capabilities?.planExecution !== true) {
    return 'Restart Relay to enable reviewed-plan execution.';
  }
  if (!target) {
    return 'Open a Codex or Claude Relay in this workspace first.';
  }
  if (threadProvider(target) === 'claude' && !isClaudePlanReady()) {
    return claudePlanIssue();
  }
  return '';
}

function refreshPlanTaskActions(task = null) {
  const selectedTask = task
    || state.tasks.find((item) => item.id === state.selectedTaskId)
    || state.selectedTaskForEvents;
  if (!selectedTask || selectedTask.mode !== 'plan') return;
  const retryButton = elements.detailActions.querySelector('[data-plan-retry]');
  if (retryButton) {
    const retryTarget = selectedPlanReviewThread(selectedTask);
    retryButton.textContent = retryTarget ? `Resume on Relay ${relayNumber(retryTarget)}` : 'Resume council';
    const retryIssue = state.status?.capabilities?.planCouncilResume !== true
      ? 'Restart Relay to enable safe checkpoint resume.'
      : !isClaudePlanReady() ? claudePlanIssue() : '';
    retryButton.disabled = Boolean(retryIssue);
    retryButton.title = retryIssue;
  }
  if (!elements.planExecutionPanel.hidden && selectedTask.status === 'complete') {
    const target = renderPlanExecutionOptions(selectedTask);
    const issue = planExecutionIssue(selectedTask, target);
    elements.planExecutionRelay.disabled = eligiblePlanExecutionThreads(selectedTask).length === 0
      || state.planExecutionSubmitting;
    elements.planExecutionButton.textContent = state.planExecutionSubmitting
      ? 'Queuing plan'
      : target
        ? `Execute with ${providerLabel(threadProvider(target))} on ${threadDisplayName(target)}`
        : 'Execute plan';
    elements.planExecutionButton.disabled = Boolean(issue) || state.planExecutionSubmitting;
    elements.planExecutionButton.title = issue;
    elements.planExecutionMessage.textContent = issue || `Ready to queue on ${threadDisplayName(target)}. The local plan file stays ignored by Git.`;
    elements.planExecutionMessage.dataset.state = issue ? 'error' : 'ready';
  }
}

async function executeReviewedPlan(sourceTask) {
  if (state.planExecutionSubmitting) return;
  const issue = planExecutionIssue(sourceTask);
  const thread = selectedPlanExecutionTarget(sourceTask);
  if (issue || !thread) {
    window.alert(issue || 'Choose a connected Relay in this workspace.');
    return;
  }
  const provider = threadProvider(thread);
  const execution = executionSettingsForThread(state, provider, thread.id);
  state.planExecutionSubmitting = true;
  refreshPlanTaskActions(sourceTask);
  try {
    const body = await api(`/api/tasks/${sourceTask.id}/execute-plan`, {
      method: 'POST',
      body: JSON.stringify({
        threadId: thread.id,
        provider,
        model: execution.model,
        effort: execution.effort || null,
      }),
    });
    rememberThreadExecution(state, provider, thread.id, {
      model: body.task.model || execution.model,
      effort: body.task.effort || execution.effort,
    }, { source: 'task', taskId: body.task.id });
    state.taskView = 'queue';
    state.taskScope = 'workspace';
    state.selectedTaskId = body.task.id;
    state.parallelTaskIds.clear();
    localStorage.setItem('relay.taskView', state.taskView);
    await load();
  } catch (error) {
    window.alert(error.message);
  } finally {
    state.planExecutionSubmitting = false;
    refreshPlanTaskActions(sourceTask);
  }
}

async function taskAction(taskId, action, body = null) {
  try {
    await api(`/api/tasks/${taskId}/${action}`, {
      method: 'POST',
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    await load();
  } catch (error) {
    window.alert(error.message);
  }
}

async function submitTaskContinuation(event) {
  event.preventDefault();
  const sourceTask = state.selectedTaskForEvents;
  const prompt = elements.continuationInput.value.trim();
  if (!sourceTask || !prompt || state.continuationSubmitting || !taskContinuationSession(sourceTask)) return;
  let request;
  try {
    const attachments = state.continuationAttachments.get(sourceTask.id) || [];
    request = continuationSubmission(sourceTask, prompt, {
      supportsDirectFollowUp: state.status?.capabilities?.taskDirectFollowUp === true,
      supportsFollowUpAttachments: state.status?.capabilities?.taskFollowUpAttachments === true,
      supportsTaskSteering: state.status?.capabilities?.taskSteering === true,
      attachments: attachments.map((attachment) => ({
        name: attachment.name,
        mimeType: attachment.mimeType,
        data: attachment.data,
      })),
    });
  } catch (error) {
    elements.continuationMessage.dataset.kind = 'error';
    elements.continuationMessage.textContent = error.message;
    renderTaskContinuation(sourceTask);
    return;
  }
  state.continuationDrafts.set(sourceTask.id, elements.continuationInput.value);
  state.continuationSubmitting = true;
  elements.continuationMessage.dataset.kind = 'hint';
  renderTaskContinuation(sourceTask);
  try {
    const body = await api(request.path, {
      method: 'POST',
      body: JSON.stringify(request.body),
    });
    if (!body.steered && !body.followUpStarted) {
      throw new Error('Relay did not confirm a direct same-session follow-up. Your message was not queued.');
    }
    state.continuationDrafts.delete(sourceTask.id);
    state.continuationAttachments.delete(sourceTask.id);
    state.continuationSubmitting = false;
    if (state.selectedTaskForEvents?.id === sourceTask.id) {
      elements.continuationInput.value = '';
      elements.continuationAttachmentInput.value = '';
    }
    await load();
    if (state.selectedTaskForEvents?.id === sourceTask.id) {
      elements.continuationMessage.dataset.kind = 'success';
      elements.continuationMessage.textContent = body.steered
        ? 'Update delivered to the active turn.'
        : 'Follow-up started in this same terminal session. No queue task was created.';
    }
  } catch (error) {
    state.continuationSubmitting = false;
    elements.continuationMessage.dataset.kind = 'error';
    elements.continuationMessage.textContent = error.message;
    renderTaskContinuation(sourceTask);
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

function openTaskEditor(task) {
  if (state.status?.capabilities?.queuedTaskEditing !== true) {
    window.alert('Restart Relay to edit queued tasks.');
    return;
  }
  state.editingTaskId = task.id;
  state.taskEditSubmitting = false;
  elements.taskEditPrompt.value = task.prompt;
  elements.taskEditMessage.textContent = '';
  elements.taskEditSave.disabled = false;
  elements.taskEditCancel.disabled = false;
  elements.taskEditClose.disabled = false;
  elements.taskEditModal.showModal();
  requestAnimationFrame(() => elements.taskEditPrompt.focus());
}

function closeTaskEditor() {
  if (state.taskEditSubmitting) return;
  state.editingTaskId = null;
  elements.taskEditModal.close();
}

async function saveTaskEdit() {
  if (state.taskEditSubmitting || !state.editingTaskId) return;
  const prompt = elements.taskEditPrompt.value.trim();
  if (!prompt) {
    elements.taskEditMessage.textContent = 'Task prompt is required.';
    return;
  }
  state.taskEditSubmitting = true;
  elements.taskEditMessage.textContent = 'Saving changes.';
  elements.taskEditSave.disabled = true;
  elements.taskEditCancel.disabled = true;
  elements.taskEditClose.disabled = true;
  try {
    await api(`/api/tasks/${state.editingTaskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ prompt }),
    });
    state.editingTaskId = null;
    elements.taskEditModal.close();
    await load();
  } catch (error) {
    elements.taskEditMessage.textContent = error.message;
  } finally {
    state.taskEditSubmitting = false;
    elements.taskEditSave.disabled = false;
    elements.taskEditCancel.disabled = false;
    elements.taskEditClose.disabled = false;
  }
}

elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.submitting) {
    return;
  }
  elements.formMessage.textContent = '';
  let submissionMode;
  try {
    submissionMode = selectedWorkflowMode(elements.modeTabs);
  } catch (error) {
    elements.formMessage.textContent = error.message;
    return;
  }
  if (submissionMode !== state.taskMode) {
    elements.formMessage.textContent = 'Workflow selection changed unexpectedly. Select the workflow again before adding the task.';
    return;
  }
  if (submissionMode === 'execute' && elements.planCouncilEnabled.checked !== state.planSettings.enabled) {
    elements.formMessage.textContent = 'Plan council selection changed unexpectedly. Choose it again before adding the task.';
    return;
  }
  const councilRequested = submissionMode === 'execute' && state.planSettings.enabled;
  let submissionProvider = state.selectedProvider;
  if (submissionMode === 'execute') {
    try {
      submissionProvider = selectedExecutionProvider(elements.providerTabs);
    } catch (error) {
      elements.formMessage.textContent = error.message;
      return;
    }
    if (submissionProvider !== state.selectedProvider) {
      elements.formMessage.textContent = 'Provider selection changed unexpectedly. Select Codex or Claude again before adding the task.';
      return;
    }
    if (councilRequested && submissionProvider !== 'codex') {
      elements.formMessage.textContent = 'Plan council needs a connected Codex review terminal.';
      return;
    }
  }
  const formData = new FormData(elements.form);
  const execution = {
    model: elements.modelSelect.value,
    effort: JSON.parse(elements.effortSelect.dataset.values || '[]')[Number(elements.effortSelect.value)] || '',
  };
  if (submissionMode === 'execute' && !councilRequested) {
    updateSelectedExecution(execution);
  }
  const runNow = state.prioritySubmit;
  state.prioritySubmit = false;
  const attachments = state.attachments.map((attachment) => ({
    name: attachment.name,
    mimeType: attachment.mimeType,
    data: attachment.data,
  }));
  const submissionSignature = JSON.stringify({
    submissionMode,
    councilRequested,
    submissionProvider,
    selectedThreadId: state.selectedThreadId,
    prompt: formData.get('prompt'),
    execution,
    planSettings: state.planSettings,
    turboSettings: state.turboSettings,
    attachments: state.attachments.map(({ id, name, mimeType, size }) => ({ id, name, mimeType, size })),
    runNow,
  });
  const submissionId = state.pendingSubmission?.signature === submissionSignature
    ? state.pendingSubmission.id
    : window.crypto.randomUUID();
  state.pendingSubmission = { id: submissionId, signature: submissionSignature };
  state.submitting = true;
  updateSubmitState();
  try {
    const routedThreadId = await settleIdleSubmissionThread({ runNow });
    if (!routedThreadId) {
      elements.formMessage.textContent = 'Choose a connected AI session first.';
      return;
    }

    if (councilRequested && !isClaudePlanReady()) {
      elements.formMessage.textContent = claudePlanIssue();
      return;
    }

    if (submissionMode === 'turbo') {
      const councilIssue = turboCouncilIssue();
      if (councilIssue) {
        elements.formMessage.textContent = councilIssue;
        return;
      }
    }

    if (submissionMode === 'execute' && !councilRequested) {
      rememberThreadExecution(state, submissionProvider, routedThreadId, execution);
    }
    const requestBody = councilRequested
      ? {
        mode: 'plan',
        councilEnabled: true,
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
      : submissionMode === 'turbo'
        ? {
          mode: 'turbo',
          threadId: routedThreadId,
          prompt: formData.get('prompt'),
          plannerModel: state.turboSettings.plannerModel,
          plannerEffort: state.turboSettings.plannerEffort || null,
          workerModel: state.turboSettings.workerModel,
          workerEffort: state.turboSettings.workerEffort || null,
          workerCount: state.turboSettings.workerCount,
          ...turboCouncilRequest(state.turboSettings, turboCouncilCatalogs()),
          attachments,
          runNow,
        }
        : {
        mode: 'execute',
        provider: submissionProvider,
        threadId: routedThreadId,
        prompt: formData.get('prompt'),
        model: execution.model,
        effort: execution.effort || null,
        attachments,
        runNow,
      };
    requestBody.submissionId = submissionId;
    const body = await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    });
    if (submissionMode === 'execute' && !councilRequested) {
      const acceptedThreadId = body.task.thread_id || routedThreadId;
      rememberThreadExecution(state, body.task.provider || submissionProvider, acceptedThreadId, {
        model: body.task.model || execution.model,
        effort: body.task.effort || execution.effort,
      }, { source: 'task', taskId: body.task.id });
      if (state.selectedThreadId === acceptedThreadId) {
        renderExecutionControls();
      }
    }
    state.taskView = 'queue';
    state.taskScope = 'workspace';
    state.selectedTaskId = body.task.id;
    state.pendingSubmission = null;
    state.parallelTaskIds.clear();
    localStorage.setItem('relay.taskView', state.taskView);
    elements.prompt.value = '';
    if (councilRequested) {
      state.planSettings.enabled = false;
      renderPlanControls();
      renderExecutionControls();
      renderPromptCopy();
    }
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
  if (!state.activeProjectPath) {
    window.alert('Select a project before pausing its queue.');
    return;
  }
  const action = isActiveProjectPaused() ? 'resume' : 'pause';
  try {
    await api(`/api/queue/${action}`, {
      method: 'POST',
      body: JSON.stringify({ projectPath: state.activeProjectPath }),
    });
    await load();
  } catch (error) {
    window.alert(error.message);
  }
});

for (const button of elements.taskViewButtons) {
  button.addEventListener('click', () => {
    state.taskView = button.dataset.taskView;
    localStorage.setItem('relay.taskView', state.taskView);
    state.parallelTaskIds.clear();
    renderStatus();
    renderTasks();
  });
}
for (const button of elements.historyPeriodButtons) {
  button.addEventListener('click', () => {
    state.historyPeriod = button.dataset.historyPeriod;
    state.historyAnchor = new Date();
    localStorage.setItem('relay.historyPeriod', state.historyPeriod);
    renderStatus();
    renderTasks();
  });
}
elements.historyPrevious.addEventListener('click', () => {
  state.historyAnchor = shiftPeriod(state.historyPeriod, state.historyAnchor, -1);
  renderStatus();
  renderTasks();
});
elements.historyToday.addEventListener('click', () => {
  state.historyAnchor = new Date();
  renderStatus();
  renderTasks();
});
elements.historyNext.addEventListener('click', () => {
  state.historyAnchor = shiftPeriod(state.historyPeriod, state.historyAnchor, 1);
  renderStatus();
  renderTasks();
});
elements.taskScopeButton.addEventListener('click', () => {
  const scopes = state.selectedThreadId
    ? ['relay', 'workspace']
    : ['workspace'];
  state.taskScope = scopes[(scopes.indexOf(state.taskScope) + 1) % scopes.length];
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

function applyTerminalHeight({ persist = false } = {}) {
  if (!state.terminalHeight || !elements.taskDetail.clientHeight) {
    elements.taskDetail.style.removeProperty('--event-terminal-height');
    return;
  }
  const maximum = Math.max(180, elements.taskDetail.clientHeight - 150);
  state.terminalHeight = Math.min(maximum, Math.max(180, state.terminalHeight));
  elements.taskDetail.style.setProperty('--event-terminal-height', `${state.terminalHeight}px`);
  elements.terminalHeightResizer.setAttribute('aria-valuenow', String(Math.round(state.terminalHeight)));
  elements.terminalHeightResizer.setAttribute('aria-valuemin', '180');
  elements.terminalHeightResizer.setAttribute('aria-valuemax', String(Math.round(maximum)));
  elements.terminalHeightResizer.setAttribute('aria-valuetext', `Terminal ${Math.round(state.terminalHeight)} pixels high`);
  if (persist) localStorage.setItem('relay.terminalHeight', String(Math.round(state.terminalHeight)));
}

elements.terminalHeightResizer.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  elements.terminalHeightResizer.setPointerCapture(event.pointerId);
  document.body.dataset.resizingTerminal = 'true';
  const move = (moveEvent) => {
    const bounds = elements.taskDetail.getBoundingClientRect();
    state.terminalHeight = bounds.bottom - moveEvent.clientY;
    applyTerminalHeight();
  };
  const finish = () => {
    elements.terminalHeightResizer.removeEventListener('pointermove', move);
    elements.terminalHeightResizer.removeEventListener('pointerup', finish);
    elements.terminalHeightResizer.removeEventListener('pointercancel', finish);
    delete document.body.dataset.resizingTerminal;
    applyTerminalHeight({ persist: true });
  };
  elements.terminalHeightResizer.addEventListener('pointermove', move);
  elements.terminalHeightResizer.addEventListener('pointerup', finish);
  elements.terminalHeightResizer.addEventListener('pointercancel', finish);
});

elements.terminalHeightResizer.addEventListener('keydown', (event) => {
  if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  state.terminalHeight = (state.terminalHeight || elements.taskDetail.clientHeight / 2) + (event.key === 'ArrowUp' ? 20 : -20);
  applyTerminalHeight({ persist: true });
});

applyTerminalHeight();
window.addEventListener('resize', () => applyTerminalHeight());
elements.parallelClearButton.addEventListener('click', () => {
  state.parallelTaskIds.clear();
  renderTasks();
});
elements.parallelRunButton.addEventListener('click', runParallelBatch);
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
      state.projectComposerStore.delete(project.path);
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
  updateSelectedExecution({ model: elements.modelSelect.value, effort: '' });
  renderExecutionControls();
});
elements.effortSelect.addEventListener('input', () => {
  const values = JSON.parse(elements.effortSelect.dataset.values || '[]');
  updateSelectedExecution({ effort: values[Number(elements.effortSelect.value)] || '' });
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
elements.turboCouncilEnabled.addEventListener('change', () => {
  state.turboSettings.councilEnabled = elements.turboCouncilEnabled.checked;
  renderThreads();
});
for (const button of elements.turboCouncilOrderButtons) {
  button.addEventListener('click', () => {
    state.turboSettings.councilOrder = button.dataset.councilFirst === 'claude'
      ? ['claude', 'codex']
      : ['codex', 'claude'];
    renderThreads();
  });
}
elements.turboCouncilReviewerModel.addEventListener('input', () => {
  state.turboSettings.councilClaudeModel = elements.turboCouncilReviewerModel.value;
  state.turboSettings.councilClaudeEffort = 'high';
  renderTurboControls();
  updateSubmitState();
});
elements.turboCouncilReviewerEffort.addEventListener('change', () => {
  state.turboSettings.councilClaudeEffort = elements.turboCouncilReviewerEffort.value;
  renderTurboControls();
  updateSubmitState();
});
function setTurboCouncilHelp(open) {
  elements.turboCouncilHelp.hidden = !open;
  elements.turboCouncilHelpButton.setAttribute('aria-expanded', String(open));
}
elements.turboCouncilHelpButton.addEventListener('click', () => {
  setTurboCouncilHelp(elements.turboCouncilHelp.hidden);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements.turboCouncilHelp.hidden) {
    setTurboCouncilHelp(false);
    elements.turboCouncilHelpButton.focus();
  }
});
document.addEventListener('click', (event) => {
  if (!elements.turboCouncilHelp.hidden && !event.target?.closest?.('.turbo-council-toggle-row')) {
    setTurboCouncilHelp(false);
  }
});
elements.prompt.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
    return;
  }
  event.preventDefault();
  if (elements.submitButton.disabled) {
    elements.formMessage.textContent = isExecuteCouncilEnabled()
      ? !isClaudePlanReady()
        ? claudePlanIssue()
        : 'Choose a connected Codex review terminal before sending.'
      : state.taskMode === 'turbo'
        ? turboCouncilIssue() || `Turbo needs one planner and ${state.turboSettings.workerCount} worker terminals connected in this workspace.`
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
elements.planCouncilEnabled.addEventListener('change', () => {
  state.planSettings.enabled = elements.planCouncilEnabled.checked;
  if (state.planSettings.enabled && state.selectedProvider !== 'codex') {
    state.selectedProvider = 'codex';
    state.selectedThreadId = null;
    loadModels('codex');
  }
  elements.formMessage.textContent = state.planSettings.enabled
    ? 'Plan council enabled for this prompt.'
    : 'Plan council is off.';
  renderProviderTabs();
  renderExecutionControls();
  renderPlanControls();
  renderPromptCopy();
  renderAttachmentComposer();
  renderThreads();
});
elements.planExecutionRelay.addEventListener('change', () => {
  const task = state.tasks.find((item) => item.id === state.selectedTaskId)
    || state.selectedTaskForEvents;
  if (!task || task.mode !== 'plan') return;
  state.planExecutionTargets.set(task.id, elements.planExecutionRelay.value);
  refreshPlanTaskActions(task);
});
elements.planExecutionButton.addEventListener('click', () => {
  const task = state.tasks.find((item) => item.id === state.selectedTaskId)
    || state.selectedTaskForEvents;
  if (task?.mode === 'plan') executeReviewedPlan(task);
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
elements.terminalSettingsButton.addEventListener('click', () => {
  elements.terminalSettingsModal.showModal();
});
elements.terminalSettingsClose.addEventListener('click', () => {
  elements.terminalSettingsModal.close();
});
elements.terminalSettingsModal.addEventListener('click', (event) => {
  if (event.target === elements.terminalSettingsModal) elements.terminalSettingsModal.close();
});
elements.taskEditClose.addEventListener('click', closeTaskEditor);
elements.taskEditCancel.addEventListener('click', closeTaskEditor);
elements.taskEditSave.addEventListener('click', saveTaskEdit);
elements.taskEditModal.addEventListener('cancel', (event) => {
  if (state.taskEditSubmitting) event.preventDefault();
  else state.editingTaskId = null;
});
elements.taskEditModal.addEventListener('click', (event) => {
  if (event.target === elements.taskEditModal) closeTaskEditor();
});
elements.taskEditPrompt.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    saveTaskEdit();
  }
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
async function launchTerminalProvider(provider, button) {
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
    await chooseProject(true, provider);
    return;
  }
  button.disabled = true;
  try {
    await launchProject(project, provider);
  } catch (error) {
    elements.formMessage.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

elements.launchCodexButton.addEventListener('click', () => launchTerminalProvider('codex', elements.launchCodexButton));
elements.launchClaudeButton.addEventListener('click', () => launchTerminalProvider('claude', elements.launchClaudeButton));
elements.closeTerminalButton.addEventListener('click', closeSelectedTerminal);

elements.headerRunningTasks.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-running-task-id]');
  if (!button) return;
  const taskId = Number(button.dataset.runningTaskId);
  const task = state.runningTasks.find((item) => item.id === taskId)
    || state.tasks.find((item) => item.id === taskId);
  if (!task) return;

  const project = state.projects.find((item) => sameProjectPath(item.path, task.repo_path));
  if (project) {
    selectProject(project.path);
  }
  state.taskView = 'queue';
  state.taskScope = 'workspace';
  localStorage.setItem('relay.taskView', state.taskView);
  renderTaskScope();
  renderStatus();
  renderTasks();
  try {
    await selectTask(taskId);
  } catch (error) {
    elements.queueSummary.textContent = error.message;
  }
});

for (const control of [
  elements.terminalLayoutEnabled,
  elements.terminalLayoutColumns,
  elements.terminalLayoutRows,
  elements.terminalLayoutDisplay,
  elements.terminalLaunchBackground,
]) {
  control.addEventListener('change', saveTerminalLayout);
}

for (const button of elements.eventFilters) {
  button.addEventListener('click', () => {
    state.eventFilter = button.dataset.eventFilter;
    renderEventStream(state.selectedTaskEvents, state.selectedTaskForEvents);
  });
}

elements.continuationForm.addEventListener('submit', submitTaskContinuation);
elements.continuationAttachmentInput.addEventListener('change', async () => {
  await addContinuationImageFiles(elements.continuationAttachmentInput.files);
  elements.continuationAttachmentInput.value = '';
});
elements.continuationClearImages.addEventListener('click', () => {
  const task = state.selectedTaskForEvents;
  if (!task) return;
  state.continuationAttachments.delete(task.id);
  elements.continuationAttachmentInput.value = '';
  elements.continuationMessage.dataset.kind = 'hint';
  renderTaskContinuation(task);
});
elements.continuationForm.addEventListener('paste', async (event) => {
  const imageFiles = clipboardImageFiles(event.clipboardData);
  if (imageFiles.length === 0) return;
  event.preventDefault();
  await addContinuationImageFiles(imageFiles);
});
elements.continuationInput.addEventListener('input', () => {
  const task = state.selectedTaskForEvents;
  if (!task) return;
  state.continuationDrafts.set(task.id, elements.continuationInput.value);
  elements.continuationMessage.dataset.kind = 'hint';
  renderTaskContinuation(task);
});
elements.continuationInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  if (!elements.continuationSend.disabled) {
    elements.continuationForm.requestSubmit();
  }
});

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

for (const button of elements.contentCopyButtons) {
  button.addEventListener('click', () => copyDetailContent(button));
}

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
Promise.all([load(), loadThreads({ silent: false }), loadModels('codex'), loadModels('claude'), loadTerminalDisplays()]).catch((error) => {
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
