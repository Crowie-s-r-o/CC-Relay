import { randomUUID } from 'node:crypto';

export const MAX_BREAKDOWN_PROPOSALS = 99;
export const MAX_PROPOSAL_DEPENDENCIES = 32;
const MAX_PROPOSAL_TITLE = 300;
const MAX_PROPOSAL_PROMPT = 12_000;
const MAX_REFINE_PROPOSAL_PREVIEW = 2_000;

const TERMINAL_TASK_STATUSES = new Set(['complete', 'failed', 'cancelled', 'interrupted']);

const JSON_CONTRACT = '{"tasks":[{"id":"step-1","title":"Short imperative title","prompt":"A complete, self-contained instruction an AI coding agent can execute on its own, including scope, constraints, and how to verify the result.","dependsOn":[]}]}';

const CONTRACT_RULES = `Rules:
- Give every step a short, unique "id" and list it once. Use the ids in "dependsOn".
- "dependsOn" holds the ids of the steps that must finish first. Use an empty array for a step that can start immediately.
- Only reference ids of steps that appear earlier in the list. Never create a dependency cycle.
- Maximize independence. Two steps that touch different files and do not read each other's output must not depend on each other, because Relay runs independent steps at the same time in different sessions.
- Order the list so a reader can follow it top to bottom.
- Each prompt must stand on its own; assume the agent has not read this plan.
- Keep titles short and put the detail in the prompt.
- Do not invent unrelated work. Only cover what the plan and guidance describe.`;

/**
 * Build the read-only breakdown prompt sent to the selected live session.
 *
 * The model is asked for a strict JSON object so the response can be parsed by
 * {@link parseBreakdownResult} with the same tolerance used for Turbo graphs.
 * It intentionally instructs read-only planning: the breakdown must never edit
 * files or run implementation work, only decompose the saved plan into tasks.
 *
 * Contract v2 adds an explicit dependency graph. Relay executes a breakdown as a
 * real plan run, enqueuing each step as its dependencies complete and fanning
 * independent steps out across idle sessions, so declared independence is the
 * difference between a serial and a parallel run.
 */
export function buildBreakdownPrompt({ plan = {}, guidance } = {}) {
  const name = typeof plan.name === 'string' && plan.name.trim() ? plan.name.trim() : 'Untitled plan';
  const content = typeof plan.content === 'string' ? plan.content : '';
  const repository = plan.repo_path || plan.repoPath || '(repository path not provided)';
  const extra = typeof guidance === 'string' && guidance.trim() ? guidance.trim() : '';
  return `You are helping break a saved implementation plan into a dependency-aware set of well-scoped tasks that Relay can execute for AI coding agents. Work in read-only planning mode: you may inspect the repository, but do not edit files, run implementation commands, or delegate work.

Return ONLY a single JSON object, with no commentary, Markdown, or code fences, in exactly this shape:
${JSON_CONTRACT}

${CONTRACT_RULES}

Plan name:
${name}

Repository path:
${repository}
${extra ? `\nAdditional guidance from the user:\n${extra}\n` : ''}
Plan content:
${content.trim() ? content : '(the saved plan is empty)'}`;
}

function proposalOutline(proposals) {
  if (!Array.isArray(proposals) || proposals.length === 0) {
    return '(the current breakdown has no steps)';
  }
  return JSON.stringify({
    tasks: proposals.slice(0, MAX_BREAKDOWN_PROPOSALS).map((proposal) => ({
      id: proposal?.id,
      title: proposal?.title,
      prompt: typeof proposal?.prompt === 'string'
        ? proposal.prompt.slice(0, MAX_REFINE_PROPOSAL_PREVIEW)
        : '',
      dependsOn: Array.isArray(proposal?.dependsOn) ? proposal.dependsOn : [],
    })),
  }, null, 2);
}

/**
 * Build a refinement prompt for a follow-up breakdown attempt.
 *
 * Refinement revises the breakdown the user is actually looking at, including
 * every edit they made by hand, rather than starting over from the plan. Ids are
 * handed to the model and asked back unchanged for surviving steps, so proposal
 * identity (and therefore the user's selection) survives the revision.
 */
