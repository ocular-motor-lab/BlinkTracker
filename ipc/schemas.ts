import type { SourceType } from '../src/shared/schema.js';

export type AppTab =
  | 'preSession'
  | 'session'
  | 'acquire'
  | 'postSession'
  | 'database'
  | 'analysis'
  | 'compare'
  | 'export'
  | 'settings';

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
  sessionDate: string;
  subjectId: string;
  subjectAge: string;
  subjectSex: string;
  subjectRaceEthnicity: string;
  notes: string;
  diagnosedDryEye: string;
  usesEyeDrops: string;
  eyeDropsDetails: string;
  eyeDropsLastTwoHours: string;
  wearsContactLenses: string;
  contactLensType: string;
  wornContactsToday: string;
  wearingContactLensesNow: string;
  wearsGlasses: string;
  wearingGlassesToday: string;
  recentEyeSurgery: string;
  eyeSurgeryDetails: string;
  eyeAllergies: string;
  eyeAllergyDetails: string;
  symptomDryness: string;
  symptomTiredness: string;
  symptomBurningStinging: string;
  symptomBlurryVision: string;
  symptomLightSensitivity: string;
  sleepHours: string;
  consumedCaffeine: string;
  caffeineTiming: string;
  consumedAlcohol24h: string;
  alertnessEyeMeds: string;
  feelingSick: string;
  stressLevel: string;
  energyLevel: string;
  screenReadingDurationToday: string;
  priorAirConditioningHeating: string;
  priorWindSun: string;
  dryEnvironmentToday: string;
  roomTemperature: string;
  deviceUsed: string;
  screenBrightness: string;
  viewingDistanceCm: string;
  currentEmotion: string;
  calibrationReminderAcknowledged: boolean;
  restingPalpebralAperture: string;
  calibrationFrameRows: Array<Record<string, unknown>>;
  calibrationSummary: Record<string, unknown> | null;
  sourceType: SourceType;
  cameraDeviceId: string;
  cameraMode: string;
  videoFilePath: string;
  outputFolder: string;
  saveRawVideo: boolean;
  preferHighResolution: boolean;
}

export interface PostSessionFormValues {
  postSessionContext: string;
  postSymptomDryness: string;
  postSymptomTiredness: string;
  postSymptomBurningStinging: string;
  postSymptomBlurryVision: string;
  postSymptomLightSensitivity: string;
  symptomsDuringReading: string;
  symptomsDuringReadingTiming: string;
  readingEyeComfort: string;
  discomfortIncreased: string;
  urgeRubEyes: string;
  urgeLookAway: string;
  urgeBlinkMore: string;
  eyePressureHeaviness: string;
  visionClearThroughout: string;
  textHarderToFocus: string;
  textHarderToFocusTiming: string;
  headacheDuringAfter: string;
  concentrationEase: string;
  mentalFatigueEnd: string;
  physicalFatigueEnd: string;
  distractedDuringSession: string;
  distractionDetails: string;
  screenBrightnessComfort: string;
  roomLightingComfort: string;
  fontSizeComfort: string;
  viewingDistanceComfort: string;
  roomTemperatureComfort: string;
  baselineVideoComfort: string;
  baselineVideoEyeStrain: string;
  baselineVideoMotionDiscomfort: string;
  baselineVideoNotes: string;
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
  session_date: string;
  subject_id: string;
  subject_age: string;
  subject_sex: string;
  subject_race_ethnicity: string;
  eye_health_baseline: Record<string, unknown>;
  session_conditions: Record<string, unknown>;
  pre_session_calibration: Record<string, unknown>;
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
  blink_classification: 'complete' | 'near_complete' | 'partial' | '';
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
  trackingAlertReason?: 'no_face' | 'low_confidence' | 'out_of_frame' | 'too_far' | 'moving_too_much';
  leftTrackingConfidence: number;
  rightTrackingConfidence: number;
  leftVisible: boolean;
  rightVisible: boolean;
  leftOpeningPx: number | null;
  rightOpeningPx: number | null;
  leftOpeningPercent: number | null;
  rightOpeningPercent: number | null;
  gazeDirection: string;
  gazeHorizontalRatio: number | null;
  gazeVerticalRatio: number | null;
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

export interface ProcessVideoRequest {
  sessionFolder: string;
  videoFilePath: string;
}

export interface ProcessVideoResponse {
  ok: true;
  frameCount: number;
  durationSec: number;
}

export interface SaveRawVideoRequest {
  targetPath: string;
  data: Uint8Array;
}

export interface LoadSessionRequest {
  sessionFolder: string;
}

export interface SessionDatabaseRow {
  sessionFolder: string;
  sessionName: string;
  subjectId: string;
  sessionDate: string;
  createdAt: string;
  sourceType: string;
  databaseNotes: string;
  durationSec: number;
  blinkCount: number;
  frameCount: number;
  error?: string;
}

export interface ListSessionsRequest {
  rootFolder: string;
}

export interface ListSessionsResponse {
  rootFolder: string;
  sessions: SessionDatabaseRow[];
  sessionIndexPath: string;
  sessionIndexXlsxPath: string;
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
  listSessions: (payload: ListSessionsRequest) => Promise<ListSessionsResponse>;
  detectBlinks: (payload: DetectBlinksRequest) => Promise<DetectBlinksResponse>;
  saveBlinkEdits: (payload: SaveBlinkEditsRequest) => Promise<SaveBlinkEditsResponse>;
  probeVideo: (path: string) => Promise<VideoSourceInfo>;
  processVideo: (payload: ProcessVideoRequest) => Promise<ProcessVideoResponse>;
  updateSessionMetadata: (payload: UpdateSessionMetadataRequest) => Promise<SessionMetadata>;
  appendAuditLog: (payload: AuditLogEntryRequest) => Promise<{ ok: true }>;
  persistFrameMeasurement: (payload: PersistFrameMeasurementRequest) => Promise<PersistFrameMeasurementResponse>;
  persistFrameMeasurements: (payload: PersistFrameMeasurementsRequest) => Promise<PersistFrameMeasurementsResponse>;
  saveRawVideo: (payload: SaveRawVideoRequest) => Promise<{ ok: true; path: string }>;
}
