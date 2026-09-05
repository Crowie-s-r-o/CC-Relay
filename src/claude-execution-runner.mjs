import { spawn } from 'node:child_process';
import { readFileSync as fsReadFileSync, readdirSync as fsReaddirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { providerCommandInvocation, terminateChildProcess } from './claude-binary.mjs';
import { ClaudeTerminalExecutor } from './claude-terminal-executor.mjs';
import { injectionPromptIssue, resolveClaudeTranscriptPath } from './claude-transcript-tail.mjs';
import { normalizeClaudeModel } from './model-catalog.mjs';
import { withRelayNonInteractiveInstruction } from './relay-prompt.mjs';
import {
  addTokenUsage,
  normalizeTokenUsage,
  providerTokenUsageEvent,
  tokenUsageMessage,
} from './token-usage.mjs';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class ClaudeExecutionError extends Error {
  constructor(message, {
    cancelled = false,
    deliveryUncertain = false,
    exitCode = null,
    missingConversation = false,
    missingConversationSessionId = null,
    sessionInUseSessionId = null,
    retryable = true,
  } = {}) {
    super(message);
    this.name = 'ClaudeExecutionError';
    this.cancelled = cancelled;
    this.deliveryUncertain = deliveryUncertain;
    this.exitCode = exitCode;
    this.missingConversation = missingConversation;
    this.missingConversationSessionId = missingConversationSessionId;
    this.sessionInUseSessionId = sessionInUseSessionId;
    this.retryable = retryable;
  }
}

const MISSING_CONVERSATION = /No conversation found with session ID:\s*([^\s]+)/i;
const SESSION_ID_IN_USE = /Session ID\s+([^\s]+)\s+is already in use/i;
const CLAUDE_BACKGROUND_TERMINATION_PATTERN = /background tasks? still running[^\n]*terminating/i;
const CLAUDE_API_ERROR_RESPONSE = /^API\s+Error\s*:/i;

// Claude's interactive terminal can finish an overloaded or otherwise failed provider request
// with an exit-zero turn whose only final assistant text starts with `API Error:`. That text is a
// provider failure, not a task result. Match only the effective final response at its beginning so
// a successful report that merely discusses an API error is not poisoned by historical wording.
export function claudeApiErrorResponse(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return CLAUDE_API_ERROR_RESPONSE.test(text) ? text : null;
}

export const CLAUDE_PRINT_BACKGROUND_WAIT_ENV = 'CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS';

// The August 3, 2026 incident proved that Claude print mode otherwise exits successfully after
// terminating background agents at its default wait ceiling. Zero tells Claude to wait without a
// ceiling. Keep an operator-supplied nonblank value so CC Relay never overrides an explicit limit.
export function claudePrintEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  if (
    typeof env[CLAUDE_PRINT_BACKGROUND_WAIT_ENV] !== 'string'
    || !env[CLAUDE_PRINT_BACKGROUND_WAIT_ENV].trim()
  ) {
    env[CLAUDE_PRINT_BACKGROUND_WAIT_ENV] = '0';
  }
  return env;
}

// Windows file paths are case-insensitive, and `claude agents --json` reports whatever case the
// shell recorded, so a session started in `c:\work\app` must still match a task stored as
// `C:\work\app`. Comparing the resolved strings verbatim there rejects a legitimate terminal as
// a different workspace. POSIX keeps the exact byte comparison, where case is significant.
export function sameWorkspacePath(left, right, platform = process.platform) {
  const first = resolve(left);
  const second = resolve(right);
  return platform === 'win32'
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}

function missingConversationSessionId(value) {
  return String(value || '').match(MISSING_CONVERSATION)?.[1]?.trim() || null;
}

function sessionIdInUse(value) {
  return String(value || '').match(SESSION_ID_IN_USE)?.[1]?.trim() || null;
}

function resultText(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content.map((item) => {
    if (typeof item === 'string') {
      return item;
    }
    return item?.text || item?.content || '';
  }).filter(Boolean).join('\n');
}

// Claude Code spawns a sub-agent through its own `Agent` tool. CC Relay keeps the mcpToolCall
// envelope so every existing consumer (grouping, copy log, stored events from older tasks)
// still works, and adds flat sub-agent metadata the console uses for a dedicated signal.
const AGENT_TOOL_NAME = 'Agent';

// A backgrounded launch returns immediately while the agent keeps working. The interactive
// transcript records the launch metadata as a sibling `toolUseResult` object; the headless
// stream-json path only carries the tool_result text, so both markers are honoured.
// Both phrases are Claude's own launch text, matched in full so a sub-agent report that
// merely mentions background work is never mistaken for an async launch.
const ASYNC_LAUNCH_TEXT = /async agent launched|the agent is working in the background/i;
const ASYNC_AGENT_ID = /agentid:\s*([A-Za-z0-9_-]+)/i;

function trimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

const CLAUDE_TOKEN_USAGE_FIELDS = [
  'inputTokens',
  'input_tokens',
  'outputTokens',
  'output_tokens',
  'reasoningTokens',
  'reasoning_tokens',
  'cacheReadTokens',
  'cache_read_input_tokens',
  'cacheWriteTokens',
  'cache_creation_input_tokens',
  'totalTokens',
  'total_tokens',
];

function reportedClaudeTokenUsage(value) {
  const reported = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  if (!reported) return null;
  const usage = reported.usage && typeof reported.usage === 'object' && !Array.isArray(reported.usage)
    ? reported.usage
    : reported;
  const total = Number(reported.totalTokens ?? reported.total_tokens);
  const hasTotal = Number.isFinite(total) && total >= 0;
  const hasUsage = CLAUDE_TOKEN_USAGE_FIELDS.some((field) => Object.hasOwn(usage, field));
  if (!hasTotal && !hasUsage) return null;
  return normalizeTokenUsage({
    ...usage,
    ...(hasTotal ? { totalTokens: total } : {}),
  });
}

export function claudeTranscriptTokenUsage(transcript, { startedAt = null } = {}) {
  const startedAtMs = new Date(startedAt || 0).getTime();
  const usageByMessage = new Map();
  for (const [index, line] of String(transcript || '').split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const usage = record?.type === 'assistant' ? record.message?.usage : null;
    if (!usage || typeof usage !== 'object') continue;
    if (Number.isFinite(startedAtMs) && startedAtMs > 0) {
      const recordTimestamp = new Date(record.timestamp || 0).getTime();
      if (!Number.isFinite(recordTimestamp) || recordTimestamp < startedAtMs) continue;
    }
    const key = String(record.message?.id || record.uuid || `record-${index}`);
    usageByMessage.set(key, normalizeTokenUsage(usage));
  }
  let cumulative = normalizeTokenUsage({});
  for (const usage of usageByMessage.values()) {
    cumulative = addTokenUsage(cumulative, usage);
  }
  return cumulative;
}

function maximumClaudeTokenUsage(...values) {
  const normalized = values.filter(Boolean).map((value) => normalizeTokenUsage(value));
  if (normalized.length === 0) return null;
  const maximum = (field) => Math.max(...normalized.map((usage) => usage[field]));
  const usage = {
    inputTokens: maximum('inputTokens'),
    outputTokens: maximum('outputTokens'),
    reasoningTokens: maximum('reasoningTokens'),
    cacheReadTokens: maximum('cacheReadTokens'),
    cacheWriteTokens: maximum('cacheWriteTokens'),
    totalTokens: maximum('totalTokens'),
  };
  const measuredTotal = usage.inputTokens
    + usage.outputTokens
    + usage.reasoningTokens
    + usage.cacheReadTokens
    + usage.cacheWriteTokens;
  usage.totalTokens = Math.max(usage.totalTokens, measuredTotal);
  return usage;
}

function readClaudeSubAgentTokenUsage(context, agentId) {
  const normalizedAgentId = trimmedString(agentId);
  if (!/^[A-Za-z0-9_-]+$/u.test(normalizedAgentId)) return null;
  if (typeof context.readSubAgentTokenUsage === 'function') {
    try {
      return reportedClaudeTokenUsage(context.readSubAgentTokenUsage(normalizedAgentId));
    } catch {
      return null;
    }
  }
  const mainTranscriptPath = trimmedString(context.transcriptPath)
    || resolveClaudeTranscriptPath(context.cwd, context.sessionId);
  if (!mainTranscriptPath.endsWith('.jsonl')) return null;
  const subAgentPath = join(
    mainTranscriptPath.slice(0, -'.jsonl'.length),
    'subagents',
    `agent-${normalizedAgentId}.jsonl`,
  );
  try {
    const usage = claudeTranscriptTokenUsage(fsReadFileSync(subAgentPath, 'utf8'), {
      startedAt: context.tokenUsageAttemptStartedAt,
    });
    return usage.totalTokens > 0 ? usage : null;
  } catch {
    return null;
  }
}

