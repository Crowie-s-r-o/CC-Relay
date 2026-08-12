import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  attributionViolations,
  inspectHistory,
  parseHistoryLog,
} from '../scripts/check-commit-attribution.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

test('maintainer attribution and ordinary provider prose remain valid', () => {
  assert.deepEqual(attributionViolations({
    author: 'patrikkelemen <patrik.kelemen@crowie.io>',
    committer: 'patrikkelemen <patrik.kelemen@crowie.io>',
    message: 'fix(provider): keep Claude and Codex tasks isolated',
  }), []);
});

test('assistant author and committer identities are rejected', () => {
  assert.match(
    attributionViolations({ author: 'Claude Opus 5 <noreply@anthropic.com>' }).join('\n'),
    /author identity/,
  );
  assert.match(
    attributionViolations({ committer: 'Codex <noreply@openai.com>' }).join('\n'),
    /committer identity/,
  );
});

test('assistant credit and session trailers are rejected', () => {
  for (const trailer of [
    'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>',
    'Co-Authored-By: Codex <noreply@openai.com>',
    'Generated-By: OpenAI Codex',
    'Signed-Off-By: Anthropic Claude',
    'Claude-Session: https://claude.ai/code/session_example',
    'Codex-Session: local-session-id',
  ]) {
    assert.notEqual(attributionViolations({ message: `fix: example\n\n${trailer}` }).length, 0);
  }
});

test('history records retain identities and report the affected commit', () => {
  const source = [
    '0123456789abcdef\x00patrikkelemen\x00patrik.kelemen@crowie.io',
    '\x00patrikkelemen\x00patrik.kelemen@crowie.io',
    '\x00fix: example\n\nCo-Authored-By: Codex <noreply@openai.com>\n\x00\x1e\n',
  ].join('');
  const records = parseHistoryLog(source);
  assert.equal(records.length, 1);
  assert.equal(records[0].hash, '0123456789abcdef');
  assert.equal(records[0].author, 'patrikkelemen <patrik.kelemen@crowie.io>');
  assert.deepEqual(inspectHistory(source), [{
    hash: '0123456789abcdef',
    reason: 'the commit message contains an AI assistant credit trailer',
  }]);
});

test('repository wiring installs, runs, and documents the attribution guard', () => {
  const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  const workflow = readFileSync(join(projectRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  const contributing = readFileSync(join(projectRoot, 'CONTRIBUTING.md'), 'utf8');
  const agentGuidance = readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8');
  const deploy = readFileSync(join(projectRoot, 'scripts', 'deploy.mjs'), 'utf8');
  const hookPath = join(projectRoot, '.githooks', 'commit-msg');

  assert.equal(manifest.scripts['hooks:install'], 'git config core.hooksPath .githooks');
  assert.equal(manifest.scripts['attribution:check'], 'node scripts/check-commit-attribution.mjs');
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /npm run attribution:check/);
  assert.match(contributing, /npm run hooks:install/);
  assert.match(agentGuidance, /Never add assistant credit trailers/);
  assert.match(deploy, /npm\(\['run', 'attribution:check'\]/);
  if (process.platform !== 'win32') assert.notEqual(statSync(hookPath).mode & 0o111, 0);
});
