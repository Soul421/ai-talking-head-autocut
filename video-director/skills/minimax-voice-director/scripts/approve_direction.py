#!/usr/bin/env python3
"""Record explicit human approval for a lint-clean voice-direction YAML."""

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
    parser.add_argument("--approved-by", required=True)
    parser.add_argument(
        "--allow-unbound-source",
        action="store_true",
        help="仅用于没有独立原稿文件的一次性测试",
    )
    args = parser.parse_args()

    direction_path = args.direction.expanduser().resolve()
    payload = load_direction(direction_path)
    issues = validate_direction(direction_path, payload)
    if error_count(issues):
        for issue in issues:
            if issue.severity == "error":
                print(f"ERROR {issue.path}: {issue.message}")
        return 1

    source_path = resolve_source_path(direction_path, payload)
    if not args.allow_unbound_source:
        if source_path is None or not source_path.is_file():
            print("拒绝审批：必须绑定存在的 source.path，才能在原稿变更后使审批失效。")
            return 1
        if (payload.get("source") or {}).get("sha256") != file_sha256(source_path):
            print("拒绝审批：绑定原稿在独立审查后发生变化，请重新审查。")
            return 1

    if payload.get("status") != "reviewed":
        print("拒绝审批：必须先完成独立审查并进入 reviewed 状态。")
        return 1
    approval = payload.get("approval") or {}
    review = approval.get("review") or {}
    if review.get("status") != "passed" or review.get(
        "content_sha256"
    ) != direction_sha256(direction_path, payload):
        print("拒绝审批：独立审查记录缺失或已经失效。")
        return 1

    payload["status"] = "approved"
    payload["approval"].update(
        {
            "lint": "passed",
            "human": "approved",
            "approved_by": args.approved_by,
            "approved_at": datetime.now(timezone.utc).isoformat(),
            "content_sha256": "",
        }
    )
    payload["approval"]["content_sha256"] = direction_sha256(
        direction_path, payload
    )
    write_direction(direction_path, payload)
    print(f"已批准：{direction_path}")
    print(f"content_sha256={payload['approval']['content_sha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
