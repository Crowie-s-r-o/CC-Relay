export function clipboardImageFiles(clipboardData) {
  const files = [...(clipboardData?.files || [])]
    .filter((file) => file.type?.startsWith('image/'));
  const seenFiles = new Set(files);
  const seenMetadata = new Set(files.map((file) => [
    file.name,
    file.type,
    file.size,
    file.lastModified,
  ].join('\0')));

  for (const item of clipboardData?.items || []) {
    if (item.kind !== 'file' || !item.type?.startsWith('image/')) continue;
    const file = item.getAsFile?.();
    if (!file || seenFiles.has(file)) continue;

    // Chromium can expose one pasted image through both DataTransfer.files and
    // DataTransfer.items while returning a different File wrapper for each view.
    // Compare the stable File metadata so the second wrapper is not presented to
    // the composer as another image.
    const metadata = [
      file.name,
      file.type,
      file.size,
      file.lastModified,
    ].join('\0');
    if (seenMetadata.has(metadata)) continue;

    files.push(file);
    seenFiles.add(file);
    seenMetadata.add(metadata);
  }

  return files;
}
