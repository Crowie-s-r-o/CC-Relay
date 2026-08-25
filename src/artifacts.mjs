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
import path, { dirname, join, resolve } from 'node:path';

/**
 * True when `candidate` is a real descendant of `root`.
 *
 * Containment guards must never be written as `candidate.startsWith(`${root}/`)`. A resolved
 * path uses the platform separator, so on Windows every such guard compares a `\` path against
 * a `/` prefix and rejects everything: the whole UI 404s and no task image can be served.
 * `path.relative` is separator-correct on both platforms, and because `resolve` has already
 * folded `..` and both separator forms before the comparison, an escaping candidate always
 * surfaces here as a leading `..` segment or as an absolute path on another Windows drive.
 *
 * `root` itself is deliberately not inside itself, matching the guard this replaces.
 * A sibling directory whose name merely starts with the root's name (`public` and
 * `publicfoo`) is rejected, while a legitimate child whose own name starts with dots
 * (`..foo`) is kept, which a naive `startsWith('..')` test would lose.
 *
 * `pathModule` is injectable so the win32 semantics can be proven from any host platform.
 */
export function isPathInside(root, candidate, pathModule = path) {
  const relativePath = pathModule.relative(root, candidate);
  if (!relativePath || pathModule.isAbsolute(relativePath)) return false;
  return relativePath !== '..' && !relativePath.startsWith(`..${pathModule.sep}`);
}

