import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { escapeHtml } from '../public/escape-html.js';
import {
  DEFAULT_QUICK_SKILLS,
  MAX_QUICK_SKILLS,
  MAX_QUICK_SKILL_LABEL_LENGTH,
  MAX_QUICK_SKILL_PROMPT_LENGTH,
  normalizeQuickSkills,
  QUICK_SKILL_ID_PATTERN,
  quickSkillById,
} from '../public/quick-skills.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const markup = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

/*
 * The renderer is a plain script, so the quick-skill block is lifted out of app.js and given
 * its collaborators as parameters. Every free identifier inside the block is listed here; an
 * omission surfaces as a ReferenceError the first time a test drives the extracted code.
 */
const QUICK_SKILL_DEPENDENCIES = [
  'document',
  'window',
  'escapeHtml',
  'state',
  'elements',
  'quickSkillById',
  'normalizeQuickSkills',
  'DEFAULT_QUICK_SKILLS',
  'MAX_QUICK_SKILLS',
  'MAX_QUICK_SKILL_LABEL_LENGTH',
  'MAX_QUICK_SKILL_PROMPT_LENGTH',
  'QUICK_SKILL_ID_PATTERN',
  'quickSkillValidationIssue',
  'setComposerAlert',
  'submitComposerTask',
  'selectedExecution',
  'usesDisposableTerminalPools',
  'providerLabel',
  'threadDisplayName',
  'isExecuteCouncilEnabled',
  'queueUiPreferencesSave',
];

const QUICK_SKILL_EXPORTS = [
  'quickSkillStripSignature',
  'quickSkillStripEntries',
  'quickSkillStripMarkup',
  'bindQuickSkillEvents',
  'commitQuickSkillEdit',
  'renderQuickSkills',
  'handleQuickSkillListClick',
  'uniqueQuickSkillId',
  'movedQuickSkills',
  'quickSkillEditorRowMarkup',
  'renderQuickSkillEditor',
  'setQuickSkills',
  'handleQuickSkillEditorInput',
  'handleQuickSkillEditorClick',
  'handleQuickSkillEditorKeydown',
  'addQuickSkill',
  'restoreDefaultQuickSkills',
];

/*
 * The preferences save path is lifted the same way. It lives outside the quick-skill markers
 * because it persists every preference, not only the strip, but the quick-action editor is
 * where a refusal is shown, so the two are proved together.
 */
const UI_PREFERENCES_SAVE_DEPENDENCIES = [
  'state',
  'elements',
  'window',
  'api',
  'console',
  'cacheUiPreferences',
  'uiPreferencesPayload',
  'renderQuickSkillEditor',
  'setComposerAlert',
];

const UI_PREFERENCES_SAVE_EXPORTS = [
  'MAX_UI_PREFERENCES_PAYLOAD_BYTES',
  'uiPreferencesPayloadIssue',
  'reportUiPreferencesSaveIssue',
  'queueUiPreferencesSave',
];

function extractBlock(beginMarker, endMarker, source = app) {
  const start = source.indexOf(beginMarker);
  const end = source.indexOf(endMarker);
  assert.ok(start !== -1 && end > start, `${beginMarker} should be extractable from app.js`);
  return source.slice(start, end);
}

function quickSkillSource(source = app) {
  return extractBlock('// begin quick skills', '// end quick skills', source);
}

function uiPreferencesSaveSource(source = app) {
  return extractBlock('// begin ui preferences save', '// end ui preferences save', source);
}

function quickSkillModule(overrides = {}, source = app) {
  const factory = new Function(
    ...QUICK_SKILL_DEPENDENCIES,
    `${quickSkillSource(source)}\nreturn { ${QUICK_SKILL_EXPORTS.join(', ')} };`,
  );
  return factory(...QUICK_SKILL_DEPENDENCIES.map((name) => overrides[name]));
}

function uiPreferencesSaveModule(overrides = {}, source = app) {
  const factory = new Function(
    ...UI_PREFERENCES_SAVE_DEPENDENCIES,
    `${uiPreferencesSaveSource(source)}\nreturn { ${UI_PREFERENCES_SAVE_EXPORTS.join(', ')} };`,
  );
  return factory(...UI_PREFERENCES_SAVE_DEPENDENCIES.map((name) => overrides[name]));
}

/* --- a fake DOM small enough to read, built only from the selectors the block uses --- */

function matchesSelector(node, selector) {
  const exact = /^\[data-([a-z-]+)="([^"]*)"\]$/.exec(selector);
  const present = /^\[data-([a-z-]+)\]$/.exec(selector);
  const attribute = exact ? exact[1] : present ? present[1] : null;
  if (!attribute) return false;
  const key = attribute.replace(/-([a-z])/g, (unused, letter) => letter.toUpperCase());
  if (!(key in node.dataset)) return false;
  return exact ? node.dataset[key] === exact[2] : true;
}

