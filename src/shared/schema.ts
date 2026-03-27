import schemaJson from '../../shared/schema/eyelid_schema.json' with { type: 'json' };
import specPathsJson from '../../shared/config/spec_paths.json' with { type: 'json' };

export const APP_VERSION = '0.1.0';
export const PIPELINE_VERSION = '0.1.0-mvp';
export const TRACKING_MODEL = 'mediapipe_tasks_vision_renderer_v1';
export const OPENING_REFERENCE_METHOD = '95th_percentile_valid_opening';

export const FRAMEWISE_BASE_COLUMNS = schemaJson.framewiseBaseColumns as string[];
export const BLINK_COLUMNS = schemaJson.blinkColumns as string[];
export const BLINK_CSV_COLUMNS = schemaJson.blinkCsvColumns as string[];
export const METADATA_KEYS = schemaJson.metadataKeys as string[];

type EyeSide = 'left' | 'right';
type PointAxis = 'x' | 'y';

const buildEyeLandmarkColumns = (eye: EyeSide): string[] => {
  const eyeDefinition = schemaJson.landmarkStructure[eye];
  const upper = Array.from({ length: eyeDefinition.upper_lid_points }, (_, index) => {
    const pointNumber = index + 1;
    return [`${eye}_upper_lid_x_${pointNumber}`, `${eye}_upper_lid_y_${pointNumber}`];
  }).flat();
  const lower = Array.from({ length: eyeDefinition.lower_lid_points }, (_, index) => {
    const pointNumber = index + 1;
    return [`${eye}_lower_lid_x_${pointNumber}`, `${eye}_lower_lid_y_${pointNumber}`];
  }).flat();
  const singletons = eyeDefinition.singletons.flatMap((name) =>
    (['x', 'y'] as PointAxis[]).map((axis) => `${eye}_${name}_${axis}`)
  );

  return [...upper, ...lower, ...singletons];
};

export const LANDMARK_COLUMNS = [...buildEyeLandmarkColumns('left'), ...buildEyeLandmarkColumns('right')];
export const FRAMEWISE_COLUMNS = [...FRAMEWISE_BASE_COLUMNS, ...LANDMARK_COLUMNS];

export const SPEC_PATHS = specPathsJson;

export const DEFAULT_BLINK_COLUMNS = {
  blink_yes_no: 0,
  left_blink: 0,
  right_blink: 0,
  bilateral_blink: 0
} as const;

export const SOURCE_TYPES = ['camera', 'video_file'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
