#!/usr/bin/env python3
"""Record an independent, lint-clean review of a voice-direction YAML."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path

from direction_contract import (
    direction_sha256,
    error_count,
    file_sha256,
    load_direction,
    resolve_source_path,
    validate_direction,
    write_direction,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("direction", type=Path)
    parser.add_argument("--reviewed-by", required=True)
    parser.add_argument(
        "--allow-unbound-source",
        action="store_true",
        help="仅用于没有独立原稿文件的一次性测试",
    )
    args = parser.parse_args()

    direction_path = args.direction.expanduser().resolve()
    payload = load_direction(direction_path)
    source_path = resolve_source_path(direction_path, payload)
    if not args.allow_unbound_source:
        if source_path is None or not source_path.is_file():
            print("拒绝审查：必须绑定存在的 source.path。")
            return 1
        payload.setdefault("source", {})["sha256"] = file_sha256(source_path)

    # Starting a new review explicitly invalidates every downstream approval.
    payload["status"] = "draft"
    payload["approval"] = {}
    issues = validate_direction(direction_path, payload)
    if error_count(issues):
        for issue in issues:
            if issue.severity == "error":
                print(f"ERROR {issue.path}: {issue.message}")
        return 1

    payload["status"] = "reviewed"
    payload["approval"] = {
        "review": {
            "status": "passed",
            "reviewed_by": args.reviewed_by,
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
            "content_sha256": "",
        },
        "lint": "passed",
        "human": "pending",
    }
    payload["approval"]["review"]["content_sha256"] = direction_sha256(
        direction_path, payload
    )
    write_direction(direction_path, payload)
    print(f"已记录独立审查：{direction_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