function descendants(node) {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

function makeNode({ dataset = {}, value = null, disabled = false, children = [] } = {}) {
  const node = {
    dataset,
    disabled,
    children,
    parent: null,
    textContent: '',
    focused: 0,
    selected: 0,
    attributes: new Map(),
    listeners: [],
    addEventListener: (type, handler) => node.listeners.push({ type, handler }),
    focus() { node.focused += 1; },
    select() { node.selected += 1; },
    setAttribute: (name, attributeValue) => node.attributes.set(name, attributeValue),
    getAttribute: (name) => (node.attributes.has(name) ? node.attributes.get(name) : null),
    querySelector: (selector) => descendants(node).find((child) => matchesSelector(child, selector)) || null,
    querySelectorAll: (selector) => descendants(node).filter((child) => matchesSelector(child, selector)),
    closest: (selector) => {
      let current = node;
      while (current) {
        if (matchesSelector(current, selector)) return current;
        current = current.parent;
      }
      return null;
    },
  };
  if (value !== null) node.value = value;
  for (const child of children) child.parent = node;
  return node;
}

/*
 * Rows are parsed out of the markup the block actually produced, so a row that never printed
 * its id, its label value, its prompt body, or its disabled reorder buttons cannot pass.
 */
function parseEditorRows(html) {
  return html.split('<li ').slice(1).map((chunk) => {
    const id = /data-quick-skill-row="([^"]+)"/.exec(chunk);
    const label = /data-quick-skill-field="label"[^>]*value="([^"]*)"/.exec(chunk);
    const prompt = /<textarea[^>]*>([\s\S]*?)<\/textarea>/.exec(chunk);
    // Read back what the markup actually printed rather than assuming a valid row: a draft is
    // marked incomplete from its first paint, and this parse is what proves it.
    const invalid = /data-quick-skill-row="[^"]+" data-invalid="([^"]+)"/.exec(chunk);
    const hint = /data-quick-skill-hint>([\s\S]*?)<\/small>/.exec(chunk);
    assert.ok(id && label && prompt, 'every editor row prints an id, a label value, and a prompt');
    assert.ok(invalid && hint, 'every editor row prints its validity flag and its hint slot');
    const hintNode = makeNode({ dataset: { quickSkillHint: '' } });
    hintNode.textContent = hint[1];
    return makeNode({
      dataset: { quickSkillRow: id[1], invalid: invalid[1] },
      children: [
        makeNode({ dataset: { quickSkillField: 'label' }, value: label[1] }),
        makeNode({ dataset: { quickSkillField: 'prompt' }, value: prompt[1] }),
        makeNode({
          dataset: { quickSkillAction: 'up' },
          disabled: /data-quick-skill-action="up"[^>]*\sdisabled\s/.test(chunk),
        }),
        makeNode({
          dataset: { quickSkillAction: 'down' },
          disabled: /data-quick-skill-action="down"[^>]*\sdisabled\s/.test(chunk),
        }),
        makeNode({ dataset: { quickSkillAction: 'remove' } }),
        hintNode,
      ],
    });
  });
}

function makeListNode(parse) {
  const node = makeNode();
  node.writes = 0;
  Object.defineProperty(node, 'innerHTML', {
    get: () => node.html,
    set: (html) => {
      node.writes += 1;
      node.html = html;
      node.children = parse(html);
      for (const child of node.children) child.parent = node;
    },
  });
  node.innerHTML = '';
  node.writes = 0;
  return node;
}

function parseStripButtons(html) {
  return [...html.matchAll(/data-quick-skill="([^"]+)"/g)].map((match) => makeNode({
    dataset: { quickSkill: match[1] },
    children: [makeNode({ dataset: { quickSkillContext: '' } })],
  }));
}

function harness({
  skills = [{ id: 'deploy-check', label: 'Deploy check', prompt: 'Compare with production.' }],
  validationIssue = () => '',
  // Every destructive editor action goes through window.confirm, so tests stub it rather than
  // opening a real dialog. Accepting is the default so the pre-existing paths read unchanged.
  confirm = () => true,
  missingElements = [],
  source = app,
} = {}) {
  const calls = { submits: [], alerts: [], saves: 0, confirms: [] };
  const state = {
    quickSkills: normalizeQuickSkills(skills),
    quickSkillStripSignature: null,
    uiPreferencesSaveError: '',
    submitting: false,
    taskMode: 'execute',
    threads: [],
    selectedThreadId: null,
    selectedProvider: 'codex',
  };
  const quickSkillList = makeListNode(parseStripButtons);
  const quickSkillEditorList = makeListNode(parseEditorRows);
  const elements = {
    quickSkillList,
    quickSkillEditorList,
    quickSkillAdd: makeNode(),
    quickSkillRestore: makeNode(),
    quickSkillEditorStatus: makeNode(),
  };
  // Boot must survive a renamed element, so a test can take any of them away.
  for (const name of missingElements) elements[name] = null;
  const module = quickSkillModule({
    document: { activeElement: null },
    window: {
      confirm: (message) => {
        calls.confirms.push(message);
        return confirm(message);
      },
    },
    escapeHtml,
    state,
    elements,
    quickSkillById,
    normalizeQuickSkills,
    DEFAULT_QUICK_SKILLS,
    MAX_QUICK_SKILLS,
    MAX_QUICK_SKILL_LABEL_LENGTH,
    MAX_QUICK_SKILL_PROMPT_LENGTH,
    QUICK_SKILL_ID_PATTERN,
    quickSkillValidationIssue: validationIssue,
    setComposerAlert: (message, kind) => calls.alerts.push({ message, kind }),
    submitComposerTask: (event, options) => { calls.submits.push({ event, options }); },
    selectedExecution: () => ({ effort: 'high' }),
    usesDisposableTerminalPools: () => true,
    providerLabel: (provider) => (provider === 'codex' ? 'Codex' : 'Claude'),
    threadDisplayName: (thread) => thread.name,
    isExecuteCouncilEnabled: () => false,
    queueUiPreferencesSave: () => { calls.saves += 1; },
  }, source);
  return { module, state, elements, calls };
}

function clickEvent(node) {
  return { target: node };
}

/* --- the live strip --- */

