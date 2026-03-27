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

## Milestone 1 status

- Session shell and navigation scaffolded
- Camera enumeration bridged through Python
- Output folder and video file pickers wired through Electron IPC
- Session creation initializes metadata and CSV/audit stubs
