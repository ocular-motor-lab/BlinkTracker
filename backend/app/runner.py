from __future__ import annotations

import sys

from app import main as command_main
from app import worker as worker_main


def main() -> int:
    if len(sys.argv) < 2:
        raise SystemExit("Expected mode: command or worker.")

    mode = sys.argv[1]
    if mode == "command":
        sys.argv = [sys.argv[0], *sys.argv[2:]]
        return command_main.main()

    if mode == "worker":
        sys.argv = [sys.argv[0], *sys.argv[2:]]
        return worker_main.main()

    raise SystemExit(f"Unknown mode: {mode}")


if __name__ == "__main__":
    raise SystemExit(main())
