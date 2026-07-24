import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const composer = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const composerApp = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
const gitignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');

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
  assert.match(composer, /Creates a reviewed, read-only plan instead of running the prompt directly\./);
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
  assert.match(composerApp, /elements\.turboCouncilRoute\.hidden = !council\.councilEnabled/);
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

test('provider choice follows the selected Relay and launch actions are explicit', () => {
  assert.match(composer, /id="launch-codex-button"[^>]*>Launch Codex<\/button>/);
  assert.match(composer, /id="launch-claude-button"[^>]*>Launch Claude<\/button>/);
  assert.doesNotMatch(composer, /id="launch-terminal-button"/);
  assert.match(composer, /class="agent-tabs" hidden aria-hidden="true"/);

  const applySelectionStart = composerApp.indexOf('function applyThreadSelection(');
  const selectProviderStart = composerApp.indexOf('function selectProvider(', applySelectionStart);
  const applySelectionSource = composerApp.slice(applySelectionStart, selectProviderStart);
  assert.match(applySelectionSource, /const provider = thread \? threadProvider\(thread\) : state\.selectedProvider/);
  assert.match(applySelectionSource, /state\.selectedProvider = provider/);
  assert.match(applySelectionSource, /renderExecutionControls\(\)/);
});

test('a Codex launch timeout explains a possible required update in the app', () => {
  assert.match(composerApp, /launched\?\.connectionStatus === 'timed_out'/);
  assert.match(composerApp, /Could not open a Codex Relay\. If Codex says an update is required in the terminal, update Codex, then try again\./);
});

