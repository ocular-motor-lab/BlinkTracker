from __future__ import annotations

import csv
from pathlib import Path

from app.analysis.blinks import detect_blinks, save_blink_edits
from app.io.session_store import append_frame_rows, create_session
from app.models.contracts import CreateSessionRequest


def _create_demo_session(tmp_path: Path) -> dict[str, object]:
    session = create_session(
        CreateSessionRequest(
            sessionName="blink_detection",
            subjectId="S1",
            notes="",
            sourceType="camera",
            cameraDeviceId="camera-0",
            videoFilePath="",
            outputFolder=str(tmp_path),
            saveRawVideo=False,
            preferredCameraLabel="Camera 0",
        )
    )
    rows = [
        {
            "session_id": session["metadata"]["session_id"],
            "source_type": "camera",
            "source_name": "Camera 0",
            "frame_index": index,
            "timestamp_sec": index * 0.05,
            "left_opening_px": 10,
            "right_opening_px": 10,
            "left_opening_percent": value,
            "right_opening_percent": value,
            "left_tracking_confidence": 0.8,
            "right_tracking_confidence": 0.8,
            "left_visible": 1,
            "right_visible": 1,
        }
        for index, value in enumerate([95, 92, 30, 20, 28, 94, 96])
    ]
    append_frame_rows(session["paths"]["sessionFolder"], rows)
    return session


def test_detect_blinks_generates_blink_rows_and_updates_framewise(tmp_path: Path) -> None:
    session = _create_demo_session(tmp_path)
    session_folder = session["paths"]["sessionFolder"]

    blink_rows = detect_blinks(session_folder)

    assert any(row["eye_side"] == "bilateral" for row in blink_rows)
    frame_rows = list(csv.DictReader(open(session["paths"]["framewiseCsvPath"], encoding="utf-8")))
    assert any(row["blink_yes_no"] == "1" for row in frame_rows)
    assert any(row["bilateral_blink"] == "1" for row in frame_rows)


def test_save_blink_edits_persists_manual_blink(tmp_path: Path) -> None:
    session = _create_demo_session(tmp_path)
    session_folder = session["paths"]["sessionFolder"]

    saved = save_blink_edits(
        session_folder,
        [
            {
                "session_id": session["metadata"]["session_id"],
                "blink_id": "",
                "eye_side": "left",
                "start_time_sec": 0.1,
                "end_time_sec": 0.2,
                "is_auto_detected": 0,
                "is_manually_edited": 1,
                "is_deleted": 0,
                "quality_flag": "",
                "notes": "manual",
            }
        ],
    )

    assert saved[0]["is_manually_edited"] == 1
    assert saved[0]["notes"] == "manual"
    blink_rows = list(csv.DictReader(open(session["paths"]["blinkCsvPath"], encoding="utf-8")))
    assert blink_rows[0]["notes"] == "manual"


def test_detect_blinks_handles_low_confidence_closed_frames(tmp_path: Path) -> None:
    session = create_session(
        CreateSessionRequest(
            sessionName="blink_low_confidence",
            subjectId="S2",
            notes="",
            sourceType="camera",
            cameraDeviceId="camera-0",
            videoFilePath="",
            outputFolder=str(tmp_path),
            saveRawVideo=False,
            preferredCameraLabel="Camera 0",
        )
    )
    rows = [
        {
            "session_id": session["metadata"]["session_id"],
            "source_type": "camera",
            "source_name": "Camera 0",
            "frame_index": index,
            "timestamp_sec": index * 0.02,
            "left_opening_px": 10,
            "right_opening_px": 10,
            "left_opening_percent": left_value,
            "right_opening_percent": right_value,
            "left_tracking_confidence": left_conf,
            "right_tracking_confidence": right_conf,
            "left_visible": 1,
            "right_visible": 1,
        }
        for index, (left_value, right_value, left_conf, right_conf) in enumerate(
            [
                (72, 70, 0.7, 0.7),
                (54, 52, 0.5, 0.5),
                (18, 16, 0.15, 0.14),
                (4, 3, 0.02, 0.01),
                (0, 0, 0.0, 0.0),
                (5, 6, 0.03, 0.03),
                (24, 22, 0.2, 0.19),
                (46, 44, 0.4, 0.38),
                (70, 68, 0.7, 0.68),
            ]
        )
    ]
    append_frame_rows(session["paths"]["sessionFolder"], rows)

    blink_rows = detect_blinks(session["paths"]["sessionFolder"])

    assert any(row["eye_side"] == "bilateral" for row in blink_rows)
