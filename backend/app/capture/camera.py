from __future__ import annotations

from typing import Iterable

from app.models.contracts import CameraInfo, CameraMode

try:
    import cv2  # type: ignore
except Exception:  # pragma: no cover - dependency may be absent in early setup
    cv2 = None


DEFAULT_CAMERA_MODES = [
    CameraMode(width=640, height=480, fps=30),
    CameraMode(width=1280, height=720, fps=30),
    CameraMode(width=1920, height=1080, fps=60),
]


def _probe_camera_indices(max_index: int = 5) -> Iterable[CameraInfo]:
    if cv2 is None:
        yield CameraInfo(
            device_id="camera-0",
            label="Default Camera (OpenCV unavailable)",
            index=0,
            available=False,
            modes=DEFAULT_CAMERA_MODES,
        )
        return

    discovered = False
    for index in range(max_index):
        capture = cv2.VideoCapture(index)
        is_open = bool(capture.isOpened())
        if is_open:
            discovered = True
        yield CameraInfo(
            device_id=f"camera-{index}",
            label=f"Camera {index}",
            index=index,
            available=is_open,
            modes=DEFAULT_CAMERA_MODES,
        )
        capture.release()

    if not discovered:
        yield CameraInfo(
            device_id="camera-0",
            label="No available camera detected",
            index=0,
            available=False,
            modes=DEFAULT_CAMERA_MODES,
        )


def list_cameras() -> list[CameraInfo]:
    return list(_probe_camera_indices())

