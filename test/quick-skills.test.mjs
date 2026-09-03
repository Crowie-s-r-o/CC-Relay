import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DEFAULT_QUICK_SKILLS,
  normalizeQuickSkills,
  QUICK_SKILLS,
  quickSkillById,
} from '../public/quick-skills.js';
import {
  DEFAULT_QUICK_SKILLS as SERVER_DEFAULT_QUICK_SKILLS,
  normalizeQuickSkills as normalizeServerQuickSkills,
} from '../src/ui-preferences.mjs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const markup = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

const DEPLOY_CHECK_PROMPT = `I want you to create me a full list of things we changed, it needs to be detailed so no change escapes it, it should basically compare with production and it should be a release-pdf with versions compared .. it's very important to have the sentences short (in bullet list) and the changes grouped by categories

it is for me to verify we did only changes which we wanted to, be sure to go through every changed line of code`;

const DEPLOY_CHECK = {
  id: 'deploy-check',
  label: 'Deploy check',
  prompt: DEPLOY_CHECK_PROMPT,
};

function skill(overrides = {}) {
  return { id: 'alpha', label: 'Alpha', prompt: 'Do alpha.', ...overrides };
}

test('Deploy check is the exact built-in saved skill', () => {
  assert.equal(DEFAULT_QUICK_SKILLS.length, 1);
  assert.deepEqual(DEFAULT_QUICK_SKILLS[0], DEPLOY_CHECK);
  assert.equal(QUICK_SKILLS, DEFAULT_QUICK_SKILLS);
  assert.deepEqual(quickSkillById('deploy-check'), DEPLOY_CHECK);
  assert.equal(quickSkillById('missing'), null);
});

test('quickSkillById reads the live list and falls back to the built-in catalog', () => {
  const configured = [skill(), skill({ id: 'beta', label: 'Beta', prompt: 'Do beta.' })];
  assert.deepEqual(quickSkillById('beta', configured), configured[1]);
  assert.equal(quickSkillById('deploy-check', configured), null);
  // An operator who deleted every skill must not still dispatch the built-in one.
  assert.equal(quickSkillById('deploy-check', []), null);
  // Callers that never pass a list fail closed against the built-in catalog, not the saved one.
  assert.deepEqual(quickSkillById('deploy-check'), DEPLOY_CHECK);
  assert.deepEqual(quickSkillById('deploy-check', 'not-an-array'), DEPLOY_CHECK);
});

test('a missing or non-array quick-skill list resolves to the built-in catalog', () => {
  for (const value of [undefined, null, {}, 'x', 5, true, NaN]) {
    assert.deepEqual(
      normalizeQuickSkills(value),
      [DEPLOY_CHECK],
      `expected ${String(value)} to resolve to the built-in catalog`,
    );
  }
});

test('the built-in fallback is a fresh mutable copy the editor can reorder in place', () => {
  const first = normalizeQuickSkills(undefined);
  const second = normalizeQuickSkills(undefined);
  assert.notEqual(first, DEFAULT_QUICK_SKILLS);
  assert.notEqual(first, second);
  assert.notEqual(first[0], DEFAULT_QUICK_SKILLS[0]);
  assert.equal(Object.isFrozen(first), false);
  assert.equal(Object.isFrozen(first[0]), false);
  first.push(skill());
  first[0].label = 'Renamed';
  assert.equal(DEFAULT_QUICK_SKILLS.length, 1);
  assert.equal(DEFAULT_QUICK_SKILLS[0].label, 'Deploy check');
  assert.deepEqual(normalizeQuickSkills(undefined), [DEPLOY_CHECK]);
});

test('an explicit empty list stays empty so a deletion is permanent', () => {
  assert.deepEqual(normalizeQuickSkills([]), []);
});

test('quick-skill entries normalize their label and prompt and drop unknown keys', () => {
  assert.deepEqual(
    normalizeQuickSkills([{
      id: 'release-notes',
      label: '  Release   notes \n ',
      prompt: 'First line.\n\nSecond line.   \n\t',
      icon: 'rocket',
      runNow: false,
      nested: { provider: 'codex' },
    }]),
    [{ id: 'release-notes', label: 'Release notes', prompt: 'First line.\n\nSecond line.' }],
  );
  // Leading whitespace and interior newlines are part of the prompt the operator wrote.
  assert.equal(normalizeQuickSkills([skill({ prompt: '  keep\n\nme  ' })])[0].prompt, '  keep\n\nme');
});

