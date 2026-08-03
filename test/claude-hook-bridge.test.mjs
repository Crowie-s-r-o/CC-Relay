import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClaudeHookBridge,
  claudeLiveHookSettings,
} from '../src/claude-hook-bridge.mjs';

const SESSION_ID = 'a1b2c3d4-0000-0000-0000-000000000000';
const TOKEN = '0123456789abcdef';
const URL = `http://127.0.0.1:58925/api/internal/claude-hooks/${TOKEN}`;

test('Claude live hook settings cover prompt delivery, compaction, text, tools, and completion', () => {
  const settings = claudeLiveHookSettings(URL);
  assert.deepEqual(Object.keys(settings.hooks), [
    'UserPromptSubmit',
    'PreCompact',
    'PostCompact',
    'MessageDisplay',
    'PreToolUse',
    'PostToolUse',
    'PostToolUseFailure',
    'Stop',
  ]);
  assert.deepEqual(settings.hooks.PreToolUse, [{
    matcher: '*',
    hooks: [{ type: 'http', url: URL, timeout: 1 }],
  }]);
  assert.deepEqual(settings.hooks.MessageDisplay, [{
    hooks: [{ type: 'http', url: URL, timeout: 1 }],
  }]);
  assert.deepEqual(settings.hooks.UserPromptSubmit, [{
    hooks: [{ type: 'http', url: URL, timeout: 1 }],
  }]);
});

test('Claude hook bridge keeps a stable secret URL for each session', () => {
  const bridge = new ClaudeHookBridge({
    endpoint: () => 'http://127.0.0.1:58925/',
    createToken: () => TOKEN,
  });

  assert.deepEqual(
    bridge.settingsForSession(SESSION_ID),
    claudeLiveHookSettings(URL),
  );
  assert.deepEqual(
    bridge.settingsForSession(SESSION_ID),
    claudeLiveHookSettings(URL),
  );
});

test('Claude hook bridge buffers pre-activation events and ignores invalid sessions', () => {
  const jobs = [];
  const received = [];
  const bridge = new ClaudeHookBridge({
    endpoint: () => 'http://127.0.0.1:58925',
    createToken: () => TOKEN,
    queue: (job) => jobs.push(job),
  });
  const registration = bridge.register(SESSION_ID);
  const payload = {
    session_id: SESSION_ID,
    hook_event_name: 'MessageDisplay',
    delta: 'hello',
  };

  assert.equal(bridge.receive(TOKEN, payload), true);
  assert.equal(jobs.length, 0);
  assert.equal(bridge.receive(TOKEN, { ...payload, session_id: 'another-session' }), false);

  assert.equal(registration.activate((event) => received.push(event)), true);
  assert.equal(jobs.length, 1);
  jobs.shift()();
  assert.deepEqual(received, [payload]);

  assert.equal(bridge.receive(TOKEN, { ...payload, delta: ' again' }), true);
  assert.equal(jobs.length, 1);
  registration.deactivate();
  jobs.shift()();
  assert.equal(received.length, 1);
});
