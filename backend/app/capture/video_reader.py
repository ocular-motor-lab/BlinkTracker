from __future__ import annotations

from pathlib import Path
from typing import Any

try:
    import cv2  # type: ignore
except Exception:  # pragma: no cover
    cv2 = None

MAX_REASONABLE_FPS = 300.0
MAX_REASONABLE_FRAME_COUNT = 100_000_000


def _sanitize_fps(value: float) -> float:
    if value <= 0 or value > MAX_REASONABLE_FPS:
        return 0.0
    return value


def _sanitize_frame_count(value: int) -> int:
    if value <= 0 or value > MAX_REASONABLE_FRAME_COUNT:
        return 0
    return value


def _count_decoded_frames(capture: Any) -> tuple[int, float]:
    count = 0
    last_timestamp_sec = 0.0
    capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
    while True:
        ok, _frame = capture.read()
        if not ok:
            break
        count += 1
        position_msec = float(capture.get(cv2.CAP_PROP_POS_MSEC) or 0.0)
        if position_msec > 0:
            last_timestamp_sec = max(last_timestamp_sec, position_msec / 1000)
    return count, last_timestamp_sec


def probe_video(path: str) -> dict[str, float | int | str]:
    source_path = Path(path).expanduser().resolve()
    if cv2 is None:
        raise RuntimeError("OpenCV is required to probe video files.")

    capture = cv2.VideoCapture(str(source_path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open video file: {source_path}")

    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    raw_fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
    raw_frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fps = _sanitize_fps(raw_fps)
    frame_count = _sanitize_frame_count(raw_frame_count)
    decoded_duration_sec = 0.0
    if fps == 0.0 or frame_count == 0:
        decoded_count, decoded_duration_sec = _count_decoded_frames(capture)
        frame_count = _sanitize_frame_count(decoded_count)
        if fps == 0.0 and decoded_duration_sec > 0 and frame_count > 1:
            fps = _sanitize_fps((frame_count - 1) / decoded_duration_sec)
    capture.release()

    duration_sec = decoded_duration_sec if decoded_duration_sec > 0 else (frame_count / fps if fps > 0 else 0.0)

    return {
        "path": str(source_path),
        "sourceName": source_path.name,
        "width": width,
        "height": height,
        "fps": fps,
        "frameCount": frame_count,
        "durationSec": duration_sec,
    }
