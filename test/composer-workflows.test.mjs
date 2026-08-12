import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { continuationDispatchOutcome } from '../public/task-continuation-state.js';

const composer = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const composerApp = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const composerState = readFileSync(new URL('../public/project-composer-state.js', import.meta.url), 'utf8');
const continuationState = readFileSync(new URL('../public/task-continuation-state.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const registry = readFileSync(new URL('../src/claude-session-registry.mjs', import.meta.url), 'utf8');
const taskHistory = readFileSync(new URL('../public/task-history.js', import.meta.url), 'utf8');
const gitignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');

function taskSubmitSource() {
  const start = composerApp.indexOf("elements.form.addEventListener('submit'");
  const end = composerApp.indexOf("elements.standupButton.addEventListener", start);
  assert.ok(start >= 0 && end > start);
  return composerApp.slice(start, end);
}

test('composer exposes Execute and Forward-planning Turbo as its only workflow tabs', () => {
  const workflows = [...composer.matchAll(/class="mode-tab[^"\n]*"[^>]*data-mode="([^"]+)"/g)]
    .map((match) => match[1]);

  assert.deepEqual(workflows, ['execute', 'turbo']);
  assert.doesNotMatch(composer, /id="mode-plan"/);
});

test('Plan council is optional inside Execute and Forward-planning Turbo', () => {
  const executeStart = composer.indexOf('id="execute-config"');
  const executeCouncil = composer.indexOf('id="plan-council-enabled"');
  const turboStart = composer.indexOf('id="turbo-config"');
  const turboCouncil = composer.indexOf('id="turbo-council-enabled"');

  assert.ok(executeStart >= 0 && executeCouncil > executeStart && executeCouncil < turboStart);
  assert.ok(turboStart >= 0 && turboCouncil > turboStart);
  assert.match(composer, /Builds a reviewed, read-only plan instead of executing\./);
});

test('Execute and Forward-planning Turbo share the same Plan council option component', () => {
  const options = [...composer.matchAll(/<div class="plan-council-option[^"\n]*">([\s\S]*?)<\/label>/g)]
    .map((match) => match[1]);

  assert.equal(options.length, 2);
  assert.ok(options.every((option) => option.includes('class="plan-council-toggle"')));
  assert.ok(options.every((option) => option.includes('<strong>Use Plan council for this prompt</strong>')));
  assert.match(options[0], /id="plan-council-enabled"/);
  assert.match(options[1], /id="turbo-council-enabled"/);
});

test('both Plan council routes use the shared node and connector design', () => {
  assert.equal((composer.match(/class="council-route/g) || []).length, 2);
  assert.equal((composer.match(/class="council-node /g) || []).length, 4);
  assert.equal((composer.match(/class="council-connector"/g) || []).length, 2);
  assert.match(composer, /class="council-connector"[^>]*><span>review<\/span><b>→<\/b>/);
  assert.match(composer, /class="council-connector" aria-hidden="true"><span>review<\/span><b>→<\/b>/);
});

test('Forward-planning Turbo exposes one planning model without requiring council', () => {
  const turboStart = composer.indexOf('id="turbo-config"');
  const routeStart = composer.indexOf('id="turbo-council-route"', turboStart);
  const plannerModel = composer.indexOf('id="turbo-planner-model"', routeStart);
  const plannerEffort = composer.indexOf('id="turbo-planner-effort"', routeStart);
  const workerModel = composer.indexOf('id="turbo-worker-model"', routeStart);

  assert.ok(turboStart >= 0 && routeStart > turboStart);
  assert.ok(plannerModel > routeStart && plannerEffort > plannerModel && workerModel > plannerEffort);
  assert.match(composer, /id="turbo-planning-count"[^>]*>1 planner<\/span>/);
  assert.match(composer, /id="turbo-council-route"[^>]*data-enabled="false"/);
  assert.doesNotMatch(composerApp, /turboCouncilRoute\.hidden = !council\.councilEnabled/);
  assert.match(composerApp, /turboPlanningCount\.textContent = council\.councilEnabled \? '2 providers' : '1 planner'/);
  assert.match(composerApp, /turboCouncilCodexRole\.textContent = council\.councilEnabled[\s\S]*: 'Planner'/);
});

test('terminal settings does not break the task form ownership', () => {
  const taskFormStart = composer.indexOf('<form id="task-form">');
  const prompt = composer.indexOf('id="task-prompt"');
  const attachmentInput = composer.indexOf('id="image-input"');
  const submit = composer.indexOf('id="task-submit-button"');
  const taskFormEnd = composer.indexOf('</form>', taskFormStart);
  const formPrefix = composer.slice(taskFormStart, prompt);

  assert.ok(taskFormStart >= 0 && prompt > taskFormStart);
  assert.ok(attachmentInput > prompt && submit > attachmentInput && taskFormEnd > submit);
  assert.equal((formPrefix.match(/<form\b/g) || []).length, 1);
  assert.match(composer, /<div class="terminal-settings-card">/);
  assert.doesNotMatch(composer, /<form[^>]*class="terminal-settings-card"/);
});

test('terminal window layout settings default to enabled', () => {
  assert.match(composer, /id="terminal-layout-enabled"[^>]*\bchecked\b/);
  assert.match(composer, /id="terminal-launch-background"[^>]*\bchecked\b/);
  assert.match(composerState, /layout:\s*\{[\s\S]*enabled: true,[\s\S]*background: true,/);
  assert.match(composerApp, /terminalLayoutEnabled\.checked = settings\.layout\.enabled/);
  assert.match(composerApp, /terminalLaunchBackground\.checked = settings\.layout\.background/);
  assert.doesNotMatch(composerApp, /relay\.terminalLayout/);
});

test('terminal settings describe minimized launches and can copy window layout to every project', () => {
  assert.doesNotMatch(composer, /Copy diagnostics|Diagnostics include/);
  assert.doesNotMatch(composerApp, /copyDiagnosticsButton/);
  assert.match(composer, /Open new terminals minimized/);
  assert.match(composer, /Only the window CC Relay opens is minimized\. Other Terminal windows are untouched\./);
  assert.match(composer, /id="terminal-layout-apply-all"[^>]*>Apply to all projects<\/button>/);
  assert.match(composerApp, /api\('\/api\/projects\/terminal-layout'/);
  assert.match(server, /updateAllProjectTerminalLayouts/);
});

test('provider choice is explicit and the left panel configures automatic instance limits', () => {
  assert.match(composer, /id="launch-codex-button"[^>]*>Launch Codex<\/button>/);
  assert.match(composer, /id="launch-claude-button"[^>]*>Launch Claude<\/button>/);
  assert.doesNotMatch(composer, /id="launch-terminal-button"/);
  assert.match(composer, /id="provider-tabs" class="agent-tabs"/);
  assert.match(composer, /id="max-codex-instances"[^>]*min="1" max="8"/);
  assert.match(composer, /id="max-claude-instances"[^>]*min="1" max="8"/);
  assert.match(composerApp, /disposableTerminalPools === true/);
  assert.match(composerApp, /async function saveProjectInstanceLimits/);
  assert.match(composerApp, /terminalLifecycle: 'disposable'/);
  assert.match(composerApp, /providerInstallationState\(state\.status, tab\.dataset\.provider\)/);
  assert.match(composerApp, /tab\.disabled = missing/);
  assert.match(composerApp, /availableProviderSelection\(state\.status, state\.selectedProvider\)/);
  assert.match(composerApp, /'Not installed'/);

  const applySelectionStart = composerApp.indexOf('function applyThreadSelection(');
  const selectProviderStart = composerApp.indexOf('function selectProvider(', applySelectionStart);
  const applySelectionSource = composerApp.slice(applySelectionStart, selectProviderStart);
  assert.match(applySelectionSource, /const provider = thread \? threadProvider\(thread\) : state\.selectedProvider/);
  assert.match(applySelectionSource, /state\.selectedProvider = provider/);
  assert.match(applySelectionSource, /renderExecutionControls\(\)/);
});

test('provider tabs render safely before the first status response', () => {
  const renderStart = composerApp.indexOf('function renderProviderTabs()');
  const renderEnd = composerApp.indexOf('\nfunction isActiveProjectPaused()', renderStart);
  const renderSource = composerApp.slice(renderStart, renderEnd);

  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  assert.match(renderSource, /const terminalPool = state\.status\?\.terminalPool/);
  assert.match(renderSource, /const pool = terminalPool\s+&& sameProjectPath/);
  assert.doesNotMatch(renderSource, /state\.status\.terminalPool/);
});

test('Plan council controls render safely during the initial paint', () => {
  const renderStart = composerApp.indexOf('function renderPlanControls()');
  const renderEnd = composerApp.indexOf('\nfunction turboWorkerThreads()', renderStart);
  const renderSource = composerApp.slice(renderStart, renderEnd);

  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  assert.match(renderSource, /const codexModels = catalogs\.codex/);
  assert.match(renderSource, /const claudeModels = catalogs\.claude/);
  assert.doesNotMatch(renderSource, /\bmodels\./);
  assert.doesNotMatch(renderSource, /settings\.reviewerModel/);
});

test('automatic terminal controls render safely before a project is selected', () => {
  const renderStart = composerApp.indexOf('function renderAutomaticTerminalPool()');
  const renderEnd = composerApp.indexOf('\nasync function saveProjectInstanceLimits()', renderStart);
  const renderSource = composerApp.slice(renderStart, renderEnd);

  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  assert.match(renderSource, /const terminalPool = state\.status\?\.terminalPool/);
  assert.match(renderSource, /const active = terminalPool\s+&& project\s+&& sameProjectPath/);
  assert.doesNotMatch(renderSource, /state\.status\.terminalPool/);
});

test('Launchpad configuration and active project are shared through the backend', () => {
  assert.match(server, /sharedProjectConfig: true/);
  assert.match(server, /activeProjectPath: database\.activeProjectPath\(\)/);
  assert.match(server, /pathname === '\/api\/projects\/active'/);
  assert.match(composerApp, /function persistActiveProject\(path\)/);
  assert.match(composerApp, /api\('\/api\/projects\/active'/);
  assert.match(composerApp, /body\.activeProjectPath/);
  assert.match(composerApp, /selectProject\(sharedActiveProject\.path, \{ persist: false \}\)/);
});

test('automatic terminals default closed and apply the project terminal mode immediately', () => {
  assert.match(composer, /id="keep-terminal-open"[^>]*type="checkbox"[^>]*role="switch"/);
  assert.doesNotMatch(composer, /id="keep-terminal-open"[^>]*checked/);
  assert.match(composer, /Terminal session mode/);
  assert.match(composerApp, /Keep workflow terminals open/);
  assert.match(composerApp, /manualCompletion: true/);
  assert.match(composerState, /keepTerminalOpen: false/);
  assert.match(composerApp, /api\(`\/api\/projects\/\$\{project\.id\}\/settings`/);
  assert.match(composerApp, /projectTerminalSettingsRecord\(settings\)/);
  assert.doesNotMatch(composerApp, /Restart CC Relay to save terminal settings/);
  assert.doesNotMatch(composerApp, /relay\.keepTerminalOpen/);
  assert.doesNotMatch(composerApp, /relay\.preferIdleTerminal/);
  assert.match(server, /projectTerminalSettings: true/);
  assert.match(server, /updateProjectTerminalSettings/);
  assert.match(composerApp, /function terminalRetentionRequest/);
  assert.match(composerApp, /\.\.\.terminalRetentionRequest\(retainTerminals\)/);
  assert.match(composerApp, /keepTerminalOpen: retainTerminals/);
  assert.match(server, /retainedTerminalSessions: true/);
  assert.match(server, /const keepTerminalOpen = disposable && body\.keepTerminalOpen === true/);
  assert.match(server, /sourceTask\.keep_terminal_open/);
  assert.match(server, /const connectedThread = resumeDisposable[\s\S]*retainedThread \|\|/);
  assert.match(style, /\.terminal-keep-open-option input:checked/);
});

test('a Codex launch timeout explains a possible required update in the app', () => {
  assert.match(composerApp, /launched\?\.connectionStatus === 'timed_out'/);
  assert.match(composerApp, /Could not open a Codex CC Relay\. If Codex says an update is required in the terminal, update Codex, then try again\./);
});

test('tasks can be named on creation and renamed while waiting in the queue', () => {
  assert.match(composer, /id="task-name"[^>]*name="title"[^>]*maxlength="120"/);
  assert.match(composer, /id="task-edit-modal"[^>]*aria-labelledby="task-edit-title"/);
  assert.match(composer, /id="task-edit-name"[^>]*maxlength="120"/);
  assert.match(composer, /id="task-edit-provider"/);
  assert.match(composer, /id="task-edit-provider-label">AI provider/);
  assert.match(composer, /id="task-edit-model"/);
  assert.match(composer, /id="task-edit-effort"/);
  assert.match(composer, /id="task-edit-prompt"[^>]*maxlength="12000"/);
  assert.match(server, /queuedTaskEditing:\s*true/);
  assert.match(server, /queuedTaskNaming:\s*true/);
  assert.match(server, /queuedTaskProviderSwitch:\s*true/);
  assert.match(server, /retryTaskExecutionSettings:\s*true/);
  assert.match(server, /taskTitleFromInput\(/);
  assert.match(server, /request\.method === 'PATCH'/);
  assert.match(server, /queue\.edit\(taskId/);
  assert.match(composerApp, /actionButton\('Edit', \(\) => openTaskEditor\(task\)/);
  assert.match(composerApp, /data-rename-task/);
  assert.match(composerApp, /taskDisplayName\(task\)/);
  assert.match(composerApp, /taskHasCustomName\(task\) && !taskNamingSupported\(\)/);
  assert.match(composerApp, /requestBody\.title = formData\.get\('title'\)/);
  assert.match(composerApp, /queuedTaskProviderSwitch === true/);
  assert.match(composerApp, /retryTaskExecutionSettings === true/);
  assert.match(composerApp, /function renderTaskEditExecution\(\)/);
  assert.match(composerApp, /function openTaskRetryEditor\(task\)/);
  assert.match(composerApp, /api\(`\/api\/tasks\/\$\{state\.editingTaskId\}\/retry`/);
  assert.match(composerApp, /body: JSON\.stringify\(selectedExecution\)/);
  assert.match(composerApp, /method: 'PATCH'/);
  assert.match(composerApp, /Restart CC Relay to edit queued tasks\./);
  assert.match(composerState, /taskName:\s*''/);
});

test('busy queued Claude tasks can move to another same-workspace Claude CC Relay', () => {
  assert.match(server, /queuedClaudeAssignment:\s*true/);
  assert.match(server, /!\['codex', 'claude'\]\.includes\(task\.provider\)/);
  assert.match(server, /task\.provider === 'codex'\s+\? await codexAppServer\.readConnectedThread\(threadId\)\s+: await claudeSessions\.readConnectedSession\(threadId\)/);
  assert.match(
    composerApp,
    /task\.provider === 'claude' && state\.status\?\.capabilities\?\.queuedClaudeAssignment === true/,
  );
  assert.match(composerApp, /threadProvider\(thread\) === task\.provider/);
  assert.match(composerApp, /function assignmentTargetLabel\(thread\)/);
  assert.doesNotMatch(
    composerApp,
    /canAssignTaskToThread\(state\.draggedTaskId, option\.dataset\.threadId\) \|\| threadProvider/,
  );
});

test('idle CC Relay routing is enabled for Claude only when the backend supports parallel sessions', () => {
  assert.match(server, /parallelClaudeExecution:\s*true/);
  assert.match(composerApp, /provider === 'claude' && state\.status\?\.capabilities\?\.parallelClaudeExecution === true/);
  assert.match(composerApp, /provider:\s*state\.selectedProvider/);
});

test('selected CC Relay terminals expose guarded native close control', () => {
  assert.match(composer, /id="terminal-close-row" class="terminal-close-row"/);
  assert.match(composer, /id="terminal-close-reason" role="status"/);
  assert.match(composer, /id="close-terminal-button"[^>]*>Close selected<\/button>/);
  assert.doesNotMatch(composer, /id="close-terminal-button"[^>]*\bhidden\b/);
  assert.match(composerApp, /launched\.threadId !== thread\.id/);
  assert.match(composerApp, /CC Relay could not verify its exact native window/);
  assert.match(composerApp, /window\.confirm\(`Close \$\{label\} and its native terminal window\?/);
  assert.match(composerApp, /api\(`\/api\/terminals\/\$\{encodeURIComponent\(thread\.id\)\}`/);
  assert.match(composerApp, /control\?\.canClose !== true/);
  assert.match(composerApp, /terminalClosePresentation\(\{/);
  assert.match(composerApp, /elements\.terminalCloseReason\.textContent = presentation\.reason/);
  assert.match(composerApp, /const closing = Boolean\(state\.closingThreadId\)/);
  assert.match(composerApp, /state\.closingThreadLabel = label/);
  assert.doesNotMatch(composerApp, /closeTerminalButton\.hidden = !supported/);
});

test('Plan council selects separate owned provider terminals and a provider order', () => {
  const launchWaitStart = composerApp.indexOf('async function waitForProjectThread(');
  const launchProjectStart = composerApp.indexOf('async function launchProject(', launchWaitStart);
  const launchWaitSource = composerApp.slice(launchWaitStart, launchProjectStart);

  assert.match(composer, /id="plan-author-terminal"/);
  assert.match(composer, /id="plan-council-order" class="turbo-council-order plan-council-order"/);
  assert.match(composer, /data-plan-council-first="claude"/);
  assert.match(composer, /data-plan-council-first="codex"/);
  assert.match(
    composerApp,
    /planCouncilOrder\.hidden = !settings\.enabled \|\| !planCouncilOrderEnabled\(\)/,
  );
  assert.match(
    style,
    /\.plan-council-order button\[data-plan-council-first="codex"\]\[aria-pressed="true"\]/,
  );
  assert.match(
    style,
    /\.plan-council-order button\[data-plan-council-first="claude"\]\[aria-pressed="true"\]/,
  );
  assert.match(server, /planCouncilTerminalExecution: PLAN_COUNCIL_TERMINAL_EXECUTION/);
  assert.match(server, /planCouncilProviderOrder: true/);
  assert.match(launchWaitSource, /state\.planSettings\.authorThreadId = thread\.id/);
  assert.ok(
    launchWaitSource.indexOf('state.planSettings.authorThreadId = thread.id')
      < launchWaitSource.indexOf('applyThreadSelection(thread.id)'),
  );
  assert.match(composerApp, /function planClaudeAuthorThreads\(\)/);
  assert.match(composerApp, /thread\.terminalControl\?\.owned === true/);
  assert.match(composerApp, /authorThreadId: councilSettings\.authorThreadId/);
  assert.match(composerApp, /planCouncilRequest\(councilSettings, planCouncilCatalogs\(\)\)/);
  assert.match(composerApp, /Choose the Claude council terminal in the Plan council card/);
  assert.match(server, /const authorThreadId = typeof body\.authorThreadId/);
  assert.match(server, /projectLauncher\.terminalForThread\(claudeThread\.id\)/);
});

test('completed Plan council exposes one canonical plan file and explicit CC Relay execution', () => {
  assert.match(gitignore, /^\.data\/$/m);
  assert.match(composer, /id="plan-artifact-path"/);
  assert.match(composer, /id="plan-artifact-link"[^>]*>Open plan\.md<\/a>/);
  assert.match(composer, /id="plan-execution-panel"/);
  assert.match(composer, /id="plan-execution-relay"/);
  assert.match(composer, /id="plan-execution-button"[^>]*>Execute plan<\/button>/);
  assert.match(server, /planExecution: true/);
  assert.match(server, /planCouncilResume: true/);
  assert.match(server, /planArtifacts: true/);
  assert.match(server, /\/execute-plan\$/);
  assert.match(server, /buildPlanExecutionPrompt/);
  assert.match(server, /continuedFromTaskId: sourceTask\.id/);
  assert.match(composerApp, /function eligiblePlanExecutionThreads\(task\)/);
  assert.match(composerApp, /\['codex', 'claude'\]\.includes\(threadProvider\(thread\)\)/);
  assert.match(composerApp, /sameProjectPath\(thread\.cwd, task\.repo_path\)/);
  assert.match(composerApp, /function selectedPlanExecutionTarget\(task\)/);
  assert.match(composerApp, /state\.planExecutionTargets\.get\(task\.id\)/);
  assert.match(composerApp, /planArtifactRow\.hidden = !hasFinal/);
  assert.match(composerApp, /Restart CC Relay to enable reviewed-plan execution\./);
  assert.match(composerApp, /Execute plan with \$\{providerLabel\(threadProvider\(target\)\)\} on \$\{threadDisplayName\(target\)\}/);
  assert.match(composerApp, /api\(`\/api\/tasks\/\$\{sourceTask\.id\}\/execute-plan`/);
  assert.match(composerApp, /threadProvider\(target\) === 'claude'/);
  assert.match(composerApp, /Resume on CC Relay \$\{relayNumber\(retryTarget\)\}/);
});

test('Plan council draft and review disclosures show their durable stage file', () => {
  const draftSection = composer.indexOf('id="plan-draft-section"');
  const draftRow = composer.indexOf('id="plan-draft-artifact-row"');
  const reviewSection = composer.indexOf('id="plan-review-section"');
  const reviewRow = composer.indexOf('id="plan-review-artifact-row"');

  assert.ok(draftSection >= 0 && draftRow > draftSection && draftRow < reviewSection);
  assert.ok(reviewRow > reviewSection);
  assert.match(composer, /id="plan-draft-artifact-path"/);
  assert.match(composer, /id="plan-review-artifact-path"/);
  assert.match(style, /\.plan-stage-artifact-row \{/);
  assert.match(composerApp, /function renderPlanStageArtifact\(row, path, filePath\)/);
  assert.match(composerApp, /plan\?\.stageArtifacts\?\.draft/);
  assert.match(composerApp, /plan\?\.stageArtifacts\?\.review/);
});

test('completed Plan council promotes execution as the next visible step', () => {
  const planStages = composer.indexOf('id="plan-stage-rail"');
  const executionPanel = composer.indexOf('id="plan-execution-panel"');
  const planSummary = composer.indexOf('id="plan-agent-summary"');

  assert.ok(planStages >= 0 && executionPanel > planStages && planSummary > executionPanel);
  assert.match(composer, /class="plan-execution-step"[^>]*>04<\/span>/);
  assert.match(composer, /id="plan-execution-title">Execute this reviewed plan<\/span>/);
  assert.match(
    composerApp,
    /task\.status === 'complete' && task\.mode === 'plan'[\s\S]*actionButton\('Execute plan', revealPlanExecution, 'primary'\)/,
  );
  assert.match(composerApp, /function revealPlanExecution\(\)[\s\S]*planExecutionPanel\.scrollIntoView/);
});

test('direct execution settings render below the CC Relay picker', () => {
  const terminalList = composer.indexOf('id="terminal-list"');
  const terminalPanelEnd = composer.indexOf('</fieldset>', terminalList);
  const executionControls = composer.indexOf('id="execution-controls"');

  assert.ok(terminalList >= 0 && terminalPanelEnd > terminalList);
  assert.ok(executionControls > terminalPanelEnd);
  assert.match(composerApp, /elements\.executionControls\.hidden = state\.taskMode !== 'execute' \|\| isExecuteCouncilEnabled\(\)/);
});

test('direct effort slider submits its exact mapped value', () => {
  assert.match(composer, /id="effort-select"[^>]*type="range"/);
  const submitSource = taskSubmitSource();
  assert.match(submitSource, /model: elements\.modelSelect\.value/);
  assert.match(submitSource, /JSON\.parse\(elements\.effortSelect\.dataset\.values/);
  assert.ok(
    submitSource.indexOf('const execution = {') < submitSource.indexOf('await settleIdleSubmissionThread'),
    'effort must be captured before asynchronous idle-CC Relay routing',
  );
  assert.match(composerApp, /executionSettingsForThread\(state, state\.selectedProvider, state\.selectedThreadId\)/);
  assert.match(composerApp, /state\.selectedThreadId = threadId;\s+renderExecutionControls\(\)/);
  assert.match(submitSource, /rememberThreadExecution\(state, submissionProvider, routedThreadId, execution\)/);
  assert.match(submitSource, /rememberThreadExecution\(state, createdTask\.provider \|\| submissionProvider, acceptedThreadId/);
  assert.match(composerApp, /<i class="\$\{index === effortIndex \? 'active' : ''\}" title="\$\{escapeHtml\(effort\)\}"><\/i>/);
  const effortInputStart = composerApp.indexOf("elements.effortSelect.addEventListener('input'");
  const effortInputEnd = composerApp.indexOf("elements.attachmentInput.addEventListener('change'", effortInputStart);
  const effortInputSource = composerApp.slice(effortInputStart, effortInputEnd);
  assert.match(effortInputSource, /renderEffortSelection\(selectedModel\(\)\?\.supportedReasoningEfforts \|\| \[\], effort\)/);
  assert.doesNotMatch(effortInputSource, /renderExecutionControls\(\)/);
  assert.doesNotMatch(composerApp, /--effort-step-position/);
});

test('the right-side terminal shows all activity by default', () => {
  assert.match(composerApp, /eventFilter: 'all'/);
  assert.match(composer, /data-event-filter="all" aria-pressed="true">All<\/button>/);
  assert.match(composer, /data-event-filter="highlights" aria-pressed="false">Highlights<\/button>/);
});

test('fresh Claude initialization renders as Claude session activity', () => {
  const presentationStart = composerApp.indexOf("payloadType === 'claude/started'");
  const presentationEnd = composerApp.indexOf('\n  return {', presentationStart);
  const presentationSource = composerApp.slice(presentationStart, presentationEnd);

  assert.ok(presentationStart >= 0 && presentationEnd > presentationStart);
  assert.match(presentationSource, /payloadType === 'claude\/session-initializing'/);
  assert.match(presentationSource, /payloadType === 'claude\/progress'/);
  assert.match(presentationSource, /payloadType === 'claude\/input-required'/);
  assert.match(
    presentationSource,
    /inputRequired\s+\? 'Claude needs input'\s+: \(waiting \|\| progress\) \? 'Claude session busy' : 'Claude session'/,
  );
  assert.match(presentationSource, /payloadType !== 'claude\/session-initializing'/);
});

test('Claude and Codex questions route to exact native terminal attention', () => {
  assert.match(server, /requestAttention: \(\{ thread \}\) => projectLauncher\.requestTerminalAttention\(thread\)/);
  assert.match(server, /codexAppServer\.on\('userInputRequested'/);
  assert.match(server, /projectLauncher\.requestTerminalAttention\(thread\)/);
});

test('the header is a global running-task feed instead of a status switchboard', () => {
  assert.match(composer, /id="header-running-tasks"[^>]*aria-label="Running tasks across all projects"/);
  assert.doesNotMatch(composer, /class="header-status-strip"/);
  assert.doesNotMatch(composer, /id="status-(?:relay|terminals|queue|active)"/);
  assert.match(composerApp, /state\.runningTasks = statusBody\.runningTasks/);
  assert.match(composerApp, /class="header-running-response"/);
  assert.match(composerApp, /data-running-task-id="\$\{task\.id\}"/);
});

test('an old backend explains when separate project queues require a restart', () => {
  assert.match(server, /projectQueueIsolation: true/);
  assert.match(composerApp, /projectQueueRestartRequired\(\{/);
  assert.match(composerApp, /Restart CC Relay for separate project queues/);
  assert.match(composerApp, /Restart CC Relay to activate this project's independent queue/);
  assert.match(composerApp, /task\.status === 'running' && !sameProjectPath\(task\.repo_path, path\)/);
  assert.match(composerApp, /Array\.isArray\(pausedProjectPaths\)/);
  assert.match(composerApp, /supported: state\.status\?\.capabilities\?\.projectQueueIsolation/);
  assert.match(composerApp, /supported: state\.status\.capabilities\?\.projectQueueIsolation/);
});

test('successful submission opens the new task in Queue view', () => {
  const submitSource = taskSubmitSource();

  assert.match(submitSource, /const body = await api\('\/api\/tasks'/);
  assert.match(submitSource, /state\.taskView = 'queue'/);
  assert.match(submitSource, /state\.selectedTaskId = createdTask\.id/);
  // The post-submit refresh must not join a snapshot requested before the task existed.
  assert.match(submitSource, /await load\(\{ fresh: true \}\)/);
});

test('composer locks before asynchronous routing and sends an idempotency key', () => {
  const submitSource = taskSubmitSource();

  assert.ok(submitSource.indexOf('if (state.submitting)') < submitSource.indexOf('await settleIdleSubmissionThread'));
  assert.ok(submitSource.indexOf('setComposerPending(true)') < submitSource.indexOf('await settleIdleSubmissionThread'));
  assert.match(submitSource, /\(\) => window\.crypto\.randomUUID\(\)/);
  // Submission identity now lives in the shared module; see test/submission-intent.test.mjs.
  assert.match(submitSource, /const submissionId = resolveSubmissionId\(/);
  assert.match(submitSource, /state\.pendingSubmission = \{ id: submissionId, signature: submissionSignature \}/);
  assert.match(submitSource, /state\.pendingSubmission = null/);
  assert.match(submitSource, /requestBody\.submissionId = submissionId/);
  assert.match(submitSource, /finally \{\s+setComposerPending\(false\);/);
  assert.match(composerApp, /function setComposerPending\(pending\) \{\s+state\.submitting = pending;/);
  assert.match(server, /duplicateSubmission: true/);
  assert.match(server, /Task submission ID is required\. Refresh CC Relay and try again\./);
  assert.match(server, /Task submission ID is invalid\./);
});

test('repeat Enter during submission does not report a missing terminal', () => {
  const keydownStart = composerApp.indexOf("elements.prompt.addEventListener('keydown'");
  const pasteStart = composerApp.indexOf("elements.form.addEventListener('paste'", keydownStart);
  const keydownSource = composerApp.slice(keydownStart, pasteStart);

  const preventIndex = keydownSource.indexOf('event.preventDefault();');
  const inFlightIndex = keydownSource.indexOf('if (state.submitting)');
  const messageIndex = keydownSource.indexOf('setComposerAlert(');

  assert.ok(preventIndex >= 0 && inFlightIndex > preventIndex);
  assert.match(keydownSource, /if \(state\.submitting\) \{\s+return;\s+\}/);
  assert.ok(messageIndex > inFlightIndex, 'the quiet in-flight return must precede any message');
  // Readiness no longer disables the button, so Enter must not read its disabled state.
  assert.doesNotMatch(keydownSource, /elements\.submitButton\.disabled/);
});

test('submit ignores the live process list but blocks a confirmed missing CLI', () => {
  const gateStart = composerApp.indexOf('function composerValidationIssue()');
  const gateEnd = composerApp.indexOf('function setComposerAlert', gateStart);
  const gateSource = composerApp.slice(gateStart, gateEnd);

  assert.ok(gateStart >= 0 && gateEnd > gateStart);
  assert.match(gateSource, /Write a prompt before adding the task\./);
  assert.match(gateSource, /Choose a connected CC Relay before adding the task\./);
  assert.match(gateSource, /return providerInstallationIssue\(\) \|\| attachmentLimitIssue\(\)/);
  assert.match(gateSource, /elements\.submitButton\.disabled = state\.submitting \|\| Boolean\(issue\)/);
  assert.match(composerApp, /providerIsMissing\(provider\)/);
  assert.match(composerApp, /CC Relay will enable/);
  // A CC Relay missing from the last /api/threads answer must never disable the composer.
  assert.doesNotMatch(gateSource, /state\.threads/);
  assert.doesNotMatch(gateSource, /isClaudePlanReady|turboWorkerThreads|hasSelectedCodexThread/);
});

test('a submission in flight owns the CC Relay selection', () => {
  const renderStart = composerApp.indexOf('function renderThreads()');
  const renderEnd = composerApp.indexOf('\nfunction ', renderStart + 1);
  const renderSource = composerApp.slice(renderStart, renderEnd);

  assert.match(renderSource, /const selectionLocked = state\.submitting/);
  assert.match(renderSource, /if \(!selectionLocked && !providerEligibleForComposer\(/);
  assert.match(renderSource, /if \(!selectionLocked && !availableIds\.has\(state\.selectedThreadId\)\)/);
  // The settle loop refreshes routing data without re-rendering the picker under a POST.
  assert.match(composerApp, /await loadThreads\(\{ render: false \}\)/);
  assert.match(composerApp, /async function loadThreads\(\{ silent = true, render = true \} = \{\}\)/);
});

test('a failed submission keeps the prompt and its attachments', () => {
  const submitSource = taskSubmitSource();

  const catchIndex = submitSource.indexOf('setComposerAlert(error.message)');
  const guardIndex = submitSource.indexOf('if (!createdTask)');
  const clearPromptIndex = submitSource.indexOf("elements.prompt.value = ''");
  const clearAttachmentsIndex = submitSource.indexOf('state.attachments = []');

  assert.ok(catchIndex >= 0 && guardIndex > catchIndex);
  assert.ok(clearPromptIndex > guardIndex, 'the prompt clears only after the task exists');
  assert.ok(clearAttachmentsIndex > guardIndex, 'attachments clear only after the task exists');
  // A refresh failure after a created task is a refresh failure, not a failed add.
  assert.ok(submitSource.indexOf('await load({ fresh: true })') > guardIndex);
  assert.match(submitSource, /catch \(error\) \{\s+elements\.queueSummary\.textContent = error\.message;/);
  // The pending intent is cleared only on success, so a retry reuses its UUID.
  assert.ok(
    submitSource.indexOf('state.pendingSubmission = null') > guardIndex,
    'an ambiguous failure must retain the pending intent',
  );
});

test('composer failures use their own region instead of the shared status line', () => {
  assert.match(composer, /id="composer-alert"[^>]*role="status"[^>]*aria-live="polite"[^>]*hidden/);
  assert.match(composerApp, /composerAlert: document\.querySelector\('#composer-alert'\)/);
  assert.match(composerApp, /function setComposerAlert\(message, kind = 'failure'\) \{/);
  assert.match(composerApp, /elements\.composerAlert\.hidden = !message/);
  assert.match(composer, /id="form-message"/);
  // A server failure survives editing; only a validation complaint clears as it is fixed.
  assert.match(
    composerApp,
    /elements\.composerAlert\.dataset\.kind === 'validation' && !composerValidationIssue\(\)/,
  );
  assert.match(composerApp, /setComposerAlert\(error\.message\)/);
});

test('every request is bounded so a hung fetch cannot freeze the composer', () => {
  const apiStart = composerApp.indexOf('async function api(path, options = {})');
  const apiEnd = composerApp.indexOf('\nfunction ', apiStart);
  const apiSource = composerApp.slice(apiStart, apiEnd);

  assert.match(apiSource, /const controller = new AbortController\(\)/);
  assert.match(apiSource, /signal: controller\.signal/);
  assert.match(apiSource, /window\.clearTimeout\(timer\)/);
  assert.match(composerApp, /const API_TIMEOUT_MS = 20_000/);
  assert.match(composerApp, /const TASK_SUBMIT_TIMEOUT_MS = 45_000/);
  assert.match(composerApp, /timeoutMs: TASK_SUBMIT_TIMEOUT_MS/);
});

test('dispatch-time idle routing replaces the client settle loop when advertised', () => {
  const submitSource = taskSubmitSource();

  assert.match(submitSource, /const dispatchIdleRouting = state\.status\?\.capabilities\?\.dispatchIdleRouting === true\s+&& !automaticTerminals/);
  assert.match(submitSource, /const routedThreadId = automaticTerminals\s+\? null\s+: dispatchIdleRouting\s+\? state\.selectedThreadId\s+: await settleIdleSubmissionThread\(\{ runNow \}\)/);
  // The preference is declared, never resolved client side. The server forces it off for
  // anything other than a non-priority Execute task.
  assert.match(submitSource, /\.\.\.\(dispatchIdleRouting \? \{ preferIdleTerminal: state\.preferIdleTerminal \} : \{\}\)/);
  // An older backend must never receive a field it does not know about.
  assert.doesNotMatch(submitSource, /^\s+preferIdleTerminal,$/m);
  // The idempotency signature identifies the prompt being sent, not a routing hint.
  const signature = submitSource.slice(
    submitSource.indexOf('const submissionSignature'),
    submitSource.indexOf('const submissionId'),
  );
  assert.doesNotMatch(signature, /preferIdleTerminal/);
});

test('dispatch reroute is read from the task record, not from client discovery', () => {
  // The server can move a task to another free CC Relay after it was enqueued, so every
  // destination-dependent surface must derive from the task, not from pre-POST routing.
  assert.match(composerApp, /function taskRelayLabel\(task\) \{\s+const thread = state\.threads\.find\(\(item\) => item\.id === task\.thread_id\)/);
  assert.match(composerApp, /if \(task\.thread_name\) return task\.provider === 'codex'/);
  assert.match(composerApp, /hydrateThreadExecutionSettings\(state, state\.tasks\)/);
});

test('concurrent refreshes deduplicate while a post-write refresh starts fresh', () => {
  const loadStart = composerApp.indexOf('async function load({ fresh = false } = {})');
  const loadEnd = composerApp.indexOf('\nfunction ', loadStart);
  const loadSource = composerApp.slice(loadStart, loadEnd);

  assert.ok(loadStart >= 0);
  assert.match(loadSource, /if \(!fresh && state\.loadPromise\) \{\s+return state\.loadPromise;/);
  assert.match(loadSource, /if \(previous\) await previous\.catch\(\(\) => \{\}\)/);
  assert.match(loadSource, /if \(state\.loadPromise === pending\) state\.loadPromise = null/);
});

test('an abort never claims the request was not sent', () => {
  const apiStart = composerApp.indexOf('async function api(path, options = {})');
  const apiEnd = composerApp.indexOf('\nfunction ', apiStart);
  const apiSource = composerApp.slice(apiStart, apiEnd);

  // Aborting stops the browser waiting, not the server. Cancel, retry, delete, pause and
  // reorder all share this path, so the generic copy must not assert server state.
  assert.doesNotMatch(apiSource, /Nothing was sent/);
  assert.match(apiSource, /It may still be processing the request\./);
  assert.match(apiSource, /timeoutMessage = null/);

  // Task creation is safe to resend, but only because the retained UUID resolves to it.
  const submitSource = taskSubmitSource();
  assert.match(submitSource, /The task may still have been created\. Sending it again is safe and will not create a duplicate\./);
});

test('a duplicate resolving to a finished task is not a silent success', () => {
  const submitSource = taskSubmitSource();

  assert.match(submitSource, /duplicateSubmission = body\.duplicateSubmission === true/);
  const branchIndex = submitSource.indexOf('if (duplicateSubmission && isFinishedTaskStatus(createdTask.status))');
  assert.ok(branchIndex > 0, 'the finished-duplicate branch must exist');

  const branch = submitSource.slice(branchIndex, submitSource.indexOf('\n  }', branchIndex));
  // Frees the next submission, keeps what the user typed, and names the existing task.
  assert.match(branch, /state\.pendingSubmission = null/);
  assert.match(branch, /state\.selectedTaskId = createdTask\.id/);
  assert.match(branch, /which has finished\. Press Enter again to run it as a new task\./);
  assert.match(branch, /'notice'/);
  assert.doesNotMatch(branch, /elements\.prompt\.value = ''/);
  assert.doesNotMatch(branch, /state\.attachments = \[\]/);
  // It must return before the ordinary success path clears the composer.
  assert.ok(branch.includes('return;'));
  assert.ok(submitSource.indexOf("elements.prompt.value = ''") > branchIndex);

  // Terminal statuses come from the shared set rather than a second hand-written list.
  assert.match(composerApp, /import \{ activityBuckets, isFinishedTaskStatus,/);
  assert.match(taskHistory, /export function isFinishedTaskStatus\(status\) \{\s+return FINISHED_STATUSES\.has\(status\);/);
  assert.match(taskHistory, /FINISHED_STATUSES = new Set\(\['complete', 'failed', 'interrupted', 'cancelled'\]\)/);

  // A duplicate that is still live keeps the existing select-and-clear behavior.
  assert.match(submitSource, /Showing that task instead of adding a second one\./);
  // An informational notice must not borrow the failure colour.
  const noticeStart = style.indexOf('.composer-alert[data-kind="notice"] {');
  const noticeRule = style.slice(noticeStart, style.indexOf('}', noticeStart));
  assert.ok(noticeStart > 0);
  assert.doesNotMatch(noticeRule, /--danger/);
  assert.match(noticeRule, /background: var\(--signal-soft\)/);
});

test('a background provider probe reads as checking, never as unavailable', () => {
  // Both providers are probed after listen, so the first status answers pending: true.
  assert.match(server, /pending: true/);
  assert.doesNotMatch(composer, /id="codex-status"/);
  assert.doesNotMatch(composerApp, /elements\.codexStatus/);

  // Plan council readiness must not assert an unavailable CLI before the probe answers.
  const issueStart = composerApp.indexOf('function claudePlanIssue()');
  const issueEnd = composerApp.indexOf('\nfunction ', issueStart);
  const issueSource = composerApp.slice(issueStart, issueEnd);
  assert.ok(
    issueSource.indexOf("installation === 'checking'") < issueSource.indexOf("installation === 'missing'"),
    'the checking state must precede the missing message',
  );
  assert.match(issueSource, /return 'Checking the Claude CLI'/);
});

test('a failed Claude probe is staleness, not an outage', () => {
  // The registry keeps its last known good list and sets lastError, so sessions and an
  // error arrive together and the sessions must stay listed and selectable.
  assert.match(registry, /this\.stale = true/);
  assert.match(registry, /this\.lastError = error\.message/);
  assert.match(server, /claudeDiscoveryError: claudeSessions\.lastError/);

  const noteStart = composerApp.indexOf('function claudeDiscoveryNote()');
  const noteEnd = composerApp.indexOf('\nfunction ', noteStart);
  const noteSource = composerApp.slice(noteStart, noteEnd);

  assert.ok(noteStart >= 0);
  assert.match(noteSource, /if \(!state\.connection\?\.claudeDiscoveryError\) return ''/);
  assert.match(noteSource, /may be out of date/);
  assert.match(noteSource, /CC Relay retries automatically\./);
  // Quiet copy only. Check the user-facing strings, not the identifiers around them: the
  // note must never claim an outage or imply the sessions are gone.
  const noteCopy = [...noteSource.matchAll(/' ([^']+)'/g)].map((match) => match[1]);
  assert.equal(noteCopy.length, 2);
  for (const copy of noteCopy) {
    assert.doesNotMatch(copy, /unavailable|offline|disconnected|failed|outage/i);
  }
  // Both the populated and the empty session message carry it.
  assert.equal((composerApp.match(/\+ claudeDiscoveryNote\(\)/g) || []).length, 2);
});

test('queue counts and selection recovery handle several running tasks', () => {
  assert.match(composerApp, /function mostRecentlyStartedRunningTask\(tasks\) \{/);
  assert.match(composerApp, /new Date\(right\.started_at \|\| 0\) - new Date\(left\.started_at \|\| 0\) \|\| right\.id - left\.id/);
  assert.match(composerApp, /const runningInProject = scopedTasks\.filter\(\(task\) => task\.status === 'running'\)/);
  assert.match(composerApp, /runningInProject\.length > 1\s+\? `\$\{runningInProject\.length\} tasks running/);
  assert.match(composerApp, /state\.selectedTaskId = mostRecentlyStartedRunningTask\(scopedTasks\)\?\.id \|\| null/);
});

test('switching projects restores each project selected task', () => {
  const saveStart = composerApp.indexOf('function saveProjectComposerState');
  const saveEnd = composerApp.indexOf('\nfunction ', saveStart + 1);
  const saveSource = composerApp.slice(saveStart, saveEnd);
  const restoreStart = composerApp.indexOf('function restoreProjectComposerState');
  const restoreEnd = composerApp.indexOf('\nfunction ', restoreStart + 1);
  const restoreSource = composerApp.slice(restoreStart, restoreEnd);
  const selectStart = composerApp.indexOf('function selectProject');
  const selectEnd = composerApp.indexOf('\nfunction ', selectStart + 1);
  const selectSource = composerApp.slice(selectStart, selectEnd);

  assert.match(saveSource, /selectedTaskId: state\.selectedTaskId/);
  assert.match(restoreSource, /task\.id === session\.selectedTaskId/);
  assert.match(restoreSource, /sameProjectPath\(task\.repo_path, path\)/);
  assert.match(restoreSource, /state\.selectedTaskId = selectedTask\?\.id \|\| null/);
  assert.doesNotMatch(selectSource, /state\.selectedTaskId = null/);
  assert.match(selectSource, /if \(state\.selectedTaskId\) \{\s+selectTask\(state\.selectedTaskId\)/);
});

test('Task Activity keeps every continuation in the selected task and conversation', () => {
  const continuationStart = composerApp.indexOf('async function submitTaskContinuation');
  const continuationEnd = composerApp.indexOf('async function deleteTask', continuationStart);
  const continuationSource = composerApp.slice(continuationStart, continuationEnd);
  const followUpRouteStart = server.indexOf('(?:continue|follow-up)');
  const followUpRouteEnd = server.indexOf("request.method === 'GET'", followUpRouteStart);
  const followUpRouteSource = server.slice(followUpRouteStart, followUpRouteEnd);
  assert.match(composer, /id="task-continuation-form" class="task-continuation"/);
  assert.match(composer, /id="task-continuation-input"[^>]*placeholder="Ask a follow-up in this terminal/);
  assert.match(composer, /id="task-continuation-image-input"[^>]*accept="image\/png,image\/jpeg,image\/webp"[^>]*multiple/);
  assert.match(composer, /id="task-continuation-clear-images"/);
  assert.match(composerApp, /continuationSubmission\(sourceTask, prompt/);
  assert.match(continuationSource, /const body = await api\(request\.path/);
  assert.match(continuationSource, /sourceTask\.provider === 'claude' && sourceTask\.status === 'running'/);
  assert.match(continuationSource, /timeoutMs: 120_000/);
  assert.match(continuationSource, /may already be queued in Claude/);
  assert.match(continuationSource, /const runningSteeringAvailable = sourceTask\?\.status === 'running'/);
  assert.match(continuationSource, /!resumableSession && !runningSteeringAvailable/);
  assert.match(continuationSource, /taskDirectFollowUp === true/);
  assert.match(composerApp, /supportsTaskSteering: state\.status\?\.capabilities\?\.taskSteering === true/);
  assert.match(composerApp, /supportsClaudeTaskSteering: state\.status\?\.capabilities\?\.claudeTaskSteering === true/);
  assert.match(continuationSource, /continuationDispatchOutcome\(\{ ok: true, \.\.\.body, prompt \}\)/);
  // A response confirming neither route is still not a delivery, so it keeps the draft.
  assert.equal(continuationDispatchOutcome({ ok: true }).clearComposer, false);
  assert.equal(continuationDispatchOutcome({ ok: true, steered: true }).clearComposer, true);
  assert.match(continuationState, /created no new task/);
  assert.match(continuationSource, /await load\(\{ fresh: true \}\)/);
  assert.doesNotMatch(composerApp, /continuationInput\.disabled = !available/);
  assert.match(composerApp, /event\.key !== 'Enter' \|\| event\.shiftKey \|\| event\.isComposing/);
  assert.match(composerApp, /task\?\.mode === 'execute' && \['codex', 'claude'\]\.includes\(task\.provider\)/);
  assert.match(composerApp, /!isFailedSessionFollowUp\(task\)/);
  assert.doesNotMatch(continuationSource, /state\.selectedTaskId = body\.task\.id/);
  assert.doesNotMatch(continuationSource, /state\.taskView = 'queue'/);
  assert.match(composerApp, /const requestSequence = \+\+state\.taskLoadSequence/);
  assert.match(composerApp, /requestSequence !== state\.taskLoadSequence \|\| state\.selectedTaskId !== taskId/);
  assert.match(server, /taskDirectFollowUp: true/);
  assert.match(server, /taskFollowUpAttachments: true/);
  assert.match(server, /taskSteering: true/);
  assert.match(server, /claudeTaskSteering: CLAUDE_TASK_STEERING/);
  assert.match(server, /if \(error\.deliveryUncertain === true\)/);
  assert.match(server, /Unconfirmed live-update reference images/);
  assert.match(server, /type: 'claude\/steer-uncertain'/);
  assert.match(server, /resumableDisposableSessions: true/);
  assert.match(continuationSource, /taskFollowUpAttachments === true/);
  assert.match(continuationSource, /mimeType: attachment\.mimeType/);
  assert.match(composerApp, /continuationForm\.addEventListener\('paste'/);
  assert.match(followUpRouteSource, /decodeImageAttachments\(body\.attachments\)/);
  assert.match(server, /\/api\\\/tasks\\\/\\d\+\\\/steer/);
  assert.match(followUpRouteSource, /queue\.startFollowUp\(buildSessionFollowUp/);
  assert.match(followUpRouteSource, /sourceTask\.terminal_lifecycle === 'disposable'/);
  assert.match(followUpRouteSource, /\{ resumeDisposable \}/);
  assert.doesNotMatch(followUpRouteSource, /queue\.enqueue\(/);
  assert.doesNotMatch(followUpRouteSource, /continuationQueued/);
  assert.match(followUpRouteSource, /sendJson\(response, 202/);
  assert.match(server, /prompts: database\.listTaskPrompts\(taskId\)/);
  assert.match(composerApp, /normalizeTaskPrompts\(task, prompts\)/);
  assert.match(composerApp, /elements\.promptSection\.open = promptHistory\.length > 1/);
  assert.match(server, /sourceTask\.status === 'running'/);
  assert.match(server, /claudeExecution\.steer\(task\.id, prompt, storedAttachments\)/);
  assert.match(server, /Your follow-up was not queued/);
});