function claudeTokenUsageMap(context, key) {
  if (!(context[key] instanceof Map)) context[key] = new Map();
  return context[key];
}

function cumulativeClaudeTokenUsage(context) {
  let cumulative = normalizeTokenUsage({});
  for (const usage of claudeTokenUsageMap(context, 'tokenUsageByMessage').values()) {
    cumulative = addTokenUsage(cumulative, usage);
  }
  for (const usage of claudeTokenUsageMap(context, 'subAgentTokenUsageByObservation').values()) {
    cumulative = addTokenUsage(cumulative, usage);
  }
  return cumulative;
}

function claudeTokenUsageEmission(context) {
  const event = providerTokenUsageEvent('claude', cumulativeClaudeTokenUsage(context));
  return { event, message: tokenUsageMessage('claude', event.usage) };
}

function recordClaudeSubAgentUsage(context, { agentId, toolUseId, reported }) {
  const transcriptUsage = readClaudeSubAgentTokenUsage(context, agentId);
  const usage = maximumClaudeTokenUsage(
    transcriptUsage,
    reportedClaudeTokenUsage(reported),
  );
  const key = transcriptUsage && agentId
    ? `agent:${agentId}`
    : `run:${toolUseId || agentId || ''}`;
  if (!usage || key === 'run:') return null;
  const usageByObservation = claudeTokenUsageMap(context, 'subAgentTokenUsageByObservation');
  const previous = usageByObservation.get(key);
  usageByObservation.set(key, maximumClaudeTokenUsage(previous, usage));
  return claudeTokenUsageEmission(context);
}

function subAgentLaunchOutcome(record, block) {
  const reported = record?.toolUseResult;
  // The transcript record states the launch outcome directly, so it settles the question.
  // Falling through to the text heuristic here would let a synchronous sub-agent whose own
  // report quotes Claude's stock launch phrase be filed as a live background agent, which
  // then never resolves. The heuristic below only serves records that carry no such object,
  // which is the headless stream-json path.
  if (reported && typeof reported === 'object') {
    return {
      backgrounded: reported.isAsync === true || trimmedString(reported.status) === 'async_launched',
      agentId: trimmedString(reported.agentId),
    };
  }
  const text = resultText(block?.content);
  if (ASYNC_LAUNCH_TEXT.test(text)) {
    return { backgrounded: true, agentId: text.match(ASYNC_AGENT_ID)?.[1] || '' };
  }
  return { backgrounded: false, agentId: '' };
}

// Claude's own task board is the closest thing it reports to a Codex plan. It arrives as a
// stream of partial tool calls, so CC Relay folds them into one plan event per mutation rather
// than leaving a row of loud generic tool calls that never say what the task is working through.
const PLAN_TOOL_NAMES = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TodoWrite']);

// Reads keep their quiet row but never move the folded board.
const PLAN_READ_TOOL_NAMES = new Set(['TaskList', 'TaskGet']);

const PLAN_STATUSES = new Map([
  ['pending', 'pending'],
  ['in_progress', 'inProgress'],
  ['completed', 'completed'],
]);

const PLAN_DELETED_STATUS = 'deleted';

// Claude confirms a new task in prose. The headless stream-json path carries only this text.
const TASK_CREATED_ID = /task\s+#(\d+)\s+created successfully/i;

// A board tool can fail without setting `is_error`: the August 12 team transcript recorded
// `TaskUpdate` answering `{"success":false,"error":"Task not found"}` as an ordinary result.
// Folding that as a mutation would report a step the board never actually moved.
const PLAN_TOOL_ERROR_TEXT = /^\s*(?:task not found|error\b)/i;

function planObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// Provider payloads are untrusted, so a field only counts as sent when the record owns it.
function planFieldPresent(input, name) {
  return Object.prototype.hasOwnProperty.call(input, name);
}

function planIdString(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function planStatus(value) {
  return PLAN_STATUSES.get(typeof value === 'string' ? value.trim() : '') || 'pending';
}

function planStatusDeleted(value) {
  return (typeof value === 'string' ? value.trim() : '') === PLAN_DELETED_STATUS;
}

// What this turn watched happen. It is never replaced by another board source, because it is
// the only record of the ids this turn created and the only thing left to publish when the
// mirrored directory below stops being readable partway through a turn.
function planBoard(context) {
  if (!(context.planBoard instanceof Map)) {
    context.planBoard = new Map();
  }
  return context.planBoard;
}

// Every id a successful mirror read has shown this turn. A task the mirror once carried and no
// longer carries was removed by Claude, so the fold must not put it back; a task the mirror has
// never carried is either newer than the last read or was never mirrored, so it survives.
function planDirectorySeen(context) {
  if (!(context.planDirectorySeen instanceof Set)) {
    context.planDirectorySeen = new Set();
  }
  return context.planDirectorySeen;
}

// The transcript record states the outcome structurally, so it settles the question. The text
// literal below only serves the headless stream-json path, which carries no result object.
function planToolFailed(block, record) {
  if (block?.is_error === true) {
    return true;
  }
  const reported = record?.toolUseResult;
  if (reported && typeof reported === 'object' && !Array.isArray(reported)) {
    return reported.success === false || Boolean(trimmedString(reported.error));
  }
  return PLAN_TOOL_ERROR_TEXT.test(resultText(block?.content));
}

function createdTaskId(block, record, toolUseId) {
  const structural = planIdString(planObject(record?.toolUseResult).task?.id);
  if (structural) {
    return structural;
  }
  const parsed = resultText(block?.content).match(TASK_CREATED_ID)?.[1] || '';
  // A deterministic synthetic id keeps the step visible, and keeps it stable if the same tool
  // use is folded twice, when neither the record nor the text names the real one.
  return parsed || `tool-${trimmedString(toolUseId) || 'unknown'}`;
}

// Returns the id the new step was filed under, which is never empty, so the caller can both
// treat it as the mutation flag and read the number Claude issued.
function planCreate(board, input, block, record, toolUseId) {
  const id = createdTaskId(block, record, toolUseId);
  const activeForm = trimmedString(input.activeForm);
  board.set(id, {
    step: trimmedString(input.subject)
      || trimmedString(planObject(record?.toolUseResult).task?.subject)
      || activeForm
      || `Task ${id}`,
    status: planStatus(input.status),
    owner: trimmedString(input.owner),
    activeForm,
  });
  return id;
}

// The task an update names, whether the arguments or the result carry it. An update that names
// no task at all is malformed rather than evidence of a step this turn cannot see.
function planUpdateTargetId(input, record) {
  return planIdString(input.taskId) || planIdString(planObject(record?.toolUseResult).taskId);
}

// `TaskUpdate` sends only the fields that changed, so everything it omits has to survive.
function planUpdate(board, input, record) {
  const id = planUpdateTargetId(input, record);
  if (!id) {
    return false;
  }
  // `deleted` removes the task, so it is read before the normalizer below folds every
  // unrecognized status into `pending`.
  if (planFieldPresent(input, 'status') && planStatusDeleted(input.status)) {
    return board.delete(id);
  }
  const existing = board.get(id);
  // An update for a task this turn never watched being created belongs to an older board.
  // Inventing a row here would show a step with no readable subject.
  if (!existing) {
    return false;
  }
  const next = { ...existing };
  if (planFieldPresent(input, 'subject')) {
    next.step = trimmedString(input.subject) || next.step;
  }
  if (planFieldPresent(input, 'activeForm')) {
    next.activeForm = trimmedString(input.activeForm);
  }
  if (planFieldPresent(input, 'owner')) {
    next.owner = trimmedString(input.owner);
  }
  if (planFieldPresent(input, 'status')) {
    next.status = planStatus(input.status);
  }
  board.set(id, next);
  return true;
}

// Older Claude builds report the whole list on every `TodoWrite`, so the board is replaced
// outright. Claude Code 2.1.228 uses the task board above instead.
function planReplaceTodos(board, input) {
  const todos = Array.isArray(input.todos) ? input.todos : [];
  board.clear();
  todos.forEach((value, index) => {
    const todo = planObject(value);
    if (planStatusDeleted(todo.status)) {
      return;
    }
    const activeForm = trimmedString(todo.activeForm);
    board.set(`todo-${index + 1}`, {
      step: trimmedString(todo.content) || activeForm || `Step ${index + 1}`,
      status: planStatus(todo.status),
      owner: trimmedString(todo.owner),
      activeForm,
    });
  });
  return true;
}

// Claude numbers its tasks, so a numeric board reads in task order. Any other id keeps the
// order CC Relay first saw the step in.
function planEntries(board) {
  const ids = [...board.keys()];
  const numeric = ids.length > 0 && ids.every((id) => /^\d+$/.test(id));
  const ordered = numeric ? [...ids].sort((left, right) => Number(left) - Number(right)) : ids;
  return ordered.map((id) => board.get(id));
}

// Claude mirrors its board to ~/.claude/tasks/<sessionId>/<n>.json, one file per task, beside
// the `.lock` and `.highwatermark` bookkeeping dotfiles. That directory is the whole board, so
// it answers the question the transcript fold cannot: a continuation turn sees only the calls
// it watched, while the operator is looking at every step the conversation ever created.
const PLAN_DIRECTORY_NAME = 'tasks';

// A session id becomes a path component here, so only an id that cannot escape the directory is
// used. A leading dot is refused too, which rejects `.` and `..` outright.
const PLAN_SESSION_ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// An explicit refusal, not a silent truncation: past this many task files CC Relay treats the
// directory as unusable and falls back to the fold rather than presenting a cut-off board as
// the whole plan. Real boards run to tens of tasks.
const PLAN_DIRECTORY_FILE_LIMIT = 500;

// Injected wholesale by tests. Both context literals that reach this code are built by callers
// that never pass one, so the real fs stays the default.
function planBoardIO(context) {
  const io = planObject(context?.planBoardIO);
  return {
    home: trimmedString(io.home) || homedir(),
    readdirSync: typeof io.readdirSync === 'function' ? io.readdirSync : fsReaddirSync,
    readFileSync: typeof io.readFileSync === 'function' ? io.readFileSync : fsReadFileSync,
  };
}

// One mirrored task file. Everything here is untrusted data read off disk, so every field is
// coerced and a record that names no task at all is dropped rather than shown as a blank step.
// A file whose JSON is not an object is not a task record at all: reading `null`, an array, a
// string, or a number as one invented a `Task N` step with no readable subject and inflated the
// step count, so it is dropped exactly like a file that could not be read.
function planDirectoryEntry(record, fileName) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return null;
  }
  const task = planObject(record);
  const id = planIdString(task.id) || fileName.replace(/\.json$/i, '');
  if (!id || planStatusDeleted(task.status)) {
    return null;
  }
  const activeForm = trimmedString(task.activeForm);
  return [id, {
    step: trimmedString(task.subject) || activeForm || `Task ${id}`,
    status: planStatus(task.status),
    owner: trimmedString(task.owner),
    activeForm,
  }];
}

