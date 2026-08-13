import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { RelayDatabase } from '../src/database.mjs';
import { normalizeUiPreferences, parseUiPreferences } from '../src/ui-preferences.mjs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');

test('UI preferences accept bounded layout values and normalize pixels', () => {
  assert.deepEqual(normalizeUiPreferences({
    panelWidths: { composer: 581.8, queue: 499.2 },
    terminalHeight: 700.6,
    headerPosition: 'bottom',
    runningTaskLayout: { rows: 3, width: 360 },
    completionAlerts: { sound: 'bell', speak: true },
  }), {
    panelWidths: { composer: 582, queue: 499 },
    terminalHeight: 701,
    headerPosition: 'bottom',
    runningTaskLayout: { rows: 3, width: 360 },
    completionAlerts: { sound: 'bell', speak: true },
  });
  assert.equal(normalizeUiPreferences({ panelWidths: { composer: 399, queue: 500 } }), null);
  assert.deepEqual(normalizeUiPreferences({
    panelWidths: { composer: 580, queue: 500 },
  })?.completionAlerts, { sound: 'chime', speak: false });
  assert.deepEqual(normalizeUiPreferences({
    panelWidths: { composer: 580, queue: 500 },
  })?.runningTaskLayout, { rows: 1, width: 286 });
  assert.deepEqual(normalizeUiPreferences({
    panelWidths: { composer: 580, queue: 500 },
    runningTaskLayout: { rows: 8, width: 999 },
  })?.runningTaskLayout, { rows: 1, width: 286 });
  assert.deepEqual(normalizeUiPreferences({
    panelWidths: { composer: 580, queue: 500 },
    completionAlerts: { sound: 'invalid', speak: 'yes' },
  })?.completionAlerts, { sound: 'chime', speak: false });
  assert.equal(parseUiPreferences('{broken'), null);
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
    completionAlerts: { sound: 'pulse', speak: false },
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

test('renderer restores and saves layout through the durable preferences API', () => {
  assert.match(app, /api\('\/api\/ui-preferences'\)/);
  assert.match(app, /method: 'PATCH',[\s\S]*?body: JSON\.stringify\(uiPreferencesPayload\(\)\)/);
  assert.match(app, /setHeaderPosition\(preferences\.headerPosition, \{ persist: false \}\)/);
  assert.match(app, /setRunningTaskLayout\(preferences\.runningTaskLayout, \{ persist: false \}\)/);
  assert.match(app, /const uiPreferencesReady = restoreUiPreferences\(\)/);
  assert.match(app, /uiPreferencesReady\.then\(\(\) => load\(\)\)/);
  assert.match(server, /request\.method === 'GET' && pathname === '\/api\/ui-preferences'/);
  assert.match(server, /request\.method === 'PATCH' && pathname === '\/api\/ui-preferences'/);
});
