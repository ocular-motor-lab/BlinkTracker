from __future__ import annotations

from pathlib import Path

try:
    import cv2  # type: ignore
except Exception:  # pragma: no cover
    cv2 = None


def probe_video(path: str) -> dict[str, float | int | str]:
    source_path = Path(path).expanduser().resolve()
    if cv2 is None:
        raise RuntimeError("OpenCV is required to probe video files.")

    capture = cv2.VideoCapture(str(source_path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open video file: {source_path}")

    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    capture.release()

    duration_sec = frame_count / fps if fps > 0 else 0.0

    return {
        "path": str(source_path),
        "sourceName": source_path.name,
        "width": width,
        "height": height,
        "fps": fps,
        "frameCount": frame_count,
        "durationSec": duration_sec,
    }

