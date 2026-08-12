import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { turboControlsSignature } from '../public/turbo-controls-signature.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const markup = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');

function baselineInputs() {
  return {
    automatic: true,
    projectPath: '/work/atlas',
    codexLimit: 4,
    claudeLimit: 2,
    codexMissing: false,
    claudeReady: true,
    claudeIssue: '',
    keepTerminalOpen: false,
    retainedTerminals: true,
    hasPlannerThread: false,
    workerThreadCount: 0,
    settings: {
      plannerModel: 'gpt-5.6-sol',
      plannerEffort: 'high',
      workerModel: 'gpt-5.6-luna',
      workerEffort: 'high',
      workerCount: 3,
      councilEnabled: false,
      councilOrder: ['codex', 'claude'],
      councilCodexModel: 'gpt-5.6-sol',
      councilCodexEffort: 'high',
      councilClaudeModel: 'fable',
      councilClaudeEffort: 'high',
    },
    catalogs: {
      codex: [{
        model: 'gpt-5.6-sol',
        displayName: 'GPT-5.6 Sol',
        isDefault: true,
        defaultReasoningEffort: 'medium',
        supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }],
      }],
      claude: [{
        model: 'fable',
        displayName: 'Claude Fable',
        isDefault: true,
        defaultReasoningEffort: 'high',
        supportedReasoningEfforts: ['high', 'max'],
      }],
    },
  };
}

/*
 * One entry per datum renderTurboControls draws from. A signature that misses one of these
 * leaves the panel showing a stale model list, a stale readiness chip, or a stale fleet
 * sentence with no event able to repair it, which is worse than the rebuild it skips.
 */
