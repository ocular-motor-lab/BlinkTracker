from __future__ import annotations

from pathlib import Path

from app.io.session_store import append_frame_row, create_session, load_session, update_session_metadata
from app.models.contracts import CreateSessionRequest


def test_load_session_returns_rows_and_media_path(tmp_path: Path) -> None:
    session = create_session(
        CreateSessionRequest(
            sessionName="analysis_demo",
            subjectId="S1",
            notes="demo",
            sourceType="camera",
            cameraDeviceId="camera-0",
            videoFilePath="",
            outputFolder=str(tmp_path),
            saveRawVideo=True,
            preferredCameraLabel="Camera 0",
        )
    )

    session_folder = Path(session["paths"]["sessionFolder"])
    raw_video_path = session_folder / "raw_video.webm"
    raw_video_path.write_bytes(b"demo")
    update_session_metadata(str(session_folder), {"raw_video_path": str(raw_video_path)})

    append_frame_row(
        str(session_folder),
        {
            "session_id": session["metadata"]["session_id"],
            "source_type": "camera",
            "source_name": "Camera 0",
            "frame_index": 0,
            "timestamp_sec": 0.25,
            "left_opening_percent": 85.0,
            "right_opening_percent": 83.0,
        },
    )

    loaded = load_session(str(session_folder))

    assert loaded["frameCount"] == 1
    assert loaded["durationSec"] == 0.25
    assert loaded["mediaPath"] == str(raw_video_path.resolve())
    assert loaded["frameRows"][0]["left_opening_percent"] == 85.0
