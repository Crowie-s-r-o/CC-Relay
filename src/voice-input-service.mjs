import { spawn as nodeSpawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { cpus } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FASTER_WHISPER_VERSION = '1.2.1';
export const VOICE_INPUT_MODEL = 'base';
export const VOICE_INPUT_COMPUTE_TYPE = 'int8';
export const MAX_VOICE_AUDIO_BYTES = 12 * 1024 * 1024;
const VOICE_INPUT_PROTOCOL_VERSION = 1;
const VOICE_SETUP_TIMEOUT_MS = 10 * 60 * 1000;
const VOICE_WORKER_START_TIMEOUT_MS = 5 * 60 * 1000;
const VOICE_TRANSCRIPTION_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_PROCESS_OUTPUT_BYTES = 128 * 1024;
const SOURCE_HELPER_PATH = fileURLToPath(
  new URL('./faster-whisper-worker.py', import.meta.url),
);

const AUDIO_EXTENSIONS = new Map([
  ['audio/webm', '.webm'],
  ['audio/ogg', '.ogg'],
  ['audio/mp4', '.m4a'],
  ['audio/mpeg', '.mp3'],
  ['audio/wav', '.wav'],
  ['audio/x-wav', '.wav'],
]);

function voiceInputError(message, statusCode = 422) {
  return Object.assign(new Error(message), { statusCode });
}

function boundedOutput(current, chunk) {
  const next = `${current}${String(chunk || '')}`;
  return next.length <= MAX_PROCESS_OUTPUT_BYTES
    ? next
    : next.slice(-MAX_PROCESS_OUTPUT_BYTES);
}

export function parsePythonVersion(value) {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const version = {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] || 0),
  };
  version.supported = version.major > 3 || (version.major === 3 && version.minor >= 9);
  return version;
}

export function voiceInputAudioExtension(mimeType) {
  const normalized = String(mimeType || '').split(';', 1)[0].trim().toLowerCase();
  return AUDIO_EXTENSIONS.get(normalized) || null;
}

