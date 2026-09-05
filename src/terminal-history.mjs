import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { assistantRecordText, consumedQueuedPromptRecordText, userPromptRecordText } from './claude-transcript-tail.mjs';
import { claudeApiErrorResponse, parseAgentTaskNotification } from './claude-execution-runner.mjs';
import { withoutRelayNonInteractiveInstruction } from './relay-prompt.mjs';

const MAX_LINE_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGE_CHARS = 100_000;
const promptKey = (text) => createHash('sha256').update(text).digest('hex');
const validId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/u.test(value);
const timestamp = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const internalMessage = (text) => /^(?:# AGENTS\.md instructions for |<(?:environment_context|permissions instructions|user_instructions|recommended_plugins|agent-message|task-notification|turn_aborted|local-command-|command-name|system-reminder)\b)/u.test(text.trim());
const messageText = (value) => typeof value === 'string'
  ? withoutRelayNonInteractiveInstruction(value).slice(0, MAX_MESSAGE_CHARS)
  : '';

async function workspace(path) {
  let value;
  try { value = await realpath(path); } catch { value = resolve(path); }
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

// Read provider persistence only. This service never subscribes, resumes, types, changes task
// status, or reserves a terminal. Native turn identities keep restart replay idempotent.
export class TerminalHistorySync {
  constructor({ database, home = homedir(), diagnostic = () => {}, changed = () => {} } = {}) {
    this.database = database;
    this.home = home;
    this.diagnostic = diagnostic;
    this.changed = changed;
    this.readers = new Map();
    this.paths = new Map();
    this.pathsAt = 0;
    this.pending = null;
    this.stopped = false;
  }

  sync({ refreshPaths = false } = {}) {
    if (this.stopped) return Promise.resolve();
    if (this.pending && refreshPaths) return this.pending.then(() => this.sync({ refreshPaths: true }));
    if (this.pending) return this.pending;
    if (refreshPaths) this.pathsAt = 0;
    this.pending = this.scan().finally(() => { this.pending = null; });
    return this.pending;
  }

  async stop() {
    this.stopped = true;
    await this.pending;
    this.readers.clear();
  }

  async indexPaths() {
    if (Date.now() - this.pathsAt < 30_000) return;
    const paths = new Map();
    for (const [provider, root] of [
      ['codex', join(this.home, '.codex', 'sessions')],
      ['codex', join(this.home, '.codex', 'archived_sessions')],
      ['claude', join(this.home, '.claude', 'projects')],
    ]) {
      let entries;
      try { entries = await readdir(root, { recursive: true, withFileTypes: true }); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
        const id = provider === 'claude' ? entry.name.slice(0, -6)
          : entry.name.match(/-([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.jsonl$/iu)?.[1];
        if (!validId(id)) continue;
        const key = `${provider}:${id}`;
        const candidates = paths.get(key) || [];
        candidates.push(join(entry.parentPath || entry.path || root, entry.name));
        paths.set(key, candidates);
      }
    }
    this.paths = paths;
    this.pathsAt = Date.now();
  }

  async scan() {
    try {
      const tasks = this.database.terminalHistoryTasks().filter((task) => validId(task.thread_id) && timestamp(task.started_at));
      if (!tasks.length) return;
      await this.indexPaths();
      const groups = new Map();
      for (const task of tasks) {
        const key = `${task.provider}:${task.thread_id}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(task);
      }
      const liveKeys = new Set();
      for (const task of tasks) {
        if (this.stopped) break;
        const key = `${task.provider}:${task.thread_id}`;
        // Several historical rows can refer to one legacy conversation. A native turn belongs
        // to the most recently started task at that time, never to every row on that thread.
        const peers = groups.get(key);
        const candidates = this.paths.get(key) || [];
        if (candidates.length !== 1) continue;
        const readerKey = `${task.id}:${key}`;
        liveKeys.add(readerKey);
        try {
          await this.read(task, peers, candidates[0], readerKey);
        } catch (error) {
          this.readers.delete(readerKey);
          this.diagnostic('terminal.history.read_failed', { taskId: task.id, provider: task.provider, error: error.message });
        }
      }
      for (const key of this.readers.keys()) if (!liveKeys.has(key)) this.readers.delete(key);
    } catch (error) {
      this.diagnostic('terminal.history.sync_failed', { error: error.message });
    }
  }

  async read(task, peers, path, key) {
    const info = await stat(path);
    let reader = this.readers.get(key);
    const boundary = peers.map((peer) => `${peer.id}:${peer.started_at}`).sort().join('|');
    if (!reader || reader.path !== path || reader.ino !== info.ino || info.size < reader.offset || reader.boundary !== boundary) {
      reader = {
        path, ino: info.ino, offset: 0, skipping: false, validated: false, turn: null, boundary,
        repo: await workspace(task.repo_path), workspaces: new Map(), removedPrompts: new Map(),
        backgroundAgents: new Map(), pendingBackgroundAgentCount: 0,
      };
      this.readers.set(key, reader);
    }
    if (info.size === reader.offset) return;
    let leftover = Buffer.alloc(0);
    let consumed = reader.offset;
    let skipping = reader.skipping;
    let dirty = false;
    // Bounded chunks and complete-line offsets avoid materializing long tool output or losing
    // half-written JSON/UTF-8. A restart or replaced file replays safely through the database keys.
    for await (const chunk of createReadStream(path, { start: reader.offset, end: info.size - 1, highWaterMark: 64 * 1024 })) {
      if (this.stopped) break;
      let start = 0;
      for (let index = 0; index < chunk.length; index += 1) {
        if (chunk[index] !== 10) continue;
        const part = chunk.subarray(start, index);
        const length = leftover.length + part.length;
        if (!skipping && length <= MAX_LINE_BYTES) {
          const line = leftover.length ? Buffer.concat([leftover, part]) : part;
          let record;
          try { record = JSON.parse(line.toString('utf8')); } catch {}
          if (record) dirty = await this.consume(task, peers, reader, record, consumed + index) || dirty;
        }
        leftover = Buffer.alloc(0);
        skipping = false;
        start = index + 1;
        reader.offset = consumed + start;
      }
      const tail = chunk.subarray(start);
      if (leftover.length + tail.length > MAX_LINE_BYTES) { leftover = Buffer.alloc(0); skipping = true; }
      else if (!skipping && tail.length) leftover = Buffer.concat([leftover, tail]);
      consumed += chunk.length;
    }
    reader.skipping = skipping;
    if (skipping) reader.offset = consumed;
    if (dirty) this.changed(task.id);
  }

  owns(task, peers, at) {
    const owner = peers.filter((peer) => timestamp(peer.started_at) <= at)
      .sort((a, b) => timestamp(b.started_at).localeCompare(timestamp(a.started_at)) || b.id - a.id)[0];
    return owner?.id === task.id;
  }

  async consume(task, peers, reader, record, offset) {
    const at = timestamp(record.timestamp);
    const payload = record.payload || {};
    const matchesWorkspace = async (path) => {
      if (typeof path !== 'string') return false;
      if (!reader.workspaces.has(path)) reader.workspaces.set(path, await workspace(path) === reader.repo);
      return reader.workspaces.get(path);
    };
    const save = (message = null) => reader.turn && this.database.recordTerminalHistory(task, reader.turn, message);
    const add = (role, text, id, createdAt = at) => {
      text = messageText(text);
      if (!text || !at || !reader.turn || (role === 'user' && internalMessage(text))) return false;
      return save({ id: String(id || offset), role, text, created_at: createdAt });
    };
    if (task.provider === 'codex') {
      if (record.type === 'session_meta') {
        reader.validated = payload.id === task.thread_id && await matchesWorkspace(payload.cwd);
        reader.turn = null;
        return false;
      }
      if (!reader.validated) return false;
      if (record.type === 'turn_context' && !await matchesWorkspace(payload.cwd)) {
        reader.turn = null;
        return false;
      }
      if (record.type === 'event_msg' && payload.type === 'task_started') {
        reader.turn = validId(payload.turn_id) && at && this.owns(task, peers, at)
          ? { id: payload.turn_id, started_at: at, finished_at: null, outcome: null } : null;
        return false;
      }
      if (!reader.turn) return false;
      if (record.type === 'response_item' && payload.type === 'message' && ['user', 'assistant'].includes(payload.role)) {
        const content = Array.isArray(payload.content) ? payload.content : [];
        const text = content
          .filter((part) => ['input_text', 'output_text', 'text'].includes(part?.type) && typeof part.text === 'string')
          .filter((part) => payload.role !== 'user' || !internalMessage(part.text))
          .map((part) => part.text).join('\n');
        const imageOnly = payload.role === 'user' && content.some((part) => ['input_image', 'image', 'localImage'].includes(part?.type));
        return add(payload.role, text || (imageOnly ? '[Image attachment]' : ''), payload.id || offset);
      }
      if (record.type === 'event_msg' && payload.type === 'user_message') return add('user', payload.message, offset);
      if (record.type === 'event_msg' && ['task_complete', 'turn_aborted'].includes(payload.type)
        && payload.turn_id === reader.turn.id && at && at >= reader.turn.started_at) {
        reader.turn.finished_at = at;
        reader.turn.outcome = payload.type === 'task_complete' ? 'complete' : 'cancelled';
        const changed = add('assistant', payload.last_agent_message, `${reader.turn.id}-final`);
        return save() || changed;
      }
      return false;
    }
    if (record.sessionId !== task.thread_id || record.isSidechain === true || record.isMeta === true || !at) return false;
    if (typeof record.cwd === 'string') {
      if (!await matchesWorkspace(record.cwd)) return false;
      reader.validated = true;
    } else if (!reader.validated || !['queue-operation', 'attachment'].includes(record.type)) return false;
    if (record.type === 'queue-operation') {
      if (record.operation === 'remove' && typeof record.content === 'string') {
        if (reader.removedPrompts.size >= 100) reader.removedPrompts.delete(reader.removedPrompts.keys().next().value);
        reader.removedPrompts.set(promptKey(record.content), at);
      }
      const notification = parseAgentTaskNotification(record.content);
      if (notification) {
        for (const [toolId, agentId] of reader.backgroundAgents) {
          if (toolId === notification.toolUseId || agentId === notification.agentId) reader.backgroundAgents.delete(toolId);
        }
      }
      return false;
    }
    if (record.type === 'system' && record.subtype === 'turn_duration' && Number.isFinite(record.pendingBackgroundAgentCount)) {
      reader.pendingBackgroundAgentCount = Math.max(0, record.pendingBackgroundAgentCount);
      if (reader.turn && reader.pendingBackgroundAgentCount > 0) {
        reader.turn.outcome = null;
        reader.turn.finished_at = null;
        return save();
      }
      return false;
    }
    if (record.toolUseResult?.isAsync === true && validId(record.toolUseResult.agentId)) {
      const blocks = Array.isArray(record.message?.content) ? record.message.content : [];
      for (const block of blocks) if (block.type === 'tool_result' && validId(block.tool_use_id)) {
        reader.backgroundAgents.set(block.tool_use_id, record.toolUseResult.agentId);
      }
    }
    const queued = record.attachment?.origin?.kind === 'human' ? consumedQueuedPromptRecordText(record) : '';
    const consumedAt = queued ? reader.removedPrompts.get(promptKey(queued)) : null;
    const content = Array.isArray(record.message?.content) ? record.message.content : [];
    const imageOnly = record.type === 'user' && record.isCompactSummary !== true
      && content.some((part) => part?.type === 'image') && !content.some((part) => part?.type === 'tool_result');
    const prompt = userPromptRecordText(record) || queued || (imageOnly ? '[Image attachment]' : '');
    if (prompt && !internalMessage(prompt)) {
      if (/^\[Request interrupted by user/u.test(prompt.trim())) {
        if (!reader.turn) return false;
        reader.turn.outcome = 'cancelled';
        reader.turn.finished_at = at;
        return save();
      }
      const id = record.uuid || record.promptId;
      // A queued attachment is stamped at enqueue time. The paired removal plus consumption
      // proves its actual start; a removal by itself never records or completes a prompt.
      const startedAt = queued ? consumedAt : at;
      if (queued) reader.removedPrompts.delete(promptKey(queued));
      if (!startedAt) return false;
      reader.turn = validId(id) && this.owns(task, peers, startedAt)
        ? { id, started_at: startedAt, finished_at: null, outcome: null } : null;
      return add('user', prompt, id, startedAt);
    }
    if (record.type !== 'assistant' || !reader.turn || at < reader.turn.started_at) return false;
    const text = assistantRecordText(record);
    if (record.isApiErrorMessage === true || claudeApiErrorResponse(text)) {
      reader.turn.outcome = 'failed';
      reader.turn.finished_at = at;
      return save();
    }
    // Null/absent stop reasons are also used by unfinished streaming records. Only an explicit
    // successful terminal reason plus text can contribute completed work to Standup.
    if (text && ['end_turn', 'stop_sequence'].includes(record.message?.stop_reason)
      && reader.backgroundAgents.size === 0 && reader.pendingBackgroundAgentCount === 0) {
      reader.turn.finished_at = at;
      reader.turn.outcome = 'complete';
    } else if (record.message?.stop_reason === 'tool_use') {
      reader.turn.finished_at = null;
      reader.turn.outcome = null;
    }
    return text ? add('assistant', text, record.uuid || record.message?.id || offset) : save();
  }
}
