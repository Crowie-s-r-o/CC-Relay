import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

function writeFileAtomically(filePath, content) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporaryPath, filePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

export class ArtifactStore {
  constructor(rootPath) {
    this.rootPath = rootPath;
    mkdirSync(rootPath, { recursive: true });
  }

  taskDirectory(taskId) {
    return join(this.rootPath, String(taskId));
  }

  planPath(taskId) {
    return join(this.taskDirectory(taskId), 'plan.md');
  }

  initializeTask(task) {
    const directory = this.taskDirectory(task.id);
    mkdirSync(directory, { recursive: true });
    const execution = task.mode === 'plan'
      ? `Mode: plan council\n\nAuthor: ${task.author_provider} / ${task.author_model} / ${task.author_effort}\n\nReviewer: ${task.reviewer_provider} / ${task.reviewer_model} / ${task.reviewer_effort}`
      : task.mode === 'turbo'
        ? `Mode: forward-planning turbo\n\nPlanner: ${task.turbo?.plannerModel} / ${task.turbo?.plannerEffort}\n\nWorkers: ${task.turbo?.workerCount} / ${task.turbo?.workerModel} / ${task.turbo?.workerEffort}${(task.turbo?.council?.enabled || task.turbo?.councilEnabled) ? `\n\nCouncil: ${(task.turbo?.council?.order || ['codex', 'claude']).map((provider) => provider === 'claude' ? 'Claude' : 'Codex').join(' → ')}\nAuthor: ${task.turbo?.council?.authorModel || 'configured model'} / ${task.turbo?.council?.authorEffort || 'model default'}\nReviewer: ${task.turbo?.council?.reviewerModel || 'configured model'} / ${task.turbo?.council?.reviewerEffort || 'model default'}\nCouncil status: pending` : ''}`
      : `Mode: execute\n\nProvider: ${task.provider || 'codex'}\n\nModel: ${task.model || 'session default'}\n\nEffort: ${task.effort || 'model default'}\n\nContext: resume selected session`;
    const attachments = Array.isArray(task.attachments) ? task.attachments : [];
    const attachmentSection = attachments.length > 0
      ? `\n\n## Reference images\n\n${attachments.map((item) => `- ${item.name} (${item.mimeType}, ${item.size} bytes)`).join('\n')}`
      : '';
    writeFileSync(
      join(directory, 'task.md'),
      `# ${task.title}\n\n${execution}${task.continued_from_task_id ? `\n\nContinues task: #${task.continued_from_task_id}` : ''}\n\nThread: \`${task.thread_id}\`\n\nSession: ${task.thread_name}\n\nWorking directory: \`${task.repo_path}\`\n\n## Task\n\n${task.prompt}${attachmentSection}\n`,
      'utf8',
    );
  }

  updateTaskAssignment(task) {
    const path = join(this.taskDirectory(task.id), 'task.md');
    if (!existsSync(path)) return;
    const content = readFileSync(path, 'utf8')
      .replace(/^Thread: `.*`$/m, `Thread: \`${task.thread_id}\``)
      .replace(/^Session: .*$/m, `Session: ${task.thread_name}`);
    writeFileSync(path, content, 'utf8');
  }

  appendRawEvent(taskId, event) {
    const directory = this.taskDirectory(taskId);
    mkdirSync(directory, { recursive: true });
    appendFileSync(join(directory, 'events.jsonl'), `${JSON.stringify(event)}\n`, 'utf8');
  }

  stageAttachments(taskId, attachments, existingAttachments = []) {
    if (!attachments.length) {
      return [];
    }
    const taskDirectory = this.taskDirectory(taskId);
    const directory = join(taskDirectory, 'attachments');
    mkdirSync(directory, { recursive: true });
    const highestNumber = existingAttachments.reduce((highest, attachment) => {
      const match = String(attachment?.id || '').match(/^image-(\d+)$/);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);
    const metadata = attachments.map((attachment, index) => {
      const number = highestNumber + index + 1;
      const id = `image-${number}`;
      const fileName = `${String(number).padStart(2, '0')}.${attachment.extension}`;
      const path = join(directory, fileName);
      writeFileSync(path, attachment.data);
      return {
        id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.data.length,
        fileName,
        path,
      };
    });
    return metadata;
  }

  documentAttachments(taskId, metadata, heading = 'Reference images') {
    if (!metadata.length) return;
    const taskDirectory = this.taskDirectory(taskId);
    appendFileSync(
      join(taskDirectory, 'task.md'),
      `\n## ${heading}\n\n${metadata.map((item) => `- ${item.name} (${item.mimeType}, ${item.size} bytes)`).join('\n')}\n`,
      'utf8',
    );
  }

  discardAttachments(metadata) {
    for (const attachment of metadata) {
      if (typeof attachment?.path === 'string') rmSync(attachment.path, { force: true });
    }
  }

  writeAttachments(taskId, attachments) {
    const metadata = this.stageAttachments(taskId, attachments);
    this.documentAttachments(taskId, metadata);
    return metadata;
  }

  writePlan(taskId, plan) {
    const directory = this.taskDirectory(taskId);
    mkdirSync(directory, { recursive: true });
    writeFileAtomically(join(directory, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
    const finalPlan = typeof plan.finalPlan === 'string' ? plan.finalPlan.trim() : '';
    if (plan.status === 'complete' && finalPlan) {
      writeFileAtomically(this.planPath(taskId), `${finalPlan}\n`);
      rmSync(join(directory, 'result.md'), { force: true });
    } else {
      rmSync(this.planPath(taskId), { force: true });
    }
  }

  readPlan(taskId) {
    const filePath = join(this.taskDirectory(taskId), 'plan.json');
    if (!existsSync(filePath)) {
      return null;
    }
    return JSON.parse(readFileSync(filePath, 'utf8'));
  }

  writeTurboPlan(taskId, plan) {
    const directory = this.taskDirectory(taskId);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'turbo-plan.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  }

  readTurboPlan(taskId) {
    const filePath = join(this.taskDirectory(taskId), 'turbo-plan.json');
    return existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf8')) : null;
  }

  writeResult(taskId, result) {
    const directory = this.taskDirectory(taskId);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'result.md'), `${result.trim()}\n`, 'utf8');
    rmSync(join(directory, 'error.txt'), { force: true });
  }

  writeError(taskId, error) {
    const directory = this.taskDirectory(taskId);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'error.txt'), `${error.trim()}\n`, 'utf8');
  }

  clearOutcome(taskId, { preservePlan = false, preserveTurboPlan = false } = {}) {
    const directory = this.taskDirectory(taskId);
    rmSync(join(directory, 'result.md'), { force: true });
    rmSync(join(directory, 'error.txt'), { force: true });
    if (!preservePlan) {
      rmSync(join(directory, 'plan.json'), { force: true });
      rmSync(this.planPath(taskId), { force: true });
    }
    if (!preserveTurboPlan) {
      rmSync(join(directory, 'turbo-plan.json'), { force: true });
    }
  }

  deleteTask(taskId) {
    rmSync(this.taskDirectory(taskId), { recursive: true, force: true });
  }
}
