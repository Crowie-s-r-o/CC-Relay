import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const helper = readFileSync(new URL('../plugin/relay-queue/scripts/relayctl.mjs', import.meta.url), 'utf8');
const skill = readFileSync(new URL('../plugin/relay-queue/skills/relay-queue/SKILL.md', import.meta.url), 'utf8');

test('queue helper can name new tasks and rename queued tasks', () => {
  assert.match(helper, /const name = option\(args, '--name'\)/);
  assert.match(helper, /\.\.\.\(name \? \{ title: name \} : \{\}\)/);
  assert.match(helper, /submissionId: randomUUID\(\)/);
  assert.match(helper, /if \(command === 'rename'\)/);
  assert.match(helper, /request\(`\/api\/tasks\/\$\{taskId\}`/);
  assert.match(helper, /method: 'PATCH'/);
  assert.match(helper, /JSON\.stringify\(\{ title: name \}\)/);
});

test('queue skill documents task naming and queued-only rename behavior', () => {
  assert.match(skill, /add --thread <thread-id> --name "Short task name"/);
  assert.match(skill, /rename <task-id> --name "New task name"/);
  assert.match(skill, /allowed only while the task is still queued/);
});
