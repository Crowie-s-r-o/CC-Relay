export class RelayRunner {
  constructor({ codex, claude, planCouncil, turbo }) {
    this.codex = codex;
    this.claude = claude;
    this.planCouncil = planCouncil;
    this.turbo = turbo;
    this.activeRunners = new Map();
    this.activePreparations = new Map();
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

  async prepare(task, callbacks) {
    if (task.mode !== 'turbo') return null;
    if (this.activePreparations.has(task.id)) return this.activePreparations.get(task.id);
    const preparation = this.turbo.prepare(task, callbacks);
    this.activePreparations.set(task.id, preparation);
    preparation.then(() => {
      if (this.activePreparations.get(task.id) === preparation) this.activePreparations.delete(task.id);
    }, () => {
      if (this.activePreparations.get(task.id) === preparation) this.activePreparations.delete(task.id);
    });
    return preparation;
  }

  cancel(taskId = null) {
    if (taskId != null) {
      let cancelled = false;
      const preparation = this.activePreparations.get(taskId);
      if (preparation) cancelled = this.turbo.cancel(taskId) || cancelled;
      const runner = this.activeRunners.get(taskId);
      if (runner) cancelled = runner.cancel(taskId) || cancelled;
      return cancelled;
    }
    let cancelled = false;
    for (const taskId of this.activePreparations.keys()) {
      cancelled = this.turbo.cancel(taskId) || cancelled;
    }
    for (const [activeTaskId, runner] of this.activeRunners) {
      cancelled = runner.cancel(activeTaskId) || cancelled;
    }
    return cancelled;
  }
}
