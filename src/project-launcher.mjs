import { execFile as execFileCallback } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
export const CODEX_RELAY_COMMAND = 'codex --dangerously-bypass-approvals-and-sandbox --remote ws://127.0.0.1:4769';
export const CLAUDE_RELAY_COMMAND = 'claude --dangerously-skip-permissions';

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

export function powershellQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function normalizeTerminalLayout(layout) {
  if (!layout?.enabled) return null;
  const rows = Number(layout.rows);
  const columns = Number(layout.columns);
  const display = Number(layout.display);
  if (!Number.isInteger(rows) || rows < 1 || rows > 8
    || !Number.isInteger(columns) || columns < 1 || columns > 8) {
    throw new Error('Terminal grid rows and columns must be whole numbers from 1 to 8.');
  }
  return {
    enabled: true,
    rows,
    columns,
    display: Number.isInteger(display) && display >= 0 ? display : 0,
  };
}

export function gridBounds(display, layout, slot) {
  const width = Math.floor(display.width / layout.columns);
  const height = Math.floor(display.height / layout.rows);
  const column = slot % layout.columns;
  const row = Math.floor(slot / layout.columns) % layout.rows;
  const left = display.x + column * width;
  const top = display.y + row * height;
  return {
    left,
    top,
    right: column === layout.columns - 1 ? display.x + display.width : left + width,
    bottom: row === layout.rows - 1 ? display.y + display.height : top + height,
  };
}

function boundsOverlapArea(left, right) {
  const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  return width * height;
}

export function firstAvailableGridSlot(display, layout, windowBounds) {
  const slotCount = layout.rows * layout.columns;
  const occupied = new Set();
  for (const bounds of windowBounds) {
    let bestSlot = null;
    let bestOverlap = 0;
    for (let slot = 0; slot < slotCount; slot += 1) {
      const overlap = boundsOverlapArea(bounds, gridBounds(display, layout, slot));
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestSlot = slot;
      }
    }
    if (bestSlot !== null && bestOverlap > 0) occupied.add(bestSlot);
  }
  for (let slot = 0; slot < slotCount; slot += 1) {
    if (!occupied.has(slot)) return slot;
  }
  return null;
}

export function validateProjectPath(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) {
    throw new Error('Choose an absolute project folder.');
  }
  const resolved = realpathSync(path);
  if (!statSync(resolved).isDirectory()) {
    throw new Error('The selected project path is not a folder.');
  }
  return { path: resolved, name: basename(resolved) || resolved };
}

export function terminalCommand(path, provider) {
  if (!['codex', 'claude'].includes(provider)) {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }
  const command = provider === 'codex' ? CODEX_RELAY_COMMAND : CLAUDE_RELAY_COMMAND;
  return `cd ${shellQuote(path)} && ${command}`;
}

export class ProjectLauncher {
  constructor({ run = execFile, platform = process.platform, diagnostic = () => {} } = {}) {
    this.run = run;
    this.platform = platform;
    this.diagnostic = diagnostic;
    this.gridSlots = new Map();
  }

  async listDisplays() {
    this.ensureSupported();
    if (this.platform === 'win32') {
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$screens = [System.Windows.Forms.Screen]::AllScreens | ForEach-Object {',
        '[PSCustomObject]@{ name = $_.DeviceName; x = $_.WorkingArea.X; y = $_.WorkingArea.Y; width = $_.WorkingArea.Width; height = $_.WorkingArea.Height; primary = $_.Primary }',
        '}',
        '$screens | ConvertTo-Json -Compress',
      ].join('; ');
      const { stdout } = await this.run('powershell.exe', ['-NoProfile', '-Command', script]);
      const parsed = JSON.parse(stdout.trim() || '[]');
      return Array.isArray(parsed) ? parsed : [parsed];
    }
    const script = `ObjC.import('AppKit');
const screens = $.NSScreen.screens.js;
const maxY = Math.max(...screens.map((screen) => screen.frame.origin.y + screen.frame.size.height));
JSON.stringify(screens.map((screen, index) => {
  const frame = screen.visibleFrame;
  return {
    name: ObjC.unwrap(screen.localizedName) || \`Display \${index + 1}\`,
    x: Math.round(frame.origin.x),
    y: Math.round(maxY - frame.origin.y - frame.size.height),
    width: Math.round(frame.size.width),
    height: Math.round(frame.size.height),
    primary: index === 0,
  };
}));`;
    const { stdout } = await this.run('osascript', ['-l', 'JavaScript', '-e', script]);
    return JSON.parse(stdout.trim() || '[]');
  }

