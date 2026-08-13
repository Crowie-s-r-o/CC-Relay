import {
  entryFirstEvent,
  entryItem,
  entryLastEvent,
  isSubAgentEntry,
  planEntryDetails,
  subAgentEntryDetails,
  subAgentEntryState,
} from './event-stream.js';
import { escapeHtml } from './escape-html.js';
import { formatElapsedDuration } from './task-time.js';

const PLAN_STEP_LIMIT = 50;
const AGENT_LIMIT = 50;
const STEP_TEXT_LIMIT = 220;
const AGENT_NAME_LIMIT = 120;
const AGENT_TYPE_LIMIT = 80;
const AGENT_BRIEF_LIMIT = 260;
const HOVER_TEXT_LIMIT = 600;

const PLAN_STATES = {
  completed: { glyph: '✓', label: 'Complete' },
  inProgress: { glyph: '›', label: 'In progress' },
  pending: { glyph: '·', label: 'Pending' },
  unfinished: { glyph: '!', label: 'Unfinished' },
};

function clampText(value, limit) {
  const text = String(value ?? '').trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function boundedTitle(full, shown) {
  return full === shown ? '' : clampText(full, HOVER_TEXT_LIMIT);
}

function planStepState(status, turnEnded) {
  const state = Object.prototype.hasOwnProperty.call(PLAN_STATES, status) ? status : 'pending';
  return turnEnded && state === 'inProgress' ? 'unfinished' : state;
}

function latestPlan(entries) {
  let latest = null;
  let latestRank = -Infinity;
  for (const [index, entry] of (entries || []).entries()) {
    const details = planEntryDetails(entry);
    if (!details) continue;
    const eventId = Number(entryLastEvent(entry)?.id);
    const rank = Number.isFinite(eventId) ? eventId : (latest ? latestRank + 1 : index);
    if (!latest || rank >= latestRank) {
      latest = details;
      latestRank = rank;
    }
  }
  return latest;
}

function durationMarkup(startedAt, finishedAt, now, fallback = '--') {
  const value = formatElapsedDuration(startedAt, finishedAt, now) || fallback;
  if (!startedAt) {
    return `<time>${escapeHtml(value)}</time>`;
  }
  return `<time data-activity-duration data-started-at="${escapeHtml(startedAt)}" data-finished-at="${escapeHtml(finishedAt || '')}">${escapeHtml(value)}</time>`;
}

function runtimeMetricMarkup(task, now) {
  const status = String(task?.status || '');
  const running = status === 'running';
  const label = running ? 'running' : (task?.started_at ? 'duration' : 'not started');
  return `<span class="has-runtime${running ? ' is-running' : ''}"><b>${durationMarkup(task?.started_at, task?.finished_at, now)}</b><small>${label}</small></span>`;
}

function planMarkup(entries, task) {
  const plan = latestPlan(entries);
  if (!plan) return '';
  const turnEnded = task?.status !== 'running';
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const shown = steps.slice(0, PLAN_STEP_LIMIT);
  const items = shown.map((step) => {
    const fullText = String(step?.step || '').trim() || 'Untitled step';
    const text = clampText(fullText, STEP_TEXT_LIMIT);
    const title = boundedTitle(fullText, text);
    const owner = clampText(step?.owner, AGENT_TYPE_LIMIT);
    const state = planStepState(step?.status, turnEnded);
    const presentation = PLAN_STATES[state];
    return `
      <li class="activity-overview-item activity-overview-plan-item" data-activity-state="${state}">
        <span class="activity-overview-mark" aria-hidden="true">${presentation.glyph}</span>
        <span class="activity-overview-copy">
          <strong${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(text)}</strong>
          ${owner ? `<small>${escapeHtml(owner)}</small>` : ''}
        </span>
        <span class="activity-overview-state">${presentation.label}</span>
      </li>`;
  }).join('');
  const hidden = steps.length - shown.length;
  const overflow = hidden > 0
    ? `<li class="activity-overview-more">+${hidden} more step${hidden === 1 ? '' : 's'} in the activity log</li>`
    : '';
  const progress = `${plan.done} of ${plan.total} complete`;
  return `
    <section class="activity-overview-group activity-overview-plan" aria-labelledby="activity-overview-plan-title">
      <header>
        <h3 id="activity-overview-plan-title"><span aria-hidden="true">☷</span>Plan</h3>
        <small>${escapeHtml(progress)}</small>
      </header>
      ${items ? `<ol>${items}${overflow}</ol>` : '<p class="activity-overview-group-empty">No plan steps reported.</p>'}
    </section>`;
}

function agentStatus(entry, task) {
  const item = entryItem(entry);
  const details = subAgentEntryDetails(entry);
  const finished = entry?.agentFinishedEvent?.payload || null;
  const recordedState = subAgentEntryState(entry);
  const reportedStatus = String(details?.reportedStatus || finished?.status || '').trim().toLowerCase();
  const failed = details?.failed === true
    || item?.status === 'failed'
    || (Boolean(reportedStatus) && !['completed', 'finished', 'shutdown'].includes(reportedStatus));

  if (task?.status !== 'running' && ['running', 'backgrounded'].includes(recordedState)) {
    return { key: 'unfinished', label: 'Unfinished', live: false };
  }
  if (failed) {
    const fallback = reportedStatus
      ? `${reportedStatus.charAt(0).toUpperCase()}${reportedStatus.slice(1)}`
      : 'Failed';
    return {
      key: 'attention',
      label: clampText(details?.statusLabel || fallback, 48),
      live: false,
    };
  }
  if (recordedState === 'backgrounded') {
    return { key: 'running', label: 'In background', live: true };
  }
  if (recordedState === 'running') {
    return { key: 'running', label: details?.statusLabel || 'Running', live: true };
  }
  return { key: 'finished', label: details?.statusLabel || 'Finished', live: false };
}

function agentRecord(entry, task, now) {
  const item = entryItem(entry);
  const details = subAgentEntryDetails(entry);
  const finished = entry?.agentFinishedEvent?.payload || null;
  const status = agentStatus(entry, task);
  const fullName = String(
    details?.name
      || item?.agentName
      || item?.arguments?.description
      || finished?.agentName
      || 'Unnamed sub-agent',
  ).trim();
  const fullType = String(
    details?.agentType
      || item?.agentType
      || item?.arguments?.subagent_type
      || '',
  ).trim();
  const fullBrief = String(details?.prompt || item?.arguments?.prompt || '').trim();
  const startedAt = entryFirstEvent(entry)?.created_at || null;
  const finishedAt = status.live
    ? null
    : status.key === 'unfinished'
      ? task?.finished_at || entryLastEvent(entry)?.created_at || null
      : entry?.agentFinishedEvent?.created_at
        || entryLastEvent(entry)?.created_at
        || task?.finished_at
        || null;

  return {
    provider: details?.provider || ((entry?.events || []).some((event) => (
      event?.payload?.provider === 'claude' || event?.kind === 'claude'
    )) ? 'claude' : 'codex'),
    name: clampText(fullName, AGENT_NAME_LIMIT),
    nameTitle: boundedTitle(fullName, clampText(fullName, AGENT_NAME_LIMIT)),
    type: clampText(fullType, AGENT_TYPE_LIMIT),
    brief: clampText(fullBrief, AGENT_BRIEF_LIMIT),
    briefTitle: boundedTitle(fullBrief, clampText(fullBrief, AGENT_BRIEF_LIMIT)),
    startedAt,
    finishedAt,
    duration: durationMarkup(startedAt, finishedAt, now),
    ...status,
  };
}

function agentsMarkup(entries, task, now) {
  const agents = (entries || [])
    .filter(isSubAgentEntry)
    .map((entry) => agentRecord(entry, task, now))
    .sort((left, right) => Number(right.live) - Number(left.live));
  if (!agents.length) return '';

  const shown = agents.slice(0, AGENT_LIMIT);
  const items = shown.map((agent) => {
    const provider = agent.provider === 'claude' ? 'Claude' : 'Codex';
    const meta = [provider, agent.type].filter(Boolean).join(' · ');
    return `
      <li class="activity-overview-item activity-overview-agent-item" data-activity-state="${agent.key}">
        <span class="activity-overview-mark" aria-hidden="true">↳</span>
        <span class="activity-overview-copy">
          <strong${agent.nameTitle ? ` title="${escapeHtml(agent.nameTitle)}"` : ''}>${escapeHtml(agent.name)}</strong>
          <small>${escapeHtml(meta)}</small>
          ${agent.brief ? `<span class="activity-overview-brief"${agent.briefTitle ? ` title="${escapeHtml(agent.briefTitle)}"` : ''}>${escapeHtml(agent.brief)}</span>` : ''}
        </span>
        <span class="activity-overview-result">
          <span class="activity-overview-state"><i aria-hidden="true"></i>${escapeHtml(agent.label)}</span>
          <small>${agent.duration}</small>
        </span>
      </li>`;
  }).join('');
  const hidden = agents.length - shown.length;
  const overflow = hidden > 0
    ? `<li class="activity-overview-more">+${hidden} more sub-agent${hidden === 1 ? '' : 's'} in the activity log</li>`
    : '';
  const active = agents.filter((agent) => agent.live).length;
  const summary = active
    ? `${active} active · ${agents.length} total`
    : `${agents.length} recorded`;
  return `
    <section class="activity-overview-group activity-overview-agents" aria-labelledby="activity-overview-agents-title">
      <header>
        <h3 id="activity-overview-agents-title"><span aria-hidden="true">⌘</span>Sub-agents</h3>
        <small>${escapeHtml(summary)}</small>
      </header>
      <ol>${items}${overflow}</ol>
    </section>`;
}

export function taskActivityOverview(entries, task, now = Date.now()) {
  const plan = planMarkup(entries, task);
  const agents = agentsMarkup(entries, task, now);
  return {
    runtimeMetric: runtimeMetricMarkup(task, now),
    body: plan || agents
      ? `${plan}${agents}`
      : `<div class="activity-overview-empty">
          <strong>Waiting for work details</strong>
          <span>Plan steps and sub-agent assignments appear here as they are reported.</span>
        </div>`,
  };
}

export function refreshActivityOverviewDurations(root, now = Date.now()) {
  if (!root?.querySelectorAll) return;
  for (const element of root.querySelectorAll('[data-activity-duration]')) {
    const value = formatElapsedDuration(
      element.dataset.startedAt,
      element.dataset.finishedAt || null,
      now,
    );
    if (value) element.textContent = value;
  }
}
