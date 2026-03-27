from __future__ import annotations

import csv
from pathlib import Path

from app.io.session_store import append_frame_row, create_session
from app.models.contracts import CreateSessionRequest
from app.models.schema import FRAMEWISE_COLUMNS
from app.worker import persist_frame


def test_append_frame_row_preserves_schema(tmp_path: Path) -> None:
    session = create_session(
        CreateSessionRequest(
            sessionName="schema_test",
            subjectId="subject",
            notes="",
            sourceType="camera",
            cameraDeviceId="camera-0",
            videoFilePath="",
            outputFolder=str(tmp_path),
            saveRawVideo=False,
            preferredCameraLabel="Camera 0",
        )
    )

    append_frame_row(
        session["paths"]["sessionFolder"],
        {
            "session_id": "demo",
            "source_type": "camera",
            "source_name": "Camera 0",
            "frame_index": 0,
            "timestamp_sec": 0.0,
        },
    )

    lines = Path(session["paths"]["framewiseCsvPath"]).read_text(encoding="utf-8").splitlines()
    assert lines[0].split(",") == FRAMEWISE_COLUMNS
    assert len(lines) == 2


def test_worker_persist_frame_appends_row(tmp_path: Path) -> None:
    session = create_session(
        CreateSessionRequest(
            sessionName="worker_test",
            subjectId="subject",
            notes="",
            sourceType="camera",
            cameraDeviceId="camera-0",
            videoFilePath="",
            outputFolder=str(tmp_path),
            saveRawVideo=False,
            preferredCameraLabel="Camera 0",
        )
    )

    result = persist_frame(
        {
            "sessionFolder": session["paths"]["sessionFolder"],
            "row": {
                "session_id": session["metadata"]["session_id"],
                "source_type": "camera",
                "source_name": "Camera 0",
                "frame_index": 0,
                "timestamp_sec": 0.0,
            },
        }
    )

    rows = list(csv.DictReader(open(session["paths"]["framewiseCsvPath"], encoding="utf-8")))
    assert result["ok"] is True
    assert len(rows) == 1
    assert rows[0]["frame_index"] == "0"
