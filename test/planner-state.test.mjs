import assert from 'node:assert/strict';
import test from 'node:test';
import {
  breakdownIsActive,
  breakdownStatusPresentation,
  canQueueProposals,
  moveProposal,
  plannerCapable,
  pruneSelection,
  removeProposal,
  selectedProposals,
  updateProposalField,
} from '../public/planner-state.js';

test('plannerCapable reflects the advertised capability', () => {
  assert.equal(plannerCapable({ capabilities: { planner: true } }), true);
  assert.equal(plannerCapable({ capabilities: { planner: false } }), false);
  assert.equal(plannerCapable({ capabilities: {} }), false);
  assert.equal(plannerCapable(null), false);
});

test('breakdownIsActive is true only while pending or running', () => {
  assert.equal(breakdownIsActive({ status: 'pending' }), true);
  assert.equal(breakdownIsActive({ status: 'running' }), true);
  assert.equal(breakdownIsActive({ status: 'complete' }), false);
  assert.equal(breakdownIsActive({ status: 'failed' }), false);
  assert.equal(breakdownIsActive(null), false);
});

test('breakdownStatusPresentation distinguishes parsed, unparsed, and failure', () => {
  assert.equal(breakdownStatusPresentation(null).state, 'idle');
  assert.equal(breakdownStatusPresentation({ status: 'running' }).tone, 'running');
  assert.equal(breakdownStatusPresentation({ status: 'failed' }).tone, 'failed');
  const parsed = breakdownStatusPresentation({ status: 'complete', parsed: true, proposals: [{}, {}] });
  assert.equal(parsed.state, 'complete');
  assert.match(parsed.label, /2 proposed steps/);
  const unparsed = breakdownStatusPresentation({ status: 'complete', parsed: false, proposals: [] });
  assert.equal(unparsed.state, 'unparsed');
  assert.equal(unparsed.tone, 'warning');
});

test('moveProposal reorders within bounds and is a no-op at the edges', () => {
  const proposals = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(moveProposal(proposals, 'b', -1).map((p) => p.id), ['b', 'a', 'c']);
  assert.deepEqual(moveProposal(proposals, 'b', 1).map((p) => p.id), ['a', 'c', 'b']);
  assert.deepEqual(moveProposal(proposals, 'a', -1).map((p) => p.id), ['a', 'b', 'c']);
  assert.deepEqual(moveProposal(proposals, 'c', 1).map((p) => p.id), ['a', 'b', 'c']);
  // original array is not mutated
  assert.deepEqual(proposals.map((p) => p.id), ['a', 'b', 'c']);
});

test('removeProposal and updateProposalField return new lists', () => {
  const proposals = [{ id: 'a', title: 'A', prompt: 'pa' }, { id: 'b', title: 'B', prompt: 'pb' }];
  assert.deepEqual(removeProposal(proposals, 'a').map((p) => p.id), ['b']);
  const edited = updateProposalField(proposals, 'a', 'title', 'A2');
  assert.equal(edited[0].title, 'A2');
  assert.equal(proposals[0].title, 'A');
  assert.equal(updateProposalField(proposals, 'a', 'bogus', 'x'), proposals);
});

test('selectedProposals preserves order and pruneSelection drops stale ids', () => {
  const proposals = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(selectedProposals(proposals, new Set(['c', 'a'])).map((p) => p.id), ['a', 'c']);
  const pruned = pruneSelection(proposals, new Set(['a', 'x']));
  assert.deepEqual([...pruned], ['a']);
});

test('canQueueProposals needs a session and a selection', () => {
  assert.equal(canQueueProposals({ hasSession: true, selectedCount: 2 }), true);
  assert.equal(canQueueProposals({ hasSession: false, selectedCount: 2 }), false);
  assert.equal(canQueueProposals({ hasSession: true, selectedCount: 0 }), false);
});
