import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBreakdownPrompt,
  buildRefinementPrompt,
  normalizeProposals,
  parseBreakdownResult,
  sanitizeProposalGraph,
} from '../src/plan-breakdown.mjs';

function idsFor(proposals, titles) {
  return titles.map((title) => proposals.find((proposal) => proposal.title === title)?.id);
}

test('the breakdown contract asks for ids and a dependency list', () => {
  const prompt = buildBreakdownPrompt({ plan: { name: 'Auth', content: 'brief' } });
  assert.match(prompt, /"id":"step-1"/);
  assert.match(prompt, /"dependsOn":\[\]/);
  assert.match(prompt, /must finish first/);
  // Independence is the point: it is what lets Relay fan steps out across sessions.
  assert.match(prompt, /at the same time in different sessions/);
});

test('dependsOn resolves declared ids into internal proposal ids', () => {
  const { proposals, notes } = parseBreakdownResult(JSON.stringify({
    tasks: [
      { id: 'a', title: 'Schema', prompt: 'Add the table' },
      { id: 'b', title: 'API', prompt: 'Add the route', dependsOn: ['a'] },
      { id: 'c', title: 'UI', prompt: 'Add the screen', dependsOn: ['b'] },
    ],
  }));
  assert.equal(proposals.length, 3);
  assert.deepEqual(notes, []);
  const [schema, api, ui] = proposals;
  // Never the model's label: the stored reference is the internal id.
  assert.deepEqual(schema.dependsOn, []);
  assert.deepEqual(api.dependsOn, [schema.id]);
  assert.deepEqual(ui.dependsOn, [api.id]);
  assert.ok(proposals.every((proposal) => proposal.id !== 'a' && proposal.id !== 'b'));
});

test('a missing dependsOn becomes an empty list', () => {
  const proposals = normalizeProposals([
    { title: 'One', prompt: 'do one' },
    { title: 'Two', prompt: 'do two', dependsOn: null },
    { title: 'Three', prompt: 'do three', dependsOn: 'not-a-list' },
  ]);
  assert.equal(proposals.length, 3);
  assert.deepEqual(proposals.map((proposal) => proposal.dependsOn), [[], [], []]);
});

test('a reference to an unknown step is pruned and noted', () => {
  const { proposals, notes } = parseBreakdownResult(JSON.stringify({
    tasks: [
      { id: 'a', title: 'First', prompt: 'do first' },
      { id: 'b', title: 'Second', prompt: 'do second', dependsOn: ['a', 'ghost'] },
    ],
  }));
  assert.equal(proposals.length, 2);
  assert.deepEqual(proposals[1].dependsOn, [proposals[0].id]);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].code, 'unknown-dependency');
  assert.equal(notes[0].proposalId, proposals[1].id);
  assert.equal(notes[0].ref, 'ghost');
});

test('a self reference is pruned and noted', () => {
  const { proposals, notes } = parseBreakdownResult(JSON.stringify({
    tasks: [{ id: 'a', title: 'Only', prompt: 'do it', dependsOn: ['a'] }],
  }));
  assert.deepEqual(proposals[0].dependsOn, []);
  assert.equal(notes[0].code, 'self-dependency');
});

test('a two-step cycle keeps both steps and drops only the edge that closes it', () => {
  const { proposals, notes } = parseBreakdownResult(JSON.stringify({
    tasks: [
      { id: 'a', title: 'A', prompt: 'do a', dependsOn: ['b'] },
      { id: 'b', title: 'B', prompt: 'do b', dependsOn: ['a'] },
    ],
  }));
  // Never invent or remove steps to fix a graph.
  assert.equal(proposals.length, 2);
  const [a, b] = proposals;
  // The first edge is accepted in list order; the second one closes the loop.
  assert.deepEqual(a.dependsOn, [b.id]);
  assert.deepEqual(b.dependsOn, []);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].code, 'cycle-dropped');
  assert.equal(notes[0].proposalId, b.id);
});

test('cycle breaking is deterministic across repeated parses', () => {
  const raw = JSON.stringify({
    tasks: [
      { id: 'a', title: 'A', prompt: 'do a', dependsOn: ['c'] },
      { id: 'b', title: 'B', prompt: 'do b', dependsOn: ['a'] },
      { id: 'c', title: 'C', prompt: 'do c', dependsOn: ['b'] },
    ],
  });
  const shapes = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { proposals, notes } = parseBreakdownResult(raw);
    const byId = new Map(proposals.map((proposal) => [proposal.id, proposal.title]));
    shapes.push(JSON.stringify({
      edges: proposals.map((proposal) => [proposal.title, proposal.dependsOn.map((id) => byId.get(id))]),
      notes: notes.map((note) => note.code),
    }));
  }
  assert.equal(new Set(shapes).size, 1, 'the same input always yields the same graph');
  const { proposals } = parseBreakdownResult(raw);
  const byId = new Map(proposals.map((proposal) => [proposal.id, proposal.title]));
  // A -> C and B -> A survive; C -> B is the back edge that closes the loop.
  assert.deepEqual(proposals.map((proposal) => proposal.dependsOn.map((id) => byId.get(id))), [
    ['C'], ['A'], [],
  ]);
});

