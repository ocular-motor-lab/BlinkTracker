from __future__ import annotations

from typing import Any


def process_frame_probe(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "frameIndex": payload["frameIndex"],
        "timestampSec": payload["timestampSec"],
        "trackingStatus": "pending_landmarks",
        "leftTrackingConfidence": 0.0,
        "rightTrackingConfidence": 0.0,
        "leftVisible": False,
        "rightVisible": False,
        "warning": "Milestone 2 frame pipeline active. Landmark extraction arrives in Milestone 3.",
    }