// Reads the authoritative board for this session. Returns null, never a partial or empty board,
// whenever the directory cannot stand in for the fold: no usable session id, an unreadable or
// absent directory (older Claude builds, a sandbox with no access), or a directory that was
// cleared after the session ended. A board wiped from disk must degrade to the transcript fold
// instead of reporting that the operator's plan is now empty.
function readPlanDirectoryBoard(context) {
  const sessionId = trimmedString(context?.sessionId);
  if (!sessionId || !PLAN_SESSION_ID_SHAPE.test(sessionId)) {
    return null;
  }
  const io = planBoardIO(context);
  const directory = join(io.home, '.claude', PLAN_DIRECTORY_NAME, sessionId);
  let names = null;
  try {
    names = io.readdirSync(directory);
  } catch {
    return null;
  }
  if (!Array.isArray(names)) {
    return null;
  }
  // Dotfiles are Claude's own bookkeeping. `.highwatermark` counts ids ever issued, not steps
  // that still exist, so it is never read: a cleared board legitimately reports 4 there with no
  // task left on disk. Sorting the names keeps a non-numeric board in one order on every
  // platform, since readdir order is not guaranteed.
  const files = names
    .filter((name) => typeof name === 'string' && name.trim() && !name.trim().startsWith('.'))
    .map((name) => name.trim())
    .sort();
  if (files.length === 0 || files.length > PLAN_DIRECTORY_FILE_LIMIT) {
    return null;
  }
  const board = new Map();
  for (const fileName of files) {
    let record = null;
    try {
      record = JSON.parse(io.readFileSync(join(directory, fileName), 'utf8'));
    } catch {
      // An unreadable or malformed file is one missing step, not a failed turn.
      continue;
    }
    const entry = planDirectoryEntry(record, fileName);
    if (entry && !board.has(entry[0])) {
      board.set(entry[0], entry[1]);
    }
  }
  return board.size > 0 ? board : null;
}

// A `TaskList` result carries the full authoritative board, so it repairs a fold that never
// watched these ids being created. It stays a read: it reconciles what the next mutation will
// report and emits nothing itself, because a read must never be shown as a board movement.
// Reports whether the fold now holds a whole board.
//
// The shipped `TaskList` takes no parameters, so its result is always the entire board and
// clearing the fold against it is what correctly drops the tasks Claude has removed. A build
// that grows a filter would answer a subset, and clearing against a subset would erase real
// steps, so any argument at all makes this read decline to reconcile rather than guess.
function planReconcileList(board, input, record) {
  const tasks = planObject(record?.toolUseResult).tasks;
  if (!Array.isArray(tasks) || Object.keys(input).length > 0) {
    return false;
  }
  const next = new Map();
  for (const value of tasks) {
    const task = planObject(value);
    const id = planIdString(task.id);
    if (!id || next.has(id) || planStatusDeleted(task.status)) {
      continue;
    }
    // The list reports id, subject, and status. Whatever it omits survives from the fold, so a
    // reconcile never erases the `activeForm` that explains the running step.
    const existing = board.get(id);
    const activeForm = trimmedString(task.activeForm) || trimmedString(existing?.activeForm);
    next.set(id, {
      step: trimmedString(task.subject) || trimmedString(existing?.step) || activeForm || `Task ${id}`,
      status: planStatus(task.status),
      owner: trimmedString(task.owner) || trimmedString(existing?.owner),
      activeForm,
    });
  }
  if (next.size === 0) {
    return false;
  }
  board.clear();
  for (const [id, entry] of next) {
    board.set(id, entry);
  }
  return true;
}

// The two boards answer different questions, so neither one replaces the other. The mirror is
// authoritative for what the board contains and for what each mirrored step says; the fold is
// the only source for a step this turn created that the mirror has not written yet, and the
// only source at all once the mirror stops being readable.
function planMergedEntry(mirrored, own) {
  if (!own) {
    return mirrored;
  }
  return {
    step: mirrored.step,
    status: mirrored.status,
    owner: mirrored.owner,
    // `activeForm` explains the running step and is never rendered as a plan step, so keeping
    // the one this turn watched arrive costs no board content and only ever adds the sentence.
    activeForm: mirrored.activeForm || own.activeForm,
  };
}

// The board this call publishes. With no readable mirror that is the fold alone, which is what
// keeps a turn reporting after a board is cleared from disk mid-turn.
function planPublishedBoard(context, mirror) {
  const board = planBoard(context);
  if (!mirror) {
    return board;
  }
  const seen = planDirectorySeen(context);
  const composed = new Map();
  for (const [id, mirrored] of mirror) {
    composed.set(id, planMergedEntry(mirrored, board.get(id)));
  }
  for (const [id, own] of board) {
    // A step the mirror has never shown is this turn's own and has not been mirrored yet, so it
    // stays visible rather than vanishing for one event and reappearing on the next read.
    if (!composed.has(id) && !seen.has(id)) {
      composed.set(id, own);
    }
  }
  for (const id of mirror.keys()) {
    seen.add(id);
  }
  return composed;
}

// One board keeps one renderer row for the life of the turn. The session id is the identity
// everywhere else and is constant across the turns of a conversation, so it leads; the task
// fallback only serves a context that never learned one.
function planKey(context) {
  const frozen = trimmedString(context?.planKey);
  if (frozen) {
    return frozen;
  }
  const taskId = planIdString(context?.taskId);
  const key = trimmedString(context?.sessionId) || (taskId ? `task-${taskId}` : 'claude-plan');
  if (context && typeof context === 'object') {
    context.planKey = key;
  }
  return key;
}

