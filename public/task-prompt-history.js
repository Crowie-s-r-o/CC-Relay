function cleanPrompt(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeTaskPrompts(task, prompts = []) {
  const normalized = (Array.isArray(prompts) ? prompts : [])
    .map((prompt, index) => ({
      id: prompt?.id || `prompt-${index + 1}`,
      kind: prompt?.kind === 'original' ? 'original' : 'follow-up',
      text: cleanPrompt(prompt?.text),
      created_at: prompt?.created_at || null,
    }))
    .filter((prompt) => prompt.text);
  const originalText = cleanPrompt(task?.prompt);
  const originalIndex = normalized.findIndex((prompt) => prompt.kind === 'original');
  if (originalIndex >= 0) {
    normalized[originalIndex] = {
      ...normalized[originalIndex],
      text: originalText || normalized[originalIndex].text,
    };
    if (originalIndex > 0) {
      normalized.unshift(normalized.splice(originalIndex, 1)[0]);
    }
  } else if (originalText) {
    normalized.unshift({
      id: `task-${task?.id || 'unknown'}-original`,
      kind: 'original',
      text: originalText,
      created_at: task?.created_at || null,
    });
  }
  return normalized;
}

export function taskPromptHistoryText(prompts) {
  return prompts.map((prompt, index) => {
    const number = String(index + 1).padStart(2, '0');
    const label = prompt.kind === 'original' ? 'Original request' : `Follow-up ${index}`;
    return `${number} · ${label}\n${prompt.text}`;
  }).join('\n\n');
}

// The numbered labels belong to the Task Activity presentation, not to the user's
// request. Clipboard text stays reusable by carrying only the authored prompt bodies.
export function taskPromptCopyText(prompts) {
  return (Array.isArray(prompts) ? prompts : [])
    .map((prompt) => cleanPrompt(prompt?.text))
    .filter(Boolean)
    .join('\n\n');
}

export function taskPromptHistoryPreview(prompts, maxLength = 96) {
  if (!prompts.length) return 'No prompts recorded';
  const latest = prompts.at(-1).text.replace(/\s+/g, ' ').trim();
  const prefix = prompts.length === 1 ? '1 prompt' : `${prompts.length} prompts`;
  if (latest.length <= maxLength) return `${prefix} · ${latest}`;
  return `${prefix} · ${latest.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
