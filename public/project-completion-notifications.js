const DEFAULT_STORAGE_KEY = 'relay.projectCompletionNotifications.v1';

function normalizedProjectPath(path) {
  return String(path || '').replace(/[\\/]+$/, '').replaceAll('\\', '/');
}

function taskId(task) {
  const id = Number(task?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function cloneProjectTaskMap(value) {
  const result = new Map();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [path, items] of Object.entries(value)) {
    const normalizedPath = normalizedProjectPath(path);
    if (!normalizedPath || !items || typeof items !== 'object' || Array.isArray(items)) continue;
    const projectItems = new Map();
    for (const [id, item] of Object.entries(items)) {
      const normalizedId = Number(id);
      if (!Number.isInteger(normalizedId) || normalizedId <= 0) continue;
      projectItems.set(normalizedId, item);
    }
    if (projectItems.size) result.set(normalizedPath, projectItems);
  }
  return result;
}

function serializedProjectTaskMap(map) {
  return Object.fromEntries([...map.entries()]
    .filter(([, items]) => items.size > 0)
    .map(([path, items]) => [path, Object.fromEntries(items)]));
}

export class ProjectCompletionNotifications {
  constructor(storage = null, storageKey = DEFAULT_STORAGE_KEY) {
    this.storage = storage;
    this.storageKey = storageKey;
    this.initialized = false;
    this.unread = new Map();
    this.previousStatuses = new Map();
    this.restore();
  }

  restore() {
    if (!this.storage) return;
    try {
      const saved = JSON.parse(this.storage.getItem(this.storageKey) || 'null');
      if (!saved || saved.version !== 1) return;
      this.initialized = saved.initialized === true;
      this.unread = cloneProjectTaskMap(saved.unread);
      this.previousStatuses = cloneProjectTaskMap(saved.unfinished);
    } catch {
      this.initialized = false;
      this.unread = new Map();
      this.previousStatuses = new Map();
    }
  }

  persist() {
    if (!this.storage) return;
    const unfinished = new Map();
    for (const [path, statuses] of this.previousStatuses) {
      const pending = new Map([...statuses].filter(([, status]) => status !== 'complete'));
      if (pending.size) unfinished.set(path, pending);
    }
    try {
      this.storage.setItem(this.storageKey, JSON.stringify({
        version: 1,
        initialized: this.initialized,
        unread: serializedProjectTaskMap(this.unread),
        unfinished: serializedProjectTaskMap(unfinished),
      }));
    } catch {
      // Notifications are helpful but must never prevent the task list from refreshing.
    }
  }

  observe(tasks, { activeProjectPath = null, selectedTaskId = null } = {}) {
    const nextStatuses = new Map();
    const currentTaskIds = new Map();
    let changed = false;
    const activePath = normalizedProjectPath(activeProjectPath);
    const selectedId = Number(selectedTaskId);

    for (const task of tasks || []) {
      const path = normalizedProjectPath(task?.repo_path);
      const id = taskId(task);
      if (!path || !id) continue;
      if (!nextStatuses.has(path)) nextStatuses.set(path, new Map());
      nextStatuses.get(path).set(id, task.status);
      if (!currentTaskIds.has(path)) currentTaskIds.set(path, new Set());
      currentTaskIds.get(path).add(id);

      const previousStatus = this.previousStatuses.get(path)?.get(id);
      const activelyChecked = path === activePath && id === selectedId;
      if (
        this.initialized
        && previousStatus
        && previousStatus !== 'complete'
        && task.status === 'complete'
        && !activelyChecked
      ) {
        if (!this.unread.has(path)) this.unread.set(path, new Map());
        if (!this.unread.get(path).has(id)) {
          this.unread.get(path).set(id, true);
          changed = true;
        }
      }
      if ((task.status !== 'complete' || activelyChecked) && this.remove(path, id, false)) {
        changed = true;
      }
    }

    for (const [path, items] of this.unread) {
      const existing = currentTaskIds.get(path) || new Set();
      for (const id of items.keys()) {
        if (!existing.has(id)) {
          items.delete(id);
          changed = true;
        }
      }
      if (!items.size) this.unread.delete(path);
    }

    this.previousStatuses = nextStatuses;
    if (!this.initialized) {
      this.initialized = true;
      changed = true;
    }
    if (changed || this.storage) this.persist();
  }

  acknowledge(task) {
    if (task?.status !== 'complete') return false;
    return this.remove(task.repo_path, taskId(task));
  }

  acknowledgeProject(path) {
    const normalizedPath = normalizedProjectPath(path);
    const count = this.unread.get(normalizedPath)?.size || 0;
    if (!count) return 0;
    this.unread.delete(normalizedPath);
    this.persist();
    return count;
  }

  remove(path, id, persist = true) {
    const normalizedPath = normalizedProjectPath(path);
    const items = this.unread.get(normalizedPath);
    if (!items || !items.delete(Number(id))) return false;
    if (!items.size) this.unread.delete(normalizedPath);
    if (persist) this.persist();
    return true;
  }

  count(path) {
    return this.unread.get(normalizedProjectPath(path))?.size || 0;
  }

  includes(path, id) {
    return this.unread.get(normalizedProjectPath(path))?.has(Number(id)) || false;
  }

  latestTaskId(path) {
    const ids = [...(this.unread.get(normalizedProjectPath(path))?.keys() || [])];
    return ids.length ? Math.max(...ids) : null;
  }
}
