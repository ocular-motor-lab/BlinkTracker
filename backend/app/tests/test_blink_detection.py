from __future__ import annotations

import csv
import json
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


def test_detect_blinks_keeps_partial_then_complete_as_separate_events(tmp_path: Path) -> None:
    session = create_session(
        CreateSessionRequest(
            sessionName="blink_partial_complete",
            subjectId="S3",
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
        for index, value in enumerate([96, 94, 70, 55, 66, 92, 94, 52, 4, 2, 6, 58, 95, 96])
    ]
    append_frame_rows(session["paths"]["sessionFolder"], rows)

    blink_rows = detect_blinks(session["paths"]["sessionFolder"])
    active_classes = [row["blink_classification"] for row in blink_rows if row["is_deleted"] == 0]

    assert active_classes[:2] == ["partial", "complete"]


def test_detect_blinks_ignores_small_local_wiggle(tmp_path: Path) -> None:
    session = create_session(
        CreateSessionRequest(
            sessionName="blink_small_wiggle",
            subjectId="S4",
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
        for index, value in enumerate([96, 95, 88, 94, 96])
    ]
    append_frame_rows(session["paths"]["sessionFolder"], rows)

    blink_rows = detect_blinks(session["paths"]["sessionFolder"])

    assert blink_rows == []


def test_detect_blinks_flags_clear_eyelid_closure_drop(tmp_path: Path) -> None:
    session = create_session(
        CreateSessionRequest(
            sessionName="blink_clear_closure",
            subjectId="S5",
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
        for index, value in enumerate([96, 95, 65, 94, 96])
    ]
    append_frame_rows(session["paths"]["sessionFolder"], rows)

    blink_rows = detect_blinks(session["paths"]["sessionFolder"])

    assert len(blink_rows) >= 1


def test_detect_blinks_logs_short_noise_dip_without_saving_event(tmp_path: Path) -> None:
    session = create_session(
        CreateSessionRequest(
            sessionName="blink_short_noise",
            subjectId="S6",
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
            "timestamp_sec": timestamp,
            "left_opening_px": 10,
            "right_opening_px": 10,
            "left_opening_percent": value,
            "right_opening_percent": value,
            "left_tracking_confidence": 0.8,
            "right_tracking_confidence": 0.8,
            "left_visible": 1,
            "right_visible": 1,
        }
        for index, (timestamp, value) in enumerate([(0.0, 96), (0.005, 6), (0.01, 96)])
    ]
    append_frame_rows(session["paths"]["sessionFolder"], rows)

    blink_rows = detect_blinks(session["paths"]["sessionFolder"])

    assert blink_rows == []
    audit_entries = json.loads(Path(session["paths"]["auditLogPath"]).read_text(encoding="utf-8"))
    rejection_entries = [entry for entry in audit_entries if entry["action"] == "blink_candidates_rejected"]
    assert rejection_entries
    assert rejection_entries[-1]["new_value"]["candidates"][0]["reason"] == "below_minimum_duration"


def test_detect_blinks_requires_visible_eye_landmarks(tmp_path: Path) -> None:
    session = create_session(
        CreateSessionRequest(
            sessionName="blink_no_landmarks",
            subjectId="S7",
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
            "left_tracking_confidence": 0,
            "right_tracking_confidence": 0,
            "left_visible": 0,
            "right_visible": 0,
        }
        for index, value in enumerate([96, 94, 5, 92, 96])
    ]
    append_frame_rows(session["paths"]["sessionFolder"], rows)

    blink_rows = detect_blinks(session["paths"]["sessionFolder"])

    assert blink_rows == []


def test_detect_blinks_splits_close_double_blink_after_partial_reopening(tmp_path: Path) -> None:
    session = create_session(
        CreateSessionRequest(
            sessionName="blink_close_double",
            subjectId="S8",
            notes="",
            sourceType="camera",
            cameraDeviceId="camera-0",
            videoFilePath="",
            outputFolder=str(tmp_path),
            saveRawVideo=False,
            preferredCameraLabel="Camera 0",
        )
    )
    opening_values = [98, 97, 94, 63, 29, 16, 31, 34, 63, 62, 27, 22, 25, 60, 82, 95, 97]
    rows = [
        {
            "session_id": session["metadata"]["session_id"],
            "source_type": "camera",
            "source_name": "Camera 0",
            "frame_index": index,
            "timestamp_sec": index / 30,
            "left_opening_px": 10,
            "right_opening_px": 10,
            "left_opening_percent": value,
            "right_opening_percent": value,
            "left_tracking_confidence": 0.8,
            "right_tracking_confidence": 0.8,
            "left_visible": 1,
            "right_visible": 1,
        }
        for index, value in enumerate(opening_values)
    ]
    append_frame_rows(session["paths"]["sessionFolder"], rows)

    blink_rows = detect_blinks(session["paths"]["sessionFolder"])

    assert len(blink_rows) == 2
    assert blink_rows[0]["peak_time_sec"] < blink_rows[1]["peak_time_sec"]


def test_detect_blinks_flags_slow_recovered_drop_as_possible_gaze(tmp_path: Path) -> None:
    session = create_session(
        CreateSessionRequest(
            sessionName="blink_slow_gaze_like_drop",
            subjectId="S9",
            notes="",
            sourceType="camera",
            cameraDeviceId="camera-0",
            videoFilePath="",
            outputFolder=str(tmp_path),
            saveRawVideo=False,
            preferredCameraLabel="Camera 0",
        )
    )
    opening_values = [96, 95, 92, 88, 82, 74, 66, 58, 50, 44, 50, 58, 66, 74, 82, 90, 95, 96]
    rows = [
        {
            "session_id": session["metadata"]["session_id"],
            "source_type": "camera",
            "source_name": "Camera 0",
            "frame_index": index,
            "timestamp_sec": index * 0.06,
            "left_opening_px": 10,
            "right_opening_px": 10,
            "left_opening_percent": value,
            "right_opening_percent": value,
            "left_tracking_confidence": 0.8,
            "right_tracking_confidence": 0.8,
            "left_visible": 1,
            "right_visible": 1,
        }
        for index, value in enumerate(opening_values)
    ]
    append_frame_rows(session["paths"]["sessionFolder"], rows)

    blink_rows = detect_blinks(session["paths"]["sessionFolder"])

    assert blink_rows
    assert any("possible_gaze_or_downward_look" in row["quality_flag"] for row in blink_rows)


def test_detect_blinks_does_not_gaze_flag_fast_recovered_blink(tmp_path: Path) -> None:
    session = _create_demo_session(tmp_path)

    blink_rows = detect_blinks(session["paths"]["sessionFolder"])

    assert blink_rows
    assert all("possible_gaze_or_downward_look" not in row["quality_flag"] for row in blink_rows)
