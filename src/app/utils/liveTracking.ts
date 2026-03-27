import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { DEFAULT_BLINK_COLUMNS, LANDMARK_COLUMNS, type SourceType } from '@shared/schema';
import type { FrameProbeResponse } from '@ipc/schemas';

type LandmarkPoint = { x: number; y: number };

type EyeMetrics = {
  upper: LandmarkPoint[];
  lower: LandmarkPoint[];
  medial: LandmarkPoint;
  lateral: LandmarkPoint;
  center: LandmarkPoint;
  openingPx: number;
  openingPercent: number | null;
  confidence: number;
  visible: boolean;
};

type TrackingState = {
  leftReferenceMax: number;
  rightReferenceMax: number;
  previousTimestampSec: number | null;
};

const LEFT_UPPER = [33, 160, 159, 158, 133];
const LEFT_LOWER = [33, 144, 145, 153, 133];
const RIGHT_UPPER = [362, 385, 386, 387, 263];
const RIGHT_LOWER = [362, 380, 374, 373, 263];
const LEFT_MEDIAL = 133;
const LEFT_LATERAL = 33;
const RIGHT_MEDIAL = 362;
const RIGHT_LATERAL = 263;
const LEFT_IRIS = [468, 469, 470, 471, 472];
const RIGHT_IRIS = [473, 474, 475, 476, 477];

let sharedTrackerPromise: Promise<FaceLandmarker> | null = null;

const createTracker = async (): Promise<FaceLandmarker> => {
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: '/models/face_landmarker.task',
      delegate: 'GPU'
    },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false
  });
};

export const getSharedFaceLandmarker = async (): Promise<FaceLandmarker> => {
  if (!sharedTrackerPromise) {
    sharedTrackerPromise = createTracker();
  }

  return sharedTrackerPromise;
};

export const warmupFaceLandmarker = (): void => {
  if (!sharedTrackerPromise) {
    sharedTrackerPromise = createTracker();
  }
};

const toPixelPoint = (landmarks: LandmarkPoint[], index: number, width: number, height: number): LandmarkPoint => ({
  x: landmarks[index].x * width,
  y: landmarks[index].y * height
});

const averagePoint = (points: LandmarkPoint[]): LandmarkPoint => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  y: points.reduce((sum, point) => sum + point.y, 0) / points.length
});

const distance = (pointA: LandmarkPoint, pointB: LandmarkPoint): number =>
  Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);

const buildEyeMetrics = (
  points: LandmarkPoint[],
  width: number,
  height: number,
  upperIndices: number[],
  lowerIndices: number[],
  medialIndex: number,
  lateralIndex: number,
  irisIndices: number[],
  referenceMax: number
): EyeMetrics => {
  const upper = upperIndices.map((index) => toPixelPoint(points, index, width, height));
  const lower = lowerIndices.map((index) => toPixelPoint(points, index, width, height));
  const medial = toPixelPoint(points, medialIndex, width, height);
  const lateral = toPixelPoint(points, lateralIndex, width, height);
  const center = averagePoint(irisIndices.map((index) => toPixelPoint(points, index, width, height)));
  const openingPx =
    lower.slice(1, 4).reduce((sum, point) => sum + point.y, 0) / 3 -
    upper.slice(1, 4).reduce((sum, point) => sum + point.y, 0) / 3;
  const eyeWidth = distance(medial, lateral);
  const confidence = Math.max(0, Math.min(1, openingPx / Math.max(eyeWidth * 0.42, 1)));
  const openingPercent = referenceMax > 0 ? Math.max(0, (openingPx / referenceMax) * 100) : null;

  return {
    upper,
    lower,
    medial,
    lateral,
    center,
    openingPx: Math.max(0, openingPx),
    openingPercent,
    confidence,
    visible: true
  };
};

const emptyLandmarkColumns = (): Record<string, string | number> => {
  const row: Record<string, string | number> = {};
  for (const column of LANDMARK_COLUMNS) {
    row[column] = '';
  }
  return row;
};

const landmarkColumnsFromMetrics = (
  leftEye: EyeMetrics,
  rightEye: EyeMetrics
): Record<string, string | number> => {
  const row = emptyLandmarkColumns();
  const assignEye = (eyeName: 'left' | 'right', eye: EyeMetrics) => {
    eye.upper.forEach((point, index) => {
      row[`${eyeName}_upper_lid_x_${index + 1}`] = point.x;
      row[`${eyeName}_upper_lid_y_${index + 1}`] = point.y;
    });
    eye.lower.forEach((point, index) => {
      row[`${eyeName}_lower_lid_x_${index + 1}`] = point.x;
      row[`${eyeName}_lower_lid_y_${index + 1}`] = point.y;
    });
    row[`${eyeName}_medial_canthus_x`] = eye.medial.x;
    row[`${eyeName}_medial_canthus_y`] = eye.medial.y;
    row[`${eyeName}_lateral_canthus_x`] = eye.lateral.x;
    row[`${eyeName}_lateral_canthus_y`] = eye.lateral.y;
    row[`${eyeName}_center_reference_x`] = eye.center.x;
    row[`${eyeName}_center_reference_y`] = eye.center.y;
  };

  assignEye('left', leftEye);
  assignEye('right', rightEye);
  return row;
};

export const createTrackingState = (): TrackingState => ({
  leftReferenceMax: 0,
  rightReferenceMax: 0,
  previousTimestampSec: null
});

