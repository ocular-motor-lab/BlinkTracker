from __future__ import annotations

from dataclasses import asdict
from typing import Any

from app.models.contracts import CameraInfo, CreateSessionRequest


IPC_VERSION = "1"


def camera_payload(camera: CameraInfo) -> dict[str, Any]:
    payload = camera.to_payload()
    payload["ipcVersion"] = IPC_VERSION
    return payload


def parse_create_session_request(payload: dict[str, Any]) -> CreateSessionRequest:
    return CreateSessionRequest(**payload)


def enrich_response(payload: dict[str, Any]) -> dict[str, Any]:
    return {"ipcVersion": IPC_VERSION, **payload}

