import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

function safeDetails(details) {
  if (!details || typeof details !== 'object') return {};
  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
}

export class DiagnosticLog {
  constructor(filePath) {
    this.filePath = filePath;
    mkdirSync(dirname(filePath), { recursive: true });
  }

  write(event, details = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      event,
      ...safeDetails(details),
    };
    try {
      if (existsSync(this.filePath) && statSync(this.filePath).size > 5 * 1024 * 1024) {
        const recent = this.readTailBytes(2 * 1024 * 1024);
        writeFileSync(this.filePath, recent, 'utf8');
      }
      appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (error) {
      console.error(`Could not write CC Relay diagnostics: ${error.message}`);
    }
    return entry;
  }

  tail(limit = 500) {
    if (!existsSync(this.filePath)) return [];
    const lines = this.readTailBytes(1024 * 1024).trim().split('\n').filter(Boolean);
    return lines.slice(-Math.max(1, Math.min(Number(limit) || 500, 2_000))).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { timestamp: null, event: 'unparseable', message: line };
      }
    });
  }

  readTailBytes(maxBytes) {
    const descriptor = openSync(this.filePath, 'r');
    try {
      const size = fstatSync(descriptor).size;
      const length = Math.min(size, maxBytes);
      const buffer = Buffer.alloc(length);
      readSync(descriptor, buffer, 0, length, size - length);
      const value = buffer.toString('utf8');
      if (size <= length) return value;
      const firstNewline = value.indexOf('\n');
      return firstNewline === -1 ? '' : value.slice(firstNewline + 1);
    } finally {
      closeSync(descriptor);
    }
  }
}
