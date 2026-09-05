import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  normalizeVoiceInputPreferences as normalizeRendererVoiceInputPreferences,
} from '../public/voice-input.js';
import { RelayDatabase } from '../src/database.mjs';
import {
  DEFAULT_QUICK_SKILLS,
  normalizeUiPreferences,
  normalizeVoiceInputPreferences,
  normalizeVoiceInputShortcut,
  parseUiPreferences,
  UI_PREFERENCES_SETTING,
} from '../src/ui-preferences.mjs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');

// Both caps are parsed from the server source rather than restated, so a cap change moves every
// byte-budget assertion in this file at once instead of leaving a stale literal behind.
function parseByteCap(source, pattern, description) {
  const match = source.match(pattern);
  assert.ok(match, `${description} was not found in src/server.mjs`);
  return Number(match[1]) * Number(match[2]);
}

const UI_PREFERENCES_ROUTE_SOURCE = (() => {
  const routeStart = server.indexOf(
    "request.method === 'PATCH' && pathname === '/api/ui-preferences'",
  );
  assert.ok(routeStart >= 0, 'the PATCH /api/ui-preferences route was not found');
  return server.slice(routeStart, routeStart + 1200);
})();

const UI_PREFERENCES_BODY_CAP = parseByteCap(
  UI_PREFERENCES_ROUTE_SOURCE,
  /readJson\(request, (\d+) \* (\d+)\)/,
  'the PATCH /api/ui-preferences body cap',
);

const READ_JSON_DEFAULT_CAP = parseByteCap(
  server,
  /async function readJson\(request, maxBytes = (\d+) \* (\d+)\)/,
  "readJson's module default cap",
);

test('UI preferences accept bounded layout values and normalize pixels', () => {
  assert.deepEqual(normalizeUiPreferences({
    panelWidths: { composer: 581.8, queue: 499.2 },
    terminalHeight: 700.6,
    headerPosition: 'bottom',
    terminalWindowView: 'mine',
    runningTaskLayout: { rows: 3, width: 360 },
    completionAlerts: {
      sound: 'bell',
      speak: true,
      speech: { project: false, task: true, status: true, taskWords: 4 },
    },
    voiceInput: { enabled: false, shortcut: 'Control+Shift+Space' },
  }), {
    panelWidths: { composer: 582, queue: 499 },
    terminalHeight: 701,
    terminalMode: 'native',
    headerPosition: 'bottom',
    terminalWindowView: 'mine',
    runningTaskLayout: { rows: 3, width: 360 },
    completionAlerts: {
      sound: 'bell',
      speak: true,
      speech: { project: false, task: true, status: true, taskWords: 4 },
    },
    voiceInput: {
      enabled: false,
      shortcut: 'Control+Shift+Space',
      alternateShortcut: null,
      microphoneLabel: null,
    },
    quickSkills: [...DEFAULT_QUICK_SKILLS],
  });
  assert.equal(normalizeUiPreferences({ panelWidths: { composer: 399, queue: 500 } }), null);
  assert.deepEqual(normalizeUiPreferences({
    panelWidths: { composer: 580, queue: 500 },
  })?.completionAlerts, {
    sound: 'chime',
    speak: false,
    speech: { project: true, task: true, status: false, taskWords: 1 },
  });
  assert.deepEqual(normalizeUiPreferences({
    panelWidths: { composer: 580, queue: 500 },
  })?.runningTaskLayout, { rows: 2, width: 286 });
  assert.deepEqual(normalizeUiPreferences({
    panelWidths: { composer: 580, queue: 500 },
  })?.voiceInput, {
    enabled: false,
    shortcut: 'Control+Shift+Space',
    alternateShortcut: null,
    microphoneLabel: null,
  });
  assert.deepEqual(normalizeUiPreferences({
    panelWidths: { composer: 580, queue: 500 },
    runningTaskLayout: { rows: 8, width: 999 },
  })?.runningTaskLayout, { rows: 2, width: 286 });
  assert.deepEqual(normalizeUiPreferences({
    panelWidths: { composer: 580, queue: 500 },
    completionAlerts: { sound: 'invalid', speak: 'yes' },
  })?.completionAlerts, {
    sound: 'chime',
    speak: false,
    speech: { project: true, task: true, status: false, taskWords: 1 },
  });
  assert.deepEqual(normalizeUiPreferences({
    panelWidths: { composer: 580, queue: 500 },
    completionAlerts: {
      sound: 'bell',
      speak: true,
      speech: { project: false, task: false, status: false, taskWords: 90 },
    },
  })?.completionAlerts, {
    sound: 'bell',
    speak: true,
    speech: { project: true, task: false, status: false, taskWords: 12 },
  });
  assert.equal(parseUiPreferences('{broken'), null);
});

