const COMMAND_ITEM_TYPES = new Set([
  'commandExecution',
  'fileChange',
  'imageView',
  'mcpToolCall',
  'webSearch',
]);

const ASSISTANT_MESSAGE_ITEM_TYPES = new Set(['agentMessage', 'agent_message']);
const PROVIDER_MESSAGE_TYPES = new Set(['claude/message', 'opencode/message']);

const QUIET_ITEM_TYPES = new Set([
  'contextCompaction',
  'reasoning',
  'userMessage',
]);

const CODEX_AGENT_RUNNING_STATES = new Set(['pendingInit', 'running']);

const CODEX_AGENT_STATUS_LABELS = {
  pendingInit: 'Starting',
  running: 'Running',
  completed: 'Finished',
  interrupted: 'Interrupted',
  errored: 'Failed',
  shutdown: 'Closed',
  notFound: 'Unavailable',
};

// Both providers publish the complete plan on every revision, never a delta, so the newest
// event is always the whole truth for its fold key.
const PLAN_EVENT_TYPES = new Set(['turn/plan/updated', 'claude/plan']);
const PLAN_STEP_STATUSES = new Set(['pending', 'inProgress', 'completed']);

const GOAL_EVENT_TYPES = new Set(['thread/goal/updated', 'thread/goal/cleared']);
const GOAL_STATUS_LABELS = {
  active: 'Active',
  paused: 'Paused',
  blocked: 'Blocked',
  usageLimited: 'Usage limited',
  budgetLimited: 'Budget limited',
  complete: 'Complete',
};

// Provider text indexes the label maps below. An unguarded `LABELS[status]` walks the
// prototype chain, so a status named `__proto__` renders `[object Object]` and one named
// `toString` or `constructor` renders a function body, in the pill and in the copied log.
function labelFor(labels, key) {
  return Object.prototype.hasOwnProperty.call(labels, key) ? labels[key] : '';
}

function planEventPayload(event) {
  return PLAN_EVENT_TYPES.has(event?.payload?.type) ? event.payload : null;
}

function goalEventPayload(event) {
  return GOAL_EVENT_TYPES.has(event?.payload?.type) ? event.payload : null;
}

