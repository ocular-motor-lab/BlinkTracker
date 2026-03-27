from __future__ import annotations

import json
import sys
from typing import Any

from app.analysis.blinks import detect_blinks, save_blink_edits
from app.capture.camera import list_cameras
from app.capture.video_reader import probe_video
from app.io.session_store import append_frame_row
from app.io.session_store import append_audit_log, create_session, load_session, update_session_metadata
from app.ipc.contracts import camera_payload, enrich_response, parse_create_session_request


def _read_stdin_json() -> Any:
    raw = sys.stdin.read().strip()
    if not raw:
        return {}
    return json.loads(raw)


def _emit(payload: Any) -> None:
    sys.stdout.write(json.dumps(payload))


def main() -> int:
    if len(sys.argv) < 2:
        raise SystemExit("Expected command argument.")

    command = sys.argv[1]

    if command == "list-cameras":
        _emit([camera_payload(camera) for camera in list_cameras()])
        return 0

    if command == "create-session":
        request = parse_create_session_request(_read_stdin_json())
        _emit(enrich_response(create_session(request)))
        return 0

    if command == "probe-video":
        payload = _read_stdin_json()
        path = payload["path"] if isinstance(payload, dict) else payload
        _emit(probe_video(path))
        return 0

    if command == "update-session-metadata":
        payload = _read_stdin_json()
        _emit(update_session_metadata(payload["sessionFolder"], payload["updates"]))
        return 0

    if command == "load-session":
        payload = _read_stdin_json()
        _emit(load_session(payload["sessionFolder"]))
        return 0

    if command == "detect-blinks":
        payload = _read_stdin_json()
        _emit({"blinkRows": detect_blinks(payload["sessionFolder"])})
        return 0

    if command == "save-blink-edits":
        payload = _read_stdin_json()
        _emit({"blinkRows": save_blink_edits(payload["sessionFolder"], payload["blinkRows"])})
        return 0

    if command == "append-audit-log":
        payload = _read_stdin_json()
        _emit(
            append_audit_log(
                payload["sessionFolder"],
                payload["action"],
                payload.get("note"),
                payload.get("oldValue"),
                payload.get("newValue"),
            )
        )
        return 0

    if command == "persist-frame":
        payload = _read_stdin_json()
        append_frame_row(payload["sessionFolder"], payload["row"])
        _emit({"ok": True})
        return 0

    raise SystemExit(f"Unknown command: {command}")


if __name__ == "__main__":
    raise SystemExit(main())