test('voice input preferences keep two distinct canonical configurable shortcuts', () => {
  assert.equal(normalizeVoiceInputShortcut('Meta+Shift+KeyV'), 'Shift+Meta+KeyV');
  assert.equal(normalizeVoiceInputShortcut('Alt+F8'), 'Alt+F8');
  assert.equal(normalizeVoiceInputShortcut('Backquote'), 'Backquote');
  assert.equal(normalizeVoiceInputShortcut('Control+Enter'), 'Control+Shift+Space');
  assert.equal(normalizeVoiceInputShortcut('Control+Control+Space'), 'Control+Shift+Space');
  assert.deepEqual(normalizeVoiceInputPreferences({
    enabled: true,
    shortcut: 'Meta+Shift+KeyV',
    alternateShortcut: 'Control+F5',
    microphoneLabel: '  Desk   microphone  ',
  }), {
    enabled: true,
    shortcut: 'Shift+Meta+KeyV',
    alternateShortcut: 'Control+F5',
    microphoneLabel: 'Desk microphone',
  });
  assert.equal(normalizeVoiceInputPreferences({
    shortcut: 'F5',
    alternateShortcut: 'F5',
  }).alternateShortcut, null);
  assert.equal(normalizeVoiceInputPreferences({
    shortcut: 'F5',
    alternateShortcut: 'Enter',
  }).alternateShortcut, null);
  const sharedPreference = {
    enabled: true,
    shortcut: 'Meta+Shift+KeyV',
    alternateShortcut: 'Control+F5',
    microphoneLabel: '  Desk   microphone  ',
  };
  assert.deepEqual(
    normalizeRendererVoiceInputPreferences(sharedPreference),
    normalizeVoiceInputPreferences(sharedPreference),
  );
});