// The stored goal keeps a status CC Relay does not recognize rather than discarding it, so an
// unfamiliar status is humanized here instead of being flattened into a generic word. The
// label rides in an uppercase pill, so an absurd provider value is bounded rather than
// allowed to dominate the row.
function goalStatusLabel(status) {
  const known = labelFor(GOAL_STATUS_LABELS, status);
  if (known) {
    return known;
  }
  const words = String(status ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().slice(0, 48);
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1).toLowerCase()}` : 'Recorded';
}

// The fold key is `planKey`. An event that somehow arrives without one keeps its own row
// rather than collapsing every unrelated plan in the task into a single misleading entry.
function planFoldKey(event) {
  const payload = planEventPayload(event);
  if (!payload) {
    return '';
  }
  const key = String(payload.planKey ?? '').trim()
    || String(payload.turnId ?? '').trim()
    || String(payload.threadId ?? '').trim();
  return key || `event-${event.id}`;
}

function goalFoldKey(event) {
  const payload = goalEventPayload(event);
  if (!payload) {
    return '';
  }
  const key = String(payload.threadId ?? '').trim();
  return key || `event-${event.id}`;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function isPlanEntry(entry) {
  return Boolean(entry?.planKey);
}

export function isGoalEntry(entry) {
  return Boolean(entry?.goalThreadId);
}

function planStepList(payload) {
  return (Array.isArray(payload?.plan) ? payload.plan : []).map((step) => ({
    step: String(step?.step ?? '').trim(),
    status: PLAN_STEP_STATUSES.has(step?.status) ? step.status : 'pending',
    owner: String(step?.owner ?? '').trim(),
  }));
}

// `src/claude-execution-runner.mjs` marks a revision `partial: true` when it could not read
// the Claude board mirror and its own fold is not known to be whole: the payload then carries
// this turn's steps and no more. Such a revision may never shrink a board the operator has
// already been shown, so its steps are layered onto the fuller board instead of replacing it.
// A named step keeps its place and takes the newer status and owner, and a step the fuller
// board never had is appended rather than dropped. Repeated step text is paired in order, so
// a duplicated title moves one row rather than every row that shares its wording.
function planLayerSteps(base, incoming) {
  const merged = base.map((step) => ({ ...step }));
  const claimed = new Set();
  for (const step of incoming) {
    const index = merged.findIndex((candidate, at) => !claimed.has(at) && candidate.step === step.step);
    if (index === -1) {
      merged.push({ ...step });
      claimed.add(merged.length - 1);
      continue;
    }
    claimed.add(index);
    merged[index] = {
      ...merged[index],
      status: step.status,
      owner: step.owner || merged[index].owner,
    };
  }
  return merged;
}

// Normalized, provider-neutral plan state. Codex and Claude publish the same step shape;
// `owner` is Claude-only and stays empty for Codex. Every count here describes the steps this
// same object carries, so a consumer that draws `steps` can report `done`/`total` honestly.
export function planEntryDetails(entry) {
  if (!isPlanEntry(entry)) {
    return null;
  }
  const events = entry.planEvents || [];
  const latest = events.at(-1)?.payload || null;
  if (!latest) {
    return null;
  }
  // Whether the row is standing on a partial revision. Always a boolean: the payload field is
  // present only when true, and the renderer must not have to re-derive this.
  const partial = latest.partial === true;
  // The base is the newest revision that claimed to be whole; every partial revision recorded
  // after it layers on in order, so a step one partial turn completed is not reverted by the
  // next partial turn that never mentions it. A fold that is partial all the way back starts
  // from its own first revision. Codex never sends `partial`, so a Codex fold walks nothing
  // and keeps its exact last-write-wins reading.
  let baseIndex = events.length - 1;
  while (baseIndex > 0 && events[baseIndex]?.payload?.partial === true) {
    baseIndex -= 1;
  }
  let steps = planStepList(events[baseIndex]?.payload);
  for (let index = baseIndex + 1; index < events.length; index += 1) {
    steps = planLayerSteps(steps, planStepList(events[index]?.payload));
  }
  const done = steps.filter((step) => step.status === 'completed').length;
  const inProgress = steps.filter((step) => step.status === 'inProgress').length;
  return {
    provider: latest.type === 'claude/plan' ? 'claude' : 'codex',
    planKey: entry.planKey,
    partial,
    // The explanation still follows the newest revision alone, exactly as it always did. The
    // backend derives it from the step being worked on right now, so a partial revision that
    // carries none leaves the line empty rather than resurrecting a sentence about an earlier
    // turn's step and printing it beside a merged board.
    explanation: String(latest.explanation ?? '').trim(),
    steps,
    total: steps.length,
    done,
    inProgress,
    // Two partial turns can each leave a step in progress, because neither one can speak for
    // the other's steps. Board order decides the current step rather than arrival order.
    current: steps.find((step) => step.status === 'inProgress')?.step || '',
  };
}

// A goal is only ever set by a Codex client, so a task without a goal event has no goal
// details at all and must not render an invented empty panel.
export function goalEntryDetails(entry) {
  if (!isGoalEntry(entry)) {
    return null;
  }
  let goal = null;
  let cleared = false;
  // The backend replays the goal a turn last observed, flagged `turnEnded`, once that turn
  // ends. `src/queue.mjs` dispatches a same-session follow-up into the same task stream and
  // every goal on a thread folds into this one entry, so the flag rides on the goal record
  // that carries it rather than latching: the next turn's goal record clears it and reads as
  // live again. A task that is no longer running is settled by its own status instead.
  let turnEnded = false;
  for (const event of entry.goalEvents || []) {
    if (event.payload?.type === 'thread/goal/cleared') {
      cleared = true;
      continue;
    }
    if (event.payload?.goal) {
      goal = event.payload.goal;
      cleared = false;
      // Both shapes are accepted so the flag survives either emitter, and a record carrying
      // neither clears both.
      turnEnded = event.payload.turnEnded === true || event.payload.goal.turnEnded === true;
    }
  }
  const status = String(goal?.status ?? '').trim();
  return {
    provider: 'codex',
    threadId: entry.goalThreadId,
    cleared,
    turnEnded,
    objective: String(goal?.objective ?? '').trim(),
    status: cleared ? 'cleared' : status,
    statusLabel: cleared ? 'Cleared' : goalStatusLabel(status),
    tokensUsed: positiveNumber(goal?.tokensUsed),
    tokenBudget: positiveNumber(goal?.tokenBudget),
    timeUsedSeconds: positiveNumber(goal?.timeUsedSeconds),
    createdAt: goal?.createdAt || '',
    updatedAt: goal?.updatedAt || '',
  };
}

function isPairableItemEvent(event) {
  return event?.payload?.item?.id
    && ['item/started', 'item/updated', 'item/completed'].includes(event.payload.type);
}

function liveClaudeMessageId(event) {
  if (event?.payload?.type !== 'claude/message') return '';
  return typeof event.payload.liveMessageId === 'string'
    ? event.payload.liveMessageId.trim()
    : '';
}

function userMessageText(item) {
  if (item?.type !== 'userMessage' || !Array.isArray(item.content)) return '';
  return item.content
    .filter((part) => part?.type === 'text')
    .map((part) => String(part.text || ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function userMessageKeys(item) {
  if (item?.type !== 'userMessage') return [];
  return [
    typeof item.clientId === 'string' && item.clientId.trim()
      ? `client:${item.clientId.trim()}`
      : '',
    typeof item.id === 'string' && item.id.trim()
      ? `item:${item.id.trim()}`
      : '',
  ].filter(Boolean);
}

function promptMatchesDeliveredText(promptText, deliveredText) {
  const prompt = String(promptText || '').trim();
  const delivered = String(deliveredText || '').trim();
  if (!prompt || !delivered) return false;
  if (prompt === delivered) return true;
  if (!delivered.startsWith(prompt)) return false;
  return delivered
    .slice(prompt.length)
    .trimStart()
    .startsWith('CC Relay orchestrator notice:');
}

function canonicalPromptEvent(event, prompt) {
  const item = event.payload.item;
  return {
    ...event,
    message: prompt.text,
    payload: {
      ...event.payload,
      item: {
        ...item,
        promptKind: prompt.kind || item.promptKind || 'message',
        content: [
          { type: 'text', text: prompt.text },
          ...(item.content || []).filter((part) => part?.type !== 'text'),
        ],
      },
    },
  };
}

function syntheticPromptEvent(prompt, index, provider) {
  const promptId = String(prompt.id || `${prompt.kind || 'message'}-${index + 1}`);
  return {
    id: `prompt-display-${promptId}`,
    kind: provider,
    message: prompt.text,
    created_at: prompt.created_at || '',
    payload: {
      type: 'item/completed',
      provider,
      displayOnly: true,
      item: {
        id: `prompt-display-item-${promptId}`,
        clientId: `relay-prompt-display-${promptId}`,
        type: 'userMessage',
        promptKind: prompt.kind || 'message',
        content: [{ type: 'text', text: prompt.text }],
      },
    },
  };
}

export function mergePromptMessages(events, prompts, { provider = 'codex' } = {}) {
  const canonicalPrompts = (Array.isArray(prompts) ? prompts : [])
    .map((prompt, index) => ({
      id: prompt?.id || `prompt-${index + 1}`,
      kind: prompt?.kind || 'message',
      text: String(prompt?.text || '').trim(),
      created_at: prompt?.created_at || '',
      index,
      matched: false,
    }))
    .filter((prompt) => prompt.text);
  const promptsByItemKey = new Map();

  const merged = (Array.isArray(events) ? events : []).map((event) => {
    const item = event?.payload?.item;
    const deliveredText = userMessageText(item);
    if (!deliveredText) return event;
    const itemKeys = userMessageKeys(item);
    const prompt = itemKeys
      .map((key) => promptsByItemKey.get(key))
      .find(Boolean)
      || canonicalPrompts.find((candidate) => (
        !candidate.matched && promptMatchesDeliveredText(candidate.text, deliveredText)
      ));
    if (!prompt) return event;
    prompt.matched = true;
    for (const key of itemKeys) promptsByItemKey.set(key, prompt);
    return canonicalPromptEvent(event, prompt);
  });

  for (const prompt of canonicalPrompts.filter((candidate) => !candidate.matched)) {
    const promptTime = Date.parse(prompt.created_at);
    let insertAt = -1;
    if (Number.isFinite(promptTime)) {
      insertAt = merged.findIndex((event) => {
        const eventTime = Date.parse(event?.created_at);
        return Number.isFinite(eventTime) && eventTime > promptTime;
      });
    }
    if (insertAt < 0) {
      insertAt = prompt.kind === 'original' && merged.length > 0 ? 0 : merged.length;
    }
    merged.splice(insertAt, 0, syntheticPromptEvent(prompt, prompt.index, provider));
  }

  return merged;
}

// Claude board bookkeeping. `src/claude-execution-runner.mjs` marks the `TaskCreate`,
// `TaskUpdate`, and `TodoWrite` calls it folds into the plan, so the console can render them
// quietly beside the plan row that already reports the same change instead of stacking a
// loud generic tool row next to it. A call that failed folded nothing and stays loud.
export function isPlanToolItem(item) {
  return Boolean(item
    && item.type === 'mcpToolCall'
    && item.planTool === true
    && item.status !== 'failed');
}

function isClaudeSubAgentItem(item) {
  return Boolean(item && item.type === 'mcpToolCall' && item.subAgent === true);
}

function isCodexSubAgentActivityItem(item) {
  return Boolean(item && item.type === 'subAgentActivity' && item.agentThreadId);
}

function isCodexSubAgentSpawnItem(item) {
  return Boolean(item && item.type === 'collabAgentToolCall' && item.tool === 'spawnAgent');
}

function isCodexCollabAgentItem(item) {
  return Boolean(item && item.type === 'collabAgentToolCall');
}

function codexAgentIds(item) {
  if (isCodexSubAgentActivityItem(item)) {
    return [item.agentThreadId];
  }
  if (!isCodexCollabAgentItem(item)) {
    return [];
  }
  return [...new Set([
    ...(item.receiverThreadIds || []),
    ...Object.keys(item.agentsStates || {}),
  ].filter(Boolean))];
}

// Provider-neutral sub-agent signal. Claude marks Agent tool calls explicitly. Codex exposes
// first-class collaboration activity and spawn items through the app-server protocol.
export function isSubAgentItem(item) {
  return isClaudeSubAgentItem(item)
    || isCodexSubAgentActivityItem(item)
    || isCodexSubAgentSpawnItem(item);
}

// Claude reports a finished sub-agent through a task notification, which CC Relay records as a
// claude/agent-finished event carrying the tool use that launched (or last resumed) the agent.
export function isAgentFinishedEvent(event) {
  return event?.payload?.type === 'claude/agent-finished';
}

function isNamedAgentFinishedEvent(event) {
  if (!isAgentFinishedEvent(event)) {
    return false;
  }
  const name = String(event.payload.agentName || '').trim();
  const summary = String(event.payload.summary || '').trim();
  return Boolean(name) || /^Agent\s+['"]/i.test(summary);
}

function agentFinishedToolUseId(event) {
  return isAgentFinishedEvent(event) ? String(event.payload.toolUseId || '').trim() : '';
}

export function groupEventEntries(events) {
  const list = events || [];
  const entries = [];
  const entriesByItemId = new Map();
  const entriesByLiveMessageId = new Map();
  const entriesByCodexAgentId = new Map();
  const entriesByPlanKey = new Map();
  const entriesByGoalThreadId = new Map();
  const entriesByTokenProvider = new Map();
  const codexAgentIdsByItemId = new Map();
  // A backgrounded sub-agent's task notification can be written to the transcript before the
  // launch record it belongs to, so the fold targets are collected before grouping starts.
  const subAgentItemIds = new Set();
  for (const event of list) {
    const item = event?.payload?.item;
    if (isClaudeSubAgentItem(item) && item.id) {
      subAgentItemIds.add(item.id);
    }
    const agentIds = codexAgentIds(item);
    if (item?.id && agentIds.length) {
      const knownIds = codexAgentIdsByItemId.get(item.id) || new Set();
      for (const agentId of agentIds) knownIds.add(agentId);
      codexAgentIdsByItemId.set(item.id, knownIds);
    }
  }

  const entryForItemId = (itemId) => {
    let entry = entriesByItemId.get(itemId);
    if (!entry) {
      entry = {
        id: `item-${itemId}`,
        events: [],
        startedEvent: null,
        updatedEvent: null,
        completedEvent: null,
        agentFinishedEvent: null,
      };
      entriesByItemId.set(itemId, entry);
      entries.push(entry);
    }
    return entry;
  };

  const entryForCodexAgent = (agentThreadId) => {
    let entry = entriesByCodexAgentId.get(agentThreadId);
    if (!entry) {
      entry = {
        id: `codex-agent-${agentThreadId}`,
        events: [],
        startedEvent: null,
        updatedEvent: null,
        completedEvent: null,
        agentFinishedEvent: null,
        codexAgentThreadId: agentThreadId,
        codexAgentEvents: [],
      };
      entriesByCodexAgentId.set(agentThreadId, entry);
      entries.push(entry);
    }
    return entry;
  };

  // Plan and goal rows are last-write-wins folds that keep their first-seen position, exactly
  // like Codex worker rows. They never set `startedEvent`, so a live plan can never inflate
  // the active-work metric or read as a running signal.
  const entryForPlan = (planKey) => {
    let entry = entriesByPlanKey.get(planKey);
    if (!entry) {
      entry = {
        id: `plan-${planKey}`,
        events: [],
        startedEvent: null,
        updatedEvent: null,
        completedEvent: null,
        agentFinishedEvent: null,
        planKey,
        planEvents: [],
      };
      entriesByPlanKey.set(planKey, entry);
      entries.push(entry);
    }
    return entry;
  };

  const entryForGoal = (threadId) => {
    let entry = entriesByGoalThreadId.get(threadId);
    if (!entry) {
      entry = {
        id: `goal-${threadId}`,
        events: [],
        startedEvent: null,
        updatedEvent: null,
        completedEvent: null,
        agentFinishedEvent: null,
        goalThreadId: threadId,
        goalEvents: [],
      };
      entriesByGoalThreadId.set(threadId, entry);
      entries.push(entry);
    }
    return entry;
  };

  const entryForTokenProvider = (provider) => {
    let entry = entriesByTokenProvider.get(provider);
    if (!entry) {
      entry = {
        id: `token-usage-${provider}`,
        events: [],
        startedEvent: null,
        updatedEvent: null,
        completedEvent: null,
        agentFinishedEvent: null,
      };
      entriesByTokenProvider.set(provider, entry);
      entries.push(entry);
    }
    return entry;
  };

  for (const event of list) {
    const item = event?.payload?.item;

    if (event?.payload?.type === 'provider/token-usage') {
      const entry = entryForTokenProvider(event.payload.provider || event.kind || 'provider');
      entry.events.push(event);
      entry.updatedEvent = event;
      continue;
    }

    const planKey = planFoldKey(event);
    if (planKey) {
      const entry = entryForPlan(planKey);
      entry.events.push(event);
      entry.planEvents.push(event);
      continue;
    }

    const goalThreadId = goalFoldKey(event);
    if (goalThreadId) {
      const entry = entryForGoal(goalThreadId);
      entry.events.push(event);
      entry.goalEvents.push(event);
      // A cleared goal resolves its row; a later goal on the same thread reopens it.
      entry.completedEvent = event.payload.type === 'thread/goal/cleared' ? event : null;
      continue;
    }

    const groupedCodexAgentIds = item?.id && codexAgentIdsByItemId.has(item.id)
      ? [...codexAgentIdsByItemId.get(item.id)]
      : codexAgentIds(item);
    if (groupedCodexAgentIds.length) {
      for (const codexAgentId of groupedCodexAgentIds) {
        const entry = entryForCodexAgent(codexAgentId);
        entry.events.push(event);
        entry.codexAgentEvents.push(event);
        entry.startedEvent ||= event;
        entry.updatedEvent = event;
        if (item.type === 'subAgentActivity') {
          if (item.kind === 'interrupted') {
            entry.completedEvent = event;
          } else if (item.kind === 'started') {
            entry.completedEvent = null;
          }
        }
        const codexState = isCodexCollabAgentItem(item)
          ? item.agentsStates?.[codexAgentId]?.status
          : null;
        if (codexState && !CODEX_AGENT_RUNNING_STATES.has(codexState)) {
          entry.completedEvent = event;
        } else if (codexState && CODEX_AGENT_RUNNING_STATES.has(codexState)) {
          entry.completedEvent = null;
        }
      }
      continue;
    }

    const messageId = liveClaudeMessageId(event);
    if (messageId) {
      let entry = entriesByLiveMessageId.get(messageId);
      if (!entry) {
        entry = {
          id: `live-message-${event.id}`,
          events: [],
          liveMessageText: '',
          liveMessageEvent: null,
          startedEvent: null,
          updatedEvent: null,
          completedEvent: null,
          agentFinishedEvent: null,
        };
        entriesByLiveMessageId.set(messageId, entry);
        entries.push(entry);
      }
      entry.events.push(event);
      if (typeof event.payload.liveDelta === 'string') {
        entry.liveMessageText += event.payload.liveDelta;
      } else {
        // Compatibility with live message events written before delta-only storage.
        entry.liveMessageText = String(event.payload.text || event.message || '');
      }
      const text = entry.liveMessageText.trim();
      entry.liveMessageEvent = {
        ...event,
        message: text,
        payload: {
          ...event.payload,
          text,
        },
      };
      continue;
    }

    const finishedToolUseId = agentFinishedToolUseId(event);
    // A notification whose tool use is a known sub-agent launch resolves that signal. Any
    // other notification (a resumed agent reports through the SendMessage that woke it) keeps
    // its own line instead of silently attaching to an unrelated tool call.
    if (finishedToolUseId && subAgentItemIds.has(finishedToolUseId)) {
      const entry = entryForItemId(finishedToolUseId);
      entry.events.push(event);
      entry.agentFinishedEvent = event;
      continue;
    }

    if (!isPairableItemEvent(event)) {
      entries.push({
        id: `event-${event.id}`,
        events: [event],
        startedEvent: null,
        updatedEvent: null,
        completedEvent: null,
        agentFinishedEvent: isAgentFinishedEvent(event) ? event : null,
      });
      continue;
    }

    const entry = entryForItemId(event.payload.item.id);
    entry.events.push(event);
    if (event.payload.type === 'item/started') {
      entry.startedEvent = event;
    } else if (event.payload.type === 'item/completed') {
      entry.completedEvent = event;
    } else {
      entry.updatedEvent = event;
    }
  }

  return entries;
}

export function entryItem(entry) {
  // Plan and goal notifications carry no thread item at all. Returning null keeps every
  // item-shaped consumer (category, stats, presentation) on its existing null path.
  if (entry?.planEvents?.length || entry?.goalEvents?.length) {
    return null;
  }
  if (entry?.codexAgentEvents?.length) {
    return entry.codexAgentEvents.at(-1)?.payload?.item || null;
  }
  return entry?.completedEvent?.payload?.item
    || entry?.updatedEvent?.payload?.item
    || entry?.startedEvent?.payload?.item
    || entry?.events?.find((event) => event.payload?.item)?.payload.item
    || null;
}

export function entryLastEvent(entry) {
  if (entry?.planEvents?.length) {
    return entry.planEvents.at(-1) || null;
  }
  if (entry?.goalEvents?.length) {
    return entry.goalEvents.at(-1) || null;
  }
  if (entry?.codexAgentEvents?.length) {
    return entry.codexAgentEvents.at(-1) || null;
  }
  return entry?.completedEvent || entry?.liveMessageEvent || entry?.events?.at(-1) || null;
}

export function entryFirstEvent(entry) {
  if (entry?.planEvents?.length) {
    return entry.planEvents[0] || null;
  }
  if (entry?.goalEvents?.length) {
    return entry.goalEvents[0] || null;
  }
  if (entry?.codexAgentEvents?.length) {
    return entry.codexAgentEvents[0] || null;
  }
  return entry?.startedEvent || entry?.events?.[0] || null;
}

export function eventEntryMessageRole(entry) {
  if (isPlanEntry(entry) || isGoalEntry(entry)) return null;
  const item = entryItem(entry);
  if (item?.type === 'userMessage') return 'user';
  if (ASSISTANT_MESSAGE_ITEM_TYPES.has(item?.type)) return 'assistant';
  const lastEvent = entryLastEvent(entry);
  if (PROVIDER_MESSAGE_TYPES.has(lastEvent?.payload?.type) || lastEvent?.kind === 'result') {
    return 'assistant';
  }
  return null;
}

function normalizedAssistantMessageText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim();
}

// Provider transport completion is not answer finality. Claude's `liveFinal` closes one
// MessageDisplay batch, and Codex stores every completed agentMessage under the historical
// `result` event kind, including commentary. Prefer the explicit Codex phase, retain the
// unstructured legacy result contract, and use the settled task result to identify Claude's
// concluding response after the turn has actually completed.
export function assistantMessageStatus(entry, task, message = '') {
  if (eventEntryMessageRole(entry) !== 'assistant') return '';
  const item = entryItem(entry);
  const lastEvent = entryLastEvent(entry);
  const phase = String(item?.phase || '').trim().toLowerCase();
  if (['final', 'final_answer'].includes(phase)) return 'final';
  if (phase) return 'update';

  const structuredMessage = ASSISTANT_MESSAGE_ITEM_TYPES.has(item?.type)
    || PROVIDER_MESSAGE_TYPES.has(lastEvent?.payload?.type);
  if (lastEvent?.kind === 'result' && !structuredMessage) return 'final';
  // Older Codex records predate message phases and emitted only the final response as a
  // structured result. Preserve that history without letting current commentary inherit it.
  if (
    lastEvent?.kind === 'result'
    && ASSISTANT_MESSAGE_ITEM_TYPES.has(item?.type)
    && !Object.prototype.hasOwnProperty.call(item, 'phase')
  ) return 'final';

  const taskSettled = ['complete', 'open'].includes(String(task?.status || '').toLowerCase());
  const taskResult = normalizedAssistantMessageText(task?.result);
  const entryText = normalizedAssistantMessageText(
    message || item?.text || lastEvent?.payload?.text || lastEvent?.message,
  );
  return taskSettled && taskResult && entryText === taskResult ? 'final' : 'update';
}

export function eventMessageCounts(entries) {
  const counts = { user: 0, assistant: 0 };
  for (const entry of entries || []) {
    const role = eventEntryMessageRole(entry);
    if (role) counts[role] += 1;
  }
  return counts;
}

export function eventEntryCategory(entry) {
  // Plan and goal rows are neither commands nor messages. This must stay ahead of the
  // event-kind fallthrough below, which would file a `kind: 'claude'` plan under Messages.
  if (isPlanEntry(entry) || isGoalEntry(entry)) {
    return 'system';
  }
  if (entry?.codexAgentThreadId || isSubAgentItem(entryItem(entry))) {
    return 'commands';
  }
  const item = entryItem(entry);
  if (COMMAND_ITEM_TYPES.has(item?.type)) {
    return 'commands';
  }
  if (ASSISTANT_MESSAGE_ITEM_TYPES.has(item?.type) || item?.type === 'userMessage') {
    return 'messages';
  }
  if (PROVIDER_MESSAGE_TYPES.has(entryLastEvent(entry)?.payload?.type)) {
    return 'messages';
  }
  if (entry.events.some((event) => ['claude', 'plan', 'result'].includes(event.kind))) {
    return 'messages';
  }
  return 'system';
}

export function isEventEntryHighlight(entry) {
  // The plan checklist and the goal are the two rows an operator most wants in a compact
  // view, so they are pinned into Highlights rather than left to the fallthrough.
  if (isPlanEntry(entry) || isGoalEntry(entry)) {
    return true;
  }
  const item = entryItem(entry);
  const lastEvent = entryLastEvent(entry);
  if (lastEvent?.kind === 'stderr' || lastEvent?.payload?.type === 'error') {
    return true;
  }
  // Board bookkeeping is the plan row's own paperwork. It stays in All and in Commands, and
  // in the copied log, but the compact view shows the folded plan instead of its mechanics.
  if (QUIET_ITEM_TYPES.has(item?.type) || isPlanToolItem(item)) {
    return false;
  }
  if (lastEvent?.payload?.type === 'turn/started'
    || lastEvent?.payload?.type === 'turn/completed'
    || lastEvent?.payload?.type === 'claude/progress') {
    return false;
  }
  return true;
}

export function filterEventEntries(entries, filter) {
  if (filter === 'highlights') {
    return entries.filter(isEventEntryHighlight);
  }
  if (filter === 'conversation') {
    return entries.filter((entry) => Boolean(eventEntryMessageRole(entry)));
  }
  if (filter === 'mine') {
    return entries.filter((entry) => eventEntryMessageRole(entry) === 'user');
  }
  if (filter === 'ai') {
    return entries.filter((entry) => eventEntryMessageRole(entry) === 'assistant');
  }
  if (filter === 'commands' || filter === 'messages') {
    return entries.filter((entry) => eventEntryCategory(entry) === filter);
  }
  return [...entries];
}

// True for a sub-agent launch signal and for a standalone finish notification that has no
// launch signal in this stream (a resumed agent, or a notification read before its launch).
export function isSubAgentEntry(entry) {
  return Boolean(entry?.codexAgentThreadId)
    || isSubAgentItem(entryItem(entry))
    || isNamedAgentFinishedEvent(entry?.agentFinishedEvent);
}

function codexSubAgentDetails(entry) {
  if (!entry?.codexAgentThreadId) {
    return null;
  }
  const details = {
    provider: 'codex',
    name: '',
    agentType: '',
    prompt: '',
    reportedStatus: 'running',
    statusLabel: 'Running',
    note: '',
    failed: false,
  };
  let agentPath = '';
  let model = '';
  let reasoningEffort = '';

  for (const event of entry.codexAgentEvents || []) {
    const item = event?.payload?.item;
    if (isCodexSubAgentActivityItem(item)) {
      agentPath = String(item.agentPath || agentPath).trim();
      if (item.kind === 'started') {
        details.reportedStatus = 'running';
      } else if (item.kind === 'interrupted') {
        details.reportedStatus = 'interrupted';
      }
    }
    if (isCodexCollabAgentItem(item)) {
      if (isCodexSubAgentSpawnItem(item)) {
        details.prompt = String(item.prompt || details.prompt).trim();
        model = String(item.model || model).trim();
        reasoningEffort = String(item.reasoningEffort || reasoningEffort).trim();
      }
      if (item.status === 'failed' && isCodexSubAgentSpawnItem(item)) {
        details.reportedStatus = 'errored';
      }
      const state = item.agentsStates?.[entry.codexAgentThreadId];
      if (state?.status) {
        details.reportedStatus = state.status;
      }
      if (state?.message) {
        details.note = String(state.message).trim();
      }
    }
  }

  const pathName = agentPath.split(/[\\/]/).filter(Boolean).at(-1) || '';
  details.name = pathName || `agent ${entry.codexAgentThreadId.slice(0, 8)}`;
  details.agentType = [model, reasoningEffort].filter(Boolean).join(' / ') || 'Codex';
  details.statusLabel = labelFor(CODEX_AGENT_STATUS_LABELS, details.reportedStatus) || 'Recorded';
  details.failed = ['errored', 'interrupted', 'notFound'].includes(details.reportedStatus);
  return details;
}

export function subAgentEntryDetails(entry) {
  return codexSubAgentDetails(entry);
}

// running: the launch tool call is still open.
// backgrounded: Claude launched the agent asynchronously and it is still working.
// finished: its task notification arrived, or a synchronous run returned.
export function subAgentEntryState(entry) {
  const codex = codexSubAgentDetails(entry);
  if (codex) {
    return CODEX_AGENT_RUNNING_STATES.has(codex.reportedStatus) ? 'running' : 'finished';
  }
  if (entry?.agentFinishedEvent) {
    return 'finished';
  }
  const item = entryItem(entry);
  if (!isSubAgentItem(item)) {
    return 'finished';
  }
  if (item.status === 'failed') {
    return 'finished';
  }
  if (item.backgrounded) {
    return 'backgrounded';
  }
  return entry.completedEvent ? 'finished' : 'running';
}

// Sub-agents that started and have not reported back. Counting live launches (never
// decrementing a shared tally) keeps the number at or above zero even when a notification
// arrives before its launch record or belongs to a launch this stream never saw. A finished
// turn owns no live sub-agents, so the count clears with it.
export function activeSubAgentCount(entries, { turnEnded = false } = {}) {
  if (turnEnded) {
    return 0;
  }
  let active = 0;
  for (const entry of entries || []) {
    if (!isSubAgentEntry(entry)) {
      continue;
    }
    if (['running', 'backgrounded'].includes(subAgentEntryState(entry))) {
      active += 1;
    }
  }
  return active;
}

export function eventStreamStats(entries, { turnEnded = false } = {}) {
  const stats = {
    commands: 0,
    files: 0,
    messages: 0,
    errors: 0,
    running: 0,
    thinkingTokens: 0,
    agents: activeSubAgentCount(entries, { turnEnded }),
    // The current plan, or null when the task never published one. Never a zeroed object:
    // the metrics strip must not show a plan tile for a task that has no plan.
    plan: null,
  };
  // Entries keep their first-seen position, so entry order is not revision order: a Claude
  // plan folds on a session-scoped key and stays put while later Codex turns append rows
  // after it. The tile follows the most recently written plan event instead.
  let newestPlanRank = -Infinity;
  for (const entry of entries || []) {
    // Plan and goal rows are telemetry of their own and never contribute to the command,
    // message, error, or active-work tallies. A `kind: 'claude'` plan event would otherwise
    // be counted as a Claude message by the generic accumulator below.
    const planDetails = planEntryDetails(entry);
    if (planDetails) {
      // A task can hold one plan per turn, and per provider. The metric reports the newest
      // plan rather than summing historical turns into a nonsense total. Event ids are
      // written in order; a stream without numeric ids falls back to entry order.
      const rank = Number(entryLastEvent(entry)?.id);
      const ordered = Number.isFinite(rank) ? rank : newestPlanRank + 1;
      if (ordered >= newestPlanRank) {
        newestPlanRank = ordered;
        stats.plan = {
          total: planDetails.total,
          done: planDetails.done,
          inProgress: planDetails.inProgress,
        };
      }
      continue;
    }
    if (isGoalEntry(entry)) {
      continue;
    }
    const item = entryItem(entry);
    const last = entryLastEvent(entry);
    if (last?.payload?.type === 'provider/token-usage') continue;
    if (item?.type === 'commandExecution') stats.commands += 1;
    if (item?.type === 'fileChange') stats.files += 1;
    if (
      ASSISTANT_MESSAGE_ITEM_TYPES.has(item?.type)
      || item?.type === 'userMessage'
      || PROVIDER_MESSAGE_TYPES.has(last?.payload?.type)
      || ['claude', 'result'].includes(last?.kind)
    ) stats.messages += 1;
    if (
      last?.kind === 'stderr'
      || last?.payload?.type === 'error'
      || item?.status === 'failed'
      || subAgentEntryDetails(entry)?.failed
    ) stats.errors += 1;
    if (entry.startedEvent && !entry.completedEvent) stats.running += 1;
    const reasoningTokens = Number(last?.payload?.tokenUsage?.last?.reasoningOutputTokens);
    if (Number.isFinite(reasoningTokens)) stats.thinkingTokens += reasoningTokens;
  }
  return stats;
}
