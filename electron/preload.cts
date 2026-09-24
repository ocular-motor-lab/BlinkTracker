import { contextBridge, ipcRenderer } from 'electron';
import type { CreateSessionRequest, CreateSessionResponse, ElectronApi } from '../ipc/schemas.js';

const api: ElectronApi = {
  listCameras: () => ipcRenderer.invoke('camera:list'),
  chooseOutputFolder: () => ipcRenderer.invoke('dialog:choose-output-folder'),
  chooseVideoFile: () => ipcRenderer.invoke('dialog:choose-video-file'),
  chooseSessionFolder: () => ipcRenderer.invoke('dialog:choose-session-folder'),
  createSession: (payload: CreateSessionRequest): Promise<CreateSessionResponse> =>
    ipcRenderer.invoke('session:create', payload),
  loadSession: (payload) => ipcRenderer.invoke('session:load', payload),
  listSessions: (payload) => ipcRenderer.invoke('session:list', payload),
  detectBlinks: (payload) => ipcRenderer.invoke('blink:detect', payload),
  saveBlinkEdits: (payload) => ipcRenderer.invoke('blink:save-edits', payload),
  probeVideo: (path) => ipcRenderer.invoke('video:probe', path),
  processVideo: (payload) => ipcRenderer.invoke('video:process', payload),
  updateSessionMetadata: (payload) => ipcRenderer.invoke('session:update-metadata', payload),
  appendAuditLog: (payload) => ipcRenderer.invoke('session:append-audit', payload),
  persistFrameMeasurement: (payload) => ipcRenderer.invoke('pipeline:persist-frame', payload),
  persistFrameMeasurements: (payload) => ipcRenderer.invoke('pipeline:persist-frames', payload),
  saveRawVideo: (payload) => ipcRenderer.invoke('session:save-raw-video', payload)
};

contextBridge.exposeInMainWorld('electronAPI', api);