test('UI preferences persist in durable shared configuration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-ui-preferences-'));
  const databasePath = join(directory, 'relay.sqlite');
  const configPath = join(directory, 'relay-config.sqlite');
  const preferences = normalizeUiPreferences({
    panelWidths: { composer: 640, queue: 460 },
    terminalHeight: 720,
    headerPosition: 'bottom',
    runningTaskLayout: { rows: 2, width: 230 },
    completionAlerts: {
      sound: 'pulse',
      speak: false,
      speech: { project: true, task: true, status: false, taskWords: 6 },
    },
    voiceInput: {
      enabled: true,
      shortcut: 'Alt+F8',
      alternateShortcut: 'Meta+KeyV',
      microphoneLabel: 'Desk microphone',
    },
  });
  let database = new RelayDatabase(databasePath, { projectConfigPath: configPath });
  try {
    assert.equal(database.uiPreferences(), null);
    assert.deepEqual(database.setUiPreferences(preferences), preferences);
    database.close();
    database = new RelayDatabase(databasePath, { projectConfigPath: configPath });
    assert.deepEqual(database.uiPreferences(), preferences);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

const TERMINAL_WINDOW_VIEWS = ['all', 'conversation', 'mine', 'ai'];

function baseUiPreferenceInput(overrides = {}) {
  return {
    panelWidths: { composer: 620, queue: 440 },
    terminalHeight: 640,
    headerPosition: 'bottom',
    runningTaskLayout: { rows: 2, width: 230 },
    completionAlerts: {
      sound: 'bell',
      speak: true,
      speech: { project: false, task: true, status: true, taskWords: 5 },
    },
    voiceInput: {
      enabled: true,
      shortcut: 'Alt+F8',
      alternateShortcut: 'Meta+KeyV',
      microphoneLabel: 'Desk microphone',
    },
    ...overrides,
  };
}

test('terminal window view normalizes to the four supported ids', () => {
  assert.equal(normalizeUiPreferences(baseUiPreferenceInput()).terminalWindowView, 'all');
  for (const view of TERMINAL_WINDOW_VIEWS) {
    assert.equal(
      normalizeUiPreferences(baseUiPreferenceInput({ terminalWindowView: view })).terminalWindowView,
      view,
      `expected ${view} to survive normalization`,
    );
  }
  const rejected = [
    'timeline',
    'ALL',
    'Conversation',
    ' mine',
    '',
    null,
    undefined,
    42,
    true,
    ['ai'],
    { view: 'ai' },
  ];
  for (const value of rejected) {
    assert.equal(
      normalizeUiPreferences(baseUiPreferenceInput({ terminalWindowView: value }))
        .terminalWindowView,
      'all',
      `expected ${JSON.stringify(value) ?? String(value)} to fall back to all`,
    );
  }
  assert.equal(
    parseUiPreferences(JSON.stringify(baseUiPreferenceInput({ terminalWindowView: 'ai' })))
      .terminalWindowView,
    'ai',
  );
});

test('terminal window view persists app-wide and tolerates legacy records', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-terminal-window-view-'));
  const databasePath = join(directory, 'relay.sqlite');
  const configPath = join(directory, 'relay-config.sqlite');
  let database = new RelayDatabase(databasePath, { projectConfigPath: configPath });
  try {
    for (const view of TERMINAL_WINDOW_VIEWS) {
      const preferences = normalizeUiPreferences(baseUiPreferenceInput({
        terminalWindowView: view,
      }));
      assert.equal(database.setUiPreferences(preferences).terminalWindowView, view);
      database.close();
      database = new RelayDatabase(databasePath, { projectConfigPath: configPath });
      assert.deepEqual(database.uiPreferences(), preferences);
    }

    // A record saved before this member existed must still load, keep every other member, and
    // resolve the window view to the default.
    const legacyRecord = baseUiPreferenceInput();
    delete legacyRecord.terminalWindowView;
    const legacyJson = JSON.stringify(legacyRecord);
    assert.equal(legacyJson.includes('terminalWindowView'), false);
    database.projectConfig.setSetting(UI_PREFERENCES_SETTING, legacyJson);
    database.close();
    database = new RelayDatabase(databasePath, { projectConfigPath: configPath });
    const restored = database.uiPreferences();
    assert.equal(restored.terminalWindowView, 'all');
    assert.deepEqual(restored, normalizeUiPreferences(legacyRecord));
    assert.deepEqual(restored.panelWidths, { composer: 620, queue: 440 });
    assert.equal(restored.terminalHeight, 640);
    assert.equal(restored.headerPosition, 'bottom');
    assert.deepEqual(restored.runningTaskLayout, { rows: 2, width: 230 });
    assert.deepEqual(restored.completionAlerts, {
      sound: 'bell',
      speak: true,
      speech: { project: false, task: true, status: true, taskWords: 5 },
    });
    assert.deepEqual(restored.voiceInput, {
      enabled: true,
      shortcut: 'Alt+F8',
      alternateShortcut: 'Meta+KeyV',
      microphoneLabel: 'Desk microphone',
    });
    assert.deepEqual(parseUiPreferences(legacyJson), restored);

    // The route replaces the whole record, so a save that changes only this member must leave the
    // other members byte for byte identical.
    const changed = database.setUiPreferences(normalizeUiPreferences({
      ...restored,
      terminalWindowView: 'conversation',
    }));
    assert.equal(changed.terminalWindowView, 'conversation');
    assert.deepEqual({ ...changed, terminalWindowView: 'all' }, restored);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('renderer restores and saves layout through the durable preferences API', () => {
  assert.match(app, /api\('\/api\/ui-preferences'\)/);
  assert.match(app, /method: 'PATCH',[\s\S]*?body: JSON\.stringify\(uiPreferencesPayload\(\)\)/);
  assert.match(app, /setHeaderPosition\(preferences\.headerPosition, \{ persist: false \}\)/);
  assert.match(app, /setRunningTaskLayout\(preferences\.runningTaskLayout, \{ persist: false \}\)/);
  assert.match(app, /setVoiceInputPreferences\(preferences\.voiceInput, \{ persist: false \}\)/);
  assert.match(app, /const uiPreferencesReady = restoreUiPreferences\(\)/);
  assert.match(app, /const rendererStateReady = Promise\.all\(\[uiPreferencesReady, completionReviewsReady\]\)/);
  assert.match(app, /rendererStateReady\.then\(\(\) => load\(\)\)/);
  assert.match(server, /request\.method === 'GET' && pathname === '\/api\/ui-preferences'/);
  assert.match(server, /request\.method === 'PATCH' && pathname === '\/api\/ui-preferences'/);
});

function quickSkill(overrides = {}) {
  return { id: 'alpha', label: 'Alpha', prompt: 'Do alpha.', ...overrides };
}

test('saved quick skills join the preferences record without ever making it unusable', () => {
  // A record written before this member existed keeps the built-in catalog.
  const legacy = baseUiPreferenceInput();
  assert.equal('quickSkills' in legacy, false);
  assert.deepEqual(normalizeUiPreferences(legacy).quickSkills, [...DEFAULT_QUICK_SKILLS]);
  for (const value of [undefined, null, {}, 'x', 5, true]) {
    assert.deepEqual(
      normalizeUiPreferences(baseUiPreferenceInput({ quickSkills: value })).quickSkills,
      [...DEFAULT_QUICK_SKILLS],
      `expected ${String(value)} to fall back to the built-in catalog`,
    );
  }

  // An explicit empty array is authoritative: this is how a deletion becomes permanent.
  assert.deepEqual(normalizeUiPreferences(baseUiPreferenceInput({ quickSkills: [] })).quickSkills, []);

  // Nothing about a quick skill may make the whole preferences record unsavable. Only the
  // existing panel-width rule is allowed to return null.
  const hostile = [
    [],
    [quickSkill({ id: 'BAD' })],
    [quickSkill({ label: '' })],
    [quickSkill({ label: 'a'.repeat(81) })],
    [quickSkill({ prompt: '' })],
    [quickSkill({ prompt: 'a'.repeat(20001) })],
    [null, undefined, 42, 'text', [], { id: 'ok' }],
    Array.from({ length: 13 }, (unused, index) => quickSkill({ id: `skill-${index}` })),
    'not-an-array',
    { deploy: 'check' },
    0,
    Number.NaN,
  ];
  for (const value of hostile) {
    const preferences = normalizeUiPreferences(baseUiPreferenceInput({ quickSkills: value }));
    assert.notEqual(preferences, null, `quickSkills ${JSON.stringify(value)} must not void the record`);
    assert.ok(Array.isArray(preferences.quickSkills));
    assert.ok(preferences.quickSkills.length <= 12);
    // Every other member survives untouched.
    assert.deepEqual(preferences.panelWidths, { composer: 620, queue: 440 });
    assert.equal(preferences.terminalHeight, 640);
    assert.equal(preferences.headerPosition, 'bottom');
  }
  // The panel-width rule is still the only path to null, quick skills or not.
  assert.equal(normalizeUiPreferences({
    panelWidths: { composer: 399, queue: 500 },
    quickSkills: [quickSkill()],
  }), null);
});

test('saved quick skills survive the JSON round trip and durable configuration', () => {
  const configured = [
    quickSkill({ id: 'release-notes', label: '  Release   notes  ', prompt: 'Line one.\n\nLine two.  ' }),
    quickSkill({ id: 'release-notes', label: 'Duplicate', prompt: 'Loses to the first.' }),
    quickSkill({ id: 'BAD', label: 'Dropped', prompt: 'Dropped.' }),
    quickSkill({ id: 'audit', label: 'Audit', prompt: 'Audit it.', unknown: 'stripped' }),
  ];
  const expected = [
    { id: 'release-notes', label: 'Release notes', prompt: 'Line one.\n\nLine two.' },
    { id: 'audit', label: 'Audit', prompt: 'Audit it.' },
  ];
  const input = baseUiPreferenceInput({ quickSkills: configured });
  const preferences = normalizeUiPreferences(input);
  assert.deepEqual(preferences.quickSkills, expected);
  assert.deepEqual(parseUiPreferences(JSON.stringify(input)), preferences);
  assert.deepEqual(parseUiPreferences(JSON.stringify(preferences)), preferences);
  assert.deepEqual(
    parseUiPreferences(JSON.stringify(baseUiPreferenceInput({ quickSkills: [] }))).quickSkills,
    [],
  );

  const directory = mkdtempSync(join(tmpdir(), 'relay-quick-skills-'));
  const databasePath = join(directory, 'relay.sqlite');
  const configPath = join(directory, 'relay-config.sqlite');
  let database = new RelayDatabase(databasePath, { projectConfigPath: configPath });
  try {
    assert.deepEqual(database.setUiPreferences(preferences), preferences);
    database.close();
    database = new RelayDatabase(databasePath, { projectConfigPath: configPath });
    assert.deepEqual(database.uiPreferences(), preferences);

    // An emptied strip has to be durable, not silently re-seeded on the next load.
    const emptied = normalizeUiPreferences({ ...preferences, quickSkills: [] });
    assert.deepEqual(database.setUiPreferences(emptied).quickSkills, []);
    database.close();
    database = new RelayDatabase(databasePath, { projectConfigPath: configPath });
    assert.deepEqual(database.uiPreferences().quickSkills, []);

    // A full strip is far past the route's old 16 KB body cap, so the raised cap is load bearing.
    const full = normalizeUiPreferences({
      ...preferences,
      quickSkills: Array.from({ length: 12 }, (unused, index) => quickSkill({
        id: `bulk-${index}`,
        label: `Bulk ${index}`,
        prompt: 'p'.repeat(20000),
      })),
    });
    assert.equal(full.quickSkills.length, 12);
    const serialized = JSON.stringify(full);
    assert.ok(serialized.length > 16 * 1024, 'a full strip must exceed the former body cap');
    assert.ok(
      Buffer.byteLength(serialized, 'utf8') <= UI_PREFERENCES_BODY_CAP,
      'a full ASCII strip must fit the raised body cap',
    );
    assert.deepEqual(database.setUiPreferences(full), full);
    database.close();
    database = new RelayDatabase(databasePath, { projectConfigPath: configPath });
    assert.deepEqual(database.uiPreferences(), full);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the preferences route accepts a body large enough for a full quick-skill strip', () => {
  assert.ok(UI_PREFERENCES_ROUTE_SOURCE.length > 0);
  assert.match(UI_PREFERENCES_ROUTE_SOURCE, /readJson\(request, 1024 \* 1024\)/);
  // The one route that carries a 240000-character member must never sit below the module norm.
  assert.ok(
    UI_PREFERENCES_BODY_CAP >= READ_JSON_DEFAULT_CAP,
    'the preferences body cap must not sit below readJson\'s module default',
  );
});

test('a worst-realistic preferences record fits the preferences route body cap', () => {
  /*
   * JSON.stringify leaves non-ASCII code points unescaped, so a CJK prompt costs three bytes per
   * character while the ASCII fixture above costs one. A Chinese or Japanese operator with a full
   * strip is the realistic worst case, and it is the case the former 512 KB cap rejected with a
   * silent 422. This measures real serialized bytes so a future cap change, or a new preferences
   * member, fails here instead of destroying an operator's saved layout in production.
   */
  const record = normalizeUiPreferences(baseUiPreferenceInput({
    terminalWindowView: 'mine',
    quickSkills: Array.from({ length: 12 }, (unused, index) => quickSkill({
      id: `cjk-${index}`,
      label: '\u6f22\u5b57'.repeat(20),
      prompt: '\u6f22'.repeat(20000),
    })),
  }));
  assert.equal(record.quickSkills.length, 12);
  assert.equal(record.quickSkills[0].prompt.length, 20000);
  const bytes = Buffer.byteLength(JSON.stringify(record), 'utf8');
  assert.ok(
    bytes > 512 * 1024,
    `a full CJK strip must exceed the former 512 KB cap, measured ${bytes} bytes`,
  );
  assert.ok(
    bytes <= UI_PREFERENCES_BODY_CAP,
    `a full CJK strip must fit the preferences body cap, measured ${bytes} bytes`,
  );
});

test('original terminal is the default inline mode and the activity fallback persists', () => {
  for (const value of [undefined, null, 'unknown', '<script>', {}]) {
    assert.equal(normalizeUiPreferences(baseUiPreferenceInput({ terminalMode: value })).terminalMode, 'native');
  }
  const saved = normalizeUiPreferences(baseUiPreferenceInput({ terminalMode: 'activity', terminalWindowView: 'activity' }));
  assert.equal(parseUiPreferences(JSON.stringify(saved)).terminalMode, 'activity');
  assert.equal(parseUiPreferences(JSON.stringify(saved)).terminalWindowView, 'activity');
});