export function buildRefinementPrompt({ plan = {}, proposals = [], feedback, guidance } = {}) {
  const name = typeof plan.name === 'string' && plan.name.trim() ? plan.name.trim() : 'Untitled plan';
  const content = typeof plan.content === 'string' ? plan.content : '';
  const repository = plan.repo_path || plan.repoPath || '(repository path not provided)';
  const notes = typeof feedback === 'string' ? feedback.trim() : '';
  const extra = typeof guidance === 'string' && guidance.trim() ? guidance.trim() : '';
  return `You are revising an existing task breakdown for a saved implementation plan. Work in read-only planning mode: you may inspect the repository, but do not edit files, run implementation commands, or delegate work.

Revise the breakdown below. Do not start over. Keep every step that still makes sense, keep its "id" exactly as given so the user's review survives, and change only what the feedback asks for. Add new steps with new ids, remove steps the feedback rejects, and correct titles, prompts, and dependencies as needed.

Return ONLY a single JSON object, with no commentary, Markdown, or code fences, in exactly this shape:
${JSON_CONTRACT}

${CONTRACT_RULES}

Plan name:
${name}

Repository path:
${repository}
${extra ? `\nOriginal guidance from the user:\n${extra}\n` : ''}
Plan content:
${content.trim() ? content : '(the saved plan is empty)'}

Current breakdown to revise:
${proposalOutline(proposals)}

Feedback to apply:
${notes || '(no feedback provided)'}`;
}

