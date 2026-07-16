import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export class ArtifactStore {
  constructor(rootPath) {
    this.rootPath = rootPath;
    mkdirSync(rootPath, { recursive: true });
  }

  taskDirectory(taskId) {
    return join(this.rootPath, String(taskId));
  }

  initializeTask(task) {
    const directory = this.taskDirectory(task.id);
    mkdirSync(directory, { recursive: true });
    const execution = task.mode === 'plan'
      ? `Mode: plan council\n\nAuthor: ${task.author_provider} / ${task.author_model} / ${task.author_effort}\n\nReviewer: ${task.reviewer_provider} / ${task.reviewer_model} / ${task.reviewer_effort}`
      : task.mode === 'turbo'
        ? `Mode: forward-planning turbo\n\nPlanner: ${task.turbo?.plannerModel} / ${task.turbo?.plannerEffort}\n\nWorkers: ${task.turbo?.workerCount} / ${task.turbo?.workerModel} / ${task.turbo?.workerEffort}`
      : `Mode: execute\n\nProvider: ${task.provider || 'codex'}\n\nModel: ${task.model || 'session default'}\n\nEffort: ${task.effort || 'model default'}`;
    writeFileSync(
      join(directory, 'task.md'),
      `# ${task.title}\n\n${execution}\n\nThread: \`${task.thread_id}\`\n\nSession: ${task.thread_name}\n\nWorking directory: \`${task.repo_path}\`\n\n## Task\n\n${task.prompt}\n`,
      'utf8',
    );
  }

  appendRawEvent(taskId, event) {
    const directory = this.taskDirectory(taskId);
    mkdirSync(directory, { recursive: true });
    appendFileSync(join(directory, 'events.jsonl'), `${JSON.stringify(event)}\n`, 'utf8');
  }

  writeAttachments(taskId, attachments) {
    if (!attachments.length) {
      return [];
    }
    const taskDirectory = this.taskDirectory(taskId);
    const directory = join(taskDirectory, 'attachments');
    mkdirSync(directory, { recursive: true });
    const metadata = attachments.map((attachment, index) => {
      const id = `image-${index + 1}`;
      const fileName = `${String(index + 1).padStart(2, '0')}.${attachment.extension}`;
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
    appendFileSync(
      join(taskDirectory, 'task.md'),
      `\n## Reference images\n\n${metadata.map((item) => `- ${item.name} (${item.mimeType}, ${item.size} bytes)`).join('\n')}\n`,
      'utf8',
    );
    return metadata;
  }

  writePlan(taskId, plan) {
    const directory = this.taskDirectory(taskId);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    const stageStatus = plan.stages
      .map((stage) => `- ${stage.label}: ${stage.status}`)
      .join('\n');
    const attachmentList = plan.attachments?.length
      ? plan.attachments.map((attachment) => `- ${attachment.name}: \`${attachment.path}\``).join('\n')
      : '_No reference images._';
    const markdown = `# Two-agent implementation plan

Status: ${plan.status}

## Council

- Author: ${plan.author.provider} / ${plan.author.model} / ${plan.author.effort}
- Reviewer: ${plan.reviewer.provider} / ${plan.reviewer.model} / ${plan.reviewer.effort}

${stageStatus}

## Original brief

${plan.brief}

## Reference images

${attachmentList}

## Claude draft

${plan.draft || '_Waiting for the first draft._'}

## Codex review

${plan.review || '_Waiting for the independent review._'}

## Final revised plan

${plan.finalPlan || '_Waiting for the final revision._'}
`;
    writeFileSync(join(directory, 'plan.md'), markdown, 'utf8');
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

  clearOutcome(taskId) {
    const directory = this.taskDirectory(taskId);
    rmSync(join(directory, 'result.md'), { force: true });
    rmSync(join(directory, 'error.txt'), { force: true });
    rmSync(join(directory, 'plan.json'), { force: true });
    rmSync(join(directory, 'plan.md'), { force: true });
    rmSync(join(directory, 'turbo-plan.json'), { force: true });
  }

  deleteTask(taskId) {
    rmSync(this.taskDirectory(taskId), { recursive: true, force: true });
  }
}