// Folds one completed board tool call into the turn's plan. Returns the single event for that
// mutation, or null when the call read the board, failed, or changed nothing worth reporting.
function foldPlanToolCall(context, item, block, record) {
  const name = trimmedString(item?.planToolName);
  if (!PLAN_TOOL_NAMES.has(name)) {
    return null;
  }
  // First, and before any board source is consulted: a call the CLI refused must leave the
  // board exactly where it was. A real `TaskUpdate` rejection answers `{"success":false}` as an
  // ordinary result, with no `is_error` flag to catch it.
  if (planToolFailed(block, record)) {
    return null;
  }
  const board = planBoard(context);
  const input = planObject(item.arguments);
  if (PLAN_READ_TOOL_NAMES.has(name)) {
    if (name === 'TaskList' && planReconcileList(board, input, record)) {
      // The list is the entire board, so the fold it just rewrote is the entire board too.
      context.planFoldWhole = true;
    }
    return null;
  }
  let mutated = false;
  if (name === 'TaskCreate') {
    const wasEmpty = board.size === 0;
    const created = planCreate(board, input, block, record, item.id);
    mutated = Boolean(created);
    // Claude numbers a session's tasks from 1 and `.highwatermark` never goes back, so a turn
    // whose first board call creates task 1 watched this board come into existence: its fold is
    // the whole board even with no other source. A first create numbered anything else resumed
    // a board that already had steps on it, and the fold alone can never be the whole plan.
    if (mutated && wasEmpty && created === '1' && context.planFoldWhole !== false) {
      context.planFoldWhole = true;
    }
  } else if (name === 'TaskUpdate') {
    mutated = planUpdate(board, input, record);
    if (!mutated && planUpdateTargetId(input, record)) {
      // The update named a real task this turn never watched being created, so Claude's board
      // holds steps the fold cannot name. Anything the fold publishes alone from here is known
      // to be missing steps.
      context.planFoldWhole = false;
    }
  } else if (name === 'TodoWrite') {
    mutated = planReplaceTodos(board, input);
    // An older build's `TodoWrite` publishes the whole board in one call, so it is a complete
    // board by construction, and the task directory does not mirror it: those builds write no
    // task files at all, and a directory left over from a newer build describes a different
    // board entirely. The mirror is dropped for the rest of the turn rather than allowed to
    // discard the todos this call just published.
    context.planTodoBoard = true;
    context.planFoldWhole = true;
  }
  // The mirrored directory is Claude's own copy of the whole board and already reflects the
  // call that just completed, so it decides what the board contains. It never replaces the
  // fold: the ids this turn created are the only thing left to publish once the directory stops
  // being readable, which is why the mutation above still runs first and stays.
  const mirror = context.planTodoBoard ? null : readPlanDirectoryBoard(context);
  if (!mirror && !mutated) {
    return null;
  }
  const entries = planEntries(planPublishedBoard(context, mirror));
  const plan = entries.map((entry) => ({
    step: entry.step,
    status: entry.status,
    owner: entry.owner,
  }));
  const explanation = entries.find(
    (entry) => entry.status === 'inProgress' && entry.activeForm,
  )?.activeForm || '';
  // A mirrored board is the whole board. Without one, only a fold that watched the board from
  // its first task, or one a `TaskList` or `TodoWrite` has since republished whole, can say the
  // same. Everything else is this turn's own steps and no more: still worth reporting, since
  // the alternative is a row frozen on a stale board, but the renderer folds one plan key into
  // one row and has to be told before it replaces a whole plan with part of one.
  const partial = !mirror && context.planFoldWhole !== true;
  // An owner-only edit still changes what the console shows, so the whole rendered payload
  // decides whether this is news. The signature is recorded even for an emptied board so a
  // later repopulation still reports.
  const signature = JSON.stringify([explanation, plan, partial]);
  if (context.planSignature === signature) {
    return null;
  }
  context.planSignature = signature;
  if (plan.length === 0) {
    return null;
  }
  const done = plan.filter((entry) => entry.status === 'completed').length;
  return {
    event: {
      type: 'claude/plan',
      provider: 'claude',
      planKey: planKey(context),
      explanation,
      plan,
      // Purely additive and only ever present when true, so every consumer of the four fields
      // above keeps working unchanged.
      ...(partial ? { partial: true } : {}),
    },
    message: `Claude updated its plan (${done}/${plan.length} steps done).`,
  };
}

function toolItem(block, cwd) {
  const input = block.input || {};
  if (block.name === AGENT_TOOL_NAME) {
    return {
      type: 'mcpToolCall',
      id: block.id,
      server: 'Claude Code',
      tool: AGENT_TOOL_NAME,
      arguments: input,
      status: 'inProgress',
      result: null,
      subAgent: true,
      toolUseId: block.id,
      agentName: trimmedString(input.description),
      agentType: trimmedString(input.subagent_type),
    };
  }
  if (block.name === 'Bash') {
    return {
      type: 'commandExecution',
      id: block.id,
      command: input.command || 'Claude Bash command',
      cwd,
      status: 'inProgress',
      aggregatedOutput: null,
      exitCode: null,
    };
  }
  if (['Edit', 'Write', 'NotebookEdit'].includes(block.name)) {
    const path = input.file_path || input.notebook_path || 'workspace file';
    return {
      type: 'fileChange',
      id: block.id,
      changes: [{
        path,
        kind: { type: block.name === 'Write' ? 'create' : 'update' },
      }],
      status: 'inProgress',
    };
  }
  const item = {
    type: 'mcpToolCall',
    id: block.id,
    server: 'Claude Code',
    tool: block.name || 'tool',
    arguments: input,
    status: 'inProgress',
    result: null,
  };
  if (PLAN_TOOL_NAMES.has(block.name)) {
    // The envelope stays exactly what grouping, the copy log, and stored events from older
    // tasks expect. The flat marker exists so the renderer can treat board bookkeeping quietly
    // rather than as another generic tool call, and the console's plan presentation is what
    // consumes it. Stored events from older tasks carry no marker, so every consumer has to
    // keep reading an unmarked board tool call as an ordinary one.
    item.planTool = true;
    item.planToolName = block.name;
  }
  return item;
}

const CLAUDE_EXACT_PATCH_MAX_BYTES = 2 * 1024 * 1024;
const CLAUDE_EXACT_PATCH_MAX_LINES = 5000;
const CLAUDE_EXACT_PATCH_MAX_HUNKS = 5000;
const RELAY_HOOK_TRUNCATION = /\n?\[CC Relay truncated \d+ (?:characters|array items)\]$/;

function recordedClaudeString(value) {
  const text = String(value ?? '');
  const match = text.match(RELAY_HOOK_TRUNCATION);
  return {
    text: match ? text.slice(0, match.index) : text,
    truncated: Boolean(match),
  };
}

function recordedClaudeCoordinate(value) {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) && coordinate >= 0 ? Math.trunc(coordinate) : 0;
}

function recordedClaudeHunks(value) {
  if (!Array.isArray(value)) return { hunks: [], truncated: false };
  const hunks = [];
  let linesRecorded = 0;
  let bytesRecorded = 0;
  let truncated = false;
  for (const candidate of value) {
    if (hunks.length >= CLAUDE_EXACT_PATCH_MAX_HUNKS) {
      truncated = true;
      break;
    }
    if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.lines)) {
      if (typeof candidate === 'string' && RELAY_HOOK_TRUNCATION.test(candidate)) truncated = true;
      continue;
    }
    if (candidate.__relayTruncated) truncated = true;
    const lines = [];
    for (const line of candidate.lines) {
      if (typeof line !== 'string') continue;
      const recorded = recordedClaudeString(line);
      if (recorded.truncated) truncated = true;
      if (!recorded.text && recorded.truncated) continue;
      const bytes = Buffer.byteLength(recorded.text, 'utf8');
      if (
        linesRecorded >= CLAUDE_EXACT_PATCH_MAX_LINES
        || bytesRecorded + bytes > CLAUDE_EXACT_PATCH_MAX_BYTES
      ) {
        truncated = true;
        continue;
      }
      lines.push(recorded.text);
      linesRecorded += 1;
      bytesRecorded += bytes;
    }
    hunks.push({
      oldStart: recordedClaudeCoordinate(candidate.oldStart),
      oldLines: recordedClaudeCoordinate(candidate.oldLines),
      newStart: recordedClaudeCoordinate(candidate.newStart),
      newLines: recordedClaudeCoordinate(candidate.newLines),
      lines,
    });
  }
  return { hunks, truncated };
}

