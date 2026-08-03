/*
 * A session task keeps its native terminal open and runs several turns inside one task
 * row, so its activity reads as a conversation rather than a single prompt with a single
 * result. This module owns the prompt-to-response pairing and stays DOM-free so the rules
 * can be tested without a browser.
 */

const SESSION_STATE_LABELS = {
  'open-idle': {
    label: 'Terminal open',
    hint: 'The native terminal is connected and waiting for the next turn.',
  },
  'open-busy': {
    label: 'Terminal busy',
    hint: 'This session is working. The next turn starts once it goes idle.',
  },
  pending: {
    label: 'Terminal pending',
    hint: 'CC Relay opens this terminal when the task reaches a project slot.',
  },
  closed: {
    label: 'Terminal closed',
    hint: 'Continue session relaunches the saved conversation in a new terminal.',
  },
};

const UNKNOWN_SESSION_STATE = {
  label: 'Terminal state unknown',
  hint: 'CC Relay could not read this terminal state. The next refresh retries.',
};

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function timeValue(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeResponses(responses) {
  if (!Array.isArray(responses)) return [];
  return responses
    .map((response, index) => ({
      id: response?.id || `response-${index + 1}`,
      text: cleanText(response?.text),
      created_at: response?.created_at || null,
    }))
    .filter((response) => response.text);
}

/*
 * An older backend answers without a responses list at all. The task row still carries the
 * final result or the failure, which belongs to the newest turn: it is the only turn that
 * could have produced it.
 */
function fallbackResponses(task) {
  const createdAt = task?.finished_at || task?.created_at || null;
  const result = cleanText(task?.result);
  if (result) return [{ id: 'task-result', text: result, created_at: createdAt }];
  const error = cleanText(task?.error);
  if (error) return [{ id: 'task-error', text: error, created_at: createdAt }];
  return [];
}

function turnIndexForResponse(response, promptTimes, lastIndex) {
  const at = timeValue(response.created_at);
  const comparable = promptTimes.some((value) => value !== null);
  // A response with no usable timestamp, or a prompt list that carries none, leaves
  // nothing to compare. The newest turn is the only safe home for it.
  if (at === null || !comparable) return lastIndex;
  for (let index = lastIndex; index >= 0; index -= 1) {
    const promptTime = promptTimes[index];
    if (promptTime !== null && promptTime <= at) return index;
  }
  // The response predates every prompt CC Relay recorded, so it opened the conversation.
  return 0;
}

/*
 * prompts arrives already normalized and ordered by normalizeTaskPrompts. responses
 * arrives chronological and may hold several assistant messages for one turn; the order
 * inside a turn is preserved so the transcript reads the way the terminal produced it.
 */
export function buildSessionTurns({ task = null, prompts = [], responses } = {}) {
  const turns = (Array.isArray(prompts) ? prompts : []).map((prompt, index) => ({
    id: prompt?.id || `turn-${index + 1}`,
    index,
    prompt: {
      kind: prompt?.kind === 'original' ? 'original' : 'follow-up',
      text: cleanText(prompt?.text),
      created_at: prompt?.created_at || null,
    },
    responses: [],
    finalResponse: null,
    pending: false,
  }));
  if (turns.length === 0) return [];

  const lastIndex = turns.length - 1;
  const delivered = normalizeResponses(responses);
  if (delivered.length) {
    const promptTimes = turns.map((turn) => timeValue(turn.prompt.created_at));
    for (const response of delivered) {
      turns[turnIndexForResponse(response, promptTimes, lastIndex)].responses.push(response);
    }
  } else {
    turns[lastIndex].responses.push(...fallbackResponses(task));
  }

  for (const turn of turns) {
    turn.finalResponse = turn.responses.length ? turn.responses.at(-1).text : null;
  }
  const newest = turns[lastIndex];
  newest.pending = newest.responses.length === 0 && task?.status === 'running';
  return turns;
}

export function sessionConversationText(turns, { responseLabel = 'Response' } = {}) {
  return (Array.isArray(turns) ? turns : []).map((turn) => {
    const number = String(turn.index + 1).padStart(2, '0');
    const answer = turn.responses.length
      ? turn.responses.map((response) => response.text).join('\n\n')
      : turn.pending ? 'Response pending.' : 'No response recorded.';
    return `${number} · You\n${turn.prompt.text}\n\n${number} · ${responseLabel}\n${answer}`;
  }).join('\n\n');
}

export function sessionHistoryCountLabel(turns) {
  const list = Array.isArray(turns) ? turns : [];
  const messages = list.reduce((total, turn) => total + turn.responses.length, 0);
  return `${list.length} turn${list.length === 1 ? '' : 's'} · ${messages} message${messages === 1 ? '' : 's'}`;
}

export function sessionStateLabel(stateKey) {
  const entry = SESSION_STATE_LABELS[stateKey] || UNKNOWN_SESSION_STATE;
  return { label: entry.label, hint: entry.hint };
}
