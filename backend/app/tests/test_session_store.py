from __future__ import annotations

import json
from pathlib import Path

from app.io.session_store import create_session
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

