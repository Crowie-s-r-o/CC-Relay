export class RelayRunner {
  constructor({ codex, claude, planCouncil, turbo }) {
    this.codex = codex;
    this.claude = claude;
    this.planCouncil = planCouncil;
    this.turbo = turbo;
    this.activeRunner = null;
  }

  async run(task, callbacks) {
    const runner = task.mode === 'turbo'
      ? this.turbo
      : task.mode === 'plan'
      ? this.planCouncil
      : task.provider === 'claude'
        ? this.claude
        : this.codex;
    this.activeRunner = runner;
    try {
      return await runner.run(task, callbacks);
    } finally {
      this.activeRunner = null;
    }
  }

  cancel() {
    return this.activeRunner?.cancel() || false;
  }
}
