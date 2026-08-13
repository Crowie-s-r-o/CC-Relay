export const MACOS_TITLEBAR_MODE = 'hidden-inset-v1';

export function desktopTitlebarOptions(platform) {
  return platform === 'darwin'
    ? { titleBarStyle: 'hiddenInset' }
    : {};
}

export function desktopRendererUrl(endpointUrl, platform) {
  const url = new URL(endpointUrl);
  if (platform === 'darwin') {
    url.searchParams.set('desktopTitlebar', MACOS_TITLEBAR_MODE);
  }
  return url.href;
}