export const trackFrame = async (
  tracker: FaceLandmarker,
  source: HTMLCanvasElement,
  frameIndex: number,
  timestampSec: number,
  nominalFps: number,
  sourceType: SourceType,
  sourceName: string,
  sessionId: string,
  state: TrackingState
): Promise<{ probe: FrameProbeResponse; row: Record<string, unknown> }> => {
  const width = source.width;
  const height = source.height;
  const result = tracker.detectForVideo(source, performance.now());

  if (!result.faceLandmarks.length) {
    const row = {
      session_id: sessionId,
      source_type: sourceType,
      source_name: sourceName,
      frame_index: frameIndex,
      timestamp_sec: timestampSec,
      timestamp_iso: new Date().toISOString(),
      nominal_fps: nominalFps,
      dt_sec: state.previousTimestampSec == null ? 0 : Math.max(0, timestampSec - state.previousTimestampSec),
      left_opening_px: '',
      right_opening_px: '',
      left_opening_percent: '',
      right_opening_percent: '',
      left_closed_touching: 0,
      right_closed_touching: 0,
      left_closed_touching_confidence: 0,
      right_closed_touching_confidence: 0,
      left_tracking_confidence: 0,
      right_tracking_confidence: 0,
      left_visible: 0,
      right_visible: 0,
      ...DEFAULT_BLINK_COLUMNS,
      ...emptyLandmarkColumns()
    };
    state.previousTimestampSec = timestampSec;
    return {
      probe: {
        frameIndex,
        timestampSec,
        trackingStatus: 'no_face',
        leftTrackingConfidence: 0,
        rightTrackingConfidence: 0,
        leftVisible: false,
        rightVisible: false,
        leftOpeningPx: null,
        rightOpeningPx: null,
        leftOpeningPercent: null,
        rightOpeningPercent: null,
        leftClosedTouching: 0,
        rightClosedTouching: 0,
        landmarkPreview: [],
        warning: 'No face detected in this frame.'
      },
      row
    };
  }

  const face = result.faceLandmarks[0] as LandmarkPoint[];
  const leftMax = state.leftReferenceMax || 0;
  const rightMax = state.rightReferenceMax || 0;
  let leftEye = buildEyeMetrics(face, width, height, LEFT_UPPER, LEFT_LOWER, LEFT_MEDIAL, LEFT_LATERAL, LEFT_IRIS, leftMax);
  let rightEye = buildEyeMetrics(face, width, height, RIGHT_UPPER, RIGHT_LOWER, RIGHT_MEDIAL, RIGHT_LATERAL, RIGHT_IRIS, rightMax);

  state.leftReferenceMax = Math.max(state.leftReferenceMax, leftEye.openingPx);
  state.rightReferenceMax = Math.max(state.rightReferenceMax, rightEye.openingPx);

  leftEye = {
    ...leftEye,
    openingPercent: state.leftReferenceMax > 0 ? (leftEye.openingPx / state.leftReferenceMax) * 100 : null
  };
  rightEye = {
    ...rightEye,
    openingPercent: state.rightReferenceMax > 0 ? (rightEye.openingPx / state.rightReferenceMax) * 100 : null
  };

  const dtSec = state.previousTimestampSec == null ? 0 : Math.max(0, timestampSec - state.previousTimestampSec);
  state.previousTimestampSec = timestampSec;

  const leftClosed = leftEye.openingPercent !== null && leftEye.openingPercent < 20 ? 1 : 0;
  const rightClosed = rightEye.openingPercent !== null && rightEye.openingPercent < 20 ? 1 : 0;
  const trackingStatus =
    leftEye.confidence < 0.35 || rightEye.confidence < 0.35 ? 'low_confidence' : 'tracked';

  const landmarkPreview = [
    ...leftEye.upper.map((point) => ({ ...point, kind: 'left_upper' })),
    ...leftEye.lower.map((point) => ({ ...point, kind: 'left_lower' })),
    ...rightEye.upper.map((point) => ({ ...point, kind: 'right_upper' })),
    ...rightEye.lower.map((point) => ({ ...point, kind: 'right_lower' }))
  ];

  const row = {
    session_id: sessionId,
    source_type: sourceType,
    source_name: sourceName,
    frame_index: frameIndex,
    timestamp_sec: timestampSec,
    timestamp_iso: new Date().toISOString(),
    nominal_fps: nominalFps,
    dt_sec: dtSec,
    left_opening_px: leftEye.openingPx,
    right_opening_px: rightEye.openingPx,
    left_opening_percent: leftEye.openingPercent ?? '',
    right_opening_percent: rightEye.openingPercent ?? '',
    left_closed_touching: leftClosed,
    right_closed_touching: rightClosed,
    left_closed_touching_confidence: leftEye.confidence,
    right_closed_touching_confidence: rightEye.confidence,
    left_tracking_confidence: leftEye.confidence,
    right_tracking_confidence: rightEye.confidence,
    left_visible: 1,
    right_visible: 1,
    ...DEFAULT_BLINK_COLUMNS,
    ...landmarkColumnsFromMetrics(leftEye, rightEye)
  };

  return {
    probe: {
      frameIndex,
      timestampSec,
      trackingStatus,
      leftTrackingConfidence: leftEye.confidence,
      rightTrackingConfidence: rightEye.confidence,
      leftVisible: true,
      rightVisible: true,
      leftOpeningPx: leftEye.openingPx,
      rightOpeningPx: rightEye.openingPx,
      leftOpeningPercent: leftEye.openingPercent,
      rightOpeningPercent: rightEye.openingPercent,
      leftClosedTouching: leftClosed,
      rightClosedTouching: rightClosed,
      landmarkPreview,
      warning: trackingStatus === 'low_confidence' ? 'Tracking confidence is limited for this frame.' : undefined
    },
    row
  };
};
