export const MAX_TASK_TITLE_LENGTH = 120;

export function titleFromPrompt(prompt) {
  const compact = String(prompt || '').replace(/\s+/g, ' ').trim();
  return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
}

export function taskTitleFromInput(value, prompt) {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error('Task name must be text.');
  }
  const title = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (title.length > MAX_TASK_TITLE_LENGTH) {
    throw new Error(`Task name must be ${MAX_TASK_TITLE_LENGTH} characters or fewer.`);
  }
  return title || titleFromPrompt(prompt);
}
