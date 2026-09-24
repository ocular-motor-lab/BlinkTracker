from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2  # type: ignore
import mediapipe as mp  # type: ignore
from mediapipe.tasks.python import BaseOptions  # type: ignore
from mediapipe.tasks.python import vision  # type: ignore


@dataclass(slots=True)
class EyeLandmarks:
    upper_lid: list[tuple[float, float]]
    lower_lid: list[tuple[float, float]]
    medial_canthus: tuple[float, float]
    lateral_canthus: tuple[float, float]
    center_reference: tuple[float, float]
    support_score: float


LEFT_UPPER = [33, 160, 159, 158, 133]
LEFT_LOWER = [33, 144, 145, 153, 133]
RIGHT_UPPER = [362, 385, 386, 387, 263]
RIGHT_LOWER = [362, 380, 374, 373, 263]
LEFT_MEDIAL = 133
LEFT_LATERAL = 33
RIGHT_MEDIAL = 362
RIGHT_LATERAL = 263
LEFT_IRIS = [468, 469, 470, 471, 472]
RIGHT_IRIS = [473, 474, 475, 476, 477]


class MediaPipeFaceMeshTracker:
    def __init__(self) -> None:
        model_path = Path(__file__).resolve().parents[2] / "models" / "face_landmarker.task"
        self._mesh = vision.FaceLandmarker.create_from_options(
            vision.FaceLandmarkerOptions(
                base_options=BaseOptions(model_asset_path=str(model_path)),
                running_mode=vision.RunningMode.VIDEO,
                num_faces=1,
                min_face_detection_confidence=0.5,
                min_face_presence_confidence=0.5,
                min_tracking_confidence=0.5,
                output_face_blendshapes=False,
                output_facial_transformation_matrixes=False,
            )
        )
        self._last_timestamp_ms = -1

    @staticmethod
    def _extract_point(landmarks: list[Any], index: int, width: int, height: int) -> tuple[float, float]:
        point = landmarks[index]
        return (float(point.x * width), float(point.y * height))

    def _extract_eye(
        self,
        landmarks: list[Any],
        width: int,
        height: int,
        upper_indices: list[int],
        lower_indices: list[int],
        medial_index: int,
        lateral_index: int,
        iris_indices: list[int],
    ) -> EyeLandmarks:
        upper = [self._extract_point(landmarks, index, width, height) for index in upper_indices]
        lower = [self._extract_point(landmarks, index, width, height) for index in lower_indices]
        medial = self._extract_point(landmarks, medial_index, width, height)
        lateral = self._extract_point(landmarks, lateral_index, width, height)

        iris_points = [self._extract_point(landmarks, index, width, height) for index in iris_indices]
        center = (
            float(sum(point[0] for point in iris_points) / len(iris_points)),
            float(sum(point[1] for point in iris_points) / len(iris_points)),
        )

        visibility = getattr(landmarks[medial_index], "visibility", None)
        support = 0.85 if visibility is None else float(max(0.0, min(1.0, visibility)))
        if support == 0.0:
            support = 0.85

        return EyeLandmarks(
            upper_lid=upper,
            lower_lid=lower,
            medial_canthus=medial,
            lateral_canthus=lateral,
            center_reference=center,
            support_score=support,
        )

    def track_eyelids(self, frame_bgr: Any, timestamp_ms: int | None = None) -> dict[str, Any]:
        height, width = frame_bgr.shape[:2]
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
        if timestamp_ms is None:
            timestamp_ms = self._last_timestamp_ms + 1
        timestamp_ms = max(timestamp_ms, self._last_timestamp_ms + 1)
        self._last_timestamp_ms = timestamp_ms

        result = self._mesh.detect_for_video(image, timestamp_ms)
        if not result.face_landmarks:
            return {"detected": False, "width": width, "height": height}

        face_landmarks = result.face_landmarks[0]
        left_eye = self._extract_eye(
            face_landmarks,
            width,
            height,
            LEFT_UPPER,
            LEFT_LOWER,
            LEFT_MEDIAL,
            LEFT_LATERAL,
            LEFT_IRIS,
        )
        right_eye = self._extract_eye(
            face_landmarks,
            width,
            height,
            RIGHT_UPPER,
            RIGHT_LOWER,
            RIGHT_MEDIAL,
            RIGHT_LATERAL,
            RIGHT_IRIS,
        )

        return {
            "detected": True,
            "width": width,
            "height": height,
            "left_eye": left_eye,
            "right_eye": right_eye,
        }


TRACKER = MediaPipeFaceMeshTracker()