test('invalid quick-skill entries are dropped while valid siblings survive', () => {
  const good = skill({ id: 'keeper', label: 'Keeper', prompt: 'Keep me.' });
  const rejected = [
    skill({ id: 'Bad-Case' }),
    skill({ id: '-leading-dash' }),
    skill({ id: 'has space' }),
    skill({ id: 'has_underscore' }),
    skill({ id: '' }),
    skill({ id: 'a'.repeat(65) }),
    skill({ id: 42 }),
    skill({ id: null }),
    skill({ label: '' }),
    skill({ label: '   ' }),
    skill({ label: 'a'.repeat(81) }),
    skill({ label: 7 }),
    skill({ label: null }),
    skill({ prompt: '' }),
    skill({ prompt: '   \n  ' }),
    skill({ prompt: 'a'.repeat(20001) }),
    skill({ prompt: 12 }),
    skill({ prompt: ['do', 'it'] }),
    null,
    undefined,
    'deploy-check',
    42,
    [],
    ['id', 'alpha'],
  ];
  for (const entry of rejected) {
    assert.deepEqual(
      normalizeQuickSkills([entry, good]),
      [good],
      `expected ${JSON.stringify(entry) ?? String(entry)} to be dropped`,
    );
  }
  // A 64-character id and boundary-length label and prompt are the largest legal entry.
  const boundary = skill({ id: 'a'.repeat(64), label: 'b'.repeat(80), prompt: 'c'.repeat(20000) });
  assert.deepEqual(normalizeQuickSkills([boundary]), [boundary]);
  // Trailing whitespace is trimmed before the length check, so this one is legal, not truncated.
  assert.equal(normalizeQuickSkills([skill({ prompt: `${'c'.repeat(20000)}   ` })])[0].prompt.length, 20000);
});

test('duplicate quick-skill ids keep the first entry in operator order', () => {
  assert.deepEqual(
    normalizeQuickSkills([
      skill({ id: 'dupe', label: 'First', prompt: 'First prompt.' }),
      skill({ id: 'other', label: 'Other', prompt: 'Other prompt.' }),
      skill({ id: 'dupe', label: 'Second', prompt: 'Second prompt.' }),
    ]),
    [
      { id: 'dupe', label: 'First', prompt: 'First prompt.' },
      { id: 'other', label: 'Other', prompt: 'Other prompt.' },
    ],
  );
});

test('the twelve-entry cap counts survivors, not input slots', () => {
  const thirteen = Array.from({ length: 13 }, (unused, index) => skill({
    id: `skill-${index}`,
    label: `Skill ${index}`,
    prompt: `Prompt ${index}.`,
  }));
  const capped = normalizeQuickSkills(thirteen);
  assert.equal(capped.length, 12);
  assert.deepEqual(capped, thirteen.slice(0, 12));

  // An invalid entry must not consume a slot and cost a valid later entry its place.
  const withInvalid = [...thirteen];
  withInvalid[2] = skill({ id: 'NOPE' });
  const survivors = normalizeQuickSkills(withInvalid);
  assert.equal(survivors.length, 12);
  assert.deepEqual(
    survivors.map((entry) => entry.id),
    thirteen.filter((entry, index) => index !== 2).map((entry) => entry.id),
  );

  // Far past the cap stays bounded and never throws.
  assert.equal(normalizeQuickSkills(Array.from({ length: 400 }, (unused, index) => skill({
    id: `bulk-${index}`,
  }))).length, 12);
});

