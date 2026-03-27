from __future__ import annotations

import csv
import json
import re
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import pandas as pd

from app.models.contracts import CreateSessionRequest, SessionPaths
from app.models.schema import (
    APP_VERSION,
    BLINK_CSV_COLUMNS,
    FRAMEWISE_COLUMNS,
    OPENING_REFERENCE_METHOD,
    PIPELINE_VERSION,
    TRACKING_MODEL,
)


def _slugify(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9_-]+", "_", value.strip())
    return normalized.strip("_").lower() or "session"


def _write_csv_header(path: Path, columns: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(columns)


def _write_json(path: Path, payload: Any) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def _read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _replace_nan(value: Any) -> Any:
    if pd.isna(value):
        return None
    return value


def _read_csv_rows(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []

    frame = pd.read_csv(path)
    if frame.empty:
        return []

    rows: list[dict[str, Any]] = []
    for record in frame.to_dict(orient="records"):
        rows.append({key: _replace_nan(value) for key, value in record.items()})
    return rows


def _detect_media_path(metadata: dict[str, Any], paths: SessionPaths) -> str | None:
    candidates = [
        metadata.get("raw_video_path"),
        paths.rawVideoPath,
        str(Path(paths.sessionFolder) / "raw_video.mp4"),
        metadata.get("source_path"),
    ]
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(str(candidate)).expanduser()
        if path.exists():
            return str(path.resolve())
    return None


def append_frame_row(session_folder: str, row: dict[str, Any]) -> None:
    append_frame_rows(session_folder, [row])


def append_frame_rows(session_folder: str, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    folder = Path(session_folder).expanduser().resolve()
    framewise_path = folder / "framewise_measurements.csv"
    with framewise_path.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FRAMEWISE_COLUMNS, extrasaction="ignore")
        for row in rows:
            writer.writerow({column: row.get(column, "") for column in FRAMEWISE_COLUMNS})


def create_session(request: CreateSessionRequest) -> dict[str, Any]:
    created_at = datetime.now(timezone.utc)
    session_id = uuid4().hex

    root = Path(request.outputFolder).expanduser().resolve()
    session_folder = root / f"{_slugify(request.sessionName)}_{created_at.strftime('%Y%m%d_%H%M%S')}"
    session_folder.mkdir(parents=True, exist_ok=False)

    paths = SessionPaths(
        sessionFolder=str(session_folder),
        framewiseCsvPath=str(session_folder / "framewise_measurements.csv"),
        blinkCsvPath=str(session_folder / "blink_events.csv"),
        metadataJsonPath=str(session_folder / "session_metadata.json"),
        auditLogPath=str(session_folder / "audit_log.json"),
        rawVideoPath=str(session_folder / "raw_video.webm")
        if request.sourceType == "camera" and request.saveRawVideo
        else None,
    )

    _write_csv_header(Path(paths.framewiseCsvPath), FRAMEWISE_COLUMNS)
    _write_csv_header(Path(paths.blinkCsvPath), BLINK_CSV_COLUMNS)

    source_name = request.preferredCameraLabel or request.cameraDeviceId
    if request.sourceType == "video_file":
        source_name = Path(request.videoFilePath).name

    metadata = {
        "session_id": session_id,
        "app_version": APP_VERSION,
        "pipeline_version": PIPELINE_VERSION,
        "source_type": request.sourceType,
        "source_name": source_name,
        "resolution_width": 0,
        "resolution_height": 0,
        "nominal_fps": 0,
        "session_created_at": created_at.isoformat(),
        "save_raw_video": request.saveRawVideo,
        "tracking_model": TRACKING_MODEL,
        "opening_reference_method": OPENING_REFERENCE_METHOD,
        "settings": {},
        "session_name": request.sessionName,
        "subject_id": request.subjectId,
        "notes": request.notes,
        "output_folder": str(root),
        "session_folder": str(session_folder),
    }

    audit_log = [
        {
            "timestamp": created_at.isoformat(),
            "action": "session_created",
            "new_value": {
                "session_id": session_id,
                "source_type": request.sourceType,
                "source_name": source_name,
            },
        }
    ]

    _write_json(Path(paths.metadataJsonPath), metadata)
    _write_json(Path(paths.auditLogPath), audit_log)

    return {"metadata": metadata, "paths": asdict(paths)}


def load_session(session_folder: str) -> dict[str, Any]:
    folder = Path(session_folder).expanduser().resolve()
    if not folder.exists():
        raise FileNotFoundError(f"Session folder does not exist: {folder}")

    metadata_path = folder / "session_metadata.json"
    framewise_path = folder / "framewise_measurements.csv"
    blink_path = folder / "blink_events.csv"
    audit_path = folder / "audit_log.json"

    metadata = _read_json(metadata_path)
    paths = SessionPaths(
        sessionFolder=str(folder),
        framewiseCsvPath=str(framewise_path),
        blinkCsvPath=str(blink_path),
        metadataJsonPath=str(metadata_path),
        auditLogPath=str(audit_path),
        rawVideoPath=str(folder / "raw_video.webm")
        if (folder / "raw_video.webm").exists()
        else (str(folder / "raw_video.mp4") if (folder / "raw_video.mp4").exists() else None),
    )
    frame_rows = _read_csv_rows(framewise_path)
    blink_rows = _read_csv_rows(blink_path)
    timeline_start_sec = 0.0
    duration_sec = 0.0
    if frame_rows:
        timestamps = [
            float(value)
            for value in (row.get("timestamp_sec") for row in frame_rows)
            if isinstance(value, (int, float))
        ]
        if timestamps:
            timeline_start_sec = float(timestamps[0])
            duration_sec = float(timestamps[-1])
    media_sync_offset_sec = metadata.get("media_sync_offset_sec")
    if not isinstance(media_sync_offset_sec, (int, float)):
        media_sync_offset_sec = timeline_start_sec

    return {
        "metadata": metadata,
        "paths": asdict(paths),
        "frameRows": frame_rows,
        "blinkRows": blink_rows,
        "mediaPath": _detect_media_path(metadata, paths),
        "frameCount": len(frame_rows),
        "timelineStartSec": timeline_start_sec,
        "durationSec": duration_sec,
        "mediaSyncOffsetSec": float(media_sync_offset_sec),
    }


def update_session_metadata(session_folder: str, updates: dict[str, Any]) -> dict[str, Any]:
    folder = Path(session_folder).expanduser().resolve()
    metadata_path = folder / "session_metadata.json"
    metadata = _read_json(metadata_path)
    metadata.update(updates)
    _write_json(metadata_path, metadata)
    return metadata


def append_audit_log(
    session_folder: str,
    action: str,
    note: str | None = None,
    old_value: Any = None,
    new_value: Any = None,
) -> dict[str, bool]:
    folder = Path(session_folder).expanduser().resolve()
    audit_path = folder / "audit_log.json"
    audit_entries = _read_json(audit_path)
    audit_entries.append(
        {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "action": action,
            "note": note,
            "old_value": old_value,
            "new_value": new_value,
        }
    )
    _write_json(audit_path, audit_entries)
    return {"ok": True}
