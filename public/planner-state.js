// Pure, DOM-free helpers for the Planner. Kept separate from app.js so the
// breakdown status machine and proposal-editing transforms can be unit-tested.

export function plannerCapable(status) {
  return status?.capabilities?.planner === true;
}

export function breakdownIsActive(breakdown) {
  return Boolean(breakdown) && ['pending', 'running'].includes(breakdown.status);
}

/** Presentation for the breakdown status pill, independent of the DOM. */
export function breakdownStatusPresentation(breakdown) {
  if (!breakdown || !breakdown.status) {
    return { state: 'idle', label: 'No breakdown yet', tone: 'idle' };
  }
  switch (breakdown.status) {
    case 'pending':
      return { state: 'pending', label: 'Queued on the session', tone: 'running' };
    case 'running':
      return { state: 'running', label: 'Breaking the plan into tasks', tone: 'running' };
    case 'failed':
      return { state: 'failed', label: 'Breakdown failed', tone: 'failed' };
    case 'cancelled':
      return { state: 'cancelled', label: 'Breakdown cancelled', tone: 'failed' };
    case 'complete': {
      const count = Array.isArray(breakdown.proposals) ? breakdown.proposals.length : 0;
      if (breakdown.parsed && count > 0) {
        // "step" is the board's vocabulary; a proposal only becomes a task when
        // the user starts a run or queues it.
        return { state: 'complete', label: `${count} proposed step${count === 1 ? '' : 's'}`, tone: 'success' };
      }
      return { state: 'unparsed', label: 'Finished without parseable steps', tone: 'warning' };
    }
    default:
      return { state: 'idle', label: 'No breakdown yet', tone: 'idle' };
  }
}

function indexOfProposal(proposals, id) {
  return proposals.findIndex((proposal) => proposal.id === id);
}

/** Return a new proposal list with the item moved up (-1) or down (1). */
export function moveProposal(proposals, id, direction) {
  const list = [...proposals];
  const index = indexOfProposal(list, id);
  if (index < 0) return list;
  const target = index + (direction < 0 ? -1 : 1);
  if (target < 0 || target >= list.length) return list;
  const [item] = list.splice(index, 1);
  list.splice(target, 0, item);
  return list;
}

export function removeProposal(proposals, id) {
  return proposals.filter((proposal) => proposal.id !== id);
}

export function updateProposalField(proposals, id, field, value) {
  if (field !== 'title' && field !== 'prompt') return proposals;
  return proposals.map((proposal) => (
    proposal.id === id ? { ...proposal, [field]: value } : proposal
  ));
}

/** Proposals whose id is selected, preserving their current order. */
export function selectedProposals(proposals, selectedIds) {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
  return proposals.filter((proposal) => selected.has(proposal.id));
}

/** Drop selections for proposals that no longer exist (after a re-parse or edit). */
export function pruneSelection(proposals, selectedIds) {
  const ids = new Set(proposals.map((proposal) => proposal.id));
  const next = new Set();
  for (const id of selectedIds instanceof Set ? selectedIds : selectedIds || []) {
    if (ids.has(id)) next.add(id);
  }
  return next;
}

/** Whether the queue action can proceed: a session plus at least one selection. */
export function canQueueProposals({ hasSession, selectedCount }) {
  return Boolean(hasSession) && Number(selectedCount) > 0;
}
