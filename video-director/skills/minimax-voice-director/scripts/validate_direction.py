#!/usr/bin/env python3
"""Validate a MiniMax voice-direction YAML without calling any cloud API."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from direction_contract import (
    direction_sha256,
    error_count,
    load_direction,
    validate_direction,
    warning_count,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("direction", type=Path)
    parser.add_argument("--require-approved", action="store_true")
    parser.add_argument("--json-output", type=Path)
    args = parser.parse_args()

    direction_path = args.direction.expanduser().resolve()
    payload = load_direction(direction_path)
    issues = validate_direction(
        direction_path,
        payload,
        require_approved=args.require_approved,
    )
    report = {
        "direction": str(direction_path),
        "status": payload.get("status"),
        "content_sha256": direction_sha256(direction_path, payload),
        "errors": error_count(issues),
        "warnings": warning_count(issues),
        "issues": [issue.to_dict() for issue in issues],
    }
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    print(rendered, end="")
    if args.json_output:
        output = args.json_output.expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_suffix(output.suffix + ".tmp")
        temporary.write_text(rendered, encoding="utf-8")
        temporary.replace(output)
    return 1 if report["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