test('waiting queue tasks expose a guarded prompt editor', () => {
  assert.match(composer, /id="task-edit-modal"[^>]*aria-labelledby="task-edit-title"/);
  assert.match(composer, /id="task-edit-prompt"[^>]*maxlength="12000"/);
  assert.match(server, /queuedTaskEditing:\s*true/);
  assert.match(server, /request\.method === 'PATCH'/);
  assert.match(server, /queue\.edit\(taskId/);
  assert.match(composerApp, /actionButton\('Edit', \(\) => openTaskEditor\(task\)/);
  assert.match(composerApp, /method: 'PATCH'/);
  assert.match(composerApp, /Restart Relay to edit queued tasks\./);
});

test('idle Relay routing is enabled for Claude only when the backend supports parallel sessions', () => {
  assert.match(server, /parallelClaudeExecution:\s*true/);
  assert.match(composerApp, /provider === 'claude' && state\.status\?\.capabilities\?\.parallelClaudeExecution === true/);
  assert.match(composerApp, /provider:\s*state\.selectedProvider/);
});

test('selected Relay terminals expose guarded native close control', () => {
  assert.match(composer, /id="terminal-close-row" class="terminal-close-row"/);
  assert.match(composer, /id="terminal-close-reason" role="status"/);
  assert.match(composer, /id="close-terminal-button"[^>]*>Close selected<\/button>/);
  assert.doesNotMatch(composer, /id="close-terminal-button"[^>]*\bhidden\b/);
  assert.match(composerApp, /launched\.threadId !== thread\.id/);
  assert.match(composerApp, /Relay could not verify its exact native window/);
  assert.match(composerApp, /window\.confirm\(`Close \$\{label\} and its native terminal window\?/);
  assert.match(composerApp, /api\(`\/api\/terminals\/\$\{encodeURIComponent\(thread\.id\)\}`/);
  assert.match(composerApp, /control\?\.canClose !== true/);
  assert.match(composerApp, /terminalClosePresentation\(\{/);
  assert.match(composerApp, /elements\.terminalCloseReason\.textContent = presentation\.reason/);
  assert.match(composerApp, /const closing = Boolean\(state\.closingThreadId\)/);
  assert.match(composerApp, /state\.closingThreadLabel = label/);
  assert.doesNotMatch(composerApp, /closeTerminalButton\.hidden = !supported/);
});

test('Plan council shows interactive Claude sessions without making them selectable reviewers', () => {
  const launchWaitStart = composerApp.indexOf('async function waitForProjectThread(');
  const launchProjectStart = composerApp.indexOf('async function launchProject(', launchWaitStart);
  const launchWaitSource = composerApp.slice(launchWaitStart, launchProjectStart);

  assert.match(launchWaitSource, /!providerEligibleForComposer\(state, provider\)/);
  assert.match(launchWaitSource, /incompatibleComposerProviderMessage\(provider, path\)/);
  assert.ok(
    launchWaitSource.indexOf('!providerEligibleForComposer(state, provider)')
      < launchWaitSource.indexOf('applyThreadSelection(thread.id)'),
  );
  assert.match(composerApp, /const councilClaudeThreads = isExecuteCouncilEnabled\(\) \? projectThreads\('claude'\) : \[\]/);
  assert.match(composerApp, /executeOnly \? 'aria-disabled="true" disabled' : ''/);
  assert.match(composerApp, /interactive Claude session\$\{councilClaudeThreads\.length === 1 \? '' : 's'\} shown as Execute only/);
  assert.match(composerApp, /Plan council stays enabled and uses the signed-in Claude CLI automatically/);
});

test('completed Plan council exposes one canonical plan file and explicit Relay execution', () => {
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
  assert.match(composerApp, /Restart Relay to enable reviewed-plan execution\./);
  assert.match(composerApp, /Execute with \$\{providerLabel\(threadProvider\(target\)\)\} on \$\{threadDisplayName\(target\)\}/);
  assert.match(composerApp, /api\(`\/api\/tasks\/\$\{sourceTask\.id\}\/execute-plan`/);
  assert.match(composerApp, /threadProvider\(target\) === 'claude'/);
  assert.match(composerApp, /Resume on Relay \$\{relayNumber\(retryTarget\)\}/);
});

test('direct execution settings render below the Relay picker', () => {
  const terminalList = composer.indexOf('id="terminal-list"');
  const terminalPanelEnd = composer.indexOf('</fieldset>', terminalList);
  const executionControls = composer.indexOf('id="execution-controls"');

  assert.ok(terminalList >= 0 && terminalPanelEnd > terminalList);
  assert.ok(executionControls > terminalPanelEnd);
  assert.match(composerApp, /elements\.executionControls\.hidden = state\.taskMode !== 'execute' \|\| isExecuteCouncilEnabled\(\)/);
});

test('direct effort slider submits its exact mapped value', () => {
  assert.match(composer, /id="effort-select"[^>]*type="range"/);
  const submitStart = composerApp.indexOf("elements.form.addEventListener('submit'");
  const pauseStart = composerApp.indexOf("elements.pauseButton.addEventListener", submitStart);
  const submitSource = composerApp.slice(submitStart, pauseStart);
  assert.match(submitSource, /model: elements\.modelSelect\.value/);
  assert.match(submitSource, /JSON\.parse\(elements\.effortSelect\.dataset\.values/);
  assert.ok(
    submitSource.indexOf('const execution = {') < submitSource.indexOf('await settleIdleSubmissionThread'),
    'effort must be captured before asynchronous idle-Relay routing',
  );
  assert.match(composerApp, /executionSettingsForThread\(state, state\.selectedProvider, state\.selectedThreadId\)/);
  assert.match(composerApp, /state\.selectedThreadId = threadId;\s+renderExecutionControls\(\)/);
  assert.match(submitSource, /rememberThreadExecution\(state, submissionProvider, routedThreadId, execution\)/);
  assert.match(submitSource, /rememberThreadExecution\(state, body\.task\.provider \|\| submissionProvider, acceptedThreadId/);
  assert.match(composerApp, /<i class="\$\{index === effortIndex \? 'active' : ''\}" title="\$\{escapeHtml\(effort\)\}"><\/i>/);
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
  assert.match(presentationSource, /title: \(waiting \|\| progress\) \? 'Claude session busy' : 'Claude session'/);
  assert.match(presentationSource, /payloadType !== 'claude\/session-initializing'/);
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
  assert.match(composerApp, /Restart Relay for separate project queues/);
  assert.match(composerApp, /Restart Relay to activate this project's independent queue/);
  assert.match(composerApp, /task\.status === 'running' && !sameProjectPath\(task\.repo_path, path\)/);
  assert.match(composerApp, /Array\.isArray\(pausedProjectPaths\)/);
  assert.match(composerApp, /supported: state\.status\?\.capabilities\?\.projectQueueIsolation/);
  assert.match(composerApp, /supported: state\.status\.capabilities\?\.projectQueueIsolation/);
});

test('successful submission opens the new task in Queue view', () => {
  const submitStart = composerApp.indexOf("elements.form.addEventListener('submit'");
  const pauseStart = composerApp.indexOf("elements.pauseButton.addEventListener", submitStart);
  const submitSource = composerApp.slice(submitStart, pauseStart);

  assert.match(submitSource, /const body = await api\('\/api\/tasks'/);
  assert.match(submitSource, /state\.taskView = 'queue'/);
  assert.match(submitSource, /state\.taskScope = 'workspace'/);
  assert.match(submitSource, /state\.selectedTaskId = body\.task\.id/);
  assert.match(submitSource, /await load\(\)/);
});

test('composer locks before asynchronous routing and sends an idempotency key', () => {
  const submitStart = composerApp.indexOf("elements.form.addEventListener('submit'");
  const pauseStart = composerApp.indexOf("elements.pauseButton.addEventListener", submitStart);
  const submitSource = composerApp.slice(submitStart, pauseStart);

  assert.ok(submitSource.indexOf('if (state.submitting)') < submitSource.indexOf('await settleIdleSubmissionThread'));
  assert.ok(submitSource.indexOf('state.submitting = true') < submitSource.indexOf('await settleIdleSubmissionThread'));
  assert.match(submitSource, /: window\.crypto\.randomUUID\(\)/);
  assert.match(submitSource, /state\.pendingSubmission\?\.signature === submissionSignature/);
  assert.match(submitSource, /state\.pendingSubmission = \{ id: submissionId, signature: submissionSignature \}/);
  assert.match(submitSource, /state\.pendingSubmission = null/);
  assert.match(submitSource, /requestBody\.submissionId = submissionId/);
  assert.match(submitSource, /finally \{\s+state\.submitting = false;/);
  assert.match(server, /duplicateSubmission: true/);
  assert.match(server, /Task submission ID is required\. Refresh Relay and try again\./);
  assert.match(server, /Task submission ID is invalid\./);
});

test('Task Activity offers same-session continuation from its terminal dock', () => {
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
  assert.match(continuationSource, /taskDirectFollowUp === true/);
  assert.match(composerApp, /supportsTaskSteering: state\.status\?\.capabilities\?\.taskSteering === true/);
  assert.match(continuationSource, /!body\.steered && !body\.followUpStarted/);
  assert.match(continuationSource, /No queue task was created/);
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
  assert.match(continuationSource, /taskFollowUpAttachments === true/);
  assert.match(continuationSource, /mimeType: attachment\.mimeType/);
  assert.match(composerApp, /continuationForm\.addEventListener\('paste'/);
  assert.match(followUpRouteSource, /decodeImageAttachments\(body\.attachments\)/);
  assert.match(server, /\/api\\\/tasks\\\/\\d\+\\\/steer/);
  assert.match(followUpRouteSource, /queue\.startFollowUp\(buildSessionFollowUp/);
  assert.doesNotMatch(followUpRouteSource, /queue\.enqueue\(/);
  assert.match(followUpRouteSource, /sendJson\(response, 202/);
  assert.match(server, /sourceTask\.status === 'running'/);
  assert.match(server, /Your follow-up was not queued/);
});