function writeFileAtomically(filePath, content) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporaryPath, filePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function readFileIfPresent(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

// Plan council stage deliverables. Each completed stage gets one durable Markdown file
// beside the canonical plan.md in the task's own project folder, so an expensive stage
// survives a lost, truncated, or partially written plan.json checkpoint. The final
// revision is not listed here: it stays the canonical plan.md.
const PLAN_STAGE_FILES = Object.freeze({ draft: 'draft.md', review: 'review.md' });
const PLAN_STAGES = Object.freeze(Object.keys(PLAN_STAGE_FILES));

export class ArtifactStore {
  constructor(rootPath) {
    this.rootPath = rootPath;
    mkdirSync(rootPath, { recursive: true });
  }

  taskDirectory(taskId) {
    return join(this.rootPath, String(taskId));
  }

  planFilePath(taskId, fileName, repoPath = null) {
    if (typeof repoPath === 'string' && repoPath.trim()) {
      return resolve(repoPath, '.data', 'tasks', String(taskId), fileName);
    }
    return join(this.taskDirectory(taskId), fileName);
  }

  planPath(taskId, repoPath = null) {
    return this.planFilePath(taskId, 'plan.md', repoPath);
  }

  /** Absolute path of one council stage file, or null for an unknown stage. */
  planStagePath(taskId, stage, repoPath = null) {
    const fileName = PLAN_STAGE_FILES[stage];
    return fileName ? this.planFilePath(taskId, fileName, repoPath) : null;
  }

  initializeTask(task) {
    const directory = this.taskDirectory(task.id);
    mkdirSync(directory, { recursive: true });
    const execution = task.mode === 'plan'
      ? `Mode: plan council\n\nRoute: ${task.author_provider} → ${task.reviewer_provider} → ${task.author_provider}\n\nAuthor: ${task.author_provider} / ${task.author_model} / ${task.author_effort}\n\nClaude terminal: \`${task.author_thread_id || 'unassigned'}\` / ${task.author_thread_name || 'unassigned'}\n\nReviewer: ${task.reviewer_provider} / ${task.reviewer_model} / ${task.reviewer_effort}`
      : task.mode === 'turbo'
        ? `Mode: forward-planning turbo\n\nPlanner: ${task.turbo?.plannerModel} / ${task.turbo?.plannerEffort}\n\n${task.terminal_lifecycle === 'disposable' ? 'Concurrent executions' : 'Workers'}: ${task.turbo?.workerCount} / ${task.turbo?.workerModel} / ${task.turbo?.workerEffort}${(task.turbo?.council?.enabled || task.turbo?.councilEnabled) ? `\n\nCouncil: ${(task.turbo?.council?.order || ['codex', 'claude']).map((provider) => provider === 'claude' ? 'Claude' : 'Codex').join(' → ')}\nAuthor: ${task.turbo?.council?.authorModel || 'configured model'} / ${task.turbo?.council?.authorEffort || 'model default'}\nReviewer: ${task.turbo?.council?.reviewerModel || 'configured model'} / ${task.turbo?.council?.reviewerEffort || 'model default'}\nCouncil status: pending` : ''}`
      : `Mode: execute\n\nProvider: ${task.provider || 'codex'}\n\nModel: ${task.model || 'session default'}\n\nEffort: ${task.effort || 'model default'}\n\nCompletion: ${task.manual_completion ? 'manual terminal session' : 'automatic'}\n\nContext: ${task.terminal_lifecycle === 'disposable'
        ? task.continued_from_task_id ? 'launch disposable terminal and resume saved conversation' : 'launch fresh disposable terminal'
        : 'resume selected session'}`;
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

  updateTaskTitle(task) {
    const filePath = join(this.taskDirectory(task.id), 'task.md');
    const content = readFileIfPresent(filePath);
    if (content === null) {
      this.initializeTask(task);
      return;
    }
    const heading = `# ${task.title}`;
    const updated = /^# .*$/m.test(content)
      ? content.replace(/^# .*$/m, () => heading)
      : `${heading}\n\n${content}`;
    if (updated !== content) writeFileAtomically(filePath, updated);
  }

  updateTaskAssignment(task) {
    const path = join(this.taskDirectory(task.id), 'task.md');
    if (!existsSync(path)) return;
    const content = readFileSync(path, 'utf8')
      .replace(/^Thread: `.*`$/m, `Thread: \`${task.thread_id}\``)
      .replace(/^Session: .*$/m, `Session: ${task.thread_name}`);
    writeFileSync(path, content, 'utf8');
  }

  updateCouncilAuthorAssignment(task) {
    const path = join(this.taskDirectory(task.id), 'task.md');
    if (!existsSync(path)) return;
    const content = readFileSync(path, 'utf8')
      .replace(
        /^(?:Author|Claude) terminal: `.*` \/ .*$/m,
        `Claude terminal: \`${task.author_thread_id || 'unassigned'}\` / ${task.author_thread_name || 'unassigned'}`,
      );
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

  /** Stage file each stage of this record should own, or null when it has no text yet. */
  planStageTargets(taskId, plan, repoPath = null) {
    const targets = {};
    for (const stage of PLAN_STAGES) {
      const value = typeof plan?.[stage] === 'string' ? plan[stage].trim() : '';
      targets[stage] = value ? this.planStagePath(taskId, stage, repoPath) : null;
    }
    return targets;
  }

  /**
   * Remove every stage file this record does not own, plus any legacy CC Relay-local copy.
   *
   * Runs before the checkpoint that disowns them. A stale stage file must never outlive
   * its record: a fresh record beside a stale draft.md is exactly the state a resume would
   * read as a saved draft, and a hard process death between the two writes is enough to
   * create it. Deleting text the record does not hold cannot lose earned work, so this is
   * the one part of the persist that is safe ahead of the checkpoint.
   */
  removePlanStages(taskId, targets, repoPath = null) {
    for (const stage of PLAN_STAGES) {
      const filePath = this.planStagePath(taskId, stage, repoPath);
      const legacyPath = this.planStagePath(taskId, stage);
      try {
        if (!targets[stage]) {
          rmSync(filePath, { force: true });
        }
        if (legacyPath !== filePath) {
          rmSync(legacyPath, { force: true });
        }
      } catch {
        // Best effort for the same reason the writes are. See writePlanStages.
      }
    }
  }

  /**
   * Persist one Markdown file per completed council stage next to plan.md.
   *
   * Driven by the stage text the record actually holds, so a stage file appears exactly
   * when its stage completes and a resumed council backfills a file the record already
   * has. Identical content is never rewritten: every checkpoint would otherwise touch
   * mtimes inside the user's repository and wake their file watchers for nothing.
   *
   * Deliberately best effort. These files live in the user's project, which can be
   * read-only, missing, or occupied, and before stage files existed such a project could
   * not fail a draft or review checkpoint. It still cannot: the text is already durable
   * in plan.json, a refused write is reported as an absent path, and the next persist or
   * resume backfills the file once the folder accepts writes again. Only the final
   * plan.md write still fails the task, exactly as it did before.
   * Returns the paths that actually exist, which is what the task payload reports.
   */
  writePlanStages(taskId, plan, repoPath = null) {
    const targets = this.planStageTargets(taskId, plan, repoPath);
    const written = {};
    for (const stage of PLAN_STAGES) {
      written[stage] = null;
      if (!targets[stage]) continue;
      try {
        const content = `${plan[stage].trim()}\n`;
        if (readFileIfPresent(targets[stage]) !== content) {
          mkdirSync(dirname(targets[stage]), { recursive: true });
          writeFileAtomically(targets[stage], content);
        }
        written[stage] = targets[stage];
      } catch {
        written[stage] = null;
      }
    }
    return written;
  }

  /** Saved text of one council stage file, or an empty string when there is none. */
  readPlanStage(taskId, stage, repoPath = null) {
    const filePath = this.planStagePath(taskId, stage, repoPath);
    if (!filePath) return '';
    const content = readFileIfPresent(filePath);
    return typeof content === 'string' ? content.trim() : '';
  }

  writePlan(taskId, plan, { repoPath = null } = {}) {
    const directory = this.taskDirectory(taskId);
    const artifactPath = this.planPath(taskId, repoPath);
    const legacyArtifactPath = this.planPath(taskId);
    mkdirSync(directory, { recursive: true });
    const writeCheckpoint = (stageArtifacts) => writeFileAtomically(
      join(directory, 'plan.json'),
      // Never trust an incoming stageArtifacts value, or a moved project leaves a stale
      // path in the record and in the task payload.
      `${JSON.stringify({ ...plan, artifactPath, stageArtifacts }, null, 2)}\n`,
    );
    const intended = this.planStageTargets(taskId, plan, repoPath);
    // Deletions first: a stale stage file may never survive the record that disowns it,
    // and losing a file the record does not hold costs nothing.
    this.removePlanStages(taskId, intended, repoPath);
    // Then the checkpoint, before anything writes into the user's project. A stage that
    // just completed can never lose its text to a folder that refuses writes, and a crash
    // between these steps resumes from the checkpoint and backfills the files.
    writeCheckpoint(intended);
    const stageArtifacts = this.writePlanStages(taskId, plan, repoPath);
    // Keep the record honest when the project folder refused one of those writes.
    if (PLAN_STAGES.some((stage) => stageArtifacts[stage] !== intended[stage])) {
      writeCheckpoint(stageArtifacts);
    }
    const finalPlan = typeof plan.finalPlan === 'string' ? plan.finalPlan.trim() : '';
    if (plan.status === 'complete' && finalPlan) {
      mkdirSync(dirname(artifactPath), { recursive: true });
      writeFileAtomically(artifactPath, `${finalPlan}\n`);
      if (legacyArtifactPath !== artifactPath) {
        rmSync(legacyArtifactPath, { force: true });
      }
      rmSync(join(directory, 'result.md'), { force: true });
    } else {
      rmSync(artifactPath, { force: true });
      if (legacyArtifactPath !== artifactPath) {
        rmSync(legacyArtifactPath, { force: true });
      }
    }
  }

  readPlan(taskId) {
    const filePath = join(this.taskDirectory(taskId), 'plan.json');
    if (!existsSync(filePath)) {
      return null;
    }
    try {
      return JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
      // A truncated or unreadable checkpoint must not take down Task Activity or the
      // Resume route. The council falls back to its per-stage Markdown files.
      return null;
    }
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

  clearOutcome(taskId, {
    preservePlan = false,
    preserveTurboPlan = false,
    repoPath = null,
  } = {}) {
    const directory = this.taskDirectory(taskId);
    rmSync(join(directory, 'result.md'), { force: true });
    rmSync(join(directory, 'error.txt'), { force: true });
    if (!preservePlan) {
      rmSync(join(directory, 'plan.json'), { force: true });
      rmSync(this.planPath(taskId), { force: true });
      // The stage files are a resume source, so a discarded plan must discard them too.
      // Editing a queued council clears the outcome without preserving the plan, and a
      // stale draft.md would otherwise be restored against the new brief.
      for (const stage of PLAN_STAGES) {
        rmSync(this.planStagePath(taskId, stage), { force: true });
      }
      if (repoPath) {
        rmSync(this.planPath(taskId, repoPath), { force: true });
        for (const stage of PLAN_STAGES) {
          rmSync(this.planStagePath(taskId, stage, repoPath), { force: true });
        }
      }
    }
    if (!preserveTurboPlan) {
      rmSync(join(directory, 'turbo-plan.json'), { force: true });
    }
  }

  deleteTask(taskId, { repoPath = null } = {}) {
    if (repoPath) {
      rmSync(this.planPath(taskId, repoPath), { force: true });
      for (const stage of PLAN_STAGES) {
        rmSync(this.planStagePath(taskId, stage, repoPath), { force: true });
      }
    }
    rmSync(this.taskDirectory(taskId), { recursive: true, force: true });
  }
}
