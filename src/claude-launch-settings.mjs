import { dirname } from 'node:path';
import { normalizeClaudeModel } from './model-catalog.mjs';

// Claude Code applies model, effort, permission mode, tool allowlist, and extra readable
// directories as PROCESS LAUNCH options. There is no supported way to change them inside a live
// session, which is why CC Relay used to stop and relaunch a just-opened terminal before typing.
//
// This module is the single source of truth for those settings so the two places that need them
// cannot drift: `DisposableTerminalPool` computes them BEFORE the native launch so the first
// command already carries them, and `ClaudeTerminalExecutor` computes them again at turn time to
// decide whether a relaunch is still required. Both sides must derive from the same task row
// through the same function, otherwise "they match" would be an assumption instead of a fact.

export function selectedClaudeTerminalModel(model) {
  const selected = normalizeClaudeModel(model);
  return !selected || selected === 'default' ? null : selected;
}

// Absolute paths of the images CC Relay wrote for this task, in the order they are referenced in
// the delivered prompt. They are both the directories a plan-mode session must be able to read and
// the only path references Claude's composer is expected to rewrite.
export function claudeTaskAttachmentPaths(task) {
  return (task?.attachments || [])
    .map((attachment) => attachment?.path)
    .filter((path) => typeof path === 'string' && path);
}

export function claudeTerminalExecutionSettings(task) {
  const model = selectedClaudeTerminalModel(task.model);
  const effort = typeof task.effort === 'string' && task.effort.trim()
    ? task.effort.trim()
    : null;
  const permissionMode = task.terminal_permission_mode === 'plan' ? 'plan' : null;
  const tools = Array.isArray(task.terminal_tools)
    ? [...new Set(task.terminal_tools.filter((tool) => typeof tool === 'string' && tool.trim()).map((tool) => tool.trim()))]
    : [];
  const addDirectories = permissionMode === 'plan'
    ? [...new Set(claudeTaskAttachmentPaths(task).map((path) => dirname(path)))]
    : [];
  return {
    model,
    effort,
    permissionMode,
    tools,
    addDirectories,
    apply: Boolean(model || effort || permissionMode || tools.length || addDirectories.length),
  };
}

export function claudeCompleteLaunchSettings(task) {
  const { apply, ...settings } = claudeTerminalExecutionSettings(task);
  return apply ? settings : null;
}

// Direct Execute uses only the model and effort subset. Plan council builds its shared stage task
// first and passes claudeCompleteLaunchSettings() so its permission and tool contract also lands
// on the first provider process without duplicating those literals in the pool.
export function claudeFirstLaunchSettings(task) {
  const settings = claudeCompleteLaunchSettings(task);
  if (!settings) return null;
  if (settings.permissionMode || settings.tools.length || settings.addDirectories.length) {
    return null;
  }
  return { model: settings.model, effort: settings.effort };
}

// The structured fact recorded against one exact native launch: what that Claude process was
// actually started with. Never inferred from the screen, never re-derived from `ps`.
export function claudeLaunchSettingsRecord(launchSettings, hookSettings = null) {
  return {
    model: launchSettings?.model || null,
    effort: launchSettings?.effort || null,
    permissionMode: launchSettings?.permissionMode || null,
    tools: [...(launchSettings?.tools || [])],
    addDirectories: [...(launchSettings?.addDirectories || [])],
    hookSettingsJson: hookSettings ? JSON.stringify(hookSettings) : null,
  };
}

function sameList(left = [], right = []) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

// True only when the live process was provably started with exactly these settings. Every
// uncertainty (no record, a legacy launch, an adopted terminal, a retained terminal reused by a
// task with different settings, a differing hook payload) answers false and keeps the relaunch.
export function claudeLaunchSettingsMatch(recorded, settings, hookSettings = null) {
  if (!recorded || !settings) return false;
  return recorded.model === (settings.model || null)
    && recorded.effort === (settings.effort || null)
    && recorded.permissionMode === (settings.permissionMode || null)
    && sameList(recorded.tools, settings.tools || [])
    && sameList(recorded.addDirectories, settings.addDirectories || [])
    && recorded.hookSettingsJson === (hookSettings ? JSON.stringify(hookSettings) : null);
}
