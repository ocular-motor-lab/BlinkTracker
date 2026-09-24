from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.io.session_store import replace_frame_rows, update_session_metadata
from app.models.schema import DEFAULT_BLINK_COLUMNS, LANDMARK_COLUMNS

try:
    import cv2  # type: ignore
except Exception:  # pragma: no cover
    cv2 = None


def _landmark_columns_from_eye(prefix: str, eye: Any, row: dict[str, Any]) -> None:
    for index, point in enumerate(eye.upper_lid, start=1):
        row[f"{prefix}_upper_lid_x_{index}"] = point[0]
        row[f"{prefix}_upper_lid_y_{index}"] = point[1]
    for index, point in enumerate(eye.lower_lid, start=1):
        row[f"{prefix}_lower_lid_x_{index}"] = point[0]
        row[f"{prefix}_lower_lid_y_{index}"] = point[1]
    row[f"{prefix}_medial_canthus_x"] = eye.medial_canthus[0]
    row[f"{prefix}_medial_canthus_y"] = eye.medial_canthus[1]
    row[f"{prefix}_lateral_canthus_x"] = eye.lateral_canthus[0]
    row[f"{prefix}_lateral_canthus_y"] = eye.lateral_canthus[1]
    row[f"{prefix}_center_reference_x"] = eye.center_reference[0]
    row[f"{prefix}_center_reference_y"] = eye.center_reference[1]


def _landmark_columns(metrics: dict[str, Any]) -> dict[str, Any]:
    row = {column: "" for column in LANDMARK_COLUMNS}
    landmarks = metrics.get("landmarks") or {}
    left_eye = landmarks.get("left")
    right_eye = landmarks.get("right")
    if left_eye:
        _landmark_columns_from_eye("left", left_eye, row)
    if right_eye:
        _landmark_columns_from_eye("right", right_eye, row)
    return row


def process_video(session_folder: str, video_file_path: str) -> dict[str, Any]:
    if cv2 is None:
        raise RuntimeError("OpenCV is required to process uploaded videos.")

    from app.tracking.landmarks import TRACKER
    from app.tracking.metrics import compute_frame_metrics

    source_path = Path(video_file_path).expanduser().resolve()
    capture = cv2.VideoCapture(str(source_path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open video file: {source_path}")

    fps = float(capture.get(cv2.CAP_PROP_FPS) or 30.0)
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    state: dict[str, Any] = {"left_reference_max": 0.0, "right_reference_max": 0.0}
    rows: list[dict[str, Any]] = []
    frame_index = 0
    previous_timestamp_sec: float | None = None
    session_id = str(update_session_metadata(session_folder, {})["session_id"])

    while True:
        ok, frame = capture.read()
        if not ok:
            break

        timestamp_sec = frame_index / fps if fps > 0 else 0.0
        tracking_result = TRACKER.track_eyelids(frame, int(timestamp_sec * 1000))
        metrics = compute_frame_metrics(tracking_result, state)
        row = {
            "session_id": session_id,
            "source_type": "video_file",
            "source_name": source_path.name,
            "frame_index": frame_index,
            "timestamp_sec": timestamp_sec,
            "timestamp_iso": datetime.now(timezone.utc).isoformat(),
            "nominal_fps": fps,
            "dt_sec": 0 if previous_timestamp_sec is None else max(0.0, timestamp_sec - previous_timestamp_sec),
            "left_opening_px": metrics["left_opening_px"] if metrics["left_opening_px"] is not None else "",
            "right_opening_px": metrics["right_opening_px"] if metrics["right_opening_px"] is not None else "",
            "left_opening_percent": metrics["left_opening_percent"] if metrics["left_opening_percent"] is not None else "",
            "right_opening_percent": metrics["right_opening_percent"] if metrics["right_opening_percent"] is not None else "",
            "left_closed_touching": metrics["left_closed_touching"],
            "right_closed_touching": metrics["right_closed_touching"],
            "left_closed_touching_confidence": metrics["left_closed_touching_confidence"],
            "right_closed_touching_confidence": metrics["right_closed_touching_confidence"],
            "left_tracking_confidence": metrics["left_tracking_confidence"],
            "right_tracking_confidence": metrics["right_tracking_confidence"],
            "left_visible": metrics["left_visible"],
            "right_visible": metrics["right_visible"],
            "gaze_direction": metrics["gaze_direction"],
            "gaze_horizontal_ratio": metrics["gaze_horizontal_ratio"] if metrics["gaze_horizontal_ratio"] is not None else "",
            "gaze_vertical_ratio": metrics["gaze_vertical_ratio"] if metrics["gaze_vertical_ratio"] is not None else "",
            **DEFAULT_BLINK_COLUMNS,
            **_landmark_columns(metrics),
        }
        rows.append(row)
        previous_timestamp_sec = timestamp_sec
        frame_index += 1

    capture.release()
    replace_frame_rows(session_folder, rows)
    duration_sec = rows[-1]["timestamp_sec"] if rows else 0.0
    update_session_metadata(
        session_folder,
        {
            "source_name": source_path.name,
            "source_path": str(source_path),
            "resolution_width": width,
            "resolution_height": height,
            "nominal_fps": fps,
            "elapsed_sec": duration_sec,
            "processed_video_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return {"ok": True, "frameCount": len(rows), "durationSec": duration_sec}