test('a valid forward reference is kept, because only cycles are broken', () => {
  const { proposals, notes } = parseBreakdownResult(JSON.stringify({
    tasks: [
      { id: 'a', title: 'A', prompt: 'do a', dependsOn: ['b'] },
      { id: 'b', title: 'B', prompt: 'do b' },
    ],
  }));
  assert.deepEqual(proposals[0].dependsOn, [proposals[1].id]);
  assert.deepEqual(notes, []);
});

test('a 1-based index reference resolves when the model ignores ids', () => {
  const { proposals } = parseBreakdownResult(JSON.stringify({
    tasks: [
      { title: 'First', prompt: 'do first' },
      { title: 'Second', prompt: 'do second', dependsOn: [1] },
    ],
  }));
  assert.deepEqual(proposals[1].dependsOn, [proposals[0].id]);
});

test('a refinement keeps the ids of the steps the user is reviewing', () => {
  const knownIds = new Set(['keep-me']);
  const { proposals } = parseBreakdownResult(JSON.stringify({
    tasks: [
      { id: 'keep-me', title: 'Kept', prompt: 'unchanged work' },
      { id: 'brand-new', title: 'Added', prompt: 'new work', dependsOn: ['keep-me'] },
    ],
  }), { knownIds });
  assert.equal(proposals[0].id, 'keep-me');
  assert.notEqual(proposals[1].id, 'brand-new', 'an id the user never saw is regenerated');
  assert.deepEqual(proposals[1].dependsOn, ['keep-me']);
});

test('the refinement prompt carries the plan, the current proposals, and the feedback', () => {
  const prompt = buildRefinementPrompt({
    plan: { name: 'Auth', content: 'Replace the cookie flow.', repo_path: '/repo' },
    proposals: [{ id: 'p1', title: 'Schema', prompt: 'Add the table', dependsOn: [] }],
    feedback: 'Split the schema step in two.',
  });
  assert.match(prompt, /Do not start over/);
  assert.match(prompt, /Replace the cookie flow\./);
  assert.match(prompt, /"id": "p1"/);
  assert.match(prompt, /Split the schema step in two\./);
  assert.match(prompt, /do not edit files/);
});

test('editing a breakdown prunes references to a removed step', () => {
  const parsed = parseBreakdownResult(JSON.stringify({
    tasks: [
      { id: 'a', title: 'Schema', prompt: 'Add the table' },
      { id: 'b', title: 'API', prompt: 'Add the route', dependsOn: ['a'] },
      { id: 'c', title: 'UI', prompt: 'Add the screen', dependsOn: ['b'] },
    ],
  }));
  const [schema] = idsFor(parsed.proposals, ['Schema']);
  // The user removes the schema step in the review UI and PATCHes what is left.
  const remaining = parsed.proposals.filter((proposal) => proposal.id !== schema);
  const { proposals, notes } = sanitizeProposalGraph(remaining);
  assert.deepEqual(proposals.map((proposal) => proposal.title), ['API', 'UI']);
  assert.deepEqual(proposals[0].dependsOn, [], 'the dangling reference is gone');
  assert.deepEqual(proposals[1].dependsOn, [proposals[0].id], 'the surviving reference is kept');
  assert.equal(notes[0].code, 'unknown-dependency');
});

test('editing a breakdown re-runs de-duplication before pruning', () => {
  const { proposals } = sanitizeProposalGraph([
    { id: 'dup', title: 'A', prompt: 'a' },
    { id: 'dup', title: 'B', prompt: 'b', dependsOn: ['dup'] },
  ]);
  assert.equal(new Set(proposals.map((proposal) => proposal.id)).size, 2);
  assert.equal(proposals[0].id, 'dup');
  // The regenerated id means B's reference now points at A, which is a legal edge.
  assert.deepEqual(proposals[1].dependsOn, ['dup']);
});

test('editing a breakdown breaks a cycle the user introduced', () => {
  const { proposals, notes } = sanitizeProposalGraph([
    { id: 'x', title: 'X', prompt: 'x', dependsOn: ['y'] },
    { id: 'y', title: 'Y', prompt: 'y', dependsOn: ['x'] },
  ]);
  assert.deepEqual(proposals[0].dependsOn, ['y']);
  assert.deepEqual(proposals[1].dependsOn, []);
  assert.equal(notes[0].code, 'cycle-dropped');
});