function completedClaudeFileChange(item, record) {
  const reported = record?.toolUseResult;
  if (!reported || typeof reported !== 'object' || Array.isArray(reported)) return item;
  const original = item.changes?.[0] || {};
  const path = typeof reported.filePath === 'string' && reported.filePath.trim()
    ? reported.filePath
    : original.path;
  const reportedType = reported.type === 'create' || reported.type === 'update'
    ? reported.type
    : null;
  const originalType = original.kind?.type === 'create' || original.kind?.type === 'update'
    ? original.kind.type
    : 'update';
  const effectiveType = reportedType || originalType;
  const change = {
    ...original,
    path,
    kind: { type: effectiveType },
  };
  const structured = recordedClaudeHunks(reported.structuredPatch);
  if (structured.hunks.length > 0) {
    change.hunks = structured.hunks;
    if (structured.truncated) change.exactTruncated = true;
  } else if (effectiveType === 'create' && typeof reported.content === 'string') {
    const recorded = recordedClaudeString(reported.content);
    if (Buffer.byteLength(recorded.text, 'utf8') <= CLAUDE_EXACT_PATCH_MAX_BYTES) {
      change.content = recorded.text;
      if (recorded.truncated) change.exactTruncated = true;
    } else {
      change.exactTooLarge = true;
    }
  }
  return { ...item, changes: [change] };
}

function completedToolItem(item, block, record = null) {
  const text = resultText(block.content);
  const failed = Boolean(block.is_error);
  if (item.type === 'commandExecution') {
    return {
      ...item,
      status: failed ? 'failed' : 'completed',
      aggregatedOutput: text,
      exitCode: failed ? 1 : 0,
    };
  }
  if (item.type === 'fileChange') {
    return {
      ...completedClaudeFileChange(item, record),
      status: failed ? 'failed' : 'completed',
      result: text,
    };
  }
  const completed = {
    ...item,
    status: failed ? 'failed' : 'completed',
    result: { content: text ? [{ type: 'text', text }] : [] },
  };
  if (item.subAgent && !failed) {
    // The tool call completing does not mean the sub-agent finished: a backgrounded launch
    // stays live until its task notification arrives.
    const outcome = subAgentLaunchOutcome(record, block);
    completed.backgrounded = outcome.backgrounded;
    if (outcome.agentId) {
      completed.agentId = outcome.agentId;
    }
  }
  return completed;
}

// Reads a Claude `<task-notification>` payload, the record that reports a backgrounded
// sub-agent finishing. Returns null for any other queue-operation content (agent messages,
// plain queue bookkeeping) so unrelated records stay invisible.
export function parseAgentTaskNotification(content) {
  const text = typeof content === 'string' ? content : '';
  if (!text.includes('<task-notification>')) {
    return null;
  }
  const body = text.match(/<task-notification>([\s\S]*?)<\/task-notification>/)?.[1] || '';
  if (!body) {
    return null;
  }
  const field = (name) => body.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim() || '';
  const toolUseId = field('tool-use-id');
  const agentId = field('task-id');
  if (!toolUseId && !agentId) {
    return null;
  }
  const summary = field('summary');
  const reportedTokens = field('subagent_tokens') || field('total_tokens');
  const numericTokens = Number(reportedTokens);
  return {
    toolUseId,
    agentId,
    status: field('status') || 'completed',
    summary,
    totalTokens: reportedTokens && Number.isFinite(numericTokens) && numericTokens >= 0
      ? Math.round(numericTokens)
      : null,
    // Summaries read `Agent "<name>" finished`, so the name survives even when the
    // notification arrives before (or without) the launch record it belongs to.
    agentName: summary.match(/Agent\s+"([^"]*)"/)?.[1]?.trim() || '',
  };
}

function subAgentLabel(item) {
  const name = trimmedString(item?.agentName);
  if (name) {
    return `"${name}"`;
  }
  return trimmedString(item?.agentType) || trimmedString(item?.toolUseId) || 'agent';
}

function subAgentCompletionMessage(item) {
  if (!item?.subAgent) {
    return '';
  }
  if (item.status === 'failed') {
    return `Claude could not start sub-agent ${subAgentLabel(item)}.`;
  }
  return item.backgrounded
    ? `Sub-agent ${subAgentLabel(item)} is working in the background.`
    : `Sub-agent ${subAgentLabel(item)} finished.`;
}

// Claude writes the same task notification twice, once when it enqueues the notification and
// once when it removes it. Both records carry identical content, so the turn context remembers
// what it already reported and the console shows one finish per sub-agent run.
function firstNotificationSighting(context, notification, content) {
  if (!context.agentNotifications) {
    context.agentNotifications = new Set();
  }
  const key = `${notification.agentId}|${notification.toolUseId}|${notification.status}|${String(content || '').length}`;
  if (context.agentNotifications.has(key)) {
    return false;
  }
  context.agentNotifications.add(key);
  return true;
}

function pendingBackgroundAgentCount(message) {
  if (Number.isFinite(message?.pendingBackgroundAgentCount)) {
    return message.pendingBackgroundAgentCount;
  }
  const pending = [];
  const seen = new Set([message]);
  for (const value of Object.values(message || {})) {
    if (value && typeof value === 'object') pending.push(value);
  }
  while (pending.length > 0) {
    const container = pending.shift();
    if (!container || typeof container !== 'object' || seen.has(container)) continue;
    seen.add(container);
    if (Number.isFinite(container.pendingBackgroundAgentCount)) {
      return container.pendingBackgroundAgentCount;
    }
    for (const value of Object.values(container)) {
      if (value && typeof value === 'object') pending.push(value);
    }
  }
  return null;
}

function liveSubAgentMap(context) {
  if (!(context.liveSubAgents instanceof Map)) {
    context.liveSubAgents = new Map();
  }
  return context.liveSubAgents;
}

function finishedSubAgentToolUseIds(context) {
  if (!(context.finishedSubAgentToolUseIds instanceof Set)) {
    context.finishedSubAgentToolUseIds = new Set();
  }
  return context.finishedSubAgentToolUseIds;
}

export function liveSubAgents(context) {
  return context?.liveSubAgents instanceof Map
    ? [...context.liveSubAgents.values()]
    : [];
}

export function backgroundWorkSummary({
  entries = [],
  pendingCount = null,
  backgroundTasks = [],
  sessionCrons = [],
} = {}) {
  const agents = Array.isArray(entries) ? entries : [];
  if (agents.length > 0) {
    const labels = agents
      .map((entry) => trimmedString(entry?.label))
      .filter(Boolean);
    const shown = labels.slice(0, 3);
    const remaining = Math.max(0, agents.length - shown.length);
    const names = shown.length > 0
      ? ` (${shown.join(', ')}${remaining > 0 ? `, and ${remaining} more` : ''})`
      : '';
    return `${agents.length} background sub-agent${agents.length === 1 ? '' : 's'}${names}`;
  }
  if (Number.isFinite(pendingCount) && pendingCount > 0) {
    return `${pendingCount} pending background agent${pendingCount === 1 ? '' : 's'}`;
  }
  const taskCount = Array.isArray(backgroundTasks) ? backgroundTasks.length : 0;
  const cronCount = Array.isArray(sessionCrons) ? sessionCrons.length : 0;
  const parts = [];
  if (taskCount > 0) {
    parts.push(`${taskCount} background task${taskCount === 1 ? '' : 's'}`);
  }
  if (cronCount > 0) {
    parts.push(`${cronCount} session cron${cronCount === 1 ? '' : 's'}`);
  }
  return parts.join(' and ');
}

