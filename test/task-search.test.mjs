import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { taskSearchMatchMarkup, tasksForSearchResults } from '../public/task-search.js';
import { RelayDatabase } from '../src/database.mjs';
import {
  normalizeTaskSearchText,
  parseTaskSearchQuery,
  searchTaskDocuments,
} from '../src/task-search.mjs';

test('task search is case, accent, and punctuation insensitive', () => {
  assert.equal(normalizeTaskSearchText('Résumé: task-search.js'), 'resume task search js');
  assert.deepEqual(parseTaskSearchQuery('"Full Text" response').terms, ['full text', 'response']);

  const search = searchTaskDocuments([{
    taskId: 14,
    title: 'Search polish',
    commands: ['Add résumé search to task-search.js'],
    responses: ['The FULL text response is ready.'],
  }], 'resume "full-text"');

  assert.equal(search.total, 1);
  assert.equal(search.results[0].taskId, 14);
  assert.equal(search.results[0].match.source, 'command');
});

test('task search ranks exact names and returns highlighted response evidence', () => {
  const search = searchTaskDocuments([
    {
      taskId: 1,
      title: 'Database repair',
      commands: ['Inspect the storage layer'],
      responses: ['A needle appears late in this saved response.'],
    },
    {
      taskId: 2,
      title: 'Needle',
      commands: ['Something else'],
      responses: [],
    },
  ], 'needle');

  assert.deepEqual(search.results.map(({ taskId }) => taskId), [2, 1]);
  const response = search.results[1].match;
  assert.equal(response.source, 'response');
  assert.match(response.excerpt, /needle/);
  assert.ok(response.highlights.length > 0);
  assert.equal(searchTaskDocuments([{
    taskId: 9,
    title: '',
    commands: ['Automatically named command evidence'],
    responses: [],
  }], 'command').results[0].match.source, 'command');
});

test('task search requires every term but allows them across a command and response', () => {
  const documents = [{
    taskId: 8,
    title: 'Cross-field match',
    commands: ['Build the command palette'],
    responses: ['Validation completed successfully'],
  }];
  assert.equal(searchTaskDocuments(documents, 'palette validation').total, 1);
  assert.equal(searchTaskDocuments(documents, 'palette missing').total, 0);
  assert.equal(searchTaskDocuments(documents, '#8').results[0].taskId, 8);
});

test('database search documents include every Relay command and assistant response in one project', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-task-search-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    const task = database.createTask({
      title: 'Conversation search',
      prompt: 'Original command with alpha',
      thread: { id: 'search-thread', title: 'Search thread', source: 'cli', cwd: '/work/search' },
    });
    database.addEvent(task.id, 'codex', 'Follow-up accepted', {
      type: 'item/completed',
      item: {
        id: `relay-follow-up-${task.id}-1`,
        type: 'userMessage',
        content: [{ type: 'text', text: 'Follow-up command with beta' }],
      },
    });
    database.addEvent(task.id, 'codex', 'First answer', {
      type: 'item/completed',
      item: { type: 'agentMessage', text: 'Codex response with gamma' },
    });
    database.addEvent(task.id, 'claude', 'Second answer', {
      type: 'claude/message',
      text: 'Claude response with delta',
    });
    database.addEvent(task.id, 'opencode', 'Third answer', {
      type: 'opencode/message',
      text: 'OpenCode response with zeta',
    });
    database.updateTask(task.id, { status: 'complete', result: 'Final response with epsilon' });
    database.createTask({
      title: 'Another project',
      prompt: 'Secret command in another project',
      thread: { id: 'other-thread', title: 'Other', source: 'cli', cwd: '/work/other' },
    });

    const documents = database.listTaskSearchDocuments('/work/search/');
    assert.equal(documents.length, 1);
    assert.deepEqual(documents[0].commands, [
      'Original command with alpha',
      'Follow-up command with beta',
    ]);
    assert.deepEqual(documents[0].responses, [
      'Codex response with gamma',
      'Claude response with delta',
      'OpenCode response with zeta',
      'Final response with epsilon',
    ]);
    assert.equal(searchTaskDocuments(documents, 'delta').results[0].match.label, 'Response 2');
    assert.equal(searchTaskDocuments(documents, 'zeta').results[0].match.label, 'Response 3');
    assert.equal(searchTaskDocuments(documents, 'secret').total, 0);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('search result helpers preserve rank and escape highlighted provider text', () => {
  assert.deepEqual(
    tasksForSearchResults([{ id: 1 }, { id: 2 }], [{ taskId: 2 }, { taskId: 99 }, { taskId: 1 }]),
    [{ id: 2 }, { id: 1 }],
  );
  assert.equal(
    taskSearchMatchMarkup({ excerpt: '<script>needle</script>', highlights: [[8, 14]] }),
    '&lt;script&gt;<mark>needle</mark>&lt;/script&gt;',
  );
});
