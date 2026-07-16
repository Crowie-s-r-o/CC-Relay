import { EventEmitter } from 'node:events';
import { now } from './database.mjs';

const RETRYABLE_STATUSES = new Set(['failed', 'cancelled', 'interrupted']);

export class TaskQueue extends EventEmitter {
  constructor({ database, artifacts, runner, retryDelayMs = 5000 }) {
    super();
    this.database = database;
    this.artifacts = artifacts;
    this.runner = runner;
    this.activeTasks = new Map();
    this.scheduling = false;
    this.stopping = false;
    this.retryDelayMs = retryDelayMs;
    this.retryTimers = new Map();
  }

  start() {
    this.database.recoverInterruptedTasks();
    this.schedule();
  }

  status() {
    const activeTaskIds = [...this.activeTasks.keys()];
    return {
      paused: this.database.isPaused(),
      activeTaskId: activeTaskIds[0] || null,
      activeTaskIds,
    };
  }

  enqueue(input) {
    const { attachments = [], runNow = false, ...taskInput } = input;
    let task = this.database.createTask({ ...taskInput, priority: runNow });
    try {
      this.artifacts.initializeTask(task);
      const storedAttachments = this.artifacts.writeAttachments(task.id, attachments);
      if (storedAttachments.length > 0) {
        task = this.database.updateTask(task.id, {
          attachments_json: JSON.stringify(storedAttachments),
        });
        this.database.addEvent(
          task.id,
          'queue',
          `${storedAttachments.length} reference image${storedAttachments.length === 1 ? '' : 's'} attached.`,
        );
      }
    } catch (error) {
      this.database.deleteTask(task.id);
      this.artifacts.deleteTask(task.id);
      throw error;
    }
    if (runNow) {
      this.database.addEvent(task.id, 'queue', 'Priority submission placed ahead of waiting tasks.');
    }
    this.changed(task.id);
    this.schedule();
    return task;
  }

  pause() {
    this.database.setPaused(true);
    this.changed();
  }

  resume() {
    this.database.setPaused(false);
    this.changed();
    this.schedule();
  }

  cancel(taskId) {
    const task = this.database.getTask(taskId);
    if (!task) {
      throw new Error('Task not found.');
    }

    if (task.status === 'queued') {
      this.database.updateTask(taskId, {
        status: 'cancelled',
        finished_at: now(),
        error: 'Task cancelled before it started.',
      });
      this.database.addEvent(taskId, 'queue', 'Queued task cancelled.');
      this.artifacts.writeError(taskId, 'Task cancelled before it started.');
      this.changed(taskId);
      return;
    }

    if (task.status !== 'running' || !this.activeTasks.has(taskId)) {
      throw new Error('Only queued or running tasks can be cancelled.');
    }

    this.database.addEvent(taskId, 'queue', 'Cancellation requested.');
    if (!this.runner.cancel(taskId)) {
      throw new Error('The AI process is no longer running.');
    }
    this.changed(taskId);
  }

  retry(taskId) {
    this.clearAutoRetry(taskId);
    const task = this.database.getTask(taskId);
    if (!task) {
      throw new Error('Task not found.');
    }
    if (!RETRYABLE_STATUSES.has(task.status)) {
      throw new Error('Only failed, cancelled, or interrupted tasks can be retried.');
    }

    const tasks = this.database.listTasks();
    const maxPosition = tasks.reduce((maximum, item) => Math.max(maximum, item.position), 0);
    const updated = this.database.updateTask(taskId, {
      status: 'queued',
      position: maxPosition + 1,
      started_at: null,
      finished_at: null,
      session_id: null,
      result: null,
      error: null,
      exit_code: null,
    });
    this.artifacts.clearOutcome(taskId);
    this.database.addEvent(taskId, 'queue', 'Task queued for retry.');
    this.changed(taskId);
    this.schedule();
    return updated;
  }

  delete(taskId) {
    this.clearAutoRetry(taskId);
    const task = this.database.getTask(taskId);
    if (!task) {
      return false;
    }
    if (task.status === 'running') {
      throw new Error('Cancel the running task before deleting it.');
    }
    const deleted = this.database.deleteTask(taskId);
    if (deleted) {
      this.artifacts.deleteTask(taskId);
    }
    this.changed(taskId);
    return deleted;
  }

  reorder(taskIds) {
    const tasks = this.database.reorderQueuedTasks(taskIds);
    this.changed();
    return tasks;
  }

  assign(taskId, thread) {
    const task = this.database.getTask(taskId);
    if (!task) throw new Error('Task not found.');
    if (task.status !== 'queued') throw new Error('Only queued tasks can be assigned to another terminal.');
    const updated = this.database.updateTask(taskId, {
      thread_id: thread.id,
      thread_name: thread.title,
      thread_source: thread.source,
    });
    this.artifacts.updateTaskAssignment(updated);
    this.database.addEvent(taskId, 'queue', `Task assigned to ${thread.title}.`);
    this.changed(taskId);
    return updated;
  }

  schedule() {
    if (this.scheduling || this.stopping || this.database.isPaused()) {
      return;
    }
    this.scheduling = true;
    queueMicrotask(async () => {
      try {
        await this.runNext();
      } finally {
        this.scheduling = false;
        if (!this.stopping && !this.database.isPaused() && this.runnableTasks().length > 0) {
          this.schedule();
        }
      }
    });
  }

