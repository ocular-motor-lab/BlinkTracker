from __future__ import annotations

import json
import csv
from pathlib import Path

from app.io.session_store import append_frame_rows, create_session, list_sessions, update_session_metadata
from app.models.contracts import CreateSessionRequest
from app.models.schema import BLINK_CSV_COLUMNS, FRAMEWISE_COLUMNS


def test_create_session_initializes_expected_files(tmp_path: Path) -> None:
    result = create_session(
        CreateSessionRequest(
            sessionName="demo_session",
            subjectId="subject-a",
            notes="test run",
            sourceType="camera",
            cameraDeviceId="camera-0",
            videoFilePath="",
            outputFolder=str(tmp_path),
            saveRawVideo=True,
            preferredCameraLabel="Built-in Camera",
        )
    )

    session_folder = Path(result["paths"]["sessionFolder"])
    assert session_folder.exists()
    assert Path(result["paths"]["framewiseCsvPath"]).read_text(encoding="utf-8").splitlines()[0].split(",") == FRAMEWISE_COLUMNS
    assert Path(result["paths"]["blinkCsvPath"]).read_text(encoding="utf-8").splitlines()[0].split(",") == BLINK_CSV_COLUMNS

    metadata = json.loads(Path(result["paths"]["metadataJsonPath"]).read_text(encoding="utf-8"))
    assert metadata["source_name"] == "Built-in Camera"
    assert metadata["session_name"] == "demo_session"


def test_list_sessions_summarizes_saved_sessions(tmp_path: Path) -> None:
    result = create_session(
        CreateSessionRequest(
            sessionName="database_session",
            sessionDate="2026-06-30",
            subjectId="subject-db",
            notes="test run",
            sourceType="camera",
            cameraDeviceId="camera-0",
            videoFilePath="",
            outputFolder=str(tmp_path),
            saveRawVideo=False,
        )
    )
    session_folder = result["paths"]["sessionFolder"]
    update_session_metadata(session_folder, {"database_notes": "important database note"})
    append_frame_rows(
        session_folder,
        [
            {"frame_index": 0, "timestamp_sec": 0.0},
            {"frame_index": 1, "timestamp_sec": 1.5},
            {"frame_index": 2, "timestamp_sec": 3.0},
        ],
    )
    Path(result["paths"]["blinkCsvPath"]).write_text(
        "\n".join(
            [
                "session_id,blink_id,is_deleted",
                "session-a,blink-1,0",
                "session-a,blink-2,1",
                "session-a,blink-3,0",
            ]
        ),
        encoding="utf-8",
    )

    database = list_sessions(str(tmp_path))

    assert database["rootFolder"] == str(tmp_path)
    assert database["sessionIndexPath"] == str(tmp_path / "session_index.csv")
    assert database["sessionIndexXlsxPath"] == str(tmp_path / "session_index.xlsx")
    assert len(database["sessions"]) == 1
    assert database["sessions"][0]["subjectId"] == "subject-db"
    assert database["sessions"][0]["sessionDate"] == "2026-06-30"
    assert database["sessions"][0]["databaseNotes"] == "important database note"
    assert database["sessions"][0]["durationSec"] == 3.0
    assert database["sessions"][0]["blinkCount"] == 2

    with (tmp_path / "session_index.csv").open(newline="", encoding="utf-8") as handle:
        index_rows = list(csv.DictReader(handle))

    assert len(index_rows) == 1
    assert index_rows[0]["subject_id"] == "subject-db"
    assert index_rows[0]["session_folder"] == session_folder
    assert index_rows[0]["database_notes"] == "important database note"
    assert (tmp_path / "session_index.xlsx").exists()
