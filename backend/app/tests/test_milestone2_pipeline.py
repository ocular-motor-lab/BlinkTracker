from __future__ import annotations

import json
from pathlib import Path

from app.io.session_store import append_audit_log, create_session, update_session_metadata
from app.models.contracts import CreateSessionRequest
from app.processing.frame_pipeline import process_frame_probe


def test_update_session_metadata_and_audit_log(tmp_path: Path) -> None:
    session = create_session(
        CreateSessionRequest(
            sessionName="milestone2",
            subjectId="subj",
            notes="",
            sourceType="camera",
            cameraDeviceId="camera-0",
            videoFilePath="",
            outputFolder=str(tmp_path),
            saveRawVideo=True,
            preferredCameraLabel="Camera 0",
        )
    )
    session_folder = session["paths"]["sessionFolder"]

    metadata = update_session_metadata(
        session_folder,
        {"resolution_width": 1280, "resolution_height": 720, "nominal_fps": 30},
    )
    append_audit_log(session_folder, "processing_started", new_value={"fps": 30})

    assert metadata["resolution_width"] == 1280
    audit_entries = json.loads(Path(session["paths"]["auditLogPath"]).read_text(encoding="utf-8"))
    assert audit_entries[-1]["action"] == "processing_started"


def test_process_frame_probe_returns_stub_payload() -> None:
    payload = process_frame_probe(
        {
            "frameIndex": 7,
            "timestampSec": 0.233,
        }
    )
    assert payload["frameIndex"] == 7
    assert payload["trackingStatus"] == "pending_landmarks"
