import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const backendRoot = path.join(repoRoot, 'backend');
const cacheRoot = path.join(backendRoot, '.cache');
const distRoot = path.join(backendRoot, 'dist');
const buildRoot = path.join(backendRoot, 'build');
const pyinstallerDataSeparator = os.platform() === 'win32' ? ';' : ':';

const executableExists = (candidate) => {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
};

const findPython = () => {
  if (process.env.BLINK_TRACKER_PYTHON) {
    return { command: process.env.BLINK_TRACKER_PYTHON, args: [] };
  }

  const venvCandidates =
    os.platform() === 'win32'
      ? [path.join(backendRoot, '.venv', 'Scripts', 'python.exe')]
      : ['python3.12', 'python3.11', 'python3', 'python'].map((name) => path.join(backendRoot, '.venv', 'bin', name));

  for (const candidate of venvCandidates) {
    if (executableExists(candidate)) {
      return { command: candidate, args: [] };
    }
  }

  if (os.platform() === 'win32') {
    return { command: 'py', args: ['-3.12'] };
  }

  return { command: 'python3', args: [] };
};

const python = findPython();
fs.rmSync(distRoot, { recursive: true, force: true });
fs.rmSync(buildRoot, { recursive: true, force: true });

const pyinstallerArgs = [
  ...python.args,
  '-m',
  'PyInstaller',
  '--clean',
  '--name',
  'blink-tracker-backend',
  '--distpath',
  distRoot,
  '--workpath',
  buildRoot,
  '--add-data',
  `${path.join(repoRoot, 'shared')}${pyinstallerDataSeparator}shared`,
  path.join(backendRoot, 'app', 'runner.py')
];

const result = spawnSync(python.command, pyinstallerArgs, {
  cwd: backendRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    MPLCONFIGDIR: path.join(cacheRoot, 'matplotlib'),
    PYINSTALLER_CONFIG_DIR: path.join(cacheRoot, 'pyinstaller'),
    PYTHONPATH: [backendRoot, path.join(repoRoot, 'shared'), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter)
  }
});

if (result.status !== 0) {
  console.error('\nFailed to build the backend executable.');
  console.error('Run `npm run backend:install` first, or install PyInstaller with:');
  console.error('  python -m pip install -r backend/requirements-build.txt');
  process.exit(result.status ?? 1);
}
