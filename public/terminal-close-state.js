export function terminalClosePresentation({
  supported,
  threadLabel = null,
  control = null,
  closing = false,
}) {
  if (!supported) {
    return {
      state: 'unavailable',
      label: threadLabel ? `Close ${threadLabel}` : 'Close selected terminal',
      reason: 'Restart CC Relay after running tasks finish to activate Close. On macOS, existing one-tab Terminal sessions will be detected automatically.',
      buttonLabel: 'Restart required',
      disabled: true,
    };
  }
  if (!threadLabel) {
    return {
      state: 'unavailable',
      label: 'Close selected terminal',
      reason: 'Select a terminal to see whether CC Relay owns its native window.',
      buttonLabel: 'Close selected',
      disabled: true,
    };
  }
  if (closing) {
    return {
      state: 'closing',
      label: `Closing ${threadLabel}`,
      reason: `Closing ${threadLabel} and its native terminal window.`,
      buttonLabel: 'Closing',
      disabled: true,
    };
  }
  if (control?.canClose === true) {
    return {
      state: 'ready',
      label: `Close ${threadLabel}`,
      reason: `CC Relay owns the exact native window for ${threadLabel}.`,
      buttonLabel: 'Close selected',
      disabled: false,
    };
  }
  if (control?.reason) {
    return {
      state: control.owned ? 'blocked' : 'unavailable',
      label: `Close ${threadLabel}`,
      reason: control.owned
        ? control.reason
        : `${control.reason} Keep it in its own native terminal or relaunch it with CC Relay.`,
      buttonLabel: 'Close selected',
      disabled: true,
    };
  }
  return {
    state: 'unavailable',
    label: `Close ${threadLabel}`,
    reason: `CC Relay has not reported ownership for ${threadLabel}. Refresh the session list or relaunch it with CC Relay.`,
    buttonLabel: 'Close selected',
    disabled: true,
  };
}