  async listTerminalWindowBounds() {
    if (this.platform !== 'darwin') return [];
    const script = `const terminal = Application('Terminal');
JSON.stringify(terminal.running() ? terminal.windows().map((window) => {
  const bounds = window.bounds();
  return { left: bounds[0], top: bounds[1], right: bounds[2], bottom: bounds[3] };
}) : []);`;
    const { stdout } = await this.run('osascript', ['-l', 'JavaScript', '-e', script]);
    const parsed = JSON.parse(stdout.trim() || '[]');
    return Array.isArray(parsed) ? parsed : [];
  }

  ensureSupported() {
    if (!['darwin', 'win32'].includes(this.platform)) {
      throw new Error('The native project launcher supports macOS and Windows.');
    }
  }

  async chooseFolder() {
    this.ensureSupported();
    if (this.platform === 'win32') {
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$picker = New-Object System.Windows.Forms.FolderBrowserDialog',
        "$picker.Description = 'Choose a project folder for Relay'",
        'if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $picker.SelectedPath }',
      ].join('; ');
      const { stdout } = await this.run('powershell.exe', [
        '-NoProfile', '-STA', '-Command', script,
      ]);
      const selected = stdout.trim();
      return selected ? validateProjectPath(selected) : null;
    }
    try {
      const { stdout } = await this.run('osascript', [
        '-e',
        'POSIX path of (choose folder with prompt "Choose a project folder for Relay")',
      ]);
      return validateProjectPath(stdout.trim());
    } catch (error) {
      if (error.code === 1 && /cancel/i.test(`${error.stderr || ''}${error.message || ''}`)) {
        return null;
      }
      throw error;
    }
  }

  async launch(path, provider, requestedLayout = null) {
    this.ensureSupported();
    const project = validateProjectPath(path);
    const command = this.platform === 'win32'
      ? provider === 'codex' ? CODEX_RELAY_COMMAND : CLAUDE_RELAY_COMMAND
      : terminalCommand(project.path, provider);
    const layout = normalizeTerminalLayout(requestedLayout);
    const displays = layout ? await this.listDisplays() : [];
    const displayIndex = displays.length ? Math.min(layout?.display || 0, displays.length - 1) : 0;
    const display = displays[displayIndex];
    const gridKey = layout && display ? `${displayIndex}:${layout.columns}x${layout.rows}` : null;
    let slot = gridKey ? this.gridSlots.get(gridKey) || 0 : 0;
    if (gridKey && this.platform === 'darwin') {
      try {
        const windowBounds = await this.listTerminalWindowBounds();
        slot = firstAvailableGridSlot(display, layout, windowBounds) ?? slot;
      } catch (error) {
        this.diagnostic('terminal.layout.inspect_failed', { message: error.message });
      }
    }
    const bounds = display ? gridBounds(display, layout, slot) : null;
    if (gridKey) this.gridSlots.set(gridKey, (slot + 1) % (layout.rows * layout.columns));
    this.diagnostic('terminal.launch.requested', { provider, path: project.path, platform: this.platform, layout, slot, bounds });
    if (this.platform === 'win32') {
      const placement = bounds ? [
        'Add-Type -TypeDefinition \"using System; using System.Runtime.InteropServices; public class RelayWindow { [DllImport(\\\"user32.dll\\\")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hgt, bool repaint); }\"',
        `$process = Start-Process -FilePath 'cmd.exe' -WorkingDirectory ${powershellQuote(project.path)} -ArgumentList '/k', ${powershellQuote(command)} -PassThru`,
        '$null = $process.WaitForInputIdle(5000)',
        'Start-Sleep -Milliseconds 150',
        `[RelayWindow]::MoveWindow($process.MainWindowHandle, ${bounds.left}, ${bounds.top}, ${bounds.right - bounds.left}, ${bounds.bottom - bounds.top}, $true)`,
      ].join('; ') : `Start-Process -FilePath 'cmd.exe' -WorkingDirectory ${powershellQuote(project.path)} -ArgumentList '/k', ${powershellQuote(command)}`;
      const script = placement;
      await this.run('powershell.exe', ['-NoProfile', '-Command', script]);
      this.diagnostic('terminal.launch.dispatched', { provider, path: project.path, platform: this.platform });
      return { ...project, provider, command, layout, display: display || null, slot, bounds };
    }
    const boundsCommand = bounds
      ? `\nset bounds of front window to {${bounds.left}, ${bounds.top}, ${bounds.right}, ${bounds.bottom}}`
      : '';
    const script = `tell application "Terminal"\nactivate\ndo script ${JSON.stringify(command)}${boundsCommand}\nend tell`;
    await this.run('osascript', ['-e', script]);
    this.diagnostic('terminal.launch.dispatched', { provider, path: project.path, platform: this.platform });
    return { ...project, provider, command, layout, display: display || null, slot, bounds };
  }
}
