import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isPackaged = app.isPackaged;
const repoRoot = isPackaged ? process.resourcesPath : path.resolve(__dirname, '..', '..');
const backendRoot = isPackaged ? path.join(process.resourcesPath, 'backend') : path.join(repoRoot, 'backend');
const sharedRoot = isPackaged ? path.join(process.resourcesPath, 'shared') : path.join(repoRoot, 'shared');
const venvPython = isPackaged
  ? path.join(process.resourcesPath, 'python', 'bin', 'python3')
  : path.join(backendRoot, '.venv', 'bin', 'python');
let workerProcess: ReturnType<typeof spawn> | null = null;
let workerRequestId = 0;
const workerPending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

const resolvePythonExecutable = (): string => {
  if (process.env.BLINK_TRACKER_PYTHON) {
    return process.env.BLINK_TRACKER_PYTHON;
  }

  if (fs.existsSync(venvPython)) {
    return venvPython;
  }

  return process.platform === 'win32' ? 'python' : 'python3';
};

const runPythonCommand = <T>(command: string, payload?: unknown): Promise<T> =>
  new Promise((resolve, reject) => {
    const args = ['-m', 'app.main', command];
    const process = spawn(resolvePythonExecutable(), args, {
      cwd: backendRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...globalThis.process.env,
        PYTHONPATH: [backendRoot, sharedRoot, globalThis.process.env.PYTHONPATH].filter(Boolean).join(path.delimiter)
      }
    });

    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    process.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    process.on('error', reject);

    process.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Python command failed with exit code ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout) as T);
      } catch (error) {
        reject(error);
      }
    });

    process.stdin.write(JSON.stringify(payload ?? {}));
    process.stdin.end();
  });

const ensureWorker = () => {
  if (workerProcess && !workerProcess.killed) {
    return workerProcess;
  }

  const child = spawn(resolvePythonExecutable(), ['-m', 'app.worker'], {
    cwd: backendRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...globalThis.process.env,
      PYTHONPATH: [backendRoot, sharedRoot, globalThis.process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
      MPLCONFIGDIR: isPackaged ? path.join(app.getPath('userData'), '.cache', 'matplotlib') : path.join(repoRoot, '.cache', 'matplotlib')
    }
  });

  let stdoutBuffer = '';
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      const message = JSON.parse(line) as { id: number; ok: boolean; result?: unknown; error?: string };
      const pending = workerPending.get(message.id);
      if (!pending) {
        continue;
      }
      workerPending.delete(message.id);
      if (message.ok) {
        pending.resolve(message.result);
      } else {
        pending.reject(new Error(message.error ?? 'Unknown worker error.'));
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    const error = new Error(chunk.toString());
    for (const pending of workerPending.values()) {
      pending.reject(error);
    }
    workerPending.clear();
  });

  child.on('exit', () => {
    workerProcess = null;
  });

  workerProcess = child;
  return child;
};

const runWorkerCommand = <T>(command: string, payload: unknown): Promise<T> =>
  new Promise((resolve, reject) => {
    const process = ensureWorker();
    const id = ++workerRequestId;
    workerPending.set(id, {
      resolve: (value) => resolve(value as T),
      reject
    });
    if (!process.stdin) {
      workerPending.delete(id);
      reject(new Error('Python worker stdin is unavailable.'));
      return;
    }
    process.stdin.write(JSON.stringify({ id, command, payload }) + '\n');
  });

export const pythonBridge = {
  listCameras: () => runPythonCommand('list-cameras'),
  createSession: (payload: unknown) => runPythonCommand('create-session', payload),
  loadSession: (payload: unknown) => runPythonCommand('load-session', payload),
  detectBlinks: (payload: unknown) => runPythonCommand('detect-blinks', payload),
  saveBlinkEdits: (payload: unknown) => runPythonCommand('save-blink-edits', payload),
  probeVideo: (payload: unknown) => runPythonCommand('probe-video', payload),
  updateSessionMetadata: (payload: unknown) => runPythonCommand('update-session-metadata', payload),
  appendAuditLog: (payload: unknown) => runPythonCommand('append-audit-log', payload),
  persistFrameMeasurement: (payload: unknown) => runWorkerCommand('persist-frame', payload),
  persistFrameMeasurements: (payload: unknown) => runWorkerCommand('persist-frames', payload)
};
