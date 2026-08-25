function sameOrigin(candidate, trustedOrigin) {
  try {
    return new URL(candidate).origin === trustedOrigin;
  } catch {
    return false;
  }
}

function trustedRequestOrigin(webContents, details = {}) {
  return details.requestingUrl
    || details.securityOrigin
    || webContents?.getURL?.()
    || '';
}

export function desktopPermissionAllowed({
  permission,
  requestingOrigin,
  webContents,
  details = {},
  rendererUrl,
  phase = 'request',
} = {}) {
  let trustedOrigin;
  try {
    trustedOrigin = new URL(rendererUrl).origin;
  } catch {
    return false;
  }
  const origin = requestingOrigin || trustedRequestOrigin(webContents, details);
  if (!sameOrigin(origin, trustedOrigin)) return false;
  if (permission === 'clipboard-sanitized-write') return true;
  if (permission !== 'media') return false;
  if (phase === 'check') return details.mediaType === 'audio';
  return Array.isArray(details.mediaTypes)
    && details.mediaTypes.includes('audio')
    && !details.mediaTypes.includes('video');
}

export function configureDesktopPermissions(browserSession, rendererUrl) {
  browserSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => (
    desktopPermissionAllowed({
      permission,
      requestingOrigin,
      webContents,
      details,
      rendererUrl,
      phase: 'check',
    })
  ));
  browserSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(desktopPermissionAllowed({
      permission,
      webContents,
      details,
      rendererUrl,
      phase: 'request',
    }));
  });
}
