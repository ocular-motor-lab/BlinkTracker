from __future__ import annotations

import json
import sys

from app.io.session_store import append_frame_row, append_frame_rows


def persist_frame(payload: dict[str, object]) -> dict[str, bool]:
    append_frame_row(payload["sessionFolder"], payload["row"])  # type: ignore[arg-type]
    return {"ok": True}


def persist_frames(payload: dict[str, object]) -> dict[str, int | bool]:
    rows = payload.get("rows", [])
    append_frame_rows(payload["sessionFolder"], rows)  # type: ignore[arg-type]
    return {"ok": True, "count": len(rows)}  # type: ignore[arg-type]


def main() -> int:
    for line in sys.stdin:
        raw = line.strip()
        if not raw:
            continue
        request = json.loads(raw)
        request_id = request["id"]
        try:
            if request["command"] == "persist-frame":
                result = persist_frame(request["payload"])
            elif request["command"] == "persist-frames":
                result = persist_frames(request["payload"])
            else:
                raise ValueError(f"Unsupported worker command: {request['command']}")
            response = {"id": request_id, "ok": True, "result": result}
        except Exception as error:  # pragma: no cover
            response = {"id": request_id, "ok": False, "error": str(error)}

        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
