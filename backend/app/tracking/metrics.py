from __future__ import annotations

from typing import Any

import math
import numpy as np


def _distance(point_a: tuple[float, float], point_b: tuple[float, float]) -> float:
    return math.dist(point_a, point_b)


def _opening_from_eye(eye: Any) -> float:
    upper = eye.upper_lid
    lower = eye.lower_lid
    central_upper = [point[1] for point in upper[1:4]]
    central_lower = [point[1] for point in lower[1:4]]
    return float(np.mean(central_lower) - np.mean(central_upper))


def _confidence_for_eye(eye: Any, opening_px: float) -> float:
    eye_width = _distance(eye.medial_canthus, eye.lateral_canthus)
    if eye_width <= 1.0:
        return 0.0
    normalized_opening = max(0.0, min(1.0, opening_px / max(eye_width * 0.45, 1.0)))
    edge_support = float(getattr(eye, "support_score", 0.25))
    base_confidence = 0.2 + normalized_opening * 0.5
    return float(max(0.0, min(1.0, base_confidence * 0.5 + edge_support * 0.5)))


def _percent_opening(opening_px: float | None, current_reference: float) -> float | None:
    if opening_px is None or current_reference <= 0:
        return None
    return float(max(0.0, (opening_px / current_reference) * 100.0))


def compute_frame_metrics(tracking_result: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    if not tracking_result["detected"]:
        return {
            "tracking_status": "no_face",
            "left_opening_px": None,
            "right_opening_px": None,
            "left_opening_percent": None,
            "right_opening_percent": None,
            "left_closed_touching": 0,
            "right_closed_touching": 0,
            "left_closed_touching_confidence": 0.0,
            "right_closed_touching_confidence": 0.0,
            "left_tracking_confidence": 0.0,
            "right_tracking_confidence": 0.0,
            "left_visible": 0,
            "right_visible": 0,
            "landmarks": {},
            "landmark_preview": [],
        }

    left_eye = tracking_result["left_eye"]
    right_eye = tracking_result["right_eye"]

    left_opening_px = max(0.0, _opening_from_eye(left_eye))
    right_opening_px = max(0.0, _opening_from_eye(right_eye))
    left_confidence = _confidence_for_eye(left_eye, left_opening_px)
    right_confidence = _confidence_for_eye(right_eye, right_opening_px)

    state["left_reference_max"] = max(state.get("left_reference_max", 0.0), left_opening_px)
    state["right_reference_max"] = max(state.get("right_reference_max", 0.0), right_opening_px)

    left_percent = _percent_opening(left_opening_px, state["left_reference_max"])
    right_percent = _percent_opening(right_opening_px, state["right_reference_max"])

    left_closed = 1 if left_percent is not None and left_percent < 20.0 and left_confidence >= 0.4 else 0
    right_closed = 1 if right_percent is not None and right_percent < 20.0 and right_confidence >= 0.4 else 0

    tracking_status = "tracked"
    if left_confidence < 0.45 or right_confidence < 0.45:
        tracking_status = "low_confidence"

    preview = []
    for kind, points in (
        ("left_upper", left_eye.upper_lid),
        ("left_lower", left_eye.lower_lid),
        ("right_upper", right_eye.upper_lid),
        ("right_lower", right_eye.lower_lid),
    ):
        for point in points:
            preview.append({"x": point[0], "y": point[1], "kind": kind})

    return {
        "tracking_status": tracking_status,
        "left_opening_px": left_opening_px,
        "right_opening_px": right_opening_px,
        "left_opening_percent": left_percent,
        "right_opening_percent": right_percent,
        "left_closed_touching": left_closed,
        "right_closed_touching": right_closed,
        "left_closed_touching_confidence": left_confidence,
        "right_closed_touching_confidence": right_confidence,
        "left_tracking_confidence": left_confidence,
        "right_tracking_confidence": right_confidence,
        "left_visible": 1,
        "right_visible": 1,
        "landmarks": {
            "left": left_eye,
            "right": right_eye,
        },
        "landmark_preview": preview,
    }
