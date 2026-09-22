#!/usr/bin/env python3
"""Record explicit human approval for a finalized voice WAV."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from direction_contract import (
    direction_sha256,
    error_count,
    file_sha256,
    load_direction,
    validate_direction,
    write_direction,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--direction", required=True, type=Path)
    parser.add_argument("--audio", required=True, type=Path)
    parser.add_argument(
        "--validation",
        type=Path,
        help="默认读取最终 WAV 同目录的 validation.json",
    )
    parser.add_argument("--approved-by", required=True)
    args = parser.parse_args()

    direction_path = args.direction.expanduser().resolve()
    audio_path = args.audio.expanduser().resolve()
    validation_path = (
        args.validation.expanduser().resolve()
        if args.validation
        else audio_path.parent / "validation.json"
    )
    if not audio_path.is_file() or audio_path.stat().st_size == 0:
        raise ValueError(f"音频不存在或为空：{audio_path}")
    if not validation_path.is_file():
        raise ValueError(f"缺少最终合成验证报告：{validation_path}")
    direction = load_direction(direction_path)
    issues = validate_direction(direction_path, direction, require_approved=True)
    if error_count(issues):
        for issue in issues:
            if issue.severity == "error":
                print(f"ERROR {issue.path}: {issue.message}")
        return 1
    if direction.get("status") not in {"rendered", "audio_approved"}:
        raise ValueError("只能批准已生成并完成 Take 选择的音频")

    validation = json.loads(validation_path.read_text(encoding="utf-8"))
    current_direction_hash = direction_sha256(direction_path, direction)
    current_audio_hash = file_sha256(audio_path)
    if validation.get("direction_sha256") != current_direction_hash:
        raise ValueError("验证报告不属于当前导演稿")
    if validation.get("audio_sha256") != current_audio_hash:
        raise ValueError("最终 WAV 与验证报告不一致")

    approval = direction.setdefault("approval", {})
    approval["audio"] = {
        "status": "approved",
        "path": str(audio_path),
        "sha256": current_audio_hash,
        "approved_by": args.approved_by,
        "approved_at": datetime.now(timezone.utc).isoformat(),
        "direction_sha256": current_direction_hash,
        "validation_path": str(validation_path),
        "validation_sha256": file_sha256(validation_path),
    }
    direction["status"] = "audio_approved"
    write_direction(direction_path, direction)
    print(f"已批准最终人声：{audio_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
