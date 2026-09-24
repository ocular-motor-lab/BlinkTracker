from __future__ import annotations

import csv
import json
import re
import zipfile
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4
from xml.sax.saxutils import escape

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

SESSION_INDEX_COLUMNS = [
    "subject_id",
    "session_date",
    "session_name",
    "session_folder",
    "duration_sec",
    "blink_count",
    "source_type",
    "database_notes",
    "created_at",
]
SESSION_INDEX_COLUMN_WIDTHS = [16, 16, 28, 58, 14, 12, 14, 48, 24]
SESSION_INDEX_HEADERS = [
    "Subject ID",
    "Session Date",
    "Session Name",
    "Session Folder",
    "Duration Sec",
    "Blink Count",
    "Source Type",
    "Database Notes",
    "Created At",
]


def _slugify(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9_-]+", "_", value.strip())
    return normalized.strip("_").lower() or "session"


def _write_csv_header(path: Path, columns: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(columns)


def _write_csv_rows(path: Path, columns: list[str], rows: list[dict[str, Any]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({column: row.get(column, "") for column in columns})


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


def replace_frame_rows(session_folder: str, rows: list[dict[str, Any]]) -> None:
    folder = Path(session_folder).expanduser().resolve()
    framewise_path = folder / "framewise_measurements.csv"
    _write_csv_rows(framewise_path, FRAMEWISE_COLUMNS, rows)


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
    calibration_csv_path = session_folder / "baseline_calibration_framewise.csv"
    if request.calibrationFrameRows:
        _write_csv_rows(calibration_csv_path, FRAMEWISE_COLUMNS, request.calibrationFrameRows)

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
        "settings": {
            "camera_mode": request.cameraMode,
            "prefer_high_resolution": request.preferHighResolution,
        },
        "session_name": request.sessionName,
        "session_date": request.sessionDate,
        "subject_id": request.subjectId,
        "subject_age": request.subjectAge,
        "subject_sex": request.subjectSex,
        "subject_race_ethnicity": request.subjectRaceEthnicity,
        "eye_health_baseline": {
            "diagnosed_dry_eye": request.diagnosedDryEye,
            "uses_eye_drops": request.usesEyeDrops,
            "eye_drops_details": request.eyeDropsDetails,
            "eye_drops_last_two_hours": request.eyeDropsLastTwoHours,
            "wears_contact_lenses": request.wearsContactLenses,
            "contact_lens_type": request.contactLensType,
            "worn_contacts_today": request.wornContactsToday,
            "wearing_contact_lenses_now": request.wearingContactLensesNow,
            "wears_glasses": request.wearsGlasses,
            "wearing_glasses_today": request.wearingGlassesToday,
            "recent_eye_surgery": request.recentEyeSurgery,
            "eye_surgery_details": request.eyeSurgeryDetails,
            "eye_allergies": request.eyeAllergies,
            "eye_allergy_details": request.eyeAllergyDetails,
        },
        "todays_symptoms": {
            "dryness_0_to_5": request.symptomDryness,
            "tiredness_0_to_5": request.symptomTiredness,
            "burning_stinging_0_to_5": request.symptomBurningStinging,
            "blurry_vision_0_to_5": request.symptomBlurryVision,
            "light_sensitivity_0_to_5": request.symptomLightSensitivity,
        },
        "general_health_today": {
            "sleep_hours": request.sleepHours,
            "consumed_caffeine": request.consumedCaffeine,
            "caffeine_timing": request.caffeineTiming,
            "consumed_alcohol_24h": request.consumedAlcohol24h,
            "alertness_eye_health_medications": request.alertnessEyeMeds,
            "feeling_sick": request.feelingSick,
            "stress_level_1_to_5": request.stressLevel,
            "energy_level_1_to_5": request.energyLevel,
        },
        "environment_prior_to_session": {
            "screen_reading_duration_today": request.screenReadingDurationToday,
            "air_conditioning_or_heated_environment": request.priorAirConditioningHeating,
            "outdoors_wind_or_sun": request.priorWindSun,
            "dry_environment_today": request.dryEnvironmentToday,
        },
        "session_conditions": {
            "room_temperature": request.roomTemperature,
            "device_used": request.deviceUsed,
            "screen_brightness": request.screenBrightness,
            "viewing_distance_cm": request.viewingDistanceCm,
            "current_emotion": request.currentEmotion,
        },
        "pre_session_calibration": {
            "calibration_reminder_acknowledged": request.calibrationReminderAcknowledged,
            "resting_palpebral_aperture": request.restingPalpebralAperture,
            "baseline_calibration_frame_count": len(request.calibrationFrameRows),
            "baseline_calibration_csv_path": str(calibration_csv_path) if request.calibrationFrameRows else "",
            "baseline_calibration_summary": request.calibrationSummary or {},
        },
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


def _count_active_blinks(path: Path) -> int:
    if not path.exists():
        return 0

    frame = pd.read_csv(path)
    if frame.empty:
        return 0
    if "is_deleted" not in frame.columns:
        return int(len(frame))
    return int((frame["is_deleted"].fillna(0).astype(int) != 1).sum())


def _session_duration_sec(path: Path) -> float:
    if not path.exists():
        return 0.0

    frame = pd.read_csv(path, usecols=lambda column: column == "timestamp_sec")
    if frame.empty or "timestamp_sec" not in frame.columns:
        return 0.0

    timestamps = pd.to_numeric(frame["timestamp_sec"], errors="coerce").dropna()
    if timestamps.empty:
        return 0.0
    return float(timestamps.max() - timestamps.min())


def _session_index_path(root: Path) -> Path:
    return root / "session_index.csv"


def _session_index_xlsx_path(root: Path) -> Path:
    return root / "session_index.xlsx"


def _session_index_rows(sessions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "subject_id": session.get("subjectId", ""),
            "session_date": session.get("sessionDate", ""),
            "session_name": session.get("sessionName", ""),
            "session_folder": session.get("sessionFolder", ""),
            "duration_sec": session.get("durationSec", 0),
            "blink_count": session.get("blinkCount", 0),
            "source_type": session.get("sourceType", ""),
            "database_notes": session.get("databaseNotes", ""),
            "created_at": session.get("createdAt", ""),
        }
        for session in sessions
    ]


def _write_session_index(root: Path, sessions: list[dict[str, Any]]) -> Path:
    path = _session_index_path(root)
    rows = _session_index_rows(sessions)
    _write_csv_rows(path, SESSION_INDEX_COLUMNS, rows)
    _write_session_index_xlsx(_session_index_xlsx_path(root), rows)
    return path


def _xlsx_cell(column_index: int, row_index: int, value: Any) -> str:
    column_name = ""
    number = column_index
    while number:
        number, remainder = divmod(number - 1, 26)
        column_name = chr(65 + remainder) + column_name
    reference = f"{column_name}{row_index}"

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f'<c r="{reference}"><v>{value}</v></c>'

    return f'<c r="{reference}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>'


def _xlsx_row(row_index: int, values: list[Any]) -> str:
    cells = "".join(_xlsx_cell(column_index, row_index, value) for column_index, value in enumerate(values, start=1))
    return f'<row r="{row_index}">{cells}</row>'


def _write_session_index_xlsx(path: Path, rows: list[dict[str, Any]]) -> None:
    column_defs = "".join(
        f'<col min="{index}" max="{index}" width="{width}" customWidth="1"/>'
        for index, width in enumerate(SESSION_INDEX_COLUMN_WIDTHS, start=1)
    )
    sheet_rows = [_xlsx_row(1, SESSION_INDEX_HEADERS)]
    for row_index, row in enumerate(rows, start=2):
        sheet_rows.append(_xlsx_row(row_index, [row.get(column, "") for column in SESSION_INDEX_COLUMNS]))

    sheet_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>{column_defs}</cols>
  <sheetData>{"".join(sheet_rows)}</sheetData>
</worksheet>'''

    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "[Content_Types].xml",
            '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>''',
        )
        archive.writestr(
            "_rels/.rels",
            '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>''',
        )
        archive.writestr(
            "xl/workbook.xml",
            '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Session Index" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>''',
        )
        archive.writestr(
            "xl/_rels/workbook.xml.rels",
            '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>''',
        )
        archive.writestr("xl/worksheets/sheet1.xml", sheet_xml)


def _collect_sessions(root: Path) -> list[dict[str, Any]]:
    sessions: list[dict[str, Any]] = []
    for metadata_path in root.rglob("session_metadata.json"):
        folder = metadata_path.parent
        try:
            metadata = _read_json(metadata_path)
            sessions.append(
                {
                    "sessionFolder": str(folder),
                    "sessionName": str(metadata.get("session_name") or folder.name),
                    "subjectId": str(metadata.get("subject_id") or ""),
                    "sessionDate": str(metadata.get("session_date") or ""),
                    "createdAt": str(metadata.get("session_created_at") or ""),
                    "sourceType": str(metadata.get("source_type") or ""),
                    "databaseNotes": str(metadata.get("database_notes") or ""),
                    "durationSec": _session_duration_sec(folder / "framewise_measurements.csv"),
                    "blinkCount": _count_active_blinks(folder / "blink_events.csv"),
                    "frameCount": int(metadata.get("frame_count") or 0),
                }
            )
        except Exception as error:
            sessions.append(
                {
                    "sessionFolder": str(folder),
                    "sessionName": folder.name,
                    "subjectId": "",
                    "sessionDate": "",
                    "createdAt": "",
                    "sourceType": "",
                    "databaseNotes": "",
                    "durationSec": 0.0,
                    "blinkCount": 0,
                    "frameCount": 0,
                    "error": str(error),
                }
            )

    return sorted(sessions, key=lambda session: str(session.get("createdAt") or ""), reverse=True)


def list_sessions(root_folder: str) -> dict[str, Any]:
    root = Path(root_folder).expanduser().resolve()
    if not root.exists():
        raise FileNotFoundError(f"Session database folder does not exist: {root}")

    sessions = _collect_sessions(root)
    session_index_path = _write_session_index(root, sessions)
    session_index_xlsx_path = _session_index_xlsx_path(root)

    return {
        "rootFolder": str(root),
        "sessions": sessions,
        "sessionIndexPath": str(session_index_path),
        "sessionIndexXlsxPath": str(session_index_xlsx_path),
    }


def update_session_metadata(session_folder: str, updates: dict[str, Any]) -> dict[str, Any]:
    folder = Path(session_folder).expanduser().resolve()
    metadata_path = folder / "session_metadata.json"
    metadata = _read_json(metadata_path)
    metadata.update(updates)
    _write_json(metadata_path, metadata)
    root = folder.parent
    if root.exists():
        _write_session_index(root, _collect_sessions(root))
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
