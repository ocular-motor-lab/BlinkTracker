import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const backendRoot = path.join(repoRoot, 'backend');
const venvRoot = path.join(backendRoot, '.venv');

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    ...options
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const executableExists = (candidate) => {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
};

const systemPython =
  process.env.BLINK_TRACKER_PYTHON
    ? { command: process.env.BLINK_TRACKER_PYTHON, args: [] }
    : os.platform() === 'win32'
      ? { command: 'py', args: ['-3.12'] }
      : { command: 'python3', args: [] };

if (!fs.existsSync(venvRoot)) {
  run(systemPython.command, [...systemPython.args, '-m', 'venv', '--copies', venvRoot]);
}

const venvPython =
  os.platform() === 'win32'
    ? path.join(venvRoot, 'Scripts', 'python.exe')
    : ['python3.12', 'python3.11', 'python3', 'python']
        .map((name) => path.join(venvRoot, 'bin', name))
        .find(executableExists);

if (!venvPython) {
  throw new Error(`Could not find a Python executable in ${venvRoot}`);
}

run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);
run(venvPython, ['-m', 'pip', 'install', '-r', path.join(backendRoot, 'requirements.txt')]);
run(venvPython, ['-m', 'pip', 'install', '-r', path.join(backendRoot, 'requirements-build.txt')]);