test('the renderer and server quick-skill normalizers stay byte for byte in parity', () => {
  assert.deepEqual(SERVER_DEFAULT_QUICK_SKILLS, DEFAULT_QUICK_SKILLS);
  assert.equal(SERVER_DEFAULT_QUICK_SKILLS[0].prompt, DEPLOY_CHECK_PROMPT);

  const table = [
    undefined,
    null,
    {},
    'x',
    5,
    true,
    [],
    [skill()],
    [skill({ label: '  Spaced   out  ' })],
    [skill({ prompt: 'Body.\n\n  ' })],
    [skill({ id: 'Bad-Case' }), skill({ id: 'ok', label: 'Ok', prompt: 'Fine.' })],
    [skill({ label: 'a'.repeat(81) })],
    [skill({ prompt: 'a'.repeat(20001) })],
    [skill({ id: 'dupe' }), skill({ id: 'dupe', label: 'Second', prompt: 'Second.' })],
    [skill({ extra: 'stripped' })],
    [null, undefined, 42, 'text', []],
    Array.from({ length: 13 }, (unused, index) => skill({ id: `skill-${index}` })),
  ];
  for (const value of table) {
    assert.deepEqual(
      normalizeServerQuickSkills(value),
      normalizeQuickSkills(value),
      `renderer and server disagreed on ${JSON.stringify(value) ?? String(value)}`,
    );
  }
});

test('saved skills share the prompt footer equally with push-to-talk', () => {
  assert.match(
    markup,
    /id="composer-quick-actions"[\s\S]*?id="voice-input-composer"[\s\S]*?id="quick-skill-list"[\s\S]*?data-quick-skill="deploy-check"/,
  );
  assert.match(markup, /class="quick-skill-button" type="button"/);
  assert.match(style, /\.composer-quick-actions \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(style, /\.voice-input-composer \{[\s\S]*?min-width: 0;/);
  assert.match(style, /#voice-input-hold-label \{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/);
  assert.match(style, /\.quick-skill-button \{[\s\S]*?min-height: 34px;/);
  assert.match(style, /html\[data-theme="dark"\] \.quick-skill-button/);
  assert.match(app, /composerQuickActions\.dataset\.voiceAvailable = String\(supported\)/);
});

test('saved skills run immediately with selected execution settings and preserve the draft', () => {
  const submitStart = app.indexOf('async function submitComposerTask');
  const submitEnd = app.indexOf("elements.standupButton.addEventListener('click'", submitStart);
  const submitSource = app.slice(submitStart, submitEnd);
  // The strip is rebuilt whenever the operator edits it, so the click path is one delegated
  // listener rather than per-button listeners. Renaming this function must be coordinated: the
  // guard below turns a moved anchor into a loud failure instead of a regex against an empty
  // string.
  const clickStart = app.indexOf('function handleQuickSkillListClick(event)');
  const clickEnd = app.indexOf('\n}\n', clickStart);
  const clickSource = app.slice(clickStart, clickEnd);

  assert.ok(submitStart >= 0 && submitEnd > submitStart);
  assert.ok(clickStart >= 0 && clickEnd > clickStart, 'quick-skill click handler anchor moved');
  assert.match(submitSource, /const runNow = quickSkill \? true : state\.prioritySubmit/);
  assert.match(submitSource, /const submissionTaskReferences = quickSkill \? \[\] : state\.taskReferences/);
  assert.match(submitSource, /const submissionAttachments = quickSkill \? \[\] : state\.attachments/);
  assert.match(submitSource, /quickSkill\?\.prompt \|\| formData\.get\('prompt'\)/);
  assert.match(submitSource, /model: elements\.modelSelect\.value/);
  assert.match(submitSource, /effort: JSON\.parse\(elements\.effortSelect\.dataset\.values/);
  assert.match(submitSource, /if \(!quickSkill\) \{[\s\S]*?elements\.taskName\.value = '';[\s\S]*?elements\.prompt\.value = '';/);
  assert.match(clickSource, /submitComposerTask\(null, \{ quickSkill: skill \}\)/);
  assert.doesNotMatch(clickSource, /elements\.prompt\.value\s*=/);
});

test('saved skills stay direct and expose their selected target and effort', () => {
  assert.match(app, /Saved skills run as direct Execute tasks\. Choose Execute without Plan council\./);
  assert.match(app, /`Run now \/ \$\{target\} \/ \$\{effort\}`/);
  assert.match(app, /button\.disabled = state\.submitting \|\| Boolean\(issue\)/);
});
