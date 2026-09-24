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
const bundledBackendRoot = isPackaged ? path.join(process.resourcesPath, 'backend-dist') : path.join(backendRoot, 'dist');
let workerProcess: ReturnType<typeof spawn> | null = null;
let workerRequestId = 0;
const workerPending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

type BackendLaunch =
  | {
      kind: 'executable';
      command: string;
      baseArgs: string[];
    }
  | {
      kind: 'python';
      command: string;
      baseArgs: string[];
    };

const isExecutableFile = (candidate: string): boolean => {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
};

const resolveVenvPython = (): string | null => {
  const binRoot = isPackaged
    ? path.join(process.resourcesPath, 'python', 'bin')
    : path.join(backendRoot, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin');
  const preferred = process.platform === 'win32' ? ['python.exe', 'python'] : ['python3.12', 'python3.11', 'python3', 'python'];

  for (const executable of preferred) {
    const candidate = path.join(binRoot, executable);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }

  return null;
};

const resolveBundledBackendExecutable = (): string | null => {
  if (!isPackaged) {
    return null;
  }

  const executable = process.platform === 'win32' ? 'blink-tracker-backend.exe' : 'blink-tracker-backend';
  const candidates = [
    path.join(bundledBackendRoot, 'blink-tracker-backend', executable),
    path.join(bundledBackendRoot, executable)
  ];

  for (const candidate of candidates) {
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }

  return null;
};

const resolveBackendLaunch = (): BackendLaunch => {
  const bundledBackend = resolveBundledBackendExecutable();
  if (bundledBackend) {
    return {
      kind: 'executable',
      command: bundledBackend,
      baseArgs: []
    };
  }

  if (process.env.BLINK_TRACKER_PYTHON) {
    return {
      kind: 'python',
      command: process.env.BLINK_TRACKER_PYTHON,
      baseArgs: ['-m', 'app.runner']
    };
  }

  const venvPython = resolveVenvPython();
  if (venvPython) {
    return {
      kind: 'python',
      command: venvPython,
      baseArgs: ['-m', 'app.runner']
    };
  }

  return {
    kind: 'python',
    command: process.platform === 'win32' ? 'python' : 'python3',
    baseArgs: ['-m', 'app.runner']
  };
};

const buildCommandArgs = (launch: BackendLaunch, command: string): string[] => {
  if (launch.kind === 'executable') {
    return ['command', command];
  }

  return [...launch.baseArgs, 'command', command];
};

const buildWorkerArgs = (launch: BackendLaunch): string[] => {
  if (launch.kind === 'executable') {
    return ['worker'];
  }

  return [...launch.baseArgs, 'worker'];
};

const runPythonCommand = <T>(command: string, payload?: unknown): Promise<T> =>
  new Promise((resolve, reject) => {
    const launch = resolveBackendLaunch();
    const args = buildCommandArgs(launch, command);
    const process = spawn(launch.command, args, {
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

  const launch = resolveBackendLaunch();
  const child = spawn(launch.command, buildWorkerArgs(launch), {
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
  listSessions: (payload: unknown) => runPythonCommand('list-sessions', payload),
  detectBlinks: (payload: unknown) => runPythonCommand('detect-blinks', payload),
  saveBlinkEdits: (payload: unknown) => runPythonCommand('save-blink-edits', payload),
  probeVideo: (payload: unknown) => runPythonCommand('probe-video', payload),
  processVideo: (payload: unknown) => runPythonCommand('process-video', payload),
  updateSessionMetadata: (payload: unknown) => runPythonCommand('update-session-metadata', payload),
  appendAuditLog: (payload: unknown) => runPythonCommand('append-audit-log', payload),
  persistFrameMeasurement: (payload: unknown) => runWorkerCommand('persist-frame', payload),
  persistFrameMeasurements: (payload: unknown) => runWorkerCommand('persist-frames', payload)
};
