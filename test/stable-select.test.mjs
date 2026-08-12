import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setControlDisabled, setControlValue, setSelectOptions } from '../public/stable-select.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

/*
 * A select stub that parses the markup it is given the way a browser would, including
 * entity decoding. The decoding matters: escapeHtml writes &#39; for an apostrophe, so a
 * guard that compared the markup string against innerHTML read back from a real select
 * would never match for a label containing a quote and would rewrite the list on every
 * refresh tick, which is the defect these helpers exist to prevent.
 */
class SelectStub {
  constructor() {
    this.options = [];
    this.value = '';
    this.disabled = false;
    this.writes = 0;
  }

  set innerHTML(markup) {
    this.writes += 1;
    this.options = [...markup.matchAll(/<option value="([^"]*)"( disabled)?>([^<]*)<\/option>/g)]
      .map((match) => ({
        value: decode(match[1]),
        textContent: decode(match[3]),
        disabled: Boolean(match[2]),
      }));
  }
}

function decode(text) {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

const CLAUDE_MODELS = [
  { value: 'default', label: 'Account default · default' },
  { value: 'opus', label: 'Opus' },
  { value: 'fable', label: 'Fable' },
];

test('an unchanged option list is not rewritten', () => {
  const select = new SelectStub();

  assert.equal(setSelectOptions(select, CLAUDE_MODELS), true);
  assert.equal(setSelectOptions(select, CLAUDE_MODELS.map((option) => ({ ...option }))), false);
  assert.equal(select.writes, 1);
  assert.deepEqual(select.options.map((option) => option.value), ['default', 'opus', 'fable']);
});

test('labels carrying escaped characters still compare equal after parsing', () => {
  const select = new SelectStub();
  const options = [{ value: 'sonnet', label: `Claude's "fast" model & friends <beta>` }];

  assert.equal(setSelectOptions(select, options), true);
  assert.equal(setSelectOptions(select, [{ ...options[0] }]), false);
  assert.equal(select.writes, 1);
  assert.equal(select.options[0].textContent, `Claude's "fast" model & friends <beta>`);
});

test('a changed label, value, order, length, or disabled flag rewrites the list', () => {
  const changes = [
    [{ value: 'default', label: 'Account default · default' }, { value: 'opus', label: 'Opus 5' }, { value: 'fable', label: 'Fable' }],
    [{ value: 'default', label: 'Account default · default' }, { value: 'opus', label: 'Opus' }, { value: 'haiku', label: 'Fable' }],
    [{ value: 'opus', label: 'Opus' }, { value: 'default', label: 'Account default · default' }, { value: 'fable', label: 'Fable' }],
    [...CLAUDE_MODELS, { value: 'haiku', label: 'Haiku' }],
    [{ value: 'default', label: 'Account default · default', disabled: true }, { value: 'opus', label: 'Opus' }, { value: 'fable', label: 'Fable' }],
  ];

  for (const options of changes) {
    const select = new SelectStub();
    setSelectOptions(select, CLAUDE_MODELS);
    assert.equal(setSelectOptions(select, options), true);
    assert.equal(select.writes, 2);
  }
});

test('an empty catalog clears the options exactly once', () => {
  const select = new SelectStub();
  setSelectOptions(select, CLAUDE_MODELS);

  assert.equal(setSelectOptions(select, []), true);
  assert.equal(setSelectOptions(select, []), false);
  assert.deepEqual(select.options, []);
});

test('value and disabled writes are skipped when the control already matches', () => {
  const select = new SelectStub();

  assert.equal(setControlValue(select, 'fable'), true);
  assert.equal(setControlValue(select, 'fable'), false);
  assert.equal(setControlValue(select, null), true);
  assert.equal(select.value, '');
  assert.equal(setControlValue(select, 3), true);
  assert.equal(setControlValue(select, '3'), false);

  assert.equal(setControlDisabled(select, true), true);
  assert.equal(setControlDisabled(select, true), false);
  assert.equal(setControlDisabled(select, false), true);
});

/*
 * The two-second snapshot refresh and the four-second thread poll both re-run
 * renderExecutionControls and renderPlanControls. Writing option markup unconditionally
 * from those renderers closes the native popup of whichever select the user has open, so
 * choosing a Claude model needed several attempts. Any new direct write to one of these
 * selects reintroduces that defect.
 */
test('composer and Plan council selects are written through the change-guarded helpers', () => {
  const guarded = [
    'modelSelect',
    'planAuthorModel',
    'planReviewerModel',
    'planAuthorTerminal',
    'planAuthorEffort',
  ];

  for (const element of guarded) {
    assert.doesNotMatch(app, new RegExp(`elements\\.${element}\\.innerHTML\\s*=`), element);
    assert.doesNotMatch(app, new RegExp(`elements\\.${element}\\.value\\s*=`), element);
    assert.doesNotMatch(app, new RegExp(`elements\\.${element}\\.disabled\\s*=`), element);
  }

  /*
   * planCouncilEffortOptions writes both council effort selects through its select
   * parameter, so the per-element assertions above cannot see a regression inside it.
   */
  const effortOptionsStart = app.indexOf('function planCouncilEffortOptions');
  const effortOptionsEnd = app.indexOf('\nfunction ', effortOptionsStart + 1);
  assert.ok(effortOptionsStart >= 0 && effortOptionsEnd > effortOptionsStart);
  const effortOptionsSource = app.slice(effortOptionsStart, effortOptionsEnd);
  assert.doesNotMatch(effortOptionsSource, /select\.innerHTML\s*=/);
  assert.doesNotMatch(effortOptionsSource, /select\.value\s*=/);
  assert.doesNotMatch(effortOptionsSource, /select\.disabled\s*=/);
  assert.match(effortOptionsSource, /setSelectOptions\(select, \[/);

  assert.match(app, /setSelectOptions\(elements\.modelSelect/);
  assert.match(app, /setSelectOptions\(elements\.planAuthorModel/);
  assert.match(app, /setSelectOptions\(elements\.planReviewerModel/);
  assert.match(app, /import \{ setControlDisabled, setControlValue, setSelectOptions \} from '\.\/stable-select\.js';/);
});

test('the effort slider markers are rebuilt only when the effort list changes', () => {
  const start = app.indexOf('const renderedSteps =');
  const end = app.indexOf('renderEffortSelection(efforts, settings.effort);', start);
  assert.ok(start >= 0 && end > start);
  const guard = app.slice(start, end);

  assert.match(guard, /renderedSteps\.length !== effortValues\.length/);
  assert.match(guard, /renderedSteps\.some\(\(title, index\) => title !== effortValues\[index\]\)/);
  assert.match(guard, /elements\.effortSliderSteps\.innerHTML/);
});
