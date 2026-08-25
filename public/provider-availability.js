const PROVIDERS = ['codex', 'claude', 'opencode'];

export function providerInstallationState(status, provider) {
  const runtime = status?.[provider];
  if (!runtime || runtime.pending === true) return 'checking';
  if (runtime.available === true) return 'installed';
  return runtime.reason === 'not_installed' ? 'missing' : 'checking';
}

export function providerIsInstalled(status, provider) {
  return providerInstallationState(status, provider) === 'installed';
}

/**
 * Keep a user's selection while it is installed or still being checked. Once it is
 * confirmed missing, prefer the first installed alternative. If every provider is
 * missing, keep the current value so the composer can show one stable, disabled choice.
 */
export function availableProviderSelection(status, currentProvider) {
  if (providerInstallationState(status, currentProvider) !== 'missing') {
    return currentProvider;
  }
  return PROVIDERS.find((provider) => providerIsInstalled(status, provider))
    || currentProvider;
}