export function runVoiceProcess(command, args, {
  cwd,
  timeoutMs = 30_000,
  spawnProcess = nodeSpawn,
  onSpawn = () => {},
  onExit = () => {},
} = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess(command, args, {
        cwd,
        env: process.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }
    onSpawn(child);
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      onExit(child);
      reject(new Error(`${basename(command)} did not finish within ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on('data', (chunk) => {
      stdout = boundedOutput(stdout, chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr = boundedOutput(stderr, chunk);
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      onExit(child);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      onExit(child);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const detail = stderr.trim() || stdout.trim() || `exit ${code ?? signal ?? 'unknown'}`;
      reject(new Error(`${basename(command)} failed: ${detail}`));
    });
  });
}

function markerValue(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    const value = JSON.parse(readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export class VoiceInputService {
  constructor({
    dataRoot,
    platform = process.platform,
    spawnProcess = nodeSpawn,
    runProcess = runVoiceProcess,
    diagnostic = () => {},
    helperSourcePath = SOURCE_HELPER_PATH,
  } = {}) {
    if (!dataRoot) throw new TypeError('VoiceInputService requires a dataRoot.');
    this.dataRoot = dataRoot;
    this.platform = platform;
    this.spawnProcess = spawnProcess;
    this.runProcess = runProcess;
    this.diagnostic = diagnostic;
    this.helperSourcePath = helperSourcePath;
    this.root = join(dataRoot, 'voice-input');
    this.venvRoot = join(this.root, 'python');
    this.modelRoot = join(this.root, 'models');
    this.recordingRoot = join(this.root, 'recordings');
    this.helperPath = join(this.root, 'faster-whisper-worker.py');
    this.markerPath = join(this.root, 'engine.json');
    this.venvPython = platform === 'win32'
      ? join(this.venvRoot, 'Scripts', 'python.exe')
      : join(this.venvRoot, 'bin', 'python');
    this.setupPromise = null;
    this.workerStartPromise = null;
    this.workerStartResolve = null;
    this.workerStartReject = null;
    this.worker = null;
    this.workerStdout = '';
    this.workerStderr = '';
    this.pending = new Map();
    this.activeChildren = new Set();
    this.busy = false;
    this.installing = false;
    this.shuttingDown = false;
    this.lastError = null;
    this.requestSequence = 0;
  }

  _installed() {
    const marker = markerValue(this.markerPath);
    return Boolean(
      marker
      && marker.protocolVersion === VOICE_INPUT_PROTOCOL_VERSION
      && marker.engineVersion === FASTER_WHISPER_VERSION
      && marker.model === VOICE_INPUT_MODEL
      && existsSync(this.venvPython)
      && existsSync(this.helperPath),
    );
  }

  status() {
    const installed = this._installed();
    return {
      state: this.installing
        ? 'installing'
        : installed
          ? this.lastError ? 'error' : 'ready'
          : 'setup-required',
      engine: 'faster-whisper',
      engineVersion: FASTER_WHISPER_VERSION,
      model: VOICE_INPUT_MODEL,
      device: 'cpu',
      computeType: VOICE_INPUT_COMPUTE_TYPE,
      installed,
      workerReady: Boolean(this.worker && this.workerStartPromise && !this.workerStartReject),
      busy: this.busy,
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }

  async _run(command, args, options = {}) {
    return this.runProcess(command, args, {
      ...options,
      spawnProcess: this.spawnProcess,
      onSpawn: (child) => this.activeChildren.add(child),
      onExit: (child) => this.activeChildren.delete(child),
    });
  }

  async _findPython() {
    const candidates = this.platform === 'win32'
      ? [
        { command: 'py', prefix: ['-3'] },
        { command: 'python', prefix: [] },
        { command: 'python3', prefix: [] },
      ]
      : [
        { command: 'python3', prefix: [] },
        { command: 'python', prefix: [] },
      ];
    for (const candidate of candidates) {
      try {
        const result = await this._run(candidate.command, [
          ...candidate.prefix,
          '-c',
          'import sys; print("%s.%s.%s" % sys.version_info[:3])',
        ], { timeoutMs: 10_000, cwd: this.root });
        const version = parsePythonVersion(result.stdout);
        if (version?.supported) return { ...candidate, version };
      } catch {}
    }
    throw voiceInputError(
      'Voice setup needs Python 3.9 or newer. Install Python, restart CC Relay, and try again.',
      409,
    );
  }

  _writeHelper() {
    mkdirSync(this.root, { recursive: true });
    const source = readFileSync(this.helperSourcePath);
    writeFileSync(this.helperPath, source, { mode: 0o600 });
  }

  _writeMarker() {
    const temporary = `${this.markerPath}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({
      protocolVersion: VOICE_INPUT_PROTOCOL_VERSION,
      engineVersion: FASTER_WHISPER_VERSION,
      model: VOICE_INPUT_MODEL,
      device: 'cpu',
      computeType: VOICE_INPUT_COMPUTE_TYPE,
    }, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.markerPath);
  }

  async setup() {
    if (this.setupPromise) return this.setupPromise;
    this.setupPromise = this._setup()
      .then(() => this.status())
      .finally(() => {
        this.setupPromise = null;
      });
    return this.setupPromise;
  }

  async _setup() {
    if (this.shuttingDown) throw voiceInputError('CC Relay is shutting down.', 409);
    this.installing = true;
    this.lastError = null;
    this.diagnostic('voice.input.setup.started', {
      engineVersion: FASTER_WHISPER_VERSION,
      model: VOICE_INPUT_MODEL,
    });
    try {
      mkdirSync(this.root, { recursive: true });
      this._writeHelper();
      if (!this._installed()) {
        const python = await this._findPython();
        rmSync(this.venvRoot, { recursive: true, force: true });
        await this._run(python.command, [
          ...python.prefix,
          '-m',
          'venv',
          this.venvRoot,
        ], { timeoutMs: 2 * 60 * 1000, cwd: this.root });
        if (!existsSync(this.venvPython)) {
          throw new Error('Python did not create the isolated voice runtime.');
        }
        await this._run(this.venvPython, [
          '-m',
          'pip',
          'install',
          '--disable-pip-version-check',
          '--no-input',
          `faster-whisper==${FASTER_WHISPER_VERSION}`,
        ], { timeoutMs: VOICE_SETUP_TIMEOUT_MS, cwd: this.root });
        this._writeMarker();
      }
      await this._startWorker();
      this.lastError = null;
      this.diagnostic('voice.input.setup.completed', {
        engineVersion: FASTER_WHISPER_VERSION,
        model: VOICE_INPUT_MODEL,
      });
      return true;
    } catch (error) {
      this.lastError = error.message || String(error);
      rmSync(this.markerPath, { force: true });
      this.diagnostic('voice.input.setup.failed', { error: this.lastError });
      throw voiceInputError(`Voice setup failed. ${this.lastError}`, error.statusCode || 422);
    } finally {
      this.installing = false;
    }
  }

  async prewarm() {
    if (!this._installed() || this.shuttingDown) return this.status();
    try {
      await this._startWorker();
    } catch (error) {
      this.lastError = error.message || String(error);
      this.diagnostic('voice.input.prewarm.failed', { error: this.lastError });
    }
    return this.status();
  }

  _workerArguments() {
    return [
      this.helperPath,
      '--worker',
      '--model',
      VOICE_INPUT_MODEL,
      '--cache-dir',
      this.modelRoot,
      '--cpu-threads',
      String(Math.max(1, Math.min(8, cpus().length || 1))),
    ];
  }

  _startWorker() {
    if (this.workerStartPromise) return this.workerStartPromise;
    if (!this._installed()) {
      return Promise.reject(voiceInputError(
        'Set up the local faster-whisper engine in Settings before using voice input.',
        409,
      ));
    }
    if (this.shuttingDown) {
      return Promise.reject(voiceInputError('CC Relay is shutting down.', 409));
    }
    mkdirSync(this.modelRoot, { recursive: true });
    let child;
    try {
      child = this.spawnProcess(this.venvPython, this._workerArguments(), {
        cwd: this.root,
        env: process.env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      return Promise.reject(error);
    }
    this.worker = child;
    this.activeChildren.add(child);
    this.workerStdout = '';
    this.workerStderr = '';
    this.workerStartPromise = new Promise((resolve, reject) => {
      this.workerStartResolve = resolve;
      this.workerStartReject = reject;
    });
    const startTimer = setTimeout(() => {
      if (!this.workerStartReject) return;
      this._workerFailed(new Error('The faster-whisper model did not load in time.'), child);
      child.kill();
    }, VOICE_WORKER_START_TIMEOUT_MS);
    startTimer.unref?.();

    child.stdout?.on('data', (chunk) => this._handleWorkerOutput(chunk));
    child.stderr?.on('data', (chunk) => {
      this.workerStderr = boundedOutput(this.workerStderr, chunk);
    });
    child.once('error', (error) => {
      clearTimeout(startTimer);
      this._workerFailed(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(startTimer);
      const detail = this.workerStderr.trim()
        || `faster-whisper worker exited with ${code ?? signal ?? 'unknown'}.`;
      this._workerFailed(new Error(detail), child);
    });
    this.workerStartPromise.then(() => clearTimeout(startTimer), () => clearTimeout(startTimer));
    return this.workerStartPromise;
  }

  _handleWorkerOutput(chunk) {
    this.workerStdout += String(chunk || '');
    let newline = this.workerStdout.indexOf('\n');
    while (newline !== -1) {
      const line = this.workerStdout.slice(0, newline).trim();
      this.workerStdout = this.workerStdout.slice(newline + 1);
      if (line) this._handleWorkerLine(line);
      newline = this.workerStdout.indexOf('\n');
    }
    if (this.workerStdout.length > MAX_PROCESS_OUTPUT_BYTES) {
      const child = this.worker;
      this._workerFailed(new Error('The faster-whisper worker returned an oversized response.'), child);
      child?.kill();
    }
  }

  _handleWorkerLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      const child = this.worker;
      this._workerFailed(new Error('The faster-whisper worker returned invalid data.'), child);
      child?.kill();
      return;
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      const child = this.worker;
      this._workerFailed(new Error('The faster-whisper worker returned invalid data.'), child);
      child?.kill();
      return;
    }
    if (message.type === 'ready') {
      if (
        message.engineVersion !== FASTER_WHISPER_VERSION
        || message.model !== VOICE_INPUT_MODEL
      ) {
        const child = this.worker;
        this._workerFailed(new Error('The faster-whisper worker version does not match its installed engine.'), child);
        child?.kill();
        return;
      }
      const resolve = this.workerStartResolve;
      this.workerStartResolve = null;
      this.workerStartReject = null;
      this.lastError = null;
      resolve?.(this.status());
      this.diagnostic('voice.input.worker.ready', {
        engineVersion: message.engineVersion || FASTER_WHISPER_VERSION,
        model: VOICE_INPUT_MODEL,
      });
      return;
    }
    const pending = this.pending.get(String(message.id || ''));
    if (!pending) return;
    if (message.type === 'result') {
      const text = String(message.text || '').trim();
      pending.resolve({
        text,
        language: typeof message.language === 'string' ? message.language : null,
        duration: typeof message.duration === 'number' && Number.isFinite(message.duration)
          ? message.duration
          : null,
      });
      return;
    }
    pending.reject(new Error(String(message.error || 'Voice transcription failed.')));
  }

  _workerFailed(error, child = this.worker) {
    if (child && child !== this.worker) {
      this.activeChildren.delete(child);
      return;
    }
    const message = error?.message || String(error);
    const rejectStart = this.workerStartReject;
    this.workerStartResolve = null;
    this.workerStartReject = null;
    if (rejectStart) rejectStart(error);
    for (const pending of this.pending.values()) pending.reject(error);
    this.workerStartPromise = null;
    if (this.worker) this.activeChildren.delete(this.worker);
    this.worker = null;
    if (!this.shuttingDown) {
      this.lastError = message;
      this.diagnostic('voice.input.worker.failed', { error: message });
    }
  }

  async transcribe(audio, mimeType) {
    const extension = voiceInputAudioExtension(mimeType);
    if (!extension) throw voiceInputError('Voice input received an unsupported audio format.', 415);
    if (!Buffer.isBuffer(audio) || audio.length < 256) {
      throw voiceInputError('Hold push-to-talk a little longer so Relay can capture your voice.');
    }
    if (audio.length > MAX_VOICE_AUDIO_BYTES) {
      throw voiceInputError('Voice recordings may be at most 12 MB.', 413);
    }
    if (this.busy) {
      throw voiceInputError('Relay is still transcribing the previous voice recording.', 409);
    }
    this.busy = true;
    this.lastError = null;
    let clipDirectory = null;
    try {
      await this._startWorker();
      mkdirSync(this.recordingRoot, { recursive: true });
      clipDirectory = mkdtempSync(join(this.recordingRoot, 'clip-'));
      const audioPath = join(clipDirectory, `recording${extension}`);
      writeFileSync(audioPath, audio, { mode: 0o600 });
      const id = String(++this.requestSequence);
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const error = new Error('Voice transcription did not finish within two minutes.');
          this.pending.get(id)?.reject(error);
          const child = this.worker;
          this._workerFailed(error, child);
          child?.kill();
        }, VOICE_TRANSCRIPTION_TIMEOUT_MS);
        timer.unref?.();
        this.pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            this.pending.delete(id);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            this.pending.delete(id);
            reject(error);
          },
        });
        try {
          this.worker.stdin.write(`${JSON.stringify({ id, audio: audioPath })}\n`, (error) => {
            if (error) this.pending.get(id)?.reject(error);
          });
        } catch (error) {
          this.pending.get(id)?.reject(error);
        }
      });
      this.diagnostic('voice.input.transcribed', {
        audioBytes: audio.length,
        characters: result.text.length,
        language: result.language,
        duration: result.duration,
      });
      return result;
    } catch (error) {
      this.lastError = error.message || String(error);
      this.diagnostic('voice.input.transcription.failed', { error: this.lastError });
      throw voiceInputError(
        `Voice transcription failed. ${this.lastError}`,
        error.statusCode || 422,
      );
    } finally {
      this.busy = false;
      if (clipDirectory) rmSync(clipDirectory, { recursive: true, force: true });
    }
  }

  async shutdown() {
    this.shuttingDown = true;
    for (const pending of this.pending.values()) {
      pending.reject(new Error('CC Relay is shutting down.'));
    }
    this.pending.clear();
    const children = [...this.activeChildren];
    for (const child of children) child.kill();
    if (children.length > 0) {
      await Promise.race([
        Promise.allSettled(children.map((child) => new Promise((resolve) => {
          if (child.exitCode !== null || child.signalCode) resolve();
          else child.once('exit', resolve);
        }))),
        new Promise((resolve) => {
          const timer = setTimeout(resolve, 2_000);
          timer.unref?.();
        }),
      ]);
    }
    for (const child of this.activeChildren) child.kill('SIGKILL');
    this.activeChildren.clear();
    this.worker = null;
    this.workerStartPromise = null;
    this.workerStartResolve = null;
    this.workerStartReject = null;
  }
}
