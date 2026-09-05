import { EmbeddedTerminalView } from './embedded-terminal.js';
import {
  assistantMessageStatus,
  entryFirstEvent,
  entryItem,
  entryLastEvent,
  eventEntryCategory,
  eventMessageCounts,
  eventEntryRepeatCount,
  filterEventEntries,
  goalEntryDetails,
  groupEventEntries,
  eventStreamStats,
  isGoalEntry,
  isPlanEntry,
  isPlanToolItem,
  isReasoningEntry,
  isSubAgentEntry,
  mergePromptMessages,
  planEntryDetails,
  subAgentEntryDetails,
  subAgentEntryState,
} from './event-stream.js';
import {
  formatElapsedDuration,
  formatTaskDuration,
  taskDurationLabel,
  taskLifecycleDates,
} from './task-time.js';
import {
  compactTokenCount,
  dailyTokenUsagePresentation,
  taskTokenPresentation,
} from './task-conversation-metrics.js';
import { runningTaskRailGroups } from './running-task-layout.js';
import {
  refreshActivityOverviewDurations,
  taskActivityOverview,
} from './task-activity-overview.js';
import { clipboardImageFiles } from './clipboard-images.js';
import {
  PROJECT_COLOR_COUNT,
  PROJECT_COLOR_PRESETS,
  normalizeProjectColor,
  projectColorClass,
  projectColorClasses,
  projectColorTokens,
} from './project-colors.js';
import {
  buildProjectReorderRequest,
  dropProjectInOrder,
  moveProjectInOrder,
  projectOrderIds,
} from './project-reorder.js';
import { ProjectCompletionNotifications } from './project-completion-notifications.js';
import {
  CompletionAlerts,
  completionSpeechText,
  normalizeCompletionAlertPreferences,
} from './completion-alerts.js';
import {
  discoverVoiceInputDevices,
  normalizeVoiceInputPreferences,
  PushToTalkRecorder,
  voiceRecordingLooksSilent,
  voiceSignalDetected,
  voiceShortcutFromKeyboardEvent,
  voiceShortcutKeyLabels,
  voiceShortcutLabel,
  voiceShortcutMatches,
  voiceShortcutReleased,
} from './voice-input.js';
import {
  DEFAULT_QUICK_SKILLS,
  MAX_QUICK_SKILLS,
  MAX_QUICK_SKILL_LABEL_LENGTH,
  MAX_QUICK_SKILL_PROMPT_LENGTH,
  normalizeQuickSkills,
  QUICK_SKILL_ID_PATTERN,
  quickSkillById,
} from './quick-skills.js';
import { parallelClaudeRestartRequired, projectQueueRestartRequired } from './project-queue-state.js';
import { terminalClosePresentation } from './terminal-close-state.js';
import {
  normalizeClaudeModelSelection,
  supportedClaudeModelCatalog,
} from './claude-model-selection.js';
import { idleExecutionThreadId, runningDirectTask, selectedExecutionProvider, selectedWorkflowMode } from './task-routing.js';
import { activityBuckets, isFinishedTaskStatus, periodRange, prioritizeStarredTasks, shiftPeriod, sortOperationalTasks, taskHistoryStats, tasksForScope, tasksInPeriod } from './task-history.js';
import {
  TASK_SEARCH_DEBOUNCE_MS,
  taskSearchActive,
  taskSearchMatchMarkup,
  tasksForSearchResults,
} from './task-search.js';
import {
  dateFromLocalInput,
  emptyStandupSections,
  localDateInputValue,
  STANDUP_CHANGELOG_SECTIONS,
  standupCopyHtml,
  standupCopyText,
  standupDateRange,
  standupSections,
  tasksForStandupDays,
} from './standup-summary.js';
import { resolveSubmissionId, submissionIntentSignature } from './submission-intent.js';
import {
  buildQueueReorderRequest,
  createQueueSnapshot,
  dropVisibleTask,
  moveVisibleTask,
  queuedTaskIds,
} from './queue-reorder.js';
import { turboPlanMarker, turboWaitingCopy } from './turbo-state.js';
import { turboControlsSignature } from './turbo-controls-signature.js';
import { setControlDisabled, setControlValue, setSelectOptions } from './stable-select.js';
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
  normalizePlanCouncilSettings,
  planCouncilRequest,
} from './plan-council-state.js';
import {
  executionSettingsForThread,
  freshProjectComposerState,
  hydrateThreadExecutionSettings,
  normalizeProjectTerminalSettings,
  ProjectComposerStore,
  providerEligibleForComposer,
  rememberThreadExecution,
} from './project-composer-state.js';
import {
  ContinuationAttachmentDrafts,
  continuationDispatchOutcome,
  continuationPresentation,
  continuationRetryRestore,
  continuationSubmission,
  draftInputValue,
  unconfirmedDraft,
} from './task-continuation-state.js';
import {
  normalizeTaskPrompts,
  taskPromptCopyText,
  taskPromptHistoryPreview,
  taskPromptHistoryText,
} from './task-prompt-history.js';
import {
  createTaskReference,
  taskReferenceCounts,
  taskReferencePrompt,
  taskReferencePromptIssue,
  taskReferenceScopeLabel,
  updateTaskReferenceScope,
} from './task-references.js';
import {
  buildSessionTurns,
  sessionConversationText,
  sessionHistoryCountLabel,
  sessionStateLabel,
} from './task-session-history.js';
import { escapeHtml } from './escape-html.js';
import {
  buildFileTree,
  diffNoticeTexts,
  diffPlaceholderMarkup,
  diffTotalsText,
  diffUnavailableText,
  isLiveTaskStatus,
  renderDiffNotices,
  renderDiffUnavailable,
  renderFileDiff,
  renderFileTree,
} from './task-diff-view.js';
import { markdownPreviewText, renderMarkdown } from './markdown.js';
import {
  availableProviderSelection,
  providerInstallationState,
} from './provider-availability.js';
import { combinedWeeklyUsagePresentation, providerUsagePresentation } from './provider-usage.js';
import { tokenThroughput, tokenThroughputFromSnapshot } from './token-throughput.js';
import { createTextSelectionGuard } from './text-selection-guard.js';
import { defaultEffortForModel } from './model-effort.js';
import { desktopUpdatePresentation } from './desktop-update-state.js';
import {
  breakdownIsActive,
  breakdownStatusPresentation,
  canQueueProposals,
  moveProposal,
  plannerCapable,
  pruneSelection,
  removeProposal,
  selectedProposals,
  updateProposalField,
} from './planner-state.js';
import {
  activeWaveIndex,
  addProposal,
  blockedReasonLabel,
  breakdownNoteLabel,
  canRunPlan,
  computeWaves,
  defaultRunSelection,
  dependencyIds,
  dependencyLabel,
  dependsOnTransitively,
  planRunIsActive,
  plannerBoardSignature,
  plannerV2Capable,
  proposalStatus,
  pruneDanglingDependencies,
  runAnnouncement,
  runProgressSummary,
  runnableSelection,
  runStartBlockReason,
  runStatusPresentation,
  runStepFor,
  shouldAdoptServerProposals,
  stepEditingLocked,
  stepStatusPresentation,
  toggleDependency,
} from './planner-board.js';

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
// Six compact preview slots fit the queue's 300px minimum width.
const TASK_CARD_ATTACHMENT_SLOT_LIMIT = 6;

/*
 * A project accepts at most MAX_PROJECT_INSTANCES per provider (validateInstanceLimit in
 * src/server.mjs). Automatic Turbo keeps one planning lane plus the configured number of
 * concurrent execution lanes available. Eight concurrent executions would therefore need
 * nine Codex slots, which no project can be configured to allow. Automatic pools cap the
 * pipeline one below the project ceiling. Legacy live-terminal Turbo still allows eight
 * because its workers are terminals the user opened, not managed slots.
 */
const MAX_PROJECT_INSTANCES = 8;
const MAX_TURBO_WORKERS = 8;
const MAX_POOL_TURBO_WORKERS = MAX_PROJECT_INSTANCES - 1;
const MAX_STANDUP_CUSTOM_PROMPT_LENGTH = 4_000;
const MAX_STANDUP_FOLLOW_UP_LENGTH = 4_000;

const API_TIMEOUT_MS = 20_000;
const SNAPSHOT_FALLBACK_POLL_MS = 15_000;
const RUNNING_TASK_LAYOUT_DEFAULTS = Object.freeze({ rows: 2, width: 286 });
const RUNNING_TASK_ROW_OPTIONS = new Set([1, 2, 3]);
const RUNNING_TASK_WIDTH_OPTIONS = new Set([230, 286, 360]);
// Task creation carries image data, so it gets a wider budget than a status read.
const TASK_SUBMIT_TIMEOUT_MS = 45_000;
const textSelectionGuard = createTextSelectionGuard({
  documentObject: document,
  windowObject: window,
});

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
    catalogModel('gpt-6-astra', 'GPT-6 Astra', 'Most capable model for complex reasoning and end-to-end work.', { defaultEffort: 'high', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }),
    catalogModel('gpt-5.6-sol', 'GPT-5.6-Sol', 'Detail and polish for complex, open-ended work.', { isDefault: true, defaultEffort: 'high', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] }),
    catalogModel('gpt-5.6-terra', 'GPT-5.6-Terra', 'Fast everyday model for exploration and implementation.', { defaultEffort: 'high', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] }),
    catalogModel('gpt-5.6-luna', 'GPT-5.6-Luna', 'Clear and repeatable work with predictable output.', { defaultEffort: 'high', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }),
    catalogModel('gpt-5.5', 'GPT-5.5', 'Previous-generation general coding model.', { defaultEffort: 'high', efforts: ['low', 'medium', 'high', 'xhigh'] }),
    catalogModel('gpt-5.4', 'GPT-5.4', 'Strong coding and tool use for pinned workflows.', { defaultEffort: 'high', efforts: ['low', 'medium', 'high', 'xhigh'] }),
    catalogModel('gpt-5.4-mini', 'GPT-5.4-Mini', 'Smaller model for quick, narrow tasks.', { defaultEffort: 'high', efforts: ['low', 'medium', 'high', 'xhigh'] }),
    catalogModel('gpt-5.3-codex-spark', 'GPT-5.3-Codex-Spark', 'Near-instant text-only iteration when available.', { defaultEffort: 'high', efforts: ['low', 'medium', 'high', 'xhigh'] }),
  ],
  claude: [
    catalogModel('default', 'Account default', 'Use the recommended Claude model for this account.', { isDefault: true, defaultEffort: 'high', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }),
    catalogModel('opus', 'Opus', 'Latest Opus model for complex reasoning and implementation.', { defaultEffort: 'high', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }),
    catalogModel('fable', 'Fable', 'Fable 5 for the hardest and longest-running tasks.', { defaultEffort: 'high', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }),
    catalogModel('sonnet', 'Sonnet', 'Latest Sonnet model for daily coding work.', { defaultEffort: 'high', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }),
    catalogModel('haiku', 'Haiku', 'Fast Claude model for simple and narrow tasks.'),
  ],
  opencode: [
    catalogModel('default', 'Configured default', 'Use the default model configured by OpenCode.', { isDefault: true }),
  ],
};

const initialComposerState = freshProjectComposerState();

function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function renderThemeToggle() {
  const toggle = document.querySelector('#theme-toggle');
  const label = document.querySelector('#theme-toggle-label');
  if (!toggle || !label) return;
  const nextTheme = currentTheme() === 'dark' ? 'light' : 'dark';
  const nextLabel = nextTheme === 'dark' ? 'dark' : 'light';
  toggle.setAttribute('aria-label', `Use ${nextLabel} mode`);
  toggle.title = `Use ${nextLabel} mode`;
  toggle.setAttribute('aria-pressed', String(currentTheme() === 'dark'));
  label.textContent = nextTheme === 'dark' ? 'Dark' : 'Light';
}

function setTheme(theme, { persist = true } = {}) {
  const nextTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.style.colorScheme = nextTheme;
  if (persist) localStorage.setItem('relay.theme', nextTheme);
  renderThemeToggle();
}

setTheme(currentTheme(), { persist: false });

function currentHeaderPosition() {
  return document.documentElement.dataset.headerPosition === 'bottom' ? 'bottom' : 'top';
}

function renderHeaderPositionToggle() {
  const toggle = document.querySelector('#header-position-toggle');
  const icon = document.querySelector('#header-position-icon');
  const label = document.querySelector('#header-position-label');
  if (!toggle || !icon || !label) return;
  const isBottom = currentHeaderPosition() === 'bottom';
  const nextPosition = isBottom ? 'top' : 'bottom';
  toggle.setAttribute('aria-label', `Move monitor bar to ${nextPosition}`);
  toggle.title = `Move monitor bar to ${nextPosition}`;
  toggle.setAttribute('aria-pressed', String(isBottom));
  icon.textContent = isBottom ? '↑' : '↓';
  label.textContent = isBottom ? 'Top' : 'Bottom';
}

function syncHeaderHeight() {
  const header = document.querySelector('.app-header');
  if (!header) return;
  document.documentElement.style.setProperty(
    '--app-header-height',
    `${Math.ceil(header.getBoundingClientRect().height)}px`,
  );
}

function setHeaderPosition(position, { persist = true } = {}) {
  const nextPosition = position === 'bottom' ? 'bottom' : 'top';
  document.documentElement.dataset.headerPosition = nextPosition;
  if (persist) {
    localStorage.setItem('relay.headerPosition', nextPosition);
    queueUiPreferencesSave();
  }
  renderHeaderPositionToggle();
  requestAnimationFrame(syncHeaderHeight);
}

setHeaderPosition(currentHeaderPosition(), { persist: false });

function cachedCompletionAlertPreferences() {
  let speech = {};
  try {
    speech = JSON.parse(localStorage.getItem('relay.completionSpeechOptions') || '{}');
  } catch {}
  return normalizeCompletionAlertPreferences({
    sound: localStorage.getItem('relay.completionSound'),
    speak: localStorage.getItem('relay.completionSpeech') === 'true',
    speech,
  });
}

function cachedVoiceInputPreferences() {
  return normalizeVoiceInputPreferences({
    enabled: localStorage.getItem('relay.voiceInputEnabled') === 'true',
    shortcut: localStorage.getItem('relay.voiceInputShortcut'),
    alternateShortcut: localStorage.getItem('relay.voiceInputAlternateShortcut'),
    microphoneLabel: localStorage.getItem('relay.voiceInputMicrophoneLabel'),
  });
}

/*
 * First paint only. The server record stays authoritative: restoreUiPreferences overwrites
 * this the moment it answers, and a missing quickSkills member there means defaults, not
 * whatever this cache happens to hold.
 */
function cachedQuickSkills() {
  try {
    const saved = localStorage.getItem('relay.quickSkills');
    return normalizeQuickSkills(saved === null ? null : JSON.parse(saved));
  } catch {
    return normalizeQuickSkills(null);
  }
}

function normalizeRunningTaskLayout(value) {
  const rows = Number(value?.rows);
  const width = Number(value?.width);
  return {
    rows: RUNNING_TASK_ROW_OPTIONS.has(rows) ? rows : RUNNING_TASK_LAYOUT_DEFAULTS.rows,
    width: RUNNING_TASK_WIDTH_OPTIONS.has(width) ? width : RUNNING_TASK_LAYOUT_DEFAULTS.width,
  };
}

function cachedRunningTaskLayout() {
  try {
    return normalizeRunningTaskLayout(JSON.parse(localStorage.getItem('relay.runningTaskLayout') || '{}'));
  } catch {
    return { ...RUNNING_TASK_LAYOUT_DEFAULTS };
  }
}

/*
 * The Terminal window remembers the view the operator last read, app wide and across
 * restarts. The shared ui-layout-preferences record stays authoritative because the
 * desktop app gets a new port, and therefore a new localStorage origin, on every launch.
 * The cache below only speeds up first paint.
 */
const TERMINAL_WINDOW_VIEWS = ['all', 'activity', 'conversation', 'mine', 'ai'];
const TERMINAL_WINDOW_VIEW_DEFAULT = 'all';

function normalizeTerminalWindowView(value) {
  return TERMINAL_WINDOW_VIEWS.includes(value) ? value : TERMINAL_WINDOW_VIEW_DEFAULT;
}

const state = {
  tasks: [],
  runningTasks: [],
  projects: [],
  activeProjectPath: localStorage.getItem('relay.activeProjectPath') || null,
  projectConfigLoaded: false,
  activeProjectSaveSequence: 0,
  projectReorderPending: false,
  projectDrag: null,
  projectDragClickSuppressed: false,
  taskView: localStorage.getItem('relay.taskView') === 'history' ? 'history' : 'queue',
  historyPeriod: ['day', 'week', 'month'].includes(localStorage.getItem('relay.historyPeriod'))
    ? localStorage.getItem('relay.historyPeriod') : 'week',
  terminalWindowView: normalizeTerminalWindowView(localStorage.getItem('relay.terminalWindowView')),
  terminalMode: localStorage.getItem('relay.terminalMode') === 'activity' ? 'activity' : 'native',
  historyAnchor: new Date(),
  taskSearchQuery: '',
  taskSearchResults: [],
  taskSearchTotal: 0,
  taskSearchPending: false,
  taskSearchError: '',
  taskSearchTimer: null,
  taskSearchSequence: 0,
  standupDate: '',
  standupDays: 1,
  standupChanges: emptyStandupSections(),
  standupClipboardText: '',
  standupTaskCount: 0,
  standupExecutionCount: 0,
  standupIncludedTaskCount: 0,
  standupProvider: null,
  standupCustomPromptApplied: false,
  standupGenerating: false,
  standupError: '',
  standupRequestSequence: 0,
  standupCopyTimer: null,
  standupPromptSaving: false,
  standupPromptEdited: false,
  standupPromptStatus: '',
  standupFollowUps: [],
  standupFollowUpPending: false,
  standupFollowUpError: '',
  standupFollowUpRequestSequence: 0,
  panelWidths: (() => {
    try {
      const saved = JSON.parse(localStorage.getItem('relay.panelWidths') || '{}');
      return {
        composer: Number.isFinite(saved.composer) ? saved.composer : 420,
        queue: Number.isFinite(saved.queue) ? saved.queue : null,
        legacyDetail: Number.isFinite(saved.detail) ? saved.detail : null,
      };
    } catch {
      return { composer: 420, queue: null, legacyDetail: null };
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
  projectCompletionNotifications: new ProjectCompletionNotifications(localStorage),
  completionAlerts: new CompletionAlerts(),
  completionAlertPreferences: cachedCompletionAlertPreferences(),
  voiceInputPreferences: cachedVoiceInputPreferences(),
  quickSkills: cachedQuickSkills(),
  // Last folded token of the strip markup inputs. null forces the first render to build.
  quickSkillStripSignature: null,
  // Set when a preferences PATCH was refused, so the editor can say the record is not saved.
  uiPreferencesSaveError: '',
  voiceInputEngine: { state: 'checking', installed: false },
  voiceInputActivity: 'idle',
  voiceInputMessage: '',
  voiceInputSetupPending: false,
  voiceInputDevices: [],
  voiceInputDeviceLabel: '',
  voiceInputDeviceRefreshSequence: 0,
  voiceInputLevel: 0,
  voiceInputPeakLevel: 0,
  voiceShortcutCaptureTarget: null,
  activeVoiceShortcut: null,
  runningTaskLayout: cachedRunningTaskLayout(),
  reorderPending: false,
  loadPromise: null,
  taskLoadSequence: 0,
  threadLoadSequence: 0,
  submitting: false,
  pendingSubmission: null,
  poolLimitSaving: false,
  projectSettingsSaving: false,
  uiPreferencesSaveTimer: null,
  projectCloseTargetId: null,
  projectCloseSubmitting: false,
  projectColorTargetId: null,
  projectColorDraft: null,
  projectColorSaving: false,
  prioritySubmit: false,
  draggedTaskId: null,
  queueDrag: null,
  assigningTaskId: null,
  closingThreadId: null,
  closingThreadLabel: null,
  killingSessionTaskId: null,
  completingSessionTaskId: null,
  terminalRetentionSavingTaskIds: new Set(),
  terminalRetentionFeedback: new Map(),
  // `${taskId}:${turnId}:prompt|response|earlier` to the disclosure state the user chose.
  // A Map, not a Set: an explicit collapse has to survive the periodic refresh as
  // firmly as an explicit expansion, and only a recorded false can outrank the
  // default-open newest turn.
  expandedSessionTurns: new Map(),
  preferIdleTerminal: initialComposerState.terminalSettings.preferIdleTerminal,
  keepTerminalOpen: initialComposerState.terminalSettings.keepTerminalOpen,
  terminalSettings: initialComposerState.terminalSettings,
  parallelTaskIds: new Set(),
  attachments: initialComposerState.attachments,
  taskReferences: initialComposerState.taskReferences,
  taskReferenceMenuTaskId: null,
  taskReferenceLoadSequences: new Map(),
  eventFilter: 'all',
  // The inline six button rail keeps its own selection while the Terminal window borrows
  // state.eventFilter for the window view. terminalWindowDock is the exact DOM slot the
  // reparented .events-section returns to, and its presence means the window is docked.
  inlineEventFilter: 'all',
  terminalWindowDock: null,
  nativeTerminalScreen: { taskId: null, threadId: null, requestedThreadId: null, state: 'ready', text: '', message: '', targets: [] },
  nativeTerminalScreenTimer: null,
  originalTerminalAbort: null,
  nativeTerminalScreenPending: false,
  nativeTerminalScreenSequence: 0,
  showThinking: true,
  eventFollow: true,
  eventTaskId: null,
  selectedTaskEventRevision: null,
  selectedTaskSnapshotSignature: '',
  selectedTaskEvents: [],
  selectedTaskPrompts: [],
  selectedTaskForEvents: null,
  visibleEventEntries: [],
  expandedEventDetails: new Set(),
  eventOutputScroll: new Map(),
  continuationDrafts: new Map(),
  continuationAttachments: new ContinuationAttachmentDrafts(),
  continuationSubmitting: false,
  continuationSteerPending: new Map(),
  continuationRetryDrafts: new Map(),
  planExecutionSubmitting: false,
  editingTaskId: null,
  taskEditMode: null,
  taskEditSubmitting: false,
  taskEditProvider: null,
  taskEditOriginalProvider: null,
  taskEditExecutionDirty: false,
  taskEditSettings: null,
  taskTitleRename: null,
  taskStarSavingIds: new Set(),
  planExecutionTargets: new Map(),
  detailCopyContent: {},
  detailCopyTimers: new Map(),
  /*
   * Everything the Changes dialog owns. It is keyed on its own taskId rather than the
   * selected task because the periodic detail refresh can rebuild the trigger button on
   * every pass: the dialog cannot hold state on a node that keeps being replaced.
   * `collapsed` records folders the reader closed by hand so a live refresh cannot
   * reopen them, and both signatures are the server's, never one this client invents.
   */
  taskDiff: {
    taskId: null,
    scope: 'workspace',
    summary: null,
    selectedPath: null,
    file: null,
    collapsed: new Map(),
    pollTimer: null,
    summaryRequest: 0,
    fileRequest: 0,
    stopped: false,
  },
  modelCatalogs: {
    codex: FALLBACK_MODELS.codex,
    claude: FALLBACK_MODELS.claude,
    opencode: FALLBACK_MODELS.opencode,
  },
  executionSettings: initialComposerState.executionSettings,
  threadExecutionSettings: initialComposerState.threadExecutionSettings,
  planSettings: initialComposerState.planSettings,
  turboSettings: initialComposerState.turboSettings,
  // Fold of everything the Turbo composer panel is drawn from. An unchanged fold means a
  // refresh tick has nothing to repaint, so the panel keeps its open dropdowns and caret.
  turboControlsSignature: '',
  planner: {
    open: false,
    loading: false,
    busy: false,
    plans: [],
    selectedPlanId: null,
    plan: null,
    breakdown: null,
    proposals: [],
    selection: new Set(),
    breakdownSessionId: null,
    queueSessionId: null,
    showRaw: false,
    pollTimer: null,
    // Planner v2: dependency board, plan runs, and refinement.
    run: null,
    notes: [],
    runSessionId: null,
    runPreferIdle: false,
    // Everything the never-clobber guarantee rests on: ids with unsaved local
    // text, whether a save is on the wire, and the signature of the markup the
    // board was last built from.
    dirtyProposalIds: new Set(),
    saveInFlight: false,
    boardSignature: null,
    announcement: '',
    selectionAttemptId: null,
  },
};

const elements = {
  form: document.querySelector('#task-form'),
  formMessage: document.querySelector('#form-message'),
  composerAlert: document.querySelector('#composer-alert'),
  submitButton: document.querySelector('#task-submit-button'),
  desktopUpdateIndicator: document.querySelector('#desktop-update-indicator'),
  desktopUpdateLabel: document.querySelector('#desktop-update-label'),
  desktopUpdateModal: document.querySelector('#desktop-update-modal'),
  desktopUpdateClose: document.querySelector('#desktop-update-close'),
  desktopUpdateDismiss: document.querySelector('#desktop-update-dismiss'),
  desktopUpdateTitle: document.querySelector('#desktop-update-title'),
  desktopUpdateMessage: document.querySelector('#desktop-update-message'),
  desktopUpdateCurrentVersion: document.querySelector('#desktop-update-current-version'),
  desktopUpdateLatestVersion: document.querySelector('#desktop-update-latest-version'),
  desktopUpdateStatus: document.querySelector('#desktop-update-status'),
  desktopUpdateProgress: document.querySelector('#desktop-update-progress'),
  desktopUpdateProgressBar: document.querySelector('#desktop-update-progress-bar'),
  desktopUpdateProgressValue: document.querySelector('#desktop-update-progress-value'),
  desktopUpdateNotesTitle: document.querySelector('#desktop-update-notes-title'),
  desktopUpdateNotesList: document.querySelector('#desktop-update-notes-list'),
  desktopUpdateNotesEmpty: document.querySelector('#desktop-update-notes-empty'),
  desktopUpdateRelease: document.querySelector('#desktop-update-release'),
  providerInput: document.querySelector('#provider-id'),
  providerTabsContainer: document.querySelector('#provider-tabs'),
  modeTabs: [...document.querySelectorAll('.mode-tab')],
  executeConfig: document.querySelector('#execute-config'),
  turboConfig: document.querySelector('#turbo-config'),
  providerTabs: [...document.querySelectorAll('.agent-tab')],
  providerCodexCount: document.querySelector('#provider-codex-count'),
  providerClaudeCount: document.querySelector('#provider-claude-count'),
  providerOpenCodeCount: document.querySelector('#provider-opencode-count'),
  executionControls: document.querySelector('#execution-controls'),
  modelSelect: document.querySelector('#model-select'),
  modelHint: document.querySelector('#model-hint'),
  effortSelect: document.querySelector('#effort-select'),
  effortHint: document.querySelector('#effort-hint'),
  effortSliderValue: document.querySelector('#effort-slider-value'),
  effortSliderSteps: document.querySelector('#effort-slider-steps'),
  planAuthorModel: document.querySelector('#plan-author-model'),
  planAuthorEffort: document.querySelector('#plan-author-effort'),
  planAuthorTerminalField: document.querySelector('#plan-author-terminal-field'),
  planAuthorTerminal: document.querySelector('#plan-author-terminal'),
  planCouncilEnabled: document.querySelector('#plan-council-enabled'),
  planCouncilOrder: document.querySelector('#plan-council-order'),
  planCouncilOrderButtons: [...document.querySelectorAll('[data-plan-council-first]')],
  planCouncilRoute: document.querySelector('#plan-council-route'),
  planCouncilClaudeRole: document.querySelector('#plan-council-claude-role'),
  planCouncilCodexRole: document.querySelector('#plan-council-codex-role'),
  planCouncilClaudeCopy: document.querySelector('#plan-council-claude-copy'),
  planCouncilCodexCopy: document.querySelector('#plan-council-codex-copy'),
  planCouncilRevisionCopy: document.querySelector('#plan-council-revision-copy'),
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
  turboPlanningCount: document.querySelector('#turbo-planning-count'),
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
  terminalPoolControls: document.querySelector('#terminal-pool-controls'),
  keepTerminalOpenOption: document.querySelector('#keep-terminal-open-option'),
  keepTerminalOpen: document.querySelector('#keep-terminal-open'),
  keepTerminalOpenHelp: document.querySelector('#keep-terminal-open-help'),
  legacyTerminalControls: document.querySelector('#legacy-terminal-controls'),
  legacyTerminalLaunchButtons: document.querySelector('#legacy-terminal-launch-buttons'),
  maxCodexInstances: document.querySelector('#max-codex-instances'),
  maxClaudeInstances: document.querySelector('#max-claude-instances'),
  maxOpenCodeInstances: document.querySelector('#max-opencode-instances'),
  codexPoolUsage: document.querySelector('#codex-pool-usage'),
  claudePoolUsage: document.querySelector('#claude-pool-usage'),
  openCodePoolUsage: document.querySelector('#opencode-pool-usage'),
  terminalLegend: document.querySelector('#terminal-legend'),
  threadInput: document.querySelector('#thread-id'),
  terminalList: document.querySelector('#terminal-list'),
  sessionMessage: document.querySelector('#session-message'),
  preferIdleTerminal: document.querySelector('#prefer-idle-terminal'),
  idleTerminalRoute: document.querySelector('#idle-terminal-route'),
  connectionHelpTitle: document.querySelector('#connection-help-title'),
  connectionHelpCopy: document.querySelector('#connection-help-copy'),
  terminalSettingsButton: document.querySelector('#terminal-settings-button'),
  terminalSettingsModal: document.querySelector('#terminal-settings-modal'),
  terminalSettingsClose: document.querySelector('#terminal-settings-close'),
  launchCodexButton: document.querySelector('#launch-codex-button'),
  launchClaudeButton: document.querySelector('#launch-claude-button'),
  terminalCloseRow: document.querySelector('#terminal-close-row'),
  terminalCloseLabel: document.querySelector('#terminal-close-label'),
  terminalCloseReason: document.querySelector('#terminal-close-reason'),
  closeTerminalButton: document.querySelector('#close-terminal-button'),
  terminalLayoutEnabled: document.querySelector('#terminal-layout-enabled'),
  terminalLayoutColumns: document.querySelector('#terminal-layout-columns'),
  terminalLayoutRows: document.querySelector('#terminal-layout-rows'),
  terminalLayoutDisplay: document.querySelector('#terminal-layout-display'),
  terminalLaunchBackground: document.querySelector('#terminal-launch-background'),
  terminalLayoutApplyAll: document.querySelector('#terminal-layout-apply-all'),
  terminalLayoutStatus: document.querySelector('#terminal-layout-status'),
  completionSound: document.querySelector('#completion-sound'),
  completionSpeech: document.querySelector('#completion-speech'),
  completionSpeechOptions: document.querySelector('#completion-speech-options'),
  completionSpeechProject: document.querySelector('#completion-speech-project'),
  completionSpeechTask: document.querySelector('#completion-speech-task'),
  completionSpeechStatus: document.querySelector('#completion-speech-status'),
  completionSpeechWords: document.querySelector('#completion-speech-words'),
  completionSpeechWordSetting: document.querySelector('.completion-speech-word-setting'),
  completionSpeechExample: document.querySelector('#completion-speech-example'),
  completionAlertPreview: document.querySelector('#completion-alert-preview'),
  completionAlertStatus: document.querySelector('#completion-alert-status'),
  voiceInputSettings: document.querySelector('#voice-input-settings'),
  voiceInputEnabled: document.querySelector('#voice-input-enabled'),
  voiceInputControls: document.querySelector('#voice-input-controls'),
  voiceInputShortcut: document.querySelector('#voice-input-shortcut'),
  voiceInputShortcutLabel: document.querySelector('#voice-input-shortcut-label'),
  voiceInputAlternateShortcut: document.querySelector('#voice-input-alternate-shortcut'),
  voiceInputAlternateShortcutLabel: document.querySelector('#voice-input-alternate-shortcut-label'),
  voiceInputMicrophone: document.querySelector('#voice-input-microphone'),
  voiceInputDeviceStatus: document.querySelector('#voice-input-device-status'),
  voiceInputSetup: document.querySelector('#voice-input-setup'),
  voiceInputStatus: document.querySelector('#voice-input-status'),
  desktopTitlebarTokenUsage: document.querySelector('#desktop-titlebar-token-usage'),
  desktopTitlebarTokenCount: document.querySelector('#desktop-titlebar-token-count'),
  desktopTitlebarTokenPanel: document.querySelector('#desktop-titlebar-token-panel'),
  providerUsage: document.querySelector('#provider-usage'),
  providerUsageMeters: [...document.querySelectorAll('[data-usage-key]')],
  themeToggle: document.querySelector('#theme-toggle'),
  headerPositionToggle: document.querySelector('#header-position-toggle'),
  aboutButton: document.querySelector('#about-button'),
  aboutModal: document.querySelector('#about-modal'),
  aboutClose: document.querySelector('#about-close'),
  appHeader: document.querySelector('.app-header'),
  taskViewButtons: [...document.querySelectorAll('[data-task-view]')],
  queueSummary: document.querySelector('#queue-summary'),
  taskSearch: document.querySelector('#task-search'),
  taskSearchInput: document.querySelector('#task-search-input'),
  taskSearchClear: document.querySelector('#task-search-clear'),
  taskSearchShortcut: document.querySelector('#task-search-shortcut'),
  taskSearchStatus: document.querySelector('#task-search-status'),
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
  standupButton: document.querySelector('#standup-button'),
  clearTaskNotificationsButton: document.querySelector('#clear-task-notifications-button'),
  standupModal: document.querySelector('#standup-modal'),
  standupSubtitle: document.querySelector('#standup-subtitle'),
  standupClose: document.querySelector('#standup-close'),
  standupCancel: document.querySelector('#standup-cancel'),
  standupDate: document.querySelector('#standup-date'),
  standupDaysField: document.querySelector('#standup-days-field'),
  standupDays: document.querySelector('#standup-days'),
  standupCustomPromptField: document.querySelector('#standup-custom-prompt-field'),
  standupCustomPrompt: document.querySelector('#standup-custom-prompt'),
  standupCustomPromptStatus: document.querySelector('#standup-custom-prompt-status'),
  standupCustomPromptSave: document.querySelector('#standup-custom-prompt-save'),
  standupScopeLabel: document.querySelector('#standup-scope-label'),
  standupCount: document.querySelector('#standup-count'),
  standupGeneratorProvider: document.querySelector('#standup-generator-provider'),
  standupGeneratorNote: document.querySelector('#standup-generator-note'),
  standupDateLabel: document.querySelector('#standup-date-label'),
  standupSourceNote: document.querySelector('#standup-source-note'),
  standupSheet: document.querySelector('#standup-sheet'),
  standupResults: document.querySelector('#standup-results'),
  standupLoadingList: document.querySelector('#standup-loading-list'),
  standupEmpty: document.querySelector('#standup-empty'),
  standupEmptyTitle: document.querySelector('#standup-empty-title'),
  standupEmptyMessage: document.querySelector('#standup-empty-message'),
  standupFollowUp: document.querySelector('#standup-follow-up'),
  standupFollowUpRange: document.querySelector('#standup-follow-up-range'),
  standupFollowUpSuggestions: document.querySelector('#standup-follow-up-suggestions'),
  standupFollowUpLedger: document.querySelector('#standup-follow-up-ledger'),
  standupFollowUpForm: document.querySelector('#standup-follow-up-form'),
  standupFollowUpInput: document.querySelector('#standup-follow-up-input'),
  standupFollowUpSend: document.querySelector('#standup-follow-up-send'),
  standupFollowUpStatus: document.querySelector('#standup-follow-up-status'),
  standupCopyStatus: document.querySelector('#standup-copy-status'),
  standupGenerate: document.querySelector('#standup-generate'),
  standupCopy: document.querySelector('#standup-copy'),
  parallelBatchBar: document.querySelector('#parallel-batch-bar'),
  parallelSelectionCount: document.querySelector('#parallel-selection-count'),
  parallelSessionSelect: document.querySelector('#parallel-session-select'),
  parallelClearButton: document.querySelector('#parallel-clear-button'),
  parallelRunButton: document.querySelector('#parallel-run-button'),
  emptyDetail: document.querySelector('#empty-detail'),
  taskDetail: document.querySelector('#task-detail'),
  taskDetailOpen: document.querySelector('#task-detail-open'),
  taskDetailModal: document.querySelector('#task-detail-modal'),
  taskDetailModalTitle: document.querySelector('#task-detail-modal-title'),
  taskDetailModalSubtitle: document.querySelector('#task-detail-modal-subtitle'),
  taskDetailModalClose: document.querySelector('#task-detail-modal-close'),
  taskDiffModal: document.querySelector('#task-diff-modal'),
  taskDiffTitle: document.querySelector('#task-diff-title'),
  taskDiffSubtitle: document.querySelector('#task-diff-subtitle'),
  taskDiffClose: document.querySelector('#task-diff-close'),
  taskDiffScopeButtons: [...document.querySelectorAll('[data-task-diff-scope]')],
  taskDiffTotals: document.querySelector('#task-diff-totals'),
  taskDiffLive: document.querySelector('#task-diff-live'),
  taskDiffCaptured: document.querySelector('#task-diff-captured'),
  taskDiffNotices: document.querySelector('#task-diff-notices'),
  taskDiffMessage: document.querySelector('#task-diff-message'),
  taskDiffTree: document.querySelector('#task-diff-tree'),
  taskDiffFile: document.querySelector('#task-diff-file'),
  detailTitle: document.querySelector('#detail-title'),
  detailTaskName: document.querySelector('#detail-task-name'),
  detailExecutionProfile: document.querySelector('#detail-execution-profile'),
  detailMeta: document.querySelector('#detail-meta'),
  detailActions: document.querySelector('#detail-actions'),
  terminalRetentionMessage: document.querySelector('#terminal-retention-message'),
  promptSection: document.querySelector('#prompt-section'),
  detailPrompt: document.querySelector('#detail-prompt'),
  detailPromptPreview: document.querySelector('#detail-prompt-preview'),
  resultSection: document.querySelector('#result-section'),
  detailResult: document.querySelector('#detail-result'),
  detailResultPreview: document.querySelector('#detail-result-preview'),
  sessionStrip: document.querySelector('#session-strip'),
  sessionStripTitle: document.querySelector('#session-strip-title'),
  sessionStripContext: document.querySelector('#session-strip-context'),
  sessionStripState: document.querySelector('#session-strip-state'),
  sessionModeBadge: document.querySelector('#session-mode-badge'),
  sessionStripMessage: document.querySelector('#session-strip-message'),
  sessionCompleteButton: document.querySelector('#session-complete-button'),
  sessionKillButton: document.querySelector('#session-kill-button'),
  sessionHistory: document.querySelector('#session-history'),
  sessionHistoryCount: document.querySelector('#session-history-count'),
  sessionHistoryTurns: document.querySelector('#session-history-turns'),
  contentCopyButtons: [...document.querySelectorAll('[data-copy-content]')],
  eventsSection: document.querySelector('.events-section'),
  detailEvents: document.querySelector('#detail-events'),
  eventSessionState: document.querySelector('#event-session-state'),
  eventSummary: document.querySelector('#event-summary'),
  eventOverview: document.querySelector('#event-overview'),
  eventOverviewBody: document.querySelector('#event-overview-body'),
  eventMetrics: document.querySelector('#event-metrics'),
  termProvider: document.querySelector('#term-provider'),
  termEffort: document.querySelector('#term-effort'),
  termDuration: document.querySelector('#term-duration'),
  eventFilters: [...document.querySelectorAll('[data-event-filter]')],
  eventMoreViews: document.querySelector('#event-more-views'),
  eventTools: document.querySelector('.event-tools'),
  thinkingVisibilityButton: document.querySelector('#thinking-visibility-button'),
  copyEventsButton: document.querySelector('#copy-events-button'),
  terminalWindowOpenButton: document.querySelector('#terminal-window-open'),
  terminalWindowModal: document.querySelector('#terminal-window-modal'),
  terminalWindowMount: document.querySelector('#terminal-window-mount'),
  terminalWindowTools: document.querySelector('#terminal-window-tools'),
  terminalWindowTitle: document.querySelector('#terminal-window-title'),
  terminalWindowSubtitle: document.querySelector('#terminal-window-subtitle'),
  terminalWindowClose: document.querySelector('#terminal-window-close'),
  terminalWindowViews: [...document.querySelectorAll('[data-terminal-window-view]')],
  originalTerminalButton: document.querySelector('#original-terminal-view'),
  originalTerminalOpen: document.querySelector('#original-terminal-open'),
  originalTerminalFallback: document.querySelector('#original-terminal-fallback'),
  nativeTerminalTargets: document.querySelector('#original-terminal-targets'),
  embeddedTerminal: document.querySelector('#embedded-terminal'),
  nativeTerminalScreen: document.querySelector('#native-terminal-screen'),
  nativeTerminalScreenTitle: document.querySelector('#native-terminal-screen-title'),
  nativeTerminalScreenState: document.querySelector('#native-terminal-screen-state'),
  nativeTerminalScreenNotice: document.querySelector('#native-terminal-screen-notice'),
  nativeTerminalScreenOutput: document.querySelector('#native-terminal-screen-output'),
  continuationForm: document.querySelector('#task-continuation-form'),
  continuationLabel: document.querySelector('#task-continuation-label'),
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
  planDraftArtifactRow: document.querySelector('#plan-draft-artifact-row'),
  planDraftArtifactPath: document.querySelector('#plan-draft-artifact-path'),
  planReviewSection: document.querySelector('#plan-review-section'),
  planReview: document.querySelector('#plan-review'),
  planReviewArtifactRow: document.querySelector('#plan-review-artifact-row'),
  planReviewArtifactPath: document.querySelector('#plan-review-artifact-path'),
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
  taskName: document.querySelector('#task-name'),
  promptLabel: document.querySelector('#prompt-label'),
  composerQuickActions: document.querySelector('#composer-quick-actions'),
  quickSkillList: document.querySelector('#quick-skill-list'),
  quickSkillEditorList: document.querySelector('#quick-skill-editor-list'),
  quickSkillAdd: document.querySelector('#quick-skill-add'),
  quickSkillRestore: document.querySelector('#quick-skill-restore'),
  quickSkillEditorStatus: document.querySelector('#quick-skill-editor-status'),
  voiceInputComposer: document.querySelector('#voice-input-composer'),
  voiceInputHold: document.querySelector('#voice-input-hold'),
  voiceInputHoldLabel: document.querySelector('#voice-input-hold-label'),
  voiceInputComposerStatus: document.querySelector('#voice-input-composer-status'),
  attachmentRoute: document.querySelector('#attachment-route'),
  attachmentCount: document.querySelector('#attachment-count'),
  attachmentDropzone: document.querySelector('#attachment-dropzone'),
  attachmentInput: document.querySelector('#image-input'),
  attachmentList: document.querySelector('#attachment-list'),
  taskReferences: document.querySelector('#task-references'),
  taskReferenceCount: document.querySelector('#task-reference-count'),
  taskReferenceList: document.querySelector('#task-reference-list'),
  taskReferenceMenu: document.querySelector('#task-reference-menu'),
  taskReferenceMenuTitle: document.querySelector('#task-reference-menu-title'),
  taskReferenceMenuName: document.querySelector('#task-reference-menu-name'),
  detailAttachmentsSection: document.querySelector('#detail-attachments-section'),
  detailAttachmentsCount: document.querySelector('#detail-attachments-count'),
  detailAttachments: document.querySelector('#detail-attachments'),
  taskEditModal: document.querySelector('#task-edit-modal'),
  taskEditTitle: document.querySelector('#task-edit-title'),
  taskEditSubtitle: document.querySelector('#task-edit-subtitle'),
  taskEditExecution: document.querySelector('#task-edit-execution'),
  taskEditProvider: document.querySelector('#task-edit-provider'),
  taskEditProviderLabel: document.querySelector('#task-edit-provider-label'),
  taskEditModel: document.querySelector('#task-edit-model'),
  taskEditEffort: document.querySelector('#task-edit-effort'),
  taskEditExecutionHint: document.querySelector('#task-edit-execution-hint'),
  taskEditName: document.querySelector('#task-edit-name'),
  taskEditNameHint: document.querySelector('#task-edit-name-hint'),
  taskEditPrompt: document.querySelector('#task-edit-prompt'),
  taskEditMessage: document.querySelector('#task-edit-message'),
  taskEditClose: document.querySelector('#task-edit-close'),
  taskEditCancel: document.querySelector('#task-edit-cancel'),
  taskEditSave: document.querySelector('#task-edit-save'),
  plannerButton: document.querySelector('#planner-button'),
  plannerModal: document.querySelector('#planner-modal'),
  plannerSubtitle: document.querySelector('#planner-subtitle'),
  plannerClose: document.querySelector('#planner-close'),
  plannerBody: document.querySelector('#planner-body'),
  plannerRunAnnounce: document.querySelector('#planner-run-announce'),
  plannerNewPlan: document.querySelector('#planner-new-plan'),
  plannerPlanList: document.querySelector('#planner-plan-list'),
  plannerDetail: document.querySelector('#planner-detail'),
  plannerMessage: document.querySelector('#planner-message'),
  headerRunningMonitor: document.querySelector('.header-running-monitor'),
  headerRunningTasks: document.querySelector('#header-running-tasks'),
  headerRunningExtraTasks: document.querySelector('#header-running-extra-tasks'),
  displaySettings: document.querySelector('#display-settings'),
  runningTaskRows: document.querySelector('#running-task-rows'),
  runningTaskWidth: document.querySelector('#running-task-width'),
  desktopZoomControls: document.querySelector('#desktop-zoom-controls'),
  desktopZoomOut: document.querySelector('#desktop-zoom-out'),
  desktopZoomLevel: document.querySelector('#desktop-zoom-level'),
  desktopZoomIn: document.querySelector('#desktop-zoom-in'),
  projectList: document.querySelector('#project-list'),
  projectReorderStatus: document.querySelector('#project-reorder-status'),
  projectCloseModal: document.querySelector('#project-close-modal'),
  projectCloseCard: document.querySelector('#project-close-card'),
  projectCloseTitle: document.querySelector('#project-close-title'),
  projectCloseDismiss: document.querySelector('#project-close-dismiss'),
  projectCloseTarget: document.querySelector('#project-close-target'),
  projectCloseInitial: document.querySelector('#project-close-initial'),
  projectCloseName: document.querySelector('#project-close-name'),
  projectClosePath: document.querySelector('#project-close-path'),
  projectCloseMessage: document.querySelector('#project-close-message'),
  projectCloseCancel: document.querySelector('#project-close-cancel'),
  projectCloseConfirm: document.querySelector('#project-close-confirm'),
  projectColorModal: document.querySelector('#project-color-modal'),
  projectColorSubtitle: document.querySelector('#project-color-subtitle'),
  projectColorClose: document.querySelector('#project-color-close'),
  projectColorPreview: document.querySelector('#project-color-preview'),
  projectColorPreviewInitial: document.querySelector('#project-color-preview-initial'),
  projectColorPreviewName: document.querySelector('#project-color-preview-name'),
  projectColorPresetList: document.querySelector('#project-color-preset-list'),
  projectColorCustomInput: document.querySelector('#project-color-custom-input'),
  projectColorCustomValue: document.querySelector('#project-color-custom-value'),
  projectColorMessage: document.querySelector('#project-color-message'),
  projectColorCancel: document.querySelector('#project-color-cancel'),
  projectColorSave: document.querySelector('#project-color-save'),
  addProjectButton: document.querySelector('#add-project-button'),
  workspace: document.querySelector('.workspace'),
  composerQueueResizer: document.querySelector('#composer-queue-resizer'),
  queueDetailResizer: document.querySelector('#queue-detail-resizer'),
  terminalHeightResizer: document.querySelector('#terminal-height-resizer'),
};

let renderedTaskListSignature = '';
const taskAttachmentPreviewObserver = typeof window.IntersectionObserver === 'function'
  ? new window.IntersectionObserver((entries) => {
    for (const entry of entries) {
      const image = entry.target;
      if (!(image instanceof HTMLImageElement)) continue;
      const source = image.dataset.previewSource;
      if (entry.isIntersecting && source) {
        if (image.getAttribute('src') !== source) image.setAttribute('src', source);
      } else if (image.hasAttribute('src')) {
        image.removeAttribute('src');
      }
    }
  }, { rootMargin: '240px 0px' })
  : null;

// The rebuilt nodes are discarded whole, so clearing their `src` first only
// costs a blank frame. Report which sources were actually painted instead, so
// the replacement nodes can be restored synchronously.
function releaseTaskAttachmentPreviews() {
  const showing = new Set();
  for (const image of elements.taskList.querySelectorAll('img[data-preview-source][src]')) {
    if (image.dataset.previewSource) showing.add(image.dataset.previewSource);
  }
  if (taskAttachmentPreviewObserver) taskAttachmentPreviewObserver.disconnect();
  return showing;
}

function observeTaskAttachmentPreviews(previouslyShowing = new Set()) {
  const images = elements.taskList.querySelectorAll('img[data-preview-source]');
  for (const image of images) {
    const source = image.dataset.previewSource;
    if (!taskAttachmentPreviewObserver) {
      image.setAttribute('src', source);
      continue;
    }
    // Restoring before `observe()` keeps a visible thumbnail painted across the
    // rebuild. The observer's first callback still releases anything that is
    // genuinely offscreen, so viewport-bounded loading is preserved.
    if (source && previouslyShowing.has(source)) image.setAttribute('src', source);
    taskAttachmentPreviewObserver.observe(image);
  }
}
// end task attachment previews

let voiceRecorder = null;

function terminalLayout() {
  return {
    enabled: elements.terminalLayoutEnabled.checked,
    columns: Number(elements.terminalLayoutColumns.value),
    rows: Number(elements.terminalLayoutRows.value),
    display: Number(elements.terminalLayoutDisplay.value),
    background: elements.terminalLaunchBackground.checked,
  };
}

function applyProjectTerminalSettings(project = activeProject(), fallback = state.terminalSettings) {
  const settings = normalizeProjectTerminalSettings(project, fallback);
  state.terminalSettings = settings;
  state.keepTerminalOpen = settings.keepTerminalOpen;
  state.preferIdleTerminal = settings.preferIdleTerminal;
  elements.keepTerminalOpen.checked = settings.keepTerminalOpen;
  elements.preferIdleTerminal.checked = settings.preferIdleTerminal;
  elements.terminalLayoutEnabled.checked = settings.layout.enabled;
  elements.terminalLayoutColumns.value = String(settings.layout.columns);
  elements.terminalLayoutRows.value = String(settings.layout.rows);
  elements.terminalLaunchBackground.checked = settings.layout.background;
  const displayCount = elements.terminalLayoutDisplay.options.length;
  const display = Math.min(settings.layout.display, Math.max(0, displayCount - 1));
  elements.terminalLayoutDisplay.value = String(display);
  return settings;
}

function projectTerminalSettingsRecord(settings = state.terminalSettings) {
  return {
    keep_terminal_open: settings.keepTerminalOpen,
    prefer_idle_terminal: settings.preferIdleTerminal,
    terminal_layout: settings.layout,
  };
}

function setProjectTerminalSettingsDisabled(disabled) {
  for (const control of [
    elements.terminalLayoutEnabled,
    elements.terminalLayoutColumns,
    elements.terminalLayoutRows,
    elements.terminalLayoutDisplay,
    elements.terminalLaunchBackground,
    elements.terminalLayoutApplyAll,
  ]) {
    control.disabled = disabled;
  }
  const applyAllSupported = state.status?.capabilities?.projectTerminalSettings === true;
  elements.terminalLayoutApplyAll.disabled = disabled || !activeProject() || !applyAllSupported;
  elements.terminalLayoutApplyAll.title = applyAllSupported
    ? 'Copy this window layout to every pinned project.'
    : 'Restart CC Relay to apply window settings to every project.';
}

function resetTerminalLayoutStatus() {
  elements.terminalLayoutStatus.textContent = 'Grid launches use the next available cell.';
}

function projectTerminalSettingIsFocused() {
  return [
    elements.keepTerminalOpen,
    elements.preferIdleTerminal,
    elements.terminalLayoutEnabled,
    elements.terminalLayoutColumns,
    elements.terminalLayoutRows,
    elements.terminalLayoutDisplay,
    elements.terminalLaunchBackground,
  ].includes(document.activeElement);
}

async function saveProjectTerminalSettings() {
  const project = activeProject();
  if (!project || state.projectSettingsSaving) return;
  const settings = {
    keepTerminalOpen: state.keepTerminalOpen,
    preferIdleTerminal: state.preferIdleTerminal,
    layout: terminalLayout(),
  };
  state.terminalSettings = settings;
  state.projects = state.projects.map((item) => (
    item.id === project.id ? { ...item, ...projectTerminalSettingsRecord(settings) } : item
  ));
  saveProjectComposerState(project.path);

  if (state.status?.capabilities?.projectTerminalSettings !== true) {
    // Older backends cannot persist the project snapshot, but the renderer setting is already
    // active for new task submissions and remains isolated in this project's composer session.
    renderThreads();
    return;
  }

  state.projectSettingsSaving = true;
  setProjectTerminalSettingsDisabled(true);
  elements.keepTerminalOpen.disabled = true;
  elements.preferIdleTerminal.disabled = true;
  try {
    const body = await api(`/api/projects/${project.id}/settings`, {
      method: 'PATCH',
      body: JSON.stringify({
        keepTerminalOpen: settings.keepTerminalOpen,
        preferIdleTerminal: settings.preferIdleTerminal,
        terminalLayout: settings.layout,
      }),
    });
    state.projects = state.projects.map((item) => (
      item.id === body.project.id ? body.project : item
    ));
  } catch (error) {
    elements.formMessage.textContent = `Could not save ${project.name} terminal settings: ${error.message}`;
  } finally {
    state.projectSettingsSaving = false;
    if (sameProjectPath(state.activeProjectPath, project.path)) {
      applyProjectTerminalSettings(activeProject(), settings);
    }
    renderThreads();
  }
}

function saveTerminalLayout() {
  state.terminalSettings = {
    ...state.terminalSettings,
    layout: terminalLayout(),
  };
  void saveProjectTerminalSettings();
}

async function applyTerminalLayoutToAllProjects() {
  const project = activeProject();
  if (
    !project
    || state.projectSettingsSaving
    || state.status?.capabilities?.projectTerminalSettings !== true
  ) return;
  const layout = terminalLayout();
  state.projectSettingsSaving = true;
  setProjectTerminalSettingsDisabled(true);
  elements.terminalLayoutApplyAll.textContent = 'Applying...';
  elements.terminalLayoutStatus.textContent = 'Applying this window layout to every pinned project.';
  try {
    const body = await api('/api/projects/terminal-layout', {
      method: 'PATCH',
      body: JSON.stringify({ terminalLayout: layout }),
    });
    state.projects = body.projects || state.projects.map((item) => ({
      ...item,
      terminal_layout: layout,
    }));
    state.terminalSettings = {
      ...state.terminalSettings,
      layout,
    };
    saveProjectComposerState(project.path);
    elements.terminalLayoutStatus.textContent = `Applied to ${state.projects.length} ${state.projects.length === 1 ? 'project' : 'projects'}. Future changes remain project-specific.`;
  } catch (error) {
    elements.terminalLayoutStatus.textContent = `Could not apply the window layout: ${error.message}`;
  } finally {
    state.projectSettingsSaving = false;
    setProjectTerminalSettingsDisabled(!activeProject());
    elements.terminalLayoutApplyAll.textContent = 'Apply to all projects';
  }
}

async function loadTerminalDisplays() {
  const body = await api('/api/terminal-displays');
  const displays = body.displays || [];
  elements.terminalLayoutDisplay.innerHTML = displays.map((display, index) => (
    `<option value="${index}">${escapeHtml(display.name || `Monitor ${index + 1}`)} · ${display.width}×${display.height}${display.primary ? ' · Primary' : ''}</option>`
  )).join('') || '<option value="0">Primary monitor</option>';
  applyProjectTerminalSettings(activeProject(), state.terminalSettings);
}

/*
 * Every request is bounded. Without an abort a hung fetch leaves the composer stuck on
 * its in-flight state forever, which reads as "CC Relay refuses to add the task".
 */
async function api(path, options = {}) {
  const { timeoutMs = API_TIMEOUT_MS, timeoutMessage = null, signal: externalSignal, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(path, {
      ...fetchOptions,
      signal: externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(fetchOptions.headers || {}),
      },
    });
  } catch (error) {
    if (controller.signal.aborted) {
      const seconds = Math.round(timeoutMs / 1000);
      /*
       * Aborting the fetch stops the browser waiting; it does not stop the server. The
       * request may have been received and completed. This copy must never claim that
       * nothing happened. Callers that know their own retry is safe say so themselves
       * through timeoutMessage.
       */
      throw new Error(
        timeoutMessage?.(seconds)
        || `CC Relay did not answer within ${seconds} seconds. It may still be processing the request.`,
      );
    }
    throw new Error(`CC Relay is unreachable. ${error.message}`);
  } finally {
    window.clearTimeout(timer);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const failure = new Error(body.error || `Request failed with status ${response.status}.`);
    /*
     * A rejected request whose work may already have reached a provider terminal is not an
     * ordinary failure, and no caller should have to read error copy to tell them apart.
     */
    if (body.deliveryUncertain === true) failure.deliveryUncertain = true;
    if (body.composerBlocked === true) failure.composerBlocked = true;
    /*
     * Pollers need to tell "gone for good" from "briefly unhappy". Without the code a
     * deleted task would be retried every three seconds forever against a 404.
     */
    failure.status = response.status;
    throw failure;
  }
  return body;
}

function uiPreferencesPayload() {
  return {
    panelWidths: {
      composer: Math.round(state.panelWidths.composer),
      queue: Math.round(state.panelWidths.queue),
    },
    terminalHeight: state.terminalHeight == null ? null : Math.round(state.terminalHeight),
    headerPosition: currentHeaderPosition(),
    runningTaskLayout: state.runningTaskLayout,
    completionAlerts: state.completionAlertPreferences,
    voiceInput: state.voiceInputPreferences,
    terminalWindowView: state.terminalWindowView,
    terminalMode: state.terminalMode,
    quickSkills: state.quickSkills,
  };
}

function cacheUiPreferences(preferences = uiPreferencesPayload()) {
  localStorage.setItem('relay.terminalMode', preferences.terminalMode === 'activity' ? 'activity' : 'native');
  localStorage.setItem('relay.panelWidths', JSON.stringify(preferences.panelWidths));
  if (preferences.terminalHeight == null) localStorage.removeItem('relay.terminalHeight');
  else localStorage.setItem('relay.terminalHeight', String(preferences.terminalHeight));
  localStorage.setItem('relay.headerPosition', preferences.headerPosition);
  localStorage.setItem(
    'relay.runningTaskLayout',
    JSON.stringify(normalizeRunningTaskLayout(preferences.runningTaskLayout)),
  );
  // A record written before terminalWindowView shipped carries no member. Keeping the
  // live value there stops an older server from erasing the operator's saved choice.
  localStorage.setItem(
    'relay.terminalWindowView',
    normalizeTerminalWindowView(preferences.terminalWindowView ?? state.terminalWindowView),
  );
  /*
   * Unlike terminalWindowView above, a record with no quickSkills member means the built-in
   * catalog, not "keep whatever is local". An empty array is the operator deleting them all,
   * so it has to survive the round trip untouched.
   */
  localStorage.setItem(
    'relay.quickSkills',
    JSON.stringify(normalizeQuickSkills(preferences.quickSkills)),
  );
  const completionAlerts = normalizeCompletionAlertPreferences(preferences.completionAlerts);
  localStorage.setItem('relay.completionSound', completionAlerts.sound);
  localStorage.setItem('relay.completionSpeech', String(completionAlerts.speak));
  localStorage.setItem('relay.completionSpeechOptions', JSON.stringify(completionAlerts.speech));
  const voiceInput = normalizeVoiceInputPreferences(preferences.voiceInput);
  localStorage.setItem('relay.voiceInputEnabled', String(voiceInput.enabled));
  localStorage.setItem('relay.voiceInputShortcut', voiceInput.shortcut);
  if (voiceInput.alternateShortcut) {
    localStorage.setItem('relay.voiceInputAlternateShortcut', voiceInput.alternateShortcut);
  } else {
    localStorage.removeItem('relay.voiceInputAlternateShortcut');
  }
  if (voiceInput.microphoneLabel) {
    localStorage.setItem('relay.voiceInputMicrophoneLabel', voiceInput.microphoneLabel);
  } else {
    localStorage.removeItem('relay.voiceInputMicrophoneLabel');
  }
}

function completionAlertExampleTask() {
  return state.tasks.find((item) => item.id === state.selectedTaskId) || {
    repo_path: state.activeProjectPath || 'CC Relay',
    title: elements.taskName.value || elements.prompt.value || 'Task',
  };
}

function renderCompletionAlertSettings() {
  const { speak, sound, speech } = state.completionAlertPreferences;
  elements.completionSound.value = sound;
  elements.completionSpeech.checked = speak;
  elements.completionSpeechOptions.disabled = !speak;
  elements.completionSpeechProject.checked = speech.project;
  elements.completionSpeechTask.checked = speech.task;
  elements.completionSpeechStatus.checked = speech.status;
  elements.completionSpeechWords.value = String(speech.taskWords);
  elements.completionSpeechWords.disabled = !speak || !speech.task;
  elements.completionSpeechWordSetting.dataset.inactive = String(!speech.task);
  elements.completionSpeechExample.textContent = completionSpeechText(
    completionAlertExampleTask(),
    state.completionAlertPreferences,
  );
}

function setCompletionAlertPreferences(value, { persist = true } = {}) {
  state.completionAlertPreferences = normalizeCompletionAlertPreferences(value);
  renderCompletionAlertSettings();
  if (persist) queueUiPreferencesSave();
}

function voiceInputSupported() {
  return state.status?.capabilities?.pushToTalkVoiceInput === true;
}

function setVoiceInputPreferences(value, { persist = true } = {}) {
  const previousEnabled = state.voiceInputPreferences.enabled;
  state.voiceInputPreferences = normalizeVoiceInputPreferences(value);
  voiceRecorder?.setPreferredDeviceLabel(state.voiceInputPreferences.microphoneLabel);
  if (previousEnabled && !state.voiceInputPreferences.enabled) {
    state.activeVoiceShortcut = null;
    voiceRecorder?.cancel();
  }
  renderVoiceInput();
  if (persist) queueUiPreferencesSave();
}

function voiceInputDefaultDeviceLabel() {
  const source = state.voiceInputDevices.find((device) => device.isDefault)
    || state.voiceInputDevices[0];
  return String(source?.label || '')
    .replace(/^default\s*-\s*/i, '')
    .trim();
}

function renderVoiceInputDevices() {
  const selectedLabel = state.voiceInputPreferences.microphoneLabel;
  const defaultLabel = voiceInputDefaultDeviceLabel();
  const namedDevices = [];
  const seenLabels = new Set();
  for (const device of state.voiceInputDevices) {
    if (device.isDefault || !device.label || seenLabels.has(device.label)) continue;
    seenLabels.add(device.label);
    namedDevices.push(device);
  }
  const signature = JSON.stringify({ selectedLabel, defaultLabel, namedDevices });
  if (elements.voiceInputMicrophone.dataset.signature !== signature) {
    elements.voiceInputMicrophone.dataset.signature = signature;
    elements.voiceInputMicrophone.replaceChildren();
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = defaultLabel
      ? `System default: ${defaultLabel}`
      : 'System default microphone';
    elements.voiceInputMicrophone.append(defaultOption);
    for (const device of namedDevices) {
      const option = document.createElement('option');
      option.value = device.label;
      option.textContent = device.label;
      elements.voiceInputMicrophone.append(option);
    }
    if (selectedLabel && !seenLabels.has(selectedLabel)) {
      const unavailable = document.createElement('option');
      unavailable.value = selectedLabel;
      unavailable.textContent = `${selectedLabel} (unavailable)`;
      elements.voiceInputMicrophone.append(unavailable);
    }
  }
  elements.voiceInputMicrophone.value = selectedLabel || '';
  const labelsHidden = state.voiceInputDevices.length > 0
    && state.voiceInputDevices.every((device) => !device.label);
  if (state.voiceInputDevices.length === 0) {
    elements.voiceInputDeviceStatus.textContent = 'No microphone inputs found.';
  } else if (labelsHidden) {
    elements.voiceInputDeviceStatus.textContent = 'Allow microphone access to list the available inputs.';
  } else if (selectedLabel && !seenLabels.has(selectedLabel)) {
    elements.voiceInputDeviceStatus.textContent = `${selectedLabel} is unavailable. Relay will use the system default.`;
  } else {
    const available = namedDevices.length;
    elements.voiceInputDeviceStatus.textContent = defaultLabel
      ? `${available} named ${available === 1 ? 'input' : 'inputs'} available. System default: ${defaultLabel}.`
      : `${available} named ${available === 1 ? 'input' : 'inputs'} available.`;
  }
}

async function refreshVoiceInputDevices({ requestPermission = false } = {}) {
  const sequence = ++state.voiceInputDeviceRefreshSequence;
  let devices;
  try {
    devices = await discoverVoiceInputDevices(navigator.mediaDevices, { requestPermission });
  } catch {
    devices = [];
  }
  if (sequence !== state.voiceInputDeviceRefreshSequence) return;
  state.voiceInputDevices = devices;
  renderVoiceInput();
}

function adoptVoiceInputStatus(value) {
  if (!value || typeof value !== 'object') return;
  state.voiceInputEngine = value;
  renderVoiceInput();
}

function voiceEngineSettingsCopy() {
  const engine = state.voiceInputEngine;
  if (state.voiceInputSetupPending || engine.state === 'installing') {
    return 'Installing faster-whisper and downloading the multilingual base model. Keep CC Relay open.';
  }
  if (engine.state === 'ready') {
    return engine.workerReady
      ? 'Ready. The CPU speech model is loaded for fast local transcription.'
      : 'Ready. The CPU speech model loads automatically when voice input starts.';
  }
  if (engine.state === 'error') {
    return engine.error || 'The local voice engine needs repair.';
  }
  if (engine.state === 'checking') return 'Checking the local voice engine.';
  return 'Set up once to install faster-whisper 1.2.1 and download the multilingual base model locally.';
}

function voiceEngineReady() {
  return state.voiceInputEngine.installed === true
    && !['checking', 'installing', 'setup-required'].includes(state.voiceInputEngine.state);
}

function renderVoiceShortcutKeycaps(container, shortcut, placeholder) {
  container.replaceChildren();
  if (!shortcut) {
    const empty = document.createElement('span');
    empty.className = 'voice-input-shortcut-empty';
    empty.textContent = placeholder;
    container.append(empty);
    return;
  }
  voiceShortcutKeyLabels(shortcut, navigator.platform).forEach((label, index) => {
    if (index > 0) {
      const separator = document.createElement('i');
      separator.textContent = '+';
      separator.setAttribute('aria-hidden', 'true');
      container.append(separator);
    }
    const key = document.createElement('kbd');
    key.textContent = label;
    container.append(key);
  });
}

function renderVoiceInputLevel() {
  const visualLevel = Math.min(1, Math.max(0, state.voiceInputLevel * 18));
  elements.voiceInputComposer.style.setProperty('--voice-level', visualLevel.toFixed(3));
  elements.voiceInputComposer.style.setProperty(
    '--voice-meter-height',
    `${Math.round(2 + visualLevel * 8)}px`,
  );
  elements.voiceInputComposer.dataset.signal = voiceSignalDetected(state.voiceInputPeakLevel)
    ? 'detected'
    : 'quiet';
  if (state.voiceInputActivity !== 'listening') return;
  const source = state.voiceInputDeviceLabel || 'the selected microphone';
  const status = voiceSignalDetected(state.voiceInputPeakLevel)
    ? `Speech signal detected on ${source}. Release to transcribe.`
    : `Using ${source}. Speak now and watch the level.`;
  elements.voiceInputComposerStatus.textContent = status;
  elements.voiceInputHold.title = status;
}

function renderVoiceInput() {
  const supported = voiceInputSupported();
  const { enabled, shortcut, alternateShortcut } = state.voiceInputPreferences;
  const shortcutLabel = voiceShortcutLabel(shortcut, navigator.platform);
  const alternateShortcutLabel = alternateShortcut
    ? voiceShortcutLabel(alternateShortcut, navigator.platform)
    : '';
  const activationLabel = alternateShortcutLabel
    ? `${shortcutLabel} or ${alternateShortcutLabel}`
    : shortcutLabel;
  const engineReady = voiceEngineReady();
  const engineHealthy = state.voiceInputEngine.installed === true
    && state.voiceInputEngine.state === 'ready';
  const installing = state.voiceInputSetupPending || state.voiceInputEngine.state === 'installing';

  elements.voiceInputSettings.hidden = !supported;
  elements.voiceInputComposer.hidden = !supported;
  elements.composerQuickActions.dataset.voiceAvailable = String(supported);
  elements.voiceInputEnabled.checked = enabled;
  elements.voiceInputEnabled.disabled = !supported || installing;
  elements.voiceInputControls.dataset.enabled = String(enabled);
  renderVoiceInputDevices();
  elements.voiceInputMicrophone.disabled = !supported || !enabled || installing;
  for (const button of [elements.voiceInputShortcut, elements.voiceInputAlternateShortcut]) {
    button.disabled = !supported || !enabled || installing;
  }
  const capturingPrimary = state.voiceShortcutCaptureTarget === 'primary';
  const capturingAlternate = state.voiceShortcutCaptureTarget === 'alternate';
  elements.voiceInputShortcut.dataset.capturing = String(capturingPrimary);
  elements.voiceInputAlternateShortcut.dataset.capturing = String(capturingAlternate);
  renderVoiceShortcutKeycaps(
    elements.voiceInputShortcutLabel,
    capturingPrimary ? null : shortcut,
    'Press keys',
  );
  renderVoiceShortcutKeycaps(
    elements.voiceInputAlternateShortcutLabel,
    capturingAlternate ? null : alternateShortcut,
    capturingAlternate ? 'Press keys' : 'Not set',
  );
  elements.voiceInputShortcut.querySelector('[data-voice-shortcut-action]').textContent = capturingPrimary
    ? 'Esc cancels'
    : 'Change';
  elements.voiceInputAlternateShortcut.querySelector('[data-voice-shortcut-action]').textContent = capturingAlternate
    ? 'Delete clears'
    : alternateShortcut ? 'Change' : 'Add';
  elements.voiceInputShortcut.setAttribute(
    'aria-label',
    capturingPrimary ? 'Press the primary activation shortcut' : `Change primary shortcut, currently ${shortcutLabel}`,
  );
  elements.voiceInputAlternateShortcut.setAttribute(
    'aria-label',
    capturingAlternate
      ? 'Press the alternate activation shortcut, or Delete to clear it'
      : alternateShortcutLabel
        ? `Change alternate shortcut, currently ${alternateShortcutLabel}`
        : 'Add an alternate activation shortcut',
  );
  elements.voiceInputSetup.disabled = !supported || installing || engineHealthy;
  elements.voiceInputSetup.textContent = installing
    ? 'Setting up...'
    : engineHealthy
      ? 'Engine ready'
      : state.voiceInputEngine.state === 'error'
        ? 'Repair engine'
        : 'Set up engine';
  elements.voiceInputStatus.textContent = voiceEngineSettingsCopy();
  elements.voiceInputStatus.dataset.state = state.voiceInputEngine.state || 'checking';

  const activity = state.voiceInputActivity;
  let holdLabel = `Hold ${activationLabel} to talk`;
  let status = state.voiceInputMessage || 'Release to transcribe locally.';
  if (!enabled) {
    holdLabel = 'Turn on voice input';
    status = 'Enable push-to-talk in Settings.';
  } else if (!engineReady) {
    holdLabel = installing ? 'Setting up voice input' : 'Set up voice input';
    status = voiceEngineSettingsCopy();
  } else if (activity === 'requesting') {
    holdLabel = 'Keep holding';
    status = 'Requesting microphone access.';
  } else if (activity === 'listening') {
    holdLabel = 'Listening';
    const source = state.voiceInputDeviceLabel || 'the selected microphone';
    status = voiceSignalDetected(state.voiceInputPeakLevel)
      ? `Speech signal detected on ${source}. Release to transcribe.`
      : `Using ${source}. Speak now and watch the level.`;
  } else if (activity === 'processing') {
    holdLabel = 'Recording complete';
    status = 'Finishing the audio clip.';
  } else if (activity === 'transcribing') {
    holdLabel = 'Transcribing';
    status = 'Running faster-whisper on CPU.';
  }
  elements.voiceInputComposer.dataset.state = activity;
  elements.voiceInputHoldLabel.textContent = holdLabel;
  elements.voiceInputComposerStatus.textContent = status;
  elements.voiceInputHold.disabled = !supported || installing || activity === 'transcribing';
  elements.voiceInputHold.setAttribute('aria-pressed', String(activity === 'listening'));
  elements.voiceInputHold.title = status;
  renderVoiceInputLevel();
}

function openVoiceInputSettings() {
  resetTerminalLayoutStatus();
  renderCompletionAlertSettings();
  renderQuickSkillEditor({ rebuild: true });
  renderVoiceInput();
  if (!elements.terminalSettingsModal.open) elements.terminalSettingsModal.showModal();
  void refreshVoiceInputDevices({ requestPermission: state.voiceInputPreferences.enabled });
  requestAnimationFrame(() => {
    if (!state.voiceInputPreferences.enabled) elements.voiceInputEnabled.focus();
    else if (state.voiceInputEngine.state !== 'ready') elements.voiceInputSetup.focus();
  });
}

async function setupVoiceInput() {
  if (state.voiceInputSetupPending || !voiceInputSupported()) return;
  state.voiceInputSetupPending = true;
  state.voiceInputEngine = { ...state.voiceInputEngine, state: 'installing' };
  renderVoiceInput();
  try {
    const status = await api('/api/voice-input/setup', {
      method: 'POST',
      body: '{}',
      timeoutMs: 12 * 60 * 1000,
      timeoutMessage: (seconds) => `Voice setup did not answer within ${seconds} seconds. It may still be downloading the local model.`,
    });
    adoptVoiceInputStatus(status);
  } catch (error) {
    state.voiceInputEngine = {
      ...state.voiceInputEngine,
      state: 'error',
      installed: false,
      error: error.message,
    };
  } finally {
    state.voiceInputSetupPending = false;
    renderVoiceInput();
  }
}

function voiceMicrophoneError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return 'Microphone access was denied. Allow CC Relay to use the microphone, then try again.';
  }
  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
    return 'No microphone is available.';
  }
  return error?.message || 'CC Relay could not record the microphone.';
}

function setVoiceInputActivity(activity, message = '') {
  if (activity === 'requesting') {
    state.voiceInputLevel = 0;
    state.voiceInputPeakLevel = 0;
  }
  state.voiceInputActivity = activity;
  state.voiceInputMessage = message;
  renderVoiceInput();
}

function insertVoiceTranscript(text) {
  const transcript = String(text || '').trim();
  if (!transcript) return false;
  const start = Number.isInteger(elements.prompt.selectionStart)
    ? elements.prompt.selectionStart
    : elements.prompt.value.length;
  const end = Number.isInteger(elements.prompt.selectionEnd)
    ? elements.prompt.selectionEnd
    : start;
  const before = elements.prompt.value.slice(0, start);
  const after = elements.prompt.value.slice(end);
  const leading = before && !/[\s([{]$/.test(before) ? ' ' : '';
  const trailing = after && !/^[\s,.;:!?)]/.test(after) ? ' ' : '';
  const replacement = `${leading}${transcript}${trailing}`;
  elements.prompt.setRangeText(replacement, start, end, 'end');
  elements.prompt.dispatchEvent(new Event('input', { bubbles: true }));
  elements.prompt.focus();
  saveProjectComposerState();
  return true;
}

function voiceInputNoSpeechMessage(audio, recording = {}) {
  const source = String(recording.deviceLabel || state.voiceInputDeviceLabel || '').trim();
  if (voiceRecordingLooksSilent(audio, recording.durationMs)) {
    return `${source || 'The selected microphone'} captured only digital silence. Choose another input in Settings.`;
  }
  if (Number.isFinite(recording.peakSignalLevel) && !voiceSignalDetected(recording.peakSignalLevel)) {
    return `No speech signal reached Relay from ${source || 'the selected microphone'}. Choose another input in Settings or move closer to the microphone.`;
  }
  if (voiceSignalDetected(recording.peakSignalLevel)) {
    return `Relay heard audio from ${source || 'the selected microphone'} but could not recognize words. Speak a full sentence and try again.`;
  }
  return source
    ? `No speech was detected from ${source}. Hold the keys and try again.`
    : 'No speech was detected from the selected microphone. Hold the keys and try again.';
}

async function transcribeVoiceAudio(audio, recording = {}) {
  if (audio instanceof Blob && voiceRecordingLooksSilent(audio, recording.durationMs)) {
    setVoiceInputActivity('error', voiceInputNoSpeechMessage(audio, recording));
    return;
  }
  if (!(audio instanceof Blob) || audio.size < 256) {
    const message = audio instanceof Blob && recording.durationMs >= 400
      ? voiceInputNoSpeechMessage(audio, recording)
      : 'Hold push-to-talk a little longer so Relay can hear you.';
    setVoiceInputActivity('error', message);
    return;
  }
  setVoiceInputActivity('transcribing');
  try {
    const result = await api('/api/voice-input/transcribe', {
      method: 'POST',
      body: audio,
      headers: { 'Content-Type': audio.type || 'audio/webm' },
      timeoutMs: 2 * 60 * 1000,
      timeoutMessage: () => 'Voice transcription did not finish within two minutes.',
    });
    if (!insertVoiceTranscript(result.text)) {
      setVoiceInputActivity('idle', voiceInputNoSpeechMessage(audio, recording));
      return;
    }
    if (state.status?.voiceInput) {
      state.status.voiceInput = { ...state.status.voiceInput, state: 'ready', workerReady: true };
    }
    state.voiceInputEngine = { ...state.voiceInputEngine, state: 'ready', installed: true, workerReady: true };
    setVoiceInputActivity('idle', 'Dictation added to the task prompt.');
  } catch (error) {
    setVoiceInputActivity('error', error.message);
  }
}

function startVoiceInput() {
  if (state.voiceInputActivity === 'transcribing' || state.voiceInputSetupPending) return;
  if (
    !voiceInputSupported()
    || !state.voiceInputPreferences.enabled
    || !voiceEngineReady()
  ) {
    openVoiceInputSettings();
    return;
  }
  state.voiceInputMessage = '';
  void voiceRecorder.press();
}

function setRunningTaskLayout(value, { persist = true } = {}) {
  state.runningTaskLayout = normalizeRunningTaskLayout(value);
  document.documentElement.dataset.runningTaskRows = String(state.runningTaskLayout.rows);
  document.documentElement.dataset.runningTaskWidth = String(state.runningTaskLayout.width);
  elements.runningTaskRows.value = String(state.runningTaskLayout.rows);
  elements.runningTaskWidth.value = String(state.runningTaskLayout.width);
  renderHeaderRunningTasks();
  if (persist) queueUiPreferencesSave();
  requestAnimationFrame(syncHeaderHeight);
}

// begin ui preferences save
/*
 * This must track the JSON body cap on PATCH /api/ui-preferences in src/server.mjs. Quick-skill
 * prompts are the only member large enough to reach it, and a body over the cap is refused on
 * the wire, so the size is measured here and explained in the editor rather than discovered as
 * a silent failure. The margin covers request framing and members the payload gains later; move
 * this number and the route cap together or neither.
 */
const MAX_UI_PREFERENCES_PAYLOAD_BYTES = 1024 * 1024 - 16 * 1024;

function uiPreferencesPayloadIssue(serialized) {
  // Byte length, not string length: one emoji or accented character in a prompt is several
  // bytes on the wire, and the route cap counts bytes.
  const bytes = new TextEncoder().encode(serialized).length;
  if (bytes <= MAX_UI_PREFERENCES_PAYLOAD_BYTES) return '';
  const used = Math.ceil(bytes / 1024);
  const cap = Math.floor(MAX_UI_PREFERENCES_PAYLOAD_BYTES / 1024);
  return `These settings are too large to save (${used} KB of ${cap} KB). Shorten a quick-action prompt, then the next edit saves.`;
}

/*
 * A refused save used to be a console warning alone, so the editor kept showing text the server
 * never accepted and the next reload replaced it with the stale record. The message goes to the
 * editor status line while terminal settings is open and to the composer alert otherwise, which
 * is the non-blocking notice every other failed composer action already uses.
 */
function reportUiPreferencesSaveIssue(message) {
  if (state.uiPreferencesSaveError === message) return;
  state.uiPreferencesSaveError = message;
  renderQuickSkillEditor();
  if (message && !elements.terminalSettingsModal?.open) setComposerAlert(message);
}

function queueUiPreferencesSave() {
  cacheUiPreferences();
  window.clearTimeout(state.uiPreferencesSaveTimer);
  state.uiPreferencesSaveTimer = window.setTimeout(async () => {
    state.uiPreferencesSaveTimer = null;
    // The request is built first so the size check measures the exact bytes that go on the wire
    // rather than a second serialization that could drift from it.
    const request = {
      method: 'PATCH',
      body: JSON.stringify(uiPreferencesPayload()),
    };
    const oversized = uiPreferencesPayloadIssue(request.body);
    if (oversized) {
      reportUiPreferencesSaveIssue(oversized);
      return;
    }
    try {
      await api('/api/ui-preferences', request);
      reportUiPreferencesSaveIssue('');
    } catch (error) {
      console.warn('Could not persist UI layout preferences.', error);
      reportUiPreferencesSaveIssue('Could not save these settings. The last change is only in this window until it succeeds.');
    }
  }, 100);
}
// end ui preferences save

async function restoreUiPreferences() {
  try {
    const body = await api('/api/ui-preferences');
    const preferences = body.preferences;
    if (!preferences) {
      queueUiPreferencesSave();
      return;
    }
    state.panelWidths = {
      composer: preferences.panelWidths.composer,
      queue: preferences.panelWidths.queue,
      legacyDetail: null,
    };
    state.terminalHeight = preferences.terminalHeight;
    setHeaderPosition(preferences.headerPosition, { persist: false });
    setRunningTaskLayout(preferences.runningTaskLayout, { persist: false });
    setCompletionAlertPreferences(preferences.completionAlerts, { persist: false });
    setVoiceInputPreferences(preferences.voiceInput, { persist: false });
    /*
     * Deliberately unlike terminalWindowView below. A record from a server that predates the
     * member carries no quick skills at all, and the contract for that is the built-in
     * catalog, so the value is passed through even when it is missing.
     */
    setQuickSkills(preferences.quickSkills, { persist: false });
    // An older server that predates the member returns nothing here. The localStorage
    // seed already in state stays, so the window still opens on the remembered view.
    if (preferences.terminalMode != null) state.terminalMode = preferences.terminalMode === 'activity' ? 'activity' : 'native';
    if (preferences.terminalWindowView != null) {
      setTerminalWindowView(preferences.terminalWindowView, { persist: false, render: false });
    }
    cacheUiPreferences(preferences);
    applyPanelWidths();
    applyTerminalHeight();
  } catch (error) {
    console.warn('Could not restore UI layout preferences.', error);
  }
}

async function migrateCompletionReviews() {
  try {
    await api('/api/tasks/completion-reviews/migrate', {
      method: 'POST',
      body: JSON.stringify({
        unreadTaskIds: state.projectCompletionNotifications.pendingReviewMigrationTaskIds(),
      }),
    });
    state.projectCompletionNotifications.completeReviewMigration();
  } catch (error) {
    console.warn('Could not migrate completion review state.', error);
  }
}

function projectProvider() {
  return state.taskMode === 'execute' ? state.selectedProvider : 'codex';
}

function normalizedPath(path) {
  return String(path || '').replace(/[\\/]+$/, '').replaceAll('\\', '/');
}

function sameProjectPath(left, right) {
  return normalizedPath(left) === normalizedPath(right);
}

function activeProject() {
  return state.projects.find((project) => sameProjectPath(project.path, state.activeProjectPath)) || null;
}

function usesDisposableTerminalPools() {
  return state.status?.capabilities?.disposableTerminalPools === true;
}

function usesSingleExecutorTurbo() {
  return state.status?.capabilities?.turboSingleExecutorPipeline === true;
}

function taskUsesSingleExecutorTurbo(task) {
  if (task?.mode !== 'turbo'
    || task?.terminal_lifecycle !== 'disposable'
    || !usesSingleExecutorTurbo()) return false;
  const legacyWorkers = Array.isArray(task.turbo?.workers) ? task.turbo.workers : [];
  return Boolean(task.turbo?.executionThreadId) || legacyWorkers.length === 0;
}

function turboPresentationTask(task) {
  if (task?.mode !== 'turbo') return task;
  return {
    ...task,
    turboSingleExecutor: taskUsesSingleExecutorTurbo(task),
  };
}

function taskNamingSupported() {
  return state.status?.capabilities?.queuedTaskNaming === true;
}

function taskTitleRenamingSupported() {
  return state.status?.capabilities?.taskTitleRenaming === true;
}

function taskStarringSupported() {
  return state.status?.capabilities?.taskStarring === true;
}

function terminalRetentionRequest(enabled = state.keepTerminalOpen) {
  return state.status?.capabilities?.retainedTerminalSessions === true
    && state.selectedProvider !== 'opencode'
    && enabled
    ? { keepTerminalOpen: true }
    : {};
}

function providerIsMissing(provider) {
  return providerInstallationState(state.status, provider) === 'missing';
}

function reconcileProviderSelection() {
  if (
    state.submitting
    || state.taskMode !== 'execute'
    || isExecuteCouncilEnabled()
  ) {
    return false;
  }
  const provider = availableProviderSelection(state.status, state.selectedProvider);
  if (provider === state.selectedProvider) return false;
  state.selectedProvider = provider;
  state.selectedThreadId = null;
  void loadModels(provider);
  return true;
}

function projectInstanceLimits(project = activeProject()) {
  return {
    codex: Number(project?.max_codex_instances || 1),
    claude: Number(project?.max_claude_instances || 1),
    opencode: Number(project?.max_opencode_instances || 1),
  };
}

function projectIdentityColorClass(path) {
  const projectIndex = state.projects.findIndex((project) => sameProjectPath(project.path, path));
  if (projectIndex < 0) return projectColorClass(path);
  return projectColorClasses(state.projects.map((project) => project.path))[projectIndex];
}

function projectIdentityCustomColor(path) {
  const project = state.projects.find((item) => sameProjectPath(item.path, path));
  return normalizeProjectColor(project?.color);
}

function projectIdentityStyleAttribute(path) {
  const tokens = projectColorTokens(projectIdentityCustomColor(path));
  if (!tokens) return '';
  return ` style="--project-accent-custom-light:${tokens.light};--project-accent-custom-dark:${tokens.dark}"`;
}

function applyProjectIdentityStyle(element, path) {
  for (let index = 1; index <= PROJECT_COLOR_COUNT; index += 1) {
    element.classList.remove(`project-color-${index}`);
  }
  element.style.removeProperty('--project-accent-custom-light');
  element.style.removeProperty('--project-accent-custom-dark');
  if (!path) return;
  element.classList.add(projectIdentityColorClass(path));
  const tokens = projectColorTokens(projectIdentityCustomColor(path));
  if (tokens) {
    element.style.setProperty('--project-accent-custom-light', tokens.light);
    element.style.setProperty('--project-accent-custom-dark', tokens.dark);
  }
}

function renderComposerProjectIdentity() {
  const project = activeProject();
  applyProjectIdentityStyle(elements.form, project?.path);
}

function projectTasks() {
  return tasksForScope(state.tasks, {
    projectPath: state.activeProjectPath,
  });
}

function projectThreads(provider = state.selectedProvider) {
  return state.threads.filter((thread) => (
    (!provider || threadProvider(thread) === provider)
    && (!state.activeProjectPath || sameProjectPath(thread.cwd, state.activeProjectPath))
  ));
}

function saveProjectComposerState(path = state.activeProjectPath) {
  state.projectComposerStore.save(path, {
    taskName: elements.taskName.value,
    prompt: elements.prompt.value,
    attachments: state.attachments,
    taskReferences: state.taskReferences,
    selectedTaskId: state.selectedTaskId,
    selectedThreadId: state.selectedThreadId,
    selectedProvider: state.selectedProvider,
    taskMode: state.taskMode,
    terminalSettings: {
      ...state.terminalSettings,
      layout: terminalLayout(),
    },
    executionSettings: state.executionSettings,
    threadExecutionSettings: state.threadExecutionSettings,
    planSettings: state.planSettings,
    turboSettings: state.turboSettings,
  });
}

function restoreProjectComposerState(path) {
  const session = state.projectComposerStore.load(path);
  elements.taskName.value = session.taskName || '';
  elements.prompt.value = session.prompt;
  elements.formMessage.textContent = '';
  setComposerAlert('');
  state.attachments = session.attachments;
  state.taskReferences = session.taskReferences || [];
  const selectedTask = state.tasks.find((task) => (
    task.id === session.selectedTaskId
    && sameProjectPath(task.repo_path, path)
  ));
  state.selectedTaskId = selectedTask?.id || null;
  state.selectedThreadId = session.selectedThreadId;
  state.selectedProvider = session.selectedProvider;
  state.taskMode = session.taskMode;
  state.terminalSettings = session.terminalSettings || initialComposerState.terminalSettings;
  state.executionSettings = {
    ...initialComposerState.executionSettings,
    ...(session.executionSettings || {}),
  };
  state.threadExecutionSettings = session.threadExecutionSettings || {};
  state.planSettings = session.planSettings;
  state.turboSettings = session.turboSettings;
  applyProjectTerminalSettings(
    state.projects.find((project) => sameProjectPath(project.path, path)),
    state.terminalSettings,
  );
}

function persistActiveProject(path) {
  if (
    !path
    || state.status?.capabilities?.sharedProjectConfig !== true
  ) return;
  const sequence = ++state.activeProjectSaveSequence;
  api('/api/projects/active', {
    method: 'POST',
    body: JSON.stringify({ path }),
  }).catch((error) => {
    if (sequence !== state.activeProjectSaveSequence) return;
    elements.formMessage.textContent = `Could not save the active project: ${error.message}`;
  });
}

function selectProject(path, { persist = true } = {}) {
  if (!path) return;
  const project = state.projects.find((item) => sameProjectPath(item.path, path));
  if (!project) return;
  if (sameProjectPath(project.path, state.activeProjectPath)) {
    applyProjectTerminalSettings(project, state.terminalSettings);
    if (persist) persistActiveProject(project.path);
    return;
  }
  if (state.activeProjectPath) saveProjectComposerState();
  state.activeProjectPath = project.path;
  localStorage.setItem('relay.activeProjectPath', state.activeProjectPath);
  if (persist) persistActiveProject(state.activeProjectPath);
  restoreProjectComposerState(state.activeProjectPath);
  state.parallelTaskIds.clear();
  if (taskSearchActive(state.taskSearchQuery)) {
    state.taskSearchResults = [];
    state.taskSearchTotal = 0;
    state.taskSearchPending = true;
    state.taskSearchError = '';
    scheduleTaskSearch(0);
  }
  hideTaskDetailPanel();
  selectMode(state.taskMode);
  renderProjects();
  renderTasks();
  renderStatus();
  if (state.selectedTaskId) {
    selectTask(state.selectedTaskId).catch((error) => {
      elements.queueSummary.textContent = error.message;
    });
  }
}

function projectCloseTarget() {
  return state.projects.find((project) => project.id === state.projectCloseTargetId) || null;
}

function setProjectCloseSubmitting(submitting) {
  state.projectCloseSubmitting = submitting;
  elements.projectCloseCard.setAttribute('aria-busy', String(submitting));
  elements.projectCloseDismiss.disabled = submitting;
  elements.projectCloseCancel.disabled = submitting;
  elements.projectCloseConfirm.disabled = submitting;
  elements.projectCloseConfirm.textContent = submitting ? 'Closing project...' : 'Close project';
}

function openProjectCloseConfirmation(project) {
  if (!project || state.projects.length <= 1 || state.projectCloseSubmitting) return;
  state.projectCloseTargetId = project.id;
  elements.projectCloseTitle.textContent = `Close ${project.name}?`;
  elements.projectCloseInitial.textContent = project.name.slice(0, 1).toUpperCase();
  elements.projectCloseName.textContent = project.name;
  elements.projectClosePath.textContent = project.path;
  elements.projectCloseMessage.textContent = '';
  applyProjectIdentityStyle(elements.projectCloseTarget, project.path);
  if (!elements.projectCloseModal.open) elements.projectCloseModal.showModal();
  elements.projectCloseCancel.focus();
}

function closeProjectCloseConfirmation() {
  if (state.projectCloseSubmitting) return;
  state.projectCloseTargetId = null;
  elements.projectCloseMessage.textContent = '';
  if (elements.projectCloseModal.open) elements.projectCloseModal.close();
}

async function confirmProjectClose() {
  if (state.projectCloseSubmitting) return;
  const project = projectCloseTarget();
  if (!project) {
    closeProjectCloseConfirmation();
    elements.formMessage.textContent = 'This project is already closed.';
    return;
  }
  setProjectCloseSubmitting(true);
  elements.projectCloseMessage.textContent = `Closing ${project.name}...`;
  try {
    await api(`/api/projects/${project.id}`, { method: 'DELETE' });
    state.projectComposerStore.delete(project.path);
    state.projectCloseTargetId = null;
    elements.projectCloseModal.close();
    try {
      await loadProjects();
      elements.formMessage.textContent = `${project.name} closed.`;
    } catch (error) {
      elements.formMessage.textContent = `${project.name} closed, but the Launchpad could not refresh: ${error.message}`;
    }
  } catch (error) {
    elements.projectCloseMessage.textContent = error.message;
  } finally {
    setProjectCloseSubmitting(false);
  }
}

function projectColorTarget() {
  return state.projects.find((project) => project.id === state.projectColorTargetId) || null;
}

function renderProjectColorPicker() {
  const project = projectColorTarget();
  if (!project) return;
  const selectedColor = normalizeProjectColor(state.projectColorDraft);
  elements.projectColorSubtitle.textContent = `Choose a bright identity for ${project.name}.`;
  elements.projectColorPreviewInitial.textContent = project.name.slice(0, 1).toUpperCase();
  elements.projectColorPreviewName.textContent = project.name;
  for (let index = 1; index <= PROJECT_COLOR_COUNT; index += 1) {
    elements.projectColorPreview.classList.remove(`project-color-${index}`);
  }
  elements.projectColorPreview.classList.add(projectIdentityColorClass(project.path));
  elements.projectColorPreview.style.removeProperty('--project-accent-custom-light');
  elements.projectColorPreview.style.removeProperty('--project-accent-custom-dark');
  const tokens = projectColorTokens(selectedColor);
  if (tokens) {
    elements.projectColorPreview.style.setProperty('--project-accent-custom-light', tokens.light);
    elements.projectColorPreview.style.setProperty('--project-accent-custom-dark', tokens.dark);
  }
  elements.projectColorPresetList.innerHTML = `
    <button class="project-color-preset project-color-preset-auto" type="button" data-project-color="" aria-pressed="${selectedColor === null}">
      <span class="project-color-preset-swatch" aria-hidden="true"></span>
      <span class="project-color-preset-label">Automatic</span>
      <span class="project-color-preset-check" aria-hidden="true">✓</span>
    </button>
    ${PROJECT_COLOR_PRESETS.map((preset) => `
      <button class="project-color-preset" type="button" data-project-color="${preset.value}" aria-pressed="${selectedColor === preset.value}" style="--swatch:${preset.value}">
        <span class="project-color-preset-swatch" aria-hidden="true"></span>
        <span class="project-color-preset-label">${escapeHtml(preset.name)}</span>
        <span class="project-color-preset-check" aria-hidden="true">✓</span>
      </button>
    `).join('')}
  `;
  const automaticIndex = Number(projectIdentityColorClass(project.path).split('-').pop()) - 1;
  const customValue = selectedColor || PROJECT_COLOR_PRESETS[automaticIndex]?.value || '#3b82f6';
  elements.projectColorCustomInput.value = customValue;
  elements.projectColorCustomValue.value = customValue.toUpperCase();
  elements.projectColorMessage.textContent = '';
}

function openProjectColorPicker(project) {
  if (!project || state.status?.capabilities?.projectColors !== true) return;
  state.projectColorTargetId = project.id;
  state.projectColorDraft = normalizeProjectColor(project.color);
  renderProjectColorPicker();
  if (!elements.projectColorModal.open) elements.projectColorModal.showModal();
}

function closeProjectColorPicker() {
  if (state.projectColorSaving) return;
  state.projectColorTargetId = null;
  state.projectColorDraft = null;
  if (elements.projectColorModal.open) elements.projectColorModal.close();
}

async function saveProjectColor() {
  const project = projectColorTarget();
  if (!project || state.projectColorSaving) return;
  state.projectColorSaving = true;
  elements.projectColorSave.disabled = true;
  elements.projectColorCancel.disabled = true;
  elements.projectColorClose.disabled = true;
  elements.projectColorMessage.textContent = '';
  try {
    const body = await api(`/api/projects/${project.id}/color`, {
      method: 'PATCH',
      body: JSON.stringify({ color: normalizeProjectColor(state.projectColorDraft) }),
    });
    state.projects = state.projects.map((item) => (
      item.id === body.project.id ? body.project : item
    ));
    state.projectColorTargetId = null;
    state.projectColorDraft = null;
    elements.projectColorModal.close();
    renderProjects();
    renderTasks();
    renderStatus();
    elements.formMessage.textContent = `${project.name} color updated.`;
  } catch (error) {
    elements.projectColorMessage.textContent = error.message;
  } finally {
    state.projectColorSaving = false;
    elements.projectColorSave.disabled = false;
    elements.projectColorCancel.disabled = false;
    elements.projectColorClose.disabled = false;
  }
}

function projectReorderSupported() {
  return state.status?.capabilities?.projectReorder === true && state.projects.length > 1;
}

function clearProjectDropMarkers() {
  for (const chip of elements.projectList.querySelectorAll('.project-chip')) {
    chip.classList.remove('project-drop-before', 'project-drop-after', 'project-dragging');
  }
}

function cleanupProjectDrag({ suppressClick = false } = {}) {
  clearProjectDropMarkers();
  elements.projectList.style.removeProperty('--project-drag-accent');
  state.projectDrag = null;
  if (!suppressClick) return;
  state.projectDragClickSuppressed = true;
  window.setTimeout(() => {
    state.projectDragClickSuppressed = false;
  }, 0);
}

function projectDropEdge(event, chip) {
  const bounds = chip.getBoundingClientRect();
  return event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after';
}

function scrollProjectListForDrag(clientX) {
  const bounds = elements.projectList.getBoundingClientRect();
  const edge = Math.min(40, bounds.width / 4);
  if (clientX < bounds.left + edge) elements.projectList.scrollLeft -= 16;
  else if (clientX > bounds.right - edge) elements.projectList.scrollLeft += 16;
}

function orderedProjects(projectIds) {
  const projectsById = new Map(state.projects.map((project) => [project.id, project]));
  const projects = projectIds.map((id) => projectsById.get(id)).filter(Boolean);
  return projects.length === state.projects.length ? projects : null;
}

function focusProjectReorderHandle(projectId) {
  window.requestAnimationFrame(() => {
    elements.projectList
      .querySelector(`[data-project-id="${projectId}"] [data-project-action="reorder"]`)
      ?.focus();
  });
}

function projectListFocusTarget() {
  const active = document.activeElement;
  if (!active || !elements.projectList.contains(active)) return null;
  const chip = active.closest?.('[data-project-id]');
  const projectId = Number(chip?.dataset.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) return null;
  return {
    projectId,
    action: active.dataset?.projectAction || null,
  };
}

function restoreProjectListFocus(target) {
  if (!target) return;
  const chip = elements.projectList.querySelector(`[data-project-id="${target.projectId}"]`);
  const control = target.action
    ? chip?.querySelector(`[data-project-action="${target.action}"]`)
    : chip;
  control?.focus({ preventScroll: true });
}

async function persistProjectOrder(expectedProjectIds, projectIds, { focusProjectId = null } = {}) {
  if (state.projectReorderPending) return;
  const request = buildProjectReorderRequest(expectedProjectIds, projectIds);
  const optimisticProjects = request ? orderedProjects(request.projectIds) : null;
  if (!request || !optimisticProjects) {
    cleanupProjectDrag({ suppressClick: true });
    return;
  }
  const movedProject = optimisticProjects.find((project) => project.id === Number(focusProjectId));
  state.projectReorderPending = true;
  state.projects = optimisticProjects;
  cleanupProjectDrag({ suppressClick: true });
  elements.projectList.dataset.reordering = 'true';
  renderProjects();

  let body = null;
  let reorderError = null;
  try {
    body = await api('/api/projects/reorder', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  } catch (error) {
    reorderError = error;
  } finally {
    state.projectReorderPending = false;
    delete elements.projectList.dataset.reordering;
  }

  if (reorderError) {
    const message = /project order changed/i.test(reorderError.message)
      ? 'Project order changed elsewhere. Refreshed; try again.'
      : `Could not reorder projects: ${reorderError.message}`;
    elements.formMessage.textContent = message;
    elements.projectReorderStatus.textContent = message;
    try {
      await loadProjects();
    } catch (refreshError) {
      elements.formMessage.textContent = `${message} The Launchpad could not refresh: ${refreshError.message}`;
    }
  } else {
    if (Array.isArray(body?.projects)) state.projects = body.projects;
    renderProjects();
    const position = state.projects.findIndex((project) => project.id === movedProject?.id) + 1;
    const message = movedProject && position > 0
      ? `${movedProject.name} moved to position ${position} of ${state.projects.length}.`
      : 'Project order updated.';
    elements.projectReorderStatus.textContent = message;
  }
  if (focusProjectId) focusProjectReorderHandle(focusProjectId);
}

function renderProjects() {
  renderComposerProjectIdentity();
  if (state.projectDrag) return;
  const focusTarget = projectListFocusTarget();
  const supported = state.status?.capabilities?.projectLauncher === true;
  elements.addProjectButton.disabled = !supported;
  if (!supported) {
    elements.projectList.innerHTML = '<span class="project-empty">Restart CC Relay to enable project launching</span>';
    restoreProjectListFocus(focusTarget);
    return;
  }
  if (!state.projects.length) {
    elements.projectList.innerHTML = '<span class="project-empty">Add a project to start queueing work</span>';
    restoreProjectListFocus(focusTarget);
    return;
  }
  const colorClasses = projectColorClasses(state.projects.map((project) => project.path));
  const reorderable = projectReorderSupported();
  elements.projectList.innerHTML = state.projects.map((project, index) => {
    const activity = projectActivity(project.path);
    const notificationCount = state.projectCompletionNotifications.count(project.path);
    const completionNotice = notificationCount
      ? ` ${notificationCount} finished task${notificationCount === 1 ? '' : 's'} not checked.`
      : '';
    const reorderNotice = reorderable ? ' Draggable project.' : '';
    const accessibleLabel = `${project.name}, ${activity.status}. ${activity.label}.${completionNotice}${reorderNotice}`;
    return `
    <article class="project-chip ${reorderable ? 'project-chip-reorderable' : ''} ${colorClasses[index]} ${sameProjectPath(project.path, state.activeProjectPath) ? 'selected' : ''}"${projectIdentityStyleAttribute(project.path)} data-activity="${activity.state}" data-project-id="${project.id}" data-project-path="${escapeHtml(project.path)}" title="${escapeHtml(project.path)}" tabindex="0" role="button" aria-label="${escapeHtml(accessibleLabel)}" aria-pressed="${sameProjectPath(project.path, state.activeProjectPath)}">
      ${reorderable ? `<span class="project-drag-handle" data-project-action="reorder" draggable="${!state.projectReorderPending}" role="button" tabindex="0" aria-disabled="${state.projectReorderPending}" aria-label="Reorder ${escapeHtml(project.name)}. Drag, or use Left and Right arrow keys." aria-keyshortcuts="ArrowLeft ArrowRight" title="Drag to reorder projects">⠿</span>` : ''}
      <div class="project-chip-head">
        <button class="project-pin" type="button" data-project-action="color" aria-label="Change ${escapeHtml(project.name)} color" title="Change project color" ${state.status?.capabilities?.projectColors === true ? '' : 'disabled'}>
          ${escapeHtml(project.name.slice(0, 1).toUpperCase())}
          ${notificationCount ? `<span class="project-notification">${notificationCount > 9 ? '9+' : notificationCount}</span>` : ''}
        </button>
        <span class="project-copy"><strong>${escapeHtml(project.name)}</strong></span>
      </div>
      <div class="project-chip-foot">
        <span class="project-activity"><i aria-hidden="true"></i><strong>${escapeHtml(activity.status)}</strong></span>
      </div>
      <button class="project-unpin" type="button" data-project-action="delete" aria-label="Close ${escapeHtml(project.name)}" ${state.projects.length === 1 ? 'disabled title="Add another project before closing this project"' : ''}>×</button>
    </article>
  `;
  }).join('');
  restoreProjectListFocus(focusTarget);
}

function projectActivity(path) {
  const tasks = state.tasks.filter((task) => sameProjectPath(task.repo_path, path));
  const running = tasks.filter((task) => task.status === 'running');
  const openSessions = tasks.filter((task) => task.status === 'open' && isManualSessionTask(task));
  const queued = tasks.filter((task) => task.status === 'queued');
  if (running.length > 0) {
    const task = running[0];
    return {
      state: 'running',
      status: 'Running',
      label: `Task #${task.id}${queued.length ? `, ${queued.length} waiting` : ''}`,
    };
  }
  if (openSessions.length > 0) {
    return {
      state: 'session',
      status: openSessions.length === 1 ? 'Session open' : 'Sessions open',
      label: `${openSessions.length} terminal session${openSessions.length === 1 ? '' : 's'} ready${queued.length ? `, ${queued.length} waiting` : ''}`,
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
      status: staleClaudeScheduler || staleScheduler ? 'Restart needed' : 'Waiting',
      label: staleClaudeScheduler
        ? `${queued.length} queued. Restart CC Relay for parallel Claude projects`
        : staleScheduler
        ? `${queued.length} queued. Restart CC Relay for separate project queues`
        : `${queued.length} task${queued.length === 1 ? '' : 's'} queued`,
    };
  }
  const latest = tasks.reduce((current, task) => !current || task.id > current.id ? task : current, null);
  if (latest && ['failed', 'interrupted'].includes(latest.status)) {
    return { state: 'error', status: 'Attention', label: `Task #${latest.id} ${latest.status}` };
  }
  const uncheckedCompletions = state.projectCompletionNotifications.count(path);
  if (uncheckedCompletions > 0) {
    const latestFinishedTaskId = state.projectCompletionNotifications.latestTaskId(path);
    return {
      state: 'complete',
      status: 'Finished',
      label: `${uncheckedCompletions} task${uncheckedCompletions === 1 ? '' : 's'} not checked, latest task #${latestFinishedTaskId}`,
    };
  }
  return {
    state: 'idle',
    status: 'Idle',
    label: latest?.status === 'complete' ? `Last completed task #${latest.id}` : 'Ready for work',
  };
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
    && (
      task.turbo?.executionThreadId === thread.id
      || task.turbo?.workers?.some((worker) => worker.threadId === thread.id)
    ));
  if (workerTurbo) {
    const executor = workerTurbo.turbo?.executionThreadId === thread.id;
    return { state: 'running', label: `Turbo ${executor ? 'executor' : 'worker'} · Task #${workerTurbo.id}` };
  }
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
  if (state.projectDrag || state.projectReorderPending) return;
  if (state.status?.capabilities?.projectLauncher !== true) {
    renderProjects();
    return;
  }
  const body = await api('/api/projects');
  await textSelectionGuard.waitForClear();
  state.projects = body.projects || [];
  const sharedActiveProject = state.projects.find(
    (project) => sameProjectPath(project.path, body.activeProjectPath),
  );
  if (!state.projectConfigLoaded) {
    state.projectConfigLoaded = true;
    if (sharedActiveProject) {
      selectProject(sharedActiveProject.path, { persist: false });
    } else if (state.projects.some(
      (project) => sameProjectPath(project.path, state.activeProjectPath),
    )) {
      persistActiveProject(state.activeProjectPath);
    }
  }
  if (state.projects.length && !state.projects.some((project) => sameProjectPath(project.path, state.activeProjectPath))) {
    const selectedThread = state.threads.find((thread) => thread.id === state.selectedThreadId);
    const initialProject = sharedActiveProject
      || state.projects.find((project) => sameProjectPath(project.path, selectedThread?.cwd))
      || state.projects.find((project) => state.threads.some((thread) => sameProjectPath(project.path, thread.cwd)))
      || state.projects[0];
    selectProject(initialProject.path);
  }
  if (!state.projectSettingsSaving && !projectTerminalSettingIsFocused()) {
    applyProjectTerminalSettings(activeProject(), state.terminalSettings);
  }
  renderProjects();
}

async function chooseProject(launch, provider = projectProvider()) {
  const previousIds = new Set(state.threads.map((thread) => thread.id));
  elements.addProjectButton.disabled = true;
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
    return 'Could not open a Codex CC Relay. If Codex says an update is required in the terminal, update Codex, then try again.';
  }
  return 'Could not open a Claude CC Relay. Check the terminal for details, then try again.';
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
    elements.formMessage.textContent = `${providerLabel(threadProvider(thread))} connected, but CC Relay could not verify its exact native window. Close is unavailable for this session.`;
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
      if (
        provider === 'claude'
        && isExecuteCouncilEnabled()
        && isPlanCouncilTerminalExecutionEnabled()
      ) {
        state.planSettings.authorThreadId = thread.id;
        renderPlanControls();
        renderThreads();
        elements.formMessage.textContent = `Claude council terminal is ready in ${workspaceName(path)}.`;
        return thread;
      }
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
      ? 'Restart CC Relay once to enable image attachments.'
      : isExecuteCouncilEnabled()
        ? 'Sent to Claude and Codex throughout the review loop.'
        // A Turbo prompt is delivered more than once. The planner and executor both receive
        // the images, and an optional council adds its second provider stage.
        : state.taskMode === 'turbo'
          ? usesDisposableTerminalPools() && usesSingleExecutorTurbo()
            ? state.turboSettings.councilEnabled
              ? 'Sent to both Plan council stages and to the execution session.'
              : 'Sent to the Turbo planner and to the execution session.'
            : state.turboSettings.councilEnabled
              ? 'Sent to both Plan council planners and to every worker turn.'
              : 'Sent to the Turbo planner and to every worker turn.'
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
      setComposerAlert('');
      renderAttachmentComposer();
      updateSubmitState();
    });
  }
}

function renderTaskReferences() {
  const references = state.taskReferences;
  elements.taskReferences.hidden = references.length === 0;
  elements.taskReferenceCount.textContent = `${references.length} task${references.length === 1 ? '' : 's'}`;
  elements.taskReferenceList.innerHTML = references.map((reference) => {
    const counts = taskReferenceCounts(reference);
    const number = String(reference.taskId).padStart(3, '0');
    return `
      <article class="task-reference-item" data-task-reference-id="${reference.taskId}">
        <span class="task-reference-ticket" aria-hidden="true">#${number}</span>
        <span class="task-reference-copy">
          <strong title="${escapeHtml(reference.title)}">${escapeHtml(reference.title)}</strong>
          <small>${counts.prompts} message${counts.prompts === 1 ? '' : 's'} · ${counts.responses} response${counts.responses === 1 ? '' : 's'}</small>
        </span>
        <label class="task-reference-scope">
          <span>Include</span>
          <select aria-label="Content from task ${number}">
            <option value="prompts" ${reference.scope === 'prompts' ? 'selected' : ''}>My messages</option>
            <option value="responses" ${reference.scope === 'responses' ? 'selected' : ''} ${counts.responses === 0 ? 'disabled' : ''}>AI responses</option>
            <option value="both" ${reference.scope === 'both' ? 'selected' : ''} ${counts.responses === 0 ? 'disabled' : ''}>Both</option>
          </select>
        </label>
        <button type="button" data-remove-task-reference="${reference.taskId}" aria-label="Remove task ${number} reference">×</button>
      </article>
    `;
  }).join('');

  for (const item of elements.taskReferenceList.querySelectorAll('[data-task-reference-id]')) {
    const taskId = Number(item.dataset.taskReferenceId);
    item.querySelector('select')?.addEventListener('input', (event) => {
      state.taskReferences = state.taskReferences.map((reference) => (
        reference.taskId === taskId
          ? updateTaskReferenceScope(reference, event.target.value)
          : reference
      ));
      setComposerAlert('');
      renderTaskReferences();
      updateSubmitState();
    });
    item.querySelector('[data-remove-task-reference]')?.addEventListener('click', () => {
      state.taskReferences = state.taskReferences.filter((reference) => reference.taskId !== taskId);
      setComposerAlert('');
      renderTaskReferences();
      updateSubmitState();
    });
  }
}

function closeTaskReferenceMenu({ restoreFocus = false } = {}) {
  const taskId = state.taskReferenceMenuTaskId;
  elements.taskReferenceMenu.hidden = true;
  state.taskReferenceMenuTaskId = null;
  if (restoreFocus && taskId !== null) {
    elements.taskList.querySelector(`[data-task-id="${taskId}"]`)?.focus();
  }
}

function openTaskReferenceMenu(task, { x, y, focus = false }) {
  if (!task) return;
  state.taskReferenceMenuTaskId = task.id;
  elements.taskReferenceMenuName.textContent = `#${String(task.id).padStart(3, '0')} · ${taskDisplayName(task)}`;
  elements.taskReferenceMenu.hidden = false;
  elements.taskReferenceMenu.style.left = '0px';
  elements.taskReferenceMenu.style.top = '0px';
  const rect = elements.taskReferenceMenu.getBoundingClientRect();
  const edge = 8;
  const left = Math.max(edge, Math.min(x, window.innerWidth - rect.width - edge));
  const top = Math.max(edge, Math.min(y, window.innerHeight - rect.height - edge));
  elements.taskReferenceMenu.style.left = `${left}px`;
  elements.taskReferenceMenu.style.top = `${top}px`;
  if (focus) elements.taskReferenceMenu.querySelector('[role="menuitem"]')?.focus();
}

async function attachTaskReference(taskId, scope) {
  const sourceTask = state.tasks.find((task) => task.id === taskId);
  if (!sourceTask) {
    setComposerAlert('That task is no longer available.');
    return;
  }
  const projectPath = state.activeProjectPath;
  const sequence = (state.taskReferenceLoadSequences.get(taskId) || 0) + 1;
  state.taskReferenceLoadSequences.set(taskId, sequence);
  closeTaskReferenceMenu();
  setComposerAlert(`Attaching task ${taskId} ${taskReferenceScopeLabel(scope).toLowerCase()}...`, 'notice');
  try {
    const detail = await api(`/api/tasks/${taskId}`);
    if (state.taskReferenceLoadSequences.get(taskId) !== sequence) return;
    if (!sameProjectPath(projectPath, state.activeProjectPath)) return;
    if (!sameProjectPath(detail.task?.repo_path, state.activeProjectPath)) {
      throw new Error('Task references must come from the active project.');
    }
    const reference = createTaskReference(detail, scope);
    const existingIndex = state.taskReferences.findIndex((item) => item.taskId === taskId);
    if (existingIndex === -1) state.taskReferences = [...state.taskReferences, reference];
    else state.taskReferences = state.taskReferences.map((item, index) => (
      index === existingIndex ? reference : item
    ));
    renderTaskReferences();
    const issue = taskReferencePromptIssue(elements.prompt.value, state.taskReferences);
    setComposerAlert(issue || `Task ${taskId} attached with ${taskReferenceScopeLabel(scope).toLowerCase()}.`, issue ? 'validation' : 'notice');
    updateSubmitState();
    elements.prompt.focus();
  } catch (error) {
    if (state.taskReferenceLoadSequences.get(taskId) !== sequence) return;
    setComposerAlert(error.message, 'validation');
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
    setComposerAlert('Restart CC Relay once to enable image attachments.');
    return;
  }
  const result = await mergeImageFiles(fileList, state.attachments);
  state.attachments = result.attachments;
  // Attachment problems belong to the composer, not to the shared status channel. A clean
  // add writes nothing, so the live region stays quiet when there is nothing to say.
  if (result.errors.length > 0) {
    setComposerAlert(result.errors.join(' '), 'validation');
  }
  renderAttachmentComposer();
  updateSubmitState();
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
    elements.continuationMessage.textContent = 'Restart CC Relay to add images to follow-up messages.';
    renderTaskContinuation(task);
    return;
  }
  // Copy the FileList before the input is reset. Per-task serialization preserves quick
  // consecutive additions, while Clear images invalidates every merge already in flight.
  const files = [...fileList];
  const update = await state.continuationAttachments.merge(
    task.id,
    (current) => mergeImageFiles(files, current),
  );
  if (!update.committed || state.selectedTaskForEvents?.id !== task.id) return;
  const { result } = update;
  elements.continuationMessage.dataset.kind = result.errors.length > 0 ? 'error' : 'hint';
  if (result.errors.length > 0) elements.continuationMessage.textContent = result.errors.join(' ');
  renderTaskContinuation(state.selectedTaskForEvents);
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

function taskLifecycleDatesMarkup(task, formatter = formatCardTime) {
  return taskLifecycleDates(task).map((date) => `
    <span class="task-lifecycle-date" data-date="${date.key}" data-pending="${date.value ? 'false' : 'true'}">
      <small>${date.label}</small>
      ${date.value
        ? `<time datetime="${escapeHtml(date.value)}">${escapeHtml(formatter(date.value))}</time>`
        : `<span>${date.pendingLabel}</span>`}
    </span>
  `).join('');
}

function taskCardDatesMarkup(task) {
  const dates = taskLifecycleDates(task);
  return dates.map((date, index) => {
    const sameDay = index > 0 && date.value && dates[0].value
      && new Date(date.value).toDateString() === new Date(dates[0].value).toDateString();
    const label = date.value ? formatCardTime(date.value) : date.pendingLabel;
    const visible = date.value ? (sameDay ? label.slice(-5) : label) : '-';
    return `<span class="task-lifecycle-date" title="${escapeHtml(`${date.label}: ${label}`)}">${date.value
      ? `<time datetime="${escapeHtml(date.value)}">${escapeHtml(visible)}</time>`
      : `<span aria-label="${escapeHtml(label)}">${visible}</span>`}</span>`;
  }).join('');
}

function workspaceName(path) {
  // normalizedPath folds Windows separators, so a C:\Users\Pat\proj workspace shows its
  // folder name here instead of the whole path.
  const clean = normalizedPath(path);
  return clean.split('/').filter(Boolean).pop() || clean || 'Unknown workspace';
}

function compactText(value, limit) {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  return compact.length > limit ? `${compact.slice(0, limit - 3)}...` : compact;
}

function taskDisplayName(task) {
  return String(task?.title || '').trim() || compactText(task?.prompt, 80) || 'Untitled task';
}

function taskInspectorDefinition(task) {
  const title = String(task?.title || '').replace(/\s+/g, ' ').trim();
  const prompt = String(task?.prompt || '').replace(/\s+/g, ' ').trim();
  const generatedTitle = compactText(prompt, 80);
  return title && title !== generatedTitle ? title : prompt || title || 'Untitled task';
}

function taskHasCustomName(task) {
  return taskDisplayName(task) !== compactText(task?.prompt, 80);
}

function focusTaskCardControl(taskId, selector) {
  requestAnimationFrame(() => {
    elements.taskList
      .querySelector(`[data-task-id="${taskId}"] ${selector}`)
      ?.focus();
  });
}

function mergeTaskUpdate(updated) {
  if (!updated) return;
  state.tasks = state.tasks.map((task) => task.id === updated.id ? { ...task, ...updated } : task);
  state.runningTasks = state.runningTasks.map((task) => task.id === updated.id ? { ...task, ...updated } : task);
  if (state.selectedTaskForEvents?.id === updated.id) {
    state.selectedTaskForEvents = { ...state.selectedTaskForEvents, ...updated };
    elements.detailTaskName.textContent = taskInspectorDefinition(updated);
    elements.detailTaskName.title = taskInspectorDefinition(updated);
  }
}

function startTaskTitleRename(task) {
  if (!taskTitleRenamingSupported() || task?.mode === 'breakdown') return;
  state.taskTitleRename = {
    taskId: task.id,
    value: taskDisplayName(task),
    saving: false,
    error: '',
  };
  renderTasks();
  requestAnimationFrame(() => {
    const input = elements.taskList.querySelector(
      `[data-task-id="${task.id}"] [data-task-title-input]`,
    );
    input?.focus();
    input?.select();
  });
}

function cancelTaskTitleRename(taskId) {
  if (state.taskTitleRename?.taskId !== taskId || state.taskTitleRename.saving) return;
  state.taskTitleRename = null;
  renderTasks();
  focusTaskCardControl(taskId, '[data-rename-task]');
}

async function saveTaskTitleRename(taskId) {
  const rename = state.taskTitleRename;
  if (!rename || rename.taskId !== taskId || rename.saving) return;
  rename.saving = true;
  rename.error = '';
  const form = elements.taskList.querySelector(
    `[data-task-id="${taskId}"] [data-task-title-form]`,
  );
  for (const control of form?.querySelectorAll('input, button') || []) control.disabled = true;
  try {
    const body = await api(`/api/tasks/${taskId}/title`, {
      method: 'PATCH',
      body: JSON.stringify({ title: rename.value }),
    });
    mergeTaskUpdate(body.task);
    state.taskTitleRename = null;
    renderHeaderRunningTasks();
    renderTasks();
    elements.queueSummary.textContent = `Task ${String(taskId).padStart(3, '0')} renamed`;
    if (taskSearchActive(state.taskSearchQuery)) scheduleTaskSearch(0);
    focusTaskCardControl(taskId, '[data-rename-task]');
  } catch (error) {
    rename.saving = false;
    rename.error = error.message;
    for (const control of form?.querySelectorAll('input, button') || []) control.disabled = false;
    const message = form?.querySelector('.task-inline-rename-message');
    if (message) {
      message.hidden = false;
      message.textContent = error.message;
    }
    form?.querySelector('[data-task-title-input]')?.focus();
  }
}

async function toggleTaskStar(task) {
  if (!taskStarringSupported() || state.taskStarSavingIds.has(task.id)) return;
  const nextStarred = task.starred !== true;
  state.taskStarSavingIds.add(task.id);
  renderTasks();
  try {
    const body = await api(`/api/tasks/${task.id}/star`, {
      method: 'PATCH',
      body: JSON.stringify({ starred: nextStarred }),
    });
    mergeTaskUpdate(body.task);
    renderHeaderRunningTasks();
    elements.queueSummary.textContent = nextStarred
      ? `Task ${String(task.id).padStart(3, '0')} moved to Starred`
      : `Task ${String(task.id).padStart(3, '0')} removed from Starred`;
  } catch (error) {
    elements.queueSummary.textContent = error.message;
  } finally {
    state.taskStarSavingIds.delete(task.id);
    renderTasks();
    focusTaskCardControl(task.id, '[data-star-task]');
  }
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
    if (event.payload?.provider === 'opencode' || event.kind === 'opencode') {
      return 'opencode';
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
  const elapsed = formatTaskDuration(task);
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

const SUB_AGENT_STATUS_LABELS = {
  running: 'Running',
  backgrounded: 'In background',
  finished: 'Finished',
};

/* Plan checklist ---------------------------------------------------------------
   One provider-neutral checklist for both Codex `turn/plan/updated` and Claude
   `claude/plan`. Status is carried by glyph, color, and weight together, never by
   color alone, and the step word rides along for assistive technology. */
const PLAN_STEP_GLYPHS = {
  completed: '✔',
  inProgress: '▸',
  pending: '☐',
  unfinished: '◌',
};

const PLAN_STEP_LABELS = {
  completed: 'Completed',
  inProgress: 'In progress',
  pending: 'Pending',
  unfinished: 'Unfinished',
};

// The copied log stays plain text, so the checklist copies as text markers.
const PLAN_STEP_MARKERS = {
  completed: '[x]',
  inProgress: '[>]',
  pending: '[ ]',
  unfinished: '[~]',
};

// A step still in progress when the turn ended is not being worked on any more. The stored
// plan is never rewritten: only the reading changes, so the step keeps its place in the
// checklist and reads as left unfinished instead of as currently working.
const PLAN_ENDED_STEP_STATUS = 'unfinished';

/* Bounds on provider-controlled plan and goal text ---------------------------------
   Steps, explanations, and objectives are provider output with no count or length
   limit of their own, and this row is rebuilt on every poll, so one plan must not be
   able to grow into hundreds of kilobytes of markup. Nothing is dropped in silence:
   the count cap reports its own remainder on a visible line, clipped text keeps an
   ellipsis plus a bounded hover title, and the copied log stays lossless because it
   copies from the unclamped details rather than from the row. */
const PLAN_STEP_LIMIT = 50;
const PLAN_STEP_TEXT_LIMIT = 220;
const PLAN_EXPLANATION_LIMIT = 600;
const PLAN_OWNER_LIMIT = 48;
const GOAL_OBJECTIVE_LIMIT = 300;
const REASONING_PREVIEW_LIMIT = 50_000;
// `title` is hover-only and is not reliably announced by assistive technology, so it is a
// convenience rather than the record. The lossless channel is the copied log.
const ROW_TITLE_LIMIT = 600;

/* A partial plan revision reports one turn's own steps and no more. `planEntryDetails` keeps
   the fuller board rendered and layers the partial steps onto it, so the row is drawing more
   than the newest revision alone said. That is worth saying out loud: the hint sits beside the
   progress in the same quiet register as the step-cap overflow line, and the copied log
   carries the same caveat in its own sentence. */
const PLAN_PARTIAL_HINT = 'partial board';
const PLAN_PARTIAL_NOTE = `${PLAN_PARTIAL_HINT}: the newest revision carried only its own turn's steps`;

function clampText(value, limit) {
  const text = String(value ?? '');
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function reasoningPreview(value) {
  const text = String(value ?? '');
  if (text.length <= REASONING_PREVIEW_LIMIT) return text;
  const omitted = text.length - REASONING_PREVIEW_LIMIT;
  return `${text.slice(0, REASONING_PREVIEW_LIMIT).trimEnd()}\n\n[${omitted.toLocaleString()} characters hidden from preview; Copy log retains the complete reasoning.]`;
}

// The rule renderEventStream already applies to sub-agents: a task that is no longer running
// owns no live work, so nothing it recorded may keep rendering as live.
function isTurnEnded(task) {
  return task?.status !== 'running';
}

// Presentation-only reading of the recorded steps. The plan data itself is untouched.
function planViewSteps(steps, turnEnded) {
  const list = steps || [];
  if (!turnEnded) {
    return list;
  }
  return list.map((step) => (planStepStatus(step?.status) === 'inProgress'
    ? { ...step, status: PLAN_ENDED_STEP_STATUS }
    : step));
}

const GOAL_ATTENTION_STATUSES = ['blocked', 'usageLimited', 'budgetLimited'];
// A paused goal is neither live nor resolved, so it must not borrow the running accent.
const GOAL_LIVE_STATUSES = ['active'];

// Provider text indexes the glyph, label, and marker maps, so the lookup is guarded: an
// unguarded `PLAN_STEP_GLYPHS[status]` accepts `__proto__` and renders `[object Object]`
// as the step marker, and `constructor` renders a function body as the spoken status.
function planStepStatus(status) {
  return Object.prototype.hasOwnProperty.call(PLAN_STEP_GLYPHS, status) ? status : 'pending';
}

// Step text and owner are provider output. Both are escaped before interpolation, including
// inside the hover title, and both are bounded before they reach the DOM.
function planChecklistMarkup(steps) {
  const list = steps || [];
  const shown = list.slice(0, PLAN_STEP_LIMIT);
  const items = shown.map((step) => {
    const status = planStepStatus(step?.status);
    const owner = clampText(String(step?.owner || '').trim(), PLAN_OWNER_LIMIT);
    const text = String(step?.step || '');
    const clipped = clampText(text, PLAN_STEP_TEXT_LIMIT);
    const title = clipped === text ? '' : clampText(text, ROW_TITLE_LIMIT);
    return `<li class="term-plan-step" data-plan-status="${escapeHtml(status)}">`
      + `<span class="term-plan-mark" aria-hidden="true">${escapeHtml(PLAN_STEP_GLYPHS[status])}</span>`
      + `<span class="sr-only">${escapeHtml(PLAN_STEP_LABELS[status])}</span>`
      + `<span class="term-plan-text"${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(clipped)}</span>`
      + (owner ? `<span class="term-plan-owner">${escapeHtml(owner)}</span>` : '')
      + '</li>';
  }).join('');
  if (!items) {
    return '';
  }
  // The honest half of the cap: the reader is told exactly how many steps the row is not
  // showing rather than handed a plan that looks complete and is not.
  const hidden = list.length - shown.length;
  const overflow = hidden > 0
    ? `<li class="term-plan-more">and ${escapeHtml(hidden.toLocaleString())} more step${hidden === 1 ? '' : 's'}</li>`
    : '';
  return `<ol class="term-plan-list">${items}${overflow}</ol>`;
}

// The copied log is the lossless channel: every step at full length, every step there is,
// and the whole explanation, however hard the rendered row is bounded.
function planCopyLines(details, { turnEnded = false } = {}) {
  const lines = [];
  if (details?.explanation) {
    lines.push(details.explanation);
  }
  // The copied log makes the same admission the row does, so a pasted plan never reads as a
  // board the provider vouched for whole.
  if (details?.partial === true) {
    lines.push(PLAN_PARTIAL_NOTE);
  }
  for (const step of planViewSteps(details?.steps, turnEnded)) {
    const owner = String(step?.owner || '').trim();
    lines.push(`${PLAN_STEP_MARKERS[planStepStatus(step?.status)]} ${String(step?.step || '')}${owner ? ` (${owner})` : ''}`);
  }
  return lines;
}

// Compact elapsed label for the Codex goal, which reports whole seconds.
function goalTimeLabel(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (!total) {
    return '';
  }
  if (total < 60) {
    return `${total}s`;
  }
  const minutes = Math.floor(total / 60);
  if (minutes < 60) {
    return `${minutes}m ${String(total % 60).padStart(2, '0')}s`;
  }
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

function goalMetaParts(details) {
  const parts = [`${Math.round(Number(details?.tokensUsed) || 0).toLocaleString()} tokens used`];
  const budget = Math.round(Number(details?.tokenBudget) || 0);
  if (budget > 0) {
    parts.push(`${budget.toLocaleString()} token budget`);
  }
  const time = goalTimeLabel(details?.timeUsedSeconds);
  if (time) {
    parts.push(`${time} used`);
  }
  return parts;
}

function goalMetaMarkup(details) {
  const parts = goalMetaParts(details);
  if (!parts.length) {
    return '';
  }
  const cells = parts
    .map((part) => `<span>${escapeHtml(part)}</span>`)
    .join('<span class="term-sep" aria-hidden="true">·</span>');
  return `<div class="term-goal-meta">${cells}</div>`;
}

function goalCopyLines(details) {
  const lines = [];
  if (details?.objective) {
    lines.push(details.objective);
  }
  lines.push([details?.statusLabel, ...goalMetaParts(details)].filter(Boolean).join(' · '));
  return lines;
}

// The plan row is the reference "Updated Plan" block: an explanation line and a checklist
// whose current step is emphasized. The full plan arrives on every revision, so the newest
// event alone describes the row.
function planPresentation(entry, common, { turnEnded = false } = {}) {
  const details = planEntryDetails(entry);
  if (!details) {
    return null;
  }
  const complete = details.total > 0 && details.done === details.total;
  // A task that is no longer running owns no live step, however its last revision left the
  // plan. Providers stop revising the plan when the turn ends, so a step left in progress
  // would otherwise read as work in flight for as long as the task is kept.
  const live = !turnEnded && details.inProgress > 0;
  const steps = planViewSteps(details.steps, turnEnded);
  const explanation = clampText(details.explanation, PLAN_EXPLANATION_LIMIT);
  return {
    ...common,
    provider: details.provider,
    kind: 'plan',
    glyph: '☰',
    // State is pinned from the plan itself. The generic `eventState` reads the event message,
    // which carries untrusted step text and would call a step named "error" a failure.
    state: complete ? 'success' : (live ? 'running' : 'neutral'),
    title: 'Plan',
    // The count stays the true count: the row bounds what it draws, never what it reports.
    // `details` already merged a partial revision into the fuller board, so this tally
    // describes the board being drawn rather than the newest revision's smaller slice.
    status: `${details.done}/${details.total} step${details.total === 1 ? '' : 's'}`,
    duration: '',
    live,
    // Read from the details rather than re-derived here, so the row, the copied log, and the
    // metrics tile all stand on one reading of the same fold.
    partial: details.partial === true,
    partialHint: details.partial === true ? PLAN_PARTIAL_HINT : '',
    explanation,
    explanationTitle: explanation === details.explanation ? '' : clampText(details.explanation, ROW_TITLE_LIMIT),
    current: live ? details.current : '',
    steps,
    checklistMarkup: planChecklistMarkup(steps),
  };
}

// A goal is only ever set by a Codex client, never by CC Relay, so this row exists only when
// the task actually recorded a goal event.
function goalPresentation(entry, common, { turnEnded = false } = {}) {
  const details = goalEntryDetails(entry);
  if (!details) {
    return null;
  }
  // The backend stops receiving goal notifications when the turn ends, so the last observed
  // status is not evidence of a live goal. The turn-final record settles it when the stream
  // carries one; stored history written before that record has only the task status.
  const ended = turnEnded || details.turnEnded === true;
  const resolved = details.cleared || details.status === 'complete';
  let state = 'neutral';
  if (resolved) {
    state = 'success';
  } else if (GOAL_ATTENTION_STATUSES.includes(details.status)) {
    state = 'error';
  } else if (!ended && GOAL_LIVE_STATUSES.includes(details.status)) {
    state = 'running';
  }
  const objective = clampText(details.objective, GOAL_OBJECTIVE_LIMIT);
  return {
    ...common,
    provider: 'codex',
    kind: 'goal',
    glyph: '⚑',
    state,
    title: 'Goal',
    // The label keeps reporting the last status the provider actually published. What a
    // finished task loses is the claim that the goal is still live: the state, the running
    // glyph, and the live accent on the pill.
    status: details.statusLabel,
    goalStatus: details.status,
    quiet: details.cleared,
    duration: '',
    live: state === 'running',
    // The pill drops the live accent only where it would otherwise claim to be live. A goal
    // that ended blocked stays red and one that ended complete stays green: those are facts
    // about how it ended, not claims that it is still running.
    endedLive: ended && GOAL_LIVE_STATUSES.includes(details.status),
    objective,
    objectiveTitle: objective === details.objective ? '' : clampText(details.objective, ROW_TITLE_LIMIT),
    metaMarkup: goalMetaMarkup(details),
  };
}

// Presentation for one sub-agent run. `item` is the launch tool call when this stream saw it;
// a task notification that arrived without its launch (a resumed agent, or a notification
// written before the launch record) still renders from the notification alone.
function subAgentPresentation(entry, item, common) {
  const finished = entry.agentFinishedEvent?.payload || null;
  const details = subAgentEntryDetails(entry);
  const agentState = subAgentEntryState(entry);
  const reportedStatus = String(details?.reportedStatus || finished?.status || '').trim().toLowerCase();
  const failed = details?.failed === true
    || item?.status === 'failed'
    || (!details && Boolean(reportedStatus) && reportedStatus !== 'completed');
  const startedAt = entryFirstEvent(entry)?.created_at || null;
  const endedAt = entry.agentFinishedEvent?.created_at || entryLastEvent(entry)?.created_at || null;
  // A notification can be recorded before the launch it resolves, which would otherwise
  // report a nonsense duration. Only a forward interval is shown.
  const elapsed = startedAt && endedAt
    ? new Date(endedAt).getTime() - new Date(startedAt).getTime()
    : 0;
  const summary = String(details?.note || finished?.summary || '').trim();
  const launchOutput = failed ? toolResultText(item?.result) : '';
  const prompt = String(details?.prompt || item?.arguments?.prompt || '').trim();
  return {
    ...common,
    kind: 'agent',
    glyph: '↳',
    state: failed ? 'error' : (agentState === 'finished' ? 'success' : 'running'),
    title: 'Sub-agent',
    name: String(details?.name || item?.agentName || finished?.agentName || '').trim() || 'unnamed agent',
    agentType: String(details?.agentType || item?.agentType || '').trim(),
    agentState,
    live: agentState !== 'finished',
    status: details?.statusLabel || (failed
      ? (reportedStatus ? `${reportedStatus.charAt(0).toUpperCase()}${reportedStatus.slice(1)}` : 'Failed to start')
      : SUB_AGENT_STATUS_LABELS[agentState]),
    duration: agentState === 'finished' && elapsed > 0 ? formatElapsedDuration(startedAt, endedAt) : '',
    // The summary repeats the agent name on a clean finish, so it only earns a line when it
    // carries news: a non-standard outcome, or a notification with no launch signal to sit on.
    note: summary && (failed || !item) ? summary : '',
    body: `${eventOutputMarkup(prompt, { label: 'brief' })}${eventOutputMarkup(launchOutput, { label: 'launch output', open: true })}`,
  };
}

function eventPresentation(entry, task) {
  const item = entryItem(entry);
  const lastEvent = entryLastEvent(entry);
  const payloadType = lastEvent?.payload?.type || '';
  const provider = eventProvider(entry, task);
  const duration = formatEventDuration(entry);
  const stateName = eventState(entry);
  const completed = Boolean(entry.completedEvent);
  const turnEnded = isTurnEnded(task);
  const common = {
    provider,
    state: stateName,
    status: eventStatusLabel(entry),
    duration,
    repeatCount: eventEntryRepeatCount(entry),
  };

  // Sub-agent runs read as their own signal: a team session is the reason a Claude task can
  // stay live for hours, so "who is working" must be legible without opening tool arguments.
  if (isSubAgentEntry(entry)) {
    return subAgentPresentation(entry, item, common);
  }

  // Plan and goal rows carry no thread item, so they are resolved before every item branch.
  // Their provider comes from the payload type rather than the recorded event kind, which
  // keeps one neutral path for both providers.
  if (isPlanEntry(entry)) {
    const plan = planPresentation(entry, common, { turnEnded });
    if (plan) {
      return plan;
    }
  }

  if (isGoalEntry(entry)) {
    const goal = goalPresentation(entry, common, { turnEnded });
    if (goal) {
      return goal;
    }
  }

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
    // Claude board bookkeeping already speaks through the folded plan row sitting next to it.
    // It keeps its line, its arguments, and its place in the copied log, but reads quietly
    // instead of competing with the plan it just produced.
    const planTool = isPlanToolItem(item);
    return {
      ...common,
      kind: 'tool',
      quiet: planTool,
      glyph: planTool ? '☰' : '◆',
      title: planTool ? 'Plan board' : (item.tool || 'Connected tool'),
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

  if (
    ['agentMessage', 'agent_message'].includes(item?.type)
    || ['claude/message', 'opencode/message'].includes(payloadType)
    || lastEvent?.kind === 'result'
  ) {
    const message = String(item?.text || lastEvent?.payload?.text || lastEvent?.message || '').trim();
    return {
      ...common,
      kind: 'message',
      messageRole: 'assistant',
      glyph: provider === 'claude' ? '✳' : provider === 'opencode' ? 'OC' : '>_',
      title: providerLabel(provider),
      status: assistantMessageStatus(entry, task, message),
      message,
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
      preview: reasoningPreview(summary),
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
      kind: 'message',
      messageRole: 'user',
      glyph: '↗',
      title: 'You',
      status: item.promptKind === 'original'
        ? 'original request'
        : String(item.clientId || '').startsWith('relay-steer-')
          ? 'turn update'
          : entry.completedEvent ? 'sent' : 'sending',
      message,
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
      title: payloadType === 'turn/started' ? 'Turn started' : 'Turn finished',
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
      title: lastEvent.kind === 'queue' ? 'CC Relay queue' : 'CC Relay system',
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
    || payloadType === 'claude/input-required'
    || payloadType === 'claude/input-resumed'
    || payloadType === 'claude/session-initializing') {
    const waiting = payloadType === 'claude/waiting';
    const inputRequired = payloadType === 'claude/input-required';
    const inputResumed = payloadType === 'claude/input-resumed';
    // claude/progress carries healthy terminal-turn heartbeats and cancellation notices.
    // Render it as a quiet note so a long turn does not accumulate warning-styled entries.
    const progress = payloadType === 'claude/progress';
    return {
      ...common,
      kind: waiting ? 'error' : 'note',
      quiet: progress || inputResumed
        || (!inputRequired && payloadType !== 'claude/waiting' && payloadType !== 'claude/session-initializing'),
      glyph: '✳',
      title: inputRequired
        ? 'Claude needs input'
        : (waiting || progress) ? 'Claude session busy' : 'Claude session',
      status: inputRequired ? 'input needed' : (waiting || progress) ? 'waiting' : common.status,
      body: waiting
        ? eventOutputMarkup(lastEvent.message, { label: 'details', open: true })
        : eventTextMarkup(lastEvent.message),
    };
  }

  return {
    ...common,
    kind: 'note',
    glyph: provider === 'claude' ? '✳' : provider === 'opencode' ? 'OC' : '>_',
    title: `${providerLabel(provider)} activity`,
    body: eventTextMarkup(lastEvent?.message || 'Activity recorded.'),
  };
}

function renderEventEntry(entry, task, index) {
  const presentation = eventPresentation(entry, task);
  const providerClass = presentation.provider === 'council' ? 'plan' : presentation.provider;
  const timeEvent = presentation.repeatCount > 1 ? entryLastEvent(entry) : entryFirstEvent(entry);
  const time = formatEventTime(timeEvent?.created_at);
  const classes = [
    'event-entry',
    `event-entry-${escapeHtml(presentation.state)}`,
    `event-provider-${escapeHtml(providerClass)}`,
    `event-kind-${escapeHtml(presentation.kind)}`,
    presentation.kind === 'message' ? `event-message-${escapeHtml(presentation.messageRole || 'assistant')}` : '',
    presentation.quiet ? 'event-entry-quiet' : '',
  ].filter(Boolean).join(' ');
  return `
    <article class="${classes}" data-entry-id="${escapeHtml(entry.id)}" data-category="${escapeHtml(eventEntryCategory(entry))}"${presentation.kind === 'message' ? ` data-message-role="${escapeHtml(presentation.messageRole || 'assistant')}"` : ''}>
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
    const role = p.messageRole === 'user' ? 'user' : 'assistant';
    const roleLabel = role === 'user' ? 'My message' : 'AI message';
    const elapsed = p.duration
      ? `<span class="term-elapsed">${escapeHtml(p.duration)}</span>`
      : '';
    const head = `
      <div class="term-signal-row term-response-head term-message-head">
        <span class="term-glyph" aria-hidden="true">${escapeHtml(p.glyph)}</span>
        <span class="term-signal-title">${escapeHtml(p.title)}</span>
        <span class="term-message-role">${roleLabel}</span>
        <span class="term-signal-state">${escapeHtml(p.status)}</span>
        ${elapsed}
        <time class="term-time">${escapeHtml(time)}</time>
      </div>`;
    if (!p.message) return head;
    const body = role === 'user'
      ? escapeHtml(p.message)
      : renderMarkdown(p.message);
    const bodyClasses = role === 'user'
      ? 'event-message-body term-response-body'
      : 'event-message-body term-response-body markdown-document terminal-markdown';
    return `${head}<div class="term-response"><div class="${bodyClasses}">${body}</div></div>`;
  }

  if (p.kind === 'agent') {
    const meta = [
      p.agentType ? `<span class="term-agent-type">${escapeHtml(p.agentType)}</span>` : '',
      p.duration ? `<span>ran ${escapeHtml(p.duration)}</span>` : '',
    ].filter(Boolean).join('<span class="term-sep" aria-hidden="true">·</span>');
    const live = p.live ? '<i class="term-agent-live" aria-hidden="true"></i>' : '';
    return `
      <div class="term-signal-row">
        <span class="term-glyph" aria-hidden="true">${escapeHtml(p.glyph)}</span>
        <span class="term-signal-title">${escapeHtml(p.title)}</span>
        <span class="term-signal-inline term-agent-name">${escapeHtml(p.name)}</span>
        <span class="term-signal-state term-agent-state" data-agent-state="${escapeHtml(p.agentState)}">${live}${escapeHtml(p.status)}</span>
        <time class="term-time">${escapeHtml(time)}</time>
      </div>
      ${meta ? `<div class="term-agent-meta">${meta}</div>` : ''}
      ${p.note ? `<p class="term-agent-note">${escapeHtml(p.note)}</p>` : ''}
      ${p.body || ''}
    `;
  }

  if (p.kind === 'plan') {
    // Clipped provider text keeps the rest of itself in a bounded title, which is escaped
    // exactly like the visible half because it is interpolated into a quoted attribute.
    const explanation = p.explanation
      ? `<p class="term-plan-explanation"${p.explanationTitle ? ` title="${escapeHtml(p.explanationTitle)}"` : ''}>${escapeHtml(p.explanation)}</p>`
      : '';
    return `
      <div class="term-signal-row">
        <span class="term-glyph" aria-hidden="true">${escapeHtml(p.glyph)}</span>
        <span class="term-signal-title">${escapeHtml(p.title)}</span>
        <span class="term-signal-state term-plan-progress">${escapeHtml(p.status)}</span>
        ${p.partialHint ? `<span class="term-plan-partial">${escapeHtml(p.partialHint)}</span>` : ''}
        <time class="term-time">${escapeHtml(time)}</time>
      </div>
      ${explanation}
      ${p.checklistMarkup || ''}
    `;
  }

  if (p.kind === 'goal') {
    const objective = p.objective
      ? `<span class="term-signal-inline term-goal-objective"${p.objectiveTitle ? ` title="${escapeHtml(p.objectiveTitle)}"` : ''}>${escapeHtml(p.objective)}</span>`
      : '';
    return `
      <div class="term-signal-row">
        <span class="term-glyph" aria-hidden="true">${escapeHtml(p.glyph)}</span>
        <span class="term-signal-title">${escapeHtml(p.title)}</span>
        ${objective}
        <span class="term-signal-state term-goal-state${p.endedLive ? ' is-ended' : ''}" data-goal-status="${escapeHtml(p.goalStatus)}">${escapeHtml(p.status)}</span>
        <time class="term-time">${escapeHtml(time)}</time>
      </div>
      ${p.metaMarkup || ''}
    `;
  }

  const inline = p.inline ? `<span class="term-signal-inline">${p.inline}</span>` : '';
  const status = p.status ? `<span class="term-signal-state">${escapeHtml(p.status)}</span>` : '';
  const repeatCount = Number(p.repeatCount) || 1;
  const repeat = repeatCount > 1
    ? `<span class="term-repeat-count" aria-label="${escapeHtml(`${repeatCount.toLocaleString()} identical status updates grouped`)}" title="${escapeHtml(`This status occurred ${repeatCount.toLocaleString()} times in a row.`)}">×${escapeHtml(repeatCount.toLocaleString())}</span>`
    : '';
  const elapsed = p.duration ? `<span class="term-elapsed">${escapeHtml(p.duration)}</span>` : '';
  const row = `
    <div class="term-signal-row">
      <span class="term-glyph" aria-hidden="true">${escapeHtml(p.glyph)}</span>
      <span class="term-signal-title">${escapeHtml(p.title)}</span>
      ${inline}
      ${status}
      ${repeat}
      ${elapsed}
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
  const recordedRepeatCount = Number(entry?.repeatCount);
  const repeatCount = Number.isSafeInteger(recordedRepeatCount) && recordedRepeatCount > 1
    ? recordedRepeatCount
    : 1;
  const event = repeatCount > 1 ? entryLastEvent(entry) : entryFirstEvent(entry);
  const item = entryItem(entry);
  const speaker = presentation.messageRole === 'user'
    ? 'You'
    : providerLabel(presentation.provider);
  const copyTitle = presentation.kind === 'message'
    ? presentation.messageRole === 'user' ? 'Message sent' : 'AI message'
    : presentation.title;
  const lines = [
    `[${formatEventTime(event?.created_at)}] ${speaker} · ${copyTitle} · ${presentation.status}${repeatCount > 1 ? ` · ${repeatCount.toLocaleString()} identical updates` : ''}`,
  ];
  if (isSubAgentEntry(entry)) {
    const details = subAgentEntryDetails(entry);
    lines.push(presentation.agentType
      ? `${presentation.name} (${presentation.agentType})`
      : presentation.name);
    const summary = String(entry.agentFinishedEvent?.payload?.summary || '').trim();
    if (summary) {
      lines.push(summary);
    }
    const brief = String(details?.prompt || item?.arguments?.prompt || '').trim();
    if (brief) {
      lines.push(brief);
    }
  } else if (isPlanEntry(entry)) {
    lines.push(...planCopyLines(planEntryDetails(entry), { turnEnded: isTurnEnded(task) }));
  } else if (isGoalEntry(entry)) {
    lines.push(...goalCopyLines(goalEntryDetails(entry)));
  } else if (item?.type === 'commandExecution') {
    lines.push(item.command || 'Command details unavailable');
    if (item.aggregatedOutput) {
      lines.push(item.aggregatedOutput);
    }
  } else if (['agentMessage', 'agent_message'].includes(item?.type)) {
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

function updateThinkingVisibilityControl(reasoningCount = 0) {
  const action = state.showThinking ? 'Hide' : 'Show';
  const summaryLabel = `${reasoningCount.toLocaleString()} thinking ${reasoningCount === 1 ? 'summary' : 'summaries'}`;
  elements.thinkingVisibilityButton.setAttribute('aria-pressed', String(state.showThinking));
  elements.thinkingVisibilityButton.setAttribute('aria-label', `${action} thinking summaries`);
  elements.thinkingVisibilityButton.title = `${action} model-provided thinking summaries. ${summaryLabel}.`;
}

function updateEventControls(filterCounts = {}, reasoningCount = 0) {
  /*
   * While the Terminal window is docked it borrows state.eventFilter for its own view.
   * The inline rail must keep showing its own selection, so it reads the remembered
   * inline filter instead. Opening or closing the window never moves that selection.
   */
  const inlineFilter = terminalWindowIsDocked() ? state.inlineEventFilter : state.eventFilter;
  for (const button of elements.eventFilters) {
    const filter = button.dataset.eventFilter;
    const count = Number(filterCounts[filter]) || 0;
    const label = button.querySelector('.event-filter-label')?.textContent?.trim() || filter;
    button.setAttribute('aria-pressed', String(state.terminalMode !== 'native' && filter === inlineFilter));
    button.setAttribute('aria-label', `${label}: ${count} signal${count === 1 ? '' : 's'}`);
    const counter = button.querySelector('[data-event-filter-count]');
    if (counter) counter.textContent = count.toLocaleString();
  }
  if (elements.eventMoreViews) {
    const active = elements.eventMoreViews.querySelector('[aria-pressed="true"] .event-filter-label');
    elements.eventMoreViews.querySelector('summary').textContent = active?.textContent || 'More views';
  }
  updateTerminalWindowControls(filterCounts);
  updateThinkingVisibilityControl(reasoningCount);
}

/* ------------------------------------------------------------------
 * Terminal window
 *
 * The one live .events-section is reparented into the dialog instead of cloned, so there
 * is a single render target. Live SSE refresh, disclosure restore, follow-to-bottom, the
 * continuation composer, and Copy log keep working through their existing references.
 * ------------------------------------------------------------------ */

const TERMINAL_WINDOW_VIEW_TITLES = {
  all: 'Original terminal',
  activity: 'Relay activity',
  conversation: 'Conversation',
  mine: 'My messages',
  ai: 'AI messages',
};

const TERMINAL_WINDOW_VIEW_SUMMARIES = {
  all: 'This task’s original terminal inside CC Relay.',
  activity: 'All recorded task activity.',
  conversation: 'Your messages and AI responses in order.',
  mine: 'Only the messages you sent.',
  ai: 'Only the provider responses.',
};

function terminalWindowIsDocked() {
  return state.terminalWindowDock !== null;
}

function terminalWindowAiLabel(task) {
  // Never hardcode a provider name in markup or copy. The label follows the real task.
  return task ? `${providerLabel(taskProvider(task))} messages` : TERMINAL_WINDOW_VIEW_TITLES.ai;
}

function nativeTerminalViewIsActive() {
  return Boolean(state.selectedTaskId) && !elements.taskDetail.hidden
    && (terminalWindowIsDocked() ? state.terminalWindowView === 'all' : state.terminalMode === 'native');
}

function nativeTerminalCopyLabel() {
  return nativeTerminalViewIsActive() && ['interactive', 'live', 'stale'].includes(state.nativeTerminalScreen.state)
    ? 'Copy screen' : 'Copy log';
}

function stopNativeTerminalScreenPolling() {
  window.clearTimeout(state.nativeTerminalScreenTimer);
  state.nativeTerminalScreenTimer = null;
  state.nativeTerminalScreenSequence += 1;
  state.originalTerminalAbort?.abort();
  state.originalTerminalAbort = null;
  state.nativeTerminalScreenPending = false;
}

function resetNativeTerminalScreen(taskId) {
  state.embeddedTerminalView?.disconnect();
  state.nativeTerminalScreen = { taskId, threadId: null, requestedThreadId: null, state: 'ready', text: '', message: '', targets: [] };
  elements.nativeTerminalScreenOutput.textContent = '';
  elements.nativeTerminalScreenOutput.scrollTop = 0;
  elements.nativeTerminalScreenOutput.scrollLeft = 0;
}

function scheduleNativeTerminalScreenPolling() {
  if (!nativeTerminalViewIsActive() || document.hidden || state.nativeTerminalScreenPending
    || state.nativeTerminalScreenTimer !== null || state.status?.capabilities?.nativeTerminalScreen !== true
    || ['choose', 'interactive', 'detached'].includes(state.nativeTerminalScreen.state)) return;
  const delay = state.nativeTerminalScreen.state === 'ready' ? 0
    : state.nativeTerminalScreen.state === 'live' ? 1000 : 5000;
  state.nativeTerminalScreenTimer = window.setTimeout(() => {
    state.nativeTerminalScreenTimer = null;
    void refreshNativeTerminalScreen();
  }, delay);
}

function renderNativeTerminalScreen() {
  const screen = state.nativeTerminalScreen;
  const provider = providerLabel(screen.provider || taskProvider(state.selectedTaskForEvents || {}));
  const interactive = screen.state === 'interactive';
  const hasScreen = interactive || ['live', 'stale'].includes(screen.state);
  const output = elements.nativeTerminalScreenOutput;
  elements.nativeTerminalScreen.dataset.state = screen.state;
  elements.nativeTerminalScreen.setAttribute('aria-busy', String(state.nativeTerminalScreenPending && !hasScreen));
  elements.nativeTerminalScreenTitle.textContent = `${provider} · Original terminal`;
  elements.nativeTerminalScreenState.textContent = interactive ? 'Interactive terminal'
    : screen.state === 'live' ? 'Legacy session · read-only screen'
    : screen.state === 'stale' ? 'Last screen · reconnecting'
      : screen.state === 'unavailable' ? 'Terminal unavailable'
        : screen.state === 'choose' ? 'Choose terminal' : 'Connecting';
  output.hidden = !hasScreen || interactive;
  if (elements.embeddedTerminal) elements.embeddedTerminal.hidden = !interactive;
  if (hasScreen && !interactive && output.textContent !== screen.text && !textSelectionGuard.isActive()) {
    const follow = output.scrollHeight - output.clientHeight - output.scrollTop < 32;
    const scrollTop = output.scrollTop;
    output.textContent = screen.text;
    output.scrollTop = follow ? output.scrollHeight : scrollTop;
  }
  elements.nativeTerminalScreenNotice.hidden = hasScreen;
  elements.nativeTerminalScreenNotice.querySelector('strong').textContent = screen.state === 'unavailable'
    ? 'Original terminal unavailable' : screen.state === 'detached' ? 'Terminal open in another view' : screen.state === 'choose' ? 'Choose this task’s terminal' : 'Connecting to the original terminal';
  elements.nativeTerminalScreenNotice.querySelector('span').textContent = screen.message
    || 'The original CLI session opens here. Click inside the terminal to type.';
  if (elements.originalTerminalOpen) {
    elements.originalTerminalOpen.textContent = terminalWindowIsDocked() ? 'Refresh screen' : 'Show original terminal';
    elements.originalTerminalOpen.disabled = terminalWindowIsDocked() && state.nativeTerminalScreenPending;
    elements.originalTerminalOpen.hidden = interactive;
  }
  if (interactive && nativeTerminalViewIsActive() && !document.hidden) {
    state.embeddedTerminalView ||= new EmbeddedTerminalView(elements.embeddedTerminal, {
      onDisconnect: (message, code) => {
        if (state.nativeTerminalScreen.transport !== 'pty') return;
        state.nativeTerminalScreen = { ...state.nativeTerminalScreen,
          state: code === 4001 ? 'detached' : 'connecting', message };
        syncTerminalWindowSurface();
      },
    });
    state.embeddedTerminalView.connect(screen);
  }
  const targetSignature = JSON.stringify(screen.targets || []);
  if (elements.nativeTerminalTargets && elements.nativeTerminalTargets.dataset.signature !== targetSignature) {
    elements.nativeTerminalTargets.dataset.signature = targetSignature;
    elements.nativeTerminalTargets.replaceChildren(...(screen.targets || []).map((target) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${providerLabel(target.provider)} · ${target.label}`;
      button.setAttribute('aria-pressed', String(target.id === screen.threadId));
      button.addEventListener('click', () => void refreshNativeTerminalScreen(target.id));
      return button;
    }));
  }
  for (const [index, button] of Array.from(elements.nativeTerminalTargets?.children || []).entries()) {
    button.setAttribute('aria-pressed', String(screen.targets[index]?.id === screen.threadId));
  }
}

async function refreshNativeTerminalScreen(threadId = null) {
  if (!nativeTerminalViewIsActive() || document.hidden) return;
  if (threadId && threadId !== state.nativeTerminalScreen.threadId) {
    stopNativeTerminalScreenPolling();
    resetNativeTerminalScreen(state.selectedTaskId);
    state.nativeTerminalScreen.threadId = threadId;
    state.nativeTerminalScreen.requestedThreadId = threadId;
  }
  if (state.nativeTerminalScreenPending) return;
  window.clearTimeout(state.nativeTerminalScreenTimer);
  state.nativeTerminalScreenTimer = null;
  const taskId = state.selectedTaskId;
  if (state.nativeTerminalScreen.taskId !== taskId) resetNativeTerminalScreen(taskId);
  const previous = state.nativeTerminalScreen;
  // Only pin a conversation after an explicit workflow choice. A direct task can acquire
  // a fresh terminal on retry, so automatic reads must resolve its current owned session.
  const selectedThreadId = threadId || previous.requestedThreadId;
  const sequence = ++state.nativeTerminalScreenSequence;
  const controller = new AbortController();
  state.originalTerminalAbort = controller;
  state.nativeTerminalScreenPending = true;
  renderNativeTerminalScreen();
  try {
    if (state.status?.capabilities?.nativeTerminalScreen !== true) {
      state.nativeTerminalScreen = { ...previous, state: 'unavailable', text: '', message: 'The original terminal screen is unavailable. Use Relay activity below.' };
      return;
    }
    const query = selectedThreadId ? `?threadId=${encodeURIComponent(selectedThreadId)}` : '';
    const { terminal } = await api(`/api/tasks/${taskId}/terminal-screen${query}`, {
      timeoutMs: 10_000, signal: controller.signal,
    });
    if (sequence !== state.nativeTerminalScreenSequence || state.selectedTaskId !== taskId || !nativeTerminalViewIsActive()) return;
    const interactive = terminal?.state === 'interactive' && terminal.transport === 'pty' && typeof terminal.launchId === 'string';
    const live = terminal?.state === 'live' && typeof terminal.text === 'string';
    const stale = !live && terminal?.state !== 'choose' && ['live', 'stale'].includes(previous.state);
    state.nativeTerminalScreen = {
      taskId,
      threadId: terminal?.threadId || selectedThreadId,
      requestedThreadId: selectedThreadId,
      transport: terminal?.transport,
      launchId: terminal?.launchId,
      state: interactive ? 'interactive' : live ? 'live' : stale ? 'stale'
        : ['choose', 'connecting'].includes(terminal?.state) ? terminal.state : 'unavailable',
      text: live ? terminal.text.slice(-250_000) : stale ? previous.text : '',
      provider: terminal?.provider || previous.provider,
      message: typeof terminal?.message === 'string' ? terminal.message : '',
      targets: Array.isArray(terminal?.targets) ? terminal.targets : [],
    };
  } catch (error) {
    if (sequence !== state.nativeTerminalScreenSequence || state.selectedTaskId !== taskId) return;
    state.nativeTerminalScreen = { ...previous,
      state: ['live', 'stale'].includes(previous.state) ? 'stale' : 'unavailable',
      message: `${error.message} Use Relay activity below.` };
  } finally {
    if (sequence === state.nativeTerminalScreenSequence) {
      state.originalTerminalAbort = null;
      state.nativeTerminalScreenPending = false;
      syncTerminalWindowSurface();
    }
  }
}

function syncTerminalWindowSurface() {
  const native = nativeTerminalViewIsActive();
  if (state.nativeTerminalScreen.taskId !== state.selectedTaskId) {
    stopNativeTerminalScreenPolling();
    resetNativeTerminalScreen(state.selectedTaskId);
  }
  if (native && state.status && state.status.capabilities?.nativeTerminalScreen !== true) {
    stopNativeTerminalScreenPolling();
    state.nativeTerminalScreen = { ...state.nativeTerminalScreen, state: 'unavailable', text: '',
      message: 'The original terminal screen is unavailable. Use Relay activity below.' };
  }
  if (native) elements.eventsSection.dataset.terminalSurface = 'native';
  else delete elements.eventsSection.dataset.terminalSurface;
  elements.nativeTerminalScreen.hidden = !native;
  elements.detailEvents.hidden = native;
  elements.eventOverview.hidden = false;
  elements.thinkingVisibilityButton.hidden = native;
  elements.copyEventsButton.hidden = false;
  elements.copyEventsButton.textContent = nativeTerminalCopyLabel();
  elements.copyEventsButton.disabled = native
    ? state.nativeTerminalScreen.state !== 'interactive' && !state.nativeTerminalScreen.text : state.visibleEventEntries.length === 0;
  elements.eventsSection.dataset.terminalInteractive = String(native && state.nativeTerminalScreen.state === 'interactive');
  // Real PTYs use the CLI's own composer. Relay's composer belongs to the activity views.
  elements.originalTerminalButton?.setAttribute('aria-pressed', String(state.terminalMode === 'native'));
  if (native) {
    renderNativeTerminalScreen();
    scheduleNativeTerminalScreenPolling();
  } else {
    stopNativeTerminalScreenPolling();
    state.embeddedTerminalView?.disconnect();
  }
}

function useOriginalTerminal() {
  state.terminalMode = 'native';
  state.inlineEventFilter = 'all';
  if (!terminalWindowIsDocked()) state.eventFilter = 'all';
  queueUiPreferencesSave();
  if (terminalWindowIsDocked()) setTerminalWindowView('all');
  else rerenderTerminalWindowStream();
  void refreshNativeTerminalScreen();
}

function showOriginalTerminal() {
  if (!state.selectedTaskId || elements.taskDetail.hidden) return;
  setTerminalWindowView('all', { render: false });
  if (terminalWindowIsDocked()) {
    if (['unavailable', 'stale'].includes(state.nativeTerminalScreen.state)) {
      stopNativeTerminalScreenPolling();
      resetNativeTerminalScreen(state.selectedTaskId);
    }
    syncTerminalWindowSurface();
    void refreshNativeTerminalScreen();
  } else openTerminalWindow();
}

function useRelayActivity() {
  state.terminalMode = 'activity';
  state.inlineEventFilter = 'all';
  if (terminalWindowIsDocked()) setTerminalWindowView('activity');
  else {
    state.eventFilter = 'all';
    queueUiPreferencesSave();
    rerenderTerminalWindowStream();
  }
}

// The open control needs a task whose terminal is actually on screen. A deselect while
// the window is open closes it rather than stranding a dialog over a cleared panel.
function updateTerminalWindowAvailability() {
  if (!elements.terminalWindowOpenButton) return;
  const available = Boolean(state.selectedTaskId) && !elements.taskDetail.hidden;
  elements.terminalWindowOpenButton.disabled = !available;
  if (!available && terminalWindowIsDocked()) closeTerminalWindow();
}

function updateTerminalWindowControls(filterCounts = {}) {
  updateTerminalWindowAvailability();
  if (!elements.terminalWindowModal) return;
  const task = state.selectedTaskId ? state.selectedTaskForEvents : null;
  const aiLabel = terminalWindowAiLabel(task);
  for (const button of elements.terminalWindowViews) {
    const view = button.dataset.terminalWindowView;
    const count = Number(filterCounts[view === 'activity' ? 'all' : view]) || 0;
    const label = button.querySelector('.terminal-window-view-label');
    if (view === 'ai' && label) label.textContent = aiLabel;
    const text = label?.textContent?.trim() || view;
    button.setAttribute('aria-pressed', String(view === state.terminalWindowView));
    button.setAttribute(
      'aria-label',
      view === 'all' ? 'Show the original terminal inside CC Relay' : `${text}: ${count} signal${count === 1 ? '' : 's'}`,
    );
    const counter = button.querySelector('[data-terminal-window-view-count]');
    if (counter) counter.textContent = count.toLocaleString();
  }
  const view = state.terminalWindowView;
  // textContent, never innerHTML: the task title and provider are task-controlled values.
  elements.terminalWindowTitle.textContent = view === 'ai'
    ? aiLabel
    : TERMINAL_WINDOW_VIEW_TITLES[view] || TERMINAL_WINDOW_VIEW_TITLES.all;
  const summary = TERMINAL_WINDOW_VIEW_SUMMARIES[view] || TERMINAL_WINDOW_VIEW_SUMMARIES.all;
  elements.terminalWindowSubtitle.textContent = task
    ? `${summary} Task ${String(task.id).padStart(3, '0')} · ${providerLabel(taskProvider(task))} · ${task.status}`
    : summary;
  syncTerminalWindowSurface();
}

function rerenderTerminalWindowStream({ forceBottom = false } = {}) {
  if (!state.selectedTaskId || !state.selectedTaskForEvents) {
    updateTerminalWindowControls();
    return;
  }
  renderEventStream(state.selectedTaskEvents, state.selectedTaskForEvents, { forceBottom });
}

function setTerminalWindowView(view, { persist = true, render = true } = {}) {
  state.terminalWindowView = normalizeTerminalWindowView(view);
  if (terminalWindowIsDocked()) state.eventFilter = state.terminalWindowView === 'activity' ? 'all' : state.terminalWindowView;
  // queueUiPreferencesSave writes the relay.terminalWindowView cache and PATCHes the
  // authoritative shared record in one step.
  if (persist) queueUiPreferencesSave();
  if (render) rerenderTerminalWindowStream();
}

function openTerminalWindow() {
  if (!elements.terminalWindowModal || terminalWindowIsDocked()) return;
  if (!state.selectedTaskId || elements.taskDetail.hidden) return;
  state.inlineEventFilter = state.eventFilter;
  /*
   * The dock records where the inline reading position was, not where the window one
   * ends up. The two lists hold different entries at different heights, so closing must
   * replay the inline offset the operator left rather than the window's scroll state.
   *
   * It records two slots, not one. The .event-tools cluster travels into the dialog
   * header while the section is docked, so its own parent and sibling are captured in
   * the same record, in the same place, BEFORE either move. One record means one
   * re-entrancy guard and one dock-null-first clear covering both nodes.
   */
  state.terminalWindowDock = {
    parent: elements.eventsSection.parentNode,
    nextSibling: elements.eventsSection.nextSibling,
    toolsParent: elements.eventTools.parentNode,
    toolsNextSibling: elements.eventTools.nextSibling,
    scrollTop: elements.detailEvents.scrollTop,
    follow: state.eventFollow,
    nativeScrollTop: elements.nativeTerminalScreenOutput.scrollTop,
    nativeScrollLeft: elements.nativeTerminalScreenOutput.scrollLeft,
    nativeFollow: elements.nativeTerminalScreenOutput.scrollHeight
      - elements.nativeTerminalScreenOutput.clientHeight - elements.nativeTerminalScreenOutput.scrollTop < 32,
  };
  const follow = state.eventFollow;
  const restoreScrollTop = state.terminalWindowDock.scrollTop;
  // Reattaching a subtree zeroes every descendant scroll position, so the per-output
  // offsets are captured before the move and replayed after it.
  rememberEventDisclosures();
  rememberEventOutputScroll();
  elements.terminalWindowMount.append(elements.eventsSection);
  elements.eventsSection.dataset.terminalWindow = 'open';
  /*
   * Thinking and Copy log follow the terminal into the window's own header. The docked
   * .event-toolbar row is hidden by CSS, so leaving them behind would strand a 34px
   * strip holding nothing but those two controls. This runs after the section is docked
   * and before showModal(), so the dialog never paints with an empty tools slot.
   */
  elements.terminalWindowTools.append(elements.eventTools);
  state.eventFilter = state.terminalWindowView === 'activity' ? 'all' : state.terminalWindowView;
  elements.terminalWindowModal.showModal();
  restoreEventOutputScroll();
  rerenderTerminalWindowStream({ forceBottom: follow });
  restoreNativeTerminalScreenScroll(state.terminalWindowDock);
  if (!follow) elements.detailEvents.scrollTop = restoreScrollTop;
  const pressed = elements.terminalWindowViews.find(
    (button) => button.dataset.terminalWindowView === state.terminalWindowView,
  ) || elements.terminalWindowViews[0];
  pressed?.focus();
  if (nativeTerminalViewIsActive()) void refreshNativeTerminalScreen();
}

function restoreNativeTerminalScreenScroll(dock) {
  const output = elements.nativeTerminalScreenOutput;
  output.scrollTop = dock.nativeFollow ? output.scrollHeight : dock.nativeScrollTop;
  output.scrollLeft = dock.nativeScrollLeft;
}

/*
 * Undocking runs BEFORE dialog.close(). A closed dialog is display:none, so a scroll
 * position read from a close event handler is always zero, and every restore below has
 * to work from the offsets the dock recorded at open time instead.
 */
function undockTerminalWindow() {
  const dock = state.terminalWindowDock;
  if (!dock) return;
  state.terminalWindowDock = null;
  rememberEventDisclosures();
  rememberEventOutputScroll();
  /*
   * The tools cluster goes home FIRST, so the section is never reinserted into the
   * detail grid in a half restored state: anything that measures or focuses it after
   * the move sees the complete toolbar, never one missing its controls. Both recorded
   * siblings are revalidated the same way, because a remembered sibling can be gone by
   * close time and insertBefore against a detached reference throws.
   */
  const toolsReturnBefore = dock.toolsNextSibling
    && dock.toolsNextSibling.parentNode === dock.toolsParent
    ? dock.toolsNextSibling
    : null;
  dock.toolsParent.insertBefore(elements.eventTools, toolsReturnBefore);
  const returnsBefore = dock.nextSibling && dock.nextSibling.parentNode === dock.parent
    ? dock.nextSibling
    : null;
  dock.parent.insertBefore(elements.eventsSection, returnsBefore);
  /*
   * Both CSS rules that hide the Window button while docked are cleared right here, and
   * this all runs before any close route reaches focusTerminalWindowOpenButton(). The
   * button left .terminal-window-tools with the cluster above, and dropping the section
   * flag un-hides the .event-toolbar row it landed back in, so the existing isConnected
   * and taskDetail.hidden guard is still a true proxy for "visible and focusable".
   */
  delete elements.eventsSection.dataset.terminalWindow;
  state.eventFilter = state.inlineEventFilter;
  // Scrolling inside the taller window recomputes follow from its own distance to the
  // bottom. The inline list gets back the follow state it had, not the window's.
  state.eventFollow = dock.follow;
  restoreEventOutputScroll();
  rerenderTerminalWindowStream({ forceBottom: dock.follow });
  restoreNativeTerminalScreenScroll(dock);
  if (!dock.follow) elements.detailEvents.scrollTop = dock.scrollTop;
  // The section is back inside the detail grid, so the resize handle can describe it again.
  applyTerminalHeight();
}

/*
 * Focus returns only once the dialog has actually closed. Everything outside an open
 * modal dialog is inert, so a focus call from the cancel handler would be dropped and
 * the operator would land on the document body after Escape. A disabled or hidden button
 * means the task went away underneath the window, and the operator is handed the
 * empty-detail landmark instead of the document body. A live refresh still never steals
 * focus, because nothing calls this without a close.
 */
function focusTerminalWindowOpenButton() {
  const button = elements.terminalWindowOpenButton;
  if (button && button.isConnected && !button.disabled && !elements.taskDetail.hidden) {
    button.focus();
    return;
  }
  focusTaskDetailLandmark();
}

function closeTerminalWindow() {
  // Idempotent on purpose: the hide routes below call this defensively, and a close that
  // has nothing to close must never pull focus off whatever the operator is using.
  if (!terminalWindowIsDocked() && !elements.terminalWindowModal?.open) return;
  undockTerminalWindow();
  if (elements.terminalWindowModal?.open) elements.terminalWindowModal.close();
  else focusTerminalWindowOpenButton();
}

/*
 * The empty-detail region is what replaces everything the operator was reading when the
 * detail panel closes, so it is where focus lands when the Window button is gone. It is
 * a region rather than a control, so it takes a programmatic only tabindex: -1 keeps it
 * out of the tab order while leaving its focus ring visible. A hidden candidate is never
 * focused, because focus would silently fall to the document body instead.
 */
function focusTaskDetailLandmark() {
  const emptyDetail = elements.emptyDetail && !elements.emptyDetail.hidden
    ? elements.emptyDetail
    : null;
  const candidates = [emptyDetail?.querySelector('h2'), emptyDetail, elements.taskList];
  for (const node of candidates) {
    if (!node || !node.isConnected || node.hidden) continue;
    if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
    node.focus();
    return;
  }
}

/*
 * Both #terminal-window-modal and #task-detail-modal are children of #task-detail. An
 * open dialog inside a display:none ancestor is still modal: it is invisible while every
 * control outside it stays inert, which wedges the app with no way back. Every route that
 * hides the detail panel therefore closes its dialogs first, topmost dialog first, and
 * this is the only place allowed to set elements.taskDetail.hidden = true.
 */
function hideTaskDetailPanel() {
  const dialogHadFocus = terminalWindowIsDocked() || elements.terminalWindowModal?.open === true
    || elements.taskDetailModal?.open === true;
  closeTerminalWindow();
  closeTaskDetailModal();
  elements.taskDetail.hidden = true;
  stopNativeTerminalScreenPolling();
  elements.emptyDetail.hidden = false;
  /*
   * A real dialog fires close on a queued task, so its own handler already lands on the
   * landmark once the panel is hidden. This covers the synchronous ordering too, where
   * focus would otherwise sit on the button that just disappeared.
   */
  if (dialogHadFocus) focusTaskDetailLandmark();
}

// Fills the tmux-style terminal status bar from real task state. Every segment is
// data-driven; unknown segments hide rather than inventing a value.
function renderTerminalStatusBar(task) {
  if (!elements.termProvider) {
    return;
  }
  const barProvider = task?.mode === 'plan' ? 'council' : taskProvider(task || {});
  const turboExecuting = task?.mode === 'turbo'
    && ['executing', 'complete'].includes(String(task?.turboPlan?.status || task?.turboPlanSummary?.status || ''));
  const displayModel = turboExecuting ? task?.turbo?.workerModel : task?.model;
  const displayEffort = turboExecuting ? task?.turbo?.workerEffort : task?.effort;
  elements.termProvider.textContent = `${providerLabel(barProvider).toLowerCase()} · ${displayModel || 'session model'}`;

  if (displayEffort) {
    elements.termEffort.hidden = false;
    elements.termEffort.textContent = `${displayEffort} effort`;
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

/*
 * A session task snapshots the project's keep-open choice at submission time, so the row
 * itself decides whether its terminal survives the task. Only disposable tasks can carry
 * the flag: a legacy per-session task never owned its terminal in the first place.
 */
function isSessionTask(task) {
  return task?.keep_terminal_open === true && task?.terminal_lifecycle === 'disposable';
}

function isManualSessionTask(task) {
  return isSessionTask(task)
    && task?.manual_completion === true
    && task?.mode === 'execute'
    && ['codex', 'claude'].includes(task?.provider);
}

/*
 * Plan council and Turbo keep-open tasks own staged workflow conversations and artifacts,
 * so the generic direct-session strip would describe neither workflow honestly. Turbo's
 * final execution conversation is exposed through the dedicated continuation control.
 */
function isDirectSessionTask(task) {
  return isSessionTask(task)
    && ['execute', 'breakdown'].includes(task?.mode || 'execute')
    && ['codex', 'claude'].includes(task?.provider);
}

/*
 * thread_id only exists once CC Relay has launched and bound the terminal, so a queued
 * session task reports pending rather than claiming a terminal it never had.
 */
function sessionTaskState(task) {
  const thread = taskContinuationSession(task);
  if (thread) return thread.status === 'idle' ? 'open-idle' : 'open-busy';
  return task?.thread_id ? 'closed' : 'pending';
}

const SESSION_BADGE_WORDS = {
  'open-idle': 'open',
  'open-busy': 'busy',
  pending: 'pending',
  closed: 'closed',
};

function sessionBadgeWord(stateKey) {
  return SESSION_BADGE_WORDS[stateKey] || 'unknown';
}

function taskMonitorTasks(statusTasks, tasks) {
  const taskRows = Array.isArray(tasks) ? tasks : [];
  const rowsById = new Map(taskRows.map((task) => [task.id, task]));
  const monitored = (Array.isArray(statusTasks)
    ? statusTasks
    : taskRows.filter((task) => task.status === 'running'))
    .map((task) => ({ ...rowsById.get(task.id), ...task }));
  const monitoredIds = new Set(monitored.map((task) => task.id));
  for (const task of taskRows) {
    if (task.status !== 'open' || !isManualSessionTask(task) || monitoredIds.has(task.id)) continue;
    monitored.push(task);
    monitoredIds.add(task.id);
  }
  return monitored;
}

function taskMonitorPresentation(task) {
  if (!isManualSessionTask(task)) {
    return { state: 'running', label: 'Running', terminalSession: false };
  }
  if (task.status === 'running') {
    return { state: 'running', label: 'Session running', terminalSession: true };
  }
  const terminalState = sessionTaskState(task);
  if (terminalState === 'open-busy') {
    return { state: 'busy', label: 'Terminal busy', terminalSession: true };
  }
  if (terminalState === 'closed') {
    return { state: 'closed', label: 'Terminal closed', terminalSession: true };
  }
  if (terminalState === 'open-idle') {
    return { state: 'idle', label: 'Terminal idle', terminalSession: true };
  }
  return { state: 'idle', label: 'Session idle', terminalSession: true };
}

function taskMonitorResponse(task, presentation = taskMonitorPresentation(task)) {
  const update = task?.latestAgentUpdate?.text;
  if (task?.status === 'open') {
    if (task.error) return task.error;
    if (task.result) return task.result;
    if (update) return update;
    return presentation.state === 'closed'
      ? 'Send a command to relaunch this session'
      : 'Ready for another command';
  }
  return update || 'Waiting for the first agent response';
}

function taskMonitorResponseHash(task) {
  const text = String(taskMonitorResponse(task));
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return hash >>> 0;
}

function isFailedSessionFollowUp(task) {
  return String(task?.error || '').startsWith('Same-session follow-up');
}

function resizeContinuationInput() {
  elements.continuationInput.style.height = 'auto';
  elements.continuationInput.style.height = `${Math.min(elements.continuationInput.scrollHeight, 92)}px`;
}

function reliableClaudeSteering(task) {
  return task?.provider === 'claude'
    && task?.status === 'running'
    && state.status?.capabilities?.claudeTaskSteering === true
    && state.status?.capabilities?.claudeSteerOutbox === true;
}

function continuationSteerPendingCount(taskId) {
  return Math.max(0, Number(state.continuationSteerPending.get(taskId)) || 0);
}

function adjustContinuationSteerPending(taskId, change) {
  const next = Math.max(0, continuationSteerPendingCount(taskId) + change);
  if (next > 0) state.continuationSteerPending.set(taskId, next);
  else state.continuationSteerPending.delete(taskId);
  return next;
}

function retainContinuationRetry(taskId, entry) {
  const waiting = state.continuationRetryDrafts.get(taskId) || [];
  waiting.push(entry);
  state.continuationRetryDrafts.set(taskId, waiting);
}

function restoreContinuationRetry(taskId) {
  const restore = continuationRetryRestore({
    draft: state.continuationDrafts.get(taskId),
    attachments: state.continuationAttachments.get(taskId),
    waiting: state.continuationRetryDrafts.get(taskId),
  });
  const { entry } = restore;
  if (!entry) return false;
  if (restore.waiting.length > 0) {
    state.continuationRetryDrafts.set(taskId, restore.waiting);
  } else {
    state.continuationRetryDrafts.delete(taskId);
  }
  state.continuationDrafts.set(taskId, entry.prompt);
  if (entry.attachments.length > 0) {
    state.continuationAttachments.set(taskId, entry.attachments);
  }
  return true;
}

function renderTaskContinuation(task, { taskChanged = false } = {}) {
  const turboExecution = task?.mode === 'turbo'
    && task?.terminal_lifecycle === 'disposable'
    && task?.provider === 'codex'
    && Boolean(task?.turbo?.executionThreadId)
    && task?.thread_id === task?.turbo?.executionThreadId;
  const direct = (task?.mode === 'execute' && ['codex', 'claude'].includes(task.provider))
    || turboExecution;
  const manualSession = isManualSessionTask(task);
  const manualSessionComplete = manualSession && task.status === 'complete';
  elements.continuationForm.hidden = !direct || manualSessionComplete;
  if (!direct || manualSessionComplete) return;
  elements.continuationForm.dataset.provider = task.provider;
  elements.continuationForm.dataset.sessionMode = String(manualSession);
  elements.continuationLabel.textContent = manualSession
    ? 'Terminal session'
    : turboExecution ? 'Continue execution session' : 'Continue session';
  elements.continuationInput.placeholder = manualSession
    ? 'Send the next command or request to this terminal...'
    : 'Ask a follow-up in this terminal...';
  const retryRestored = restoreContinuationRetry(task.id);
  if (
    retryRestored
    || taskChanged
    || elements.continuationMessage.dataset.taskId !== String(task.id)
  ) {
    // A draft held after an unconfirmed delivery deliberately rehydrates as nothing. The
    // words remain recoverable from the map; putting them back here would resurrect a
    // message the provider may already be running.
    elements.continuationInput.value = draftInputValue(state.continuationDrafts.get(task.id));
    elements.continuationMessage.dataset.taskId = String(task.id);
    elements.continuationMessage.dataset.kind = 'hint';
  }

  const session = taskContinuationSession(task);
  const supportsDirectFollowUp = state.status?.capabilities?.taskDirectFollowUp === true;
  const supportsTaskSteering = !turboExecution && state.status?.capabilities?.taskSteering === true;
  const supportsClaudeTaskSteering = state.status?.capabilities?.claudeTaskSteering === true;
  const supportsClaudeSteerOutbox = state.status?.capabilities?.claudeSteerOutbox === true;
  const resumableSession = task.terminal_lifecycle === 'disposable'
    && state.status?.capabilities?.resumableDisposableSessions === true
    && Boolean(task.thread_id)
    && task.status !== 'running';
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
    supportsClaudeTaskSteering,
    supportsClaudeSteerOutbox,
    sessionConnected: Boolean(session),
    resumableSession,
    busy,
    taskRunning: task.status === 'running',
    provider: task.provider,
    submitting,
    pendingCount: continuationSteerPendingCount(task.id),
    prompt: elements.continuationInput.value,
  });
  const relay = taskRelayLabel(task);
  elements.continuationForm.dataset.submitting = String(submitting);
  elements.continuationForm.setAttribute('aria-busy', String(submitting));
  const continuationModel = turboExecution ? task.turbo.workerModel : task.model;
  const continuationEffort = turboExecution ? task.turbo.workerEffort : task.effort;
  elements.continuationContext.textContent = `${relay} · ${providerLabel(task.provider)} · ${continuationModel || 'session model'} · ${continuationEffort || 'default'} effort`;
  elements.continuationState.dataset.state = presentation.state;
  elements.continuationState.textContent = presentation.label;
  elements.continuationInput.disabled = presentation.inputDisabled;
  const attachments = state.continuationAttachments.get(task.id) || [];
  const attachmentsAvailable = followUpAttachmentsAvailable();
  elements.continuationAttach.dataset.state = attachmentsAvailable ? 'ready' : 'unavailable';
  elements.continuationAttach.title = attachmentsAvailable
    ? 'Add PNG, JPEG, or WebP images'
    : 'Restart CC Relay to add images to follow-up messages';
  elements.continuationAttachmentInput.disabled = presentation.inputDisabled
    || !attachmentsAvailable
    || attachments.length >= MAX_IMAGE_ATTACHMENTS;
  elements.continuationAttachmentCount.textContent = attachments.length === 0
    ? 'No images attached'
    : `${attachments.length} image${attachments.length === 1 ? '' : 's'} attached`;
  elements.continuationAttachments.hidden = attachments.length === 0;
  elements.continuationClearImages.hidden = attachments.length === 0;
  elements.continuationClearImages.disabled = presentation.inputDisabled;
  elements.continuationSend.querySelector('span').textContent = manualSession
    && task.status === 'open'
    && presentation.state === 'ready'
    ? 'Send command'
    : presentation.buttonLabel;
  elements.continuationSend.title = submitting
    ? 'Sending this message. Wait for confirmation before sending another.'
    : '';
  // A dispatch outcome outlives the periodic refresh. Without warning in this list the
  // next render would replace an unconfirmed-delivery notice with a generic hint.
  if (!['error', 'success', 'warning'].includes(elements.continuationMessage.dataset.kind)) {
    elements.continuationMessage.textContent = presentation.hint;
    elements.continuationMessage.title = presentation.hint;
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

function nativeTokenUsageTitle(usage) {
  return [
    `${Math.round(usage.inputTokens).toLocaleString()} input`,
    `${Math.round(usage.outputTokens).toLocaleString()} output`,
    `${Math.round(usage.reasoningTokens).toLocaleString()} reasoning`,
    `${Math.round(usage.cacheReadTokens).toLocaleString()} cache read`,
    `${Math.round(usage.cacheWriteTokens).toLocaleString()} cache write`,
    `${Math.round(usage.totalTokens).toLocaleString()} provider total`,
  ].join(' · ');
}

function tokenSpeedTitle(throughput) {
  return `Average output rate: ${Math.round(throughput.outputTokens).toLocaleString()} output tokens / ${throughput.elapsedSeconds.toFixed(1)} task seconds. ${nativeTokenUsageTitle(throughput)}`;
}

function renderEventStream(events, task, {
  forceBottom = false,
  resetDisclosures = false,
  prompts = state.selectedTaskPrompts,
} = {}) {
  if (resetDisclosures) {
    state.expandedEventDetails.clear();
    state.eventOutputScroll.clear();
  } else {
    rememberEventDisclosures();
    rememberEventOutputScroll();
  }
  const previousScrollTop = elements.detailEvents.scrollTop;
  const previousOverviewScrollTop = resetDisclosures ? 0 : elements.eventOverviewBody.scrollTop;
  const previousPlanScroller = resetDisclosures
    ? null
    : elements.eventOverviewBody.querySelector('.activity-overview-plan > ol');
  const previousPlanScrollTop = previousPlanScroller?.scrollTop || 0;
  const restorePlanFocus = document.activeElement === previousPlanScroller;
  const displayEvents = mergePromptMessages(events, prompts, { provider: taskProvider(task) });
  const grouped = groupEventEntries(displayEvents);
  const filterOptions = { showThinking: state.showThinking };
  const visible = filterEventEntries(grouped, state.eventFilter, filterOptions);
  const reasoningCount = grouped.filter(isReasoningEntry).length;
  const messageCounts = eventMessageCounts(grouped);
  const filterCounts = {
    all: filterEventEntries(grouped, 'all', filterOptions).length,
    highlights: filterEventEntries(grouped, 'highlights', filterOptions).length,
    commands: filterEventEntries(grouped, 'commands', filterOptions).length,
    conversation: messageCounts.user + messageCounts.assistant,
    mine: messageCounts.user,
    ai: messageCounts.assistant,
  };
  const entrySequence = new Map(grouped.map((entry, index) => [entry, index]));
  // A turn that is no longer running owns no live sub-agents, however its last notification
  // landed, so the active count clears with the turn instead of stranding a number.
  const stats = eventStreamStats(grouped, { turnEnded: task.status !== 'running' });
  const throughput = tokenThroughput(events, task);
  const thinkingTokens = throughput?.reasoningTokens ?? stats.thinkingTokens;
  const overview = taskActivityOverview(grouped, task);
  state.selectedTaskEvents = events;
  state.selectedTaskPrompts = prompts;
  state.selectedTaskForEvents = task;
  state.visibleEventEntries = visible;

  const stateLabels = {
    queued: 'Waiting',
    running: 'Live',
    'input-required': 'Input needed',
    complete: 'Finished',
    failed: 'Failed',
    cancelled: 'Cancelled',
    interrupted: 'Interrupted',
  };
  let awaitingTerminalInput = false;
  for (const event of events) {
    if (event.payload?.type === 'claude/input-required') awaitingTerminalInput = true;
    if (event.payload?.type === 'claude/input-resumed') awaitingTerminalInput = false;
  }
  const sessionState = task.status === 'running' && awaitingTerminalInput
    ? 'input-required'
    : task.status;
  elements.eventSessionState.dataset.state = sessionState;
  elements.eventSessionState.querySelector('span').textContent = stateLabels[sessionState] || 'Recorded';
  const filterSummaryLabels = {
    all: 'signals',
    highlights: 'highlights',
    commands: 'commands',
    conversation: 'conversation messages',
    mine: 'sent',
    ai: 'AI messages',
  };
  const filterSummary = filterSummaryLabels[state.eventFilter] || 'signals';
  const thinkingIsHidingSignals = !state.showThinking && reasoningCount > 0;
  elements.eventSummary.textContent = state.eventFilter === 'all' && !thinkingIsHidingSignals
    ? `${grouped.length} signals`
    : `${visible.length} ${filterSummary} · ${grouped.length} total`;
  elements.eventSummary.title = `${visible.length} of ${grouped.length} signals · ${displayEvents.length} displayed events · ${events.length} provider events`;
  renderTerminalStatusBar(task);
  const conversationTokens = taskTokenPresentation(task);
  elements.eventMetrics.innerHTML = `
    ${overview.runtimeMetric}
    ${stats.plan ? `<span class="has-plan"><b>${stats.plan.done}/${stats.plan.total}</b><small>plan steps</small></span>` : ''}
    ${stats.agents ? `<span class="has-agents"><b>${stats.agents}</b><small>sub-agents</small></span>` : ''}
    ${stats.running ? `<span class="is-running"><b>${stats.running}</b><small>active</small></span>` : ''}
    ${throughput ? `
      <span class="has-token-speed" data-task-token-speed title="${tokenSpeedTitle(throughput)}"><b>${throughput.rateLabel}</b><small>output tokens/s</small></span>
      <span class="has-token-input" title="${nativeTokenUsageTitle(throughput)}"><b>${Math.round(throughput.inputTokens).toLocaleString()}</b><small>input tokens</small></span>
      <span class="has-token-output" title="${nativeTokenUsageTitle(throughput)}"><b>${Math.round(throughput.outputTokens).toLocaleString()}</b><small>output tokens</small></span>
    ` : ''}
    ${!throughput && conversationTokens ? `
      <span class="has-token-input"><b>${conversationTokens.inputTokens.toLocaleString()}</b><small>in</small></span>
      <span class="has-token-output"><b>${conversationTokens.outputTokens.toLocaleString()}</b><small>out</small></span>
    ` : ''}
    <span><b>${thinkingTokens.toLocaleString()}</b><small>thinking</small></span>
    <span><b>${stats.commands}</b><small>commands</small></span>
    <span><b>${stats.files}</b><small>file changes</small></span>
    <span class="has-user-messages"><b>${messageCounts.user}</b><small>sent</small></span>
    <span class="has-ai-messages"><b>${messageCounts.assistant}</b><small>AI messages</small></span>
    <span class="${stats.errors ? 'has-errors' : ''}"><b>${stats.errors}</b><small>errors</small></span>
  `;
  elements.eventOverviewBody.innerHTML = overview.body;
  elements.eventOverviewBody.scrollTop = previousOverviewScrollTop;
  const planScroller = elements.eventOverviewBody.querySelector('.activity-overview-plan > ol');
  if (planScroller) {
    planScroller.scrollTop = previousPlanScrollTop;
    if (restorePlanFocus) planScroller.focus({ preventScroll: true });
  }
  elements.copyEventsButton.disabled = visible.length === 0;
  const emptyStates = {
    conversation: ['No conversation yet', 'Your messages and AI responses will appear here.'],
    mine: ['No messages from you yet', 'Your original request and sent updates appear here.'],
    ai: ['No AI messages yet', 'The next provider response will appear here.'],
    commands: ['No commands yet', 'Commands and connected tool calls will appear here.'],
    highlights: ['No highlights yet', 'Important work and outcomes will appear here.'],
    all: ['No activity yet', 'New task signals will appear here.'],
  };
  const emptyState = state.eventFilter === 'all'
    && !state.showThinking
    && reasoningCount > 0
    && visible.length === 0
    ? ['Thinking is hidden', 'Turn on Thinking to see provider summaries.']
    : emptyStates[state.eventFilter] || emptyStates.all;
  elements.detailEvents.innerHTML = visible.length === 0
    ? `<div class="events-empty"><span aria-hidden="true">⌁</span><strong>${escapeHtml(emptyState[0])}</strong><small>${escapeHtml(emptyState[1])}</small></div>`
    : visible.map((entry) => renderEventEntry(entry, task, entrySequence.get(entry))).join('');
  restoreEventDisclosures();
  restoreEventOutputScroll();

  if (forceBottom || state.eventFollow) {
    state.eventFollow = true;
    elements.detailEvents.scrollTop = elements.detailEvents.scrollHeight;
  } else {
    elements.detailEvents.scrollTop = previousScrollTop;
  }
  updateEventControls(filterCounts, reasoningCount);
}

function threadProvider(thread) {
  return thread.provider || 'codex';
}

function providerLabel(provider) {
  if (provider === 'claude') {
    return 'Claude';
  }
  if (provider === 'opencode') {
    return 'OpenCode';
  }
  if (provider === 'council') {
    return 'Plan council';
  }
  if (provider === 'relay') {
    return 'CC Relay';
  }
  return 'Codex';
}

function taskProvider(task) {
  return task.provider || 'codex';
}

function providerIcon(provider) {
  if (provider === 'claude') return '✳';
  return provider === 'opencode' ? 'OC' : '&gt;_';
}

function providerIconClass(provider) {
  if (provider === 'claude') return 'agent-icon-claude';
  return provider === 'opencode' ? 'agent-icon-opencode' : 'agent-icon-codex';
}

function threadDisplayName(thread) {
  if (!thread) return 'terminal';
  if (thread.automatic) return thread.title || `Automatic ${providerLabel(thread.provider)}`;
  return threadProvider(thread) === 'claude' ? thread.title : `CC Relay ${relayNumber(thread)}`;
}

function executionLabel(task) {
  if (task.mode === 'turbo') {
    const planner = `${task.turbo?.plannerModel || task.model || 'planner'} · ${task.turbo?.plannerEffort || task.effort || 'default'}`;
    const singleExecutor = taskUsesSingleExecutorTurbo(task);
    const workers = singleExecutor
      ? `${task.turbo?.workerCount || 1} concurrent executions · ${task.turbo?.workerModel || 'execution model'} · ${task.turbo?.workerEffort || 'default'}`
      : `${task.turbo?.workerCount || task.turbo?.workers?.length || 0} workers · ${task.turbo?.workerModel || 'worker model'} · ${task.turbo?.workerEffort || 'default'}`;
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
  if (thread && threadProvider(thread) === 'codex') return `CC Relay ${relayNumber(thread)}`;
  if (thread) return `Claude · ${thread.title || 'session'}`;
  if (task.thread_name) {
    return task.provider === 'codex'
      ? `CC Relay · ${task.thread_name}`
      : `${providerLabel(task.provider)} · ${task.thread_name}`;
  }
  if (task.terminal_lifecycle === 'disposable') {
    if (task.mode === 'plan') return 'Automatic Claude + Codex';
    if (task.mode === 'turbo') return taskUsesSingleExecutorTurbo(task) ? 'Automatic Turbo pipeline' : 'Automatic Codex fleet';
    return `Automatic ${providerLabel(task.provider)} instance`;
  }
  return task.mode === 'turbo' ? 'Multiple Relays' : 'Unassigned CC Relay';
}

function assignmentTargetLabel(thread) {
  return threadProvider(thread) === 'codex'
    ? `CC Relay ${relayNumber(thread)}`
    : `Claude · ${thread.title || 'session'}`;
}

function turboIdentity(threadId, storedTitle, fallback = 'Unassigned') {
  const thread = threadId ? state.threads.find((item) => item.id === threadId) : null;
  if (thread && threadProvider(thread) === 'codex') {
    return {
      label: `CC Relay ${relayNumber(thread)}`,
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

function turboFooterIdentity(task) {
  if (
    task?.terminal_lifecycle === 'disposable'
    && taskUsesSingleExecutorTurbo(task)
    && task?.turbo?.executionThreadId
  ) {
    return {
      ...turboIdentity(
        task.turbo.executionThreadId,
        task.turbo.executionThreadName,
        'Execution session',
      ),
      role: 'Executor',
    };
  }
  return { ...turboPlannerIdentity(task), role: 'Planner' };
}

function turboFleetMarkup(task) {
  if (task.mode !== 'turbo') return '';
  if (taskUsesSingleExecutorTurbo(task)) {
    const concurrency = Number(task.turbo?.workerCount || 1);
    const planner = `${task.turbo?.plannerModel || task.model || 'planner'} · ${task.turbo?.plannerEffort || task.effort || 'default'}`;
    const executor = `${task.turbo?.workerModel || 'execution model'} · ${task.turbo?.workerEffort || 'default'}`;
    return `
      <div class="turbo-fleet" aria-label="Turbo planning and execution stages">
        <span class="turbo-fleet-role">Planning</span>
        <span class="turbo-fleet-chip turbo-fleet-chip-neutral">${escapeHtml(planner)} · fresh session</span>
        <span class="turbo-fleet-divider" aria-hidden="true">→</span>
        <span class="turbo-fleet-role">Execution</span>
        <span class="turbo-fleet-workers">
          <span class="turbo-fleet-chip turbo-fleet-chip-neutral">${escapeHtml(executor)} · one terminal per Turbo prompt</span>
          <span class="turbo-fleet-chip turbo-fleet-chip-neutral">${concurrency} concurrent in queue</span>
        </span>
      </div>
    `;
  }
  const manifest = turboParentManifest(task);
  const planner = turboIdentity(manifest.planner.threadId, manifest.planner.title, 'Planner');
  const workers = manifest.workers.map((worker) => turboIdentity(worker.threadId, worker.title, `Worker ${worker.slot}`));
  return `
    <div class="turbo-fleet" aria-label="Turbo CC Relay fleet">
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
  return taskDurationLabel(task).replace(/^(?:Took|Running) /, '');
}

function taskTokenMetricsMarkup(presentation, className = 'task-token-metrics') {
  if (!presentation) return '';
  return `
    <span
      class="${className}"
      data-token-level="${escapeHtml(presentation.level)}"
      title="${escapeHtml(presentation.title)}"
      aria-label="${escapeHtml(presentation.title)}"
    >
      <span><small>Total</small><b>${escapeHtml(presentation.totalLabel)}</b></span>
      <span><small>Out</small><b>${escapeHtml(presentation.outputLabel)}</b></span>
    </span>
  `;
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

function taskSearchSupported() {
  return state.status?.capabilities?.taskFullTextSearch === true;
}

function taskSearchMatches() {
  return new Map(state.taskSearchResults.map((result) => [Number(result.taskId), result.match]));
}

function renderTaskSearch() {
  const active = taskSearchActive(state.taskSearchQuery);
  const supported = taskSearchSupported();
  const statusKnown = Boolean(state.status);
  elements.taskSearchInput.disabled = !supported || !state.activeProjectPath;
  elements.taskSearchInput.placeholder = !state.activeProjectPath
    ? 'Select a project to search tasks'
    : !statusKnown
      ? 'Loading task search'
      : supported
        ? 'Search every command and response'
        : 'Restart CC Relay to search tasks';
  if (document.activeElement !== elements.taskSearchInput
    && elements.taskSearchInput.value !== state.taskSearchQuery) {
    elements.taskSearchInput.value = state.taskSearchQuery;
  }
  elements.taskSearchClear.hidden = !active;
  elements.taskSearchShortcut.textContent = active ? 'Esc' : '/';
  elements.taskSearch.dataset.state = state.taskSearchError
    ? 'error'
    : state.taskSearchPending
      ? 'searching'
      : active ? 'active' : 'idle';
  if (state.taskSearchPending) {
    elements.taskSearchStatus.textContent = 'Searching all saved conversations';
  } else if (state.taskSearchError) {
    elements.taskSearchStatus.textContent = state.taskSearchError;
  } else if (active) {
    const shown = state.taskSearchResults.length;
    elements.taskSearchStatus.textContent = state.taskSearchTotal > shown
      ? `${shown} of ${state.taskSearchTotal} matches`
      : `${state.taskSearchTotal} match${state.taskSearchTotal === 1 ? '' : 'es'} · all dates`;
  } else {
    elements.taskSearchStatus.textContent = '';
  }
}

function resetTaskSearchResults() {
  state.taskSearchResults = [];
  state.taskSearchTotal = 0;
  state.taskSearchPending = false;
  state.taskSearchError = '';
}

async function runTaskSearch() {
  if (state.taskSearchTimer !== null) {
    window.clearTimeout(state.taskSearchTimer);
    state.taskSearchTimer = null;
  }
  const query = state.taskSearchQuery.trim();
  const projectPath = state.activeProjectPath;
  if (!query) {
    resetTaskSearchResults();
    renderStatus();
    renderTasks();
    return;
  }
  if (!taskSearchSupported() || !projectPath) {
    state.taskSearchPending = false;
    state.taskSearchError = taskSearchSupported()
      ? 'Select a project to search tasks.'
      : 'Restart CC Relay to activate task search.';
    renderStatus();
    renderTasks();
    return;
  }

  const sequence = ++state.taskSearchSequence;
  state.taskSearchPending = true;
  state.taskSearchError = '';
  state.taskSearchResults = [];
  state.taskSearchTotal = 0;
  renderStatus();
  renderTasks();
  try {
    const body = await api(`/api/tasks/search?projectPath=${encodeURIComponent(projectPath)}&query=${encodeURIComponent(query)}`);
    const searchInputSelection = document.activeElement === elements.taskSearchInput
      && elements.taskSearchInput.selectionEnd > elements.taskSearchInput.selectionStart;
    if (!searchInputSelection) await textSelectionGuard.waitForClear();
    if (
      sequence !== state.taskSearchSequence
      || query !== state.taskSearchQuery.trim()
      || !sameProjectPath(projectPath, state.activeProjectPath)
    ) return;
    state.taskSearchResults = Array.isArray(body.results) ? body.results : [];
    state.taskSearchTotal = Number(body.total) || 0;
  } catch (error) {
    if (sequence !== state.taskSearchSequence) return;
    state.taskSearchError = `Search failed: ${error.message}`;
  } finally {
    if (sequence === state.taskSearchSequence) {
      state.taskSearchPending = false;
      renderStatus();
      renderTasks();
    }
  }
}

function scheduleTaskSearch(delay = TASK_SEARCH_DEBOUNCE_MS) {
  if (state.taskSearchTimer !== null) window.clearTimeout(state.taskSearchTimer);
  state.taskSearchTimer = window.setTimeout(() => {
    state.taskSearchTimer = null;
    void runTaskSearch();
  }, delay);
}

function clearTaskSearch({ focus = false, render = true } = {}) {
  if (state.taskSearchTimer !== null) {
    window.clearTimeout(state.taskSearchTimer);
    state.taskSearchTimer = null;
  }
  state.taskSearchSequence += 1;
  state.taskSearchQuery = '';
  resetTaskSearchResults();
  elements.taskSearchInput.value = '';
  if (render) {
    renderStatus();
    renderTasks();
  }
  if (focus && !elements.taskSearchInput.disabled) elements.taskSearchInput.focus();
}

function renderHistoryLedger(scopedTasks, visibleTasks) {
  const searching = taskSearchActive(state.taskSearchQuery);
  const historyActive = state.taskView === 'history' && !searching;
  elements.historyLedger.hidden = !historyActive;
  for (const button of elements.taskViewButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.taskView === state.taskView));
    button.disabled = searching;
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

function resetStandupCopyFeedback() {
  if (state.standupCopyTimer !== null) {
    window.clearTimeout(state.standupCopyTimer);
    state.standupCopyTimer = null;
  }
  elements.standupCopy.textContent = 'Copy changelog';
  elements.standupCopyStatus.textContent = '';
}

function resetStandupOutput() {
  state.standupChanges = emptyStandupSections();
  state.standupClipboardText = '';
  state.standupTaskCount = 0;
  state.standupExecutionCount = 0;
  state.standupIncludedTaskCount = 0;
  state.standupProvider = null;
  state.standupCustomPromptApplied = false;
  state.standupError = '';
  state.standupFollowUps = [];
  state.standupFollowUpError = '';
  elements.standupFollowUpInput.value = '';
}

function standupGenerationSupported() {
  return state.status?.capabilities?.aiStandupGeneration === true
    && state.status?.capabilities?.aiStandupChangelog === true
    && state.status?.capabilities?.aiStandupStartDate === true;
}

function standupCustomPromptSupported() {
  return state.status?.capabilities?.projectStandupPrompt === true;
}

function standupFollowUpSupported() {
  return state.status?.capabilities?.aiStandupFollowUp === true;
}

function standupBusy() {
  return state.standupGenerating || state.standupPromptSaving || state.standupFollowUpPending;
}

function standupTwoDayRangeSupported() {
  return state.status?.capabilities?.aiStandupTwoDayRange === true;
}

function selectedStandupDays() {
  return standupTwoDayRangeSupported() && Number(elements.standupDays.value) === 2 ? 2 : 1;
}

function updateStandupDateMaximum() {
  const maximum = new Date();
  maximum.setHours(0, 0, 0, 0);
  maximum.setDate(maximum.getDate() - (selectedStandupDays() - 1));
  const value = localDateInputValue(maximum);
  elements.standupDate.max = value;
  if (elements.standupDate.value && elements.standupDate.value > value) {
    elements.standupDate.value = value;
    state.standupDate = value;
  }
}

function projectStandupCustomPrompt(project = activeProject()) {
  return typeof project?.standup_custom_prompt === 'string' ? project.standup_custom_prompt : '';
}

function standupCustomPromptDraft() {
  return elements.standupCustomPrompt.value.trim();
}

function standupCustomPromptDirty() {
  return standupCustomPromptDraft() !== projectStandupCustomPrompt();
}

function renderStandupCustomPrompt() {
  const supported = standupCustomPromptSupported();
  const project = activeProject();
  if (supported && project && !state.standupPromptEdited && !state.standupPromptSaving) {
    elements.standupCustomPrompt.value = projectStandupCustomPrompt(project);
  }
  const dirty = supported && project && standupCustomPromptDirty();
  elements.standupCustomPromptField.hidden = !supported;
  if (!supported) return;

  elements.standupCustomPrompt.disabled = standupBusy() || !project;
  elements.standupCustomPromptSave.disabled = (
    standupBusy()
    || !project
    || !dirty
  );
  elements.standupCustomPromptSave.textContent = state.standupPromptSaving ? 'Saving...' : 'Save prompt';
  if (state.standupPromptStatus) {
    elements.standupCustomPromptStatus.textContent = state.standupPromptStatus;
    return;
  }
  if (dirty) {
    elements.standupCustomPromptStatus.textContent = 'Unsaved changes will be saved before generation.';
  } else if (projectStandupCustomPrompt(project)) {
    elements.standupCustomPromptStatus.textContent = `Applied by default to ${project.name} standups.`;
  } else {
    elements.standupCustomPromptStatus.textContent = `No custom prompt saved for ${project?.name || 'this project'}.`;
  }
}

async function saveStandupCustomPrompt() {
  const project = activeProject();
  if (!project || state.standupPromptSaving) return false;
  if (!standupCustomPromptSupported()) {
    state.standupPromptStatus = 'Restart CC Relay to save a project Standup prompt.';
    renderStandupCustomPrompt();
    return false;
  }
  const prompt = standupCustomPromptDraft();
  if (prompt.length > MAX_STANDUP_CUSTOM_PROMPT_LENGTH) {
    state.standupPromptStatus = `Keep the custom prompt under ${MAX_STANDUP_CUSTOM_PROMPT_LENGTH.toLocaleString()} characters.`;
    renderStandupCustomPrompt();
    return false;
  }
  if (prompt === projectStandupCustomPrompt(project)) {
    state.standupPromptEdited = false;
    elements.standupCustomPrompt.value = projectStandupCustomPrompt(project);
    renderStandupCustomPrompt();
    return true;
  }

  state.standupPromptSaving = true;
  state.standupPromptStatus = 'Saving project prompt...';
  renderStandup();
  try {
    const body = await api(`/api/projects/${project.id}/standup-prompt`, {
      method: 'PATCH',
      body: JSON.stringify({ prompt }),
    });
    state.projects = state.projects.map((item) => (
      item.id === body.project.id ? body.project : item
    ));
    if (sameProjectPath(state.activeProjectPath, project.path)) {
      elements.standupCustomPrompt.value = projectStandupCustomPrompt(body.project);
      state.standupPromptEdited = false;
      state.standupPromptStatus = projectStandupCustomPrompt(body.project)
        ? `Saved for ${body.project.name}.`
        : `Cleared for ${body.project.name}.`;
    }
    return true;
  } catch (error) {
    state.standupPromptStatus = `Could not save the project prompt: ${error.message}`;
    return false;
  } finally {
    state.standupPromptSaving = false;
    renderStandup();
  }
}

function standupScopeLabel() {
  return 'All Relays';
}

function standupDateLabel(anchor, dayCount = 1) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  if (dayCount === 1) return formatter.format(anchor);
  const finalDay = new Date(anchor);
  finalDay.setDate(finalDay.getDate() + 1);
  return `${formatter.format(anchor)} to ${formatter.format(finalDay)}`;
}

function standupItemCount(sections = state.standupChanges) {
  return STANDUP_CHANGELOG_SECTIONS.reduce((total, { key }) => total + sections[key].length, 0);
}

function standupListMarkup(items, kind) {
  return items.map((item) => `
    <li data-status="${kind}">
      <span class="standup-item-marker" aria-hidden="true"></span>
      <div class="standup-item-copy">
        <p>${escapeHtml(item)}</p>
      </div>
    </li>
  `).join('');
}

function standupResultsMarkup(sections) {
  return STANDUP_CHANGELOG_SECTIONS
    .filter(({ key }) => sections[key].length > 0)
    .map(({ key, title }) => `
      <section class="standup-result-group" data-kind="${key}" aria-labelledby="standup-${key}-title">
        <div class="standup-result-heading">
          <span id="standup-${key}-title">${title}</span>
          <small>${sections[key].length}</small>
        </div>
        <ul class="standup-list">${standupListMarkup(sections[key], key)}</ul>
      </section>
    `).join('');
}

function standupFollowUpMarkup(anchor, dayCount) {
  const dateLabel = standupDateLabel(anchor, dayCount);
  return state.standupFollowUps.map((turn, index) => `
    <article class="standup-follow-up-turn">
      <header>
        <small>Question ${String(index + 1).padStart(2, '0')}</small>
        <time>${escapeHtml(dateLabel)}</time>
      </header>
      <p class="standup-follow-up-question">${escapeHtml(turn.question)}</p>
      <div class="standup-follow-up-answer">
        <span aria-hidden="true">AI</span>
        <p>${escapeHtml(turn.answer)}</p>
      </div>
    </article>
  `).join('');
}

function renderStandupFollowUp(anchor, dayCount, itemCount) {
  const visible = standupFollowUpSupported() && Boolean(anchor) && itemCount > 0;
  elements.standupFollowUp.hidden = !visible;
  if (!visible) return;

  const dateLabel = standupDateLabel(anchor, dayCount);
  elements.standupFollowUpRange.textContent = `Grounded in executions from ${dateLabel}`;
  const signature = JSON.stringify(state.standupFollowUps);
  if (elements.standupFollowUpLedger.dataset.signature !== signature) {
    elements.standupFollowUpLedger.innerHTML = standupFollowUpMarkup(anchor, dayCount);
    elements.standupFollowUpLedger.dataset.signature = signature;
  }
  elements.standupFollowUpLedger.hidden = state.standupFollowUps.length === 0;
  elements.standupFollowUpInput.disabled = state.standupFollowUpPending;
  elements.standupFollowUpSend.disabled = state.standupFollowUpPending
    || !elements.standupFollowUpInput.value.trim();
  elements.standupFollowUpSend.textContent = state.standupFollowUpPending ? 'Checking...' : 'Ask';
  for (const suggestion of elements.standupFollowUpSuggestions.querySelectorAll('button')) {
    suggestion.disabled = state.standupFollowUpPending;
  }
  if (state.standupFollowUpPending) {
    elements.standupFollowUpStatus.textContent = 'Checking the saved execution dates and conversation history...';
  } else if (state.standupFollowUpError) {
    elements.standupFollowUpStatus.textContent = state.standupFollowUpError;
  } else if (state.standupFollowUps.length > 0) {
    const latest = state.standupFollowUps.at(-1);
    elements.standupFollowUpStatus.textContent = `${providerLabel(latest.provider)} answered from the selected dated evidence.`;
  } else {
    elements.standupFollowUpStatus.textContent = 'Questions use exact execution starts, completion times, prompts, and responses.';
  }
}

function renderStandup() {
  const anchor = dateFromLocalInput(elements.standupDate.value);
  const dayCount = selectedStandupDays();
  const supported = standupGenerationSupported();
  const sourceTasks = anchor ? tasksForStandupDays(projectTasks(), anchor, dayCount) : [];
  const projectName = workspaceName(state.activeProjectPath);
  const itemCount = standupItemCount();
  const activeGenerator = providerLabel(state.standupProvider || state.selectedProvider);
  const customPromptPresent = Boolean(projectStandupCustomPrompt());
  const customPromptApplied = state.standupProvider
    ? state.standupCustomPromptApplied
    : customPromptPresent;
  const busy = standupBusy();

  renderStandupCustomPrompt();
  elements.standupDaysField.hidden = !standupTwoDayRangeSupported();
  elements.standupDays.disabled = busy;
  elements.standupSubtitle.textContent = `Select one or two days when work executed to generate a CHANGELOG-style standup from saved prompts and responses in ${projectName}.`;
  elements.standupScopeLabel.textContent = `${projectName} · ${standupScopeLabel()}`;
  elements.standupDateLabel.textContent = anchor ? standupDateLabel(anchor, dayCount) : 'Select a workday';
  elements.standupGeneratorProvider.textContent = state.standupProvider
    ? `${activeGenerator} used`
    : `${activeGenerator} preferred`;
  elements.standupGeneratorNote.textContent = state.standupProvider
    ? `A fresh isolated ${activeGenerator} CLI process generated this result. No task terminal was used.${customPromptApplied ? ' The project prompt was applied.' : ''}`
    : `Generation uses a fresh isolated CLI process, with the other signed-in provider as fallback. It never uses a task terminal.${customPromptApplied ? ' The saved project prompt will be applied.' : ''}`;
  elements.standupSheet.setAttribute('aria-busy', String(state.standupGenerating));
  elements.standupDate.disabled = busy;
  elements.standupGenerate.disabled = (
    busy
    || !supported
    || !anchor
    || sourceTasks.length === 0
  );
  elements.standupCopy.disabled = state.standupGenerating || !state.standupClipboardText;
  elements.standupResults.hidden = true;
  elements.standupLoadingList.hidden = true;
  elements.standupEmpty.hidden = true;
  renderStandupFollowUp(anchor, dayCount, itemCount);

  if (!anchor) {
    elements.standupEmpty.hidden = false;
    elements.standupEmpty.dataset.state = 'empty';
    elements.standupEmptyTitle.textContent = 'Select a workday';
    elements.standupEmptyMessage.textContent = 'Select a start date to generate short Added, Changed, Fixed, and Security bullets.';
    elements.standupCount.textContent = 'Waiting for a start date';
    elements.standupSourceNote.textContent = 'CHANGELOG-style AI synthesis from recorded prompts and responses';
    elements.standupGenerate.textContent = 'Select a date';
    return;
  }

  if (state.standupGenerating) {
    elements.standupCount.textContent = `${sourceTasks.length} source task${sourceTasks.length === 1 ? '' : 's'}`;
    elements.standupSourceNote.textContent = 'AI is categorizing confirmed changes from the dated execution history';
    elements.standupLoadingList.innerHTML = Array.from({ length: 3 }, () => `
      <li class="standup-loading-item" aria-hidden="true">
        <span class="standup-item-marker"></span>
        <span class="standup-loading-line"></span>
      </li>
    `).join('');
    elements.standupLoadingList.hidden = false;
    elements.standupGenerate.textContent = 'Generating...';
    return;
  }

  if (itemCount > 0) {
    const includedTaskCount = state.standupIncludedTaskCount || state.standupTaskCount;
    const taskCoverage = includedTaskCount < state.standupTaskCount
      ? `the latest ${includedTaskCount} of ${state.standupTaskCount} tasks`
      : `${state.standupTaskCount} task${state.standupTaskCount === 1 ? '' : 's'}`;
    const categoryCount = STANDUP_CHANGELOG_SECTIONS.filter(({ key }) => state.standupChanges[key].length > 0).length;
    elements.standupCount.textContent = `${itemCount} change${itemCount === 1 ? '' : 's'} · ${categoryCount} categor${categoryCount === 1 ? 'y' : 'ies'}`;
    const executionCoverage = `${state.standupExecutionCount} execution${state.standupExecutionCount === 1 ? '' : 's'}`;
    elements.standupSourceNote.textContent = `Categorized result from ${executionCoverage} in ${taskCoverage}, with dated prompts and responses`;
    elements.standupResults.innerHTML = standupResultsMarkup(state.standupChanges);
    elements.standupResults.hidden = false;
    elements.standupGenerate.textContent = 'Regenerate changelog';
    return;
  }

  elements.standupEmpty.hidden = false;
  if (state.standupError) {
    elements.standupEmpty.dataset.state = 'error';
    elements.standupEmptyTitle.textContent = 'Standup generation failed';
    elements.standupEmptyMessage.textContent = state.standupError;
    elements.standupCount.textContent = `${sourceTasks.length} source task${sourceTasks.length === 1 ? '' : 's'}`;
    elements.standupSourceNote.textContent = 'Your recorded tasks were not changed';
    elements.standupGenerate.textContent = supported ? 'Retry' : 'Restart required';
  } else if (sourceTasks.length === 0) {
    elements.standupEmpty.dataset.state = 'empty';
    elements.standupEmptyTitle.textContent = dayCount === 2
      ? 'No completed task executions started in this range'
      : 'No completed task executions started on this date';
    elements.standupEmptyMessage.textContent = dayCount === 2
      ? 'Choose another start date or finish work that executed during these two days.'
      : 'Choose another start date or finish work that executed on this date.';
    elements.standupCount.textContent = '0 source tasks';
    elements.standupSourceNote.textContent = dayCount === 2
      ? 'Only completed execution attempts whose start falls in these two days are eligible'
      : 'Only completed execution attempts whose start falls on this date are eligible';
    elements.standupGenerate.textContent = 'Generate changelog';
  } else {
    elements.standupEmpty.dataset.state = 'empty';
    elements.standupEmptyTitle.textContent = 'Ready to generate';
    elements.standupEmptyMessage.textContent = dayCount === 2
      ? 'Generate concise Added, Changed, Fixed, and Security bullets for work executed during these two days.'
      : 'Generate concise Added, Changed, Fixed, and Security bullets for work executed on this date.';
    elements.standupCount.textContent = `${sourceTasks.length} source task${sourceTasks.length === 1 ? '' : 's'}`;
    elements.standupSourceNote.textContent = 'The output uses the same categories and limits as deploy';
    elements.standupGenerate.textContent = 'Generate changelog';
  }
}

function openStandup() {
  if (!state.activeProjectPath) return;
  if (!standupBusy()) {
    state.standupDate = '';
    resetStandupOutput();
  }
  if (!standupTwoDayRangeSupported()) state.standupDays = 1;
  elements.standupDate.value = state.standupDate;
  elements.standupDays.value = String(state.standupDays);
  updateStandupDateMaximum();
  elements.standupCustomPrompt.value = projectStandupCustomPrompt();
  state.standupPromptEdited = false;
  state.standupPromptStatus = '';
  resetStandupCopyFeedback();
  if (!elements.standupModal.open) elements.standupModal.showModal();
  renderStandup();
  elements.standupDate.focus();
}

function closeStandup() {
  if (elements.standupModal.open) elements.standupModal.close();
}

async function generateStandup() {
  if (standupBusy()) return;
  const anchor = dateFromLocalInput(elements.standupDate.value);
  const dayCount = selectedStandupDays();
  state.standupDate = elements.standupDate.value;
  state.standupDays = dayCount;
  resetStandupCopyFeedback();
  resetStandupOutput();
  if (!anchor) {
    renderStandup();
    return;
  }
  if (
    standupCustomPromptSupported()
    && standupCustomPromptDirty()
    && !await saveStandupCustomPrompt()
  ) {
    state.standupError = 'Save the default project prompt before generating this Standup.';
    renderStandup();
    return;
  }
  const sourceTasks = tasksForStandupDays(projectTasks(), anchor, dayCount);
  state.standupTaskCount = sourceTasks.length;
  if (sourceTasks.length === 0) {
    renderStandup();
    return;
  }
  if (!standupGenerationSupported()) {
    state.standupError = 'Restart CC Relay to activate categorized changelog standups.';
    renderStandup();
    return;
  }

  const { start, end } = standupDateRange(anchor, dayCount);
  const finalDay = new Date(end);
  finalDay.setDate(finalDay.getDate() - 1);
  const sequence = ++state.standupRequestSequence;
  state.standupGenerating = true;
  renderStandup();
  try {
    const body = await api('/api/standup/generate', {
      method: 'POST',
      body: JSON.stringify({
        projectPath: state.activeProjectPath,
        threadId: null,
        provider: state.selectedProvider,
        date: state.standupDate,
        dateEnd: localDateInputValue(finalDay),
        start: start.toISOString(),
        end: end.toISOString(),
      }),
      timeoutMs: 150_000,
      timeoutMessage: (seconds) => `AI standup generation did not answer within ${seconds} seconds. You can retry safely.`,
    });
    if (sequence !== state.standupRequestSequence) return;
    const sections = standupSections({
      added: Array.isArray(body.added) ? body.added : undefined,
      changed: Array.isArray(body.changed) ? body.changed : undefined,
      fixed: Array.isArray(body.fixed) ? body.fixed : undefined,
      security: Array.isArray(body.security) ? body.security : undefined,
      standup: body.standup || '',
    });
    state.standupChanges = sections;
    state.standupTaskCount = Number(body.taskCount || sourceTasks.length);
    state.standupExecutionCount = Number(body.executionCount || state.standupTaskCount);
    state.standupIncludedTaskCount = Number(body.includedTaskCount || state.standupTaskCount);
    state.standupProvider = body.provider || null;
    state.standupCustomPromptApplied = body.customPromptApplied === true;
    if (standupItemCount(sections) === 0) {
      state.standupError = 'The AI returned no usable standup items. Try generating it again.';
      state.standupChanges = emptyStandupSections();
    } else {
      state.standupClipboardText = standupCopyText(sections);
    }
  } catch (error) {
    if (sequence !== state.standupRequestSequence) return;
    state.standupError = error.message;
  } finally {
    if (sequence === state.standupRequestSequence) {
      state.standupGenerating = false;
      renderStandup();
    }
  }
}

function standupFollowUpConversation() {
  return [
    { role: 'assistant', text: state.standupClipboardText.slice(0, 8_000) },
    ...state.standupFollowUps.flatMap((turn) => [
      { role: 'user', text: turn.question },
      { role: 'assistant', text: turn.answer },
    ]),
  ].filter((message) => message.text).slice(-8);
}

async function askStandupFollowUp(suggestedQuestion = '') {
  if (standupBusy() || !standupFollowUpSupported() || !state.standupClipboardText) return;
  const question = String(suggestedQuestion || elements.standupFollowUpInput.value).trim();
  if (!question) {
    state.standupFollowUpError = 'Write a question about this Standup.';
    renderStandup();
    elements.standupFollowUpInput.focus();
    return;
  }
  if (question.length > MAX_STANDUP_FOLLOW_UP_LENGTH) {
    state.standupFollowUpError = `Keep the Standup question under ${MAX_STANDUP_FOLLOW_UP_LENGTH.toLocaleString()} characters.`;
    renderStandup();
    return;
  }
  const anchor = dateFromLocalInput(elements.standupDate.value);
  const dayCount = selectedStandupDays();
  if (!anchor) return;
  const { start, end } = standupDateRange(anchor, dayCount);
  const finalDay = new Date(end);
  finalDay.setDate(finalDay.getDate() - 1);
  const requestContext = {
    projectPath: state.activeProjectPath,
    date: state.standupDate,
    dateEnd: localDateInputValue(finalDay),
    dayCount,
  };
  const sequence = ++state.standupFollowUpRequestSequence;
  state.standupFollowUpPending = true;
  state.standupFollowUpError = '';
  if (suggestedQuestion) elements.standupFollowUpInput.value = question;
  renderStandup();
  try {
    const body = await api('/api/standup/follow-up', {
      method: 'POST',
      body: JSON.stringify({
        projectPath: requestContext.projectPath,
        threadId: null,
        provider: state.standupProvider || state.selectedProvider,
        date: requestContext.date,
        dateEnd: requestContext.dateEnd,
        start: start.toISOString(),
        end: end.toISOString(),
        question,
        conversation: standupFollowUpConversation(),
      }),
      timeoutMs: 150_000,
      timeoutMessage: (seconds) => `The Standup follow-up did not answer within ${seconds} seconds. You can retry safely.`,
    });
    if (
      sequence !== state.standupFollowUpRequestSequence
      || requestContext.projectPath !== state.activeProjectPath
      || requestContext.date !== state.standupDate
      || requestContext.dayCount !== state.standupDays
    ) return;
    const answer = typeof body.answer === 'string' ? body.answer.trim() : '';
    if (!answer) throw new Error('The Standup follow-up returned no usable answer.');
    state.standupFollowUps.push({
      question,
      answer,
      provider: body.provider || state.standupProvider || state.selectedProvider,
    });
    elements.standupFollowUpInput.value = '';
  } catch (error) {
    if (sequence !== state.standupFollowUpRequestSequence) return;
    state.standupFollowUpError = error.message;
  } finally {
    if (sequence === state.standupFollowUpRequestSequence) {
      state.standupFollowUpPending = false;
      renderStandup();
      elements.standupFollowUpInput.focus();
    }
  }
}

async function copyStandup() {
  if (!state.standupClipboardText) return;
  if (state.standupCopyTimer !== null) {
    window.clearTimeout(state.standupCopyTimer);
    state.standupCopyTimer = null;
  }
  const itemCount = standupItemCount();
  try {
    const clipboardHtml = standupCopyHtml(state.standupChanges);
    if (typeof navigator.clipboard.write === 'function' && typeof window.ClipboardItem === 'function') {
      try {
        await navigator.clipboard.write([new window.ClipboardItem({
          'text/plain': new Blob([state.standupClipboardText], { type: 'text/plain' }),
          'text/html': new Blob([clipboardHtml], { type: 'text/html' }),
        })]);
      } catch {
        await navigator.clipboard.writeText(state.standupClipboardText);
      }
    } else {
      await navigator.clipboard.writeText(state.standupClipboardText);
    }
    elements.standupCopy.textContent = 'Copied';
    elements.standupCopyStatus.textContent = `${itemCount} categorized changelog bullet${itemCount === 1 ? '' : 's'} copied with chat formatting.`;
  } catch {
    elements.standupCopy.textContent = 'Copy failed';
    elements.standupCopyStatus.textContent = 'Clipboard access failed. Keep this window focused and try again.';
  }
  state.standupCopyTimer = window.setTimeout(() => {
    state.standupCopyTimer = null;
    elements.standupCopy.textContent = 'Copy changelog';
  }, 1400);
}

function agentBadgeMarkup(task, sizeClass) {
  if (task.mode === 'plan') {
    const providers = task.author_provider === 'codex'
      ? ['codex', 'claude']
      : ['claude', 'codex'];
    return `
      <span class="agent-pair" aria-hidden="true">
        ${providers.map((provider) => `<span class="agent-icon ${providerIconClass(provider)} ${sizeClass}">${providerIcon(provider)}</span>`).join('')}
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
    ? `${prefix}Choose the Claude session in the Plan council terminal field, then choose a Codex council CC Relay.`
    : `${prefix}Forward-planning Turbo keeps its Codex planner CC Relay selected.`;
}

function renderEffortSelection(efforts, effort) {
  const effortValues = efforts.map((item) => item.reasoningEffort);
  const effortIndex = Math.max(0, effortValues.indexOf(effort));
  elements.effortSelect.setAttribute('aria-valuetext', effort ? `${effort} effort` : 'Unavailable');
  elements.effortSliderValue.textContent = effort ? effort : 'Unavailable';
  for (const [index, marker] of [...elements.effortSliderSteps.children].entries()) {
    marker.classList.toggle('active', index === effortIndex);
  }
  elements.effortSelect.style.setProperty('--effort-progress', `${effortValues.length > 1 ? (effortIndex / (effortValues.length - 1)) * 100 : 0}%`);
  const selectedEffort = efforts.find((item) => item.reasoningEffort === effort);
  elements.effortHint.textContent = selectedEffort?.description
    || 'This model does not expose effort control.';
}

function renderExecutionControls() {
  const models = state.modelCatalogs[state.selectedProvider];
  const settings = selectedExecution();
  elements.executionControls.dataset.provider = state.selectedProvider;
  const requestedModel = state.selectedProvider === 'claude'
    ? normalizeClaudeModelSelection(settings.model)
    : settings.model;
  let model = models.find((item) => item.model === requestedModel);
  if (!model) {
    model = models.find((item) => item.isDefault) || models[0];
    settings.model = model?.model || '';
    settings.effort = defaultEffortForModel(model);
  } else if (settings.model !== requestedModel) {
    settings.model = requestedModel;
  }

  setSelectOptions(elements.modelSelect, models.map((item) => ({
    value: item.model,
    label: `${item.displayName}${item.isDefault ? ' · default' : ''}`,
  })));
  setControlValue(elements.modelSelect, settings.model);
  setControlDisabled(elements.modelSelect, models.length === 0);
  elements.modelHint.textContent = model?.description || `No ${providerLabel(state.selectedProvider)} models available.`;

  const efforts = model?.supportedReasoningEfforts || [];
  if (settings.effort && !efforts.some((item) => item.reasoningEffort === settings.effort)) {
    settings.effort = '';
  }
  if (!settings.effort && efforts.length > 0) {
    settings.effort = defaultEffortForModel(model);
  }
  const effortValues = efforts.map((item) => item.reasoningEffort);
  const effortIndex = Math.max(0, effortValues.indexOf(settings.effort));
  elements.effortSelect.min = '0';
  elements.effortSelect.max = String(Math.max(0, effortValues.length - 1));
  elements.effortSelect.step = '1';
  setControlValue(elements.effortSelect, String(effortIndex));
  setControlDisabled(elements.effortSelect, efforts.length === 0);
  const effortValuesJson = JSON.stringify(effortValues);
  if (elements.effortSelect.dataset.values !== effortValuesJson) {
    elements.effortSelect.dataset.values = effortValuesJson;
  }
  /*
   * Only the marker list is rebuilt here, and only when the efforts themselves change.
   * renderEffortSelection below owns the active marker, so repainting these nodes on
   * every refresh tick would replace the slider under the pointer for nothing.
   */
  const renderedSteps = [...elements.effortSliderSteps.children].map((marker) => marker.title);
  if (renderedSteps.length !== effortValues.length
    || renderedSteps.some((title, index) => title !== effortValues[index])) {
    elements.effortSliderSteps.innerHTML = effortValues
      .map((effort) => `<i title="${escapeHtml(effort)}"></i>`)
      .join('');
  }
  renderEffortSelection(efforts, settings.effort);
  elements.executionControls.hidden = state.taskMode !== 'execute' || isExecuteCouncilEnabled();
  renderQuickSkills();
}

function isClaudePlanReady() {
  return Boolean(state.status?.claude?.available && state.status?.claude?.authenticated);
}

function isPlanCouncilTerminalExecutionEnabled() {
  return state.status?.capabilities?.planCouncilTerminalExecution === true;
}

function planClaudeAuthorThreads() {
  return projectThreads('claude').filter((thread) => thread.terminalControl?.owned === true);
}

function selectedPlanClaudeAuthorThread() {
  return planClaudeAuthorThreads().find(
    (thread) => thread.id === state.planSettings.authorThreadId,
  ) || null;
}

function claudePlanIssue() {
  if (state.status?.capabilities?.planCouncil !== true) {
    return 'Restart CC Relay to enable Plan council';
  }
  // The probe runs in the background after listen. Until it answers, Claude is unknown
  // rather than unavailable, and saying otherwise reads as a broken CLI right after boot.
  const installation = providerInstallationState(state.status, 'claude');
  if (installation === 'checking') {
    return 'Checking the Claude CLI';
  }
  if (installation === 'missing') {
    return 'Claude Code CLI is not installed';
  }
  if (state.status?.claude?.authenticated !== true) {
    return 'Claude CLI is signed out. Run claude auth login; CC Relay will detect it automatically';
  }
  return '';
}

function isDirectClaudeEnabled() {
  return state.status?.capabilities?.directClaudeExecution === true;
}

/*
 * A failed `claude agents --json` probe now keeps the last known good session list and sets
 * lastError, so sessions and an error can arrive together. That is staleness, not an
 * outage: the sessions stay listed and selectable, and this note stays quiet. Only a
 * failure with nothing cached says the check itself did not complete.
 */
function claudeDiscoveryNote() {
  if (!state.connection?.claudeDiscoveryError) return '';
  return state.threads.some((thread) => threadProvider(thread) === 'claude')
    ? ' The Claude session list may be out of date; the last check did not finish. CC Relay retries automatically.'
    : ' The last Claude session check did not finish. CC Relay retries automatically.';
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

function planCouncilCatalogs() {
  return {
    codex: state.modelCatalogs.codex,
    claude: planCouncilOrderEnabled()
      ? state.modelCatalogs.claude
      : state.modelCatalogs.claude.filter((model) => ['fable', 'opus'].includes(model.model)),
  };
}

function planCouncilOrderEnabled() {
  return state.status?.capabilities?.planCouncilProviderOrder === true;
}

function syncPlanCouncilSettings() {
  const input = planCouncilOrderEnabled()
    ? state.planSettings
    : {
      ...state.planSettings,
      councilOrder: ['claude', 'codex'],
      authorProvider: 'claude',
      reviewerProvider: 'codex',
      claudeEffort: 'max',
    };
  const normalized = normalizePlanCouncilSettings(input, planCouncilCatalogs());
  Object.assign(state.planSettings, normalized);
  return normalized;
}

function planCouncilEffortOptions(select, model, requested) {
  const efforts = model?.supportedReasoningEfforts || [];
  const values = efforts
    .map((item) => typeof item === 'string' ? item : item.reasoningEffort)
    .filter(Boolean);
  const value = requested === ''
    ? ''
    : values.includes(requested)
      ? requested
    : values.includes('high')
      ? 'high'
      : values.includes(model?.defaultReasoningEffort)
        ? model.defaultReasoningEffort
        : values[0] || '';
  setSelectOptions(select, [
    {
      value: '',
      label: `Model default${model?.defaultReasoningEffort ? ` · ${model.defaultReasoningEffort}` : ''}`,
    },
    ...values.map((effort) => ({ value: effort, label: effort })),
  ]);
  setControlValue(select, value);
  setControlDisabled(select, values.length === 0);
  return value;
}

function renderPlanControls() {
  const settings = syncPlanCouncilSettings();
  const catalogs = planCouncilCatalogs();
  const codexModels = catalogs.codex;
  const claudeModels = catalogs.claude;
  const codexModel = codexModels.find((item) => item.model === settings.codexModel) || null;
  const claudeModel = claudeModels.find((item) => item.model === settings.claudeModel) || null;
  const automatic = usesDisposableTerminalPools();
  const terminalExecution = isPlanCouncilTerminalExecutionEnabled() && !automatic;
  const authorThreads = terminalExecution ? planClaudeAuthorThreads() : [];
  if (terminalExecution && !settings.authorThreadId) {
    settings.authorThreadId = authorThreads.find((thread) => thread.status === 'idle')?.id
      || authorThreads[0]?.id
      || null;
  }
  const selectedAuthor = terminalExecution ? selectedPlanClaudeAuthorThread() : null;

  elements.planAuthorTerminalField.hidden = !terminalExecution;
  if (terminalExecution) {
    const unavailableSelection = settings.authorThreadId && !selectedAuthor
      ? [{ value: settings.authorThreadId, label: 'Selected terminal unavailable' }]
      : [];
    const empty = authorThreads.length === 0 && unavailableSelection.length === 0
      ? [{ value: '', label: 'Launch a Claude CC Relay first' }]
      : [];
    setSelectOptions(elements.planAuthorTerminal, [
      ...unavailableSelection,
      ...empty,
      ...authorThreads.map((thread) => ({
        value: thread.id,
        label: `${thread.title} · ${thread.status === 'idle' ? 'idle' : thread.status}`,
      })),
    ]);
    setControlValue(elements.planAuthorTerminal, settings.authorThreadId || '');
    setControlDisabled(elements.planAuthorTerminal, authorThreads.length === 0);
  }
  setSelectOptions(elements.planAuthorModel, claudeModels.map((item) => ({
    value: item.model,
    label: `${item.displayName}${item.isDefault ? ' · default' : ''}`,
  })));
  setControlValue(elements.planAuthorModel, settings.claudeModel);
  setControlDisabled(elements.planAuthorModel, claudeModels.length === 0);
  settings.claudeEffort = planCouncilEffortOptions(
    elements.planAuthorEffort,
    claudeModel,
    settings.claudeEffort,
  );
  if (!planCouncilOrderEnabled()) {
    settings.claudeEffort = 'max';
    setSelectOptions(elements.planAuthorEffort, [{ value: 'max', label: 'max' }]);
    setControlValue(elements.planAuthorEffort, 'max');
    setControlDisabled(elements.planAuthorEffort, true);
  }

  setSelectOptions(elements.planReviewerModel, codexModels.map((item) => ({
    value: item.model,
    label: `${item.displayName}${item.isDefault ? ' · default' : ''}`,
  })));
  setControlValue(elements.planReviewerModel, settings.codexModel);
  setControlDisabled(elements.planReviewerModel, codexModels.length === 0);
  settings.codexEffort = planCouncilEffortOptions(
    elements.planReviewerEffort,
    codexModel,
    settings.codexEffort,
  );
  Object.assign(settings, normalizePlanCouncilSettings(settings, catalogs));

  elements.planCouncilEnabled.checked = settings.enabled;
  elements.planCouncilOrder.hidden = !settings.enabled || !planCouncilOrderEnabled();
  elements.planCouncilRoute.hidden = !settings.enabled;
  elements.planCouncilReadiness.hidden = !settings.enabled;
  elements.planCouncilRoute.dataset.first = settings.councilFirstProvider;
  elements.planCouncilRoute.setAttribute(
    'aria-label',
    `${providerLabel(settings.authorProvider)} drafts, ${providerLabel(settings.reviewerProvider)} reviews, then ${providerLabel(settings.authorProvider)} revises`,
  );
  for (const button of elements.planCouncilOrderButtons) {
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.planCouncilFirst === settings.councilFirstProvider),
    );
  }
  elements.planCouncilClaudeRole.textContent = settings.councilFirstProvider === 'claude'
    ? '01 Author'
    : '02 Reviewer';
  elements.planCouncilCodexRole.textContent = settings.councilFirstProvider === 'codex'
    ? '01 Author'
    : '02 Reviewer';
  elements.planCouncilClaudeCopy.textContent = settings.councilFirstProvider === 'claude'
    ? 'Inspects the project and writes the first implementation plan.'
    : 'Challenges the first plan for assumptions, gaps, risk, and verification.';
  elements.planCouncilCodexCopy.textContent = settings.councilFirstProvider === 'codex'
    ? 'Inspects the project and writes the first implementation plan.'
    : 'Challenges the first plan for assumptions, gaps, risk, and verification.';
  elements.planCouncilRevisionCopy.textContent = `${providerLabel(settings.authorProvider)} folds the review into the final plan`;

  setReadiness(
    elements.planClaudeReady,
    isClaudePlanReady() && (!terminalExecution || Boolean(selectedAuthor)),
    terminalExecution
      ? `Claude council terminal selected · ${selectedAuthor?.title || 'ready'}`
      : `Claude council stage ready via CLI${state.status?.claude?.version ? ` · ${state.status.claude.version}` : ''}`,
    claudePlanIssue() || (terminalExecution
      ? 'Launch and choose a CC Relay-owned Claude council terminal'
      : ''),
  );
  setReadiness(
    elements.planCodexReady,
    automatic
      ? Boolean(state.status?.codex?.available && state.status?.codex?.authenticated)
      : hasSelectedCodexThread(),
    automatic
      ? `Codex council pool ready · max ${projectInstanceLimits().codex}`
      : 'Codex council terminal selected',
    automatic
      ? providerIsMissing('codex')
        ? 'Codex CLI is not installed'
        : 'Codex CLI is signed out or its status check failed'
      : 'Choose a connected Codex council terminal',
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

/** The largest Turbo concurrency setting, constrained by the automatic pool ceiling. */
function maxTurboWorkers(automatic = usesDisposableTerminalPools()) {
  return automatic ? MAX_POOL_TURBO_WORKERS : MAX_TURBO_WORKERS;
}

/**
 * The field's text read as a fleet size: an empty or unreadable field falls back to one
 * worker, and the live ceiling bounds the rest. The only copy of this rule.
 */
function clampTurboWorkerCount(value) {
  const limit = maxTurboWorkers();
  const requested = Math.floor(Number(value));
  return Math.min(limit, Math.max(1, Number.isFinite(requested) ? requested : 1));
}

/*
 * The one path that stores a fleet size. Forced: a value that clamps back to the stored
 * count moves no signature, and the field would keep showing the rejected number.
 */
function commitTurboWorkerCount() {
  state.turboSettings.workerCount = clampTurboWorkerCount(elements.turboWorkerCount.value);
  renderTurboControls({ force: true });
  updateSubmitState();
}

/*
 * Safari does not move focus when a button is clicked, so a click on the submit button can
 * arrive while the worker count still holds an edit that fired no change event: the request
 * would carry the previously committed fleet size while the field shows a newer one.
 * Chromium and Electron blur the field first, so their change listener has already stored
 * this exact value and written it back into the field, and the comparison below returns
 * before a second render.
 */
function flushTurboWorkerCount() {
  if (clampTurboWorkerCount(elements.turboWorkerCount.value) === state.turboSettings.workerCount) return;
  commitTurboWorkerCount();
}

/*
 * Past the project ceiling, "raise the maximum" is advice the settings UI cannot follow,
 * so the only honest instruction left is to shrink the fleet. Below it the original advice
 * still resolves the wait, because the user really can raise that number.
 */
function turboCapacityAdvice(required) {
  return required > MAX_PROJECT_INSTANCES
    ? `Use at most ${MAX_POOL_TURBO_WORKERS} concurrent executions · a project allows ${MAX_PROJECT_INSTANCES} Codex instances`
    : `Raise Codex max instances to at least ${required}`;
}

/*
 * Every datum renderTurboControls reads. Collected in one place so the fold below and the
 * markup below that cannot drift apart: a field missing here produces a panel that stops
 * repainting, which is worse than the rebuild it saves.
 */
function turboControlsSignatureInputs() {
  const limits = projectInstanceLimits();
  return {
    automatic: usesDisposableTerminalPools(),
    projectPath: activeProject()?.path || '',
    codexLimit: limits.codex,
    claudeLimit: limits.claude,
    codexMissing: providerIsMissing('codex'),
    claudeReady: isClaudePlanReady(),
    // The readable blocker, not its three sources: this exact string can reach the chip.
    claudeIssue: claudePlanIssue(),
    keepTerminalOpen: state.keepTerminalOpen,
    retainedTerminals: state.status?.capabilities?.retainedTerminalSessions === true,
    hasPlannerThread: hasSelectedCodexThread(),
    workerThreadCount: turboWorkerThreads().length,
    settings: state.turboSettings,
    catalogs: { codex: state.modelCatalogs.codex, claude: state.modelCatalogs.claude },
  };
}

/*
 * force is for the paths that must repaint even when no input moved: a committed worker
 * count that clamped back to the value already stored, and a mode or project switch.
 */
function renderTurboControls({ force = false } = {}) {
  const signature = turboControlsSignature(turboControlsSignatureInputs());
  if (!force && state.turboControlsSignature === signature) return;
  const settings = state.turboSettings;
  const models = state.modelCatalogs.codex;
  const automatic = usesDisposableTerminalPools();
  const singleExecutor = automatic && usesSingleExecutorTurbo();
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
  const workerLimit = maxTurboWorkers(automatic);
  // A fleet restored from a legacy session, or configured before the pool capability
  // arrived, can exceed the automatic ceiling. Clamp before the field is written.
  settings.workerCount = Math.min(workerLimit, Math.max(1, settings.workerCount));
  elements.turboWorkerCount.max = String(workerLimit);
  // Never replace text the user is still typing. The blur listener resyncs the field.
  if (document.activeElement !== elements.turboWorkerCount) {
    elements.turboWorkerCount.value = String(settings.workerCount);
  }
  const council = syncTurboCouncilSettings();
  const claudeModels = state.modelCatalogs.claude;
  const claudeModel = claudeModels.find((item) => item.model === council.councilClaudeModel) || claudeModels[0] || null;
  const reviewerOptions = claudeModels.map((item) => `<option value="${escapeHtml(item.model)}">${escapeHtml(item.displayName)}${item.isDefault ? ' · default' : ''}</option>`).join('');
  elements.turboCouncilEnabled.checked = council.councilEnabled;
  elements.turboPlanningCount.textContent = council.councilEnabled ? '2 providers' : '1 planner';
  elements.turboCouncilRoute.dataset.enabled = String(council.councilEnabled);
  elements.turboCouncilRoute.dataset.first = council.councilEnabled ? council.councilFirstProvider : 'codex';
  elements.turboCouncilRoute.setAttribute(
    'aria-label',
    council.councilEnabled
      ? `${providerLabel(council.councilAuthorProvider)} authors the graph, then ${providerLabel(council.councilReviewerProvider)} reviews it`
      : 'Codex plans the execution graph using the selected planning model',
  );
  elements.turboCouncilOrder.hidden = !council.councilEnabled;
  for (const button of elements.turboCouncilOrderButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.councilFirst === council.councilFirstProvider));
  }
  elements.turboCouncilCodexRole.textContent = council.councilEnabled
    ? `${council.councilFirstProvider === 'codex' ? '01 Author' : '02 Reviewer'}`
    : 'Planner';
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
  const requiredCodexInstances = settings.workerCount + 1;
  const maxCodexInstances = projectInstanceLimits().codex;
  const ready = automatic
    ? !providerIsMissing('codex') && maxCodexInstances >= requiredCodexInstances && !councilIssue
    : hasSelectedCodexThread() && available >= settings.workerCount && !councilIssue;
  elements.turboReadiness.dataset.state = ready ? 'ready' : 'missing';
  elements.turboReadiness.textContent = ready
    ? automatic
      ? singleExecutor
        ? `Ready · 1 planner + up to ${settings.workerCount} executions`
        : `Ready · ${requiredCodexInstances} of ${maxCodexInstances} Codex slots`
      : `Ready · ${council.councilEnabled ? council.councilOrder.map(providerLabel).join(' → ') : 'Codex'} + ${settings.workerCount} workers`
    : councilIssue || (automatic
      ? providerIsMissing('codex')
        ? 'Codex CLI is not installed'
        : turboCapacityAdvice(requiredCodexInstances)
      : `Need ${requiredCodexInstances} terminals · ${hasSelectedCodexThread() ? available + 1 : 0} connected here`);
  /*
   * Keeping the workflow terminals open is a live per-project toggle sitting directly
   * below this sentence, and the queue honours it only when the backend advertises
   * retention. The sentence has to follow both, or it promises a cleanup that will not run.
   */
  const retainsTerminals = automatic
    && state.status?.capabilities?.retainedTerminalSessions === true
    && state.keepTerminalOpen;
  elements.turboNote.textContent = !council.councilEnabled
    ? automatic
      ? singleExecutor
        ? retainsTerminals
          ? 'Each prompt gets one fresh planning terminal, then one fresh execution terminal for the complete plan. Finished terminals stay connected.'
          : 'Each prompt gets one fresh planning terminal, then one fresh execution terminal for the complete plan. Each terminal closes after its stage and its session remains resumable.'
        : retainsTerminals
          ? 'CC Relay launches one disposable Codex planner and the requested worker fleet, and leaves every terminal connected when Turbo ends.'
          : 'CC Relay launches one disposable Codex planner and the requested worker fleet, then closes every terminal when Turbo ends.'
      : 'The selected Codex CC Relay plans in read-only mode. CC Relay reads its JSON graph and dispatches ready tasks across the worker fleet.'
    : council.councilFirstProvider === 'claude'
      ? automatic
        ? singleExecutor
          ? 'Claude authors the graph first. A fresh Codex planner reviews it, then one fresh execution session owns the complete plan.'
          : 'Claude authors the graph first. A disposable Codex planner reviews it before CC Relay launches the worker turns.'
        : 'Claude authors the graph first. The selected Codex CC Relay reviews and corrects it before CC Relay dispatches workers.'
      : automatic
        ? singleExecutor
          ? 'A fresh Codex planner authors the graph. Claude reviews it, then one fresh execution session owns the complete plan.'
          : 'A disposable Codex planner authors the graph. Claude reviews it before CC Relay dispatches the worker turns.'
        : 'The selected Codex CC Relay authors the graph first. Claude reviews and corrects it before CC Relay dispatches workers.';
  /*
   * Recorded after the body, not before it. Model preference, effort fallback, the worker
   * clamp, and council normalization all write settings back, and every DOM write above
   * reads the normalized value, so the panel now matches the settled state rather than the
   * state this render was entered with. Signing on entry would repaint once more for
   * nothing on the very next tick.
   */
  state.turboControlsSignature = turboControlsSignature(turboControlsSignatureInputs());
}

function attachmentLimitIssue(attachments = state.attachments) {
  if (attachments.length > MAX_IMAGE_ATTACHMENTS) {
    return `Attach at most ${MAX_IMAGE_ATTACHMENTS} images.`;
  }
  if (attachments.some((attachment) => attachment.size > MAX_IMAGE_BYTES)) {
    return 'Each image must be smaller than 5 MB.';
  }
  const totalBytes = attachments.reduce((total, attachment) => total + attachment.size, 0);
  return totalBytes > MAX_TOTAL_IMAGE_BYTES ? 'Images may total at most 20 MB.' : '';
}

function providerInstallationIssue() {
  if (!usesDisposableTerminalPools()) return '';
  const required = state.taskMode === 'turbo'
    ? [
      'codex',
      ...(state.turboSettings.councilEnabled ? ['claude'] : []),
    ]
    : isExecuteCouncilEnabled()
      ? ['codex', 'claude']
      : [state.selectedProvider];
  const missing = required.filter((provider) => providerIsMissing(provider));
  if (missing.length === 0) return '';
  const labels = missing.map((provider) => `${providerLabel(provider)} CLI`);
  return `${labels.join(' and ')} ${labels.length === 1 ? 'is' : 'are'} not installed. Install ${labels.length === 1 ? 'it' : 'them'} and CC Relay will enable ${labels.length === 1 ? 'this provider' : 'these providers'} automatically.`;
}

/*
 * Submit is gated on input validity and confirmed CLI installation only. Readiness that
 * depends on a live process list
 * (a CC Relay missing from the last /api/threads answer, authentication, or a worker count)
 * is deliberately NOT a gate: that list is replaced wholesale every four seconds, so
 * gating on it made the button flicker to disabled and produced a false
 * "Choose a connected terminal" for a session that was in fact connected. Those
 * conditions are validated at submit time instead, where the message can be exact.
 */
function composerValidationIssue({
  prompt = elements.prompt.value,
  taskName = elements.taskName.value,
  attachments = state.attachments,
  taskReferences = state.taskReferences,
} = {}) {
  if (!prompt.trim()) return 'Write a prompt before adding the task.';
  const taskReferenceIssue = taskReferencePromptIssue(prompt, taskReferences);
  if (taskReferenceIssue) return taskReferenceIssue;
  if (taskName.trim() && state.status && !taskNamingSupported()) {
    return 'Restart CC Relay before naming a task.';
  }
  if (usesDisposableTerminalPools()) {
    if (!activeProject()) return 'Choose a project before adding the task.';
  } else if (!state.selectedThreadId) {
    return 'Choose a connected CC Relay before adding the task.';
  }
  return providerInstallationIssue() || attachmentLimitIssue(attachments);
}

function quickSkillValidationIssue(skill) {
  if (!skill) return 'This saved skill is unavailable.';
  if (state.taskMode !== 'execute' || isExecuteCouncilEnabled()) {
    return 'Saved skills run as direct Execute tasks. Choose Execute without Plan council.';
  }
  return composerValidationIssue({
    prompt: skill.prompt,
    taskName: taskNamingSupported() ? skill.label : '',
    attachments: [],
    taskReferences: [],
  });
}

function updateSubmitState() {
  const issue = composerValidationIssue();
  elements.taskName.title = taskNamingSupported() || !state.status
    ? 'Optional task name. Leave blank to derive it from the request.'
    : 'Restart CC Relay to name tasks.';
  const openingSession = usesDisposableTerminalPools()
    && state.status?.capabilities?.manualSessionTasks === true
    && state.keepTerminalOpen
    && state.selectedProvider !== 'opencode'
    && state.taskMode === 'execute'
    && !isExecuteCouncilEnabled();
  elements.submitButton.disabled = state.submitting || Boolean(issue);
  elements.submitButton.title = state.submitting ? '' : issue;
  elements.submitButton.textContent = state.submitting
    ? isExecuteCouncilEnabled() ? 'Starting council' : state.taskMode === 'turbo' ? 'Starting turbo' : openingSession ? 'Opening session' : 'Adding task'
    : isExecuteCouncilEnabled()
      ? 'Build reviewed plan'
      : state.taskMode === 'turbo' ? 'Plan and execute' : openingSession ? 'Open session' : 'Add to queue';
  renderQuickSkills();
}

/*
 * kind 'validation' marks a complaint the user can fix by editing the composer, so it
 * disappears as soon as they do. A 'failure' from the server stays until the next attempt:
 * it is the only record that the prompt still sitting in the box was never accepted.
 */
function setComposerAlert(message, kind = 'failure') {
  elements.composerAlert.textContent = message || '';
  elements.composerAlert.hidden = !message;
  elements.composerAlert.dataset.kind = message ? kind : '';
}

// begin quick skills
/*
 * The strip is drawn from state.quickSkills, which the operator edits in Terminal settings.
 * renderQuickSkills runs from updateSubmitState, so it is on the two-second snapshot refresh
 * and every composer keystroke path. A full innerHTML rewrite there would blow away focus and
 * the text selection inside the strip, so the rewrite is gated on a folded signature and only
 * the disabled state, the context line, and the accessible label are written on every tick.
 *
 * Everything the markup reads has to be in the signature or the strip goes stale forever:
 * position, id, and label. The prompt text is deliberately absent because nothing in the button
 * renders it; it reaches the dispatch path from state.quickSkills at click time instead. Whether
 * a prompt exists at all is a different question: an empty one takes the entry off the strip, and
 * quickSkillStripEntries filters before the fold so that presence change reaches the signature.
 */

const QUICK_SKILL_DRAFT_HINT = 'Add a prompt. This quick action stays off the strip and is not saved until you do.';

/*
 * A row whose prompt is still empty is a draft. normalizeQuickSkills drops it on both the client
 * and the server, so the strip drops it too: a button rendered from a draft would dispatch a real
 * provider run of text the operator never wrote, and would vanish on the next reload anyway.
 */
function quickSkillStripEntries(skills) {
  return skills.filter((skill) => Boolean(String(skill?.prompt ?? '').trimEnd()));
}

function quickSkillStripSignature(skills) {
  /*
   * JSON is the field separator. Labels are free operator text and carry spaces, so a plain
   * concatenation would let "Deploy check" plus "" collide with "Deploy" plus "check".
   */
  const fields = JSON.stringify(skills.map((skill, index) => [index, skill.id, skill.label]));
  let hash = 5381;
  for (let index = 0; index < fields.length; index += 1) {
    // Shift form, not hash * 33: the multiply loses precision past 2^53 before the xor coerces.
    hash = ((hash << 5) + hash) ^ fields.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function quickSkillStripMarkup(skills) {
  return skills.map((skill) => `
    <button class="quick-skill-button" type="button" data-quick-skill="${escapeHtml(skill.id)}">
      <span class="quick-skill-glyph" aria-hidden="true">&gt;_</span>
      <span class="quick-skill-copy">
        <strong>${escapeHtml(skill.label)}</strong>
        <small data-quick-skill-context>Run now with selected settings</small>
      </span>
    </button>`).join('');
}

function renderQuickSkills() {
  // Fail soft: a renamed or removed strip container must not throw out of the refresh tick.
  if (!elements.quickSkillList) return;
  const skills = quickSkillStripEntries(state.quickSkills);
  const signature = quickSkillStripSignature(skills);
  if (signature !== state.quickSkillStripSignature) {
    state.quickSkillStripSignature = signature;
    elements.quickSkillList.innerHTML = quickSkillStripMarkup(skills);
  }
  elements.quickSkillList.hidden = skills.length === 0;
  const execution = selectedExecution();
  const effort = execution.effort || 'default';
  const selectedThread = state.threads.find((thread) => thread.id === state.selectedThreadId);
  const target = usesDisposableTerminalPools()
    ? providerLabel(state.selectedProvider)
    : selectedThread ? threadDisplayName(selectedThread) : providerLabel(state.selectedProvider);
  for (const button of elements.quickSkillList.querySelectorAll('[data-quick-skill]')) {
    const skill = quickSkillById(button.dataset.quickSkill, state.quickSkills);
    const issue = quickSkillValidationIssue(skill);
    const context = button.querySelector('[data-quick-skill-context]');
    button.disabled = state.submitting || Boolean(issue);
    if (context) {
      context.textContent = state.taskMode === 'execute' && !isExecuteCouncilEnabled()
        ? `Run now / ${target} / ${effort}`
        : 'Direct Execute only';
    }
    const label = issue
      ? `${skill?.label || 'Saved skill'}. ${issue}`
      : `Run ${skill.label} now with ${target} at ${effort} effort.`;
    button.setAttribute('aria-label', label);
    button.title = label;
  }
}

/*
 * One delegated listener instead of one per button: the strip is rebuilt whenever the operator
 * edits it, and per-button listeners would be lost on the first rebuild.
 */
function handleQuickSkillListClick(event) {
  const button = event.target.closest('[data-quick-skill]');
  if (!button || state.submitting) return;
  const skill = quickSkillById(button.dataset.quickSkill, state.quickSkills);
  /*
   * Fail closed. A button whose id vanished from the catalog between paint and click has no
   * prompt to send, and inventing one would dispatch work the operator never saved.
   */
  if (!skill) return;
  const issue = quickSkillValidationIssue(skill);
  if (issue) {
    setComposerAlert(issue, 'validation');
    return;
  }
  void submitComposerTask(null, { quickSkill: skill });
}

/*
 * Ids are stable handles: the strip markup, the click resolution, and the editor rows all key
 * on them, so a generated id is slugged from the label once and then never follows a rename.
 */
function uniqueQuickSkillId(label, takenIds = []) {
  const slug = String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48)
    .replace(/-+$/u, '');
  const seed = QUICK_SKILL_ID_PATTERN.test(slug) ? slug : 'quick-action';
  const taken = new Set(takenIds);
  if (!taken.has(seed)) return seed;
  for (let suffix = 2; suffix <= 999; suffix += 1) {
    const candidate = `${seed}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${seed}-${Date.now().toString(36)}`;
}

function movedQuickSkills(skills, index, delta) {
  const target = index + delta;
  if (index < 0 || index >= skills.length || target < 0 || target >= skills.length) return skills;
  const next = [...skills];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

function quickSkillEditorRowMarkup(skill, index, total) {
  const name = escapeHtml(skill.label);
  const id = escapeHtml(skill.id);
  // A draft row is marked incomplete from the first paint, not only after a keystroke, so an
  // operator who added a row and looked away can see why it never reached the strip.
  const draft = !String(skill.prompt ?? '').trimEnd();
  return `
    <li class="quick-skill-row" data-quick-skill-row="${id}" data-invalid="${draft ? 'true' : 'false'}">
      <div class="quick-skill-row-head">
        <label class="quick-skill-row-label">
          <span>Label</span>
          <input type="text" data-quick-skill-field="label" maxlength="${MAX_QUICK_SKILL_LABEL_LENGTH}" autocomplete="off" value="${name}" aria-label="Label for quick action ${index + 1}">
        </label>
        <div class="quick-skill-row-actions" role="group" aria-label="Reorder or remove ${name}">
          <button class="quick-skill-row-action" type="button" data-quick-skill-action="up" ${index === 0 ? 'disabled' : ''} aria-label="Move ${name} up" title="Move up">↑</button>
          <button class="quick-skill-row-action" type="button" data-quick-skill-action="down" ${index >= total - 1 ? 'disabled' : ''} aria-label="Move ${name} down" title="Move down">↓</button>
          <button class="quick-skill-row-action quick-skill-row-remove" type="button" data-quick-skill-action="remove" aria-label="Remove ${name}" title="Remove">Remove</button>
        </div>
      </div>
      <label class="quick-skill-row-prompt">
        <span>Prompt</span>
        <textarea data-quick-skill-field="prompt" rows="3" maxlength="${MAX_QUICK_SKILL_PROMPT_LENGTH}" aria-label="Prompt for quick action ${index + 1}">${escapeHtml(skill.prompt)}</textarea>
      </label>
      <small class="quick-skill-row-hint" data-quick-skill-hint>${draft ? escapeHtml(QUICK_SKILL_DRAFT_HINT) : ''}</small>
    </li>`;
}

function quickSkillEditorRows() {
  return [...elements.quickSkillEditorList.querySelectorAll('[data-quick-skill-row]')];
}

/*
 * A rebuild replaces the inputs the operator may be typing into, so it happens only when the
 * row set itself changed: open, add, remove, reorder. Any other refresh syncs values in place
 * and never writes to the field that currently holds the caret.
 */
function renderQuickSkillEditor({ rebuild = false } = {}) {
  if (!elements.quickSkillEditorList) return;
  const rows = quickSkillEditorRows();
  const rowsMatch = rows.length === state.quickSkills.length
    && rows.every((row, index) => row.dataset.quickSkillRow === state.quickSkills[index].id);
  if (rebuild || !rowsMatch) {
    elements.quickSkillEditorList.innerHTML = state.quickSkills
      .map((skill, index) => quickSkillEditorRowMarkup(skill, index, state.quickSkills.length))
      .join('');
  } else {
    for (const [index, row] of rows.entries()) {
      const skill = state.quickSkills[index];
      for (const field of row.querySelectorAll('[data-quick-skill-field]')) {
        const value = String(skill[field.dataset.quickSkillField] ?? '');
        if (field === document.activeElement || field.value === value) continue;
        field.value = value;
      }
    }
  }
  const full = state.quickSkills.length >= MAX_QUICK_SKILLS;
  if (elements.quickSkillAdd) {
    elements.quickSkillAdd.disabled = full;
    elements.quickSkillAdd.title = full
      ? `The strip holds at most ${MAX_QUICK_SKILLS} quick actions.`
      : 'Add another quick action';
  }
  if (!elements.quickSkillEditorStatus) return;
  const drafts = state.quickSkills.length - quickSkillStripEntries(state.quickSkills).length;
  const summary = state.quickSkills.length === 0
    ? 'No quick actions. The composer strip stays hidden until you add one.'
    : `${state.quickSkills.length} of ${MAX_QUICK_SKILLS}. Each one runs now with the composer provider, model, and effort.${
      drafts ? ` ${drafts} without a prompt ${drafts === 1 ? 'is' : 'are'} not saved.` : ''}`;
  /*
   * A rejected preferences save outranks the count: the operator is looking at text the server
   * has not accepted, and the count would read as confirmation that it had.
   */
  elements.quickSkillEditorStatus.textContent = state.uiPreferencesSaveError || summary;
  elements.quickSkillEditorStatus.dataset.kind = state.uiPreferencesSaveError ? 'failure' : '';
}

/*
 * External input only: the server record and Restore default. normalizeQuickSkills drops any
 * entry with an empty prompt, which is right for a record arriving from outside and wrong for
 * the editor list, where an empty prompt is a row the operator has not finished writing.
 */
function setQuickSkills(value, { persist = true, rebuildEditor = true } = {}) {
  state.quickSkills = normalizeQuickSkills(value);
  renderQuickSkills();
  renderQuickSkillEditor({ rebuild: rebuildEditor });
  if (persist) queueUiPreferencesSave();
}

/*
 * Add, remove, and reorder assign the list as given instead of normalizing it. Normalizing here
 * would delete every unfinished row as a side effect of touching an unrelated one. The draft is
 * still never persisted: normalizeQuickSkills drops it in the localStorage cache and again in
 * the server route, so the strip, the cache, and the saved record all agree.
 */
function commitQuickSkillEdit(skills, { persist = true } = {}) {
  state.quickSkills = skills;
  renderQuickSkills();
  renderQuickSkillEditor({ rebuild: true });
  if (persist) queueUiPreferencesSave();
}

function refreshQuickSkillRowValidity(row, skill = quickSkillById(row?.dataset.quickSkillRow, state.quickSkills)) {
  const label = row.querySelector('[data-quick-skill-field="label"]');
  const prompt = row.querySelector('[data-quick-skill-field="prompt"]');
  const labelBlank = !String(label?.value || '').trim();
  const promptBlank = !String(prompt?.value || '').trim();
  row.dataset.invalid = String(labelBlank || promptBlank);
  const hint = row.querySelector('[data-quick-skill-hint]');
  if (hint) {
    // A draft has no saved prompt to fall back on, so it gets the wording that says so.
    const draft = !String(skill?.prompt ?? '').trimEnd();
    hint.textContent = labelBlank
      ? 'Add a label. The saved label is kept until you do.'
      : promptBlank ? (draft ? QUICK_SKILL_DRAFT_HINT : 'Add a prompt. The saved prompt is kept until you do.') : '';
  }
  return { labelBlank, promptBlank };
}

/*
 * Clearing a box is a keystroke on the way somewhere, not a delete. Writing the empty value
 * through normalizeQuickSkills would drop the entry, take its button off the strip, and
 * persist the deletion, so state keeps the last valid text and the row shows a hint instead.
 */
function handleQuickSkillEditorInput(event) {
  const field = event.target.closest('[data-quick-skill-field]');
  if (!field) return;
  const row = field.closest('[data-quick-skill-row]');
  const skill = quickSkillById(row?.dataset.quickSkillRow, state.quickSkills);
  if (!skill) return;
  const kind = field.dataset.quickSkillField;
  const { labelBlank, promptBlank } = refreshQuickSkillRowValidity(row, skill);
  if (kind === 'label' ? labelBlank : promptBlank) return;
  skill[kind] = field.value;
  // The strip prints the label, so a rename lands there as it is typed, and the first prompt
  // written into a draft is what puts its button on the strip at all. The editor rows are
  // untouched either way: renderQuickSkills only writes inside #quick-skill-list.
  renderQuickSkills();
  queueUiPreferencesSave();
}

/*
 * Terminal settings lives inside <form id="task-form">, so the label input's form owner is the
 * composer. Enter there would implicitly submit the composer and queue a real task out of a
 * rename keystroke. The prompt textarea is untouched: Enter is a newline inside it.
 */
function handleQuickSkillEditorKeydown(event) {
  if (event.key !== 'Enter') return;
  if (!event.target.closest('[data-quick-skill-field="label"]')) return;
  event.preventDefault();
}

/*
 * A rebuild leaves focus on document.body, which strands a keyboard operator who just pressed
 * Move down. Focus follows the control to its new row, or to the nearest control that survived.
 */
function focusQuickSkillControl(index, action) {
  const rows = quickSkillEditorRows();
  const row = rows[index];
  if (!row) {
    if (elements.quickSkillAdd && !elements.quickSkillAdd.disabled) elements.quickSkillAdd.focus();
    else elements.quickSkillRestore?.focus();
    return;
  }
  const preferred = row.querySelector(`[data-quick-skill-action="${action}"]`);
  if (preferred && !preferred.disabled) {
    preferred.focus();
    return;
  }
  const fallback = [...row.querySelectorAll('[data-quick-skill-action]')].find((button) => !button.disabled);
  (fallback || row.querySelector('[data-quick-skill-field="label"]'))?.focus();
}

function handleQuickSkillEditorClick(event) {
  const action = event.target.closest('[data-quick-skill-action]');
  if (!action || action.disabled) return;
  const row = action.closest('[data-quick-skill-row]');
  const index = state.quickSkills.findIndex((skill) => skill.id === row?.dataset.quickSkillRow);
  if (index < 0) return;
  const kind = action.dataset.quickSkillAction;
  if (kind === 'remove') {
    const removed = state.quickSkills[index];
    /*
     * Removing a written quick action destroys up to twenty thousand characters the operator
     * typed, with no undo, from a button that sits one row away from Move down. A draft holds
     * nothing to lose, so only a finished quick action asks.
     */
    const draft = !String(removed?.prompt ?? '').trimEnd();
    if (!draft && !window.confirm(`Remove quick action "${removed.label}"? This cannot be undone.`)) return;
    commitQuickSkillEdit(state.quickSkills.filter((unused, position) => position !== index));
    focusQuickSkillControl(Math.min(index, state.quickSkills.length - 1), 'remove');
    return;
  }
  const delta = kind === 'up' ? -1 : 1;
  const moved = movedQuickSkills(state.quickSkills, index, delta);
  if (moved === state.quickSkills) return;
  commitQuickSkillEdit(moved);
  focusQuickSkillControl(index + delta, kind);
}

function addQuickSkill() {
  if (state.quickSkills.length >= MAX_QUICK_SKILLS) return;
  const label = 'New quick action';
  const id = uniqueQuickSkillId(label, state.quickSkills.map((skill) => skill.id));
  /*
   * The prompt starts empty on purpose. A placeholder would be a live strip button that queues
   * a real provider run of text nobody wrote, for anyone who adds a row and then closes the
   * modal. Nothing is persisted either: an unfinished row is not a saved quick action.
   */
  commitQuickSkillEdit([...state.quickSkills, { id, label, prompt: '' }], { persist: false });
  const input = quickSkillEditorRows().at(-1)?.querySelector('[data-quick-skill-field="label"]');
  input?.focus();
  input?.select();
}

function restoreDefaultQuickSkills() {
  /*
   * One unconfirmed click here would wipe every hand-authored prompt out of state, the
   * localStorage cache, and the server record at once, and the button sits beside Add.
   */
  if (!window.confirm('Replace every saved quick action with the built-in Deploy check? This cannot be undone.')) return;
  setQuickSkills(DEFAULT_QUICK_SKILLS);
  elements.quickSkillRestore?.focus();
}

/*
 * Boot wiring lives here so a renamed or removed element is a quick-skill strip that never
 * appears rather than a TypeError at module load that takes the whole renderer down. Each
 * control is wired on its own: missing Add must not cost the strip its click handler.
 */
function bindQuickSkillEvents() {
  if (elements.quickSkillList) {
    elements.quickSkillList.addEventListener('click', handleQuickSkillListClick);
  }
  if (elements.quickSkillEditorList) {
    elements.quickSkillEditorList.addEventListener('click', handleQuickSkillEditorClick);
    elements.quickSkillEditorList.addEventListener('input', handleQuickSkillEditorInput);
    elements.quickSkillEditorList.addEventListener('keydown', handleQuickSkillEditorKeydown);
  }
  if (elements.quickSkillAdd) elements.quickSkillAdd.addEventListener('click', addQuickSkill);
  if (elements.quickSkillRestore) elements.quickSkillRestore.addEventListener('click', restoreDefaultQuickSkills);
}
// end quick skills

function setComposerPending(pending) {
  state.submitting = pending;
  elements.form.dataset.pending = pending ? 'true' : 'false';
  elements.form.setAttribute('aria-busy', String(pending));
  if (!elements.keepTerminalOpenOption.hidden) {
    elements.keepTerminalOpen.disabled = pending
      || !activeProject()
      || state.selectedProvider === 'opencode'
      || state.projectSettingsSaving
      || state.status?.capabilities?.retainedTerminalSessions !== true;
  }
  updateSubmitState();
}

function renderPromptCopy() {
  elements.promptLabel.textContent = isExecuteCouncilEnabled()
    ? 'Planning brief'
    : state.taskMode === 'turbo' ? 'Turbo objective' : 'Task prompt';
  elements.prompt.placeholder = isExecuteCouncilEnabled()
    ? 'Describe what should be built, the constraints, and the decisions the reviewed plan must settle.'
    : state.taskMode === 'turbo'
      ? usesDisposableTerminalPools() && usesSingleExecutorTurbo()
        ? 'Describe the complete outcome. A fresh planner will produce the JSON graph, then one fresh execution session will own the complete plan.'
        : 'Describe the complete outcome. The planner will produce a JSON dependency graph and CC Relay will dispatch it across worker terminals.'
      : 'Describe the outcome, constraints, and how the agent should verify the work.';
}

function selectMode(mode, { focus = false } = {}) {
  if (!['execute', 'turbo'].includes(mode)) {
    return;
  }
  elements.formMessage.textContent = '';
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
  elements.terminalLegend.textContent = usesDisposableTerminalPools()
    ? 'Automatic terminals'
    : mode === 'turbo' ? 'Planner terminal' : 'Run in terminal';

  if (!providerEligibleForComposer(state, state.selectedProvider)) {
    state.selectedProvider = 'codex';
    state.selectedThreadId = null;
  }
  reconcileProviderSelection();
  renderProviderTabs();
  renderExecutionControls();
  renderPlanControls();
  // Forced: selectProject routes through here, and a mode or project switch must repaint
  // the panel even when the fold has not moved.
  renderTurboControls({ force: true });
  renderAttachmentComposer();
  renderTaskReferences();
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
      const models = provider === 'claude'
        ? supportedClaudeModelCatalog(body.models)
        : body.models;
      if (models.length > 0) state.modelCatalogs[provider] = models;
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
  const connectedCount = state.threads.filter((thread) => threadProvider(thread) === provider).length;
  const runtime = state.status?.[provider];
  return {
    ...(fromServer || {}),
    id: provider,
    label: fromServer?.label || providerLabel(provider),
    available: runtime?.pending === false
      ? runtime.available === true
      : Boolean(fromServer?.available || connectedCount > 0),
    authenticated: runtime?.authenticated === true,
    pending: runtime?.pending === true,
    connectedCount: fromServer?.connectedCount ?? connectedCount,
  };
}

function renderProviderTabs() {
  const codex = providerInfo('codex');
  const claude = providerInfo('claude');
  const opencode = providerInfo('opencode');
  const automatic = usesDisposableTerminalPools();
  const terminalPool = state.status?.terminalPool;
  const pool = terminalPool
    && sameProjectPath(terminalPool.repoPath, state.activeProjectPath)
    ? terminalPool
    : null;
  const limits = projectInstanceLimits();
  const codexInstallation = providerInstallationState(state.status, 'codex');
  const claudeInstallation = providerInstallationState(state.status, 'claude');
  const openCodeInstallation = providerInstallationState(state.status, 'opencode');
  elements.providerTabsContainer.hidden = !automatic;
  elements.providerTabsContainer.setAttribute('aria-hidden', String(!automatic));
  elements.providerCodexCount.textContent = automatic
    ? codexInstallation === 'checking'
      ? 'Checking installation'
      : codexInstallation === 'missing'
        ? 'Not installed'
        : codex.authenticated
          ? `${Number(pool?.active?.codex || 0)} / ${limits.codex} active`
          : state.status?.codex?.reason === 'signed_out' ? 'Sign in required' : 'Auth check failed'
    : codex.connectedCount > 0
      ? `${codex.connectedCount} live`
      : codex.available ? 'Ready' : 'Unavailable';
  elements.providerClaudeCount.textContent = automatic
    ? claudeInstallation === 'checking'
      ? 'Checking installation'
      : claudeInstallation === 'missing'
        ? 'Not installed'
        : claude.authenticated
          ? `${Number(pool?.active?.claude || 0)} / ${limits.claude} active`
          : state.status?.claude?.reason === 'signed_out' ? 'Sign in required' : 'Auth check failed'
    : claude.connectedCount > 0
      ? `${claude.connectedCount} live`
      : claude.available
        ? isDirectClaudeEnabled() ? 'CLI ready' : 'Restart CC Relay'
        : 'Not connected';
  elements.providerOpenCodeCount.textContent = automatic
    ? openCodeInstallation === 'checking'
      ? 'Checking installation'
      : openCodeInstallation === 'missing'
        ? 'Not installed'
        : opencode.authenticated
          ? `${Number(pool?.active?.opencode || 0)} / ${limits.opencode} active`
          : state.status?.opencode?.reason === 'signed_out' ? 'Sign in required' : 'Auth check failed'
    : 'Automatic only';

  for (const tab of elements.providerTabs) {
    const selected = tab.dataset.provider === state.selectedProvider;
    const info = providerInfo(tab.dataset.provider);
    const installation = providerInstallationState(state.status, tab.dataset.provider);
    const missing = automatic && installation === 'missing';
    tab.disabled = missing;
    tab.title = missing
      ? `Install the ${providerLabel(tab.dataset.provider)} CLI to enable this provider.`
      : '';
    tab.classList.toggle('selected', selected);
    tab.dataset.state = installation === 'checking'
      ? 'checking'
      : missing
        ? 'unavailable'
        : info.connectedCount > 0 ? 'live' : 'ready';
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }

  elements.maxCodexInstances.disabled = !activeProject()
    || state.poolLimitSaving
    || (automatic && codexInstallation === 'missing');
  elements.maxClaudeInstances.disabled = !activeProject()
    || state.poolLimitSaving
    || (automatic && claudeInstallation === 'missing');
  elements.maxOpenCodeInstances.disabled = !activeProject()
    || state.poolLimitSaving
    || (automatic && openCodeInstallation === 'missing');
  elements.maxCodexInstances.title = automatic && codexInstallation === 'missing'
    ? 'Install the Codex CLI to configure Codex instances.'
    : '';
  elements.maxClaudeInstances.title = automatic && claudeInstallation === 'missing'
    ? 'Install the Claude CLI to configure Claude instances.'
    : '';
  elements.maxOpenCodeInstances.title = automatic && openCodeInstallation === 'missing'
    ? 'Install the OpenCode CLI to configure OpenCode instances.'
    : '';
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
  const running = prioritizeStarredTasks(state.runningTasks || []);
  if (running.length === 0) {
    if (
      elements.headerRunningTasks.dataset.signature === 'empty'
      && elements.headerRunningExtraTasks.childElementCount === 0
    ) return;
    elements.headerRunningTasks.dataset.signature = 'empty';
    elements.headerRunningTasks.innerHTML = `
      <div class="header-running-empty">
        <span>No active tasks or sessions</span>
      </div>
    `;
    elements.headerRunningExtraTasks.replaceChildren();
    return;
  }

  const signature = JSON.stringify([
    state.runningTaskLayout.rows,
    running.map((task) => [
      task.id,
      task.repo_path,
      task.thread_id,
      task.thread_name,
      task.title,
      task.starred,
      task.prompt,
      task.latestAgentUpdate?.provider,
      task.latestTokenUsage?.usage?.totalTokens,
      task.latestTokenUsage?.usage?.inputTokens,
      task.latestTokenUsage?.usage?.outputTokens,
      task.latestTokenUsage?.provider,
      task.conversation_metrics?.input_tokens,
      task.conversation_metrics?.output_tokens,
      task.conversation_metrics?.total_tokens,
      task.conversation_metrics?.token_observed,
      task.status,
      task.manual_completion,
      taskMonitorResponseHash(task),
      taskMonitorPresentation(task).state,
      taskRelayLabel(task),
      projectIdentityCustomColor(task.repo_path),
    ]),
  ]);
  if (elements.headerRunningTasks.dataset.signature === signature) return;
  const previousPrimaryScrollLeft = elements.headerRunningTasks.scrollLeft;
  const previousExtraScrollLeft = elements.headerRunningExtraTasks.scrollLeft;
  const focusedTaskId = document.activeElement?.closest?.('[data-running-task-id]')?.dataset.runningTaskId;
  const { primary: primaryTasks, extra: extraTasks } = runningTaskRailGroups(
    running,
    state.runningTaskLayout.rows,
  );
  const taskMarkup = (task) => {
    const update = task.latestAgentUpdate;
    const updateProvider = update?.provider || taskProvider(task);
    const project = workspaceName(task.repo_path);
    const relay = taskRelayLabel(task);
    const monitor = taskMonitorPresentation(task);
    const response = taskMonitorResponse(task, monitor);
    const throughput = tokenThroughputFromSnapshot(task.latestTokenUsage, task);
    const tokenUsage = taskTokenPresentation(task);
    const speedLabel = throughput ? `${throughput.rateLabel} average output tokens/s` : '';
    const tokenLabel = tokenUsage
      ? `, ${tokenUsage.totalTokens.toLocaleString('en-US')} provider-reported tokens, ${tokenUsage.outputTokens.toLocaleString('en-US')} output tokens`
      : '';
    const accessibleLabel = `Task ${task.id}, ${taskDisplayName(task)}, ${monitor.label}${task.starred ? ', starred' : ''}, ${project}, ${relay}${speedLabel ? `, ${speedLabel}` : ''}${tokenLabel}`;
    return `
      <button
        class="header-running-task ${projectIdentityColorClass(task.repo_path)}${monitor.terminalSession ? ' header-terminal-session' : ''}"
        ${projectIdentityStyleAttribute(task.repo_path)}
        type="button"
        data-running-task-id="${task.id}"
        data-provider="${escapeHtml(taskProvider(task))}"
        data-monitor-state="${escapeHtml(monitor.state)}"
        ${monitor.terminalSession ? 'data-terminal-session="true"' : ''}
        aria-label="${escapeHtml(accessibleLabel)}"
      >
        <span class="header-running-initial" aria-hidden="true">${escapeHtml(project.slice(0, 1).toUpperCase())}</span>
        <span class="header-running-meta">
          <i aria-hidden="true"></i>
          <b>#${String(task.id).padStart(3, '0')}</b>
          ${monitor.terminalSession ? `<span class="header-running-state" data-state="${escapeHtml(monitor.state)}">${escapeHtml(monitor.label)}</span>` : ''}
          <span class="header-running-loc">${escapeHtml(relay)}</span>
          ${throughput ? `<span class="header-running-token-speed" data-header-token-speed="${task.id}" title="${tokenSpeedTitle(throughput)}">${throughput.rateLabel} tokens/s</span>` : ''}
          ${taskTokenMetricsMarkup(tokenUsage, 'header-running-token-usage')}
          <time data-header-running-duration="${task.id}">${escapeHtml(taskCardDurationLabel(task))}</time>
        </span>
        <strong class="header-running-prompt" title="${escapeHtml(`${project} · ${taskDisplayName(task)}`)}">
          <span class="header-running-project" title="${escapeHtml(task.repo_path)}">${escapeHtml(project)}</span>
          <span class="header-running-project-separator" aria-hidden="true">·</span>
          <span class="header-running-task-name">${escapeHtml(compactText(taskDisplayName(task), 96))}</span>
        </strong>
        <span class="header-running-response" data-provider="${escapeHtml(updateProvider)}" title="${escapeHtml(response)}">
          <b>${escapeHtml(providerLabel(updateProvider))}</b>
          <span>${escapeHtml(compactText(response, 200))}</span>
        </span>
      </button>
    `;
  };
  elements.headerRunningTasks.dataset.signature = signature;
  elements.headerRunningTasks.innerHTML = primaryTasks.map(taskMarkup).join('');
  elements.headerRunningExtraTasks.innerHTML = extraTasks.map(taskMarkup).join('');
  elements.headerRunningTasks.scrollLeft = previousPrimaryScrollLeft;
  elements.headerRunningExtraTasks.scrollLeft = previousExtraScrollLeft;
  if (focusedTaskId) {
    elements.headerRunningMonitor
      .querySelector(`[data-running-task-id="${focusedTaskId}"]`)
      ?.focus({ preventScroll: true });
  }
}

/*
 * Multiple tasks run at once, so "the" running task no longer exists. When a selection
 * has to be inferred, the most recently started run is the one the user just caused.
 */
function mostRecentlyStartedRunningTask(tasks) {
  return (tasks || [])
    .filter((task) => task.status === 'running')
    .sort((left, right) => (
      new Date(right.started_at || 0) - new Date(left.started_at || 0) || right.id - left.id
  ))[0] || null;
}

function renderDailyTokenUsage() {
  if (!elements.desktopTitlebarTokenUsage || !elements.desktopTitlebarTokenCount) return;
  const presentation = dailyTokenUsagePresentation(state.status?.dailyTokenUsage, {
    supported: state.status?.capabilities?.dailyTokenUsage === true,
  });
  elements.desktopTitlebarTokenCount.textContent = presentation.label;
  elements.desktopTitlebarTokenUsage.dataset.state = presentation.state;
  elements.desktopTitlebarTokenUsage.title = presentation.title;
  elements.desktopTitlebarTokenUsage.setAttribute('aria-label', presentation.title);
  if (!elements.desktopTitlebarTokenPanel) return;
  if (presentation.state !== 'ready') {
    elements.desktopTitlebarTokenPanel.innerHTML = '<p>No token usage recorded today.</p>';
    return;
  }
  const projectRows = presentation.projects.length > 0
    ? presentation.projects.map((project) => `
      <div class="desktop-titlebar-token-project" title="${escapeHtml(project.path)}">
        <strong>${escapeHtml(project.name)}</strong>
        <span>In ${compactTokenCount(project.inputTokens)}</span>
        <span>Out ${compactTokenCount(project.outputTokens)}</span>
        <span>Total ${compactTokenCount(project.totalTokens)}</span>
      </div>
    `).join('')
    : '<p>No project breakdown is available.</p>';
  elements.desktopTitlebarTokenPanel.innerHTML = `
    <div class="desktop-titlebar-token-summary">
      <strong>Today</strong>
      <span>In ${compactTokenCount(presentation.inputTokens)}</span>
      <span>Out ${compactTokenCount(presentation.outputTokens)}</span>
      <span>Total ${compactTokenCount(presentation.totalTokens)}</span>
    </div>
    ${projectRows}
  `;
}

function setDailyTokenUsagePanel(open) {
  if (!elements.desktopTitlebarTokenUsage || !elements.desktopTitlebarTokenPanel) return;
  elements.desktopTitlebarTokenPanel.hidden = !open;
  elements.desktopTitlebarTokenUsage.setAttribute('aria-expanded', String(open));
}

function renderProviderUsage() {
  const supported = state.status?.capabilities?.providerUsage === true;
  const usage = supported
    ? state.status?.providerUsage
    : {
      claude: { status: 'unavailable' },
      codex: { status: 'unavailable' },
    };
  const presentations = providerUsagePresentation(usage);
  let checking = false;
  for (const presentation of presentations) {
    const meter = elements.providerUsageMeters.find(
      (candidate) => candidate.dataset.usageKey === presentation.key,
    );
    if (!meter) continue;
    const value = meter.querySelector('strong');
    const track = meter.querySelector('.provider-usage-track');
    const reset = meter.querySelector('.provider-usage-reset');
    meter.dataset.level = presentation.level;
    meter.title = presentation.title;
    value.textContent = presentation.value;
    reset.textContent = presentation.countdown ? `in ${presentation.countdown}` : '';
    if (presentation.countdownLabel) {
      reset.setAttribute('aria-label', presentation.countdownLabel);
    } else {
      reset.removeAttribute('aria-label');
    }
    if (presentation.usedPercent === null) {
      checking ||= presentation.level === 'checking';
      track.style.removeProperty('--provider-usage-value');
      track.removeAttribute('aria-valuenow');
      track.setAttribute('aria-valuetext', presentation.title);
    } else {
      track.style.setProperty('--provider-usage-value', `${presentation.usedPercent}%`);
      track.setAttribute('aria-valuenow', String(presentation.usedPercent));
      track.removeAttribute('aria-valuetext');
    }
  }
  elements.providerUsage.setAttribute('aria-busy', String(checking));
  const combined = combinedWeeklyUsagePresentation(usage);
  if (combined.usedPercent === null) {
    elements.providerUsage.style.removeProperty('--provider-usage-combined');
    delete elements.providerUsage.dataset.combinedLevel;
    elements.providerUsage.removeAttribute('title');
  } else {
    elements.providerUsage.style.setProperty('--provider-usage-combined', `${combined.usedPercent}%`);
    elements.providerUsage.dataset.combinedLevel = combined.level;
    elements.providerUsage.title = combined.title;
  }
}

function renderStatus() {
  if (!state.status) {
    return;
  }

  const paused = isActiveProjectPaused();
  const scopedTasks = projectTasks();
  const queuedCount = scopedTasks.filter((task) => task.status === 'queued').length;
  const runningInProject = scopedTasks.filter((task) => task.status === 'running');
  const openSessionCount = scopedTasks.filter((task) => task.status === 'open' && isManualSessionTask(task)).length;
  const staleProjectScheduler = projectQueueRestartRequired({
    supported: state.status.capabilities?.projectQueueIsolation,
    paused,
    queuedCount,
    projectRunning: runningInProject.length > 0,
    otherProjectRunning: state.tasks.some((task) => (
      task.status === 'running' && !sameProjectPath(task.repo_path, state.activeProjectPath)
    )),
  });
  const staleClaudeScheduler = parallelClaudeRestartRequired({
    supported: state.status.capabilities?.parallelClaudeExecution,
    queuedTasks: scopedTasks,
    runningTasks: state.tasks,
  });

  const update = desktopUpdatePresentation(state.status.desktopUpdate);
  elements.desktopUpdateIndicator.hidden = update.hidden;
  elements.desktopUpdateIndicator.dataset.state = update.state;
  elements.desktopUpdateIndicator.title = update.title;
  elements.desktopUpdateIndicator.setAttribute('aria-label', update.title || 'CC Relay update');
  elements.desktopUpdateLabel.textContent = update.label;
  elements.desktopUpdateModal.dataset.state = update.state;
  elements.desktopUpdateTitle.textContent = update.modalTitle || 'CC Relay update';
  elements.desktopUpdateMessage.textContent = update.modalMessage || 'Release details are unavailable.';
  elements.desktopUpdateCurrentVersion.textContent = update.currentVersion
    ? `v${update.currentVersion}`
    : 'Unknown';
  elements.desktopUpdateLatestVersion.textContent = update.latestVersion
    ? `v${update.latestVersion}`
    : 'Unknown';
  elements.desktopUpdateStatus.textContent = update.statusLabel;
  const showUpdateProgress = update.progress !== null
    && ['downloading', 'downloaded'].includes(update.state);
  elements.desktopUpdateProgress.hidden = !showUpdateProgress;
  if (showUpdateProgress) {
    elements.desktopUpdateProgressValue.textContent = `${update.progress}%`;
    elements.desktopUpdateProgressBar.setAttribute('aria-valuenow', String(update.progress));
    elements.desktopUpdateProgressBar.style.setProperty('--desktop-update-progress', `${update.progress}%`);
  } else {
    elements.desktopUpdateProgressBar.removeAttribute('aria-valuenow');
    elements.desktopUpdateProgressBar.style.removeProperty('--desktop-update-progress');
  }
  elements.desktopUpdateNotesTitle.textContent = update.latestVersion
    ? `What's new in v${update.latestVersion}`
    : "What's new";
  const releaseNotes = Array.isArray(update.releaseNotes) ? update.releaseNotes : [];
  const releaseNotesSignature = JSON.stringify(releaseNotes.map((note) => [
    note.section,
    note.text,
  ]));
  if (elements.desktopUpdateNotesList.dataset.signature !== releaseNotesSignature) {
    const releaseNotesFragment = document.createDocumentFragment();
    for (const note of releaseNotes) {
      const item = document.createElement('li');
      const section = document.createElement('span');
      section.className = 'desktop-update-note-section';
      section.dataset.kind = String(note.section || 'Highlights').toLowerCase();
      section.textContent = note.section || 'Highlights';
      const copy = document.createElement('span');
      copy.className = 'desktop-update-note-copy';
      copy.textContent = note.text;
      item.append(section, copy);
      releaseNotesFragment.append(item);
    }
    elements.desktopUpdateNotesList.replaceChildren(releaseNotesFragment);
    elements.desktopUpdateNotesList.dataset.signature = releaseNotesSignature;
  }
  elements.desktopUpdateNotesList.hidden = releaseNotes.length === 0;
  elements.desktopUpdateNotesEmpty.hidden = releaseNotes.length > 0;
  elements.desktopUpdateRelease.href = update.href;
  elements.desktopUpdateRelease.textContent = update.releaseLabel;
  renderDesktopZoomControls();
  renderDailyTokenUsage();
  renderProviderUsage();

  renderHeaderRunningTasks();

  if (taskSearchActive(state.taskSearchQuery)) {
    elements.queueSummary.textContent = state.taskSearchPending
      ? 'Searching every saved command and response'
      : state.taskSearchError
        ? state.taskSearchError
        : `${state.taskSearchTotal} matching task${state.taskSearchTotal === 1 ? '' : 's'} across all dates`;
  } else if (state.taskView === 'history') {
    const historyCount = tasksInPeriod(scopedTasks, state.historyPeriod, state.historyAnchor).length;
    elements.queueSummary.textContent = `${historyCount} task${historyCount === 1 ? '' : 's'} in selected ${state.historyPeriod}`;
  } else {
    elements.queueSummary.textContent = staleClaudeScheduler
      ? `Restart CC Relay to run Claude simultaneously across projects · ${queuedCount} waiting`
      : staleProjectScheduler
      ? `Restart CC Relay to activate this project's independent queue · ${queuedCount} waiting`
      : paused
      ? `${queuedCount} task${queuedCount === 1 ? '' : 's'} waiting while paused`
      : runningInProject.length > 1
        ? `${runningInProject.length} tasks running · ${queuedCount} waiting`
      : runningInProject.length === 1
        ? `Task ${runningInProject[0].id} is running · ${queuedCount} waiting`
        : openSessionCount > 0
          ? `${openSessionCount} terminal session${openSessionCount === 1 ? '' : 's'} open · ${queuedCount} waiting`
          : `${queuedCount} waiting · queue ready`;
  }
}

function taskCardAttachmentPreviewsMarkup(task) {
  const attachments = Array.isArray(task.attachments) ? task.attachments : [];
  if (attachments.length === 0) return '';
  const hasOverflow = attachments.length > TASK_CARD_ATTACHMENT_SLOT_LIMIT;
  const previewLimit = hasOverflow
    ? TASK_CARD_ATTACHMENT_SLOT_LIMIT - 1
    : TASK_CARD_ATTACHMENT_SLOT_LIMIT;
  const previews = attachments.slice(0, previewLimit);
  const remaining = attachments.length - previews.length;
  const imageCountLabel = `${attachments.length} reference image${attachments.length === 1 ? '' : 's'}`;
  return `
    <div class="task-attachment-previews" role="group" aria-label="${imageCountLabel}">
      ${previews.map((attachment, index) => {
        const name = attachment.name || `Image ${index + 1}`;
        const source = `/api/tasks/${task.id}/attachments/${encodeURIComponent(attachment.id)}`;
        return `
          <a
            class="task-attachment-preview"
            href="${source}"
            target="_blank"
            rel="noreferrer"
            aria-label="Open image ${index + 1} of ${attachments.length}: ${escapeHtml(name)}"
            title="Open ${escapeHtml(name)}"
          ><img data-preview-source="${source}" alt="" loading="lazy" decoding="async" draggable="false"></a>
        `;
      }).join('')}
      ${remaining > 0 ? `
        <span class="task-attachment-overflow" title="${remaining} more image${remaining === 1 ? '' : 's'} in Full details">
          <span aria-hidden="true">+${remaining}</span>
          <span class="sr-only">${remaining} more image${remaining === 1 ? '' : 's'} in Full details</span>
        </span>
      ` : ''}
    </div>
  `;
}

function taskListRenderSignature(visibleTasks, searching) {
  return JSON.stringify({
    tasks: visibleTasks,
    selectedTaskId: state.selectedTaskId,
    activeProjectPath: state.activeProjectPath,
    taskView: state.taskView,
    historyPeriod: state.historyPeriod,
    historyAnchor: state.historyAnchor,
    searching,
    taskSearchPending: state.taskSearchPending,
    taskSearchError: state.taskSearchError,
    taskSearchResults: state.taskSearchResults,
    taskSearchTotal: state.taskSearchTotal,
    unreadTaskIds: visibleTasks
      .filter((task) => state.projectCompletionNotifications.includes(task.repo_path, task.id))
      .map((task) => task.id),
    assigningTaskId: state.assigningTaskId,
    taskTitleRename: state.taskTitleRename,
    taskStarSavingIds: [...state.taskStarSavingIds],
    parallelTaskIds: [...state.parallelTaskIds],
    threads: state.threads,
    projects: state.projects,
    capabilities: state.status?.capabilities,
    planningTaskIds: state.status?.planningTaskIds,
  }, (key, value) => key === 'latest_event_id' ? undefined : value);
}

function renderTasks() {
  renderTaskSearch();
  // Deselecting a task never runs renderEventStream, so the Terminal window control is
  // refreshed here as well as from the stream render.
  updateTerminalWindowAvailability();
  const standupSupported = standupGenerationSupported();
  elements.standupButton.disabled = !state.activeProjectPath || !standupSupported;
  elements.standupButton.title = !state.activeProjectPath
    ? 'Select a Launchpad project to create a standup'
    : standupSupported
      ? 'Generate a date-selected AI standup from saved prompts and responses'
      : 'Restart CC Relay to activate configured AI standup generation';
  const unreadCount = state.projectCompletionNotifications.count(state.activeProjectPath);
  elements.clearTaskNotificationsButton.hidden = unreadCount === 0;
  elements.clearTaskNotificationsButton.textContent = `Mark reviewed · ${unreadCount}`;
  elements.clearTaskNotificationsButton.setAttribute(
    'aria-label',
    `Mark all ${unreadCount} ready-for-review task${unreadCount === 1 ? '' : 's'} in this project as reviewed`,
  );
  elements.clearTaskNotificationsButton.title = 'Mark every ready-for-review task in this project as reviewed';
  if (elements.standupModal.open) renderStandup();
  if (state.queueDrag) {
    return;
  }
  const scopedTasks = projectTasks();
  const searching = taskSearchActive(state.taskSearchQuery);
  const visibleTasks = searching
    ? prioritizeStarredTasks(tasksForSearchResults(scopedTasks, state.taskSearchResults))
    : state.taskView === 'history'
    ? prioritizeStarredTasks(
      tasksInPeriod(scopedTasks, state.historyPeriod, state.historyAnchor)
        .sort((left, right) => new Date(right.created_at) - new Date(left.created_at)),
    )
    : sortOperationalTasks(scopedTasks, {
      isReadyForReview: (task) => state.projectCompletionNotifications.includes(task.repo_path, task.id),
    });
  const activeRenameForm = document.activeElement?.closest?.('[data-task-title-form]');
  if (
    activeRenameForm
    && elements.taskList.contains(activeRenameForm)
    && visibleTasks.some((task) => task.id === state.taskTitleRename?.taskId)
  ) {
    return;
  }
  if (
    state.taskTitleRename
    && !visibleTasks.some((task) => task.id === state.taskTitleRename.taskId)
  ) {
    state.taskTitleRename = null;
  }
  renderHistoryLedger(scopedTasks, visibleTasks);
  const listSignature = taskListRenderSignature(visibleTasks, searching);
  if (renderedTaskListSignature === listSignature) return;
  if (visibleTasks.length === 0) {
    state.parallelTaskIds.clear();
    renderParallelBatchBar();
    const emptyTitle = searching
      ? state.taskSearchPending ? 'Searching conversations' : state.taskSearchError ? 'Search unavailable' : 'No matching tasks'
      : state.taskView === 'history' ? 'No tasks in this period' : 'The queue is clear';
    const emptyMessage = searching
      ? state.taskSearchPending
        ? 'Checking every saved command and response in this project.'
        : state.taskSearchError
          ? 'Clear the search or try again after Relay is available.'
          : 'Try fewer words, a task number, or text from the response you remember.'
      : state.taskView === 'history'
        ? 'Choose another date or a wider period.'
        : state.activeProjectPath
          ? `No tasks in ${escapeHtml(workspaceName(state.activeProjectPath))} yet.`
          : 'Choose a terminal and add the first prompt.';
    const showingPreviews = releaseTaskAttachmentPreviews();
    elements.taskList.innerHTML = `
      <div class="queue-empty">
        <span aria-hidden="true">00</span>
        <strong>${emptyTitle}</strong>
        <p>${emptyMessage}</p>
      </div>
    `;
    // The empty view has no thumbnails, but the observer stays coherent with the
    // released set so a later rebuild restores from a single contract.
    observeTaskAttachmentPreviews(showingPreviews);
    renderedTaskListSignature = listSignature;
    return;
  }

  const historyActive = state.taskView === 'history' && !searching;
  const operationalQueue = !historyActive && !searching;
  const searchMatches = taskSearchMatches();
  const queuedIds = operationalQueue ? visibleTasks.filter((task) => task.status === 'queued').map((task) => task.id) : [];
  const queuedIdsByStar = {
    starred: visibleTasks.filter((task) => task.status === 'queued' && task.starred === true).map((task) => task.id),
    unstarred: visibleTasks.filter((task) => task.status === 'queued' && task.starred !== true).map((task) => task.id),
  };
  // Reordering applies to every queued task; batching applies only to direct
  // execute work, so the batch selection is pruned against its own narrower set.
  const batchableIds = operationalQueue ? visibleTasks
    .filter((task) => (
      task.status === 'queued'
      && (task.mode || 'execute') === 'execute'
      && task.terminal_lifecycle !== 'disposable'
    ))
    .map((task) => task.id) : [];
  state.parallelTaskIds = new Set([...state.parallelTaskIds].filter((id) => batchableIds.includes(id)));
  renderParallelBatchBar();
  let previousHistoryDate = '';
  let previousQueueSection = '';
  let searchStarredHeadingShown = false;
  const showingPreviews = releaseTaskAttachmentPreviews();
  elements.taskList.innerHTML = visibleTasks.map((task) => {
    const unread = state.projectCompletionNotifications.includes(task.repo_path, task.id);
    const starred = task.starred === true;
    const historyDate = historyActive ? new Date(task.created_at).toDateString() : '';
    const queuePeriod = historyActive || searching
      ? ''
      : new Date(task.created_at).toDateString() === new Date().toDateString() ? 'today' : 'past';
    const queueSection = operationalQueue
      ? starred ? 'starred' : task.status === 'running' ? 'running' : unread ? 'review' : queuePeriod
      : '';
    const dateHeading = (historyActive && starred && previousHistoryDate !== 'starred')
      || (operationalQueue && queueSection === 'starred' && previousQueueSection !== 'starred')
      || (searching && starred && !searchStarredHeadingShown)
      ? '<div class="queue-date-heading queue-starred-heading" data-period="starred"><span>Starred</span><i></i></div>'
      : historyActive && !starred && historyDate !== previousHistoryDate
      ? `<div class="history-date-heading"><span>${escapeHtml(historyDateHeading(task.created_at))}</span><i></i></div>`
      : operationalQueue && queueSection !== previousQueueSection && queueSection === 'review'
        ? '<div class="queue-date-heading queue-review-heading" data-period="review"><span>Ready for review</span><i></i></div>'
      : operationalQueue && queueSection !== previousQueueSection && queueSection !== 'running'
        ? `<div class="queue-date-heading" data-period="${queueSection}"><span>${queueSection === 'today' ? 'Today' : 'Past'}</span><i></i></div>`
        : '';
    previousHistoryDate = starred ? 'starred' : historyDate;
    previousQueueSection = queueSection;
    if (searching && starred) searchStarredHeadingShown = true;
    const queued = queuedIds.includes(task.id);
    const queuedGroupIds = queued
      ? queuedIdsByStar[starred ? 'starred' : 'unstarred']
      : [];
    const queueIndex = queuedGroupIds.indexOf(task.id);
    /*
     * The parallel batch replaces the selected tasks with one combined Codex
     * task, destroying the original rows. A breakdown, Plan council, or Turbo
     * task owns state outside the queue (a plan's breakdown row, a council
     * checkpoint, a dependency graph), so destroying its row bricks that work:
     * a batched breakdown leaves its plan pointing at a task that no longer
     * exists. Only direct execute tasks may be batched. The server rejects the
     * rest as well; this keeps the checkbox from ever offering it.
     */
    const batchable = queued
      && (task.mode || 'execute') === 'execute'
      && task.terminal_lifecycle !== 'disposable';
    const turboMarker = turboPlanMarker(turboPresentationTask(task));
    const turboOwner = task.mode === 'turbo' ? turboFooterIdentity(task) : null;
    const assignable = queued && operationalQueue
      && task.mode === 'execute'
      && task.terminal_lifecycle !== 'disposable'
      && (
        task.provider === 'codex'
        || (task.provider === 'claude' && state.status?.capabilities?.queuedClaudeAssignment === true)
      );
    const assignmentTargets = assignable ? state.threads.filter((thread) => (
      threadProvider(thread) === task.provider
      && sameProjectPath(thread.cwd, task.repo_path)
      && thread.id !== task.thread_id
    )) : [];
    const reorderable = queued && operationalQueue && Boolean(state.activeProjectPath);
    // A session task outlives its own run, so the card carries the live terminal state as
    // a word. Colour reinforces it; it never carries the meaning alone.
    const sessionCard = isDirectSessionTask(task);
    const manualSessionCard = isManualSessionTask(task);
    const sessionState = sessionCard ? sessionTaskState(task) : '';
    const sessionWord = sessionCard ? sessionBadgeWord(sessionState) : '';
    const displayName = taskDisplayName(task);
    const preparing = state.status?.planningTaskIds?.includes(task.id) === true;
    const quickRenameable = task.mode !== 'breakdown' && taskTitleRenamingSupported();
    const legacyRenameable = queued
      && task.mode !== 'breakdown'
      && taskNamingSupported();
    const renameable = quickRenameable || legacyRenameable;
    const renameState = state.taskTitleRename?.taskId === task.id ? state.taskTitleRename : null;
    const starSaving = state.taskStarSavingIds.has(task.id);
    const tokenUsage = taskTokenPresentation(task);
    const searchMatch = searchMatches.get(task.id);
    const searchMatchCard = searchMatch ? `
      <div class="task-search-match" data-source="${escapeHtml(searchMatch.source)}">
        <span>${escapeHtml(searchMatch.label)}</span>
        <p>${taskSearchMatchMarkup(searchMatch)}</p>
      </div>
    ` : '';
    const reorderControls = reorderable ? `
      <span class="queue-reorder" aria-label="Reorder queued task">
        <button type="button" data-move="up" aria-label="Move task ${task.id} up" ${queueIndex === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" data-move="down" aria-label="Move task ${task.id} down" ${queueIndex === queuedGroupIds.length - 1 ? 'disabled' : ''}>↓</button>
      </span>
    ` : '';
    return `${dateHeading}
      <article
        class="task-card ${projectIdentityColorClass(task.repo_path)} ${task.id === state.selectedTaskId ? 'selected' : ''} ${unread ? 'task-card-unread' : ''} ${reorderable ? 'task-card-reorderable' : ''}"
        ${projectIdentityStyleAttribute(task.repo_path)}
        data-task-id="${task.id}"
        data-status="${escapeHtml(task.status)}"
        data-mode="${escapeHtml(task.mode || 'execute')}"
        data-starred="${starred}"
        data-unread="${unread}"
        ${searchMatch ? 'data-search-result="true"' : ''}
        ${sessionCard ? `data-session="true" data-session-state="${escapeHtml(sessionState)}"` : ''}
        ${manualSessionCard ? 'data-manual-completion="true"' : ''}
        tabindex="0"
        aria-label="Task ${task.id}, ${escapeHtml(displayName)}, ${escapeHtml(task.status)}${starred ? ', starred' : ''}${manualSessionCard ? ', terminal session with manual completion' : sessionCard ? ', retained session' : ''}${sessionCard ? `, terminal ${escapeHtml(sessionWord)}` : ''}${tokenUsage ? `, ${tokenUsage.totalTokens.toLocaleString('en-US')} provider-reported tokens, ${tokenUsage.outputTokens.toLocaleString('en-US')} output tokens` : ''}${unread ? ', ready for review' : ''}${queued ? ', draggable queue item' : ''}"
      >
        ${manualSessionCard ? `
          <div class="task-session-modebar">
            <span><i aria-hidden="true"></i>Terminal session</span>
            <b>Manual finish</b>
          </div>
        ` : ''}
        <div class="task-topline">
          ${taskStarringSupported() ? `
            <button
              class="task-star-button"
              type="button"
              data-star-task
              aria-label="${starred ? 'Remove star from' : 'Star'} task ${task.id}"
              aria-pressed="${starred}"
              title="${starred ? 'Remove from Starred' : 'Star and move to top'}"
              ${starSaving ? 'disabled' : ''}
            ><span class="sr-only">${starred ? 'Unstar' : 'Star'}</span></button>
          ` : ''}
          <span class="task-identity">
            ${batchable ? `<input class="parallel-task-check" type="checkbox" aria-label="Select task ${task.id} for parallel Codex execution" ${state.parallelTaskIds.has(task.id) ? 'checked' : ''}>` : ''}
            ${reorderable ? '<span class="drag-grip" draggable="true" role="button" tabindex="0" aria-label="Drag task to reorder">⠿</span>' : ''}
            ${agentBadgeMarkup(task, 'task-agent-icon')}
            <span class="task-number">#${String(task.id).padStart(3, '0')}</span>
            ${sessionCard ? `<span class="task-session-badge" data-session-state="${escapeHtml(sessionState)}"><i aria-hidden="true"></i>${manualSessionCard ? 'Terminal' : 'Session'} · ${escapeHtml(sessionWord)}</span>` : ''}
            ${unread && (!operationalQueue || starred) ? '<span class="task-unread-marker">Ready for review</span>' : ''}
            ${task.continued_from_task_id ? `<span class="task-parent-link">↳ #${String(task.continued_from_task_id).padStart(3, '0')}</span>` : ''}
          </span>
          <span class="task-footer-execution" data-provider="${escapeHtml(taskProvider(task))}" title="${escapeHtml(taskRelayLabel(task))}"><span class="task-relay-name ${turboOwner ? turboOwner.className : relayColorClass(task.thread_id)}">${escapeHtml(turboOwner ? `${turboOwner.role} ${turboOwner.label}` : `${providerLabel(taskProvider(task))}${task.thread_id ? ` · ${task.thread_id.slice(0, 7)}` : ''}`)}</span><span aria-hidden="true"> · </span>${escapeHtml(taskCardExecutionLabel(task))}</span>
          <span class="task-top-actions">
            ${assignmentTargets.length ? `<button class="task-assign-button" type="button" data-show-assignment aria-expanded="${state.assigningTaskId === task.id}">Assign</button>` : ''}
            ${reorderControls}
            ${turboMarker ? `<span class="turbo-plan-marker turbo-plan-marker-${escapeHtml(turboMarker.phase)}" title="${escapeHtml(turboMarker.label)}" aria-label="Turbo stage: ${escapeHtml(turboMarker.label)}">${escapeHtml(turboMarker.label)}</span>` : ''}
            <span class="task-status status-${escapeHtml(task.status)}">${escapeHtml(task.status)}</span>
          </span>
        </div>
        <div class="task-name-row" data-editing="${Boolean(renameState)}">

          ${renameState ? `
            <form class="task-inline-rename" data-task-title-form aria-label="Rename task ${task.id}">
              <input
                type="text"
                data-task-title-input
                value="${escapeHtml(renameState.value)}"
                maxlength="120"
                aria-label="Task ${task.id} name"
                ${renameState.saving ? 'disabled' : ''}
              >
              <button type="submit" data-save-task-title aria-label="Save task name" title="Save task name" ${renameState.saving ? 'disabled' : ''}><span class="sr-only">Save</span></button>
              <button type="button" data-cancel-task-title aria-label="Cancel rename" title="Cancel rename" ${renameState.saving ? 'disabled' : ''}><span class="sr-only">Cancel</span></button>
              <span class="task-inline-rename-message" role="status" ${renameState.error ? '' : 'hidden'}>${escapeHtml(renameState.error || '')}</span>
            </form>
          ` : `<h3 class="task-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</h3>`}
          ${renameable && !renameState ? `
            <button
              class="task-rename-button"
              type="button"
              data-rename-task
              data-quick-rename="${quickRenameable}"
              aria-label="Rename task ${task.id}"
              title="${preparing ? 'This task is already being prepared.' : 'Rename task'}"
              ${preparing ? 'disabled' : ''}
            ><span class="sr-only">Rename</span></button>
          ` : ''}
        </div>
        ${searchMatchCard}
        ${taskHasCustomName(task) ? `<p class="task-prompt">${escapeHtml(task.prompt)}</p>` : ''}
        ${taskCardAttachmentPreviewsMarkup(task)}
        ${turboFleetMarkup(task)}
        ${state.assigningTaskId === task.id ? `
          <div class="task-assignment-options" aria-label="Assign task ${task.id} to another CC Relay">
            ${assignmentTargets.map((thread) => `<button type="button" data-assign-thread="${escapeHtml(thread.id)}">${escapeHtml(assignmentTargetLabel(thread))} <span>${escapeHtml(thread.status)}</span></button>`).join('')}
          </div>
        ` : ''}
        <div class="task-footer">
          <span class="task-footer-metrics">
            ${taskTokenMetricsMarkup(tokenUsage)}
            <span class="task-footer-timing"><span class="task-duration" data-task-duration="${task.id}">${escapeHtml(taskCardDurationLabel(task))}</span></span>
          </span>
          <span class="task-footer-dates">${taskCardDatesMarkup(task)}</span>
        </div>
      </article>
    `;
  }).join('');
  renderedTaskListSignature = listSignature;
  observeTaskAttachmentPreviews(showingPreviews);

  for (const card of elements.taskList.querySelectorAll('.task-card')) {
    const select = () => {
      closeTaskReferenceMenu();
      selectTask(Number(card.dataset.taskId));
    };
    card.addEventListener('contextmenu', (event) => {
      // Preserve the browser's native Copy menu when the operator right-clicks text they
      // selected inside a card. The custom task menu owns only an unselected card surface.
      if (textSelectionGuard.isActive() || event.target.closest('a, input, select, textarea')) return;
      event.preventDefault();
      const task = state.tasks.find((item) => item.id === Number(card.dataset.taskId));
      openTaskReferenceMenu(task, { x: event.clientX, y: event.clientY });
    });
    card.addEventListener('click', (event) => {
      // Mouseup after dragging across card text also emits a click. Do not turn that
      // completed text selection into task activation and an immediate card rebuild.
      if (!textSelectionGuard.isActive() && !event.target.closest('a, button, input, form')) {
        select();
      }
    });
    card.addEventListener('keydown', (event) => {
      if (event.target.closest('a, button, input, form')) {
        return;
      }
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault();
        const task = state.tasks.find((item) => item.id === Number(card.dataset.taskId));
        const rect = card.getBoundingClientRect();
        openTaskReferenceMenu(task, {
          x: rect.left + Math.min(36, rect.width / 2),
          y: rect.top + Math.min(36, rect.height / 2),
          focus: true,
        });
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

    card.querySelector('[data-rename-task]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const task = state.tasks.find((item) => item.id === Number(card.dataset.taskId));
      if (!task) return;
      if (event.currentTarget.dataset.quickRename === 'true') startTaskTitleRename(task);
      else openTaskEditor(task);
    });

    card.querySelector('[data-star-task]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const task = state.tasks.find((item) => item.id === Number(card.dataset.taskId));
      if (task) void toggleTaskStar(task);
    });

    const titleForm = card.querySelector('[data-task-title-form]');
    const titleInput = titleForm?.querySelector('[data-task-title-input]');
    titleInput?.addEventListener('input', () => {
      if (state.taskTitleRename?.taskId !== Number(card.dataset.taskId)) return;
      state.taskTitleRename.value = titleInput.value;
      state.taskTitleRename.error = '';
      const message = titleForm.querySelector('.task-inline-rename-message');
      message.hidden = true;
      message.textContent = '';
    });
    titleInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || state.taskTitleRename?.saving) return;
      event.preventDefault();
      cancelTaskTitleRename(Number(card.dataset.taskId));
    });
    titleForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      void saveTaskTitleRename(Number(card.dataset.taskId));
    });
    titleForm?.querySelector('[data-cancel-task-title]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      cancelTaskTitleRename(Number(card.dataset.taskId));
    });

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

    if (card.dataset.status === 'queued' && operationalQueue && state.activeProjectPath) {
      const grip = card.querySelector('.drag-grip');
      grip?.addEventListener('dragstart', (event) => {
        if (state.reorderPending || state.queueDrag) {
          event.preventDefault();
          return;
        }
        const draggedId = Number(card.dataset.taskId);
        const projectQueueTasks = projectTasks();
        const draggedTask = projectQueueTasks.find((task) => task.id === draggedId);
        const projectQueueIds = queuedTaskIds(projectQueueTasks);
        const visibleQueueIds = queuedTaskIds(projectQueueTasks.filter((task) => (
          task.starred === (draggedTask?.starred === true)
        )));
        const snapshot = createQueueSnapshot(projectQueueIds, visibleQueueIds);
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
        if (!drag.snapshot.visibleTaskIds.includes(targetId)) {
          clearQueueDropMarkers();
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
        if (
          !drag
          || drag.draggedId === targetId
          || drag.submitted
          || !drag.snapshot.visibleTaskIds.includes(targetId)
        ) {
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

/*
 * REMOVABLE BLOCK: client-side pre-POST idle settle.
 *
 * This is the only thing that can delay task creation, and it exists purely for the
 * launch-to-enqueue race: a CC Relay launched a moment ago has not connected yet, and
 * without the wait the task is pinned to the busy CC Relay the user is looking at.
 * The three second ceiling is deliberate. Once the backend resolves an idle CC Relay at
 * dispatch time, delete IDLE_SETTLE_* and this function, and call submissionThreadId
 * directly at the one call site in the submit handler. Nothing else depends on it.
 *
 * It refreshes with render: false so the wait can never rewrite the selection it is
 * resolving, which is what made a submission land on a different CC Relay than the one
 * the user picked.
 */
const IDLE_SETTLE_ATTEMPTS = 6;
const IDLE_SETTLE_INTERVAL_MS = 500;

async function settleIdleSubmissionThread({ runNow = false } = {}) {
  const immediate = submissionThreadId({ runNow });
  if (runNow || !state.preferIdleTerminal || state.taskMode !== 'execute' || !providerSupportsIdleRouting()) return immediate;
  const selected = state.threads.find((thread) => thread.id === state.selectedThreadId);
  if (immediate !== state.selectedThreadId || selected?.status === 'idle') return immediate;
  for (let attempt = 0; attempt < IDLE_SETTLE_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, IDLE_SETTLE_INTERVAL_MS));
    await loadThreads({ render: false });
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
    && task.terminal_lifecycle !== 'disposable'
    && ['codex', 'claude'].includes(task.provider)
    && threadProvider(thread || {}) === task.provider
    && (
      task.provider === 'codex'
      || state.status?.capabilities?.queuedClaudeAssignment === true
    )
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
  elements.parallelBatchBar.hidden = state.taskView === 'history'
    || taskSearchActive(state.taskSearchQuery)
    || selectedCount === 0;
  elements.parallelSelectionCount.textContent = `${selectedCount} selected`;
  elements.parallelSessionSelect.textContent = selectedThread
    ? `${workspaceName(selectedThread.cwd)} · ${selectedThread.title}`
    : 'Select a live Codex terminal';
  const supported = state.status?.capabilities?.parallelCodexBatch === true;
  /*
   * Every task in one batch must belong to the selected Codex terminal's workspace. The
   * project-bounded queue implies this today; stating it explicitly means the invariant
   * does not silently depend on which tasks happen to be visible.
   */
  const workspaceMismatch = Boolean(selectedThread) && state.tasks.some((task) => (
    state.parallelTaskIds.has(task.id) && !sameProjectPath(task.repo_path, selectedThread.cwd)
  ));
  elements.parallelRunButton.disabled = selectedCount < 2 || !selectedThread || !supported || workspaceMismatch;
  elements.parallelRunButton.textContent = !supported
    ? 'Restart CC Relay to enable'
    : workspaceMismatch ? 'Same workspace only' : 'Run in parallel';
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
  // Replacing even one text node inside the selected range can collapse the browser's
  // selection. Durations catch up on the next one-second tick after the range is cleared.
  if (textSelectionGuard.isActive()) return;
  const tasksById = new Map(state.tasks.map((task) => [task.id, task]));
  for (const element of elements.taskList.querySelectorAll('[data-task-duration]')) {
    const task = tasksById.get(Number(element.dataset.taskDuration));
    if (task) {
      element.textContent = taskCardDurationLabel(task);
    }
  }
  const runningById = new Map(state.runningTasks.map((task) => [task.id, task]));
  for (const element of elements.headerRunningMonitor.querySelectorAll('[data-header-running-duration]')) {
    const task = runningById.get(Number(element.dataset.headerRunningDuration));
    if (task) {
      element.textContent = taskCardDurationLabel(task);
    }
  }
  for (const element of elements.headerRunningMonitor.querySelectorAll('[data-header-token-speed]')) {
    const task = runningById.get(Number(element.dataset.headerTokenSpeed));
    const throughput = task && tokenThroughputFromSnapshot(task.latestTokenUsage, task);
    if (!throughput) continue;
    element.textContent = `${throughput.rateLabel} tokens/s`;
    element.title = tokenSpeedTitle(throughput);
  }
  const selected = state.selectedTaskForEvents;
  if (selected && elements.termDuration) {
    const fresh = tasksById.get(selected.id) || selected;
    elements.termDuration.textContent = terminalDurationLabel(fresh);
    const speedElement = elements.eventMetrics.querySelector('[data-task-token-speed]');
    const throughput = speedElement && tokenThroughput(state.selectedTaskEvents, fresh);
    if (throughput) {
      speedElement.querySelector('b').textContent = throughput.rateLabel;
      speedElement.title = tokenSpeedTitle(throughput);
    }
    refreshActivityOverviewDurations(elements.eventOverview);
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
  const tasks = projectTasks();
  const task = tasks.find((item) => item.id === taskId);
  if (!task || task.status !== 'queued') return;
  const globalTaskIds = queuedTaskIds(tasks);
  const visibleTaskIds = queuedTaskIds(tasks.filter((item) => (
    item.starred === (task.starred === true)
  )));
  const snapshot = createQueueSnapshot(globalTaskIds, visibleTaskIds);
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

async function keepRunningTaskTerminalOpen(task) {
  if (
    !task
    || task.status !== 'running'
    || task.terminal_lifecycle !== 'disposable'
    || task.keep_terminal_open === true
    || state.terminalRetentionSavingTaskIds.has(task.id)
  ) return;

  state.terminalRetentionSavingTaskIds.add(task.id);
  state.terminalRetentionFeedback.delete(task.id);
  const button = elements.detailActions.querySelector('[data-terminal-retention]');
  if (button) {
    button.disabled = true;
    button.dataset.state = 'pending';
    button.textContent = 'Stopping auto-close...';
  }
  elements.terminalRetentionMessage.hidden = true;
  try {
    const body = await api(`/api/tasks/${task.id}/keep-terminal-open`, { method: 'POST' });
    state.tasks = state.tasks.map((item) => item.id === task.id ? { ...item, ...body.task } : item);
    state.runningTasks = state.runningTasks.map((item) => item.id === task.id ? { ...item, ...body.task } : item);
    const target = ['plan', 'turbo'].includes(task.mode) ? 'terminals' : 'terminal';
    state.terminalRetentionFeedback.set(task.id, {
      kind: 'success',
      message: `Auto-close stopped. This task's ${target} will stay open after the run.`,
    });
  } catch (error) {
    state.terminalRetentionFeedback.set(task.id, {
      kind: 'error',
      message: error.message,
    });
  } finally {
    state.terminalRetentionSavingTaskIds.delete(task.id);
    await load({ fresh: true }).catch((error) => {
      elements.queueSummary.textContent = error.message;
    });
  }
}

function openTaskDetailModal() {
  if (!state.selectedTaskId || elements.taskDetail.hidden) return;
  // A fresh visit to the full record should expose the operator's request immediately.
  // Readers may still collapse Prompts while the dialog remains open.
  if (!elements.promptSection.hidden) elements.promptSection.open = true;
  if (!elements.taskDetailModal.open) elements.taskDetailModal.showModal();
}

function closeTaskDetailModal() {
  if (elements.taskDetailModal.open) elements.taskDetailModal.close();
}

/* ------------------------------------------------------------------
 * Changes dialog (per-task git diff preview).
 *
 * The dialog owns one interval, created when it opens and cleared on its own close
 * event, on a task switch and the moment the task stops being live. It never reuses the
 * periodic detail poll, because that poll runs whether or not this dialog is open.
 * ------------------------------------------------------------------ */

const TASK_DIFF_POLL_MS = 3_000;

function taskDiffTask() {
  const taskId = state.taskDiff.taskId;
  if (taskId === null) return null;
  return state.tasks.find((item) => item.id === taskId)
    || state.runningTasks.find((item) => item.id === taskId)
    || null;
}

function taskDiffIsLive() {
  return isLiveTaskStatus(taskDiffTask()?.status);
}

function setTaskDiffMessage(message) {
  elements.taskDiffMessage.hidden = !message;
  elements.taskDiffMessage.textContent = message || '';
}

function stopTaskDiffPolling() {
  if (state.taskDiff.pollTimer === null) return;
  window.clearInterval(state.taskDiff.pollTimer);
  state.taskDiff.pollTimer = null;
}

/*
 * Only closed folders are recorded. The renderer treats presence in the map as "closed",
 * so an entry left behind for a folder the reader reopened would collapse it again on
 * the next live refresh.
 */
function rememberTaskDiffCollapse() {
  for (const folder of elements.taskDiffTree.querySelectorAll('.task-diff-folder')) {
    const path = folder.dataset.folderPath;
    if (folder.open) state.taskDiff.collapsed.delete(path);
    else state.taskDiff.collapsed.set(path, true);
  }
}

function markTaskDiffSelection() {
  for (const row of elements.taskDiffTree.querySelectorAll('.task-diff-file-row')) {
    const selected = row.dataset.diffPath === state.taskDiff.selectedPath;
    row.dataset.selected = String(selected);
    if (selected) row.setAttribute('aria-current', 'true');
    else row.removeAttribute('aria-current');
  }
}

function taskExactDiffSupported() {
  return state.status?.capabilities?.taskExactDiff === true;
}

function renderTaskDiffScope() {
  for (const button of elements.taskDiffScopeButtons) {
    if (button.dataset.taskDiffScope === 'exact') button.hidden = !taskExactDiffSupported();
    button.setAttribute('aria-pressed', String(button.dataset.taskDiffScope === state.taskDiff.scope));
  }
}

function clearTaskDiffSurface() {
  state.taskDiff.summary = null;
  state.taskDiff.selectedPath = null;
  state.taskDiff.file = null;
  state.taskDiff.collapsed = new Map();
  state.taskDiff.summaryRequest += 1;
  state.taskDiff.fileRequest += 1;
  state.taskDiff.stopped = false;
  elements.taskDiffTree.dataset.signature = '';
  elements.taskDiffTree.innerHTML = '';
  elements.taskDiffFile.dataset.path = '';
  elements.taskDiffFile.dataset.signature = '';
  elements.taskDiffFile.dataset.notice = '';
  elements.taskDiffFile.innerHTML = diffPlaceholderMarkup('Loading changes...');
  elements.taskDiffNotices.dataset.notices = '';
  elements.taskDiffNotices.innerHTML = '';
  elements.taskDiffTotals.textContent = '';
  elements.taskDiffCaptured.textContent = '';
  elements.taskDiffLive.hidden = true;
  setTaskDiffMessage('');
}

function resetTaskDiffView(taskId) {
  stopTaskDiffPolling();
  state.taskDiff.taskId = taskId;
  state.taskDiff.scope = taskExactDiffSupported() ? 'exact' : 'workspace';
  state.taskDiff.stopped = false;
  clearTaskDiffSurface();
  renderTaskDiffScope();
}

function selectTaskDiffScope(scope) {
  if (scope === 'exact' && !taskExactDiffSupported()) return;
  if (!['exact', 'workspace'].includes(scope) || state.taskDiff.scope === scope) return;
  state.taskDiff.scope = scope;
  state.taskDiff.stopped = false;
  clearTaskDiffSurface();
  renderTaskDiffScope();
  refreshTaskDiff().catch(console.error);
}

function renderTaskDiffSummary(summary) {
  const live = taskDiffIsLive();
  elements.taskDiffLive.hidden = !live;
  elements.taskDiffTotals.textContent = summary.available === true ? diffTotalsText(summary) : '';
  // A finished task shows the moment its changes were frozen, never a ticking clock.
  const stamp = live ? summary.capturedAt : summary.endedAt || summary.capturedAt;
  const stampTime = stamp ? formatTime(stamp) : '';
  elements.taskDiffCaptured.textContent = stampTime ? `${live ? 'Updated' : 'Final'} ${stampTime}` : '';
  const noticeKey = diffNoticeTexts(summary).join('|');
  if (elements.taskDiffNotices.dataset.notices !== noticeKey) {
    elements.taskDiffNotices.dataset.notices = noticeKey;
    elements.taskDiffNotices.innerHTML = renderDiffNotices(summary);
  }
}

function renderTaskDiffTree(summary) {
  const signature = String(summary.signature ?? '');
  if (elements.taskDiffTree.dataset.signature === signature) return false;
  rememberTaskDiffCollapse();
  const scrollTop = elements.taskDiffTree.scrollTop;
  elements.taskDiffTree.dataset.signature = signature;
  elements.taskDiffTree.innerHTML = renderDiffUnavailable(summary) || renderFileTree(buildFileTree(summary.files), {
    selectedPath: state.taskDiff.selectedPath,
    collapsed: state.taskDiff.collapsed,
  });
  elements.taskDiffTree.scrollTop = scrollTop;
  return true;
}

async function loadTaskDiffFile(path) {
  const taskId = state.taskDiff.taskId;
  if (taskId === null || !path) return;
  const scope = state.taskDiff.scope;
  const sequence = ++state.taskDiff.fileRequest;
  let file;
  try {
    file = await api(`/api/tasks/${taskId}/diff/file?scope=${encodeURIComponent(scope)}&path=${encodeURIComponent(path)}`);
  } catch (error) {
    if (
      sequence !== state.taskDiff.fileRequest
      || state.taskDiff.taskId !== taskId
      || state.taskDiff.scope !== scope
    ) return;
    if (error?.status === 404) {
      /*
       * The file was reverted or renamed away while the task kept working. Only this pane
       * is stale; the task is still there, so the summary poll carries on and the next
       * tree render picks a file that still exists.
       */
      state.taskDiff.selectedPath = null;
      state.taskDiff.file = null;
      elements.taskDiffFile.dataset.path = '';
      elements.taskDiffFile.dataset.signature = '';
      elements.taskDiffFile.dataset.notice = '';
      elements.taskDiffFile.innerHTML = diffPlaceholderMarkup('That file is no longer part of these changes.');
      markTaskDiffSelection();
      return;
    }
    setTaskDiffMessage(error.message);
    return;
  }
  await textSelectionGuard.waitForClear();
  if (
    sequence !== state.taskDiff.fileRequest
    || state.taskDiff.taskId !== taskId
    || state.taskDiff.scope !== scope
    || state.taskDiff.selectedPath !== path
  ) return;
  state.taskDiff.file = file;
  const signature = String(file.signature ?? '');
  if (elements.taskDiffFile.dataset.path === path && elements.taskDiffFile.dataset.signature === signature) return;
  // Only a file the reader is already looking at keeps its scroll position.
  const scrollTop = elements.taskDiffFile.dataset.path === path ? elements.taskDiffFile.scrollTop : 0;
  const summaryEntry = (state.taskDiff.summary?.files || []).find((entry) => entry.path === path) || null;
  elements.taskDiffFile.dataset.path = path;
  elements.taskDiffFile.dataset.signature = signature;
  // Drawing a real diff clears the notice marker, so the same notice returning later is
  // still redrawn instead of leaving a stale file on screen.
  elements.taskDiffFile.dataset.notice = '';
  elements.taskDiffFile.innerHTML = renderFileDiff(file, summaryEntry);
  elements.taskDiffFile.scrollTop = scrollTop;
}

function selectTaskDiffFile(path) {
  if (!path || state.taskDiff.selectedPath === path) return;
  state.taskDiff.selectedPath = path;
  // Moving the highlight in place keeps the reader's focus and scroll where they are.
  markTaskDiffSelection();
  loadTaskDiffFile(path).catch(console.error);
}

async function refreshTaskDiff() {
  const taskId = state.taskDiff.taskId;
  if (taskId === null || state.taskDiff.stopped) return;
  const scope = state.taskDiff.scope;
  const sequence = ++state.taskDiff.summaryRequest;
  let summary;
  try {
    summary = await api(`/api/tasks/${taskId}/diff?scope=${encodeURIComponent(scope)}`);
  } catch (error) {
    if (
      sequence !== state.taskDiff.summaryRequest
      || state.taskDiff.taskId !== taskId
      || state.taskDiff.scope !== scope
    ) return;
    if (error?.status === 404) {
      stopTaskDiffPolling();
      state.taskDiff.stopped = true;
      setTaskDiffMessage('This task is no longer available.');
      return;
    }
    setTaskDiffMessage(error.message);
    return;
  }
  // Browser selections reference concrete nodes, so a poll must never rewrite under one.
  await textSelectionGuard.waitForClear();
  if (
    sequence !== state.taskDiff.summaryRequest
    || state.taskDiff.taskId !== taskId
    || state.taskDiff.scope !== scope
  ) return;
  setTaskDiffMessage('');
  state.taskDiff.summary = summary;
  renderTaskDiffSummary(summary);
  const rewritten = renderTaskDiffTree(summary);
  const unavailable = diffUnavailableText(summary);
  if (unavailable) {
    state.taskDiff.selectedPath = null;
    state.taskDiff.file = null;
    // A live task in a folder git cannot read would otherwise rewrite this line on every
    // tick, so the notice already on screen is recorded and redrawn only when it changes.
    if (elements.taskDiffFile.dataset.notice !== unavailable) {
      elements.taskDiffFile.dataset.path = '';
      elements.taskDiffFile.dataset.signature = '';
      elements.taskDiffFile.dataset.notice = unavailable;
      elements.taskDiffFile.innerHTML = diffPlaceholderMarkup(unavailable);
    }
  } else if (rewritten || !state.taskDiff.selectedPath) {
    // An unchanged summary signature means nothing moved, so nothing is refetched.
    const paths = new Set((summary.files || []).map((entry) => entry.path));
    if (state.taskDiff.selectedPath && !paths.has(state.taskDiff.selectedPath)) state.taskDiff.selectedPath = null;
    if (!state.taskDiff.selectedPath) {
      state.taskDiff.selectedPath = elements.taskDiffTree.querySelector('.task-diff-file-row')?.dataset.diffPath || null;
      markTaskDiffSelection();
    }
    if (state.taskDiff.selectedPath) await loadTaskDiffFile(state.taskDiff.selectedPath);
  }
  // The task ended between ticks: this pass was the final look, so the loop retires.
  if (!taskDiffIsLive()) stopTaskDiffPolling();
}

function taskDiffPollTick() {
  if (document.visibilityState !== 'visible') return;
  refreshTaskDiff().catch(console.error);
}

function startTaskDiffPolling() {
  stopTaskDiffPolling();
  if (!taskDiffIsLive()) return;
  state.taskDiff.pollTimer = window.setInterval(taskDiffPollTick, TASK_DIFF_POLL_MS);
}

function openTaskDiffModal(task) {
  if (!task) return;
  if (state.taskDiff.taskId !== task.id) resetTaskDiffView(task.id);
  elements.taskDiffSubtitle.textContent = `Task ${String(task.id).padStart(3, '0')} · ${workspaceName(task.repo_path)}`;
  if (!elements.taskDiffModal.open) elements.taskDiffModal.showModal();
  startTaskDiffPolling();
  refreshTaskDiff().catch(console.error);
}

function closeTaskDiffModal() {
  if (elements.taskDiffModal.open) elements.taskDiffModal.close();
  else stopTaskDiffPolling();
}

function planStatusLabel(status, plan = null, task = null) {
  const author = providerLabel(plan?.author?.provider || task?.author_provider || 'claude');
  const reviewer = providerLabel(plan?.reviewer?.provider || task?.reviewer_provider || 'codex');
  const labels = {
    drafting: `${author} drafting`,
    reviewing: `${reviewer} reviewing`,
    revising: `${author} revising`,
    complete: 'Complete',
    failed: 'Failed',
    cancelled: 'Cancelled',
    interrupted: 'Interrupted',
    queued: 'Queued',
    running: 'Starting',
  };
  return labels[status] || 'Preparing';
}

function setDetailCopyContent(content = {}, { resetFeedback = false } = {}) {
  state.detailCopyContent = content;
  if (resetFeedback) {
    for (const timer of state.detailCopyTimers.values()) window.clearTimeout(timer);
    state.detailCopyTimers.clear();
  }
  for (const button of elements.contentCopyButtons) {
    if (resetFeedback) button.textContent = 'Copy';
    button.disabled = !String(content[button.dataset.copyContent] || '').trim();
  }
}

async function copyDetailContent(button) {
  const contentKey = button.dataset.copyContent;
  const text = state.detailCopyContent[contentKey];
  if (!text) return;
  const previousTimer = state.detailCopyTimers.get(contentKey);
  if (previousTimer) window.clearTimeout(previousTimer);
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Copy failed';
  }
  const timer = window.setTimeout(() => {
    if (state.detailCopyTimers.get(contentKey) !== timer) return;
    state.detailCopyTimers.delete(contentKey);
    button.textContent = 'Copy';
  }, 1200);
  state.detailCopyTimers.set(contentKey, timer);
}

// Council stage files live next to the canonical plan.md in the project task folder. A
// record written before stage files existed carries no path, and a stale browser tab can
// hold markup without these rows, so both cases stay silent instead of breaking the panel.
function renderPlanStageArtifact(row, path, filePath) {
  if (!row || !path) return;
  const value = typeof filePath === 'string' ? filePath.trim() : '';
  row.hidden = !value;
  path.textContent = value;
}

function renderPlanPreview(plan, task) {
  elements.planPreview.hidden = false;
  elements.resultSection.hidden = true;
  const status = plan?.status || task.status;
  elements.planStatus.textContent = planStatusLabel(status, plan, task);
  elements.planStatus.dataset.state = status;

  const authorProvider = plan?.author?.provider || task.author_provider || 'claude';
  const reviewerProvider = plan?.reviewer?.provider || task.reviewer_provider || 'codex';
  const stages = plan?.stages || [
    { id: 'draft', label: `${providerLabel(authorProvider)} draft`, provider: authorProvider, status: 'pending' },
    { id: 'review', label: `${providerLabel(reviewerProvider)} review`, provider: reviewerProvider, status: 'pending' },
    { id: 'revision', label: `${providerLabel(authorProvider)} revision`, provider: authorProvider, status: 'pending' },
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
    <span><b>Author</b> ${escapeHtml(providerLabel(author.provider || authorProvider))} · ${escapeHtml(author.model || 'account model')} · ${escapeHtml(author.effort || 'default')}</span>
    <i aria-hidden="true">→</i>
    <span><b>Reviewer</b> ${escapeHtml(providerLabel(reviewer.provider || reviewerProvider))} · ${escapeHtml(reviewer.model || 'account model')} · ${escapeHtml(reviewer.effort || 'default')}</span>
    ${(task.attachments || []).length ? `<span><b>Images</b> ${(task.attachments || []).length} shared references</span>` : ''}
  `;

  const hasDraft = Boolean(plan?.draft);
  const hasReview = Boolean(plan?.review);
  const hasFinal = Boolean(plan?.finalPlan);
  const planArtifactsSupported = state.status?.capabilities?.planArtifacts === true;
  elements.planDraftSection.hidden = !hasDraft;
  elements.planReviewSection.hidden = !hasReview;
  elements.planFinalSection.hidden = !hasFinal;
  const draftLabel = `${providerLabel(author.provider || authorProvider)} draft`;
  const reviewLabel = `${providerLabel(reviewer.provider || reviewerProvider)} review`;
  elements.planDraftSection.querySelector('summary span').textContent = draftLabel;
  elements.planDraftSection.querySelector('.content-copy-button').setAttribute('aria-label', `Copy ${draftLabel}`);
  elements.planReviewSection.querySelector('summary span').textContent = reviewLabel;
  elements.planReviewSection.querySelector('.content-copy-button').setAttribute('aria-label', `Copy ${reviewLabel}`);
  elements.planArtifactRow.hidden = !hasFinal;
  elements.planExecutionPanel.hidden = !hasFinal;
  elements.planDraft.innerHTML = hasDraft ? renderMarkdown(plan.draft) : '';
  elements.planReview.innerHTML = hasReview ? renderMarkdown(plan.review) : '';
  elements.planFinal.innerHTML = hasFinal ? renderMarkdown(plan.finalPlan) : '';
  renderPlanStageArtifact(
    elements.planDraftArtifactRow,
    elements.planDraftArtifactPath,
    hasDraft ? plan?.stageArtifacts?.draft : null,
  );
  renderPlanStageArtifact(
    elements.planReviewArtifactRow,
    elements.planReviewArtifactPath,
    hasReview ? plan?.stageArtifacts?.review : null,
  );
  if (hasFinal) {
    elements.planArtifactPath.textContent = plan.artifactPath || `.data/tasks/${task.id}/plan.md`;
    elements.planArtifactLink.textContent = planArtifactsSupported ? 'Open plan.md' : 'Restart to open';
    elements.planArtifactLink.setAttribute('aria-disabled', String(!planArtifactsSupported));
    if (planArtifactsSupported) {
      elements.planArtifactLink.href = `/api/tasks/${task.id}/plan`;
      elements.planArtifactLink.removeAttribute('title');
    } else {
      elements.planArtifactLink.removeAttribute('href');
      elements.planArtifactLink.title = 'Restart CC Relay to enable the canonical plan file route.';
    }
  } else {
    elements.planArtifactPath.textContent = '';
    elements.planArtifactLink.removeAttribute('href');
    elements.planArtifactLink.removeAttribute('aria-disabled');
  }
  elements.planWaiting.hidden = hasFinal;
  if (!hasFinal) {
    const planError = plan?.error || task.error;
    const authorName = providerLabel(author.provider || authorProvider);
    const reviewerName = providerLabel(reviewer.provider || reviewerProvider);
    elements.planWaiting.textContent = planError || (
      status === 'queued'
        ? `The council is queued. ${authorName} will draft first, then ${reviewerName} will review.`
        : status === 'reviewing'
          ? `${authorName} finished the first draft. ${reviewerName} is reviewing it now.`
          : status === 'revising'
            ? `${reviewerName} finished the review. ${authorName} is producing the final revised plan.`
            : 'The council is preparing the first draft.'
    );
    elements.planWaiting.dataset.state = planError ? 'error' : status;
  }
}

function renderTurboPreview(plan, task) {
  const displayTask = turboPresentationTask(plan ? { ...task, turboPlan: plan } : task);
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
    ? taskUsesSingleExecutorTurbo(displayTask)
      ? 'The planner is building the dependency graph. The complete plan will move to one fresh execution session.'
      : 'The planner is building the dependency graph. Worker packages will appear here when the graph is ready.'
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
      ? { label: `CC Relay ${relayNumber(ownerThread)}`, className: relayColorClass(ownerThread.id) }
      : { label: resolvedWorker?.title || 'Unassigned CC Relay', className: '' };
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

/*
 * The strip is a handful of text and disabled writes over a container with no scroll of
 * its own, so it repaints on every refresh. Only the conversation below it is expensive
 * enough to need a rebuild guard.
 */
function renderSessionStrip(task, active) {
  elements.sessionStrip.hidden = !active;
  if (!active) {
    elements.sessionCompleteButton.dataset.taskId = '';
    elements.sessionKillButton.dataset.taskId = '';
    elements.sessionKillButton.dataset.threadId = '';
    return;
  }
  const manualSession = isManualSessionTask(task);
  const stateKey = sessionTaskState(task);
  const { label, hint } = sessionStateLabel(stateKey);
  elements.sessionStrip.dataset.state = stateKey;
  elements.sessionStrip.dataset.completion = manualSession ? 'manual' : 'automatic';
  elements.sessionStripTitle.textContent = manualSession
    ? 'Terminal session workspace'
    : 'Retained terminal session';
  elements.sessionStripContext.textContent = `${taskRelayLabel(task)} · ${providerLabel(task.provider)} · ${task.model || 'session model'}`;
  elements.sessionModeBadge.hidden = !manualSession;
  elements.sessionStripState.dataset.state = stateKey;
  elements.sessionStripState.textContent = label;
  const thread = taskContinuationSession(task);

  const completeButton = elements.sessionCompleteButton;
  const completing = state.completingSessionTaskId === task.id;
  const completionSupported = state.status?.capabilities?.manualSessionTasks === true;
  const closeCompletionSupported = state.status?.capabilities?.manualSessionTerminalCloseCompletion === true;
  completeButton.dataset.taskId = String(task.id);
  completeButton.hidden = !manualSession;
  completeButton.dataset.state = task.status === 'complete'
    ? 'complete'
    : task.status === 'open'
      ? completing ? 'pending' : 'ready'
      : 'blocked';
  completeButton.textContent = task.status === 'complete'
    ? 'Session complete'
    : completing
      ? 'Completing session'
      : task.status === 'running'
        ? 'Turn in progress'
        : task.status === 'open'
          ? 'Complete session'
          : 'Waiting to open';
  completeButton.disabled = !completionSupported
    || completing
    || task.status !== 'open';
  completeButton.title = !completionSupported
    ? 'Restart CC Relay to complete terminal session tasks here.'
    : task.status === 'complete'
      ? thread
        ? 'This terminal session is complete. Closing its retained terminal is a separate action.'
        : 'This terminal session is complete. Its terminal is closed.'
      : task.status === 'running'
        ? 'Wait for the current turn to finish before completing the session.'
        : task.status === 'open'
          ? thread
            ? 'Mark this task complete. The retained terminal will remain open.'
            : closeCompletionSupported
              ? 'CC Relay will complete this task after it confirms that the terminal is closed.'
              : 'Mark this task complete. This does not relaunch its closed terminal.'
          : 'The session can be completed after its first turn finishes.';

  const supported = state.status?.capabilities?.terminalControl === true;
  const control = thread?.terminalControl || null;
  const closing = state.killingSessionTaskId === task.id;
  const button = elements.sessionKillButton;
  // The handler resolves its target from the button rather than a captured task object:
  // the listener is wired once at startup and outlives every render.
  button.dataset.taskId = String(task.id);
  button.dataset.threadId = thread?.id || '';
  button.hidden = !thread;
  button.textContent = closing ? 'Closing' : 'Close terminal';
  button.setAttribute('aria-label', `Close the retained terminal for task ${task.id}`);

  let closeReason = '';
  if (closing) {
    button.disabled = true;
    closeReason = 'Closing this terminal.';
  } else if (!supported) {
    button.disabled = true;
    closeReason = 'Restart CC Relay to close terminals from here.';
  } else if (!thread) {
    button.disabled = true;
    closeReason = hint;
  } else if (control?.canClose !== true) {
    button.disabled = true;
    closeReason = control?.reason || 'CC Relay does not own this terminal window, so it cannot close it.';
  } else {
    button.disabled = false;
    closeReason = closeCompletionSupported && manualSession && task.status === 'open'
      ? 'Closes the native terminal window and completes this terminal session task.'
      : 'Closes the native terminal window and ends this session.';
  }
  button.title = closeReason;

  const message = elements.sessionStripMessage;
  if (message.dataset.taskId !== String(task.id)) {
    message.dataset.taskId = String(task.id);
    message.dataset.kind = 'hint';
  }
  /*
   * Continue session runs inside the same task row, so a terminal this panel reported
   * closed can come back under a new id. The notice is retired against that new id
   * rather than against the mere presence of a thread: the server can still list the
   * closed one for a poll or two, and the outcome has to survive that.
   */
  if (message.dataset.kind === 'success' && thread && thread.id !== message.dataset.closedThreadId) {
    message.dataset.kind = 'hint';
  }
  if (
    message.dataset.kind === 'success'
    && message.dataset.completionTaskId === String(task.id)
    && task.status !== 'complete'
  ) {
    message.dataset.kind = 'hint';
    message.dataset.completionTaskId = '';
  }
  const stripHint = manualSession
    ? task.status === 'complete'
      ? thread
        ? 'This task is complete. Its terminal stays open until you close it.'
        : 'This task is complete. Its terminal is already closed.'
      : task.status === 'running'
        ? 'The current turn is active. Complete the session after it finishes.'
        : task.status === 'open'
          ? thread
            ? 'Ready for another message. Complete the session only when this workspace is finished.'
            : closeCompletionSupported
              ? 'CC Relay is confirming that the terminal closed and will complete this task automatically.'
              : 'The task is still open. Complete the session now or send a message to relaunch its saved conversation.'
          : 'The terminal workspace will stay open after its first turn.'
    : closeReason;
  // A close outcome has to outlive the periodic refresh. Without this the success or
  // failure text would be replaced by the generic hint before it could be read. The
  // equality check matters just as much: this is a live region, and rewriting the same
  // sentence every two seconds would have a screen reader read it every two seconds.
  if (!['error', 'success'].includes(message.dataset.kind) && message.textContent !== stripHint) {
    message.textContent = stripHint;
  }
}

async function completeTerminalSession() {
  const button = elements.sessionCompleteButton;
  const taskId = Number(button.dataset.taskId);
  if (!Number.isInteger(taskId) || taskId <= 0 || state.completingSessionTaskId) return;
  const task = state.tasks.find((item) => item.id === taskId) || state.selectedTaskForEvents;
  if (!isManualSessionTask(task) || task.status !== 'open') return;
  const terminalWasOpen = Boolean(taskContinuationSession(task));

  const message = elements.sessionStripMessage;
  state.completingSessionTaskId = taskId;
  message.dataset.taskId = String(taskId);
  message.dataset.kind = 'hint';
  message.textContent = 'Completing this terminal session task.';
  renderSessionStrip(task, true);
  try {
    const body = await api(`/api/tasks/${taskId}/complete-session`, { method: 'POST' });
    state.tasks = state.tasks.map((item) => item.id === taskId ? { ...item, ...body.task } : item);
    state.runningTasks = state.runningTasks.filter((item) => item.id !== taskId);
    message.dataset.kind = 'success';
    message.dataset.completionTaskId = String(taskId);
    message.textContent = terminalWasOpen
      ? 'Session completed. The retained terminal remains open until you close it.'
      : 'Session completed. Its terminal was already closed.';
  } catch (error) {
    message.dataset.kind = 'error';
    message.textContent = error.message;
  } finally {
    state.completingSessionTaskId = null;
    await load({ fresh: true }).catch((error) => {
      elements.queueSummary.textContent = error.message;
    });
  }
}

async function killSessionTerminal() {
  const button = elements.sessionKillButton;
  const taskId = Number(button.dataset.taskId);
  const threadId = button.dataset.threadId;
  const message = elements.sessionStripMessage;
  if (!Number.isFinite(taskId) || !taskId || !threadId || state.killingSessionTaskId) return;
  const thread = state.threads.find((item) => item.id === threadId) || null;
  const task = state.tasks.find((item) => item.id === taskId) || state.selectedTaskForEvents;
  const completesTask = state.status?.capabilities?.manualSessionTerminalCloseCompletion === true
    && isManualSessionTask(task)
    && task?.status === 'open';
  message.dataset.taskId = String(taskId);
  if (!thread) {
    message.dataset.kind = 'error';
    message.textContent = completesTask
      ? 'This terminal is no longer connected. CC Relay will complete the task after confirming the closure.'
      : 'This terminal is no longer connected. Continue session relaunches the saved conversation.';
    return;
  }
  if (thread.terminalControl?.canClose !== true) {
    message.dataset.kind = 'error';
    message.textContent = thread.terminalControl?.reason || 'CC Relay does not own this terminal window, so it cannot close it.';
    return;
  }
  const number = String(taskId).padStart(3, '0');
  const confirmation = completesTask
    ? `Close the retained terminal for task #${number}? Closing it also completes this terminal session task.`
    : `Close the retained terminal for task #${number}? The connected session will end; Continue session can relaunch the saved conversation later.`;
  if (!window.confirm(confirmation)) return;
  state.killingSessionTaskId = taskId;
  const pendingTask = state.tasks.find((item) => item.id === taskId) || null;
  if (pendingTask) renderSessionStrip(pendingTask, true);
  try {
    await api(`/api/terminals/${encodeURIComponent(threadId)}`, { method: 'DELETE' });
    state.threads = state.threads.filter((item) => item.id !== threadId);
    if (state.selectedThreadId === threadId) state.selectedThreadId = null;
    message.dataset.kind = 'success';
    message.dataset.closedThreadId = threadId;
    message.textContent = completesTask
      ? `The retained terminal for task #${number} was closed and the session task was completed.`
      : `The retained terminal for task #${number} was closed.`;
    renderThreads();
  } catch (error) {
    message.dataset.kind = 'error';
    message.textContent = error.message;
  } finally {
    state.killingSessionTaskId = null;
    const current = state.tasks.find((item) => item.id === taskId) || null;
    if (current && state.selectedTaskId === taskId) renderSessionStrip(current, isDirectSessionTask(current));
    await loadThreads();
    await load({ fresh: true }).catch(() => {});
  }
}

function sessionDisclosureKey(taskId, turnId, part) {
  return `${taskId}:${turnId}:${part}`;
}

function rememberSessionDisclosures() {
  // Keyed against the task the DOM currently holds, not the one about to replace it.
  const renderedTaskId = elements.sessionHistoryTurns.dataset.taskId;
  if (!renderedTaskId) return;
  for (const details of elements.sessionHistoryTurns.querySelectorAll('details[data-session-part]')) {
    const turn = details.closest('[data-turn-id]');
    if (!turn) continue;
    state.expandedSessionTurns.set(
      sessionDisclosureKey(renderedTaskId, turn.dataset.turnId, details.dataset.sessionPart),
      details.open,
    );
  }
}

function restoreSessionDisclosures(taskId) {
  for (const details of elements.sessionHistoryTurns.querySelectorAll('details[data-session-part]')) {
    const turn = details.closest('[data-turn-id]');
    if (!turn) continue;
    const key = sessionDisclosureKey(taskId, turn.dataset.turnId, details.dataset.sessionPart);
    // A recorded choice always wins, so the newest turn opening by default can never
    // reopen something the user deliberately collapsed.
    if (state.expandedSessionTurns.has(key)) details.open = state.expandedSessionTurns.get(key);
  }
}

/*
 * djb2 over every prompt field a turn is drawn from, folded to 32 bits. Editing a queued
 * session task rewrites the first turn in place, so text length alone cannot see it: a
 * same-length rewrite has to move the signature or the panel keeps showing the old
 * conversation. Folding also keeps the prompt text itself out of the signature string,
 * which the container carries as an attribute on every render.
 */
function sessionTurnContentHash(turns) {
  let hash = 5381;
  for (const turn of turns) {
    const fields = `${turn.id}\u0000${turn.prompt.created_at || ''}\u0000${turn.prompt.text}\u0001`;
    for (let index = 0; index < fields.length; index += 1) {
      // Shift form, not hash * 33: the multiply loses precision past 2^53 before the
      // xor coerces, while << and ^ both keep the fold inside int32.
      hash = ((hash << 5) + hash) ^ fields.charCodeAt(index);
    }
  }
  return (hash >>> 0).toString(36);
}

/*
 * The panel re-renders every two seconds. A signature over everything the markup depends
 * on keeps the rebuild out of the common case, where nothing about the conversation
 * changed and a fresh innerHTML would only reset scroll and collapse open turns.
 *
 * Terminal state is deliberately absent. No part of a turn is drawn from it, and the
 * four-second thread poll flips a running session between busy and idle repeatedly:
 * signing on it would rebuild the transcript under the reader for no visible gain.
 */
function sessionHistorySignature(task, turns) {
  const newest = turns.at(-1) || null;
  return [
    task.id,
    task.status,
    turns.length,
    turns.reduce((total, turn) => total + turn.responses.length, 0),
    (newest?.finalResponse || '').length,
    newest?.pending ? 'pending' : 'settled',
    // PATCH /api/tasks/:id edits a queued session task: task.prompt is rebuilt into the
    // first turn and the provider that names every response can switch, while the id,
    // the status and both counts above stay exactly as they were.
    taskProvider(task),
    sessionTurnContentHash(turns),
  ].join('|');
}

function sessionTurnMarkup(turn, responseLabel, newest) {
  const number = String(turn.index + 1).padStart(2, '0');
  const promptText = turn.prompt.text;
  const promptPreview = compactText(promptText, 200);
  // Equal preview means the collapsed form loses nothing, so short prompts skip the
  // disclosure entirely instead of hiding two lines behind a click.
  const promptExpandable = promptPreview !== promptText;
  const time = formatTime(turn.prompt.created_at);
  const earlier = turn.responses.slice(0, -1);
  const responseBlock = turn.pending
    ? `<p class="session-turn-pending" data-pending="true"><i aria-hidden="true"></i>Working on a response</p>`
    : turn.finalResponse
      ? `
        <details class="session-turn-response" data-session-part="response"${newest ? ' open' : ''}>
          <summary>
            <span class="session-turn-response-label">${escapeHtml(responseLabel)}</span>
            <span class="session-turn-response-preview">${escapeHtml(compactText(markdownPreviewText(turn.finalResponse), 96))}</span>
            <i>View</i>
          </summary>
          ${earlier.length ? `
            <details class="session-turn-earlier" data-session-part="earlier">
              <summary>${earlier.length} earlier message${earlier.length === 1 ? '' : 's'} during this turn</summary>
              ${earlier.map((response) => `<pre>${escapeHtml(response.text)}</pre>`).join('')}
            </details>
          ` : ''}
          <div class="markdown-document compact session-turn-markdown">${renderMarkdown(turn.finalResponse)}</div>
        </details>
      `
      : '<p class="session-turn-empty">No response recorded.</p>';
  return `
    <article class="session-turn" data-turn-id="${escapeHtml(turn.id)}">
      <div class="session-turn-header">
        <span class="session-turn-number">${number}</span>
        <strong>You</strong>
        ${time ? `<time datetime="${escapeHtml(turn.prompt.created_at)}">${escapeHtml(time)}</time>` : ''}
      </div>
      ${promptExpandable
        ? `
          <details class="session-turn-prompt" data-session-part="prompt">
            <summary><span>${escapeHtml(promptPreview)}</span><i>Full prompt</i></summary>
            <pre>${escapeHtml(promptText)}</pre>
          </details>
        `
        : `<pre class="session-turn-prompt-text">${escapeHtml(promptText)}</pre>`}
      ${responseBlock}
    </article>
  `;
}

function renderSessionHistory(task, turns, active) {
  elements.sessionHistory.hidden = !active;
  const container = elements.sessionHistoryTurns;
  if (!active) {
    if (container.dataset.taskId) {
      container.dataset.taskId = '';
      container.dataset.signature = '';
      container.replaceChildren();
      state.expandedSessionTurns.clear();
    }
    return;
  }
  elements.sessionHistoryCount.textContent = sessionHistoryCountLabel(turns);
  const signature = sessionHistorySignature(task, turns);
  const sameTask = container.dataset.taskId === String(task.id);
  if (sameTask && container.dataset.signature === signature) return;
  if (sameTask) rememberSessionDisclosures();
  else state.expandedSessionTurns.clear();
  const responseLabel = providerLabel(taskProvider(task));
  container.dataset.taskId = String(task.id);
  container.dataset.signature = signature;
  container.innerHTML = turns.length
    ? turns.map((turn, index) => sessionTurnMarkup(turn, responseLabel, index === turns.length - 1)).join('')
    : '<p class="session-history-empty">No conversation recorded for this session yet.</p>';
  restoreSessionDisclosures(task.id);
}

function taskDetailSnapshotSignature(task) {
  if (!task) return '';
  return JSON.stringify(task, (key, value) => key === 'latest_event_id' ? undefined : value);
}

async function selectTask(taskId, { openOriginal = true } = {}) {
  const requestSequence = ++state.taskLoadSequence;
  const eventTaskChanged = state.eventTaskId !== taskId;
  if (eventTaskChanged) {
    state.terminalMode = 'native';
    state.inlineEventFilter = 'all';
    state.eventFilter = 'all';
    setTerminalWindowView('all', { persist: false, render: false });
  }
  state.selectedTaskId = taskId;
  // Polling refreshes the selected task periodically. Clearing clipboard state on
  // every pass made the buttons visibly blink and briefly impossible to click. Only a
  // real task change may invalidate the previous task's payload and feedback.
  if (eventTaskChanged) setDetailCopyContent({}, { resetFeedback: true });
  renderTasks();
  if (eventTaskChanged) {
    elements.continuationForm.hidden = true;
    elements.continuationInput.disabled = true;
  }
  const {
    task,
    events,
    prompts = [],
    // An older backend answers without responses at all. buildSessionTurns falls back to
    // the task row rather than showing a conversation with no answers in it.
    responses,
    eventRevision,
    plan = null,
    turboPlan = null,
  } = await api(`/api/tasks/${taskId}`);
  await textSelectionGuard.waitForClear();
  if (requestSequence !== state.taskLoadSequence || state.selectedTaskId !== taskId) return;
  const sessionSurface = isDirectSessionTask(task);
  const manualSessionSurface = isManualSessionTask(task);
  const reviewPending = task.ready_for_review === true
    || state.projectCompletionNotifications.includes(task.repo_path, task.id);
  if (reviewPending) {
    try {
      const review = await api(`/api/tasks/${task.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ finishedAt: task.finished_at ?? null }),
      });
      if (review.task) {
        Object.assign(task, review.task);
        const snapshotTask = state.tasks.find((item) => item.id === task.id);
        if (snapshotTask) Object.assign(snapshotTask, review.task);
      }
      if (
        review.task?.ready_for_review !== true
        && state.projectCompletionNotifications.acknowledge(task)
      ) {
        renderProjects();
        renderTasks();
      }
    } catch (error) {
      console.warn(`Could not mark task ${task.id} as reviewed.`, error);
    }
    if (requestSequence !== state.taskLoadSequence || state.selectedTaskId !== taskId) return;
  }
  elements.emptyDetail.hidden = true;
  elements.taskDetail.hidden = false;
  applyTerminalHeight();
  const taskNumber = String(task.id).padStart(3, '0');
  const taskTitle = `Task ${taskNumber}`;
  const detailButtonLabel = task.mode === 'plan' ? 'Council details' : manualSessionSurface ? 'Session details' : 'Full details';
  elements.taskDetail.dataset.sessionMode = String(manualSessionSurface);
  elements.detailTitle.textContent = taskTitle;
  const detailStatus = document.querySelector('#detail-status');
  detailStatus.className = `task-status status-${task.status}`;
  detailStatus.textContent = task.status;
  elements.detailTaskName.textContent = taskInspectorDefinition(task);
  elements.detailTaskName.title = taskInspectorDefinition(task);
  elements.detailExecutionProfile.innerHTML = `
    <span class="detail-agent">
      ${agentBadgeMarkup(task, 'detail-agent-icon')}
      ${escapeHtml(providerLabel(taskProvider(task)))}
    </span>
    <strong>${escapeHtml(executionLabel(task))}</strong>
    <span>· ${escapeHtml(workspaceName(task.repo_path))}</span>
    <span>· ${task.started_at ? 'started' : 'created'} ${escapeHtml(formatCardTime(task.started_at || task.created_at))}</span>
  `;
  elements.taskDetailModalTitle.textContent = taskTitle;
  elements.taskDetailModalSubtitle.textContent = `${providerLabel(taskProvider(task))} · ${executionLabel(task)} · ${workspaceName(task.repo_path)} · ${task.status}`;
  elements.taskDetailOpen.textContent = detailButtonLabel;
  elements.taskDetailOpen.setAttribute('aria-label', `Open ${detailButtonLabel.toLowerCase()} for task ${taskNumber}`);
  elements.detailMeta.innerHTML = `
    <span class="task-status status-${escapeHtml(task.status)}">${escapeHtml(task.status)}</span>
    <span>${escapeHtml(workspaceName(task.repo_path))}</span>
    <span class="detail-created-date"><small>Created</small><time datetime="${escapeHtml(task.created_at)}">${escapeHtml(formatTime(task.created_at))}</time></span>
    <span class="detail-lifecycle-dates">${taskLifecycleDatesMarkup(task, formatTime)}</span>
    ${task.continued_from_task_id ? `<span class="detail-continuation-link">Continues Task #${task.continued_from_task_id}</span>` : ''}
  `;
  const promptHistory = normalizeTaskPrompts(task, prompts);
  const promptHistoryContent = taskPromptHistoryText(promptHistory);
  elements.detailPrompt.textContent = promptHistoryContent;
  elements.detailPromptPreview.textContent = taskPromptHistoryPreview(promptHistory);
  // The conversation replaces the flat Prompts and Result disclosures for a session task.
  // Assigned, never conditionally hidden: nothing else in the panel unhides Prompts, so a
  // one-way hide would follow the user to the next ordinary task they open.
  elements.promptSection.hidden = sessionSurface;
  const sessionTurns = sessionSurface
    ? buildSessionTurns({ task, prompts: promptHistory, responses })
    : [];
  const attachments = task.attachments || [];
  elements.detailAttachmentsSection.hidden = attachments.length === 0;
  elements.detailAttachmentsCount.textContent = `${attachments.length} image${attachments.length === 1 ? '' : 's'}`;
  elements.detailAttachments.innerHTML = attachments.map((attachment, index) => `
    <a href="/api/tasks/${task.id}/attachments/${encodeURIComponent(attachment.id)}" target="_blank" rel="noreferrer" class="detail-attachment">
      <img src="/api/tasks/${task.id}/attachments/${encodeURIComponent(attachment.id)}" alt="${escapeHtml(attachment.name)}" loading="lazy">
      <span><b>${String(index + 1).padStart(2, '0')}</b><strong>${escapeHtml(attachment.name)}</strong><small>${escapeHtml(formatBytes(attachment.size))}</small></span>
    </a>
  `).join('');
  const resultContent = task.result || task.error || `Waiting for ${providerLabel(taskProvider(task))} to finish this task.`;
  elements.detailResult.innerHTML = renderMarkdown(resultContent);
  elements.detailResultPreview.textContent = task.result
    ? compactText(markdownPreviewText(task.result), 96)
    : task.error ? compactText(task.error, 96) : `${task.status} · response pending`;
  elements.detailResult.dataset.empty = task.result || task.error ? 'false' : 'true';
  setDetailCopyContent({
    prompt: taskPromptCopyText(promptHistory),
    result: task.result || task.error || '',
    // Registered before the history render decides whether to rebuild the DOM: a skipped
    // rebuild must never leave the Copy conversation button disabled.
    conversation: sessionSurface
      ? sessionConversationText(sessionTurns, { responseLabel: providerLabel(taskProvider(task)) })
      : '',
    planDraft: plan?.draft || '',
    planReview: plan?.review || '',
    planFinal: plan?.finalPlan || '',
  });
  if (promptHistory.length > 1) {
    elements.promptSection.open = true;
  }
  if (eventTaskChanged) {
    elements.promptSection.open = promptHistory.length > 1;
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
    elements.resultSection.hidden = sessionSurface;
  }
  renderSessionStrip(task, sessionSurface);
  renderSessionHistory(task, sessionTurns, sessionSurface);
  elements.detailActions.replaceChildren();
  // The dialog belongs to one task. Selecting another closes it rather than silently
  // leaving a diff on screen that describes work the reader is no longer looking at.
  if (state.taskDiff.taskId !== null && state.taskDiff.taskId !== task.id) closeTaskDiffModal();
  const retentionFeedback = task.status === 'running'
    ? state.terminalRetentionFeedback.get(task.id) || null
    : null;
  elements.terminalRetentionMessage.hidden = !retentionFeedback;
  elements.terminalRetentionMessage.textContent = retentionFeedback?.message || '';
  elements.terminalRetentionMessage.dataset.kind = retentionFeedback?.kind || '';

  if (task.status === 'queued' && task.mode !== 'breakdown') {
    const editButton = actionButton('Edit', () => openTaskEditor(task), 'quiet');
    const editingSupported = state.status?.capabilities?.queuedTaskEditing === true;
    const namedTaskNeedsCurrentBackend = taskHasCustomName(task) && !taskNamingSupported();
    const preparing = state.status?.planningTaskIds?.includes(task.id);
    editButton.disabled = !editingSupported || preparing || namedTaskNeedsCurrentBackend;
    editButton.title = !editingSupported
      ? 'Restart CC Relay to edit queued tasks.'
      : namedTaskNeedsCurrentBackend
        ? 'Restart CC Relay to edit this named task without losing its name.'
        : preparing ? 'This task is already being prepared. Cancel it before editing.' : '';
    elements.detailActions.append(editButton);
  }
  if (
    task.status === 'running'
    && task.terminal_lifecycle === 'disposable'
    && task.provider !== 'opencode'
  ) {
    const retentionSupported = state.status?.capabilities?.liveTerminalRetention === true;
    const retentionEnabled = task.keep_terminal_open === true;
    const retentionPending = state.terminalRetentionSavingTaskIds.has(task.id);
    const retentionTarget = ['plan', 'turbo'].includes(task.mode) ? 'terminals' : 'terminal';
    const label = retentionEnabled
      ? 'Auto-close stopped'
      : retentionPending
        ? 'Stopping auto-close...'
        : retentionSupported
          ? 'Stop auto-close'
          : 'Restart to stop auto-close';
    const retentionButton = actionButton(
      label,
      () => keepRunningTaskTerminalOpen(task),
      'terminal-retention-button',
    );
    retentionButton.dataset.terminalRetention = String(task.id);
    retentionButton.dataset.state = retentionEnabled
      ? 'protected'
      : retentionPending
        ? 'pending'
        : retentionSupported
          ? 'available'
          : 'unsupported';
    retentionButton.setAttribute('aria-pressed', String(retentionEnabled));
    retentionButton.disabled = retentionEnabled || retentionPending || !retentionSupported;
    retentionButton.title = retentionEnabled
      ? `Automatic close is stopped for this run. The task ${retentionTarget} will stay open.`
      : retentionSupported
        ? 'Keep every terminal launched for this task open after the run.'
        : 'Restart CC Relay to stop terminal auto-close during a run.';
    elements.detailActions.append(retentionButton);
  }
  /*
   * A null diffState is a legacy task or a task whose baseline never started, and a
   * backend without the capability cannot answer the endpoint at all. Both hide the
   * action outright instead of offering a button that can only disappoint.
   */
  if (
    state.status?.capabilities?.taskDiffPreview === true
    && task.diffState
    && (task.diffState?.baseline || task.diffState?.error)
  ) {
    const changesButton = actionButton('Changes', () => openTaskDiffModal(task), 'quiet');
    changesButton.setAttribute('aria-haspopup', 'dialog');
    changesButton.setAttribute('aria-controls', 'task-diff-modal');
    // The close handler finds the current trigger through this marker. The node itself is
    // replaced every two seconds, so it can never be held as a reference.
    changesButton.dataset.taskDiffTrigger = String(task.id);
    changesButton.title = 'Show the files this task changed.';
    elements.detailActions.append(changesButton);
  }
  if (task.status === 'queued' || task.status === 'running') {
    const cancelLabel = manualSessionSurface && task.status === 'running' ? 'Stop turn' : 'Cancel';
    elements.detailActions.append(actionButton(cancelLabel, () => taskAction(task.id, 'cancel'), 'danger'));
  }
  if (['failed', 'cancelled', 'interrupted'].includes(task.status) && !isFailedSessionFollowUp(task)) {
    const configurableRetry = state.status?.capabilities?.retryTaskExecutionSettings === true
      && task.mode === 'execute'
      && task.terminal_lifecycle === 'disposable';
    const retryTarget = task.mode === 'plan' && task.terminal_lifecycle !== 'disposable'
      ? selectedPlanReviewThread(task)
      : null;
    const retryLabel = retryTarget ? `Resume on CC Relay ${relayNumber(retryTarget)}` : task.mode === 'plan' ? 'Resume council' : 'Retry';
    const retryButton = actionButton(
      retryLabel,
      () => {
        if (configurableRetry) return openTaskRetryEditor(task);
        const currentTarget = task.mode === 'plan' && task.terminal_lifecycle !== 'disposable'
          ? selectedPlanReviewThread(task)
          : null;
        const authorTarget = task.mode === 'plan'
          && task.terminal_lifecycle !== 'disposable'
          && isPlanCouncilTerminalExecutionEnabled()
          ? selectedPlanClaudeAuthorThread()
          : null;
        const retryAssignment = currentTarget || authorTarget
          ? {
            ...(currentTarget ? { threadId: currentTarget.id } : {}),
            ...(authorTarget ? { authorThreadId: authorTarget.id } : {}),
          }
          : null;
        return taskAction(task.id, 'retry', retryAssignment);
      },
      'primary',
    );
    if (task.mode === 'plan') retryButton.dataset.planRetry = String(task.id);
    elements.detailActions.append(retryButton);
  }
  if (task.status === 'complete' && task.mode === 'plan') {
    const executeButton = actionButton('Execute plan', revealPlanExecution, 'primary');
    executeButton.dataset.planExecutionShortcut = String(task.id);
    elements.detailActions.append(executeButton);
  }
  if (task.status !== 'running' && !(manualSessionSurface && task.status === 'open')) {
    elements.detailActions.append(actionButton('Delete', () => deleteTask(task.id), 'danger quiet'));
  }
  refreshPlanTaskActions(task);

  state.eventTaskId = taskId;
  const resolvedEventRevision = Number(eventRevision ?? events.at(-1)?.id ?? 0);
  state.selectedTaskEventRevision = Number.isFinite(resolvedEventRevision)
    ? resolvedEventRevision
    : 0;
  state.selectedTaskSnapshotSignature = taskDetailSnapshotSignature(
    state.tasks.find((item) => item.id === taskId) || task,
  );
  renderTaskContinuation(task, { taskChanged: eventTaskChanged });
  renderEventStream(events, task, {
    forceBottom: eventTaskChanged,
    resetDisclosures: eventTaskChanged,
    prompts: promptHistory,
  });
  if (openOriginal && nativeTerminalViewIsActive()) void refreshNativeTerminalScreen();
}

async function loadSnapshot() {
  const statusPath = state.activeProjectPath
    ? `/api/status?projectPath=${encodeURIComponent(state.activeProjectPath)}`
    : '/api/status';
  const [statusBody, tasksBody] = await Promise.all([
    api(statusPath),
    api('/api/tasks'),
  ]);
  // Browser selections reference concrete DOM nodes. Hold background rendering while a
  // user is selecting or copying so the periodic snapshot cannot replace those nodes.
  await textSelectionGuard.waitForClear();
  const previousOpenCodeCheck = state.status?.opencode?.checkedAt || null;
  state.status = statusBody;
  adoptVoiceInputStatus(statusBody.voiceInput);
  if (
    statusBody.opencode?.checkedAt
    && statusBody.opencode.checkedAt !== previousOpenCodeCheck
  ) {
    void loadModels('opencode');
  }
  reconcileProviderSelection();
  state.tasks = tasksBody.tasks;
  const runningRetentionTaskIds = new Set(state.tasks
    .filter((task) => task.status === 'running')
    .map((task) => task.id));
  for (const taskId of state.terminalRetentionFeedback.keys()) {
    if (!runningRetentionTaskIds.has(taskId)) state.terminalRetentionFeedback.delete(taskId);
  }
  const completedTasks = state.projectCompletionNotifications.observe(state.tasks, {
    activeProjectPath: state.activeProjectPath,
    selectedTaskId: state.selectedTaskId,
  });
  completedTasks.forEach((task, index) => {
    window.setTimeout(() => {
      state.completionAlerts.notify(task, state.completionAlertPreferences);
    }, index * 650);
  });
  state.runningTasks = taskMonitorTasks(
    statusBody.monitoredTasks || statusBody.runningTasks,
    state.tasks,
  );
  await loadProjects();
  hydrateThreadExecutionSettings(state, state.tasks);
  renderProviderTabs();
  renderExecutionControls();
  // A cached active project can skip selectProject's mode render during startup.
  // Refresh the automatic controls after capabilities and project limits are known.
  if (usesDisposableTerminalPools()) renderAutomaticTerminalPool();
  const launcherEnabled = state.status?.capabilities?.projectLauncher === true;
  elements.launchCodexButton.disabled = !launcherEnabled || providerIsMissing('codex');
  elements.launchClaudeButton.disabled = !launcherEnabled || providerIsMissing('claude');
  renderTerminalCloseControl();

  /*
   * Several tasks can run at once. Keep whatever the user is inspecting; only when that
   * selection is gone fall back to the most recently started running task, so a refresh
   * cannot swing the activity panel between concurrent runs.
   */
  const scopedTasks = projectTasks();
  const selectedTaskStillExists = state.selectedTaskId
    && scopedTasks.some((task) => task.id === state.selectedTaskId);
  if (!selectedTaskStillExists) {
    state.selectedTaskId = mostRecentlyStartedRunningTask(scopedTasks)?.id || null;
  }

  if (!state.selectedTaskId) {
    hideTaskDetailPanel();
  }

  renderStatus();
  renderTasks();
  renderPlanControls();
  renderTurboControls();
  renderAttachmentComposer();
  renderTaskReferences();
  updateSubmitState();
  if (state.selectedTaskId) {
    const selectedSummary = state.tasks.find((task) => task.id === state.selectedTaskId) || null;
    const supportsEventRevision = Object.hasOwn(selectedSummary || {}, 'latest_event_id');
    const summaryRevision = Number(selectedSummary?.latest_event_id || 0);
    const summarySignature = taskDetailSnapshotSignature(selectedSummary);
    const detailIsCurrent = supportsEventRevision
      && state.eventTaskId === state.selectedTaskId
      && Number(state.selectedTaskEventRevision || 0) >= summaryRevision
      && state.selectedTaskSnapshotSignature === summarySignature;
    if (!detailIsCurrent) await selectTask(state.selectedTaskId, { openOriginal: false });
  }
}

/*
 * Concurrent refresh requests are deduplicated. A caller that has just written to the
 * server passes fresh: true: joining an in-flight snapshot that was requested before the
 * write returns pre-write data, which is how a newly created task could vanish from the
 * list and lose its selection immediately after being added.
 */
async function load({ fresh = false } = {}) {
  if (!fresh && state.loadPromise) {
    return state.loadPromise;
  }
  const previous = state.loadPromise;
  const pending = (async () => {
    if (previous) await previous.catch(() => {});
    return loadSnapshot();
  })();
  state.loadPromise = pending;
  try {
    return await pending;
  } finally {
    if (state.loadPromise === pending) state.loadPromise = null;
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
    renderProviderTabs();
    renderPromptCopy();
    renderAttachmentComposer();
    loadModels(provider);
  }
  state.selectedThreadId = threadId;
  renderExecutionControls();
  if (state.selectedTaskId && !projectTasks().some((task) => task.id === state.selectedTaskId)) {
    state.selectedTaskId = null;
    hideTaskDetailPanel();
  }
  elements.threadInput.value = threadId || '';
  for (const option of elements.terminalList.querySelectorAll('.terminal-option')) {
    const selected = option.dataset.threadId === threadId;
    option.classList.toggle('selected', selected);
    option.setAttribute('aria-checked', String(selected));
  }
  renderStatus();
  renderTasks();
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
    elements.formMessage.textContent = control?.reason || 'This terminal cannot be closed from CC Relay.';
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
  if (usesDisposableTerminalPools() && providerIsMissing(provider)) {
    elements.formMessage.textContent = `Install the ${providerLabel(provider)} CLI and CC Relay will enable it automatically.`;
    return;
  }
  const councilClosed = isExecuteCouncilEnabled() && provider !== 'codex';
  if (councilClosed) {
    state.planSettings.enabled = false;
  }
  if (provider === state.selectedProvider) {
    return;
  }
  state.selectedProvider = provider;
  state.selectedThreadId = null;
  renderProviderTabs();
  renderExecutionControls();
  renderPlanControls();
  renderPromptCopy();
  renderAttachmentComposer();
  renderThreads();
  loadModels(provider);
  if (councilClosed) {
    elements.formMessage.textContent = `Plan council turned off. ${providerLabel(provider)} selected for direct execution.`;
  }
  if (focus) {
    document.querySelector(`#provider-${provider}`)?.focus();
  }
}

// The terminal settings dialog no longer shows a launch command, so its header always describes the
// project whose window layout and completion alerts are being edited.
function renderTerminalSettingsHeader() {
  const project = activeProject();
  elements.connectionHelpTitle.textContent = 'Terminal settings';
  document.querySelector('#terminal-settings-project').textContent = project ? `Project · ${project.name}` : 'Project settings';
  elements.connectionHelpCopy.textContent = project
    ? 'Window layout, completion alerts, and composer quick actions.'
    : 'Choose a pinned project before changing terminal settings.';
}

function renderAutomaticTerminalPool() {
  const project = activeProject();
  const limits = projectInstanceLimits(project);
  const terminalPool = state.status?.terminalPool;
  const active = terminalPool
    && project
    && sameProjectPath(terminalPool.repoPath, project.path)
    ? terminalPool.active || {}
    : {};
  elements.terminalPoolControls.hidden = false;
  elements.keepTerminalOpenOption.hidden = false;
  elements.legacyTerminalControls.hidden = true;
  elements.legacyTerminalLaunchButtons.hidden = true;
  elements.terminalLegend.textContent = 'Automatic terminals';
  renderTerminalSettingsHeader();
  if (!state.submitting) state.selectedThreadId = null;
  elements.threadInput.value = '';

  if (document.activeElement !== elements.maxCodexInstances) {
    elements.maxCodexInstances.value = String(limits.codex);
  }
  if (document.activeElement !== elements.maxClaudeInstances) {
    elements.maxClaudeInstances.value = String(limits.claude);
  }
  if (document.activeElement !== elements.maxOpenCodeInstances) {
    elements.maxOpenCodeInstances.value = String(limits.opencode);
  }
  elements.maxCodexInstances.disabled = !project || state.poolLimitSaving;
  elements.maxClaudeInstances.disabled = !project || state.poolLimitSaving;
  elements.maxOpenCodeInstances.disabled = !project || state.poolLimitSaving;
  const retentionSupported = state.status?.capabilities?.retainedTerminalSessions === true;
  const manualSessionsSupported = state.status?.capabilities?.manualSessionTasks === true;
  const closeCompletionSupported = state.status?.capabilities?.manualSessionTerminalCloseCompletion === true;
  const directSessionMode = state.taskMode === 'execute' && !isExecuteCouncilEnabled();
  const headlessOpenCode = directSessionMode && state.selectedProvider === 'opencode';
  elements.keepTerminalOpen.checked = headlessOpenCode ? false : state.keepTerminalOpen;
  elements.keepTerminalOpen.disabled = !project
    || !retentionSupported
    || headlessOpenCode
    || state.submitting
    || state.projectSettingsSaving;
  elements.keepTerminalOpenOption.dataset.intent = directSessionMode ? 'session' : 'retention';
  elements.keepTerminalOpenOption.dataset.active = String(!headlessOpenCode && state.keepTerminalOpen);
  elements.keepTerminalOpenOption.querySelector('strong').textContent = directSessionMode
    ? 'Terminal session mode'
    : 'Keep workflow terminals open';
  elements.keepTerminalOpenHelp.textContent = headlessOpenCode
    ? 'OpenCode runs headlessly, so there is no terminal window to retain. Its native session ID is still recorded with the task.'
    : retentionSupported
    ? directSessionMode
      ? manualSessionsSupported
        ? closeCompletionSupported
          ? `Direct tasks in ${project?.name || 'this project'} stay open between turns. Press Complete session to finish while keeping the terminal, or close the terminal to finish both. This setting is not shared with other projects.`
          : `Direct tasks in ${project?.name || 'this project'} stay open between turns and complete only when you press Complete session in Task activity. Their terminal stays open too. This setting is not shared with other projects.`
        : 'Restart CC Relay to keep direct tasks open for manual completion. Terminal retention still works with this backend.'
      : `This workflow completes automatically, but its terminals stay connected afterward and after CC Relay exits. This setting is not shared with other projects.`
    : 'Restart CC Relay to enable retained terminal sessions.';
  elements.terminalPoolControls.textContent = headlessOpenCode
    ? 'CC Relay starts OpenCode directly, streams its native progress and token usage, then releases this execution slot.'
    : state.keepTerminalOpen
    ? directSessionMode && manualSessionsSupported
      ? closeCompletionSupported
        ? 'Session mode opens a dedicated terminal workspace. Send as many turns as needed, then finish explicitly or close its terminal.'
        : 'Session mode opens a dedicated terminal workspace. Send as many turns as needed, then finish the task manually.'
      : 'CC Relay keeps the workflow terminals open after the automatic task outcome.'
    : state.taskMode === 'turbo' && usesSingleExecutorTurbo()
      ? 'Turbo opens a fresh planner, closes it after planning, then opens one fresh executor for the complete plan. The executor conversation remains resumable.'
      : 'CC Relay opens a fresh terminal per task and closes it when the task ends. Continue session relaunches the saved conversation.';
  setProjectTerminalSettingsDisabled(!project || state.projectSettingsSaving);
  if (providerIsMissing('codex')) elements.maxCodexInstances.disabled = true;
  if (providerIsMissing('claude')) elements.maxClaudeInstances.disabled = true;
  if (providerIsMissing('opencode')) elements.maxOpenCodeInstances.disabled = true;
  elements.codexPoolUsage.textContent = `${Number(active.codex || 0)}/${limits.codex}`;
  elements.claudePoolUsage.textContent = `${Number(active.claude || 0)}/${limits.claude}`;
  elements.openCodePoolUsage.textContent = `${Number(active.opencode || 0)}/${limits.opencode}`;
  document.querySelector('#agent-pool-summary').textContent = `${['codex', 'claude', 'opencode'].reduce((sum, provider) => sum + Number(active[provider] || 0), 0)} of ${limits.codex + limits.claude + limits.opencode} slots active`;

  if (!project) {
    elements.sessionMessage.textContent = 'Choose a pinned project to configure its automatic terminal instances.';
  } else if (state.taskMode === 'turbo') {
    elements.sessionMessage.textContent = usesSingleExecutorTurbo()
      ? `Turbo uses one fresh planner and one fresh executor per prompt in ${project.name}, with up to ${state.turboSettings.workerCount} planned executions running concurrently.`
      : `Turbo will launch one planner plus ${state.turboSettings.workerCount} disposable Codex workers in ${project.name}.`;
  } else if (isExecuteCouncilEnabled()) {
    elements.sessionMessage.textContent = `Plan council will launch one Claude and one Codex terminal in ${project.name}.`;
  } else if (headlessOpenCode) {
    elements.sessionMessage.textContent = `New OpenCode tasks run as headless native sessions in ${project.name}.`;
  } else {
    elements.sessionMessage.textContent = state.keepTerminalOpen && manualSessionsSupported
      ? `New ${providerLabel(state.selectedProvider)} tasks open persistent terminal workspaces in ${project.name}.`
      : `New ${providerLabel(state.selectedProvider)} tasks launch disposable terminals in ${project.name}.`;
  }

  syncNumberSteppers();
  renderProviderTabs();
  renderPlanControls();
  renderTurboControls();
  refreshPlanTaskActions();
  updateSubmitState();
}

async function saveProjectInstanceLimits() {
  const project = activeProject();
  if (!project || state.poolLimitSaving) return;
  const codex = Number(elements.maxCodexInstances.value);
  const claude = Number(elements.maxClaudeInstances.value);
  const opencode = Number(elements.maxOpenCodeInstances.value);
  if (
    !Number.isInteger(codex) || codex < 1 || codex > 8
    || !Number.isInteger(claude) || claude < 1 || claude > 8
    || !Number.isInteger(opencode) || opencode < 1 || opencode > 8
  ) {
    elements.formMessage.textContent = 'Max instances must be whole numbers from 1 to 8.';
    renderAutomaticTerminalPool();
    return;
  }
  state.poolLimitSaving = true;
  renderAutomaticTerminalPool();
  try {
    const body = await api(`/api/projects/${project.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        maxCodexInstances: codex,
        maxClaudeInstances: claude,
        maxOpenCodeInstances: opencode,
      }),
    });
    state.projects = state.projects.map((item) => item.id === body.project.id ? body.project : item);
    if (state.status?.terminalPool) {
      state.status.terminalPool.limits = { codex, claude, opencode };
    }
    elements.formMessage.textContent = `Automatic limits saved for ${body.project.name}.`;
  } catch (error) {
    elements.formMessage.textContent = error.message;
  } finally {
    state.poolLimitSaving = false;
    renderAutomaticTerminalPool();
  }
}

function renderThreads() {
  if (usesDisposableTerminalPools()) {
    renderAutomaticTerminalPool();
    return;
  }
  elements.terminalPoolControls.hidden = true;
  elements.keepTerminalOpenOption.hidden = true;
  elements.legacyTerminalControls.hidden = false;
  elements.legacyTerminalLaunchButtons.hidden = false;
  /*
   * A submission in flight owns the composer routing. Background thread polling runs
   * every four seconds and used to be able to reassign the CC Relay, and even flip the
   * provider, between the user pressing Enter and the POST leaving the browser. While a
   * submission is pending this render only paints; it never rewrites the selection.
   */
  const selectionLocked = state.submitting;
  if (!selectionLocked && !providerEligibleForComposer(state, state.selectedProvider)) {
    state.selectedProvider = 'codex';
    const selectedThread = state.threads.find((thread) => thread.id === state.selectedThreadId);
    if (selectedThread && threadProvider(selectedThread) !== 'codex') {
      state.selectedThreadId = null;
    }
    renderProviderTabs();
  }
  const directExecute = state.taskMode === 'execute' && !isExecuteCouncilEnabled();
  const selectableThreads = projectThreads(directExecute ? null : 'codex');
  const terminalCouncil = isExecuteCouncilEnabled() && isPlanCouncilTerminalExecutionEnabled();
  const councilClaudeThreads = isExecuteCouncilEnabled() && !terminalCouncil
    ? projectThreads('claude')
    : [];
  const visibleThreads = [...selectableThreads, ...councilClaudeThreads];
  const isClaude = state.selectedProvider === 'claude';
  elements.idleTerminalRoute.hidden = isClaude || state.taskMode !== 'execute' || isExecuteCouncilEnabled();
  elements.preferIdleTerminal.checked = state.preferIdleTerminal;
  elements.preferIdleTerminal.disabled = !activeProject() || state.projectSettingsSaving;
  setProjectTerminalSettingsDisabled(!activeProject() || state.projectSettingsSaving);
  const directClaudeEnabled = isDirectClaudeEnabled();
  const launcherEnabled = state.status?.capabilities?.projectLauncher === true;
  elements.launchCodexButton.disabled = !launcherEnabled || providerIsMissing('codex');
  elements.launchClaudeButton.disabled = !launcherEnabled || providerIsMissing('claude');
  elements.launchCodexButton.title = providerIsMissing('codex')
    ? 'Install the Codex CLI to launch Codex.'
    : '';
  elements.launchClaudeButton.title = isExecuteCouncilEnabled()
    ? providerIsMissing('claude')
      ? 'Install the Claude CLI to launch Claude.'
      : terminalCouncil
        ? 'Launch a Claude terminal, then use it for the Claude Plan council stages.'
        : 'Launches a separate interactive Claude session. Plan council uses the signed-in Claude CLI automatically.'
    : providerIsMissing('claude') ? 'Install the Claude CLI to launch Claude.' : '';
  elements.terminalLegend.textContent = isExecuteCouncilEnabled()
    ? 'Codex council CC Relay'
    : state.taskMode === 'turbo'
      ? state.turboSettings.councilEnabled && state.turboSettings.councilOrder?.[0] === 'claude'
        ? 'Codex council review CC Relay'
        : 'Planner CC Relay'
    : 'Choose a CC Relay';
  elements.terminalList.setAttribute(
    'aria-label',
    directExecute
      ? 'Connected Codex and Claude sessions'
      : isExecuteCouncilEnabled()
        ? terminalCouncil
          ? 'Codex council Relays'
          : 'Codex council Relays and Execute-only Claude sessions'
        : 'Connected Codex terminals',
  );
  const availableIds = new Set(selectableThreads.map((thread) => thread.id));
  const previouslySelectedThreadId = state.selectedThreadId;
  if (!selectionLocked && !availableIds.has(state.selectedThreadId)) {
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
          <p>${isClaude ? directClaudeEnabled ? 'Open Claude in a project, then CC Relay will discover it automatically.' : 'Restart CC Relay after the running queue finishes to activate the new backend adapter.' : 'Launch Codex from this panel. CC Relay will discover the terminal automatically.'}</p>
        </div>
      </div>
    `;
    elements.threadInput.value = '';
    elements.sessionMessage.textContent = (isClaude
      ? directClaudeEnabled
        ? '0 live Claude sessions. CC Relay checks the official Claude agent list.'
        : 'Claude discovery will activate on the next normal CC Relay restart.'
      : 'CC Relay is online and waiting for a Codex terminal.') + claudeDiscoveryNote();
    updateSubmitState();
    renderTerminalSettingsHeader();
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
              <strong title="${escapeHtml(provider === 'claude' ? thread.title : `CC Relay ${relayNumber(thread)}`)}">${escapeHtml(provider === 'claude' ? thread.title : `CC Relay ${relayNumber(thread)}`)}</strong>
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
      if (!canAssignTaskToThread(state.draggedTaskId, option.dataset.threadId)) return;
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
  elements.sessionMessage.textContent = (isExecuteCouncilEnabled()
    ? terminalCouncil
      ? `${selectableThreads.length} live Codex CC Relay${selectableThreads.length === 1 ? '' : 's'} available for council work. Choose the Claude council terminal in the Plan council card.`
      : `${selectableThreads.length} live Codex CC Relay${selectableThreads.length === 1 ? '' : 's'} available for council work. ${councilClaudeThreads.length} interactive Claude session${councilClaudeThreads.length === 1 ? '' : 's'} shown as Execute only; Plan council uses the signed-in Claude CLI automatically.`
    : state.taskMode === 'turbo'
      ? `${visibleThreads.length} live Codex terminals. Choose the ${state.turboSettings.councilEnabled && state.turboSettings.councilOrder?.[0] === 'claude' ? 'Codex reviewer' : 'planner'}; CC Relay uses other terminals in this workspace as workers.`
    : `${visibleThreads.length} live CC Relay session${visibleThreads.length === 1 ? '' : 's'}. Select one to choose its provider, model, and effort.`) + claudeDiscoveryNote();
  updateSubmitState();
  renderTerminalSettingsHeader();
  renderProviderTabs();
  renderStatus();
  renderTasks();
  renderPlanControls();
  renderTurboControls();
  if (state.selectedTaskForEvents) {
    renderTaskContinuation(state.selectedTaskForEvents);
  }
}

async function loadThreads({ silent = true, render = true } = {}) {
  const requestSequence = ++state.threadLoadSequence;
  if (!silent) {
    elements.sessionMessage.textContent = 'Checking live terminal connections.';
  }
  try {
    const { threads, connection, providers = [] } = await api('/api/threads');
    if (render) await textSelectionGuard.waitForClear();
    if (requestSequence !== state.threadLoadSequence) {
      return;
    }
    state.threads = threads;
    state.connection = connection;
    state.providers = providers;
    // render: false refreshes routing data without touching the composer. Used by the
    // submission path, which must not re-render the CC Relay picker under an in-flight POST.
    if (!render) return;
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
  if (usesDisposableTerminalPools()) {
    return ['codex', 'claude']
      .filter((provider) => !providerIsMissing(provider))
      .map((provider) => ({
        id: `automatic:${provider}`,
        provider,
        cwd: task.repo_path,
        title: `Automatic ${providerLabel(provider)} instance`,
        source: 'CC Relay managed terminal pool',
        automatic: true,
      }));
  }
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
    option.textContent = usesDisposableTerminalPools()
      ? 'No installed providers'
      : 'No opened CC Relay in this workspace';
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
    return 'Restart CC Relay to enable reviewed-plan execution.';
  }
  if (!target) {
    return 'Open a Codex or Claude CC Relay in this workspace first.';
  }
  if (threadProvider(target) === 'claude' && !isClaudePlanReady()) {
    return claudePlanIssue();
  }
  return '';
}

function revealPlanExecution() {
  if (elements.planExecutionPanel.hidden) return;
  openTaskDetailModal();
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  window.requestAnimationFrame(() => {
    elements.planExecutionPanel.scrollIntoView({
      block: 'nearest',
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
    const focusTarget = elements.planExecutionButton.disabled
      ? elements.planExecutionPanel
      : elements.planExecutionButton;
    focusTarget.focus({ preventScroll: true });
  });
}

function refreshPlanTaskActions(task = null) {
  const selectedTask = task
    || state.tasks.find((item) => item.id === state.selectedTaskId)
    || state.selectedTaskForEvents;
  if (!selectedTask || selectedTask.mode !== 'plan') return;
  const executeShortcut = elements.detailActions.querySelector('[data-plan-execution-shortcut]');
  if (executeShortcut) {
    executeShortcut.disabled = state.planExecutionSubmitting;
    executeShortcut.textContent = state.planExecutionSubmitting ? 'Queuing plan' : 'Execute plan';
  }
  const retryButton = elements.detailActions.querySelector('[data-plan-retry]');
  if (retryButton) {
    const automatic = selectedTask.terminal_lifecycle === 'disposable';
    const retryTarget = automatic ? null : selectedPlanReviewThread(selectedTask);
    const authorTarget = !automatic && isPlanCouncilTerminalExecutionEnabled()
      ? selectedPlanClaudeAuthorThread()
      : null;
    retryButton.textContent = retryTarget ? `Resume on CC Relay ${relayNumber(retryTarget)}` : 'Resume council';
    const retryIssue = state.status?.capabilities?.planCouncilResume !== true
      ? 'Restart CC Relay to enable safe checkpoint resume.'
      : !isClaudePlanReady()
        ? claudePlanIssue()
        : !automatic && isPlanCouncilTerminalExecutionEnabled() && !authorTarget
          ? 'Choose a CC Relay-owned Claude council terminal before resuming.'
          : '';
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
        ? `Execute plan with ${providerLabel(threadProvider(target))} on ${threadDisplayName(target)}`
        : 'Execute plan';
    elements.planExecutionButton.disabled = Boolean(issue) || state.planExecutionSubmitting;
    elements.planExecutionButton.title = issue;
    elements.planExecutionMessage.textContent = issue || `Creates a new linked task on ${threadDisplayName(target)}. The reviewed plan stays unchanged and can be executed again.`;
    elements.planExecutionMessage.dataset.state = issue ? 'error' : 'ready';
  }
}

async function executeReviewedPlan(sourceTask) {
  if (state.planExecutionSubmitting) return;
  const issue = planExecutionIssue(sourceTask);
  const thread = selectedPlanExecutionTarget(sourceTask);
  if (issue || !thread) {
    window.alert(issue || 'Choose a connected CC Relay in this workspace.');
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
        ...(thread.automatic
          ? {
            projectPath: sourceTask.repo_path,
            terminalLifecycle: 'disposable',
            ...terminalRetentionRequest(),
            terminalLayout: terminalLayout(),
          }
          : { threadId: thread.id }),
        provider,
        model: execution.model,
        effort: execution.effort || null,
      }),
    });
    rememberThreadExecution(state, provider, thread.id, {
      model: body.task.model || execution.model,
      effort: body.task.effort || execution.effort,
    }, { source: 'task', taskId: body.task.id });
    clearTaskSearch({ render: false });
    state.taskView = 'queue';
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

async function dispatchTaskContinuation(
  sourceTask,
  prompt,
  request,
  {
    outbox = false,
    submittedAttachments = [],
  } = {},
) {
  let outcome;
  try {
    const body = await api(request.path, {
      method: 'POST',
      body: JSON.stringify(request.body),
      ...(sourceTask.provider === 'claude' && sourceTask.status === 'running'
        ? {
            // Flushing one stable native draft and then delivering this update can consume two
            // bounded 80 second recovery windows. Keep the browser attached past both so an
            // authoritative outcome always wins over an early retry trap.
            timeoutMs: outbox ? 210_000 : 120_000,
            timeoutMessage: (seconds) => `CC Relay did not confirm the Claude live update within ${seconds} seconds. It may already be queued in Claude, so check Task Activity before sending it again.`,
          }
        : {}),
    });
    // prompt is passed last so no response field can shadow what the user actually sent.
    outcome = continuationDispatchOutcome({ ok: true, ...body, prompt });
  } catch (error) {
    outcome = continuationDispatchOutcome({
      ok: false,
      deliveryUncertain: error.deliveryUncertain === true,
      message: error.message,
      prompt,
    });
  }

  if (outbox) {
    adjustContinuationSteerPending(sourceTask.id, -1);
    if (!outcome.clearComposer) {
      retainContinuationRetry(sourceTask.id, {
        prompt,
        attachments: submittedAttachments,
      });
    }
    if (state.selectedTaskForEvents?.id === sourceTask.id) {
      const restored = restoreContinuationRetry(sourceTask.id);
      if (restored) {
        elements.continuationInput.value = draftInputValue(
          state.continuationDrafts.get(sourceTask.id),
        );
        elements.continuationAttachmentInput.value = '';
      }
      elements.continuationMessage.dataset.kind = outcome.kind;
      elements.continuationMessage.textContent = outcome.message;
      elements.continuationMessage.title = outcome.detail || outcome.message;
      renderTaskContinuation(sourceTask);
    }
    if (outcome.refresh) await load({ fresh: true });
    return outcome;
  }

  state.continuationSubmitting = false;
  if (outcome.clearComposer) {
    /*
     * Draft state is task scoped, so it clears for the source task whatever the panel is
     * inspecting now. Only the visible composer is guarded, because a task switch during
     * the request must never wipe the newly selected task's unsent text.
     */
    if (outcome.retainText) {
      /*
       * One uncertain branch fires when injection itself throws, so the words may exist
       * nowhere else. They are kept under a marker the textarea rehydration ignores: the
       * message survives for the notice without ever returning as unsent text.
       */
      state.continuationDrafts.set(sourceTask.id, unconfirmedDraft(outcome.text));
    } else {
      state.continuationDrafts.delete(sourceTask.id);
    }
    state.continuationAttachments.delete(sourceTask.id);
    if (state.selectedTaskForEvents?.id === sourceTask.id) {
      elements.continuationInput.value = '';
      elements.continuationAttachmentInput.value = '';
    }
  }
  if (state.selectedTaskForEvents?.id === sourceTask.id) {
    // Rendering before the refresh clears the sending state immediately. The message kind is
    // sticky, so the refresh keeps this outcome instead of replacing it with the next hint.
    elements.continuationMessage.dataset.kind = outcome.kind;
    elements.continuationMessage.textContent = outcome.message;
    // One truncated status row cannot hold a provider's full account of an unconfirmed
    // delivery, so the exact wording stays reachable on the element itself.
    elements.continuationMessage.title = outcome.detail || outcome.message;
    renderTaskContinuation(sourceTask);
  }
  if (outcome.refresh) await load({ fresh: true });
  return outcome;
}

async function submitTaskContinuation(event) {
  event.preventDefault();
  const sourceTask = state.selectedTaskForEvents;
  const prompt = elements.continuationInput.value.trim();
  const resumableSession = sourceTask?.terminal_lifecycle === 'disposable'
    && state.status?.capabilities?.resumableDisposableSessions === true
    && Boolean(sourceTask.thread_id)
    && sourceTask.status !== 'running';
  const runningSteeringAvailable = sourceTask?.status === 'running' && (
    sourceTask.provider === 'codex'
      ? state.status?.capabilities?.taskSteering === true
      : sourceTask.provider === 'claude'
        && state.status?.capabilities?.claudeTaskSteering === true
  );
  const outbox = reliableClaudeSteering(sourceTask);
  if (
    !sourceTask
    || !prompt
    || (state.continuationSubmitting && !outbox)
    || (!taskContinuationSession(sourceTask) && !resumableSession && !runningSteeringAvailable)
  ) return;
  let request;
  const attachments = state.continuationAttachments.get(sourceTask.id) || [];
  const submittedAttachments = [...attachments];
  try {
    request = continuationSubmission(sourceTask, prompt, {
      supportsDirectFollowUp: state.status?.capabilities?.taskDirectFollowUp === true,
      supportsFollowUpAttachments: state.status?.capabilities?.taskFollowUpAttachments === true,
      supportsTaskSteering: state.status?.capabilities?.taskSteering === true,
      supportsClaudeTaskSteering: state.status?.capabilities?.claudeTaskSteering === true,
      supportsClaudeSteerOutbox: state.status?.capabilities?.claudeSteerOutbox === true,
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

  if (outbox) {
    // Capture this message and immediately release the visible composer. Delivery is serialized
    // per task by the active watcher, so typing can continue while earlier updates still resolve.
    state.continuationDrafts.delete(sourceTask.id);
    state.continuationAttachments.delete(sourceTask.id);
    elements.continuationInput.value = '';
    elements.continuationAttachmentInput.value = '';
    adjustContinuationSteerPending(sourceTask.id, 1);
    elements.continuationMessage.dataset.kind = 'hint';
    renderTaskContinuation(sourceTask);
    elements.continuationInput.focus();

    // Hand every update to the backend immediately. The active Claude watcher owns the ordered
    // steering tail, so a second local request is accepted by the task before the first finishes
    // its terminal recovery instead of living only in this browser tab.
    const operation = dispatchTaskContinuation(sourceTask, prompt, request, {
      outbox: true,
      submittedAttachments,
    });
    // The delivery function converts provider failures into visible outcomes. This final handler
    // covers only an unexpected renderer exception and prevents a detached outbox promise from
    // becoming an unhandled rejection while the operator continues typing.
    operation.catch(() => {});
    return;
  }

  state.continuationDrafts.set(sourceTask.id, elements.continuationInput.value);
  state.continuationSubmitting = true;
  elements.continuationMessage.dataset.kind = 'hint';
  renderTaskContinuation(sourceTask);
  await dispatchTaskContinuation(sourceTask, prompt, request, {
    submittedAttachments,
  });
}

async function deleteTask(taskId) {
  if (!window.confirm('Delete this task from CC Relay?')) {
    return;
  }
  try {
    await api(`/api/tasks/${taskId}`, { method: 'DELETE' });
    state.selectedTaskId = null;
    hideTaskDetailPanel();
    await load();
  } catch (error) {
    window.alert(error.message);
  }
}

function prepareTaskEditor(task, { mode, executionEditable }) {
  state.editingTaskId = task.id;
  state.taskEditMode = mode;
  state.taskEditSubmitting = false;
  state.taskEditProvider = executionEditable ? task.provider : null;
  state.taskEditOriginalProvider = executionEditable ? task.provider : null;
  state.taskEditExecutionDirty = false;
  state.taskEditSettings = executionEditable ? {
    codex: { model: '', effort: '' },
    claude: { model: '', effort: '' },
    opencode: { model: '', effort: '' },
    [task.provider]: { model: task.model || '', effort: task.effort || '' },
  } : null;
  elements.taskEditModal.dataset.mode = mode;
  elements.taskEditTitle.textContent = mode === 'retry'
    ? `Retry task ${String(task.id).padStart(3, '0')}`
    : 'Edit queued task';
  elements.taskEditSubtitle.textContent = mode === 'retry'
    ? 'Choose the executor, model, and effort before this task returns to the queue.'
    : 'The request can change only while this task is still waiting to start.';
  elements.taskEditProviderLabel.textContent = mode === 'retry' ? 'Executor' : 'AI provider';
  elements.taskEditSave.textContent = mode === 'retry' ? 'Retry task' : 'Save changes';
  elements.taskEditExecution.hidden = !executionEditable;
  elements.taskEditName.value = taskDisplayName(task);
  elements.taskEditName.disabled = mode === 'retry' || !taskNamingSupported();
  elements.taskEditNameHint.textContent = taskNamingSupported()
    ? 'Clear the name to regenerate it from the request.'
    : 'Restart CC Relay to rename queued tasks.';
  elements.taskEditPrompt.value = task.prompt;
  elements.taskEditPrompt.disabled = mode === 'retry';
  elements.taskEditMessage.textContent = '';
  elements.taskEditSave.disabled = false;
  elements.taskEditCancel.disabled = false;
  elements.taskEditClose.disabled = false;
  elements.taskEditProvider.disabled = false;
  elements.taskEditModel.disabled = false;
  elements.taskEditEffort.disabled = false;
  if (executionEditable) renderTaskEditExecution();
  elements.taskEditModal.showModal();
  requestAnimationFrame(() => {
    const focusTarget = mode === 'retry'
      ? elements.taskEditProvider
      : taskNamingSupported() ? elements.taskEditName : elements.taskEditPrompt;
    focusTarget.focus();
  });
  if (executionEditable) {
    Promise.all([loadModels('codex'), loadModels('claude'), loadModels('opencode')]).then(() => {
      if (elements.taskEditModal.open && state.editingTaskId === task.id) renderTaskEditExecution();
    });
  }
}

function openTaskEditor(task) {
  if (state.status?.capabilities?.queuedTaskEditing !== true) {
    window.alert('Restart CC Relay to edit queued tasks.');
    return;
  }
  if (taskHasCustomName(task) && !taskNamingSupported()) {
    window.alert('Restart CC Relay to edit this named task without losing its name.');
    return;
  }
  const executionEditable = state.status?.capabilities?.queuedTaskProviderSwitch === true
    && task.mode === 'execute'
    && task.terminal_lifecycle === 'disposable';
  prepareTaskEditor(task, { mode: 'edit', executionEditable });
}

function openTaskRetryEditor(task) {
  const supported = state.status?.capabilities?.retryTaskExecutionSettings === true;
  const eligible = task.mode === 'execute' && task.terminal_lifecycle === 'disposable';
  if (!supported || !eligible) {
    taskAction(task.id, 'retry');
    return;
  }
  prepareTaskEditor(task, { mode: 'retry', executionEditable: true });
}

function renderTaskEditExecution() {
  const provider = state.taskEditProvider;
  const settings = state.taskEditSettings?.[provider];
  if (!provider || !settings) return;
  elements.taskEditProvider.innerHTML = ['codex', 'claude', 'opencode'].map((candidate) => {
    const unavailable = providerIsMissing(candidate)
      && candidate !== state.taskEditOriginalProvider;
    return `<option value="${candidate}"${unavailable ? ' disabled' : ''}>${providerLabel(candidate)}${unavailable ? ' · not installed' : ''}</option>`;
  }).join('');
  const models = state.modelCatalogs[provider] || [];
  const selectedModel = models.find((item) => item.model === settings.model) || null;
  const effectiveModel = selectedModel || models.find((item) => item.isDefault) || models[0] || null;
  elements.taskEditProvider.value = provider;
  elements.taskEditModel.innerHTML = [
    `<option value="">${escapeHtml(providerLabel(provider))} default</option>`,
    ...models.map((item) => (
      `<option value="${escapeHtml(item.model)}">${escapeHtml(item.displayName)}${item.isDefault ? ' · default' : ''}</option>`
    )),
  ].join('');
  elements.taskEditModel.value = selectedModel?.model || '';

  const efforts = effectiveModel?.supportedReasoningEfforts || [];
  if (settings.effort && !efforts.some((item) => item.reasoningEffort === settings.effort)) {
    settings.effort = '';
  }
  elements.taskEditEffort.innerHTML = [
    `<option value="">Model default${effectiveModel?.defaultReasoningEffort ? ` · ${escapeHtml(effectiveModel.defaultReasoningEffort)}` : ''}</option>`,
    ...efforts.map((item) => (
      `<option value="${escapeHtml(item.reasoningEffort)}">${escapeHtml(item.reasoningEffort)}</option>`
    )),
  ].join('');
  elements.taskEditEffort.value = settings.effort;
  elements.taskEditEffort.disabled = state.taskEditSubmitting || efforts.length === 0;
  const switching = provider !== state.taskEditOriginalProvider;
  if (state.taskEditMode === 'retry') {
    elements.taskEditExecutionHint.textContent = switching
      ? `This retry will use ${providerLabel(provider)} in a fresh conversation.`
      : `This retry will use ${providerLabel(provider)} with the selected effort and resume its saved conversation when available. ${effectiveModel?.description || ''}`.trim();
  } else {
    elements.taskEditExecutionHint.textContent = switching
      ? `This task will switch to ${providerLabel(provider)} and start in a fresh conversation.`
      : `Changing providers starts this task in a fresh conversation. ${effectiveModel?.description || ''}`.trim();
  }
}

function clearTaskEditorState() {
  state.editingTaskId = null;
  state.taskEditMode = null;
  state.taskEditProvider = null;
  state.taskEditOriginalProvider = null;
  state.taskEditExecutionDirty = false;
  state.taskEditSettings = null;
  delete elements.taskEditModal.dataset.mode;
}

function closeTaskEditor() {
  if (state.taskEditSubmitting) return;
  clearTaskEditorState();
  elements.taskEditModal.close();
}

async function saveTaskEdit() {
  if (state.taskEditSubmitting || !state.editingTaskId) return;
  const mode = state.taskEditMode;
  const title = elements.taskEditName.value.trim();
  const prompt = elements.taskEditPrompt.value.trim();
  if (mode === 'edit' && !prompt) {
    elements.taskEditMessage.textContent = 'Task prompt is required.';
    return;
  }
  const provider = state.taskEditProvider;
  const selectedExecution = provider ? {
    provider,
    model: state.taskEditSettings?.[provider]?.model || null,
    effort: state.taskEditSettings?.[provider]?.effort || null,
  } : null;
  if (mode === 'retry' && !selectedExecution) {
    elements.taskEditMessage.textContent = 'Choose Codex, Claude, or OpenCode as the retry executor.';
    return;
  }
  state.taskEditSubmitting = true;
  elements.taskEditMessage.textContent = mode === 'retry' ? 'Queuing retry.' : 'Saving changes.';
  elements.taskEditSave.disabled = true;
  elements.taskEditCancel.disabled = true;
  elements.taskEditClose.disabled = true;
  elements.taskEditName.disabled = true;
  elements.taskEditPrompt.disabled = true;
  elements.taskEditProvider.disabled = true;
  elements.taskEditModel.disabled = true;
  elements.taskEditEffort.disabled = true;
  try {
    if (mode === 'retry') {
      await api(`/api/tasks/${state.editingTaskId}/retry`, {
        method: 'POST',
        body: JSON.stringify(selectedExecution),
      });
    } else {
      const execution = state.taskEditExecutionDirty && selectedExecution
        ? selectedExecution
        : {};
      await api(`/api/tasks/${state.editingTaskId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...(taskNamingSupported() ? { title } : {}),
          prompt,
          ...execution,
        }),
      });
    }
    clearTaskEditorState();
    elements.taskEditModal.close();
    await load({ fresh: true });
  } catch (error) {
    elements.taskEditMessage.textContent = error.message;
  } finally {
    state.taskEditSubmitting = false;
    elements.taskEditSave.disabled = false;
    elements.taskEditCancel.disabled = false;
    elements.taskEditClose.disabled = false;
    elements.taskEditName.disabled = state.taskEditMode === 'retry' || !taskNamingSupported();
    elements.taskEditPrompt.disabled = state.taskEditMode === 'retry';
    elements.taskEditProvider.disabled = false;
    elements.taskEditModel.disabled = false;
    renderTaskEditExecution();
  }
}

// ----- Planner: saved plans, dependency board, and plan runs -----

let plannerProposalSaveTimer = null;

function plannerProjectSessions() {
  if (usesDisposableTerminalPools()) {
    return ['codex', 'claude']
      .filter((provider) => !providerIsMissing(provider))
      .map((provider) => ({
        id: `automatic:${provider}`,
        provider,
        cwd: state.activeProjectPath,
        title: `Automatic ${providerLabel(provider)} instance`,
        source: 'CC Relay managed terminal pool',
        status: 'idle',
        automatic: true,
      }));
  }
  return state.threads.filter((thread) => (
    !state.activeProjectPath || sameProjectPath(thread.cwd, state.activeProjectPath)
  ));
}

function plannerSessionOptions(selectedId) {
  const sessions = plannerProjectSessions();
  if (sessions.length === 0) {
    return `<option value="">${usesDisposableTerminalPools() ? 'No installed providers' : 'No live sessions in this project'}</option>`;
  }
  const options = sessions.map((thread) => {
    const provider = threadProvider(thread);
    const busy = thread.status && thread.status !== 'idle' ? ' · busy' : '';
    const label = `${threadDisplayName(thread)} · ${providerLabel(provider)}${busy}`;
    const selected = thread.id === selectedId ? ' selected' : '';
    return `<option value="${escapeHtml(thread.id)}" data-provider="${escapeHtml(provider)}"${selected}>${escapeHtml(label)}</option>`;
  });
  return `<option value="">${usesDisposableTerminalPools() ? 'Choose a provider' : 'Choose a live session'}</option>${options.join('')}`;
}

/**
 * Model and effort for a plan run come from the composer's own per-terminal
 * memory, so a run uses exactly the settings the user last chose for that
 * CC Relay. The planner deliberately does not add a second model picker.
 */
function plannerRunSettings(threadId) {
  const thread = plannerProjectSessions().find((item) => item.id === threadId);
  if (!thread) return null;
  const provider = threadProvider(thread);
  const remembered = state.threadExecutionSettings?.[threadId];
  const settings = remembered && remembered.provider === provider
    ? remembered
    : state.executionSettings?.[provider];
  return { provider, model: settings?.model || '', effort: settings?.effort || '' };
}

function plannerTerminalRequest(threadId) {
  const settings = plannerRunSettings(threadId);
  if (!settings) return null;
  if (usesDisposableTerminalPools()) {
    return {
      provider: settings.provider,
      projectPath: state.activeProjectPath,
      terminalLifecycle: 'disposable',
      ...terminalRetentionRequest(),
      terminalLayout: terminalLayout(),
    };
  }
  return { threadId, provider: settings.provider };
}

function setPlannerMessage(message) {
  elements.plannerMessage.textContent = message || '';
}

async function openPlanner() {
  if (state.planner.open) return;
  state.planner.open = true;
  state.planner.selectedPlanId = null;
  clearPlannerPlan();
  state.planner.showRaw = false;
  setPlannerMessage('');
  const project = activeProject();
  elements.plannerSubtitle.textContent = project
    ? `Saved plans for ${project.name}.`
    : 'Select a project to use the Planner.';
  if (!elements.plannerModal.open) elements.plannerModal.showModal();
  if (!plannerCapable(state.status)) {
    renderPlannerUnsupported();
    return;
  }
  if (!state.activeProjectPath) {
    elements.plannerPlanList.innerHTML = '';
    elements.plannerDetail.innerHTML = '<div class="planner-empty"><p>Select a Launchpad project before using the Planner.</p></div>';
    return;
  }
  await loadPlans();
}

function closePlanner() {
  if (elements.plannerModal.open) elements.plannerModal.close();
}

function renderPlannerUnsupported() {
  elements.plannerPlanList.innerHTML = '';
  elements.plannerDetail.innerHTML = '<div class="planner-empty planner-restart"><h3>Restart CC Relay to use the Planner</h3><p>This CC Relay build is newer than the running backend. Restart CC Relay to enable saved plans and AI task breakdown.</p></div>';
}

async function loadPlans() {
  if (!state.activeProjectPath || !plannerCapable(state.status)) return;
  state.planner.loading = true;
  try {
    const body = await api(`/api/plans?projectPath=${encodeURIComponent(state.activeProjectPath)}`);
    await textSelectionGuard.waitForClear();
    state.planner.plans = Array.isArray(body.plans) ? body.plans : [];
    if (state.planner.selectedPlanId && !state.planner.plans.some((plan) => plan.id === state.planner.selectedPlanId)) {
      state.planner.selectedPlanId = null;
      clearPlannerPlan();
    }
    renderPlannerPlanList();
    if (!state.planner.plan) renderPlannerDetailEmpty();
  } catch (error) {
    setPlannerMessage(error.message);
  } finally {
    state.planner.loading = false;
  }
}

function renderPlannerPlanList() {
  if (!plannerCapable(state.status)) { elements.plannerPlanList.innerHTML = ''; return; }
  const plans = state.planner.plans;
  if (plans.length === 0) {
    elements.plannerPlanList.innerHTML = '<p class="planner-plan-empty">No saved plans yet.</p>';
    return;
  }
  elements.plannerPlanList.innerHTML = plans.map((plan) => {
    const active = plan.id === state.planner.selectedPlanId ? ' selected' : '';
    const count = plan.breakdown ? plan.breakdown.proposalCount : 0;
    const summary = plan.breakdown
      ? `${count} step${count === 1 ? '' : 's'}`
      : 'No breakdown';
    const run = plan.run || null;
    const progress = run ? runProgressSummary(run) : null;
    const runLine = run
      ? `<em class="planner-plan-run" data-tone="${escapeHtml(runStatusPresentation(run).tone)}">${escapeHtml(progress.label || runStatusPresentation(run).label)}</em>`
      : '';
    return `<button type="button" class="planner-plan-item${active}" role="listitem" data-plan-id="${escapeHtml(String(plan.id))}">
      <strong>${escapeHtml(plan.name)}</strong>
      <small>${escapeHtml(summary)}${plan.updated_at ? ` · ${escapeHtml(plannerRelativeTime(plan.updated_at))}` : ''}</small>
      ${runLine}
    </button>`;
  }).join('');
}

/** Compact "updated" stamp for the plan library. */
function plannerRelativeTime(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(time).toLocaleDateString();
}

function renderPlannerDetailEmpty() {
  elements.plannerDetail.innerHTML = '<div class="planner-empty"><p>Select a plan, or create a new one, to edit its brief and break it into dependency-aware steps.</p></div>';
}

function clearPlannerPlan() {
  state.planner.plan = null;
  state.planner.breakdown = null;
  state.planner.run = null;
  state.planner.notes = [];
  state.planner.proposals = [];
  state.planner.selection = new Set();
  state.planner.selectionAttemptId = null;
  state.planner.dirtyProposalIds = new Set();
  state.planner.boardSignature = null;
}

function plannerAttemptId() {
  return state.planner.breakdown ? state.planner.breakdown.id : null;
}

/**
 * Apply a plan payload. `adoptProposals` is the never-clobber switch: a
 * background refresh passes false whenever the user has unsaved edits, so only
 * the run and breakdown status move while the proposals stay exactly as typed.
 */
function applyPlannerPlan(plan, { adoptProposals = true } = {}) {
  state.planner.plan = plan || null;
  const breakdown = plan?.breakdown || null;
  state.planner.breakdown = breakdown;
  state.planner.run = plan?.run || null;
  state.planner.notes = Array.isArray(breakdown?.notes) ? breakdown.notes : [];
  if (!adoptProposals) return;
  /*
   * A newly started breakdown or refinement is the latest attempt but it is
   * PENDING and carries no proposals yet. Adopting it would blank the board:
   * the previous attempt's steps, the run bar, and the Stop button all
   * disappear, and a failed refinement would leave nothing to recover from.
   * Keep showing the last completed attempt instead, read-only, until the new
   * attempt actually lands.
   */
  const incoming = Array.isArray(breakdown?.proposals) ? breakdown.proposals : [];
  if (incoming.length === 0 && breakdown?.status !== 'complete' && state.planner.proposals.length > 0) {
    return;
  }
  const previousIds = state.planner.proposals.map((proposal) => proposal.id);
  const previousSelection = state.planner.selection;
  state.planner.proposals = pruneDanglingDependencies(incoming.map((proposal) => ({
    ...proposal,
    dependsOn: dependencyIds(proposal),
  })));
  state.planner.dirtyProposalIds = new Set();
  const attemptId = plannerAttemptId();
  /*
   * Only a COMPLETE attempt may latch the selection marker. Latching against a
   * pending attempt leaves the selection empty, and because the id then matches
   * when the attempt completes, the reseed never runs again: every breakdown
   * and refinement would finish with nothing selected and Run plan disabled.
   */
  if (breakdown?.status === 'complete' && state.planner.selectionAttemptId !== attemptId) {
    // A new attempt reseeds the checkboxes. It never re-selects a step the
    // latest run already completed, and never re-checks a surviving step the
    // user had deliberately unchecked. See defaultRunSelection.
    state.planner.selection = defaultRunSelection(
      state.planner.proposals,
      state.planner.run,
      previousSelection,
      { knownIds: previousIds },
    );
    state.planner.selectionAttemptId = attemptId;
  } else {
    state.planner.selection = pruneSelection(state.planner.proposals, state.planner.selection);
  }
}

/**
 * True while a newer attempt is running against steps that are still the
 * previous completed attempt's. The board stays visible but read-only.
 */
function plannerAttemptPending() {
  return breakdownIsActive(state.planner.breakdown) && state.planner.proposals.length > 0;
}

/**
 * Proposals are editable only while the latest attempt is complete. This is
 * exactly the server's PATCH rule, mirrored so the board never offers an edit
 * that would come back as a 409. It covers both a pending attempt and a failed
 * one sitting on top of the previous attempt's steps.
 */
function plannerProposalsEditable() {
  return state.planner.breakdown?.status === 'complete';
}

async function selectPlan(planId) {
  setPlannerMessage('');
  stopPlannerPoll();
  try {
    const body = await api(`/api/plans/${planId}`);
    state.planner.selectedPlanId = body.plan.id;
    state.planner.selectionAttemptId = null;
    applyPlannerPlan(body.plan);
    state.planner.runSessionId = state.planner.run?.sessionId || state.planner.runSessionId;
    renderPlannerPlanList();
    renderPlannerDetail();
    maybeStartPlannerPoll();
  } catch (error) {
    setPlannerMessage(error.message);
  }
}

function renderPlannerDetail() {
  const plan = state.planner.plan;
  if (!plan) { renderPlannerDetailEmpty(); return; }
  const active = breakdownIsActive(state.planner.breakdown);
  elements.plannerDetail.innerHTML = `
    <div class="planner-editor">
      <div class="planner-editor-head">
        <input id="planner-plan-name" class="planner-plan-name" type="text" maxlength="200" aria-label="Plan name" value="${escapeHtml(plan.name)}">
        <div class="planner-editor-actions">
          <button id="planner-save" class="button compact" type="button">Save</button>
          <button id="planner-delete" class="button danger compact" type="button">Delete</button>
        </div>
      </div>
      <textarea id="planner-plan-content" class="planner-plan-content" aria-label="Plan brief" placeholder="Write the implementation brief. It can be long: goals, constraints, file boundaries, and how each part is verified.">${escapeHtml(plan.content)}</textarea>
      <section class="planner-breakdown" aria-label="Task breakdown">
        <div class="planner-breakdown-head">
          <span class="eyebrow">Task breakdown</span>
          <h3>Break this plan into dependency-aware steps</h3>
        </div>
        <div class="planner-breakdown-controls">
          <label class="planner-field">
            <span>${usesDisposableTerminalPools() ? 'Provider' : 'Session'}</span>
            <select id="planner-breakdown-session">${plannerSessionOptions(state.planner.breakdownSessionId)}</select>
          </label>
          <label class="planner-field planner-field-guidance">
            <span>Guidance <small>optional</small></span>
            <textarea id="planner-guidance" rows="2" maxlength="8000" placeholder="Optional: how to split the work, ordering, or what to skip."></textarea>
          </label>
          <button id="planner-request-breakdown" class="button primary compact" type="button"${active ? ' disabled' : ''}>Break into steps</button>
        </div>
        <div id="planner-breakdown-body" class="planner-breakdown-body"></div>
      </section>
    </div>`;
  renderPlannerBoard();
}

const PLANNER_PORT_GLYPHS = {
  complete: '✓',
  failed: '!',
  cancelled: '×',
  blocked: '⊘',
  queued: '·',
  waiting: '·',
};

function plannerPortMarkup(status) {
  if (status === 'running' || status === 'retrying') {
    return '<i class="planner-step-spinner" aria-hidden="true"></i>';
  }
  return `<b aria-hidden="true">${escapeHtml(PLANNER_PORT_GLYPHS[status] || '·')}</b>`;
}

function plannerStepErrorExcerpt(step) {
  const text = String(step?.error || '').trim();
  if (!text) return '';
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

/** Full board rebuild. Only called when plannerBoardSignature changes. */
function renderPlannerBoard() {
  const container = elements.plannerDetail.querySelector('#planner-breakdown-body');
  if (!container) return;
  const breakdown = state.planner.breakdown;
  const proposals = state.planner.proposals;
  const capable = plannerV2Capable(state.status);
  const presentation = breakdownStatusPresentation(breakdown);
  const parts = [
    `<div class="planner-breakdown-status" data-tone="${escapeHtml(presentation.tone)}"><i aria-hidden="true"></i><span>${escapeHtml(presentation.label)}</span></div>`,
  ];
  if (breakdown && ['failed', 'cancelled'].includes(breakdown.status) && breakdown.error) {
    parts.push(`<p class="planner-breakdown-error">${escapeHtml(breakdown.error)}</p>`);
  }
  if (breakdown && breakdown.status === 'complete' && !breakdown.parsed) {
    parts.push(`<details class="planner-raw"${state.planner.showRaw ? ' open' : ''}><summary>Raw response (no steps could be extracted)</summary><pre>${escapeHtml(breakdown.raw_response || '')}</pre></details>`);
  }
  const notes = (state.planner.notes || [])
    .map((note) => breakdownNoteLabel(note, proposals))
    .filter(Boolean);
  if (notes.length > 0) {
    parts.push(`<ul class="planner-notes" aria-label="Dependency parse notes">${notes
      .map((note) => `<li>${escapeHtml(note)}</li>`)
      .join('')}</ul>`);
  }
  const attemptPending = plannerAttemptPending();
  const readOnly = !plannerProposalsEditable();
  if (attemptPending) {
    const attempt = Number(breakdown?.attempt ?? 0);
    parts.push(`<p class="planner-attempt-banner" role="status">${escapeHtml(
      `${attempt > 0 ? `Attempt ${attempt}` : 'A new attempt'} is running. These are the steps from the last completed attempt and they stay read only until the new one lands.`,
    )}</p>`);
  }
  if (proposals.length > 0) {
    parts.push(renderPlannerBoardHead(proposals, capable, breakdown, readOnly));
    const { waves, unresolvable } = computeWaves(proposals);
    parts.push('<div class="planner-waves">');
    waves.forEach((wave, index) => {
      parts.push(renderPlannerWave(wave, index, { proposals, waves, capable, readOnly }));
    });
    if (unresolvable.length > 0) {
      parts.push(renderPlannerUnresolvedWave(unresolvable, { proposals, capable, readOnly }));
    }
    parts.push('</div>');
  }
  /*
   * The run bar is mounted whenever a run exists, not only when proposals are
   * present. It carries the live progress and the ONLY Stop control, so a
   * pending refinement must never be able to take it away mid-run.
   */
  if (proposals.length > 0 || state.planner.run) {
    parts.push(renderPlannerRunBar(capable, proposals.length > 0));
  }
  if (breakdown && breakdown.status === 'complete') {
    parts.push(renderPlannerRefine(capable));
  } else if (breakdown && ['failed', 'cancelled'].includes(breakdown.status) && proposals.length > 0) {
    // A failed attempt cannot be refined again (the server rejects a zero
    // proposal latest attempt) and PATCH is closed too, so the recovery path
    // has to be named here rather than left for the user to find.
    parts.push(renderPlannerAttemptRecovery(breakdown));
  }
  container.innerHTML = parts.join('');
  state.planner.boardSignature = plannerBoardSignature(proposals, state.planner.run, {
    attemptId: plannerAttemptId(),
    attemptStatus: breakdown?.status || '',
    capable,
  });
  updatePlannerRunProgress();
  updatePlannerQueueButton();
}

function renderPlannerBoardHead(proposals, capable, breakdown, readOnly) {
  const allSelected = proposals.every((proposal) => state.planner.selection.has(proposal.id));
  const canAdd = capable && !readOnly;
  return `<div class="planner-proposals-head">
    <label class="planner-select-all"><input id="planner-select-all" type="checkbox"${allSelected ? ' checked' : ''}> Select all</label>
    <span>${escapeHtml(String(state.planner.selection.size))} of ${escapeHtml(String(proposals.length))} selected</span>
    <button id="planner-add-step" class="button compact" type="button"${canAdd ? '' : ' disabled'}${capable ? '' : ' title="Restart CC Relay to author steps by hand."'}>+ Add step</button>
  </div>`;
}

function renderPlannerWave(wave, index, context) {
  const meta = index === 0
    ? `${wave.length} step${wave.length === 1 ? '' : 's'} · no dependencies`
    : `${wave.length} step${wave.length === 1 ? '' : 's'} · runs after wave ${index}`;
  return `<section class="planner-wave" data-wave="${index + 1}" aria-label="Wave ${index + 1}">
    <div class="planner-wave-head">
      <span class="planner-wave-label">Wave ${index + 1}</span>
      <span class="planner-wave-meta">${escapeHtml(meta)}</span>
      <span class="planner-wave-progress" data-wave-index="${index}"></span>
    </div>
    <ol class="planner-steps">${wave
      .map((proposal) => renderPlannerStep(proposal, context))
      .join('')}</ol>
  </section>`;
}

function renderPlannerUnresolvedWave(unresolvable, context) {
  return `<section class="planner-wave planner-wave-unresolved" aria-label="Steps that cannot run">
    <div class="planner-wave-head">
      <span class="planner-wave-label">Cannot run</span>
      <span class="planner-wave-meta">${unresolvable.length} step${unresolvable.length === 1 ? '' : 's'} depend on each other in a cycle</span>
    </div>
    <p class="planner-wave-note">Edit the dependencies below so at least one of these steps can start.</p>
    <ol class="planner-steps">${unresolvable
      .map((proposal) => renderPlannerStep(proposal, context))
      .join('')}</ol>
  </section>`;
}

function renderPlannerStep(proposal, { proposals, capable, readOnly }) {
  const run = state.planner.run;
  const index = proposals.findIndex((item) => item.id === proposal.id);
  const number = index + 1;
  const status = proposalStatus(proposal.id, run);
  const chip = stepStatusPresentation(status, run?.status);
  // readOnly covers a board showing an older attempt's steps, where the server
  // would reject the PATCH anyway. stepEditingLocked covers a step this run
  // already owns.
  const locked = readOnly || stepEditingLocked(proposal.id, run);
  const checked = state.planner.selection.has(proposal.id) ? ' checked' : '';
  const deps = dependencyLabel(proposal, proposals);
  const readonly = locked ? ' readonly' : '';
  const disabled = locked ? ' disabled' : '';
  return `<li class="planner-step" data-proposal-id="${escapeHtml(proposal.id)}" data-state="${escapeHtml(status)}" data-locked="${locked ? 'true' : 'false'}">
    <label class="planner-step-select">
      <input class="planner-step-check" type="checkbox"${checked}${disabled}>
      <span class="sr-only">Include step ${number} in the plan run</span>
    </label>
    <span class="planner-step-port" data-state="${escapeHtml(status)}">${plannerPortMarkup(status)}<span class="sr-only">${escapeHtml(chip.label)}</span></span>
    <div class="planner-step-main">
      <div class="planner-step-head">
        <code class="planner-step-number">${escapeHtml(String(number).padStart(2, '0'))}</code>
        <input class="planner-step-title" type="text" maxlength="300" value="${escapeHtml(proposal.title || '')}" aria-label="Step ${number} title"${readonly}>
        <span class="planner-step-chip" data-tone="${escapeHtml(chip.tone)}" data-state="${escapeHtml(chip.state)}">${escapeHtml(chip.label)}</span>
      </div>
      <textarea class="planner-step-prompt" rows="3" maxlength="12000" aria-label="Step ${number} prompt"${readonly}>${escapeHtml(proposal.prompt || '')}</textarea>
      <p class="planner-step-deps">${deps ? escapeHtml(`Runs ${deps}`) : 'No dependencies'}</p>
      ${capable ? renderPlannerDependencyPicker(proposal, proposals, number, locked) : ''}
      <p class="planner-step-reason" hidden></p>
      <div class="planner-step-outcome" hidden>
        <p class="planner-step-error-text"></p>
        <button type="button" class="planner-step-open text-button" hidden></button>
      </div>
    </div>
    <div class="planner-step-controls">
      <button type="button" class="planner-step-move" data-direction="up" aria-label="Move step ${number} up"${index === 0 ? ' disabled' : disabled}>↑</button>
      <button type="button" class="planner-step-move" data-direction="down" aria-label="Move step ${number} down"${index === proposals.length - 1 ? ' disabled' : disabled}>↓</button>
      <button type="button" class="planner-step-remove" aria-label="Remove step ${number}"${disabled}>×</button>
    </div>
  </li>`;
}

function renderPlannerDependencyPicker(proposal, proposals, number, locked) {
  const current = dependencyIds(proposal);
  const options = proposals
    .filter((other) => other.id !== proposal.id)
    .map((other) => {
      const otherNumber = proposals.findIndex((item) => item.id === other.id) + 1;
      const isChecked = current.includes(String(other.id));
      // Offering an edge that would close a cycle only to have it refused is
      // worse than showing it unavailable up front.
      const wouldCycle = !isChecked && dependsOnTransitively(proposals, other.id, proposal.id);
      const optionDisabled = locked || wouldCycle;
      const title = wouldCycle ? ' title="This would create a dependency cycle."' : '';
      return `<label class="planner-dep-option${optionDisabled ? ' disabled' : ''}"${title}>
        <input type="checkbox" class="planner-dep-check" data-dependency-id="${escapeHtml(String(other.id))}" data-cycle="${wouldCycle ? 'true' : 'false'}"${isChecked ? ' checked' : ''}${optionDisabled ? ' disabled' : ''}>
        <span>${escapeHtml(`${String(otherNumber).padStart(2, '0')} ${other.title || 'Untitled step'}`)}</span>
      </label>`;
    })
    .join('');
  if (!options) return '';
  // The plain-text sentence above already states the dependencies; this
  // disclosure is the editor, so its summary is an action, not a repeat.
  return `<details class="planner-step-deps-edit">
    <summary>Edit dependencies<span class="planner-dep-count">${current.length}</span></summary>
    <div class="planner-dep-picker" role="group" aria-label="Dependencies for step ${number}">${options}</div>
  </details>`;
}

function renderPlannerRunBar(capable, hasProposals = true) {
  const run = state.planner.run;
  const status = runStatusPresentation(run);
  const active = planRunIsActive(run);
  if (!capable) {
    if (!hasProposals) return '';
    return `<div class="planner-run" data-state="unsupported">
      <div class="planner-run-controls">
        <label class="planner-field">
          <span>${usesDisposableTerminalPools() ? 'Provider' : 'Queue on'}</span>
          <select id="planner-queue-session">${plannerSessionOptions(state.planner.queueSessionId)}</select>
        </label>
        <button id="planner-queue-selected" class="button primary compact" type="button">Queue selected tasks</button>
      </div>
      <p class="planner-run-note planner-restart-note">Restart CC Relay to run this plan wave by wave, add steps by hand, and refine the breakdown. The running backend predates plan runs.</p>
    </div>`;
  }
  const settings = plannerRunSettings(state.planner.runSessionId);
  const settingsLine = settings && (settings.model || settings.effort)
    ? `Uses ${escapeHtml(settings.model || 'the default model')}${settings.effort ? ` · ${escapeHtml(settings.effort)}` : ''} from the composer for this ${usesDisposableTerminalPools() ? 'provider' : 'CC Relay'}.`
    : `Uses the composer settings for the chosen ${usesDisposableTerminalPools() ? 'provider' : 'CC Relay'}.`;
  return `<div class="planner-run" data-state="${escapeHtml(status.state)}">
    <div class="planner-run-head">
      <span id="planner-run-pill" class="planner-run-pill" data-tone="${escapeHtml(status.tone)}">${escapeHtml(status.label)}</span>
      <span id="planner-run-progress" class="planner-run-progress"></span>
    </div>
    <div id="planner-run-progressbar" class="planner-run-bar" role="progressbar" aria-label="Plan run progress" aria-valuemin="0"><i></i></div>
    <div class="planner-run-controls">
      ${hasProposals ? `<label class="planner-field">
        <span>${usesDisposableTerminalPools() ? 'Provider' : 'Run on'}</span>
        <select id="planner-run-session">${plannerSessionOptions(state.planner.runSessionId)}</select>
      </label>
      ${usesDisposableTerminalPools() ? '' : `<label class="planner-run-option"><input id="planner-run-prefer-idle" type="checkbox"${state.planner.runPreferIdle ? ' checked' : ''}> Use an idle CC Relay when available</label>`}
      <button id="planner-run-start" class="button primary compact" type="button">Run plan</button>` : ''}
      ${active ? '<button id="planner-run-stop" class="button danger compact" type="button">Stop run</button>' : ''}
    </div>
    <p id="planner-run-blocked" class="planner-run-blocked" hidden></p>
    <p class="planner-run-note">${hasProposals ? `${settingsLine} Nothing runs until you start the run.` : 'This run is still tracked while the new breakdown attempt finishes.'}${active ? ' Stopping enqueues no further steps; tasks already running continue and stay cancellable from the queue.' : ''}</p>
  </div>`;
}

/**
 * Recovery for a failed or cancelled attempt that landed on top of steps the
 * user still has. Refine is closed (the server rejects a zero-proposal latest
 * attempt) and so is the proposals PATCH, so the only way forward is the
 * breakdown task itself. Say so, and point straight at it.
 */
function renderPlannerAttemptRecovery(breakdown) {
  const taskId = breakdown?.task_id ? String(breakdown.task_id) : '';
  const attempt = Number(breakdown?.attempt ?? 0);
  const label = attempt > 0 ? `Attempt ${attempt}` : 'The latest attempt';
  return `<section class="planner-attempt-recovery" aria-label="Recover the failed attempt">
    <p><strong>${escapeHtml(`${label} did not produce steps.`)}</strong> The steps above are from the last completed attempt and are read only until this attempt is resolved. Retry the breakdown task, or start a new breakdown above.</p>
    ${taskId ? `<button type="button" class="planner-step-open text-button" data-open-task="${escapeHtml(taskId)}" title="Open the breakdown task in Task Activity">Open breakdown task #${escapeHtml(taskId)}</button>` : ''}
  </section>`;
}

function renderPlannerRefine(capable) {
  const active = breakdownIsActive(state.planner.breakdown);
  const attempt = Number(state.planner.breakdown?.attempt ?? state.planner.plan?.breakdownCount ?? 0);
  const attemptNote = attempt > 0
    ? `Attempt ${attempt}. Refine sends your current edited steps for revision.`
    : 'Refine sends your current edited steps for revision.';
  /*
   * Refining is deliberately allowed while a run is in flight. The run holds
   * its own step snapshot, so a new attempt cannot corrupt it, and blocking
   * here created a one-way door: recovering from a failed step mid-run would
   * have required Stop, which is latched and cannot be resumed. The only bar
   * is the one the server actually enforces, an attempt already in progress.
   */
  const reason = !capable
    ? 'Restart CC Relay to refine a breakdown.'
    : active
      ? 'A breakdown attempt is already running.'
      : '';
  return `<section class="planner-refine" aria-label="Refine the breakdown">
    <label class="planner-field" for="planner-refine-feedback">
      <span>Refine breakdown</span>
      <textarea id="planner-refine-feedback" rows="2" maxlength="8000" placeholder="What should change? Merge steps 2 and 3, split the migration, add a verification step at the end."${reason ? ' disabled' : ''}></textarea>
    </label>
    <div class="planner-refine-foot">
      <span class="planner-refine-note">${escapeHtml(reason || attemptNote)}</span>
      <button id="planner-refine-start" class="button compact" type="button"${reason ? ' disabled' : ''}>Refine breakdown</button>
    </div>
  </section>`;
}

/**
 * Targeted live update. This is what the poll calls: it never replaces markup,
 * so a step the user is typing into keeps its caret, its IME composition, and
 * its native undo history while the run advances around it.
 */
function updatePlannerRunProgress() {
  const root = elements.plannerDetail;
  if (!root) return;
  const run = state.planner.run;
  const proposals = state.planner.proposals;
  const readOnly = !plannerProposalsEditable();
  root.querySelectorAll('.planner-step').forEach((node) => {
    const id = node.dataset.proposalId;
    const proposal = proposals.find((item) => String(item.id) === id);
    const status = proposalStatus(id, run);
    const chip = stepStatusPresentation(status, run?.status);
    // Must mirror renderPlannerStep exactly, or the next poll silently unlocks
    // a board the server would reject edits from.
    const locked = readOnly || stepEditingLocked(id, run);
    const step = runStepFor(run, id);
    if (node.dataset.state !== status) {
      node.dataset.state = status;
      const port = node.querySelector('.planner-step-port');
      if (port) {
        // Rewrite the port only on a real change so a running spinner is not
        // restarted by every refresh.
        port.dataset.state = status;
        port.innerHTML = `${plannerPortMarkup(status)}<span class="sr-only">${escapeHtml(chip.label)}</span>`;
      }
    }
    const chipNode = node.querySelector('.planner-step-chip');
    if (chipNode && chipNode.textContent !== chip.label) {
      chipNode.textContent = chip.label;
      chipNode.dataset.tone = chip.tone;
      chipNode.dataset.state = chip.state;
    }
    if (node.dataset.locked !== String(locked)) {
      node.dataset.locked = String(locked);
      const index = proposals.findIndex((item) => String(item.id) === id);
      const title = node.querySelector('.planner-step-title');
      const prompt = node.querySelector('.planner-step-prompt');
      if (title) title.readOnly = locked;
      if (prompt) prompt.readOnly = locked;
      const check = node.querySelector('.planner-step-check');
      if (check) check.disabled = locked;
      const removeButton = node.querySelector('.planner-step-remove');
      if (removeButton) removeButton.disabled = locked;
      node.querySelectorAll('.planner-step-move').forEach((control) => {
        // Recompute the boundary state rather than trusting the current
        // disabled flag, so unlocking cannot leave a usable control disabled.
        const atEdge = control.dataset.direction === 'up' ? index <= 0 : index >= proposals.length - 1;
        control.disabled = locked || atEdge;
      });
      node.querySelectorAll('.planner-dep-check').forEach((control) => {
        control.disabled = locked || control.dataset.cycle === 'true';
      });
    }
    const reason = node.querySelector('.planner-step-reason');
    if (reason) {
      const text = status === 'blocked' && proposal ? blockedReasonLabel(proposal, proposals, run) : '';
      if (reason.textContent !== text) reason.textContent = text;
      reason.hidden = !text;
    }
    const outcome = node.querySelector('.planner-step-outcome');
    if (outcome) {
      const errorText = status === 'failed' ? plannerStepErrorExcerpt(step) : '';
      const errorNode = outcome.querySelector('.planner-step-error-text');
      if (errorNode && errorNode.textContent !== errorText) errorNode.textContent = errorText;
      if (errorNode) errorNode.hidden = !errorText;
      const openNode = outcome.querySelector('.planner-step-open');
      if (openNode) {
        const taskId = step?.taskId ? String(step.taskId) : '';
        const label = taskId ? `Open task #${taskId}` : '';
        if (openNode.dataset.openTask !== taskId) {
          openNode.dataset.openTask = taskId;
          openNode.title = taskId ? `Open task #${taskId} in Task Activity` : '';
        }
        if (openNode.textContent !== label) openNode.textContent = label;
        openNode.hidden = !taskId;
      }
      outcome.hidden = !errorText && !step?.taskId;
    }
  });
  const { waves } = computeWaves(proposals);
  const active = activeWaveIndex(waves, run);
  root.querySelectorAll('.planner-wave-progress').forEach((node) => {
    const index = Number(node.dataset.waveIndex);
    const wave = waves[index] || [];
    const complete = wave.filter((proposal) => proposalStatus(proposal.id, run) === 'complete').length;
    const text = run && wave.length > 0 ? `${complete} of ${wave.length} complete` : '';
    if (node.textContent !== text) node.textContent = text;
    const section = node.closest('.planner-wave');
    if (section) section.dataset.active = String(run ? index === active : false);
  });
  const progress = runProgressSummary(run);
  const progressNode = root.querySelector('#planner-run-progress');
  if (progressNode) {
    const text = run ? progress.label : 'No run yet. Select the steps to run, then start the run.';
    if (progressNode.textContent !== text) progressNode.textContent = text;
  }
  const pill = root.querySelector('#planner-run-pill');
  if (pill) {
    const status = runStatusPresentation(run);
    if (pill.textContent !== status.label) pill.textContent = status.label;
    pill.dataset.tone = status.tone;
  }
  const bar = root.querySelector('#planner-run-progressbar');
  if (bar) {
    const total = Math.max(progress.total, 0);
    const percent = total > 0 ? Math.round((progress.complete / total) * 100) : 0;
    bar.style.setProperty('--planner-progress', String(percent));
    bar.setAttribute('aria-valuenow', String(progress.complete));
    bar.setAttribute('aria-valuemax', String(Math.max(total, 1)));
    bar.hidden = !run;
  }
  updatePlannerRunButton();
  updatePlannerQueueButton();
  const announcement = runAnnouncement(waves, run);
  if (announcement !== state.planner.announcement) {
    state.planner.announcement = announcement;
    if (elements.plannerRunAnnounce) elements.plannerRunAnnounce.textContent = announcement;
  }
}

function updatePlannerSelectionSummary() {
  const countEl = elements.plannerDetail.querySelector('.planner-proposals-head span');
  if (countEl) countEl.textContent = `${state.planner.selection.size} of ${state.planner.proposals.length} selected`;
  const selectAll = elements.plannerDetail.querySelector('#planner-select-all');
  if (selectAll) {
    selectAll.checked = state.planner.proposals.length > 0
      && state.planner.proposals.every((proposal) => state.planner.selection.has(proposal.id));
  }
  updatePlannerRunButton();
  updatePlannerQueueButton();
}

function updatePlannerRunButton() {
  const button = elements.plannerDetail.querySelector('#planner-run-start');
  if (!button) return;
  const session = elements.plannerDetail.querySelector('#planner-run-session');
  const hasSession = Boolean(session && session.value);
  const count = state.planner.selection.size;
  const blocked = runStartBlockReason(state.planner.run);
  button.disabled = !canRunPlan({
    hasSession,
    selectedCount: count,
    run: state.planner.run,
    busy: state.planner.busy,
  });
  const label = planRunIsActive(state.planner.run)
    ? 'Run in progress'
    : blocked ? 'Previous run draining'
      : count > 0 ? `Run ${count} step${count === 1 ? '' : 's'}` : 'Run plan';
  if (button.textContent !== label) button.textContent = label;
  if (button.title !== blocked) button.title = blocked;
  // The reason must be readable, not only a tooltip on a disabled control.
  const note = elements.plannerDetail.querySelector('#planner-run-blocked');
  if (note) {
    if (note.textContent !== blocked) note.textContent = blocked;
    note.hidden = !blocked || planRunIsActive(state.planner.run);
  }
}

function updatePlannerQueueButton() {
  const button = elements.plannerDetail.querySelector('#planner-queue-selected');
  if (!button) return;
  const session = elements.plannerDetail.querySelector('#planner-queue-session');
  const hasSession = Boolean(session && session.value);
  const count = state.planner.selection.size;
  button.disabled = state.planner.busy || !canQueueProposals({ hasSession, selectedCount: count });
  button.textContent = count > 0
    ? `Queue ${count} task${count === 1 ? '' : 's'}`
    : 'Queue selected tasks';
}

function refreshPlannerSessions() {
  // Only replace the options when they actually change, so a periodic refresh
  // does not close a dropdown the user has open or reset an unchanged selection.
  const selects = [
    ['#planner-breakdown-session', 'breakdownSessionId'],
    ['#planner-queue-session', 'queueSessionId'],
    ['#planner-run-session', 'runSessionId'],
  ];
  for (const [selector, key] of selects) {
    const node = elements.plannerDetail.querySelector(selector);
    if (!node) continue;
    const next = plannerSessionOptions(node.value || state.planner[key]);
    if (next !== node.innerHTML) {
      node.innerHTML = next;
      updatePlannerRunButton();
      updatePlannerQueueButton();
    }
  }
}

function plannerNeedsPoll() {
  return state.planner.open
    && (breakdownIsActive(state.planner.breakdown) || planRunIsActive(state.planner.run));
}

function maybeStartPlannerPoll() {
  if (plannerNeedsPoll()) startPlannerPoll();
  else stopPlannerPoll();
}

function startPlannerPoll() {
  if (state.planner.pollTimer) return;
  state.planner.pollTimer = setInterval(() => {
    refreshPlannerFromServer().catch(() => {});
  }, 2500);
}

function stopPlannerPoll() {
  if (state.planner.pollTimer) {
    clearInterval(state.planner.pollTimer);
    state.planner.pollTimer = null;
  }
}

/**
 * Background refresh. GET /api/plans/:id also reconciles an active run, so it
 * is the safe live path. Proposals are adopted only when nothing is unsaved,
 * and the board markup is rebuilt only when its structure actually changed.
 */
async function refreshPlannerFromServer() {
  const planId = state.planner.selectedPlanId;
  if (!planId) { stopPlannerPoll(); return; }
  try {
    const body = await api(`/api/plans/${planId}`);
    await textSelectionGuard.waitForClear();
    if (state.planner.selectedPlanId !== planId) return;
    const adoptProposals = shouldAdoptServerProposals({
      hasDirtyEdits: state.planner.dirtyProposalIds.size > 0,
      saveInFlight: state.planner.saveInFlight,
      localAttemptId: plannerAttemptId(),
      serverAttemptId: body.plan?.breakdown?.id ?? null,
    });
    applyPlannerPlan(body.plan, { adoptProposals });
    const capable = plannerV2Capable(state.status);
    const signature = plannerBoardSignature(state.planner.proposals, state.planner.run, {
      attemptId: plannerAttemptId(),
      attemptStatus: state.planner.breakdown?.status || '',
      capable,
    });
    if (signature !== state.planner.boardSignature) renderPlannerBoard();
    else updatePlannerRunProgress();
    if (!plannerNeedsPoll()) {
      stopPlannerPoll();
      loadPlans().catch(() => {});
    }
  } catch {}
}

async function createPlan() {
  if (!plannerCapable(state.status) || !state.activeProjectPath) return;
  setPlannerMessage('');
  try {
    const body = await api('/api/plans', {
      method: 'POST',
      body: JSON.stringify({ projectPath: state.activeProjectPath, name: 'Untitled plan', content: '' }),
    });
    await loadPlans();
    await selectPlan(body.plan.id);
    const nameInput = elements.plannerDetail.querySelector('#planner-plan-name');
    if (nameInput) { nameInput.focus(); nameInput.select(); }
  } catch (error) {
    setPlannerMessage(error.message);
  }
}

async function savePlan() {
  const plan = state.planner.plan;
  if (!plan) return;
  const nameInput = elements.plannerDetail.querySelector('#planner-plan-name');
  const contentInput = elements.plannerDetail.querySelector('#planner-plan-content');
  const name = nameInput ? nameInput.value.trim() : plan.name;
  if (!name) { setPlannerMessage('A plan name is required.'); return; }
  const content = contentInput ? contentInput.value : plan.content;
  setPlannerMessage('Saving.');
  try {
    const body = await api(`/api/plans/${plan.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, content }),
    });
    state.planner.plan = { ...state.planner.plan, ...body.plan };
    setPlannerMessage('Saved.');
    renderPlannerPlanList();
    loadPlans().catch(() => {});
  } catch (error) {
    setPlannerMessage(error.message);
  }
}

async function deletePlan() {
  const plan = state.planner.plan;
  if (!plan) return;
  if (!window.confirm(`Delete plan "${plan.name}"? This cannot be undone.`)) return;
  try {
    await api(`/api/plans/${plan.id}`, { method: 'DELETE' });
    state.planner.selectedPlanId = null;
    clearPlannerPlan();
    stopPlannerPoll();
    setPlannerMessage('Plan deleted.');
    await loadPlans();
    renderPlannerDetailEmpty();
  } catch (error) {
    setPlannerMessage(error.message);
  }
}

async function requestBreakdown() {
  const plan = state.planner.plan;
  if (!plan || state.planner.busy) return;
  const sessionSelect = elements.plannerDetail.querySelector('#planner-breakdown-session');
  const guidanceInput = elements.plannerDetail.querySelector('#planner-guidance');
  const threadId = sessionSelect ? sessionSelect.value : '';
  if (!threadId) { setPlannerMessage(usesDisposableTerminalPools() ? 'Choose Codex or Claude for the breakdown.' : 'Choose a live session to run the breakdown.'); return; }
  const terminalRequest = plannerTerminalRequest(threadId);
  const provider = terminalRequest?.provider || sessionSelect.selectedOptions[0]?.dataset.provider || 'codex';
  const guidance = guidanceInput ? guidanceInput.value.trim() : '';
  const nameInput = elements.plannerDetail.querySelector('#planner-plan-name');
  const contentInput = elements.plannerDetail.querySelector('#planner-plan-content');
  state.planner.busy = true;
  setPlannerMessage('Saving the plan, then starting the breakdown.');
  try {
    // Persist the current brief so the breakdown uses the latest text.
    const saved = await api(`/api/plans/${plan.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: (nameInput ? nameInput.value.trim() : plan.name) || plan.name,
        content: contentInput ? contentInput.value : plan.content,
      }),
    });
    state.planner.plan = { ...state.planner.plan, ...saved.plan };
    state.planner.breakdownSessionId = threadId;
    const body = await api(`/api/plans/${plan.id}/breakdown`, {
      method: 'POST',
      body: JSON.stringify({ ...terminalRequest, guidance }),
    });
    state.planner.selectionAttemptId = null;
    applyPlannerPlan({ ...state.planner.plan, breakdown: body.breakdown, run: state.planner.run });
    setPlannerMessage(usesDisposableTerminalPools()
      ? 'Breakdown queued in the automatic terminal pool. Its progress shows in the task queue.'
      : 'Breakdown queued on the session. Its progress shows in the task queue.');
    renderPlannerDetail();
    maybeStartPlannerPoll();
    load().catch(() => {});
  } catch (error) {
    setPlannerMessage(error.message);
  } finally {
    state.planner.busy = false;
    updatePlannerRunButton();
    updatePlannerQueueButton();
  }
}

/**
 * Persist proposals. Dirty ids are cleared only for entries whose local value
 * still matches what was sent, so a keystroke that lands while the PATCH is in
 * flight keeps its id dirty and stays protected from the next refresh.
 */
async function persistProposals() {
  const plan = state.planner.plan;
  if (!plan) return false;
  const sent = state.planner.proposals.map((proposal) => ({
    id: proposal.id,
    title: proposal.title || '',
    prompt: proposal.prompt || '',
    dependsOn: dependencyIds(proposal),
  }));
  state.planner.saveInFlight = true;
  try {
    await api(`/api/plans/${plan.id}/breakdown`, {
      method: 'PATCH',
      body: JSON.stringify({ proposals: sent }),
    });
    for (const entry of sent) {
      const current = state.planner.proposals.find((proposal) => proposal.id === entry.id);
      if (!current) { state.planner.dirtyProposalIds.delete(entry.id); continue; }
      const unchanged = (current.title || '') === entry.title
        && (current.prompt || '') === entry.prompt
        && dependencyIds(current).join('+') === entry.dependsOn.join('+');
      if (unchanged) state.planner.dirtyProposalIds.delete(entry.id);
    }
    return true;
  } catch (error) {
    setPlannerMessage(error.message);
    return false;
  } finally {
    state.planner.saveInFlight = false;
  }
}

function schedulePersistProposals() {
  clearTimeout(plannerProposalSaveTimer);
  plannerProposalSaveTimer = setTimeout(() => { persistProposals().catch(() => {}); }, 700);
}

/**
 * Flush any debounced edit before an action that depends on server state.
 *
 * This throws when the save fails. Refine and Run are seeded from the persisted
 * proposals, so proceeding after a failed flush would send the server's older
 * copy and then discard the user's newer edits when the result is adopted. A
 * second tab that already moved the breakdown on is the realistic cause.
 */
async function flushProposalEdits() {
  clearTimeout(plannerProposalSaveTimer);
  if (state.planner.proposals.length === 0) return;
  const saved = await persistProposals();
  if (!saved) throw new Error('Your latest step edits could not be saved, so nothing was started. Reopen the plan to load the current steps and try again.');
}

function markProposalDirty(id) {
  state.planner.dirtyProposalIds.add(id);
}

async function queueSelectedProposals() {
  const plan = state.planner.plan;
  if (!plan || state.planner.busy) return;
  const sessionSelect = elements.plannerDetail.querySelector('#planner-queue-session');
  const threadId = sessionSelect ? sessionSelect.value : '';
  if (!threadId) { setPlannerMessage(usesDisposableTerminalPools() ? 'Choose Codex or Claude for these tasks.' : 'Choose a live session to queue the tasks on.'); return; }
  const terminalRequest = plannerTerminalRequest(threadId);
  const provider = terminalRequest?.provider || sessionSelect.selectedOptions[0]?.dataset.provider || 'codex';
  const chosen = selectedProposals(state.planner.proposals, state.planner.selection);
  if (chosen.length === 0) { setPlannerMessage('Select at least one task to queue.'); return; }
  state.planner.busy = true;
  updatePlannerQueueButton();
  setPlannerMessage(`Queueing ${chosen.length} task${chosen.length === 1 ? '' : 's'}.`);
  try {
    // Persist any in-progress edits before queueing the selected proposals.
    await flushProposalEdits();
    const body = await api(`/api/plans/${plan.id}/breakdown/queue`, {
      method: 'POST',
      body: JSON.stringify({ proposals: chosen, ...terminalRequest }),
    });
    const count = Array.isArray(body.tasks) ? body.tasks.length : chosen.length;
    const target = plannerProjectSessions().find((thread) => thread.id === threadId);
    setPlannerMessage(`Queued ${count} task${count === 1 ? '' : 's'} on ${target ? threadDisplayName(target) : 'the selected provider'}.`);
    state.planner.selection = new Set();
    updatePlannerSelectionSummary();
    const proposalSelects = elements.plannerDetail.querySelectorAll('.planner-step-check, #planner-select-all');
    proposalSelects.forEach((input) => { input.checked = false; });
    load().catch(() => {});
  } catch (error) {
    setPlannerMessage(error.message);
  } finally {
    state.planner.busy = false;
    updatePlannerQueueButton();
  }
}

/**
 * Start a plan run. Nothing here executes on its own: the run exists only
 * because the user pressed this button, exactly like the v1 queue action.
 */
async function startPlanRun() {
  const plan = state.planner.plan;
  if (!plan || state.planner.busy) return;
  const sessionSelect = elements.plannerDetail.querySelector('#planner-run-session');
  const threadId = sessionSelect ? sessionSelect.value : '';
  if (!threadId) { setPlannerMessage(usesDisposableTerminalPools() ? 'Choose Codex or Claude for this run.' : 'Choose a live session to run the plan on.'); return; }
  /*
   * Re-validate against the run as it stands at press time, not as it stood
   * when the checkboxes were seeded. A refinement landing mid-run can select
   * steps that were only in flight then; if the run has since completed them,
   * running again would repeat finished work on stale consent.
   */
  const { runnable: chosen, dropped } = runnableSelection(
    state.planner.proposals,
    state.planner.selection,
    state.planner.run,
  );
  if (dropped.length > 0) {
    for (const proposal of dropped) state.planner.selection.delete(proposal.id);
    updatePlannerSelectionSummary();
    const boxes = elements.plannerDetail.querySelectorAll('.planner-step-check');
    boxes.forEach((box) => {
      const id = box.closest('[data-proposal-id]')?.dataset.proposalId;
      if (dropped.some((proposal) => String(proposal.id) === id)) box.checked = false;
    });
  }
  if (chosen.length === 0) {
    setPlannerMessage(dropped.length > 0
      ? 'Every selected step was already completed by the current run. Select the steps you want to run again.'
      : 'Select at least one step to run.');
    return;
  }
  const settings = plannerRunSettings(threadId);
  const terminalRequest = plannerTerminalRequest(threadId);
  state.planner.busy = true;
  updatePlannerRunButton();
  setPlannerMessage(`Starting the plan run with ${chosen.length} step${chosen.length === 1 ? '' : 's'}.${
    dropped.length > 0 ? ` ${dropped.length} step${dropped.length === 1 ? '' : 's'} the current run already completed ${dropped.length === 1 ? 'was' : 'were'} left out.` : ''
  }`);
  try {
    await flushProposalEdits();
    const body = await api(`/api/plans/${plan.id}/run`, {
      method: 'POST',
      body: JSON.stringify({
        proposalIds: chosen.map((proposal) => proposal.id),
        ...terminalRequest,
        preferIdleTerminal: !usesDisposableTerminalPools() && state.planner.runPreferIdle,
        ...(settings?.model ? { model: settings.model } : {}),
        ...(settings?.effort ? { effort: settings.effort } : {}),
      }),
    });
    state.planner.runSessionId = threadId;
    if (body.plan) applyPlannerPlan({ ...body.plan, run: body.run || body.plan.run || null }, { adoptProposals: false });
    else state.planner.run = body.run || null;
    const target = plannerProjectSessions().find((thread) => thread.id === threadId);
    setPlannerMessage(`Plan run started on ${target ? threadDisplayName(target) : 'the selected provider'}.`);
    renderPlannerBoard();
    maybeStartPlannerPoll();
    load().catch(() => {});
    loadPlans().catch(() => {});
  } catch (error) {
    setPlannerMessage(error.message);
  } finally {
    state.planner.busy = false;
    updatePlannerRunButton();
  }
}

async function stopPlanRun() {
  const plan = state.planner.plan;
  if (!plan || state.planner.busy) return;
  state.planner.busy = true;
  updatePlannerRunButton();
  setPlannerMessage('Stopping the plan run.');
  try {
    const body = await api(`/api/plans/${plan.id}/run/stop`, { method: 'POST', body: JSON.stringify({}) });
    if (body.plan) applyPlannerPlan({ ...body.plan, run: body.run || body.plan.run || null }, { adoptProposals: false });
    else state.planner.run = body.run || null;
    setPlannerMessage('Plan run stopped. No further steps will be enqueued. Tasks already running continue and can be cancelled from the queue.');
    renderPlannerBoard();
    maybeStartPlannerPoll();
    loadPlans().catch(() => {});
  } catch (error) {
    setPlannerMessage(error.message);
  } finally {
    state.planner.busy = false;
    updatePlannerRunButton();
  }
}

async function refineBreakdown() {
  const plan = state.planner.plan;
  if (!plan || state.planner.busy) return;
  const input = elements.plannerDetail.querySelector('#planner-refine-feedback');
  const feedback = input ? input.value.trim() : '';
  if (!feedback) { setPlannerMessage('Describe what should change before refining.'); return; }
  state.planner.busy = true;
  setPlannerMessage('Saving your current steps, then starting the refinement.');
  try {
    // The refinement is seeded with the steps as they are edited right now, so
    // they must be persisted before the attempt starts.
    await flushProposalEdits();
    const sessionId = usesDisposableTerminalPools()
      ? `automatic:${state.planner.breakdown?.provider || 'codex'}`
      : state.planner.breakdown?.session_id || state.planner.breakdownSessionId || '';
    const thread = plannerProjectSessions().find((item) => item.id === sessionId);
    const terminalRequest = plannerTerminalRequest(sessionId);
    const body = await api(`/api/plans/${plan.id}/breakdown/refine`, {
      method: 'POST',
      body: JSON.stringify({
        feedback,
        ...(terminalRequest || (sessionId
          ? { threadId: sessionId, provider: thread ? threadProvider(thread) : (state.planner.breakdown?.provider || 'codex') }
          : {})),
      }),
    });
    state.planner.selectionAttemptId = null;
    applyPlannerPlan({ ...state.planner.plan, breakdown: body.breakdown, run: state.planner.run });
    setPlannerMessage(usesDisposableTerminalPools()
      ? 'Refinement queued in the automatic terminal pool. Your current steps were sent for revision.'
      : 'Refinement queued on the session. Your current steps were sent for revision.');
    renderPlannerDetail();
    maybeStartPlannerPoll();
    load().catch(() => {});
  } catch (error) {
    setPlannerMessage(error.message);
  } finally {
    state.planner.busy = false;
  }
}

function addPlannerStep() {
  if (!plannerV2Capable(state.status)) return;
  if (state.planner.breakdown?.status !== 'complete') {
    setPlannerMessage('Break the plan into steps first, then add your own.');
    return;
  }
  const next = addProposal(state.planner.proposals, { title: 'New step', prompt: '' });
  const added = next[next.length - 1];
  state.planner.proposals = next;
  state.planner.selection.add(added.id);
  markProposalDirty(added.id);
  renderPlannerBoard();
  const node = elements.plannerDetail.querySelector(`[data-proposal-id="${CSS.escape(added.id)}"] .planner-step-title`);
  if (node) { node.focus(); node.select(); }
  persistProposals().catch(() => {});
}

elements.plannerButton.addEventListener('click', () => { openPlanner().catch((error) => setPlannerMessage(error.message)); });
elements.plannerClose.addEventListener('click', closePlanner);
elements.plannerModal.addEventListener('click', (event) => {
  if (event.target === elements.plannerModal) closePlanner();
});
elements.plannerModal.addEventListener('close', () => {
  state.planner.open = false;
  stopPlannerPoll();
});
elements.plannerNewPlan.addEventListener('click', () => { createPlan().catch((error) => setPlannerMessage(error.message)); });
elements.plannerPlanList.addEventListener('click', (event) => {
  const item = event.target.closest('[data-plan-id]');
  if (item) selectPlan(Number(item.dataset.planId));
});
elements.plannerDetail.addEventListener('click', (event) => {
  const move = event.target.closest('.planner-step-move');
  if (move) {
    const id = move.closest('[data-proposal-id]')?.dataset.proposalId;
    if (id) {
      state.planner.proposals = moveProposal(state.planner.proposals, id, move.dataset.direction === 'up' ? -1 : 1);
      renderPlannerBoard();
      persistProposals().catch(() => {});
    }
    return;
  }
  const remove = event.target.closest('.planner-step-remove');
  if (remove) {
    const id = remove.closest('[data-proposal-id]')?.dataset.proposalId;
    if (id) {
      // Removing a step must also drop every reference to it, so the payload
      // stays a self-consistent graph.
      state.planner.proposals = pruneDanglingDependencies(removeProposal(state.planner.proposals, id));
      state.planner.selection.delete(id);
      state.planner.dirtyProposalIds.delete(id);
      renderPlannerBoard();
      persistProposals().catch(() => {});
    }
    return;
  }
  const open = event.target.closest('.planner-step-open');
  if (open && open.dataset.openTask) {
    const taskId = Number(open.dataset.openTask);
    closePlanner();
    clearTaskSearch({ render: false });
    state.taskView = 'queue';
    localStorage.setItem('relay.taskView', state.taskView);
    renderTasks();
    selectTask(taskId).catch((error) => { elements.queueSummary.textContent = error.message; });
    return;
  }
  if (event.target.closest('#planner-add-step')) { addPlannerStep(); return; }
  if (event.target.closest('#planner-save')) { savePlan(); return; }
  if (event.target.closest('#planner-delete')) { deletePlan(); return; }
  if (event.target.closest('#planner-request-breakdown')) { requestBreakdown(); return; }
  if (event.target.closest('#planner-run-start')) { startPlanRun(); return; }
  if (event.target.closest('#planner-run-stop')) { stopPlanRun(); return; }
  if (event.target.closest('#planner-refine-start')) { refineBreakdown(); return; }
  if (event.target.closest('#planner-queue-selected')) { queueSelectedProposals(); }
});
elements.plannerDetail.addEventListener('input', (event) => {
  const li = event.target.closest('[data-proposal-id]');
  if (!li) return;
  const id = li.dataset.proposalId;
  if (event.target.classList.contains('planner-step-title')) {
    state.planner.proposals = updateProposalField(state.planner.proposals, id, 'title', event.target.value);
    markProposalDirty(id);
    schedulePersistProposals();
  } else if (event.target.classList.contains('planner-step-prompt')) {
    state.planner.proposals = updateProposalField(state.planner.proposals, id, 'prompt', event.target.value);
    markProposalDirty(id);
    schedulePersistProposals();
  }
});
elements.plannerDetail.addEventListener('change', (event) => {
  if (event.target.id === 'planner-select-all') {
    state.planner.selection = event.target.checked
      ? new Set(state.planner.proposals.map((proposal) => proposal.id))
      : new Set();
    elements.plannerDetail.querySelectorAll('.planner-step-check').forEach((input) => {
      if (!input.disabled) input.checked = event.target.checked;
    });
    updatePlannerSelectionSummary();
    return;
  }
  if (event.target.classList.contains('planner-step-check')) {
    const id = event.target.closest('[data-proposal-id]')?.dataset.proposalId;
    if (id) {
      if (event.target.checked) state.planner.selection.add(id);
      else state.planner.selection.delete(id);
      updatePlannerSelectionSummary();
    }
    return;
  }
  if (event.target.classList.contains('planner-dep-check')) {
    const id = event.target.closest('[data-proposal-id]')?.dataset.proposalId;
    const dependencyId = event.target.dataset.dependencyId;
    if (id && dependencyId) {
      state.planner.proposals = toggleDependency(state.planner.proposals, id, dependencyId);
      markProposalDirty(id);
      renderPlannerBoard();
      persistProposals().catch(() => {});
    }
    return;
  }
  if (event.target.id === 'planner-queue-session') {
    state.planner.queueSessionId = event.target.value;
    updatePlannerQueueButton();
    return;
  }
  if (event.target.id === 'planner-run-session') {
    state.planner.runSessionId = event.target.value;
    updatePlannerRunButton();
    const note = elements.plannerDetail.querySelector('.planner-run-note');
    const settings = plannerRunSettings(event.target.value);
    if (note && settings) {
      note.textContent = `Uses ${settings.model || 'the default model'}${settings.effort ? ` · ${settings.effort}` : ''} from the composer for this CC Relay. Nothing runs until you start the run.`;
    }
    return;
  }
  if (event.target.id === 'planner-run-prefer-idle') {
    state.planner.runPreferIdle = event.target.checked;
    return;
  }
  if (event.target.id === 'planner-breakdown-session') {
    state.planner.breakdownSessionId = event.target.value;
  }
});

elements.form.addEventListener('submit', async (event) => {
  await submitComposerTask(event);
});

async function submitComposerTask(event, { quickSkill = null } = {}) {
  event?.preventDefault();
  /*
   * A submission already in flight owns the composer. A repeated Enter is a deliberate
   * quiet no-op: turning it into a second POST or an error message reintroduces the false
   * "missing terminal" report from task 274. See wiki/task-history.md.
   */
  if (state.submitting) {
    return;
  }
  setComposerAlert('');
  elements.formMessage.textContent = '';

  const validationIssue = quickSkill
    ? quickSkillValidationIssue(quickSkill)
    : composerValidationIssue();
  if (validationIssue) {
    setComposerAlert(validationIssue, 'validation');
    return;
  }

  let submissionMode;
  try {
    submissionMode = selectedWorkflowMode(elements.modeTabs);
  } catch (error) {
    setComposerAlert(error.message);
    return;
  }
  if (submissionMode !== state.taskMode) {
    setComposerAlert('Workflow selection changed unexpectedly. Select the workflow again before adding the task.');
    return;
  }
  if (submissionMode === 'execute' && elements.planCouncilEnabled.checked !== state.planSettings.enabled) {
    setComposerAlert('Plan council selection changed unexpectedly. Choose it again before adding the task.');
    return;
  }
  const councilRequested = submissionMode === 'execute' && state.planSettings.enabled;
  const councilSettings = councilRequested ? syncPlanCouncilSettings() : null;
  let submissionProvider = state.selectedProvider;
  if (submissionMode === 'execute') {
    try {
      submissionProvider = selectedExecutionProvider(elements.providerTabs);
    } catch (error) {
      setComposerAlert(error.message);
      return;
    }
    if (submissionProvider !== state.selectedProvider) {
      setComposerAlert('Provider selection changed unexpectedly. Select Codex, Claude, or OpenCode again before adding the task.');
      return;
    }
    if (councilRequested && submissionProvider !== 'codex') {
      setComposerAlert('Plan council needs a connected Codex council terminal.');
      return;
    }
  }
  /*
   * Workflow readiness is validated here rather than by disabling the button. These
   * conditions depend on a live process list that is replaced every four seconds, so as
   * a gate they made the composer unusable for a moment at a time; as a submit-time check
   * they produce an exact message and never block a valid prompt.
   */
  if (councilRequested && (!councilSettings?.authorModel || !councilSettings?.reviewerModel)) {
    setComposerAlert('Choose a model for both Plan council providers before building the reviewed plan.');
    return;
  }
  if (submissionMode === 'turbo') {
    /*
     * Before the first read of the fleet size, so an uncommitted edit reaches the capacity
     * check, the submission signature, and the request body alike. Committing it after the
     * signature would let a resized fleet reuse the UUID of an earlier failed attempt.
     */
    flushTurboWorkerCount();
    if (usesDisposableTerminalPools()) {
      const required = state.turboSettings.workerCount + 1;
      if (projectInstanceLimits().codex < required) {
        // Above the project ceiling the fleet is the only adjustable half of the pair.
        setComposerAlert(required > MAX_PROJECT_INSTANCES
          ? `Turbo needs ${required} Codex instances and a project allows at most ${MAX_PROJECT_INSTANCES}. Reduce concurrent executions to ${MAX_POOL_TURBO_WORKERS} or fewer.`
          : `Turbo needs ${required} Codex instances. Raise this project's Codex maximum before adding the task.`);
        return;
      }
    } else {
      const availableWorkers = turboWorkerThreads().length;
      if (availableWorkers < state.turboSettings.workerCount) {
        setComposerAlert(`Turbo needs ${state.turboSettings.workerCount} worker CC Relay${state.turboSettings.workerCount === 1 ? '' : 's'} connected in this workspace. ${availableWorkers} ${availableWorkers === 1 ? 'is' : 'are'} available.`);
        return;
      }
    }
  }
  const formData = new FormData(elements.form);
  const submissionTaskReferences = quickSkill ? [] : state.taskReferences;
  const submittedPrompt = taskReferencePrompt(
    quickSkill?.prompt || formData.get('prompt'),
    submissionTaskReferences,
  );
  const submittedTitle = quickSkill
    ? taskNamingSupported() ? quickSkill.label : ''
    : formData.get('title');
  const execution = {
    model: elements.modelSelect.value,
    effort: JSON.parse(elements.effortSelect.dataset.values || '[]')[Number(elements.effortSelect.value)] || '',
  };
  if (submissionMode === 'execute' && !councilRequested) {
    updateSelectedExecution(execution);
  }
  const runNow = quickSkill ? true : state.prioritySubmit;
  state.prioritySubmit = false;
  /*
   * Idle routing has two implementations. The backend resolves a free CC Relay at dispatch
   * time when it advertises dispatchIdleRouting, so the browser posts immediately and only
   * declares the stored preference; the server itself forces it off for anything other
   * than a non-priority Execute task. An older backend still needs the client settle loop,
   * which is the one thing that can delay task creation.
   */
  const automaticTerminals = usesDisposableTerminalPools();
  const retainTerminals = automaticTerminals
    && state.status?.capabilities?.retainedTerminalSessions === true
    && submissionProvider !== 'opencode'
    && state.keepTerminalOpen;
  const dispatchIdleRouting = state.status?.capabilities?.dispatchIdleRouting === true
    && !automaticTerminals;
  const submissionAttachments = quickSkill ? [] : state.attachments;
  const attachments = submissionAttachments.map((attachment) => ({
    name: attachment.name,
    mimeType: attachment.mimeType,
    data: attachment.data,
  }));
  /*
   * The signature identifies the intent, not the queue-position hint. runNow is excluded
   * on purpose: Ctrl+Enter, an ambiguous failure, then a plain Enter retry is one intent
   * and must reuse one UUID, or a first POST whose response was merely lost becomes a
   * second task. See public/submission-intent.js and [[duplicate-submission-review]].
   */
  const submissionSignature = submissionIntentSignature({
    mode: submissionMode,
    councilRequested,
    provider: submissionProvider,
    threadId: automaticTerminals
      ? `automatic:${state.activeProjectPath || ''}`
      : state.selectedThreadId,
    title: submittedTitle,
    prompt: submittedPrompt,
    execution,
    planSettings: state.planSettings,
    turboSettings: state.turboSettings,
    keepTerminalOpen: retainTerminals,
    attachments: submissionAttachments,
  });
  const submissionId = resolveSubmissionId(
    state.pendingSubmission,
    submissionSignature,
    () => window.crypto.randomUUID(),
  );
  state.pendingSubmission = { id: submissionId, signature: submissionSignature };
  setComposerPending(true);
  /*
   * Everything the user typed stays exactly where it is until the server has accepted the
   * task. Nothing below clears the prompt or the attachments inside this try, so any
   * failure leaves the composer ready for an immediate retry with the same submissionId.
   */
  let createdTask = null;
  let duplicateSubmission = false;
  let acceptedThreadId = null;
  try {
    const routedThreadId = automaticTerminals
      ? null
      : dispatchIdleRouting
        ? state.selectedThreadId
        : await settleIdleSubmissionThread({ runNow });
    if (!automaticTerminals && !routedThreadId) {
      setComposerAlert('Choose a connected AI session first.');
      return;
    }

    if (
      councilRequested
      && isPlanCouncilTerminalExecutionEnabled()
      && !automaticTerminals
      && !councilSettings.authorThreadId
    ) {
      setComposerAlert('Launch and choose a Claude council terminal before building the reviewed plan.');
      return;
    }

    if (councilRequested && !isClaudePlanReady()) {
      setComposerAlert(claudePlanIssue());
      return;
    }

    if (submissionMode === 'turbo') {
      const councilIssue = turboCouncilIssue();
      if (councilIssue) {
        setComposerAlert(councilIssue);
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
        ...(automaticTerminals
          ? {
            projectPath: state.activeProjectPath,
            terminalLifecycle: 'disposable',
            ...terminalRetentionRequest(retainTerminals),
            terminalLayout: terminalLayout(),
          }
          : { threadId: routedThreadId }),
        ...(isPlanCouncilTerminalExecutionEnabled() && !automaticTerminals
          ? { authorThreadId: councilSettings.authorThreadId }
          : {}),
        prompt: submittedPrompt,
        ...planCouncilRequest(councilSettings, planCouncilCatalogs()),
        attachments,
        runNow,
      }
      : submissionMode === 'turbo'
        ? {
          mode: 'turbo',
          ...(automaticTerminals
            ? {
              projectPath: state.activeProjectPath,
              terminalLifecycle: 'disposable',
              ...terminalRetentionRequest(retainTerminals),
              terminalLayout: terminalLayout(),
            }
            : { threadId: routedThreadId }),
          prompt: submittedPrompt,
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
        ...(automaticTerminals
          ? {
            projectPath: state.activeProjectPath,
            terminalLifecycle: 'disposable',
            ...terminalRetentionRequest(retainTerminals),
            ...(retainTerminals && state.status?.capabilities?.manualSessionTasks === true
              ? { manualCompletion: true }
              : {}),
            terminalLayout: terminalLayout(),
          }
          : { threadId: routedThreadId }),
        prompt: submittedPrompt,
        model: execution.model,
        effort: execution.effort || null,
        attachments,
        runNow,
        // Sent only when the backend advertises the capability, so an older backend never
        // receives a field it does not know about. The server decides whether to honour it.
        ...(dispatchIdleRouting ? { preferIdleTerminal: state.preferIdleTerminal } : {}),
    };
    if (taskNamingSupported()) {
      if (quickSkill) requestBody.title = submittedTitle;
      else requestBody.title = formData.get('title');
    }
    requestBody.submissionId = submissionId;
    const body = await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      timeoutMs: TASK_SUBMIT_TIMEOUT_MS,
      // The abort stops the browser waiting, not the server, so the task may well exist.
      // Resending is nonetheless safe because the retained submissionId resolves to it.
      timeoutMessage: (seconds) => `CC Relay did not answer within ${seconds} seconds. The task may still have been created. Sending it again is safe and will not create a duplicate.`,
    });
    createdTask = body.task;
    duplicateSubmission = body.duplicateSubmission === true;
    acceptedThreadId = createdTask.thread_id || routedThreadId || null;
  } catch (error) {
    setComposerAlert(error.message);
  } finally {
    setComposerPending(false);
  }

  if (!createdTask) {
    return;
  }

  /*
   * A duplicate that resolved to an already finished task is NOT a successful add. The
   * sequence: a submission whose response was lost did create a task, the user never
   * retried, that task ran to completion, and much later the user deliberately sends the
   * identical prompt wanting a second run. The retained intent still matches, so the
   * server correctly returns the old finished task. Treating that as a normal success
   * would clear the composer, select a finished task, and run nothing at all.
   *
   * So: drop the pending intent (the next submit mints a fresh UUID and genuinely runs),
   * keep the prompt and its attachments, select the existing task, and say plainly what
   * happened. A duplicate that is still waiting or running is a real in-flight task, and
   * selecting it while clearing the composer remains correct there.
   */
  if (duplicateSubmission && isFinishedTaskStatus(createdTask.status)) {
    state.pendingSubmission = null;
    clearTaskSearch({ render: false });
    state.taskView = 'queue';
    state.selectedTaskId = createdTask.id;
    localStorage.setItem('relay.taskView', state.taskView);
    setComposerAlert(
      quickSkill
        ? `This saved skill was already accepted as task ${createdTask.id}, which has finished. Click ${quickSkill.label} again to run it as a new task.`
        : `This exact prompt was already accepted as task ${createdTask.id}, which has finished. Press Enter again to run it as a new task.`,
      'notice',
    );
    try {
      await load({ fresh: true });
    } catch (error) {
      elements.queueSummary.textContent = error.message;
    }
    return;
  }

  /*
   * The task exists on the server from here on. Nothing below may be reported as a failed
   * add: a refresh problem is a refresh problem, and the old code reported it in the
   * composer after the prompt had already been cleared.
   */
  if (submissionMode === 'execute' && !councilRequested) {
    rememberThreadExecution(state, createdTask.provider || submissionProvider, acceptedThreadId, {
      model: createdTask.model || execution.model,
      effort: createdTask.effort || execution.effort,
    }, { source: 'task', taskId: createdTask.id });
    if (state.selectedThreadId === acceptedThreadId) {
      renderExecutionControls();
    }
  }
  clearTaskSearch({ render: false });
  state.taskView = 'queue';
  state.selectedTaskId = createdTask.id;
  state.pendingSubmission = null;
  state.parallelTaskIds.clear();
  localStorage.setItem('relay.taskView', state.taskView);
  if (!quickSkill) {
    elements.taskName.value = '';
    elements.prompt.value = '';
    state.taskReferences = [];
    state.attachments = [];
    renderAttachmentComposer();
    renderTaskReferences();
  }
  if (councilRequested) {
    state.planSettings.enabled = false;
    renderPlanControls();
    renderExecutionControls();
    renderPromptCopy();
  }
  updateSubmitState();
  if (duplicateSubmission) {
    // Still waiting or running, so this is the same live task the user already asked for.
    // Ordinary submits clear the accepted draft. Saved skills keep the unrelated draft.
    setComposerAlert(
      quickSkill
        ? `This saved skill was already queued as task ${createdTask.id}. Showing that task instead of adding a second one.`
        : `This prompt was already queued as task ${createdTask.id}. Showing that task instead of adding a second one.`,
      'notice',
    );
  }
  try {
    // fresh: true so this cannot join a snapshot requested before the task existed.
    await load({ fresh: true });
  } catch (error) {
    elements.queueSummary.textContent = error.message;
  }
}

elements.standupButton.addEventListener('click', openStandup);
elements.clearTaskNotificationsButton.addEventListener('click', async () => {
  const reviews = state.projectCompletionNotifications.taskIds(state.activeProjectPath)
    .map((taskId) => state.tasks.find((task) => task.id === taskId))
    .filter(Boolean)
    .map((task) => ({ taskId: task.id, finishedAt: task.finished_at ?? null }));
  if (!reviews.length) return;
  elements.clearTaskNotificationsButton.disabled = true;
  try {
    const result = await api('/api/tasks/review-project', {
      method: 'POST',
      body: JSON.stringify({ projectPath: state.activeProjectPath, reviews }),
    });
    await load({ fresh: true });
    const count = Number(result.reviewedCount) || 0;
    elements.queueSummary.textContent = `${count} task${count === 1 ? '' : 's'} marked as reviewed`;
  } catch (error) {
    elements.queueSummary.textContent = error.message;
    elements.clearTaskNotificationsButton.disabled = false;
  }
});
elements.taskSearchInput.addEventListener('input', () => {
  state.taskSearchSequence += 1;
  state.taskSearchQuery = elements.taskSearchInput.value.slice(0, 200);
  state.taskSearchResults = [];
  state.taskSearchTotal = 0;
  state.taskSearchError = '';
  state.taskSearchPending = taskSearchActive(state.taskSearchQuery);
  renderStatus();
  renderTasks();
  scheduleTaskSearch();
});
elements.taskSearchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && taskSearchActive(state.taskSearchQuery)) {
    event.preventDefault();
    clearTaskSearch({ focus: true });
  } else if (event.key === 'Enter' && taskSearchActive(state.taskSearchQuery)) {
    event.preventDefault();
    scheduleTaskSearch(0);
  }
});
elements.taskSearchClear.addEventListener('click', () => {
  clearTaskSearch({ focus: true });
});
document.addEventListener('keydown', (event) => {
  if (
    event.key !== '/'
    || event.metaKey
    || event.ctrlKey
    || event.altKey
    || event.target?.closest?.('input, textarea, select, [contenteditable="true"]')
    || document.querySelector('dialog[open]')
    || elements.taskSearchInput.disabled
  ) return;
  event.preventDefault();
  elements.taskSearchInput.focus();
  elements.taskSearchInput.select();
});
elements.standupClose.addEventListener('click', closeStandup);
elements.standupCancel.addEventListener('click', closeStandup);
elements.standupGenerate.addEventListener('click', () => {
  void generateStandup();
});
elements.standupCopy.addEventListener('click', copyStandup);
elements.standupFollowUpForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void askStandupFollowUp();
});
elements.standupFollowUpInput.addEventListener('input', () => {
  state.standupFollowUpError = '';
  renderStandup();
});
elements.standupFollowUpInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  void askStandupFollowUp();
});
for (const suggestion of elements.standupFollowUpSuggestions.querySelectorAll('[data-standup-question]')) {
  suggestion.addEventListener('click', () => {
    void askStandupFollowUp(suggestion.dataset.standupQuestion);
  });
}
elements.standupCustomPrompt.addEventListener('input', () => {
  state.standupPromptEdited = (
    standupCustomPromptDraft() !== projectStandupCustomPrompt()
  );
  state.standupPromptStatus = '';
  renderStandupCustomPrompt();
});
elements.standupCustomPromptSave.addEventListener('click', () => {
  void saveStandupCustomPrompt();
});
elements.standupDate.addEventListener('change', () => {
  state.standupDate = elements.standupDate.value;
  void generateStandup();
});
elements.standupDays.addEventListener('change', () => {
  state.standupDays = selectedStandupDays();
  updateStandupDateMaximum();
  void generateStandup();
});
elements.standupModal.addEventListener('click', (event) => {
  if (event.target === elements.standupModal) closeStandup();
});
elements.standupModal.addEventListener('close', resetStandupCopyFeedback);

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
function constrainPanelWidths(composer, queue) {
  const available = Math.max(elements.workspace.clientWidth, 0);
  const minimumQueue = 360;
  const minimumComposer = 400;
  const minimumDetail = 420;
  const maxComposer = Math.max(minimumComposer, available - minimumQueue - minimumDetail);
  const nextComposer = Math.min(Math.max(composer, minimumComposer), maxComposer);
  const maxQueue = Math.max(minimumQueue, available - nextComposer - minimumDetail);
  return {
    composer: nextComposer,
    queue: Math.min(Math.max(queue, minimumQueue), maxQueue),
    legacyDetail: null,
  };
}

function applyPanelWidths({ persist = false } = {}) {
  if (!Number.isFinite(state.panelWidths.queue)) {
    const available = Math.max(elements.workspace.clientWidth, 0);
    state.panelWidths.queue = Number.isFinite(state.panelWidths.legacyDetail)
      ? available - 64 - state.panelWidths.composer - state.panelWidths.legacyDetail
      : 440;
  }
  state.panelWidths = constrainPanelWidths(state.panelWidths.composer, state.panelWidths.queue);
  elements.workspace.style.setProperty('--composer-width', `${state.panelWidths.composer}px`);
  elements.workspace.style.setProperty('--queue-width', `${state.panelWidths.queue}px`);
  elements.composerQueueResizer.setAttribute('aria-valuenow', String(Math.round(state.panelWidths.composer)));
  elements.queueDetailResizer.setAttribute('aria-valuenow', String(Math.round(state.panelWidths.queue)));
  elements.composerQueueResizer.setAttribute('aria-valuemin', '400');
  elements.composerQueueResizer.setAttribute('aria-valuemax', String(Math.round(Math.max(400, elements.workspace.clientWidth - state.panelWidths.queue - 420))));
  elements.composerQueueResizer.setAttribute('aria-valuetext', `Prompt panel ${Math.round(state.panelWidths.composer)} pixels wide`);
  elements.queueDetailResizer.setAttribute('aria-valuemin', '360');
  elements.queueDetailResizer.setAttribute('aria-valuemax', String(Math.round(Math.max(360, elements.workspace.clientWidth - state.panelWidths.composer - 420))));
  elements.queueDetailResizer.setAttribute('aria-valuetext', `Task queue ${Math.round(state.panelWidths.queue)} pixels wide`);
  if (persist) {
    queueUiPreferencesSave();
  }
}

function attachWorkspaceResizer(handle, side) {
  const resizeBy = (delta) => {
    if (side === 'composer') state.panelWidths.composer += delta;
    else state.panelWidths.queue += delta;
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
        : { ...startingWidths, queue: startingWidths.queue + delta };
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
attachWorkspaceResizer(elements.queueDetailResizer, 'queue');
applyPanelWidths();
window.addEventListener('resize', () => applyPanelWidths());

elements.taskDetailOpen.addEventListener('click', openTaskDetailModal);
elements.taskDetailModalClose.addEventListener('click', closeTaskDetailModal);
elements.taskDetailModal.addEventListener('click', (event) => {
  if (event.target === elements.taskDetailModal) closeTaskDetailModal();
});

elements.taskDiffClose.addEventListener('click', closeTaskDiffModal);
for (const button of elements.taskDiffScopeButtons) {
  button.addEventListener('click', () => selectTaskDiffScope(button.dataset.taskDiffScope));
}
elements.taskDiffModal.addEventListener('click', (event) => {
  if (event.target === elements.taskDiffModal) closeTaskDiffModal();
});
/*
 * Esc and the backdrop both reach this one event, so the interval is retired here rather
 * than in each caller. Native dialog close also returns focus to the trigger.
 */
elements.taskDiffModal.addEventListener('close', () => {
  stopTaskDiffPolling();
  rememberTaskDiffCollapse();
  /*
   * A native dialog returns focus to whatever was focused when it opened, but the detail
   * refresh replaces the whole action row every two seconds, so by the time the reader
   * presses Esc that node is detached and focus falls to the document body. Only an
   * orphaned focus is repaired: moving it unconditionally would steal focus during the
   * task-switch close, which live refreshes are never allowed to do.
   */
  const orphaned = document.activeElement === document.body
    || document.activeElement === document.documentElement
    || document.activeElement === null;
  if (orphaned) elements.detailActions.querySelector('[data-task-diff-trigger]')?.focus();
});
elements.taskDiffTree.addEventListener('click', (event) => {
  const row = event.target.closest?.('.task-diff-file-row');
  if (row && elements.taskDiffTree.contains(row)) selectTaskDiffFile(row.dataset.diffPath);
});

function closeDesktopUpdateModal() {
  if (elements.desktopUpdateModal.open) elements.desktopUpdateModal.close();
}

elements.desktopUpdateIndicator.addEventListener('click', () => {
  if (!elements.desktopUpdateIndicator.hidden && !elements.desktopUpdateModal.open) {
    elements.desktopUpdateModal.showModal();
  }
});
elements.desktopUpdateClose.addEventListener('click', closeDesktopUpdateModal);
elements.desktopUpdateDismiss.addEventListener('click', closeDesktopUpdateModal);
elements.desktopUpdateModal.addEventListener('click', (event) => {
  if (event.target === elements.desktopUpdateModal) closeDesktopUpdateModal();
});

function updateTerminalHeightAccessibility(height, maximum) {
  elements.terminalHeightResizer.setAttribute('aria-valuenow', String(Math.round(height)));
  elements.terminalHeightResizer.setAttribute('aria-valuemin', '180');
  elements.terminalHeightResizer.setAttribute('aria-valuemax', String(Math.round(maximum)));
  elements.terminalHeightResizer.setAttribute('aria-valuetext', `Terminal ${Math.round(height)} pixels high`);
}

function applyTerminalHeight({ persist = false } = {}) {
  if (!elements.taskDetail.clientHeight) {
    elements.taskDetail.style.removeProperty('--event-terminal-height');
    return;
  }
  const headerHeight = elements.taskDetail.querySelector?.('.detail-header')?.getBoundingClientRect().height || 100;
  const maximum = Math.max(180, elements.taskDetail.clientHeight - Math.max(100, headerHeight));
  if (!state.terminalHeight) {
    elements.taskDetail.style.removeProperty('--event-terminal-height');
    // Docked in the Terminal window the section sits outside the detail grid, so its
    // rendered height is the dialog's and says nothing about the resizer's range.
    if (!terminalWindowIsDocked()) {
      const renderedHeight = elements.eventsSection.getBoundingClientRect().height;
      updateTerminalHeightAccessibility(renderedHeight, maximum);
    }
    return;
  }
  state.terminalHeight = Math.min(maximum, Math.max(180, state.terminalHeight));
  elements.taskDetail.style.setProperty('--event-terminal-height', `${state.terminalHeight}px`);
  updateTerminalHeightAccessibility(state.terminalHeight, maximum);
  if (persist) queueUiPreferencesSave();
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
  const renderedHeight = elements.eventsSection.getBoundingClientRect().height;
  state.terminalHeight = (state.terminalHeight || renderedHeight) + (event.key === 'ArrowUp' ? 20 : -20);
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
  state.terminalSettings = {
    ...state.terminalSettings,
    preferIdleTerminal: state.preferIdleTerminal,
  };
  void saveProjectTerminalSettings();
});
elements.keepTerminalOpen.addEventListener('change', () => {
  state.keepTerminalOpen = elements.keepTerminalOpen.checked;
  state.terminalSettings = {
    ...state.terminalSettings,
    keepTerminalOpen: state.keepTerminalOpen,
  };
  // The Turbo fleet sentence states whether the terminals close, so it follows this toggle
  // immediately rather than waiting for the settings request to settle.
  renderTurboControls();
  void saveProjectTerminalSettings();
});
/*
 * The instance steppers live inside the provider tabs, which sit inside the task form. Enter
 * in a number field is an implicit form submission, so an unguarded Return while editing a
 * maximum would queue the prompt. Blurring instead commits the value through the change
 * listener below exactly once. The steppers are siblings of the tab buttons, never children,
 * so no click, key, or spinner interaction here reaches provider selection.
 */
for (const input of [
  elements.maxCodexInstances,
  elements.maxClaudeInstances,
  elements.maxOpenCodeInstances,
]) {
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    input.blur();
  });
}
function syncNumberSteppers() {
  for (const button of document.querySelectorAll('[data-step-input]')) {
    const input = document.getElementById(button.dataset.stepInput);
    button.disabled = input.disabled || (Number(button.dataset.step) < 0
      ? Number(input.value) <= Number(input.min)
      : Number(input.value) >= Number(input.max));
  }
}

document.querySelectorAll('[data-step-input]').forEach((button) => {
  const input = document.getElementById(button.dataset.stepInput);
  button.addEventListener('click', () => {
    if (input.disabled) return;
    const before = input.value;
    if (Number(button.dataset.step) < 0) input.stepDown();
    else input.stepUp();
    if (input.value !== before) input.dispatchEvent(new Event('change', { bubbles: true }));
    syncNumberSteppers();
  });
  input.addEventListener('change', syncNumberSteppers);
  new MutationObserver(syncNumberSteppers).observe(input, { attributes: true, attributeFilter: ['disabled', 'min', 'max'] });
});
syncNumberSteppers();

elements.maxCodexInstances.addEventListener('change', saveProjectInstanceLimits);
elements.maxClaudeInstances.addEventListener('change', saveProjectInstanceLimits);
elements.maxOpenCodeInstances.addEventListener('change', saveProjectInstanceLimits);
elements.addProjectButton.addEventListener('click', () => chooseProject(false));
elements.projectList.addEventListener('dragstart', (event) => {
  const handle = event.target.closest('[data-project-action="reorder"]');
  const chip = handle?.closest('[data-project-id]');
  if (
    !handle
    || !chip
    || !event.dataTransfer
    || handle.getAttribute('aria-disabled') === 'true'
    || !projectReorderSupported()
    || state.projectReorderPending
    || state.projectDrag
  ) {
    event.preventDefault();
    return;
  }
  const draggedId = Number(chip.dataset.projectId);
  const expectedProjectIds = projectOrderIds(state.projects);
  if (!expectedProjectIds.includes(draggedId)) {
    event.preventDefault();
    return;
  }
  state.projectDrag = {
    draggedId,
    expectedProjectIds,
    targetId: null,
    edge: null,
  };
  state.projectDragClickSuppressed = true;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', String(draggedId));
  const accent = getComputedStyle(chip).getPropertyValue('--project-accent').trim();
  if (accent) elements.projectList.style.setProperty('--project-drag-accent', accent);
  chip.classList.add('project-dragging');
});
elements.projectList.addEventListener('dragover', (event) => {
  const drag = state.projectDrag;
  const chip = event.target.closest('[data-project-id]');
  const targetId = Number(chip?.dataset.projectId);
  if (!drag) return;
  scrollProjectListForDrag(event.clientX);
  clearProjectDropMarkers();
  elements.projectList
    .querySelector(`[data-project-id="${drag.draggedId}"]`)
    ?.classList.add('project-dragging');
  if (!chip || !drag.expectedProjectIds.includes(targetId)) {
    drag.targetId = null;
    drag.edge = null;
    return;
  }
  if (targetId === drag.draggedId) {
    drag.targetId = null;
    drag.edge = null;
    return;
  }
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  drag.targetId = targetId;
  drag.edge = projectDropEdge(event, chip);
  chip.classList.add(drag.edge === 'before' ? 'project-drop-before' : 'project-drop-after');
});
elements.projectList.addEventListener('dragleave', (event) => {
  if (!event.relatedTarget || !elements.projectList.contains(event.relatedTarget)) {
    clearProjectDropMarkers();
  }
});
elements.projectList.addEventListener('drop', (event) => {
  const drag = state.projectDrag;
  const chip = event.target.closest('[data-project-id]');
  const targetId = Number(chip?.dataset.projectId);
  if (!drag || !chip || !drag.expectedProjectIds.includes(targetId)) {
    cleanupProjectDrag({ suppressClick: true });
    return;
  }
  event.preventDefault();
  const edge = targetId === drag.targetId && drag.edge
    ? drag.edge
    : projectDropEdge(event, chip);
  const projectIds = dropProjectInOrder(
    drag.expectedProjectIds,
    drag.draggedId,
    targetId,
    edge,
  );
  if (!projectIds) {
    cleanupProjectDrag({ suppressClick: true });
    return;
  }
  void persistProjectOrder(drag.expectedProjectIds, projectIds, {
    focusProjectId: drag.draggedId,
  });
});
elements.projectList.addEventListener('dragend', () => {
  if (state.projectDrag) cleanupProjectDrag({ suppressClick: true });
});
elements.projectList.addEventListener('click', async (event) => {
  if (state.projectDragClickSuppressed) {
    event.preventDefault();
    return;
  }
  const button = event.target.closest('[data-project-action]');
  const chip = event.target.closest('[data-project-id]');
  if (!chip) return;
  const id = Number(chip.dataset.projectId);
  const project = state.projects.find((item) => item.id === id);
  if (!button) {
    if (project) selectProject(project.path);
    return;
  }
  if (button.dataset.projectAction === 'color') {
    openProjectColorPicker(project);
    return;
  }
  if (button.dataset.projectAction === 'delete') {
    openProjectCloseConfirmation(project);
    return;
  }
  if (button.dataset.projectAction === 'reorder') return;
  button.disabled = true;
  try {
    await launchProject(project, button.dataset.provider);
  } catch (error) {
    elements.formMessage.textContent = error.message;
    button.disabled = false;
  }
});
elements.projectList.addEventListener('keydown', (event) => {
  const reorderHandle = event.target.closest('[data-project-action="reorder"]');
  if (reorderHandle) {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      if (['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        elements.projectReorderStatus.textContent = 'Use Left or Right arrow to move this project.';
      }
      return;
    }
    event.preventDefault();
    if (state.projectReorderPending) return;
    const chip = reorderHandle.closest('[data-project-id]');
    const projectId = Number(chip?.dataset.projectId);
    const expectedProjectIds = projectOrderIds(state.projects);
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    const projectIds = moveProjectInOrder(expectedProjectIds, projectId, direction);
    if (!projectIds) {
      const project = state.projects.find((item) => item.id === projectId);
      elements.projectReorderStatus.textContent = project
        ? `${project.name} is already ${direction < 0 ? 'first' : 'last'}.`
        : '';
      return;
    }
    void persistProjectOrder(expectedProjectIds, projectIds, { focusProjectId: projectId });
    return;
  }
  const chip = event.target.closest('[data-project-id]');
  if (!chip || event.target.closest('button') || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  const project = state.projects.find((item) => item.id === Number(chip.dataset.projectId));
  if (project) selectProject(project.path);
});
elements.projectCloseDismiss.addEventListener('click', closeProjectCloseConfirmation);
elements.projectCloseCancel.addEventListener('click', closeProjectCloseConfirmation);
elements.projectCloseConfirm.addEventListener('click', confirmProjectClose);
elements.projectCloseModal.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeProjectCloseConfirmation();
});
elements.projectCloseModal.addEventListener('click', (event) => {
  if (event.target === elements.projectCloseModal) closeProjectCloseConfirmation();
});
elements.projectColorPresetList.addEventListener('click', (event) => {
  const preset = event.target.closest('[data-project-color]');
  if (!preset || state.projectColorSaving) return;
  state.projectColorDraft = normalizeProjectColor(preset.dataset.projectColor);
  renderProjectColorPicker();
});
elements.projectColorCustomInput.addEventListener('input', () => {
  if (state.projectColorSaving) return;
  state.projectColorDraft = normalizeProjectColor(elements.projectColorCustomInput.value);
  renderProjectColorPicker();
});
elements.projectColorClose.addEventListener('click', closeProjectColorPicker);
elements.projectColorCancel.addEventListener('click', closeProjectColorPicker);
elements.projectColorSave.addEventListener('click', saveProjectColor);
elements.projectColorModal.addEventListener('cancel', (event) => {
  if (state.projectColorSaving) event.preventDefault();
  else {
    state.projectColorTargetId = null;
    state.projectColorDraft = null;
  }
});
elements.projectColorModal.addEventListener('click', (event) => {
  if (event.target === elements.projectColorModal) closeProjectColorPicker();
});
for (const tab of elements.providerTabs) {
  tab.addEventListener('click', () => selectProvider(tab.dataset.provider, { focus: true }));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const availableTabs = elements.providerTabs.filter((candidate) => !candidate.disabled);
    const currentIndex = availableTabs.indexOf(tab);
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const next = availableTabs[(currentIndex + direction + availableTabs.length) % availableTabs.length];
    if (next) selectProvider(next.dataset.provider, { focus: true });
  });
}
elements.modelSelect.addEventListener('input', () => {
  updateSelectedExecution({ model: elements.modelSelect.value, effort: '' });
  renderExecutionControls();
});
elements.effortSelect.addEventListener('input', () => {
  const values = JSON.parse(elements.effortSelect.dataset.values || '[]');
  const effort = values[Number(elements.effortSelect.value)] || '';
  updateSelectedExecution({ effort });
  renderEffortSelection(selectedModel()?.supportedReasoningEfforts || [], effort);
  renderQuickSkills();
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
elements.planAuthorTerminal.addEventListener('change', () => {
  state.planSettings.authorThreadId = elements.planAuthorTerminal.value || null;
  renderPlanControls();
  updateSubmitState();
});
elements.planAuthorModel.addEventListener('input', () => {
  state.planSettings.claudeModel = elements.planAuthorModel.value;
  state.planSettings.claudeEffort = 'high';
  renderPlanControls();
  updateSubmitState();
});
elements.planAuthorEffort.addEventListener('change', () => {
  state.planSettings.claudeEffort = elements.planAuthorEffort.value;
  renderPlanControls();
});
for (const button of elements.planCouncilOrderButtons) {
  button.addEventListener('click', () => {
    state.planSettings.councilOrder = button.dataset.planCouncilFirst === 'codex'
      ? ['codex', 'claude']
      : ['claude', 'codex'];
    renderThreads();
  });
}
elements.planReviewerModel.addEventListener('input', () => {
  state.planSettings.codexModel = elements.planReviewerModel.value;
  state.planSettings.codexEffort = 'high';
  renderPlanControls();
  updateSubmitState();
});
elements.planReviewerEffort.addEventListener('change', () => {
  state.planSettings.codexEffort = elements.planReviewerEffort.value;
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
/*
 * The worker count is a number field inside the task form, so an unguarded Return while
 * editing it is an implicit form submission: a keystroke meant to commit a fleet size
 * queued a multi-terminal Turbo task instead. Blurring commits the same value once,
 * through the change listener below.
 */
elements.turboWorkerCount.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  elements.turboWorkerCount.blur();
});
/*
 * change, not input. Clamping on every keystroke made a two-digit count impossible to
 * type: "1" was committed and rewritten before the "2" arrived, and backspace then read
 * back the clamped value. Transient out-of-range text is allowed while the field is being
 * edited; this commit, the submit-time check, and the server all still bound it.
 */
elements.turboWorkerCount.addEventListener('change', () => {
  commitTurboWorkerCount();
});
/*
 * Leaving the field without editing it fires no change event, so the displayed value is
 * resynced here rather than by a forced render: the render would also rewrite six selects
 * for nothing, and it would write the stored count over digits the user is still holding.
 * A browser that blurs the element when the window loses focus keeps it as activeElement,
 * and that text is still an edit in progress, so it survives until focus really leaves.
 */
elements.turboWorkerCount.addEventListener('blur', () => {
  if (document.activeElement === elements.turboWorkerCount) return;
  const committed = String(state.turboSettings.workerCount);
  if (elements.turboWorkerCount.value !== committed) elements.turboWorkerCount.value = committed;
});
elements.turboCouncilEnabled.addEventListener('change', () => {
  state.turboSettings.councilEnabled = elements.turboCouncilEnabled.checked;
  renderThreads();
  // Council adds two more turns that receive the attached images, and the composer states
  // where images go. renderThreads does not reach the attachment copy on its own.
  renderAttachmentComposer();
});
for (const button of elements.turboCouncilOrderButtons) {
  button.addEventListener('click', () => {
    state.turboSettings.councilOrder = button.dataset.councilFirst === 'claude'
      ? ['claude', 'codex']
      : ['codex', 'claude'];
    renderThreads();
  });
}
elements.desktopTitlebarTokenUsage?.addEventListener('click', () => {
  setDailyTokenUsagePanel(elements.desktopTitlebarTokenPanel?.hidden === true);
});
document.addEventListener('pointerdown', (event) => {
  if (!elements.desktopTitlebarTokenPanel?.hidden
      && !event.target?.closest?.('.desktop-titlebar-token-usage')
      && !elements.desktopTitlebarTokenPanel.contains(event.target)) {
    setDailyTokenUsagePanel(false);
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements.desktopTitlebarTokenPanel?.hidden) {
    setDailyTokenUsagePanel(false);
    elements.desktopTitlebarTokenUsage?.focus();
  }
});
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
// Keep the submit gate in step with what the user has actually typed.
elements.taskName.addEventListener('input', () => {
  if (elements.composerAlert.dataset.kind === 'validation' && !composerValidationIssue()) {
    setComposerAlert('');
  }
  updateSubmitState();
});
elements.prompt.addEventListener('input', () => {
  if (elements.composerAlert.dataset.kind === 'validation' && !composerValidationIssue()) {
    setComposerAlert('');
  }
  updateSubmitState();
});
elements.prompt.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
    return;
  }
  event.preventDefault();
  // Progress, not a rejection. A second Enter during an in-flight submission stays quiet.
  if (state.submitting) {
    return;
  }
  const issue = composerValidationIssue();
  if (issue) {
    setComposerAlert(issue, 'validation');
    return;
  }
  state.prioritySubmit = event.ctrlKey;
  elements.form.requestSubmit();
});
bindQuickSkillEvents();
elements.taskReferenceMenu.addEventListener('click', (event) => {
  const button = event.target.closest('[data-task-reference-scope]');
  if (!button || state.taskReferenceMenuTaskId === null) return;
  attachTaskReference(state.taskReferenceMenuTaskId, button.dataset.taskReferenceScope);
});
elements.taskReferenceMenu.addEventListener('keydown', (event) => {
  const items = [...elements.taskReferenceMenu.querySelectorAll('[role="menuitem"]')];
  const current = items.indexOf(document.activeElement);
  if (event.key === 'Escape') {
    event.preventDefault();
    closeTaskReferenceMenu({ restoreFocus: true });
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? items.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
});
document.addEventListener('pointerdown', (event) => {
  if (!elements.taskReferenceMenu.hidden && !elements.taskReferenceMenu.contains(event.target)) {
    closeTaskReferenceMenu();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements.taskReferenceMenu.hidden) {
    closeTaskReferenceMenu({ restoreFocus: true });
  }
});
window.addEventListener('resize', closeTaskReferenceMenu);
window.addEventListener('scroll', closeTaskReferenceMenu, true);
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
elements.terminalSettingsButton.addEventListener('click', () => {
  resetTerminalLayoutStatus();
  renderCompletionAlertSettings();
  renderQuickSkillEditor({ rebuild: true });
  renderVoiceInput();
  elements.terminalSettingsModal.showModal();
  void refreshVoiceInputDevices({ requestPermission: state.voiceInputPreferences.enabled });
});
document.querySelector('#terminal-settings-done').addEventListener('click', () => elements.terminalSettingsModal.close());
elements.terminalSettingsClose.addEventListener('click', () => {
  elements.terminalSettingsModal.close();
});
elements.terminalSettingsModal.addEventListener('click', (event) => {
  if (event.target === elements.terminalSettingsModal) elements.terminalSettingsModal.close();
});
elements.terminalSettingsModal.addEventListener('close', () => {
  state.voiceShortcutCaptureTarget = null;
  renderVoiceInput();
});
elements.voiceInputEnabled.addEventListener('change', () => {
  setVoiceInputPreferences({
    ...state.voiceInputPreferences,
    enabled: elements.voiceInputEnabled.checked,
  });
  if (elements.voiceInputEnabled.checked) {
    void refreshVoiceInputDevices({ requestPermission: true });
  }
});
elements.voiceInputMicrophone.addEventListener('change', () => {
  setVoiceInputPreferences({
    ...state.voiceInputPreferences,
    microphoneLabel: elements.voiceInputMicrophone.value || null,
  });
  state.voiceInputMessage = elements.voiceInputMicrophone.value
    ? `Microphone set to ${elements.voiceInputMicrophone.value}.`
    : 'Voice input will use the system default microphone.';
  renderVoiceInput();
});
for (const [button, target] of [
  [elements.voiceInputShortcut, 'primary'],
  [elements.voiceInputAlternateShortcut, 'alternate'],
]) {
  button.addEventListener('click', () => {
    if (button.disabled) return;
    state.voiceShortcutCaptureTarget = target;
    renderVoiceInput();
  });
}
elements.voiceInputSetup.addEventListener('click', () => {
  void setupVoiceInput();
});
elements.completionSound.addEventListener('change', () => {
  setCompletionAlertPreferences({
    ...state.completionAlertPreferences,
    sound: elements.completionSound.value,
  });
  elements.completionAlertStatus.textContent = elements.completionSound.value === 'none'
    ? 'Completion sound is off.'
    : 'Completion sound saved.';
});
elements.completionSpeech.addEventListener('change', () => {
  setCompletionAlertPreferences({
    ...state.completionAlertPreferences,
    speak: elements.completionSpeech.checked,
  });
  elements.completionAlertStatus.textContent = elements.completionSpeech.checked
    ? 'Voice announcement enabled.'
    : 'Voice announcement off.';
});
for (const input of [
  elements.completionSpeechProject,
  elements.completionSpeechTask,
  elements.completionSpeechStatus,
]) {
  input.addEventListener('change', () => {
    const speech = {
      ...state.completionAlertPreferences.speech,
      project: elements.completionSpeechProject.checked,
      task: elements.completionSpeechTask.checked,
      status: elements.completionSpeechStatus.checked,
    };
    const hasSpokenPart = speech.project || speech.task || speech.status;
    setCompletionAlertPreferences({ ...state.completionAlertPreferences, speech });
    elements.completionAlertStatus.textContent = hasSpokenPart
      ? 'Voice announcement saved.'
      : 'Keep at least one announcement detail selected.';
  });
}
elements.completionSpeechWords.addEventListener('change', () => {
  setCompletionAlertPreferences({
    ...state.completionAlertPreferences,
    speech: {
      ...state.completionAlertPreferences.speech,
      taskWords: elements.completionSpeechWords.value,
    },
  });
  elements.completionAlertStatus.textContent = 'Task name length saved.';
});
elements.completionAlertPreview.addEventListener('click', () => {
  state.completionAlerts.notify(completionAlertExampleTask(), state.completionAlertPreferences);
  elements.completionAlertStatus.textContent = state.completionAlertPreferences.sound === 'none'
    && !state.completionAlertPreferences.speak
    ? 'Both completion alerts are off.'
    : 'Preview played.';
});

voiceRecorder = new PushToTalkRecorder({
  preferredDeviceLabel: state.voiceInputPreferences.microphoneLabel,
  onState: (activity) => {
    if (activity === 'captured') setVoiceInputActivity('processing');
    else setVoiceInputActivity(activity);
  },
  onDevice: ({ label }) => {
    state.voiceInputDeviceLabel = label;
    void refreshVoiceInputDevices();
  },
  onLevel: (level, peakLevel) => {
    state.voiceInputLevel = level;
    state.voiceInputPeakLevel = peakLevel;
    renderVoiceInputLevel();
  },
  onAudio: (audio, recording) => {
    void transcribeVoiceAudio(audio, recording);
  },
  onError: (error) => {
    state.activeVoiceShortcut = null;
    setVoiceInputActivity('error', voiceMicrophoneError(error));
  },
});
void refreshVoiceInputDevices();
navigator.mediaDevices?.addEventListener?.('devicechange', () => {
  void refreshVoiceInputDevices();
});

document.addEventListener('keydown', (event) => {
  if (state.voiceShortcutCaptureTarget) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Escape') {
      state.voiceShortcutCaptureTarget = null;
      renderVoiceInput();
      return;
    }
    if (
      state.voiceShortcutCaptureTarget === 'alternate'
      && ['Backspace', 'Delete'].includes(event.key)
    ) {
      state.voiceShortcutCaptureTarget = null;
      setVoiceInputPreferences({
        ...state.voiceInputPreferences,
        alternateShortcut: null,
      });
      return;
    }
    const shortcut = voiceShortcutFromKeyboardEvent(event);
    if (!shortcut) return;
    const target = state.voiceShortcutCaptureTarget;
    state.voiceShortcutCaptureTarget = null;
    setVoiceInputPreferences({
      ...state.voiceInputPreferences,
      ...(target === 'alternate' ? { alternateShortcut: shortcut } : { shortcut }),
    });
    return;
  }
  if (!voiceInputSupported() || document.querySelector('dialog[open]')) return;
  const matchedShortcut = [
    state.voiceInputPreferences.shortcut,
    state.voiceInputPreferences.alternateShortcut,
  ].find((shortcut) => shortcut && voiceShortcutMatches(event, shortcut));
  if (!matchedShortcut) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!event.repeat && !state.activeVoiceShortcut) {
    state.activeVoiceShortcut = matchedShortcut;
    startVoiceInput();
  }
}, true);

document.addEventListener('keyup', (event) => {
  const activeShortcut = state.activeVoiceShortcut;
  if (!activeShortcut || !voiceShortcutReleased(event, activeShortcut)) return;
  state.activeVoiceShortcut = null;
  if (!voiceRecorder?.held && state.voiceInputActivity !== 'listening') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  voiceRecorder.release();
}, true);

elements.voiceInputHold.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  elements.voiceInputHold.setPointerCapture?.(event.pointerId);
  startVoiceInput();
});
for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  elements.voiceInputHold.addEventListener(eventName, (event) => {
    if (elements.voiceInputHold.hasPointerCapture?.(event.pointerId)) {
      elements.voiceInputHold.releasePointerCapture(event.pointerId);
    }
    voiceRecorder?.release();
  });
}
elements.voiceInputHold.addEventListener('keydown', (event) => {
  if (![' ', 'Enter'].includes(event.key)) return;
  event.preventDefault();
  if (!event.repeat) startVoiceInput();
});
elements.voiceInputHold.addEventListener('keyup', (event) => {
  if (![' ', 'Enter'].includes(event.key)) return;
  event.preventDefault();
  voiceRecorder?.release();
});
window.addEventListener('blur', () => {
  state.activeVoiceShortcut = null;
  voiceRecorder?.release();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') {
    stopNativeTerminalScreenPolling();
    state.embeddedTerminalView?.disconnect();
    state.activeVoiceShortcut = null;
    voiceRecorder?.release();
  } else if (nativeTerminalViewIsActive()) void refreshNativeTerminalScreen();
});
elements.taskEditClose.addEventListener('click', closeTaskEditor);
elements.taskEditCancel.addEventListener('click', closeTaskEditor);
elements.taskEditSave.addEventListener('click', saveTaskEdit);
elements.taskEditProvider.addEventListener('change', () => {
  if (!['codex', 'claude', 'opencode'].includes(elements.taskEditProvider.value)) return;
  state.taskEditProvider = elements.taskEditProvider.value;
  const settings = state.taskEditSettings?.[state.taskEditProvider];
  const models = state.modelCatalogs[state.taskEditProvider] || [];
  const model = models.find((item) => item.model === settings?.model)
    || models.find((item) => item.isDefault)
    || models[0];
  if (settings) settings.effort = defaultEffortForModel(model);
  state.taskEditExecutionDirty = true;
  renderTaskEditExecution();
});
elements.taskEditModel.addEventListener('change', () => {
  const settings = state.taskEditSettings?.[state.taskEditProvider];
  if (!settings) return;
  settings.model = elements.taskEditModel.value;
  const models = state.modelCatalogs[state.taskEditProvider] || [];
  const model = models.find((item) => item.model === settings.model)
    || models.find((item) => item.isDefault)
    || models[0];
  settings.effort = defaultEffortForModel(model);
  state.taskEditExecutionDirty = true;
  renderTaskEditExecution();
});
elements.taskEditEffort.addEventListener('change', () => {
  const settings = state.taskEditSettings?.[state.taskEditProvider];
  if (!settings) return;
  settings.effort = elements.taskEditEffort.value;
  state.taskEditExecutionDirty = true;
});
elements.taskEditModal.addEventListener('cancel', (event) => {
  if (state.taskEditSubmitting) event.preventDefault();
  else clearTaskEditorState();
});
elements.taskEditModal.addEventListener('click', (event) => {
  if (event.target === elements.taskEditModal) closeTaskEditor();
});
elements.taskEditName.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    saveTaskEdit();
  }
});
elements.taskEditPrompt.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    saveTaskEdit();
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
elements.sessionCompleteButton.addEventListener('click', completeTerminalSession);
elements.sessionKillButton.addEventListener('click', killSessionTerminal);
elements.themeToggle.addEventListener('click', () => {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
});
elements.headerPositionToggle.addEventListener('click', () => {
  setHeaderPosition(currentHeaderPosition() === 'bottom' ? 'top' : 'bottom');
});
function renderDesktopZoomControls() {
  const supported = state.status?.capabilities?.desktopZoomControls === true;
  elements.desktopZoomControls.hidden = !supported;
  const percent = Number(state.status?.desktopZoom?.percent);
  const label = supported && Number.isFinite(percent) ? `${percent}%` : '--';
  elements.desktopZoomLevel.textContent = label;
  elements.desktopZoomLevel.title = Number.isFinite(percent)
    ? `Current zoom: ${percent}%`
    : 'Current zoom is unavailable';
}
async function changeDesktopZoom(direction, button) {
  button.disabled = true;
  try {
    const zoom = await api('/api/desktop/zoom', {
      method: 'POST',
      body: JSON.stringify({ direction }),
    });
    if (state.status) state.status.desktopZoom = zoom;
    renderDesktopZoomControls();
  } catch (error) {
    console.warn('Could not change application zoom.', error);
  } finally {
    button.disabled = false;
  }
}
elements.desktopZoomOut.addEventListener('click', () => {
  changeDesktopZoom('out', elements.desktopZoomOut);
});
elements.desktopZoomIn.addEventListener('click', () => {
  changeDesktopZoom('in', elements.desktopZoomIn);
});
elements.runningTaskRows.addEventListener('change', () => {
  setRunningTaskLayout({
    ...state.runningTaskLayout,
    rows: Number(elements.runningTaskRows.value),
  });
});
elements.runningTaskWidth.addEventListener('change', () => {
  setRunningTaskLayout({
    ...state.runningTaskLayout,
    width: Number(elements.runningTaskWidth.value),
  });
});
elements.aboutButton.addEventListener('click', () => {
  if (!elements.aboutModal.open) elements.aboutModal.showModal();
});
elements.aboutClose.addEventListener('click', () => {
  elements.aboutModal.close();
});
elements.aboutModal.addEventListener('click', (event) => {
  if (event.target === elements.aboutModal) elements.aboutModal.close();
});

if ('ResizeObserver' in window) {
  new ResizeObserver(syncHeaderHeight).observe(elements.appHeader);
}
syncHeaderHeight();
setRunningTaskLayout(state.runningTaskLayout, { persist: false });

elements.headerRunningMonitor.addEventListener('click', async (event) => {
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
  clearTaskSearch({ render: false });
  state.taskView = 'queue';
  localStorage.setItem('relay.taskView', state.taskView);
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
elements.terminalLayoutApplyAll.addEventListener('click', applyTerminalLayoutToAllProjects);

for (const button of elements.eventFilters) {
  button.addEventListener('click', () => {
    // The inline rail owns state.inlineEventFilter so a later window close restores it.
    // While the window is docked the stream belongs to the window view, so the rail
    // records the selection it will return to and leaves state.eventFilter alone.
    state.terminalMode = 'activity';
    queueUiPreferencesSave();
    if (elements.eventMoreViews) elements.eventMoreViews.open = false;
    state.inlineEventFilter = button.dataset.eventFilter;
    if (!terminalWindowIsDocked()) state.eventFilter = state.inlineEventFilter;
    renderEventStream(state.selectedTaskEvents, state.selectedTaskForEvents);
  });
}

elements.originalTerminalButton.addEventListener('click', useOriginalTerminal);
elements.originalTerminalOpen.addEventListener('click', showOriginalTerminal);
elements.originalTerminalFallback.addEventListener('click', useRelayActivity);
elements.terminalWindowOpenButton.addEventListener('click', openTerminalWindow);
elements.terminalWindowClose.addEventListener('click', closeTerminalWindow);
for (const button of elements.terminalWindowViews) {
  button.addEventListener('click', () => {
    setTerminalWindowView(button.dataset.terminalWindowView);
    if (nativeTerminalViewIsActive()) void refreshNativeTerminalScreen();
  });
}
elements.terminalWindowModal.addEventListener('click', (event) => {
  if (event.target === elements.terminalWindowModal) closeTerminalWindow();
});
/*
 * Escape reaches only the topmost dialog, so the surrounding task detail modal stays
 * open. The section is undocked here, synchronously, before the browser hides the
 * dialog; the close listener is the fallback for any programmatic close.
 */
elements.terminalWindowModal.addEventListener('cancel', (event) => {
  if (state.nativeTerminalScreen.state === 'interactive'
    && document.activeElement?.closest?.('#embedded-terminal')) {
    event.preventDefault();
    return;
  }
  undockTerminalWindow();
});
elements.terminalWindowModal.addEventListener('close', () => {
  undockTerminalWindow();
  focusTerminalWindowOpenButton();
});

elements.thinkingVisibilityButton.addEventListener('click', () => {
  state.showThinking = !state.showThinking;
  if (state.selectedTaskForEvents) {
    renderEventStream(state.selectedTaskEvents, state.selectedTaskForEvents);
  } else {
    updateThinkingVisibilityControl();
  }
});

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
  const text = nativeTerminalCopyLabel() === 'Copy screen'
    ? (state.nativeTerminalScreen.transport === 'pty'
      ? state.embeddedTerminalView?.text() || '' : elements.nativeTerminalScreenOutput.textContent) : state.visibleEventEntries
      .map((entry) => eventCopyText(entry, state.selectedTaskForEvents))
      .join('\n\n');
  try {
    await navigator.clipboard.writeText(text);
    elements.copyEventsButton.textContent = 'Copied';
  } catch {
    elements.copyEventsButton.textContent = 'Copy failed';
  }
  setTimeout(() => {
    elements.copyEventsButton.textContent = nativeTerminalCopyLabel();
  }, 1200);
});

for (const button of elements.contentCopyButtons) {
  button.addEventListener('click', (event) => {
    if (button.closest('summary')) {
      event.preventDefault();
      event.stopPropagation();
    }
    copyDetailContent(button);
  });
}

elements.detailEvents.addEventListener('scroll', () => {
  const distanceFromBottom = elements.detailEvents.scrollHeight
    - elements.detailEvents.scrollTop
    - elements.detailEvents.clientHeight;
  const following = distanceFromBottom < 36;
  if (state.eventFollow !== following) {
    state.eventFollow = following;
  }
});

elements.detailEvents.addEventListener('toggle', (event) => {
  if (!(event.target instanceof HTMLDetailsElement)) return;
  const key = eventDisclosureKey(event.target);
  if (!key) return;
  if (event.target.open) state.expandedEventDetails.add(key);
  else state.expandedEventDetails.delete(key);
}, true);

renderCompletionAlertSettings();
renderQuickSkills();
renderQuickSkillEditor({ rebuild: true });
renderVoiceInput();
const uiPreferencesReady = restoreUiPreferences();
const completionReviewsReady = migrateCompletionReviews();
const rendererStateReady = Promise.all([uiPreferencesReady, completionReviewsReady]);
const events = new EventSource('/api/events');
let refreshTimer = null;
events.addEventListener('change', (event) => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    let change = {};
    try {
      change = JSON.parse(event.data);
    } catch {}
    const operations = [rendererStateReady.then(() => load())];
    if (change.threads) {
      operations.push(loadThreads());
    }
    if (change.plans && state.planner.open) {
      operations.push(refreshPlannerFromServer());
    }
    Promise.all(operations)
      .then(() => { if (state.planner.open) refreshPlannerSessions(); })
      .catch(console.error);
  }, 150);
});

renderProviderTabs();
renderExecutionControls();
renderPlanControls();
renderTurboControls();
renderAttachmentComposer();
renderTaskReferences();
updateSubmitState();
Promise.all([rendererStateReady, rendererStateReady.then(() => load()), loadThreads({ silent: false }), loadModels('codex'), loadModels('claude'), loadModels('opencode'), loadTerminalDisplays()]).catch((error) => {
  elements.queueSummary.textContent = error.message;
});

setInterval(() => {
  loadThreads({ silent: true })
    .then(() => { if (state.planner.open) refreshPlannerSessions(); })
    .catch(console.error);
}, 4_000);

setInterval(() => {
  if (document.visibilityState === 'visible') {
    load().catch(console.error);
  }
}, SNAPSHOT_FALLBACK_POLL_MS);

setInterval(refreshTaskDurations, 1_000);