function stripCodeFence(text) {
  const fenced = text.match(/```(?:json|jsonc)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : '';
}

function jsonCandidates(text) {
  const candidates = [];
  const push = (value) => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed && !candidates.includes(trimmed)) candidates.push(trimmed);
  };
  push(stripCodeFence(text));
  push(text);
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) push(text.slice(firstBrace, lastBrace + 1));
  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) push(text.slice(firstBracket, lastBracket + 1));
  return candidates;
}

function taskListFrom(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    for (const key of ['tasks', 'proposals', 'items', 'breakdown', 'steps', 'plan']) {
      if (Array.isArray(parsed[key])) return parsed[key];
    }
  }
  return [];
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function deriveTitle(prompt) {
  const firstLine = prompt.split('\n').map((line) => line.trim()).find(Boolean) || prompt.trim();
  const compact = firstLine.replace(/\s+/g, ' ').trim();
  return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
}

function referenceList(item) {
  const raw = item?.dependsOn ?? item?.depends_on ?? item?.dependencies ?? item?.after ?? item?.requires;
  if (raw === undefined || raw === null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const refs = [];
  for (const entry of list) {
    if (typeof entry === 'string' && entry.trim()) refs.push(entry.trim());
    else if (typeof entry === 'number' && Number.isFinite(entry)) refs.push(String(entry));
    else if (entry && typeof entry === 'object') {
      const nested = firstString(entry.id, entry.taskId, entry.step, entry.ref);
      if (nested) refs.push(nested);
    }
    if (refs.length >= MAX_PROPOSAL_DEPENDENCIES) break;
  }
  return refs;
}

function extractProposals(list, { knownIds = null } = {}) {
  const entries = [];
  if (!Array.isArray(list)) return entries;
  const preserved = knownIds instanceof Set ? knownIds : new Set(knownIds || []);
  const usedIds = new Set();
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const prompt = firstString(item.prompt, item.instructions, item.description, item.body, item.detail);
    if (!prompt) continue;
    const title = firstString(item.title, item.name, item.summary) || deriveTitle(prompt);
    const declaredId = firstString(item.id, item.key, item.slug, item.step, item.stepId);
    // A refinement hands the model the current ids and asks for them back, so an echoed
    // id keeps the proposal's identity (and the user's selection) stable across attempts.
    const id = declaredId && preserved.has(declaredId) && !usedIds.has(declaredId)
      ? declaredId
      : randomUUID();
    usedIds.add(id);
    entries.push({
      id,
      declaredId,
      title: title.slice(0, MAX_PROPOSAL_TITLE),
      prompt: prompt.slice(0, MAX_PROPOSAL_PROMPT),
      refs: referenceList(item),
    });
    if (entries.length >= MAX_BREAKDOWN_PROPOSALS) break;
  }
  return entries;
}

function dependsOnNote(code, message, proposalId, ref) {
  return { code, message, proposalId, ref: ref ?? null };
}

/**
 * Resolve declared dependency references into internal proposal ids and return a
 * guaranteed acyclic graph plus the notes explaining every reference that was
 * dropped.
 *
 * Resolution order per reference: an id declared by the model or already held by
 * a proposal, then (when index references are allowed) a 1-based position in the
 * list. Anything else is unknown and pruned.
 *
 * Cycles are broken deterministically by walking steps in list order and, within
 * a step, its references in declared order: an edge is accepted only when it does
 * not close a cycle against the edges accepted so far, so the dropped edge is
 * always the one that closes the loop and the result never depends on hash or
 * iteration order.
 */
export function resolveProposalGraph(entries, { allowIndexRefs = true } = {}) {
  const proposals = entries.map(({ id, title, prompt }) => ({ id, title, prompt, dependsOn: [] }));
  const notes = [];
  if (proposals.length === 0) return { proposals, notes };

  const byLabel = new Map();
  entries.forEach((entry, index) => {
    const labels = [entry.id, entry.declaredId].filter(Boolean);
    for (const label of labels) {
      const key = label.toLowerCase();
      if (!byLabel.has(key)) byLabel.set(key, index);
    }
  });

  const accepted = entries.map(() => new Set());
  const dependsOnTransitively = (from, target) => {
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const next of accepted[current]) {
        if (next === target) return true;
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    return false;
  };

  entries.forEach((entry, index) => {
    const seenRefs = new Set();
    for (const ref of entry.refs) {
      if (seenRefs.has(ref)) continue;
      seenRefs.add(ref);
      let target = byLabel.get(ref.toLowerCase());
      if (target === undefined && allowIndexRefs && /^\d+$/.test(ref)) {
        const position = Number(ref);
        if (position >= 1 && position <= entries.length) target = position - 1;
      }
      if (target === undefined) {
        notes.push(dependsOnNote(
          'unknown-dependency',
          `"${entry.title}" referenced an unknown step, so that dependency was dropped.`,
          entry.id,
          ref,
        ));
        continue;
      }
      if (target === index) {
        notes.push(dependsOnNote(
          'self-dependency',
          `"${entry.title}" depended on itself, so that dependency was dropped.`,
          entry.id,
          ref,
        ));
        continue;
      }
      if (accepted[index].has(target)) continue;
      // Accepting "index depends on target" closes a cycle when target already
      // depends on index through the edges accepted so far.
      if (dependsOnTransitively(target, index)) {
        notes.push(dependsOnNote(
          'cycle-dropped',
          `"${entry.title}" and "${entries[target].title}" depended on each other, so the dependency that closed the loop was dropped.`,
          entry.id,
          entries[target].id,
        ));
        continue;
      }
      accepted[index].add(target);
      proposals[index].dependsOn.push(entries[target].id);
    }
  });

  return { proposals, notes };
}

/**
 * Normalize a candidate task list into review-ready proposals. A proposal needs
 * a non-empty prompt; a missing title is derived from the prompt so tolerant
 * model output still yields usable, editable tasks. Dependencies are resolved
 * into internal ids and reduced to a DAG.
 */
export function normalizeProposals(list, options = {}) {
  return resolveProposalGraph(extractProposals(list, options), options).proposals;
}

/**
 * Tolerantly parse a breakdown response into an ordered dependency graph of
 * {id, title, prompt, dependsOn} plus the notes describing every pruned or
 * cycle-breaking edge. Returns an empty list when nothing usable can be
 * extracted, so the caller can surface the raw response instead of creating
 * tasks from unparseable output.
 */
export function parseBreakdownResult(rawText, options = {}) {
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  if (!text) return { proposals: [], notes: [] };
  for (const candidate of jsonCandidates(text)) {
    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    const result = resolveProposalGraph(extractProposals(taskListFrom(parsed), options), options);
    if (result.proposals.length > 0) return result;
  }
  return { proposals: [], notes: [] };
}

export function parseBreakdownProposals(rawText, options = {}) {
  return parseBreakdownResult(rawText, options).proposals;
}

function desiredBreakdownStatus(taskStatus) {
  switch (taskStatus) {
    case 'complete':
      return 'complete';
    case 'failed':
    case 'interrupted':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'running':
      return 'running';
    default:
      return 'pending';
  }
}

/**
 * Reconcile a breakdown record against the current state of its linked task and
 * return only the changed fields (or null when nothing needs to change).
 *
 * This is a reconciler, not a one-shot finalizer: because a breakdown task uses
 * the ordinary automatic-retry path, its status can legitimately move
 * failed -> running -> complete. Parsed proposals are written only on the
 * transition into `complete`, so later reconcile passes never overwrite proposals
 * the user has edited, removed, or reordered.
 *
 * `knownIds` carries the ids of the proposals the user is currently reviewing so
 * a refinement attempt can echo them back unchanged.
 */
export function breakdownUpdateForTask(task, breakdown, { knownIds = null } = {}) {
  if (!task || !breakdown) return null;
  const desired = desiredBreakdownStatus(task.status);
  const changes = {};
  if (desired !== breakdown.status) changes.status = desired;

  if (desired === 'complete') {
    if (breakdown.status !== 'complete') {
      const raw = typeof task.result === 'string' ? task.result : '';
      const { proposals, notes } = parseBreakdownResult(raw, { knownIds });
      changes.raw_response = raw;
      changes.proposals_json = JSON.stringify(proposals);
      changes.notes_json = JSON.stringify(notes);
      changes.parsed = proposals.length > 0 ? 1 : 0;
      changes.error = null;
    }
  } else if (desired === 'failed') {
    if (breakdown.status !== 'failed') {
      changes.error = task.error || 'The breakdown task did not finish.';
      if (typeof task.result === 'string' && task.result) changes.raw_response = task.result;
    }
  } else if (desired === 'cancelled') {
    if (breakdown.status !== 'cancelled') {
      changes.error = task.error || 'The breakdown was cancelled before it finished.';
    }
  } else if ((desired === 'running' || desired === 'pending')
    && (breakdown.status === 'failed' || breakdown.status === 'cancelled')) {
    // A retry re-runs the same breakdown; clear the stale terminal error.
    changes.error = null;
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

/**
 * Reconcile a breakdown whose linked task row is gone.
 *
 * Users delete queued tasks freely, and a breakdown task looks like any other queue card.
 * Without this the breakdown row would stay `pending` forever: nothing would ever settle it,
 * `breakdownInProgress` would keep reporting true, and every breakdown, refine, and run route
 * for that plan would refuse work until the plan itself was deleted. Deleting stays allowed;
 * it simply fails the attempt so the plan recovers and the user can start another.
 */
export function breakdownUpdateForDeletedTask(breakdown) {
  if (!breakdown) return null;
  if (breakdown.status !== 'pending' && breakdown.status !== 'running') return null;
  return {
    status: 'failed',
    error: 'The breakdown task was deleted before it finished. Start another breakdown when you are ready.',
  };
}

export function isTerminalTaskStatus(status) {
  return TERMINAL_TASK_STATUSES.has(status);
}

/**
 * Guarantee every proposal has a unique id. A client may submit duplicate ids
 * (Finding 25), which would make edit/remove/reorder ambiguous in the renderer
 * (first match wins); a collision or blank id is regenerated so identity stays
 * unambiguous.
 */
export function ensureUniqueProposalIds(proposals) {
  if (!Array.isArray(proposals)) return [];
  const seen = new Set();
  return proposals.map((proposal) => {
    let id = typeof proposal?.id === 'string' && proposal.id.trim() ? proposal.id.trim() : randomUUID();
    if (seen.has(id)) id = randomUUID();
    seen.add(id);
    return { ...proposal, id };
  });
}

/**
 * Re-sanitize a client-supplied proposal list: unique ids first, then dangling
 * references pruned against the surviving ids, then any cycle broken. The order
 * matters. Removing a step in the review UI is exactly the case that leaves a
 * dangling reference behind, and regenerating a duplicate id is exactly the case
 * that can orphan a reference to it.
 */
export function sanitizeProposalGraph(proposals, { allowIndexRefs = false } = {}) {
  const unique = ensureUniqueProposalIds(Array.isArray(proposals) ? proposals : []);
  const entries = unique.map((proposal) => ({
    id: proposal.id,
    declaredId: proposal.id,
    title: proposal.title,
    prompt: proposal.prompt,
    refs: referenceList(proposal),
  }));
  return resolveProposalGraph(entries, { allowIndexRefs });
}

/**
 * Whether a breakdown should be treated as still in progress. Besides the
 * obvious pending/running states, a breakdown whose linked task is queued,
 * running, or scheduled for an automatic retry is in progress (Finding 23):
 * during the retry window the breakdown row reads `failed` while its task is
 * about to run again, so a naive status-only guard would let a second POST
 * spawn a parallel breakdown that orphans the retry.
 */
export function breakdownInProgress(breakdown, { retryScheduled = false, taskStatus = null } = {}) {
  if (!breakdown) return false;
  if (breakdown.status === 'pending' || breakdown.status === 'running') return true;
  if (retryScheduled) return true;
  return taskStatus === 'queued' || taskStatus === 'running';
}
