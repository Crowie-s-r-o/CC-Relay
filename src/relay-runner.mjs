export class RelayRunner {
  constructor({ codex, claude, planCouncil, turbo }) {
    this.codex = codex;
    this.claude = claude;
    this.planCouncil = planCouncil;
    this.turbo = turbo;
    this.activeRunners = new Map();
  }

  async run(task, callbacks) {
    const runner = task.mode === 'turbo'
      ? this.turbo
      : task.mode === 'plan'
      ? this.planCouncil
      : task.provider === 'claude'
        ? this.claude
        : this.codex;
    this.activeRunners.set(task.id, runner);
    try {
      return await runner.run(task, callbacks);
    } finally {
      this.activeRunners.delete(task.id);
    }
  }

  cancel(taskId = null) {
    if (taskId != null) {
      const runner = this.activeRunners.get(taskId);
      return runner?.cancel(taskId) || false;
    }
    let cancelled = false;
    for (const [activeTaskId, runner] of this.activeRunners) {
      cancelled = runner.cancel(activeTaskId) || cancelled;
    }
    return cancelled;
  }
}
