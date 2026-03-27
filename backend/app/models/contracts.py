from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

SourceType = Literal["camera", "video_file"]


@dataclass(slots=True)
class CameraMode:
    width: int
    height: int
    fps: int


@dataclass(slots=True)
class CameraInfo:
    device_id: str
    label: str
    index: int
    available: bool
    modes: list[CameraMode] = field(default_factory=list)

    def to_payload(self) -> dict[str, Any]:
        return {
            "deviceId": self.device_id,
            "label": self.label,
            "index": self.index,
            "available": self.available,
            "modes": [asdict(mode) for mode in self.modes],
        }


@dataclass(slots=True)
class CreateSessionRequest:
    sessionName: str
    subjectId: str
    notes: str
    sourceType: SourceType
    cameraDeviceId: str
    videoFilePath: str
    outputFolder: str
    saveRawVideo: bool
    preferHighResolution: bool = False
    preferredCameraLabel: str = ""


@dataclass(slots=True)
class SessionPaths:
    sessionFolder: str
    framewiseCsvPath: str
    blinkCsvPath: str
    metadataJsonPath: str
    auditLogPath: str
    rawVideoPath: str | None = None

    def to_payload(self) -> dict[str, Any]:
        return asdict(self)

