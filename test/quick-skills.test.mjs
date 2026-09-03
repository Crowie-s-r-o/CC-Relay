import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { QUICK_SKILLS, quickSkillById } from '../public/quick-skills.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const markup = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

const DEPLOY_CHECK_PROMPT = `I want you to create me a full list of things we changed, it needs to be detailed so no change escapes it, it should basically compare with production and it should be a release-pdf with versions compared .. it's very important to have the sentences short (in bullet list) and the changes grouped by categories

it is for me to verify we did only changes which we wanted to, be sure to go through every changed line of code`;

test('Deploy check is the first exact saved skill', () => {
  assert.equal(QUICK_SKILLS.length, 1);
  assert.deepEqual(quickSkillById('deploy-check'), {
    id: 'deploy-check',
    label: 'Deploy check',
    prompt: DEPLOY_CHECK_PROMPT,
  });
  assert.equal(quickSkillById('missing'), null);
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
  const clickEnd = app.indexOf("elements.taskReferenceMenu.addEventListener('click'");
  const clickStart = app.lastIndexOf('for (const button of elements.quickSkillButtons)', clickEnd);
  const clickSource = app.slice(clickStart, clickEnd);

  assert.ok(submitStart >= 0 && submitEnd > submitStart);
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
