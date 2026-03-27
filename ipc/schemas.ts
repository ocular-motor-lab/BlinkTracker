import type { SourceType } from '../src/shared/schema.js';

export type AppTab = 'session' | 'acquire' | 'analysis' | 'export' | 'settings';

export interface CameraInfo {
  deviceId: string;
  browserDeviceId?: string;
  label: string;
  index: number;
  available: boolean;
  modes: Array<{
    width: number;
    height: number;
    fps: number;
  }>;
}

export interface SessionFormValues {
  sessionName: string;
  subjectId: string;
  notes: string;
  sourceType: SourceType;
  cameraDeviceId: string;
  videoFilePath: string;
  outputFolder: string;
  saveRawVideo: boolean;
  preferHighResolution: boolean;
}

export interface SessionMetadata {
  session_id: string;
  app_version: string;
  pipeline_version: string;
  source_type: SourceType;
  source_name: string;
  resolution_width: number;
  resolution_height: number;
  nominal_fps: number;
  session_created_at: string;
  save_raw_video: boolean;
  tracking_model: string;
  opening_reference_method: string;
  settings: Record<string, unknown>;
  session_name: string;
  subject_id: string;
  notes: string;
  output_folder: string;
  session_folder: string;
}

export interface SessionPaths {
  sessionFolder: string;
  framewiseCsvPath: string;
  blinkCsvPath: string;
  metadataJsonPath: string;
  auditLogPath: string;
  rawVideoPath?: string;
}

export type AnalysisRowValue = string | number | boolean | null;

export interface LoadedSessionResponse {
  metadata: SessionMetadata & Record<string, unknown>;
  paths: SessionPaths;
  frameRows: Array<Record<string, AnalysisRowValue>>;
  blinkRows: BlinkEventRow[];
  mediaPath: string | null;
  frameCount: number;
  timelineStartSec: number;
  durationSec: number;
  mediaSyncOffsetSec: number;
}

export interface BlinkEventRow {
  session_id: string;
  blink_id: string;
  eye_side: 'left' | 'right' | 'bilateral';
  start_frame: number | null;
  start_time_sec: number;
  peak_frame: number | null;
  peak_time_sec: number | null;
  end_frame: number | null;
  end_time_sec: number;
  duration_sec: number;
  closing_duration_sec: number | null;
  opening_duration_sec: number | null;
  min_opening_px: number | null;
  min_opening_percent: number | null;
  peak_closure_percent: number | null;
  is_auto_detected: number;
  is_manually_edited: number;
  is_deleted: number;
  quality_flag: string;
  notes: string;
}

export interface VideoSourceInfo {
  path: string;
  sourceName: string;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  durationSec: number;
}

export interface CreateSessionRequest extends SessionFormValues {
  preferredCameraLabel?: string;
}

export interface CreateSessionResponse {
  ipcVersion?: string;
  metadata: SessionMetadata;
  paths: SessionPaths;
}

export interface UpdateSessionMetadataRequest {
  sessionFolder: string;
  updates: Record<string, unknown>;
}

export interface AuditLogEntryRequest {
  sessionFolder: string;
  action: string;
  note?: string;
  oldValue?: unknown;
  newValue?: unknown;
}

export interface FrameProbeResponse {
  frameIndex: number;
  timestampSec: number;
  trackingStatus: 'tracked' | 'low_confidence' | 'no_face';
  leftTrackingConfidence: number;
  rightTrackingConfidence: number;
  leftVisible: boolean;
  rightVisible: boolean;
  leftOpeningPx: number | null;
  rightOpeningPx: number | null;
  leftOpeningPercent: number | null;
  rightOpeningPercent: number | null;
  leftClosedTouching: number;
  rightClosedTouching: number;
  landmarkPreview: Array<{ x: number; y: number; kind: string }>;
  warning?: string;
}

export interface PersistFrameMeasurementRequest {
  sessionFolder: string;
  row: Record<string, unknown>;
}

export interface PersistFrameMeasurementResponse {
  ok: true;
}

export interface PersistFrameMeasurementsRequest {
  sessionFolder: string;
  rows: Array<Record<string, unknown>>;
}

export interface PersistFrameMeasurementsResponse {
  ok: true;
  count: number;
}

export interface SaveRawVideoRequest {
  targetPath: string;
  data: Uint8Array;
}

export interface LoadSessionRequest {
  sessionFolder: string;
}

export interface DetectBlinksRequest {
  sessionFolder: string;
}

export interface DetectBlinksResponse {
  blinkRows: BlinkEventRow[];
}

export interface SaveBlinkEditsRequest {
  sessionFolder: string;
  blinkRows: BlinkEventRow[];
}

export interface SaveBlinkEditsResponse {
  blinkRows: BlinkEventRow[];
}

export interface ElectronApi {
  listCameras: () => Promise<CameraInfo[]>;
  chooseOutputFolder: () => Promise<string | null>;
  chooseVideoFile: () => Promise<string | null>;
  chooseSessionFolder: () => Promise<string | null>;
  createSession: (payload: CreateSessionRequest) => Promise<CreateSessionResponse>;
  loadSession: (payload: LoadSessionRequest) => Promise<LoadedSessionResponse>;
  detectBlinks: (payload: DetectBlinksRequest) => Promise<DetectBlinksResponse>;
  saveBlinkEdits: (payload: SaveBlinkEditsRequest) => Promise<SaveBlinkEditsResponse>;
  probeVideo: (path: string) => Promise<VideoSourceInfo>;
  updateSessionMetadata: (payload: UpdateSessionMetadataRequest) => Promise<SessionMetadata>;
  appendAuditLog: (payload: AuditLogEntryRequest) => Promise<{ ok: true }>;
  persistFrameMeasurement: (payload: PersistFrameMeasurementRequest) => Promise<PersistFrameMeasurementResponse>;
  persistFrameMeasurements: (payload: PersistFrameMeasurementsRequest) => Promise<PersistFrameMeasurementsResponse>;
  saveRawVideo: (payload: SaveRawVideoRequest) => Promise<{ ok: true; path: string }>;
}