export function consumeClaudeStreamMessage(message, context) {
  const emitted = [];
  if (message.type === 'system' && message.subtype === 'turn_duration') {
    context.pendingBackgroundAgentCount = pendingBackgroundAgentCount(message);
  }
  if (message.type === 'queue-operation') {
    const notification = parseAgentTaskNotification(message.content);
    if (notification) {
      if (notification.toolUseId) {
        finishedSubAgentToolUseIds(context).add(notification.toolUseId);
      }
      const agents = context.liveSubAgents instanceof Map ? context.liveSubAgents : null;
      if (agents) {
        if (!notification.toolUseId || !agents.delete(notification.toolUseId)) {
          for (const [toolUseId, entry] of agents) {
            if (notification.agentId && entry.agentId === notification.agentId) {
              agents.delete(toolUseId);
              break;
            }
          }
        }
      }
    }
    if (notification && firstNotificationSighting(context, notification, message.content)) {
      emitted.push({
        event: {
          type: 'claude/agent-finished',
          provider: 'claude',
          toolUseId: notification.toolUseId,
          agentId: notification.agentId,
          status: notification.status,
          summary: notification.summary,
          agentName: notification.agentName,
        },
        message: notification.summary
          || `Sub-agent ${notification.agentName || notification.agentId} finished.`,
      });
      const tokenUsage = recordClaudeSubAgentUsage(
        context,
        {
          agentId: notification.agentId,
          toolUseId: notification.toolUseId,
          reported: notification.totalTokens === null
            ? null
            : { totalTokens: notification.totalTokens },
        },
      );
      if (tokenUsage) emitted.push(tokenUsage);
    }
  }
  if (message.type === 'assistant') {
    const usage = message.message?.usage;
    if (usage && typeof usage === 'object') {
      const usageByMessage = claudeTokenUsageMap(context, 'tokenUsageByMessage');
      const key = String(message.message?.id || message.uuid || `record-${usageByMessage.size}`);
      usageByMessage.set(key, normalizeTokenUsage(usage));
      emitted.push(claudeTokenUsageEmission(context));
    }
    for (const block of message.message?.content || []) {
      if (block.type === 'tool_use' && block.id) {
        const item = toolItem(block, context.cwd);
        context.tools.set(block.id, item);
        emitted.push({
          event: { type: 'item/started', provider: 'claude', item },
          message: item.subAgent
            ? `Claude started sub-agent ${subAgentLabel(item)}.`
            : `${item.type === 'commandExecution' ? 'Running' : 'Claude started'}: ${block.name || 'tool'}`,
        });
      } else if (block.type === 'text' && block.text?.trim()) {
        emitted.push({
          event: {
            type: 'claude/message',
            provider: 'claude',
            text: block.text.trim(),
          },
          message: block.text.trim(),
        });
      }
    }
  }

  if (message.type === 'user') {
    for (const block of message.message?.content || []) {
      if (block.type !== 'tool_result' || !block.tool_use_id) {
        continue;
      }
      const item = context.tools.get(block.tool_use_id);
      if (!item) {
        continue;
      }
      const completedItem = completedToolItem(item, block, message);
      context.tools.delete(block.tool_use_id);
      if (
        completedItem.subAgent
        && completedItem.status !== 'failed'
        && completedItem.backgrounded
        && !finishedSubAgentToolUseIds(context).has(completedItem.toolUseId)
      ) {
        liveSubAgentMap(context).set(completedItem.toolUseId, {
          toolUseId: completedItem.toolUseId,
          agentId: completedItem.agentId || '',
          label: subAgentLabel(completedItem),
        });
      }
      emitted.push({
        event: { type: 'item/completed', provider: 'claude', item: completedItem },
        message: subAgentCompletionMessage(completedItem)
          || (completedItem.type === 'commandExecution'
            ? `Command ${completedItem.status}: ${completedItem.command}`
            : `Claude ${completedItem.tool || 'file change'} ${completedItem.status}.`),
      });
      if (completedItem.subAgent) {
        const tokenUsage = recordClaudeSubAgentUsage(
          context,
          {
            agentId: completedItem.agentId,
            toolUseId: completedItem.toolUseId || completedItem.id,
            reported: message.toolUseResult,
          },
        );
        if (tokenUsage) emitted.push(tokenUsage);
      }
      if (completedItem.planTool) {
        // Folded at the result, not the call: `TaskCreate` only learns its id here, and a
        // rejected `TaskUpdate` must leave the board alone. The plan follows its own row so
        // the console settles the tool call first.
        const planUpdate = foldPlanToolCall(context, completedItem, block, message);
        if (planUpdate) {
          emitted.push(planUpdate);
        }
      }
    }
  }

  if (message.type === 'result') {
    context.finalResponse = typeof message.result === 'string' ? message.result.trim() : '';
    if (typeof message.session_id === 'string' && message.session_id.trim()) {
      context.sessionId = message.session_id.trim();
      context.reportedSessionId = context.sessionId;
    }
    if (message.is_error || String(message.subtype || '').startsWith('error')) {
      context.error = context.finalResponse || message.error || 'Claude could not complete the task.';
    }
  }
  return emitted;
}

export function taskPrompt(task) {
  const prompt = task.attachments?.length
    ? `${task.prompt}\n\nReference images are attached. Use the Read tool to inspect every image before working:\n${task.attachments
      .map((attachment, index) => `${index + 1}. ${attachment.name}: ${attachment.path}`)
      .join('\n')}`
    : task.prompt;
  return withRelayNonInteractiveInstruction(prompt);
}

function selectedModel(model) {
  const selected = normalizeClaudeModel(model);
  if (!selected || selected === 'default') {
    return null;
  }
  return selected;
}

export class ClaudeExecutionRunner {
  constructor({
    command = 'claude',
    spawnProcess = spawn,
    sessions,
    wait = delay,
    now = Date.now,
    idleDiscoveryStaleLimitMs = 60_000,
    platform = process.platform,
    resolveTerminal = null,
    requestAttention = null,
    hookBridge = null,
    terminalExecutor = null,
    embeddedTerminalHost = null,
    terminateProcess = terminateChildProcess,
    diagnostic = () => {},
  } = {}) {
    this.command = command;
    this.spawnProcess = spawnProcess;
    this.terminateProcess = terminateProcess;
    this.sessions = sessions;
    this.wait = wait;
    this.now = now;
    this.idleDiscoveryStaleLimitMs = idleDiscoveryStaleLimitMs;
    this.platform = platform;
    this.resolveTerminal = resolveTerminal;
    this.diagnostic = diagnostic;
    this.terminalExecutor = terminalExecutor
      || new ClaudeTerminalExecutor({
        command,
        sessions,
        wait,
        resolveTerminal,
        requestAttention,
        hookBridge,
        embeddedTerminalHost,
        diagnostic,
      });
    this.activeByTask = new Map();
    this.activeBySession = new Map();
  }

  recordDiagnostic(event, details = {}) {
    try {
      this.diagnostic(event, details);
    } catch {
      // Diagnostics must never alter provider execution or its safety decisions.
    }
  }

  async waitForIdle(task, active, onEvent) {
    if (!this.sessions) {
      return null;
    }
    let announced = false;
    // A session cached as busy is served indefinitely while discovery keeps failing, because
    // the registry now returns last-known-good instead of an empty list. Without a bound the
    // task sits on "Waiting for the selected Claude session to become idle" forever. Track how
    // long we have been reading stale data and fail clearly instead of hanging.
    let staleSince = null;
    while (!active.cancelRequested) {
      const session = await this.sessions.readConnectedSession(task.thread_id);
      if (this.sessions.stale) {
        const timestamp = this.now();
        if (staleSince === null) {
          staleSince = timestamp;
        } else if (timestamp - staleSince >= this.idleDiscoveryStaleLimitMs) {
          throw new ClaudeExecutionError(
            `CC Relay could not read live Claude session state for ${Math.round(this.idleDiscoveryStaleLimitMs / 1000)} seconds, so it never confirmed the terminal was free and typed nothing. Check that the Claude CLI responds to \`claude agents --json\`, then retry.`,
            { retryable: false },
          );
        }
      } else {
        staleSince = null;
      }
      if (!session) {
        throw new ClaudeExecutionError(
          'The selected Claude terminal is no longer open. Choose a live Claude session and retry.',
          { retryable: false },
        );
      }
      if (session.rawStatus !== 'busy') {
        return session;
      }
      if (task.sessionFollowUp) {
        throw new ClaudeExecutionError(
          'That Claude terminal became busy. Your follow-up was not queued.',
          { retryable: false },
        );
      }
      if (!announced) {
        onEvent({
          event: { type: 'claude/waiting', provider: 'claude', sessionId: task.thread_id },
          message: 'Waiting for the selected Claude session to become idle.',
        });
        announced = true;
      }
      await this.wait(1_000);
    }
    throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
  }

  validateFreshSession(task, active, session) {
    if (active.cancelRequested) {
      throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
    }
    if (!session) {
      throw new ClaudeExecutionError(
        'The selected Claude terminal closed before CC Relay could start its first turn. Reopen it and retry.',
        { retryable: false },
      );
    }
    if (session.id !== task.thread_id || session.source !== 'Claude interactive') {
      throw new ClaudeExecutionError(
        'The selected Claude session is no longer the live interactive terminal CC Relay opened. Choose that terminal again and retry.',
        { retryable: false },
      );
    }
    if (
      typeof session.cwd !== 'string'
      || !session.cwd.trim()
      || typeof task.repo_path !== 'string'
      || !task.repo_path.trim()
      || !sameWorkspacePath(session.cwd, task.repo_path, this.platform)
    ) {
      throw new ClaudeExecutionError(
        'The selected Claude terminal belongs to a different workspace. Choose a Claude terminal opened for this project and retry.',
        { retryable: false },
      );
    }
  }