test('the composer strip renders every configured quick action in order with escaped labels', () => {
  const { module, elements, state } = harness({
    skills: [
      { id: 'deploy-check', label: 'Deploy check', prompt: 'One.' },
      { id: 'audit', label: '<img src=x onerror="alert(1)"> & "quoted"', prompt: 'Two.' },
      { id: 'notes', label: 'Release notes', prompt: 'Three.' },
    ],
  });
  module.renderQuickSkills();

  const ids = [...elements.quickSkillList.html.matchAll(/data-quick-skill="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, ['deploy-check', 'audit', 'notes']);
  assert.equal(state.quickSkills.length, 3);
  assert.match(elements.quickSkillList.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &quot;quoted&quot;/);
  assert.doesNotMatch(elements.quickSkillList.html, /<img src=x/);
  assert.equal(elements.quickSkillList.hidden, false);
  // Every button still carries the compact context line and the >_ command mark.
  assert.equal((elements.quickSkillList.html.match(/data-quick-skill-context/g) || []).length, 3);
  assert.equal((elements.quickSkillList.html.match(/quick-skill-glyph/g) || []).length, 3);
});

test('an empty quick-action list renders an empty strip instead of crashing', () => {
  const { module, elements, state } = harness({ skills: [] });
  module.renderQuickSkills();

  assert.deepEqual(state.quickSkills, []);
  assert.equal(elements.quickSkillList.html, '');
  assert.equal(elements.quickSkillList.hidden, true);
});

test('the strip signature skips the rebuild until a label or the order changes', () => {
  const { module, elements, state } = harness({
    skills: [
      { id: 'deploy-check', label: 'Deploy check', prompt: 'One.' },
      { id: 'audit', label: 'Audit', prompt: 'Two.' },
    ],
  });
  module.renderQuickSkills();
  assert.equal(elements.quickSkillList.writes, 1);

  // Refresh ticks that changed nothing about the strip must not touch its markup.
  module.renderQuickSkills();
  module.renderQuickSkills();
  assert.equal(elements.quickSkillList.writes, 1);

  // A prompt edit is invisible in the markup, so it is deliberately outside the signature.
  state.quickSkills[0].prompt = 'A different prompt.';
  module.renderQuickSkills();
  assert.equal(elements.quickSkillList.writes, 1);

  state.quickSkills[0].label = 'Deploy checks';
  module.renderQuickSkills();
  assert.equal(elements.quickSkillList.writes, 2);

  state.quickSkills.reverse();
  module.renderQuickSkills();
  assert.equal(elements.quickSkillList.writes, 3);
  assert.deepEqual(
    [...elements.quickSkillList.html.matchAll(/data-quick-skill="([^"]+)"/g)].map((match) => match[1]),
    ['audit', 'deploy-check'],
  );
});

test('a label carrying spaces cannot collide with its neighbour through the signature', () => {
  const { module } = harness();
  const left = module.quickSkillStripSignature([
    { id: 'a', label: 'Deploy check' },
    { id: 'b', label: '' },
  ]);
  const right = module.quickSkillStripSignature([
    { id: 'a', label: 'Deploy' },
    { id: 'b', label: 'check' },
  ]);
  assert.notEqual(left, right);
});

test('disabled state and the context line are written in place on every refresh tick', () => {
  let issue = '';
  const { module, elements, state } = harness({ validationIssue: () => issue });
  module.renderQuickSkills();
  const [button] = elements.quickSkillList.children;
  const context = button.querySelector('[data-quick-skill-context]');

  assert.equal(button.disabled, false);
  assert.equal(context.textContent, 'Run now / Codex / high');

  issue = 'Choose a project before adding the task.';
  state.submitting = true;
  module.renderQuickSkills();

  assert.equal(elements.quickSkillList.writes, 1, 'a disabled-state change must never rebuild the strip');
  assert.equal(button.disabled, true);
  assert.equal(elements.quickSkillList.children[0], button, 'the live button node survives the tick');
});

/* --- dispatch --- */

test('a strip click dispatches the exact cataloged prompt through submitComposerTask', () => {
  const prompt = 'Compare with production.\n\nGo line by line.';
  const { module, elements, calls } = harness({
    skills: [
      { id: 'deploy-check', label: 'Deploy check', prompt },
      { id: 'audit', label: 'Audit', prompt: 'Audit it.' },
    ],
  });
  module.renderQuickSkills();

  module.handleQuickSkillListClick(clickEvent(elements.quickSkillList.children[1]));

  assert.equal(calls.submits.length, 1);
  assert.equal(calls.submits[0].event, null);
  assert.deepEqual(calls.submits[0].options, {
    quickSkill: { id: 'audit', label: 'Audit', prompt: 'Audit it.' },
  });

  module.handleQuickSkillListClick(clickEvent(elements.quickSkillList.children[0]));
  assert.equal(calls.submits[1].options.quickSkill.prompt, prompt);
  assert.equal(calls.alerts.length, 0);
});

test('a strip click on an id that left the catalog is a silent no-op', () => {
  const { module, elements, state, calls } = harness({
    skills: [{ id: 'deploy-check', label: 'Deploy check', prompt: 'One.' }],
  });
  module.renderQuickSkills();
  const [button] = elements.quickSkillList.children;

  // The operator deleted the quick action in another window between paint and click.
  state.quickSkills = [];
  module.handleQuickSkillListClick(clickEvent(button));

  assert.deepEqual(calls.submits, []);
  assert.deepEqual(calls.alerts, [], 'a vanished id is not the operator making a mistake');
});

test('a blocked strip click explains itself instead of dispatching', () => {
  const { module, elements, calls } = harness({
    validationIssue: () => 'Saved skills run as direct Execute tasks. Choose Execute without Plan council.',
  });
  module.renderQuickSkills();
  module.handleQuickSkillListClick(clickEvent(elements.quickSkillList.children[0]));

  assert.deepEqual(calls.submits, []);
  assert.deepEqual(calls.alerts, [{
    message: 'Saved skills run as direct Execute tasks. Choose Execute without Plan council.',
    kind: 'validation',
  }]);
});

test('the submission path keeps a quick action free of the composer draft, references, and images', () => {
  const start = app.indexOf('async function submitComposerTask');
  const end = app.indexOf("elements.standupButton.addEventListener('click'", start);
  assert.ok(start >= 0 && end > start);
  const submit = app.slice(start, end);

  assert.match(submit, /const runNow = quickSkill \? true : state\.prioritySubmit/);
  assert.match(submit, /const submissionTaskReferences = quickSkill \? \[\] : state\.taskReferences/);
  assert.match(submit, /const submissionAttachments = quickSkill \? \[\] : state\.attachments/);
  assert.match(submit, /quickSkill\?\.prompt \|\| formData\.get\('prompt'\)/);
  assert.match(submit, /if \(!quickSkill\) \{[\s\S]*?elements\.taskName\.value = '';[\s\S]*?elements\.prompt\.value = '';/);
  assert.match(app, /elements\.quickSkillList\.addEventListener\('click', handleQuickSkillListClick\)/);
  assert.doesNotMatch(quickSkillSource(), /elements\.prompt\.value\s*=/);
  assert.doesNotMatch(app, /elements\.quickSkillButtons/);
});

/* --- the editor --- */

test('the editor renders one row per quick action with reorder ends disabled', () => {
  const { module, elements } = harness({
    skills: [
      { id: 'deploy-check', label: 'Deploy check', prompt: 'One.' },
      { id: 'audit', label: 'Audit', prompt: 'Two.' },
      { id: 'notes', label: 'Release notes', prompt: 'Three.' },
    ],
  });
  module.renderQuickSkillEditor({ rebuild: true });
  const rows = parseEditorRows(elements.quickSkillEditorList.html);

  assert.deepEqual(rows.map((row) => row.dataset.quickSkillRow), ['deploy-check', 'audit', 'notes']);
  assert.equal(rows[0].querySelector('[data-quick-skill-action="up"]').disabled, true);
  assert.equal(rows[0].querySelector('[data-quick-skill-action="down"]').disabled, false);
  assert.equal(rows[2].querySelector('[data-quick-skill-action="down"]').disabled, true);
  assert.equal(elements.quickSkillAdd.disabled, false);
  assert.match(elements.quickSkillEditorStatus.textContent, /^3 of 12\./);
  assert.match(elements.quickSkillEditorList.html, new RegExp(`maxlength="${MAX_QUICK_SKILL_LABEL_LENGTH}"`));
  assert.match(elements.quickSkillEditorList.html, new RegExp(`maxlength="${MAX_QUICK_SKILL_PROMPT_LENGTH}"`));
});

test('the editor escapes operator text in both the label value and the prompt body', () => {
  const { module, elements } = harness({
    skills: [{ id: 'audit', label: '" onfocus="alert(1)', prompt: '</textarea><script>alert(2)</script>' }],
  });
  module.renderQuickSkillEditor({ rebuild: true });

  assert.doesNotMatch(elements.quickSkillEditorList.html, /onfocus="alert/);
  assert.doesNotMatch(elements.quickSkillEditorList.html, /<script>/);
  assert.match(elements.quickSkillEditorList.html, /value="&quot; onfocus=&quot;alert\(1\)"/);
  assert.match(elements.quickSkillEditorList.html, /&lt;\/textarea&gt;&lt;script&gt;/);
});

test('adding a quick action appends a uniquely identified draft row that is never saved', () => {
  const { module, elements, state, calls } = harness();
  module.renderQuickSkillEditor({ rebuild: true });
  module.addQuickSkill();
  module.addQuickSkill();

  assert.deepEqual(state.quickSkills.map((skill) => skill.id), ['deploy-check', 'new-quick-action', 'new-quick-action-2']);
  assert.equal(new Set(state.quickSkills.map((skill) => skill.id)).size, 3);
  assert.ok(state.quickSkills.every((skill) => QUICK_SKILL_ID_PATTERN.test(skill.id)));
  assert.equal(parseEditorRows(elements.quickSkillEditorList.html).length, 3);
  // An unwritten row is not a saved quick action, so adding one persists nothing at all.
  assert.equal(calls.saves, 0);
  assert.deepEqual(state.quickSkills.slice(1).map((skill) => skill.prompt), ['', '']);
});

test('Add is disabled once the strip holds twelve quick actions', () => {
  const skills = Array.from({ length: 11 }, (unused, index) => ({
    id: `skill-${index}`,
    label: `Skill ${index}`,
    prompt: `Prompt ${index}.`,
  }));
  const { module, elements, state } = harness({ skills });
  module.renderQuickSkillEditor({ rebuild: true });
  assert.equal(elements.quickSkillAdd.disabled, false);

  module.addQuickSkill();
  assert.equal(state.quickSkills.length, MAX_QUICK_SKILLS);
  assert.equal(elements.quickSkillAdd.disabled, true);

  module.addQuickSkill();
  assert.equal(state.quickSkills.length, MAX_QUICK_SKILLS, 'the cap holds against a second press');
});

test('removing and reordering rows produce the expected saved order', () => {
  const { module, elements, state, calls } = harness({
    skills: [
      { id: 'deploy-check', label: 'Deploy check', prompt: 'One.' },
      { id: 'audit', label: 'Audit', prompt: 'Two.' },
      { id: 'notes', label: 'Release notes', prompt: 'Three.' },
    ],
  });
  module.renderQuickSkillEditor({ rebuild: true });

  const down = elements.quickSkillEditorList.children[0].querySelector('[data-quick-skill-action="down"]');
  module.handleQuickSkillEditorClick(clickEvent(down));
  assert.deepEqual(state.quickSkills.map((skill) => skill.id), ['audit', 'deploy-check', 'notes']);

  const up = elements.quickSkillEditorList.children[2].querySelector('[data-quick-skill-action="up"]');
  module.handleQuickSkillEditorClick(clickEvent(up));
  assert.deepEqual(state.quickSkills.map((skill) => skill.id), ['audit', 'notes', 'deploy-check']);

  const remove = elements.quickSkillEditorList.children[0].querySelector('[data-quick-skill-action="remove"]');
  module.handleQuickSkillEditorClick(clickEvent(remove));
  assert.deepEqual(state.quickSkills.map((skill) => skill.id), ['notes', 'deploy-check']);
  assert.deepEqual(
    state.quickSkills,
    [
      { id: 'notes', label: 'Release notes', prompt: 'Three.' },
      { id: 'deploy-check', label: 'Deploy check', prompt: 'One.' },
    ],
    'the persisted payload keeps the three-member shape in the operator order',
  );
  assert.equal(calls.saves, 3);

  // A disabled reorder button at the end of the list changes nothing and saves nothing.
  const blocked = elements.quickSkillEditorList.children[0].querySelector('[data-quick-skill-action="up"]');
  module.handleQuickSkillEditorClick(clickEvent(blocked));
  assert.equal(calls.saves, 3);
});

test('reorder and remove keep keyboard focus on a live control', () => {
  const { module, elements } = harness({
    skills: [
      { id: 'deploy-check', label: 'Deploy check', prompt: 'One.' },
      { id: 'audit', label: 'Audit', prompt: 'Two.' },
    ],
  });
  module.renderQuickSkillEditor({ rebuild: true });

  module.handleQuickSkillEditorClick(clickEvent(
    elements.quickSkillEditorList.children[0].querySelector('[data-quick-skill-action="down"]'),
  ));
  // The moved row is now last, so Move down is disabled there and focus falls to Move up.
  const moved = elements.quickSkillEditorList.children[1];
  assert.equal(moved.dataset.quickSkillRow, 'deploy-check');
  assert.equal(moved.querySelector('[data-quick-skill-action="up"]').focused, 1);

  module.handleQuickSkillEditorClick(clickEvent(
    elements.quickSkillEditorList.children[1].querySelector('[data-quick-skill-action="remove"]'),
  ));
  assert.equal(elements.quickSkillEditorList.children.length, 1);
  assert.equal(elements.quickSkillEditorList.children[0].querySelector('[data-quick-skill-action="remove"]').focused, 1);
});

test('Restore default re-seeds the built-in catalog', () => {
  const { module, elements, state, calls } = harness({
    skills: [{ id: 'audit', label: 'Audit', prompt: 'Audit it.' }],
  });
  module.renderQuickSkillEditor({ rebuild: true });
  module.restoreDefaultQuickSkills();

  assert.deepEqual(state.quickSkills, DEFAULT_QUICK_SKILLS.map((skill) => ({ ...skill })));
  assert.notEqual(state.quickSkills[0], DEFAULT_QUICK_SKILLS[0], 'the frozen catalog is never handed to the editor');
  assert.equal(calls.saves, 1);
  assert.equal(elements.quickSkillRestore.focused, 1);
  assert.deepEqual(
    parseEditorRows(elements.quickSkillEditorList.html).map((row) => row.dataset.quickSkillRow),
    ['deploy-check'],
  );
});

test('clearing a label keeps the saved text instead of deleting the quick action', () => {
  const { module, elements, state, calls } = harness({
    skills: [{ id: 'deploy-check', label: 'Deploy check', prompt: 'One.' }],
  });
  module.renderQuickSkillEditor({ rebuild: true });
  const row = elements.quickSkillEditorList.children[0];
  const label = row.querySelector('[data-quick-skill-field="label"]');

  label.value = '';
  module.handleQuickSkillEditorInput(clickEvent(label));

  assert.equal(state.quickSkills.length, 1, 'an empty box is a keystroke, not a delete');
  assert.equal(state.quickSkills[0].label, 'Deploy check');
  assert.equal(row.dataset.invalid, 'true');
  assert.match(row.querySelector('[data-quick-skill-hint]').textContent, /Add a label/);
  assert.equal(calls.saves, 0, 'an unusable edit is never persisted');

  label.value = 'Release audit';
  module.handleQuickSkillEditorInput(clickEvent(label));

  assert.equal(state.quickSkills[0].label, 'Release audit');
  assert.equal(row.dataset.invalid, 'false');
  assert.equal(row.querySelector('[data-quick-skill-hint]').textContent, '');
  assert.equal(calls.saves, 1);
  // The renamed label reaches the strip without touching the editor row being typed into.
  assert.match(elements.quickSkillList.html, /Release audit/);
  assert.equal(elements.quickSkillEditorList.writes, 1);
});

test('Enter in a label cannot implicitly submit the composer the modal lives inside', () => {
  // The dialog is a descendant of <form id="task-form">, so the label input's form owner is
  // the composer: without the guard a rename keystroke would queue a real task.
  const formStart = markup.indexOf('<form id="task-form">');
  const editor = markup.indexOf('id="quick-skill-editor-list"');
  const formEnd = markup.indexOf('</form>', formStart);
  assert.ok(formStart >= 0 && editor > formStart && formEnd > editor);

  const { module, elements } = harness();
  module.renderQuickSkillEditor({ rebuild: true });
  const row = elements.quickSkillEditorList.children[0];
  const prevented = [];
  const keydown = (node, key) => ({ key, target: node, preventDefault: () => prevented.push(key) });

  module.handleQuickSkillEditorKeydown(keydown(row.querySelector('[data-quick-skill-field="label"]'), 'Enter'));
  assert.deepEqual(prevented, ['Enter']);

  // A newline inside the prompt, and every other key in the label, stay untouched.
  module.handleQuickSkillEditorKeydown(keydown(row.querySelector('[data-quick-skill-field="prompt"]'), 'Enter'));
  module.handleQuickSkillEditorKeydown(keydown(row.querySelector('[data-quick-skill-field="label"]'), 'a'));
  assert.deepEqual(prevented, ['Enter']);
  assert.match(app, /elements\.quickSkillEditorList\.addEventListener\('keydown', handleQuickSkillEditorKeydown\)/);
});

test('a refresh that changed nothing syncs editor values without rebuilding the rows', () => {
  const { module, elements, state } = harness({
    skills: [{ id: 'deploy-check', label: 'Deploy check', prompt: 'One.' }],
  });
  module.renderQuickSkillEditor({ rebuild: true });
  assert.equal(elements.quickSkillEditorList.writes, 1);

  module.renderQuickSkillEditor();
  module.renderQuickSkillEditor();
  assert.equal(elements.quickSkillEditorList.writes, 1);

  // A value changed elsewhere is written into the live input rather than through a rebuild.
  state.quickSkills[0].prompt = 'Two.';
  module.renderQuickSkillEditor();
  assert.equal(elements.quickSkillEditorList.writes, 1);
  assert.equal(
    elements.quickSkillEditorList.children[0].querySelector('[data-quick-skill-field="prompt"]').value,
    'Two.',
  );
});

/* --- preferences plumbing --- */

test('a preferences record with no quickSkills member yields the built-in catalog', () => {
  const { module, state } = harness({ skills: [{ id: 'audit', label: 'Audit', prompt: 'Audit it.' }] });
  const legacyServerRecord = { panelWidths: {}, headerPosition: 'top' };

  module.setQuickSkills(legacyServerRecord.quickSkills, { persist: false });

  assert.deepEqual(state.quickSkills, DEFAULT_QUICK_SKILLS.map((skill) => ({ ...skill })));
  assert.match(app, /setQuickSkills\(preferences\.quickSkills, \{ persist: false \}\)/);
  assert.match(app, /quickSkills: state\.quickSkills,/);
});

test('an empty saved array is authoritative and is not repaired into the default', () => {
  const { module, state, elements } = harness();
  module.setQuickSkills([], { persist: false });

  assert.deepEqual(state.quickSkills, []);
  assert.equal(elements.quickSkillList.hidden, true);
  assert.match(elements.quickSkillEditorStatus.textContent, /No quick actions\./);
});

test('generated ids stay inside the persisted id grammar', () => {
  const { module } = harness();

  assert.equal(module.uniqueQuickSkillId('Deploy check'), 'deploy-check');
  assert.equal(module.uniqueQuickSkillId('  Release NOTES!!  '), 'release-notes');
  assert.equal(module.uniqueQuickSkillId('日本語'), 'quick-action');
  assert.equal(module.uniqueQuickSkillId(''), 'quick-action');
  assert.equal(module.uniqueQuickSkillId('Audit', ['audit', 'audit-2']), 'audit-3');
  for (const label of ['Deploy check', '  Release NOTES!!  ', '日本語', '', 'a'.repeat(200)]) {
    assert.match(module.uniqueQuickSkillId(label), QUICK_SKILL_ID_PATTERN);
  }
});

/* --- markup and layout --- */

test('terminal settings carries the quick-action editor beside the other app-wide sections', () => {
  const modalStart = markup.indexOf('id="terminal-settings-modal"');
  const editor = markup.indexOf('id="quick-skill-settings"', modalStart);
  const voice = markup.indexOf('id="voice-input-settings"', modalStart);
  const modalEnd = markup.indexOf('</dialog>', modalStart);

  assert.ok(modalStart >= 0 && editor > modalStart && voice > editor && modalEnd > voice);
  assert.match(markup, /<section id="quick-skill-settings" class="terminal-settings-section quick-skill-settings"/);
  assert.match(markup, /id="quick-skill-add" class="button compact" type="button">Add quick action</);
  assert.match(markup, /id="quick-skill-restore" class="button compact" type="button">Restore default</);
  assert.match(markup, /<ol id="quick-skill-editor-list" class="quick-skill-editor-list"><\/ol>/);
  assert.match(markup, /id="quick-skill-editor-status"[^>]*role="status"/);
});

test('the strip scrolls sideways so extra quick actions never widen the composer', () => {
  assert.match(style, /\.quick-skill-list \{[\s\S]*?display: flex;[\s\S]*?min-width: 0;[\s\S]*?overflow-x: auto;/);
  assert.match(style, /\.quick-skill-button \{[\s\S]*?flex: 1 1 auto;[\s\S]*?min-height: 34px;/);
  assert.match(style, /\.composer-quick-actions \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  // Wrapping would grow the composer instead of the strip, breaking the one-row contract.
  const stripBlock = /\n\.quick-skill-list \{([\s\S]*?)\n\}/.exec(style);
  assert.ok(stripBlock, 'the strip rule should be readable on its own');
  assert.doesNotMatch(stripBlock[1], /flex-wrap/);
});

test('the editor keeps visible focus and a readable disabled state in both themes', () => {
  assert.match(style, /\.quick-skill-row-label input:focus-visible,[\s\S]*?outline: 2px solid var\(--composer-accent, var\(--blue\)\);/);
  assert.match(style, /\.quick-skill-row-action:disabled \{[\s\S]*?opacity: \.48;/);
  assert.match(style, /html\[data-theme="dark"\] \.quick-skill-row \{/);
  assert.match(style, /html\[data-theme="dark"\] \.quick-skill-row-label input,/);
  assert.match(style, /html\[data-theme="dark"\] \.quick-skill-editor-status \{|html\[data-theme="dark"\] \.quick-skill-editor-status,/);
});

/* --- destructive actions ask first --- */

test('a cancelled Restore default leaves every saved quick action untouched and saves nothing', () => {
  const skills = [
    { id: 'audit', label: 'Audit', prompt: 'Audit it.' },
    { id: 'notes', label: 'Release notes', prompt: 'Write them.' },
  ];
  const { module, state, calls, elements } = harness({ skills, confirm: () => false });
  module.renderQuickSkillEditor({ rebuild: true });
  const before = elements.quickSkillEditorList.writes;

  module.restoreDefaultQuickSkills();

  assert.deepEqual(state.quickSkills, skills);
  assert.equal(calls.saves, 0, 'a declined wipe never reaches the debounce');
  assert.equal(elements.quickSkillEditorList.writes, before, 'the rows are not even rebuilt');
  assert.deepEqual(calls.confirms, [
    'Replace every saved quick action with the built-in Deploy check? This cannot be undone.',
  ]);
});

test('an accepted Restore default re-seeds the built-in catalog', () => {
  const { module, elements, state, calls } = harness({
    skills: [{ id: 'audit', label: 'Audit', prompt: 'Audit it.' }],
  });
  module.renderQuickSkillEditor({ rebuild: true });
  module.restoreDefaultQuickSkills();

  assert.equal(calls.confirms.length, 1);
  assert.deepEqual(state.quickSkills, DEFAULT_QUICK_SKILLS.map((skill) => ({ ...skill })));
  assert.equal(calls.saves, 1);
  assert.equal(elements.quickSkillRestore.focused, 1);
});

test('a cancelled Remove keeps the row, its prompt, and the strip button', () => {
  const skills = [
    { id: 'audit', label: 'Audit', prompt: 'Audit it.' },
    { id: 'notes', label: 'Release notes', prompt: 'Write them.' },
  ];
  const { module, elements, state, calls } = harness({ skills, confirm: () => false });
  module.renderQuickSkills();
  module.renderQuickSkillEditor({ rebuild: true });

  const remove = elements.quickSkillEditorList.children[1].querySelector('[data-quick-skill-action="remove"]');
  module.handleQuickSkillEditorClick(clickEvent(remove));

  assert.deepEqual(state.quickSkills, skills);
  assert.equal(calls.saves, 0);
  assert.deepEqual(calls.confirms, ['Remove quick action "Release notes"? This cannot be undone.']);
  assert.match(elements.quickSkillList.html, /data-quick-skill="notes"/);
});

test('an accepted Remove drops the row, and an unwritten draft never asks', () => {
  const { module, elements, state, calls } = harness({
    skills: [{ id: 'audit', label: 'Audit', prompt: 'Audit it.' }],
  });
  module.renderQuickSkillEditor({ rebuild: true });
  module.addQuickSkill();
  assert.deepEqual(state.quickSkills.map((skill) => skill.id), ['audit', 'new-quick-action']);

  // The draft holds nothing to lose, so removing it is not a confirmed deletion.
  const draftRemove = elements.quickSkillEditorList.children[1].querySelector('[data-quick-skill-action="remove"]');
  module.handleQuickSkillEditorClick(clickEvent(draftRemove));
  assert.deepEqual(calls.confirms, []);
  assert.deepEqual(state.quickSkills.map((skill) => skill.id), ['audit']);

  const remove = elements.quickSkillEditorList.children[0].querySelector('[data-quick-skill-action="remove"]');
  module.handleQuickSkillEditorClick(clickEvent(remove));
  assert.deepEqual(calls.confirms, ['Remove quick action "Audit"? This cannot be undone.']);
  assert.deepEqual(state.quickSkills, []);
});

/* --- draft rows --- */

test('a newly added row is marked incomplete and stays off the composer strip', () => {
  const { module, elements, state } = harness({
    skills: [{ id: 'audit', label: 'Audit', prompt: 'Audit it.' }],
  });
  module.renderQuickSkills();
  module.renderQuickSkillEditor({ rebuild: true });
  const writesBefore = elements.quickSkillList.writes;

  module.addQuickSkill();

  const rows = parseEditorRows(elements.quickSkillEditorList.html);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].dataset.invalid, 'true');
  assert.match(rows[1].querySelector('[data-quick-skill-hint]').textContent, /Add a prompt\./);
  assert.match(rows[1].querySelector('[data-quick-skill-hint]').textContent, /not saved until you do/);
  assert.match(elements.quickSkillEditorStatus.textContent, /1 without a prompt is not saved\./);

  // The placeholder prompt is gone, so there is no button that could queue a real provider run.
  assert.equal(elements.quickSkillList.writes, writesBefore, 'a draft changes nothing on the strip');
  assert.doesNotMatch(elements.quickSkillList.html, /data-quick-skill="new-quick-action"/);
  assert.doesNotMatch(elements.quickSkillList.html, /Describe the outcome/);
  assert.deepEqual(module.quickSkillStripEntries(state.quickSkills).map((skill) => skill.id), ['audit']);
});

test('writing the first prompt into a draft is what puts its button on the strip', () => {
  const { module, elements, state, calls } = harness({
    skills: [{ id: 'audit', label: 'Audit', prompt: 'Audit it.' }],
  });
  module.renderQuickSkills();
  module.renderQuickSkillEditor({ rebuild: true });
  module.addQuickSkill();
  const row = elements.quickSkillEditorList.children[1];
  const prompt = row.querySelector('[data-quick-skill-field="prompt"]');

  prompt.value = 'Ship the release notes.';
  module.handleQuickSkillEditorInput(clickEvent(prompt));

  assert.equal(state.quickSkills[1].prompt, 'Ship the release notes.');
  assert.equal(row.dataset.invalid, 'false');
  assert.equal(row.querySelector('[data-quick-skill-hint]').textContent, '');
  assert.match(elements.quickSkillList.html, /data-quick-skill="new-quick-action"/);
  assert.equal(calls.saves, 1, 'the finished quick action is the first thing worth persisting');
  // Normalization would have accepted it by then, which is what makes the strip and the record agree.
  assert.deepEqual(normalizeQuickSkills(state.quickSkills).map((skill) => skill.id), ['audit', 'new-quick-action']);
});

test('editing a neighbouring row never silently deletes an unfinished draft', () => {
  const { module, elements, state } = harness({
    skills: [
      { id: 'audit', label: 'Audit', prompt: 'Audit it.' },
      { id: 'notes', label: 'Release notes', prompt: 'Write them.' },
    ],
  });
  module.renderQuickSkillEditor({ rebuild: true });
  module.addQuickSkill();

  const down = elements.quickSkillEditorList.children[0].querySelector('[data-quick-skill-action="down"]');
  module.handleQuickSkillEditorClick(clickEvent(down));
  assert.deepEqual(state.quickSkills.map((skill) => skill.id), ['notes', 'audit', 'new-quick-action']);

  const remove = elements.quickSkillEditorList.children[0].querySelector('[data-quick-skill-action="remove"]');
  module.handleQuickSkillEditorClick(clickEvent(remove));
  assert.deepEqual(state.quickSkills.map((skill) => skill.id), ['audit', 'new-quick-action']);
  assert.equal(parseEditorRows(elements.quickSkillEditorList.html).at(-1).dataset.invalid, 'true');
});

/* --- boot --- */

test('boot wires the strip and the editor when the markup is there', () => {
  const { module, elements } = harness();
  module.bindQuickSkillEvents();

  assert.deepEqual(elements.quickSkillList.listeners.map((entry) => entry.type), ['click']);
  assert.deepEqual(elements.quickSkillEditorList.listeners.map((entry) => entry.type), ['click', 'input', 'keydown']);
  assert.deepEqual(elements.quickSkillAdd.listeners.map((entry) => entry.type), ['click']);
  assert.deepEqual(elements.quickSkillRestore.listeners.map((entry) => entry.type), ['click']);
  assert.match(app, /^bindQuickSkillEvents\(\);$/m);
});

test('boot survives missing quick-skill markup instead of taking the renderer down', () => {
  const { module, elements } = harness({
    missingElements: ['quickSkillList', 'quickSkillEditorList', 'quickSkillAdd', 'quickSkillRestore', 'quickSkillEditorStatus'],
  });

  assert.doesNotThrow(() => module.bindQuickSkillEvents());
  assert.doesNotThrow(() => module.renderQuickSkills());
  assert.doesNotThrow(() => module.renderQuickSkillEditor({ rebuild: true }));
  assert.doesNotThrow(() => module.setQuickSkills(DEFAULT_QUICK_SKILLS, { persist: false }));
  assert.equal(elements.quickSkillList, null);
});

test('a renamed Add button still leaves the strip its click handler', () => {
  const { module, elements } = harness({ missingElements: ['quickSkillAdd'] });
  module.bindQuickSkillEvents();

  assert.deepEqual(elements.quickSkillList.listeners.map((entry) => entry.type), ['click']);
  assert.doesNotThrow(() => module.renderQuickSkillEditor({ rebuild: true }));
});

/* --- preferences save failures are visible --- */

function saveHarness({
  payload = { quickSkills: [{ id: 'audit', label: 'Audit', prompt: 'Audit it.' }] },
  respond = () => Promise.resolve({}),
  modalOpen = false,
  source = app,
} = {}) {
  const calls = { requests: [], alerts: [], caches: 0, editorRenders: 0, warns: 0 };
  const state = { uiPreferencesSaveTimer: null, uiPreferencesSaveError: '' };
  const elements = { terminalSettingsModal: { open: modalOpen } };
  let pending = null;
  const module = uiPreferencesSaveModule({
    state,
    elements,
    window: {
      clearTimeout: () => {},
      setTimeout: (callback) => { pending = callback; return 7; },
    },
    api: (path, options) => {
      calls.requests.push({ path, options });
      return respond();
    },
    console: { warn: () => { calls.warns += 1; } },
    cacheUiPreferences: () => { calls.caches += 1; },
    uiPreferencesPayload: () => payload,
    renderQuickSkillEditor: () => { calls.editorRenders += 1; },
    setComposerAlert: (message, kind) => calls.alerts.push({ message, kind }),
  }, source);
  return { module, state, calls, flush: () => pending() };
}

test('an oversized payload is explained in the editor and never reaches the wire', async () => {
  const { module, state, calls, flush } = saveHarness({
    payload: { quickSkills: [{ id: 'audit', label: 'Audit', prompt: 'x'.repeat(1024 * 1024) }] },
  });

  module.queueUiPreferencesSave();
  await flush();

  assert.deepEqual(calls.requests, [], 'the byte pre-check fires before the PATCH');
  assert.match(state.uiPreferencesSaveError, /too large to save/);
  assert.match(state.uiPreferencesSaveError, /Shorten a quick-action prompt/);
  assert.equal(calls.editorRenders, 1, 'the editor status line is redrawn with the refusal');
  assert.equal(calls.alerts.length, 1, 'terminal settings is closed, so the composer says it');
});

test('the byte pre-check counts bytes rather than characters', () => {
  const { module } = saveHarness();
  const cap = module.MAX_UI_PREFERENCES_PAYLOAD_BYTES;

  assert.equal(module.uiPreferencesPayloadIssue('x'.repeat(cap)), '');
  assert.match(module.uiPreferencesPayloadIssue('x'.repeat(cap + 1)), /too large to save/);
  // Four bytes per emoji, so half the cap in JS characters is already over the byte cap.
  const emoji = '🚀'.repeat(cap / 4 + 1);
  assert.ok(emoji.length < cap, 'the string is shorter than the cap in characters');
  assert.match(module.uiPreferencesPayloadIssue(emoji), /too large to save/);
  // The constant has to stay under the route cap it tracks, with room for the framing.
  assert.ok(cap < 1024 * 1024 && cap >= 1024 * 1024 - 64 * 1024, 'the cap tracks the 1 MiB route limit');
  assert.match(uiPreferencesSaveSource(), /PATCH \/api\/ui-preferences in src\/server\.mjs/);
});

test('a refused preferences save is surfaced instead of swallowed by a console warning', async () => {
  const { module, state, calls, flush } = saveHarness({
    respond: () => Promise.reject(new Error('Request body too large.')),
  });

  module.queueUiPreferencesSave();
  await flush();

  assert.equal(calls.requests.length, 1);
  assert.match(state.uiPreferencesSaveError, /Could not save these settings\./);
  assert.equal(calls.warns, 1, 'the console record is kept as well');
  assert.deepEqual(calls.alerts, [{ message: state.uiPreferencesSaveError, kind: undefined }]);
});

test('with terminal settings open the refusal stays on the editor status line', async () => {
  const { module, state, calls, flush } = saveHarness({
    respond: () => Promise.reject(new Error('nope')),
    modalOpen: true,
  });

  module.queueUiPreferencesSave();
  await flush();

  assert.match(state.uiPreferencesSaveError, /Could not save these settings\./);
  assert.equal(calls.editorRenders, 1);
  assert.deepEqual(calls.alerts, [], 'no second copy of the message beside the open editor');
});

test('a save that succeeds clears a standing refusal', async () => {
  const { module, state, calls, flush } = saveHarness({ respond: () => Promise.reject(new Error('nope')) });
  module.queueUiPreferencesSave();
  await flush();
  assert.notEqual(state.uiPreferencesSaveError, '');

  const healthy = saveHarness();
  healthy.state.uiPreferencesSaveError = 'Could not save these settings.';
  healthy.module.queueUiPreferencesSave();
  await healthy.flush();

  assert.equal(healthy.state.uiPreferencesSaveError, '');
  assert.equal(healthy.calls.requests.length, 1);
  assert.equal(healthy.calls.requests[0].options.method, 'PATCH');
  assert.equal(healthy.calls.editorRenders, 1);
});

test('the editor status line prints a standing refusal ahead of the count', () => {
  const { module, elements, state } = harness();
  state.uiPreferencesSaveError = 'Could not save these settings.';
  module.renderQuickSkillEditor({ rebuild: true });

  assert.equal(elements.quickSkillEditorStatus.textContent, 'Could not save these settings.');
  assert.equal(elements.quickSkillEditorStatus.dataset.kind, 'failure');

  state.uiPreferencesSaveError = '';
  module.renderQuickSkillEditor();
  assert.match(elements.quickSkillEditorStatus.textContent, /^1 of 12\./);
  assert.equal(elements.quickSkillEditorStatus.dataset.kind, '');
});

/* --- styling --- */

test('strip focus rings are inset so the scroll container cannot clip them', () => {
  const focus = /\.quick-skill-button:focus-visible \{([\s\S]*?)\n\}/.exec(style);
  assert.ok(focus, 'the strip focus rule should be readable on its own');
  assert.match(focus[1], /outline: 2px solid var\(--composer-accent, var\(--blue\)\);/);
  assert.match(focus[1], /outline-offset: -2px;/);
});

test('a refused save reads as a failure on the status line in both themes', () => {
  assert.match(style, /\.quick-skill-editor-status\[data-kind="failure"\] \{[\s\S]*?color: var\(--danger\);/);
  assert.match(style, /html\[data-theme="dark"\] \.quick-skill-editor-status\[data-kind="failure"\] \{[\s\S]*?color: var\(--danger\);/);
});
