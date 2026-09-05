// One file per clipboard item: alternate MIME representations describe the same image.
export async function readClipboardImageFiles(clipboard = globalThis.navigator?.clipboard) {
  const fallback = 'Paste directly into the message with Cmd+V or Ctrl+V, or choose an image file.';
  if (typeof clipboard?.read !== 'function') {
    throw new Error(`Clipboard image access is unavailable. ${fallback}`);
  }
  let items;
  try {
    items = await clipboard.read();
  } catch {
    throw new Error(`Could not read the clipboard. ${fallback}`);
  }
  const files = [];
  for (const item of items) {
    const type = ['image/png', 'image/jpeg', 'image/webp'].find((value) => item.types.includes(value));
    if (!type) continue;
    try {
      const blob = await item.getType(type);
      const extension = type === 'image/jpeg' ? 'jpg' : type.split('/')[1];
      files.push(new File([blob], `clipboard-${globalThis.crypto.randomUUID()}.${extension}`, { type }));
    } catch {
      throw new Error(`Could not read the clipboard image. ${fallback}`);
    }
  }
  if (files.length === 0) {
    throw new Error('No PNG, JPEG, or WebP image on the clipboard. Copy an image or screenshot first.');
  }
  return files;
}

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