const inputMutations = [
  ['automatic pool mode', (input) => { input.automatic = false; }],
  ['selected project identity', (input) => { input.projectPath = '/work/other'; }],
  ['project Codex limit', (input) => { input.codexLimit = 8; }],
  ['project Claude limit', (input) => { input.claudeLimit = 1; }],
  ['Codex installation', (input) => { input.codexMissing = true; }],
  ['Claude readiness', (input) => { input.claudeReady = false; }],
  ['Claude blocker text', (input) => { input.claudeIssue = 'Claude CLI is signed out'; }],
  ['keep terminals open', (input) => { input.keepTerminalOpen = true; }],
  ['terminal retention capability', (input) => { input.retainedTerminals = false; }],
  ['legacy planner selection', (input) => { input.hasPlannerThread = true; }],
  ['legacy worker terminal count', (input) => { input.workerThreadCount = 2; }],
  ['planner model', (input) => { input.settings.plannerModel = 'gpt-5.6-luna'; }],
  ['planner effort', (input) => { input.settings.plannerEffort = 'max'; }],
  ['worker model', (input) => { input.settings.workerModel = 'gpt-5.6-sol'; }],
  ['worker effort', (input) => { input.settings.workerEffort = 'medium'; }],
  ['worker count', (input) => { input.settings.workerCount = 4; }],
  ['council switch', (input) => { input.settings.councilEnabled = true; }],
  ['council order', (input) => { input.settings.councilOrder = ['claude', 'codex']; }],
  ['council Codex model', (input) => { input.settings.councilCodexModel = 'gpt-5.6-luna'; }],
  ['council Codex effort', (input) => { input.settings.councilCodexEffort = 'medium'; }],
  ['council Claude model', (input) => { input.settings.councilClaudeModel = 'opus'; }],
  ['council Claude effort', (input) => { input.settings.councilClaudeEffort = 'max'; }],
  ['Codex catalog model id', (input) => { input.catalogs.codex[0].model = 'gpt-5.6-nova'; }],
  ['Codex catalog label', (input) => { input.catalogs.codex[0].displayName = 'GPT-5.6 Sol preview'; }],
  ['Codex catalog default flag', (input) => { input.catalogs.codex[0].isDefault = false; }],
  ['Codex catalog default effort', (input) => { input.catalogs.codex[0].defaultReasoningEffort = 'low'; }],
  ['Codex catalog effort list', (input) => { input.catalogs.codex[0].supportedReasoningEfforts = [{ reasoningEffort: 'high' }]; }],
  ['Codex catalog length', (input) => { input.catalogs.codex.push({ model: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna' }); }],
  ['Claude catalog model id', (input) => { input.catalogs.claude[0].model = 'opus'; }],
  ['Claude catalog label', (input) => { input.catalogs.claude[0].displayName = 'Claude Opus'; }],
  ['Claude catalog default flag', (input) => { input.catalogs.claude[0].isDefault = false; }],
  ['Claude catalog default effort', (input) => { input.catalogs.claude[0].defaultReasoningEffort = 'medium'; }],
  ['Claude catalog effort list', (input) => { input.catalogs.claude[0].supportedReasoningEfforts = ['max']; }],
  ['Claude catalog length', (input) => { input.catalogs.claude.length = 0; }],
];

test('every Turbo panel input datum moves the render signature', () => {
  const baseline = turboControlsSignature(baselineInputs());

  for (const [label, mutate] of inputMutations) {
    const input = baselineInputs();
    mutate(input);
    assert.notEqual(turboControlsSignature(input), baseline, `${label} must change the signature`);
  }
});

test('an unchanged Turbo panel folds to the same signature', () => {
  assert.equal(turboControlsSignature(baselineInputs()), turboControlsSignature(baselineInputs()));
  // Missing state must not throw during the first render, before status and models arrive.
  assert.equal(typeof turboControlsSignature(), 'string');
  assert.notEqual(turboControlsSignature(), turboControlsSignature(baselineInputs()));
});

test('the signature is a short token rather than the panel content', () => {
  const signature = turboControlsSignature(baselineInputs());
  assert.match(signature, /^[0-9a-z]{1,7}$/);
  assert.doesNotMatch(signature, /GPT-5\.6/);
});

test('reasoning efforts fold from both catalog shapes', () => {
  const objects = baselineInputs();
  const strings = baselineInputs();
  strings.catalogs.codex[0].supportedReasoningEfforts = ['medium', 'high'];
  // Same efforts expressed either way describe the same select, so they fold alike.
  assert.equal(turboControlsSignature(strings), turboControlsSignature(objects));
});

test('renderTurboControls collects every signature input and skips an unchanged rebuild', () => {
  const collectorStart = app.indexOf('function turboControlsSignatureInputs()');
  const collector = app.slice(collectorStart, app.indexOf('function renderTurboControls', collectorStart));

  assert.ok(collectorStart > 0);
  for (const field of [
    'automatic:', 'projectPath:', 'codexLimit:', 'claudeLimit:', 'codexMissing:', 'claudeReady:',
    'claudeIssue:', 'keepTerminalOpen:', 'retainedTerminals:', 'hasPlannerThread:',
    'workerThreadCount:', 'settings:', 'catalogs:',
  ]) {
    assert.ok(collector.includes(field), `turboControlsSignatureInputs must collect ${field}`);
  }
  assert.match(app, /function renderTurboControls\(\{ force = false \} = \{\}\) \{/);
  assert.match(app, /if \(!force && state\.turboControlsSignature === signature\) return;/);
  // Recorded after the body so the token describes the settled, normalized panel.
  assert.match(
    app.slice(app.indexOf('function renderTurboControls')),
    /state\.turboControlsSignature = turboControlsSignature\(turboControlsSignatureInputs\(\)\);\n\}/,
  );
});

test('a refresh tick never rewrites the worker count the user is typing', () => {
  const render = app.slice(app.indexOf('function renderTurboControls'), app.indexOf('function attachmentLimitIssue'));

  assert.match(render, /if \(document\.activeElement !== elements\.turboWorkerCount\) \{\n\s+elements\.turboWorkerCount\.value = String\(settings\.workerCount\);/);
  // Committing, not typing, bounds the value; the blur listener resyncs an abandoned edit.
  assert.doesNotMatch(app, /elements\.turboWorkerCount\.addEventListener\('input'/);
  assert.match(app, /elements\.turboWorkerCount\.addEventListener\('change', \(\) => \{/);
  const blur = app.slice(app.indexOf("elements.turboWorkerCount.addEventListener('blur'"));
  // Blur resyncs the field only. Forcing a render there would rewrite the stored count over
  // digits still being edited when a browser blurs the element on window focus loss.
  assert.match(blur.slice(0, 320), /if \(document\.activeElement === elements\.turboWorkerCount\) return;/);
  assert.doesNotMatch(blur.slice(0, 320), /renderTurboControls/);
});

test('Enter inside the worker count commits the value instead of queueing the task', () => {
  const guard = app.slice(app.indexOf("elements.turboWorkerCount.addEventListener('keydown'"));

  assert.match(guard.slice(0, 200), /if \(event\.key !== 'Enter'\) return;\n\s+event\.preventDefault\(\);\n\s+elements\.turboWorkerCount\.blur\(\);/);
  // The composer form has a submit button, which is what made an unguarded Return queue.
  assert.match(markup, /<input id="turbo-worker-count" type="number"/);
  assert.match(markup, /id="task-submit-button"/);
});

test('a submit click commits a worker count that no blur committed', () => {
  const helpersStart = app.indexOf('function clampTurboWorkerCount(');
  const helpers = app.slice(helpersStart, app.indexOf('function turboCapacityAdvice('));
  const submit = app.slice(app.indexOf("elements.form.addEventListener('submit'"));
  const flushed = submit.indexOf('flushTurboWorkerCount();');

  assert.ok(helpersStart > 0);
  // One clamp with two callers, so a committed fleet size cannot depend on which one ran.
  assert.match(
    helpers,
    /const limit = maxTurboWorkers\(\);\n\s+const requested = Math\.floor\(Number\(value\)\);\n\s+return Math\.min\(limit, Math\.max\(1, Number\.isFinite\(requested\) \? requested : 1\)\);/,
  );
  assert.equal(app.split('Number.isFinite(requested)').length - 1, 1);
  assert.match(helpers, /function commitTurboWorkerCount\(\) \{\n\s+state\.turboSettings\.workerCount = clampTurboWorkerCount\(elements\.turboWorkerCount\.value\);/);
  assert.match(app, /elements\.turboWorkerCount\.addEventListener\('change', \(\) => \{\n\s+commitTurboWorkerCount\(\);\n\}\);/);
  // A field that already agrees with the stored count commits nothing, so the flush cannot
  // repaint the panel on every submit.
  assert.match(
    helpers,
    /function flushTurboWorkerCount\(\) \{\n\s+if \(clampTurboWorkerCount\(elements\.turboWorkerCount\.value\) === state\.turboSettings\.workerCount\) return;\n\s+commitTurboWorkerCount\(\);\n\}/,
  );
  // Safari leaves the field focused when a button is clicked, so no change event precedes
  // that submit. The flush runs before the capacity check, before the submission signature
  // that folds these settings, and before the request body reads the count.
  assert.ok(flushed > 0);
  assert.ok(flushed < submit.indexOf('const required = state.turboSettings.workerCount + 1;'));
  assert.ok(flushed < submit.indexOf('turboSettings: state.turboSettings,'));
  assert.ok(flushed < submit.indexOf('workerCount: state.turboSettings.workerCount,'));
});

test('automatic pools cap the fleet one below the project instance ceiling', () => {
  assert.match(app, /const MAX_PROJECT_INSTANCES = 8;/);
  assert.match(app, /const MAX_TURBO_WORKERS = 8;/);
  assert.match(app, /const MAX_POOL_TURBO_WORKERS = MAX_PROJECT_INSTANCES - 1;/);
  assert.match(app, /function maxTurboWorkers\(automatic = usesDisposableTerminalPools\(\)\) \{\n\s+return automatic \? MAX_POOL_TURBO_WORKERS : MAX_TURBO_WORKERS;/);
  // The field advertises the live ceiling and state is clamped to it before it is written.
  assert.match(app, /settings\.workerCount = Math\.min\(workerLimit, Math\.max\(1, settings\.workerCount\)\);/);
  assert.match(app, /elements\.turboWorkerCount\.max = String\(workerLimit\);/);
  assert.match(app, /const limit = maxTurboWorkers\(\);/);
  // Legacy live-terminal Turbo keeps eight workers, on the server and in the markup default.
  assert.match(server, /workerCount < 1 \|\| workerCount > 8/);
  assert.match(markup, /id="turbo-worker-count"[^>]*max="8"/);
});

test('capacity advice never asks for a maximum the settings UI cannot reach', () => {
  const advice = app.slice(app.indexOf('function turboCapacityAdvice('), app.indexOf('function turboControlsSignatureInputs'));

  assert.match(advice, /required > MAX_PROJECT_INSTANCES/);
  assert.match(advice, /Use at most \$\{MAX_POOL_TURBO_WORKERS\} worker terminals/);
  assert.match(advice, /Raise Codex max instances to at least \$\{required\}/);
  assert.match(app, /: turboCapacityAdvice\(requiredCodexInstances\)/);
  // The submit-time alert is the other user-facing copy and follows the same boundary.
  assert.match(
    app,
    /Turbo needs \$\{required\} Codex instances and a project allows at most \$\{MAX_PROJECT_INSTANCES\}\. Reduce the worker terminals to \$\{MAX_POOL_TURBO_WORKERS\} or fewer\./,
  );
  assert.match(app, /Turbo needs \$\{required\} Codex instances\. Raise this project's Codex maximum before adding the task\./);
});

test('the fleet sentence follows the keep workflow terminals open toggle', () => {
  assert.match(
    app,
    /const retainsTerminals = automatic\n\s+&& state\.status\?\.capabilities\?\.retainedTerminalSessions === true\n\s+&& state\.keepTerminalOpen;/,
  );
  assert.match(app, /and leaves every terminal connected when Turbo ends\./);
  assert.match(app, /then closes every terminal when Turbo ends\./);
  // The toggle repaints the sentence without waiting for the settings request to settle.
  const keepOpen = app.slice(app.indexOf("elements.keepTerminalOpen.addEventListener('change'"));
  assert.ok(keepOpen.indexOf('renderTurboControls();') < keepOpen.indexOf('void saveProjectTerminalSettings();'));
});

test('the composer states where a Turbo prompt sends its images', () => {
  const route = app.slice(app.indexOf('elements.attachmentRoute.textContent'), app.indexOf('const full = state.attachments.length'));

  assert.match(route, /Sent to the Turbo planner and to every worker turn\./);
  assert.match(route, /Sent to both Plan council planners and to every worker turn\./);
  // Execute keeps its own two sentences.
  assert.match(route, /Sent to Claude and Codex throughout the review loop\./);
  assert.match(route, /Sent to the selected AI with the prompt\./);
  // Toggling the Turbo council changes the destination, so the copy is re-rendered there.
  const councilToggle = app.slice(app.indexOf("elements.turboCouncilEnabled.addEventListener('change'"));
  assert.match(councilToggle.slice(0, 400), /renderAttachmentComposer\(\);/);
});

test('the compact Turbo order control cannot restyle the Execute order control', () => {
  // One class, two panels: index.html gives Execute's control the Turbo class as well.
  assert.match(markup, /id="plan-council-order" class="turbo-council-order plan-council-order"/);
  assert.match(style, /\.turbo-config \.turbo-council-order \{\n\s+margin-top: 8px;\n\s+padding: 3px;\n\}/);
  assert.match(style, /\.turbo-config \.turbo-council-order button \{\n\s+min-height: 24px;\n\}/);
  const compactStart = style.indexOf('/* ---------------------------------------------------------------------------\n   Compact Forward-planning Turbo top.');
  const compact = style.slice(compactStart, style.indexOf('/* Compact task inspector header', compactStart));
  assert.ok(compactStart > 0);
  assert.doesNotMatch(compact, /\n\.turbo-council-order[ ,{]/);
});

test('the dark theme keeps the Turbo council surface frameless', () => {
  const guard = style.indexOf('html[data-theme="dark"] .turbo-council-config');
  const repaints = [...style.matchAll(/html\[data-theme="dark"\] \.council-config[,\s]/g)].map((match) => match.index);

  assert.ok(guard > 0);
  assert.match(
    style.slice(guard),
    /^html\[data-theme="dark"\] \.turbo-council-config \{\n\s+border: 0;\n\s+background: none;\n\s+box-shadow: none;\n\}/,
  );
  // Equal specificity, so the guard only wins by arriving after every dark repaint of the
  // shared council surface. The last .council-config block sets --council-* tokens only.
  const painting = repaints.filter((index) => /background:/.test(style.slice(index, style.indexOf('}', index))));
  assert.ok(painting.length >= 2);
  assert.ok(painting.every((index) => index < guard));
});