  async runProcess(
    task,
    active,
    args,
    { onEvent, onStderr },
    {
      model,
      sessionMode,
      suppressMissingConversationStderr = false,
      suppressSessionInUseStderr = false,
    },
  ) {
    const invocation = providerCommandInvocation(this.command, args, { platform: this.platform });
    const child = this.spawnProcess(invocation.command, invocation.args, {
      cwd: task.repo_path,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: claudePrintEnv(),
      ...invocation.options,
    });
    active.child = child;
    const context = {
      cwd: task.repo_path,
      tools: new Map(),
      finalResponse: '',
      sessionId: task.thread_id,
      transcriptPath: resolveClaudeTranscriptPath(task.repo_path, task.thread_id),
      tokenUsageAttemptStartedAt: task.tokenUsageAttemptStartedAt || task.started_at || null,
      // Only a fallback key for the folded plan, for the case where a turn never reports a
      // session id. The session id stays the identity everywhere else.
      taskId: task.id ?? null,
      reportedSessionId: null,
      error: null,
      pendingBackgroundAgentCount: null,
    };
    let stdoutBuffer = '';
    let stderrBuffer = '';
    const stderrLines = [];

    onEvent({
      event: {
        type: 'claude/started',
        provider: 'claude',
        sessionId: task.thread_id,
        sessionMode,
        model: model || 'session default',
        effort: task.effort || 'default',
      },
      message: sessionMode === 'fresh'
        ? `Claude started the first CC Relay turn in ${task.thread_name || task.thread_id}.`
        : `Claude is resuming ${task.thread_name || task.thread_id}.`,
    });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const consumeLine = (line) => {
      if (!line.trim()) {
        return;
      }
      try {
        const message = JSON.parse(line);
        for (const event of consumeClaudeStreamMessage(message, context)) {
          onEvent(event);
        }
      } catch (error) {
        onStderr(`Could not parse Claude stream event: ${error.message}`);
      }
    };
    const consumeStderr = (line) => {
      if (!line.trim()) return;
      stderrLines.push(line.trim());
      const suppressMissing = suppressMissingConversationStderr
        && missingConversationSessionId(line) === task.thread_id;
      const suppressInUse = suppressSessionInUseStderr
        && sessionIdInUse(line) === task.thread_id;
      if (!suppressMissing && !suppressInUse) {
        onStderr(line.trim());
      }
    };
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        consumeLine(line);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderrBuffer += chunk;
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() || '';
      for (const line of lines) {
        consumeStderr(line);
      }
    });
    const outcomePromise = new Promise((resolve, reject) => {
      child.once('error', (error) => {
        reject(new ClaudeExecutionError(`Could not start Claude Code: ${error.message}`));
      });
      child.once('close', (code, signal) => {
        consumeLine(stdoutBuffer);
        consumeStderr(stderrBuffer);
        if (active.cancelRequested) {
          reject(new ClaudeExecutionError('Task cancelled.', { cancelled: true, exitCode: code }));
          return;
        }
        const stderrMessage = stderrLines.join('\n').trim();
        if (code !== 0 || context.error) {
          const classificationText = [stderrMessage, context.error].filter(Boolean).join('\n');
          const missingSessionId = missingConversationSessionId(classificationText);
          const inUseSessionId = sessionIdInUse(classificationText);
          const message = stderrMessage
            || context.error
            || `Claude Code stopped${signal ? ` after ${signal}` : ` with code ${code}`}.`;
          reject(new ClaudeExecutionError(message, {
            exitCode: code,
            missingConversation: Boolean(missingSessionId),
            missingConversationSessionId: missingSessionId,
            sessionInUseSessionId: inUseSessionId,
            retryable: !missingSessionId && !inUseSessionId,
          }));
          return;
        }
        const terminatedPending = CLAUDE_BACKGROUND_TERMINATION_PATTERN.test(stderrMessage)
          || (
            Number.isFinite(context.pendingBackgroundAgentCount)
            && context.pendingBackgroundAgentCount > 0
          );
        if (terminatedPending) {
          const detail = backgroundWorkSummary({
            entries: liveSubAgents(context),
            pendingCount: context.pendingBackgroundAgentCount,
          }) || 'background tasks the CLI reported still running';
          reject(new ClaudeExecutionError(
            `Claude ended this run while ${detail} still working, and that work was terminated with it. Parts of the task may already be applied in the workspace, and Retry would re-send the original prompt on top of them, so CC Relay will not retry automatically. Review the workspace, then use Continue session with a follow-up telling Claude what to audit and finish.`,
            { exitCode: code, retryable: false },
          ));
          return;
        }
        if (!context.finalResponse) {
          reject(new ClaudeExecutionError('Claude completed without a final text response.', { exitCode: code }));
          return;
        }
        resolve({
          finalResponse: context.finalResponse,
          sessionId: context.sessionId,
          reportedSessionId: context.reportedSessionId,
          exitCode: 0,
        });
      });
    });
    child.stdin.end(taskPrompt(task));
    try {
      return await outcomePromise;
    } finally {
      if (active.child === child) active.child = null;
    }
  }

  async run(task, { onEvent, onStderr }) {
    if (!task.thread_id) {
      throw new ClaudeExecutionError('Claude execution needs a terminal session ID.', { retryable: false });
    }
    const taskKey = task.id ?? task.thread_id;
    if (this.activeByTask.has(taskKey)) {
      throw new ClaudeExecutionError('That Claude task is already running.');
    }
    if (this.activeBySession.has(task.thread_id)) {
      throw new ClaudeExecutionError('That Claude session already has an active CC Relay task.');
    }
    const active = {
      taskId: taskKey,
      sessionId: task.thread_id,
      task,
      child: null,
      cancelRequested: false,
      executionMode: null,
      steer: null,
    };
    this.activeByTask.set(taskKey, active);
    this.activeBySession.set(task.thread_id, active);
    this.recordDiagnostic('task.claude.run.started', {
      taskId: task.id ?? null,
      threadId: task.thread_id,
      model: task.model || null,
      effort: task.effort || null,
    });

    try {
      const session = await this.waitForIdle(task, active, onEvent);
      let terminal = await this.resolveTerminalTarget(session, active);
      if (!terminal && task.require_terminal === true) {
        throw new ClaudeExecutionError(
          `CC Relay could not resolve the exact owned terminal for ${task.thread_name || task.thread_id}. Plan council did not run Claude headlessly. Launch a Claude CC Relay from this workspace, select it as the council terminal, then retry.`,
          { retryable: false },
        );
      }
      if (terminal) {
        const fallbackReason = this.headlessFallbackReason(task);
        if (fallbackReason) {
          if (task.require_terminal === true) {
            throw new ClaudeExecutionError(
              `CC Relay cannot type this Plan council stage into ${task.thread_name || task.thread_id}: ${fallbackReason} The stage was not run headlessly.`,
              { retryable: false },
            );
          }
          // A prompt that fails the deterministic pre-injection terminal checks (too large for
          // the osascript argv, or containing a NUL byte) cannot be typed, but it ran fine
          // headless via stdin before the terminal path existed. The check is pre-injection
          // with nothing typed, so routing to the headless path here restores that capability
          // with no risk of double execution (Issue 15). The headless path never touches argv
          // with the prompt, so neither the size nor the NUL constraint applies to it.
          onEvent({
            event: { type: 'claude/progress', provider: 'claude', sessionId: task.thread_id },
            message: `CC Relay is running this task headless instead of typing it into the ${task.thread_name || task.thread_id} terminal because ${fallbackReason}`,
          });
          terminal = null;
        }
      }
      active.executionMode = terminal ? 'terminal' : 'headless';
      this.recordDiagnostic('task.claude.run.mode_selected', {
        taskId: task.id ?? null,
        threadId: task.thread_id,
        executionMode: active.executionMode,
      });
      const outcome = terminal
        ? await this.terminalExecutor.runTurn(task, active, session, terminal, { onEvent, onStderr })
        : await this.runHeadless(task, active, { onEvent, onStderr });
      const apiError = claudeApiErrorResponse(outcome.finalResponse);
      if (apiError) {
        const terminalTurn = active.executionMode === 'terminal';
        const retryGuidance = terminalTurn
          ? ' CC Relay will not retry automatically because this terminal turn was already submitted. Retry manually after the provider recovers.'
          : '';
        throw new ClaudeExecutionError(
          `Claude returned a provider API error instead of completing the task: ${apiError}${retryGuidance}`,
          {
            exitCode: outcome.exitCode,
            // Headless Claude already classifies stream-reported provider failures as transient.
            // A terminal turn has crossed the submission boundary, so the no-replay safety rule
            // remains in force even when its final text identifies a provider failure.
            retryable: !terminalTurn,
          },
        );
      }
      onEvent({
        event: {
          type: 'claude/completed',
          provider: 'claude',
          sessionId: outcome.sessionId,
        },
        message: 'Claude completed the task.',
      });
      this.recordDiagnostic('task.claude.run.completed', {
        taskId: task.id ?? null,
        threadId: task.thread_id,
        executionMode: active.executionMode,
        finalChars: outcome.finalResponse.length,
        exitCode: outcome.exitCode,
      });
      return outcome;
    } catch (error) {
      this.recordDiagnostic('task.claude.run.failed', {
        taskId: task.id ?? null,
        threadId: task.thread_id,
        executionMode: active.executionMode,
        retryable: error.retryable !== false,
        cancelled: error.cancelled === true,
        exitCode: error.exitCode ?? null,
        error: error.message,
      });
      throw error;
    } finally {
      if (this.activeByTask.get(taskKey) === active) this.activeByTask.delete(taskKey);
      if (this.activeBySession.get(task.thread_id) === active) this.activeBySession.delete(task.thread_id);
    }
  }

  // The reason this turn must run headless even though an owned terminal resolved, or null
  // when the prompt is safe to type. Deterministic and pre-injection: an oversized or
  // NUL-bearing prompt cannot travel as an osascript argv value, so CC Relay routes it to the
  // headless stdin path instead of failing (Issue 15). Uses the same byte limit the executor
  // would enforce so the routing decision and the executor's own backstop check agree.
  headlessFallbackReason(task) {
    const maxBytes = this.terminalExecutor?.maxPromptBytes;
    return injectionPromptIssue(taskPrompt(task), maxBytes ? { maxBytes } : {});
  }

  // Decide whether this turn can run inside the interactive terminal on macOS. Returns the
  // owned single-tab Terminal.app identity, or null to use the headless path. Any resolution
  // failure falls back to headless; once a terminal is chosen the runner never falls back,
  // so a failed injection cannot double-execute the turn.
  async resolveTerminalTarget(session, active) {
    if (active.cancelRequested) return null;
    if (typeof this.resolveTerminal !== 'function') return null;
    try {
      const terminal = await this.resolveTerminal(session);
      if (terminal && ((terminal.transport === 'pty' && typeof terminal.terminalId === 'string'
        && terminal.terminalId.startsWith('pty:')) || (this.platform === 'darwin'
        && Number.isInteger(terminal.terminalWindowId) && terminal.terminalWindowId > 0))) {
        return terminal;
      }
    } catch {
      // fall back to the headless path when terminal identity cannot be resolved
    }
    return null;
  }

  async runHeadless(task, active, { onEvent, onStderr }) {
    const attachmentDirectories = [...new Set(
      (task.attachments || []).map((attachment) => dirname(attachment.path)),
    )];
    const model = selectedModel(task.model);
    const commonArgs = [
      '-p',
      '--permission-mode',
      'auto',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-chrome',
      ...attachmentDirectories.flatMap((directory) => ['--add-dir', directory]),
      ...(model ? ['--model', model] : []),
      ...(task.effort ? ['--effort', task.effort] : []),
    ];
    let outcome;
    try {
      outcome = await this.runProcess(task, active, [
        ...commonArgs,
        '--resume',
        task.thread_id,
      ], { onEvent, onStderr }, {
        model,
        sessionMode: 'resume',
        suppressMissingConversationStderr: true,
      });
    } catch (error) {
      if (
        !error.missingConversation
        || error.missingConversationSessionId !== task.thread_id
        || active.cancelRequested
      ) throw error;
      const freshSession = await this.waitForIdle(task, active, onEvent);
      this.validateFreshSession(task, active, freshSession);
      onEvent({
        event: {
          type: 'claude/session-initializing',
          provider: 'claude',
          sessionId: task.thread_id,
        },
        message: `Claude has no saved transcript in ${task.thread_name || task.thread_id} yet. CC Relay is starting its first turn with the same session ID.`,
      });
      try {
        outcome = await this.runProcess(task, active, [
          ...commonArgs,
          '--session-id',
          task.thread_id,
        ], { onEvent, onStderr }, {
          model,
          sessionMode: 'fresh',
          suppressSessionInUseStderr: true,
        });
      } catch (freshError) {
        if (freshError.sessionInUseSessionId !== task.thread_id || active.cancelRequested) {
          throw freshError;
        }
        const resumableSession = await this.waitForIdle(task, active, onEvent);
        this.validateFreshSession(task, active, resumableSession);
        onEvent({
          event: {
            type: 'claude/session-initializing',
            provider: 'claude',
            sessionId: task.thread_id,
          },
          message: 'Claude saved the transcript during initialization. CC Relay is resuming the same session.',
        });
        outcome = await this.runProcess(task, active, [
          ...commonArgs,
          '--resume',
          task.thread_id,
        ], { onEvent, onStderr }, { model, sessionMode: 'resume' });
      }
      if (outcome.reportedSessionId !== task.thread_id) {
        throw new ClaudeExecutionError(
          `Claude did not confirm the selected session ID after its first turn. Expected ${task.thread_id}, received ${outcome.reportedSessionId || 'none'}.`,
          { retryable: false },
        );
      }
    }
    return outcome;
  }

  async steer(taskId, prompt, attachments = [], options = {}) {
    const value = typeof prompt === 'string' ? prompt.trim() : '';
    if (!value) {
      throw new ClaudeExecutionError('Write a follow-up before sending it.', { retryable: false });
    }
    const active = this.activeByTask.get(taskId);
    if (!active) {
      throw new ClaudeExecutionError(
        'That task no longer has an active Claude turn. Your message was not queued.',
        { retryable: false },
      );
    }
    if (typeof active.steer !== 'function') {
      const message = active.executionMode === 'headless'
        ? 'That Claude task is not running in an interactive terminal, so it cannot accept a live update. Your message was not queued.'
        : 'Claude is still preparing the original turn and cannot accept a live update yet. Try again after it starts working. Your message was not queued.';
      throw new ClaudeExecutionError(message, { retryable: false });
    }

    this.recordDiagnostic('task.claude.steer.requested', {
      taskId,
      threadId: active.sessionId,
      attachmentCount: attachments.length,
      flushComposer: options.flushComposer === true,
    });
    try {
      const outcome = await active.steer(value, attachments, options);
      this.recordDiagnostic('task.claude.steer.completed', outcome);
      return outcome;
    } catch (error) {
      this.recordDiagnostic('task.claude.steer.failed', {
        taskId,
        threadId: active.sessionId,
        deliveryUncertain: error.deliveryUncertain === true,
        // Together they say how many guarded Returns were sent and what the composer looked like on
        // every recovery pass that ran. Both are present for any failure raised inside
        // deliverActiveSteer, not only a post-injection one: a PRE-injection failure carries 0 and
        // [], which is the meaningful reading that nothing was typed and that no recovery pass ever
        // classified the composer. They are null only when the error carries neither field, for
        // example a live update rejected before deliverActiveSteer runs because the turn had
        // already closed.
        submitAttempts: Number.isInteger(error.submitAttempts) ? error.submitAttempts : null,
        blockingComposerSubmitAttempts: Number.isInteger(error.blockingComposerSubmitAttempts)
          ? error.blockingComposerSubmitAttempts
          : null,
        composerStates: Array.isArray(error.composerStates) ? error.composerStates : null,
        error: error.message,
      });
      throw error;
    }
  }

  cancel(taskId = null) {
    if (taskId !== null && taskId !== undefined) {
      const active = this.activeByTask.get(taskId) || this.activeBySession.get(taskId);
      if (!active) return false;
      active.cancelRequested = true;
      this.stopChild(active);
      return true;
    }
    const activeTasks = [...new Set(this.activeByTask.values())];
    for (const active of activeTasks) {
      active.cancelRequested = true;
      this.stopChild(active);
    }
    return activeTasks.length > 0;
  }

  // On Windows the spawned child is cmd.exe wrapping the claude shim, so killing the direct
  // child would leave Claude running against the user's workspace after a cancel.
  stopChild(active) {
    if (!active.child) return false;
    return this.terminateProcess(active.child, { signal: 'SIGTERM', platform: this.platform });
  }
}
