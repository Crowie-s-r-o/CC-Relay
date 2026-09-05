// Foreground an existing OS terminal. This never starts a CLI, sends input, or reads output.
// Windows launch identity includes creation time so a recycled PID cannot select another app.
export function windowsTerminalOpenScript({ terminalProcessId, terminalProcessStartedAt }) {
  if (!Number.isSafeInteger(terminalProcessId) || terminalProcessId <= 0
    || !/^\d{15,20}$/.test(terminalProcessStartedAt || '')) return null;
  return `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RelayOriginalTerminal {
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
$target = Get-Process -Id ${terminalProcessId}
try {
  $null = $target.Handle
  if ($target.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() -cne '${terminalProcessStartedAt}') { throw 'The terminal process changed.' }
  $handle = $target.MainWindowHandle
  if ($handle -eq [IntPtr]::Zero) { throw 'This terminal host does not expose an exact window.' }
  [uint32]$windowProcess = 0
  $null = [RelayOriginalTerminal]::GetWindowThreadProcessId($handle, [ref]$windowProcess)
  $target.Refresh()
  if ($target.HasExited -or $windowProcess -ne ${terminalProcessId} -or $target.MainWindowHandle -ne $handle) { throw 'The terminal window changed.' }
  $null = [RelayOriginalTerminal]::ShowWindowAsync($handle, 9)
  $null = [RelayOriginalTerminal]::SetForegroundWindow($handle)
  if ([RelayOriginalTerminal]::GetForegroundWindow() -ne $handle) { throw 'Windows did not allow the terminal to take focus. Select it from the taskbar.' }
  'opened'
} finally { $target.Dispose() }
`;
}

export async function openNativeTerminal({ platform, run, terminal }) {
  if (platform === 'darwin') {
    const windowId = Number(terminal.terminalWindowId);
    const tty = terminal.terminalTty;
    if (!Number.isSafeInteger(windowId) || windowId <= 0 || !/^\/dev\/[a-zA-Z0-9/_-]+$/.test(tty || '')) {
      throw new Error('The original terminal identity could not be verified.');
    }
    const script = `tell application "Terminal"
if not running then error "The original terminal is closed."
if not (exists window id ${windowId}) then error "The original terminal is closed."
set targetWindow to window id ${windowId}
if (count of tabs of targetWindow) is not 1 then error "The terminal now contains multiple tabs."
if (tty of first tab of targetWindow) is not ${JSON.stringify(tty)} then error "The terminal identity changed."
set visible of targetWindow to true
set miniaturized of targetWindow to false
activate
set index of targetWindow to 1
end tell`;
    try {
      await run('osascript', ['-e', script], { timeout: 5_000 });
    } catch (cause) {
      throw new Error('Terminal.app could not open the original window. It may have closed, changed tabs, or denied automation.', { cause });
    }
    return;
  }
  if (platform === 'win32') {
    const script = windowsTerminalOpenScript(terminal);
    if (!script) throw new Error('The original Windows terminal identity could not be verified.');
    let stdout;
    try {
      ({ stdout = '' } = await run('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
      ], { timeout: 8_000, windowsHide: true }));
    } catch (cause) {
      throw new Error('Windows could not foreground the verified terminal. It may have closed or changed. Select it from the taskbar if it is still open.', { cause });
    }
    if (stdout.trim() !== 'opened') throw new Error('Windows could not show the original terminal.');
    return;
  }
  throw new Error('Opening the original terminal is supported on macOS and Windows.');
}
