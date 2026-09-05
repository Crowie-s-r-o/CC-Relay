// This is a terminal emulator attached to the original PTY, not a provider UI built
// from Relay events. The CLI owns rendering, editing, alternate screens, and keys.
export class EmbeddedTerminalView {
  constructor(element, { onDisconnect = () => {} } = {}) {
    this.element = element;
    this.onDisconnect = onDisconnect;
    this.key = null;
    this.socket = null;
    this.terminal = null;
    this.ready = false;
    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(element);
    this.themeObserver = new MutationObserver(() => this.updateTheme());
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  connect({ taskId, threadId, launchId }) {
    // Conversation registration changes the startup alias, not the underlying
    // terminal. Keep its DOM, selection, focus, and socket for that exact launch.
    const key = JSON.stringify([taskId, launchId]);
    if (key === this.key) { this.fit(); return; }
    this.disconnect();
    this.key = key;
    const terminal = new globalThis.Terminal({
      allowProposedApi: true, fontFamily: '"IBM Plex Mono", monospace', fontSize: 12, lineHeight: 1.75,
      cursorBlink: true, scrollback: 2000, screenReaderMode: true,
    });
    this.terminal = terminal;
    this.fitAddon = new globalThis.FitAddon.FitAddon();
    terminal.loadAddon(this.fitAddon);
    // Device replies come from the host emulator, including while this view is closed.
    // Suppressing these browser replies prevents duplicated query responses in the CLI.
    for (const prefix of ['', '?', '>']) {
      for (const final of ['c', 'n']) terminal.parser.registerCsiHandler({ prefix, final }, () => true);
    }
    terminal.parser.registerCsiHandler({ final: 't' }, () => true);
    terminal.parser.registerDcsHandler({ intermediates: '$', final: 'q' }, () => true);
    terminal.open(this.element);
    this.updateTheme();
    const url = new URL(`/api/tasks/${taskId}/terminal`, location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('threadId', threadId);
    url.searchParams.set('launchId', launchId);
    const socket = new WebSocket(url);
    this.socket = socket;
    terminal.onData((data) => {
      if (!this.ready || this.socket !== socket) return;
      for (let offset = 0; offset < data.length;) {
        let end = Math.min(data.length, offset + 16_384);
        // Keep a Unicode surrogate pair together when splitting a large paste.
        const last = data.charCodeAt(end - 1);
        if (end < data.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
        this.send({ type: 'input', data: data.slice(offset, end) });
        offset = end;
      }
    });
    terminal.onBinary((data) => {
      // Xterm's binary mouse reports represent byte values, not Unicode text.
      if (this.ready) this.send({ type: 'binary', data: btoa(data) });
    });
    terminal.onResize(({ cols, rows }) => { if (this.ready) this.send({ type: 'resize', cols, rows }); });
    socket.onmessage = ({ data }) => {
      if (this.socket !== socket) return;
      try {
        const message = JSON.parse(data);
        if (message.type === 'snapshot') {
          terminal.resize(message.cols, message.rows);
          terminal.write(message.data, () => {
            if (this.socket !== socket) return;
            this.ready = true;
            this.fit();
          });
        } else if (message.type === 'data') terminal.write(message.data);
        else if (message.type === 'exit') socket.close();
      } catch { socket.close(); }
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.ready = false;
      this.key = null;
      terminal.options.disableStdin = true;
      this.onDisconnect(event.code === 4001
        ? 'This terminal is open in another Relay view. Select Original terminal to reconnect.'
        : 'The terminal disconnected. Reconnecting to this task’s session.', event.code);
    };
    socket.onerror = () => socket.close();
  }

  send(message) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  fit() {
    if (!this.ready || !this.element.getClientRects().length || document.hidden) return;
    const dimensions = this.fitAddon.proposeDimensions();
    if (!dimensions || dimensions.cols < 2 || dimensions.rows < 2) return;
    this.terminal.resize(Math.min(500, dimensions.cols), Math.min(250, dimensions.rows));
  }

  updateTheme() {
    if (!this.terminal) return;
    const dark = document.documentElement.dataset.theme === 'dark';
    this.terminal.options.theme = dark
      ? { background: '#050709', foreground: '#b6c2ce', cursor: '#e7edf4', selectionBackground: '#53688d88' }
      : { background: '#f6f8fc', foreground: '#202838', cursor: '#202838', selectionBackground: '#779cd966' };
  }

  text() {
    if (!this.terminal) return '';
    const buffer = this.terminal.buffer.active;
    return Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i)?.translateToString(true) || '').join('\n');
  }

  disconnect() {
    this.ready = false;
    this.key = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.terminal?.dispose();
    this.terminal = null;
    this.element.replaceChildren();
  }

  dispose() {
    this.disconnect();
    this.resizeObserver.disconnect();
    this.themeObserver.disconnect();
  }
}
