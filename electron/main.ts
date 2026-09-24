import { app, BrowserWindow, dialog, ipcMain, net, protocol } from 'electron';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pythonBridge } from './pythonBridge.js';
import type {
  AuditLogEntryRequest,
  CreateSessionRequest,
  DetectBlinksRequest,
  ListSessionsRequest,
  LoadSessionRequest,
  PersistFrameMeasurementsRequest,
  PersistFrameMeasurementRequest,
  ProcessVideoRequest,
  SaveRawVideoRequest,
  SaveBlinkEditsRequest,
  UpdateSessionMetadataRequest
} from '../ipc/schemas.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !app.isPackaged;

const MEDIA_MIME_TYPES: Record<string, string> = {
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo'
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
]);

const createWindow = async (): Promise<void> => {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: '#101624',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  });

  if (isDev) {
    await window.loadURL('http://localhost:5173');
    window.webContents.openDevTools({ mode: 'detach' });
    return;
  }

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('did-fail-load', { errorCode, errorDescription, validatedURL });
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('render-process-gone', details);
  });

  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log('renderer-console', { level, message, line, sourceId });
  });

  console.log('loading packaged renderer', {
    __dirname,
    target: path.join(__dirname, '../../dist/index.html'),
  });
  await window.loadFile(path.join(__dirname, '../../dist/index.html'));
  window.webContents.openDevTools({ mode: 'detach' });
};

app.whenReady().then(() => {
  protocol.handle('app-media', async (request) => {
    const url = new URL(request.url);
    const targetPath = url.searchParams.get('path');
    if (!targetPath) {
      return new Response('Missing media path.', { status: 400 });
    }

    const resolvedPath = path.resolve(targetPath);
    const extension = path.extname(resolvedPath).toLowerCase();
    const contentType = MEDIA_MIME_TYPES[extension] ?? 'application/octet-stream';
    const fileInfo = await stat(resolvedPath);
    const rangeHeader = request.headers.get('range');

    if (!rangeHeader) {
      return new Response(await readFile(resolvedPath), {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(fileInfo.size),
          'Accept-Ranges': 'bytes'
        }
      });
    }

    const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
    if (!match) {
      return new Response('Invalid range.', { status: 416 });
    }

    const start = Number(match[1]);
    const requestedEnd = match[2] ? Number(match[2]) : fileInfo.size - 1;
    const end = Math.min(requestedEnd, fileInfo.size - 1);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start < 0) {
      return new Response('Invalid range.', { status: 416 });
    }

    const fileBuffer = await readFile(resolvedPath);
    const chunk = fileBuffer.subarray(start, end + 1);
    return new Response(chunk, {
      status: 206,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(chunk.byteLength),
        'Content-Range': `bytes ${start}-${end}/${fileInfo.size}`,
        'Accept-Ranges': 'bytes'
      }
    });
  });

  ipcMain.handle('camera:list', () => pythonBridge.listCameras());

  ipcMain.handle('dialog:choose-output-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:choose-video-file', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        {
          name: 'Video',
          extensions: ['mp4', 'mov', 'avi', 'mkv']
        }
      ]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:choose-session-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('session:create', (_, payload: CreateSessionRequest) => pythonBridge.createSession(payload));
  ipcMain.handle('session:load', (_, payload: LoadSessionRequest) => pythonBridge.loadSession(payload));
  ipcMain.handle('session:list', (_, payload: ListSessionsRequest) => pythonBridge.listSessions(payload));
  ipcMain.handle('blink:detect', (_, payload: DetectBlinksRequest) => pythonBridge.detectBlinks(payload));
  ipcMain.handle('blink:save-edits', (_, payload: SaveBlinkEditsRequest) => pythonBridge.saveBlinkEdits(payload));
  ipcMain.handle('video:probe', (_, payload: string) => pythonBridge.probeVideo(payload));
  ipcMain.handle('video:process', (_, payload: ProcessVideoRequest) => pythonBridge.processVideo(payload));
  ipcMain.handle('session:update-metadata', (_, payload: UpdateSessionMetadataRequest) =>
    pythonBridge.updateSessionMetadata(payload)
  );
  ipcMain.handle('session:append-audit', (_, payload: AuditLogEntryRequest) => pythonBridge.appendAuditLog(payload));
  ipcMain.handle('pipeline:persist-frame', (_, payload: PersistFrameMeasurementRequest) =>
    pythonBridge.persistFrameMeasurement(payload)
  );
  ipcMain.handle('pipeline:persist-frames', (_, payload: PersistFrameMeasurementsRequest) =>
    pythonBridge.persistFrameMeasurements(payload)
  );
  ipcMain.handle('session:save-raw-video', async (_, payload: SaveRawVideoRequest) => {
    await writeFile(payload.targetPath, Buffer.from(payload.data));
    return { ok: true as const, path: payload.targetPath };
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
