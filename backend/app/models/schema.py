from __future__ import annotations

import json
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEMA_JSON_PATH = REPO_ROOT / "shared" / "schema" / "eyelid_schema.json"
SPEC_PATHS_JSON_PATH = REPO_ROOT / "shared" / "config" / "spec_paths.json"


def _load_json(path: Path) -> dict[str, Any]:
    with path.resolve().open("r", encoding="utf-8") as handle:
        return json.load(handle)


SCHEMA = _load_json(SCHEMA_JSON_PATH)
SPEC_PATHS = _load_json(SPEC_PATHS_JSON_PATH)

APP_VERSION = "0.1.0"
PIPELINE_VERSION = "0.1.0-mvp"
TRACKING_MODEL = "mediapipe_tasks_vision_renderer_v1"
OPENING_REFERENCE_METHOD = "95th_percentile_valid_opening"

FRAMEWISE_BASE_COLUMNS: list[str] = SCHEMA["framewiseBaseColumns"]
BLINK_COLUMNS: list[str] = SCHEMA["blinkColumns"]
BLINK_CSV_COLUMNS: list[str] = SCHEMA["blinkCsvColumns"]
METADATA_KEYS: list[str] = SCHEMA["metadataKeys"]
DEFAULT_BLINK_COLUMNS = {
    "blink_yes_no": 0,
    "left_blink": 0,
    "right_blink": 0,
    "bilateral_blink": 0,
}


def build_landmark_columns() -> list[str]:
    columns: list[str] = []
    for eye in ("left", "right"):
        eye_definition = SCHEMA["landmarkStructure"][eye]
        for prefix, count_key in (("upper_lid", "upper_lid_points"), ("lower_lid", "lower_lid_points")):
            for point_number in range(1, eye_definition[count_key] + 1):
                columns.extend(
                    [f"{eye}_{prefix}_x_{point_number}", f"{eye}_{prefix}_y_{point_number}"]
                )

        for singleton in eye_definition["singletons"]:
            columns.extend([f"{eye}_{singleton}_x", f"{eye}_{singleton}_y"])
    return columns


LANDMARK_COLUMNS = build_landmark_columns()
FRAMEWISE_COLUMNS = [*FRAMEWISE_BASE_COLUMNS, *LANDMARK_COLUMNS]
