export function clipboardImageFiles(clipboardData) {
  const files = [...(clipboardData?.files || [])];
  const seen = new Set(files);
  for (const item of clipboardData?.items || []) {
    if (item.kind !== 'file' || !item.type?.startsWith('image/')) continue;
    const file = item.getAsFile?.();
    if (file && !seen.has(file)) {
      files.push(file);
      seen.add(file);
    }
  }
  return files.filter((file) => file.type?.startsWith('image/'));
}