  isConcurrentCodexTask(task) {
    return task?.mode === 'execute' && task.provider === 'codex';
  }

  runnableTasks() {
    if (this.database.isPaused()) return [];
    const queued = this.database.listTasks().filter((task) => task.status === 'queued');
    const active = [...this.activeTasks.values()];
    if (active.some((task) => !this.isConcurrentCodexTask(task))) return [];
    if (queued[0] && !this.isConcurrentCodexTask(queued[0])) {
      return active.length === 0 ? [queued[0]] : [];
    }
    const busyThreads = new Set(active.map((task) => task.thread_id));
    const runnable = [];
    for (const task of queued) {
      if (!this.isConcurrentCodexTask(task)) break;
      if (busyThreads.has(task.thread_id)) continue;
      busyThreads.add(task.thread_id);
      runnable.push(task);
    }
    return runnable;
  }

  async runNext() {
    const tasks = this.runnableTasks();
    if (tasks.length === 0) return;
    await Promise.all(tasks.map((task) => this.runTask(task)));
  }

  async runTask(task) {
    this.activeTasks.set(task.id, task);
    this.database.updateTask(task.id, {
      status: 'running',
      started_at: now(),
      finished_at: null,
      error: null,
    });
    const execution = [task.model, task.effort ? `${task.effort} effort` : null].filter(Boolean);
    this.database.addEvent(
      task.id,
      'queue',
      execution.length > 0 ? `Task started with ${execution.join(', ')}.` : 'Task started.',
    );
    this.changed(task.id);

    try {
      const outcome = await this.runner.run(task, {
        onEvent: ({ event, message }) => {
          this.artifacts.appendRawEvent(task.id, event);
          const kind = event.provider || (
            event.type === 'item/completed' && event.item?.type === 'agentMessage'
              ? 'result'
              : 'codex'
          );
          this.database.addEvent(task.id, kind, message, event);
          this.changed(task.id);
        },
        onStderr: (line) => {
          this.artifacts.appendRawEvent(task.id, { type: 'stderr', text: line });
          this.database.addEvent(task.id, 'stderr', line);
          this.changed(task.id);
        },
      });

      const result = outcome.finalResponse
        || (task.mode === 'plan'
          ? 'The plan council completed without a final text response.'
          : 'Codex completed without a final text response.');
      this.database.updateTask(task.id, {
        status: 'complete',
        finished_at: now(),
        session_id: outcome.sessionId,
        result,
        error: null,
        exit_code: outcome.exitCode,
      });
      this.artifacts.writeResult(task.id, result);
      this.database.addEvent(task.id, 'queue', 'Task completed.');
    } catch (error) {
      const status = this.stopping ? 'interrupted' : error.cancelled ? 'cancelled' : 'failed';
      const message = this.stopping
        ? 'Relay stopped while this task was running.'
        : error.message;
      this.database.updateTask(task.id, {
        status,
        finished_at: now(),
        error: message,
        exit_code: error.exitCode ?? null,
      });
      this.artifacts.writeError(task.id, message);
      this.database.addEvent(
        task.id,
        'queue',
        this.stopping
          ? 'Task interrupted because Relay stopped.'
          : error.cancelled
            ? 'Task cancelled.'
            : `Task failed. Retrying automatically in ${this.retryDelayMs / 1000} seconds.`,
      );
      if (status === 'failed') {
        this.scheduleAutoRetry(task.id);
      }
    } finally {
      this.activeTasks.delete(task.id);
      this.changed(task.id);
      this.emit('taskIdle', task.id);
      if (this.activeTasks.size === 0) this.emit('idle');
    }
  }

  async shutdown() {
    this.stopping = true;
    for (const taskId of this.retryTimers.keys()) {
      this.clearAutoRetry(taskId);
    }
    if (this.activeTasks.size === 0) {
      return;
    }

    const taskIds = [...this.activeTasks.keys()];
    for (const taskId of taskIds) {
      this.database.addEvent(taskId, 'system', 'Relay shutdown requested.');
    }
    const idle = new Promise((resolve) => this.once('idle', resolve));
    for (const taskId of taskIds) this.runner.cancel(taskId);
    const timeout = new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      timer.unref();
    });
    await Promise.race([idle, timeout]);
  }

  changed(taskId = null) {
    this.emit('changed', { taskId, status: this.status() });
  }

  scheduleAutoRetry(taskId) {
    this.clearAutoRetry(taskId);
    const timer = setTimeout(() => {
      this.retryTimers.delete(taskId);
      if (this.stopping) return;
      const task = this.database.getTask(taskId);
      if (task?.status !== 'failed') return;
      try {
        this.retry(taskId);
        this.database.addEvent(taskId, 'queue', 'Automatic retry started after the 5-second wait.');
        this.changed(taskId);
      } catch {}
    }, this.retryDelayMs);
    timer.unref();
    this.retryTimers.set(taskId, timer);
  }

  clearAutoRetry(taskId) {
    const timer = this.retryTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(taskId);
    }
  }
}
