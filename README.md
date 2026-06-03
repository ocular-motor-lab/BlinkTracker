# Blink Tracker

Desktop MVP for local recording and analysis of bilateral eyelid movements from a webcam or video file.

## Planned stack

- Electron + React + TypeScript + Vite
- Python 3.11+ backend
- Plotly.js for traces
- Zustand for UI state
- OpenCV, NumPy, pandas, and MediaPipe for processing
- Electron Builder for packaging

## Repo layout

- `docs/` product and technical spec
- `electron/` Electron main process and preload bridge
- `src/` React renderer app
- `shared/` schema JSON and cross-language config constants
- `ipc/` typed Electron IPC contracts
- `backend/` Python processing backend

## Development

Install Node dependencies, then create the local Python backend environment:

```bash
npm install
npm run backend:install
```

Start the Electron app in development mode:

```bash
npm run dev
```

The Electron bridge uses `BLINK_TRACKER_PYTHON` when set. Otherwise it looks for `backend/.venv` and falls back to the system Python (`python3` on macOS/Linux, `python` on Windows).

## Packaging

Packaged apps use a bundled backend executable built with PyInstaller. Build the package on the target operating system so native Python wheels and camera libraries match that platform.

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
```

The packaging scripts run `npm run backend:build` first, which creates `backend/dist/blink-tracker-backend` or `backend/dist/blink-tracker-backend.exe`. Electron Builder copies that executable into app resources as `backend-dist/`.

## Milestone 1 status

- Session shell and navigation scaffolded
- Camera enumeration bridged through Python
- Output folder and video file pickers wired through Electron IPC
- Session creation initializes metadata and CSV/audit stubs
