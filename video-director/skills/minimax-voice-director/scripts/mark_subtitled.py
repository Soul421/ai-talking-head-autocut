#!/usr/bin/env python3
"""Record subtitle deliverables that were aligned from the approved final audio."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path

from direction_contract import (
    direction_sha256,
    file_sha256,
    load_direction,
    write_direction,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--direction", required=True, type=Path)
    parser.add_argument("--audio", required=True, type=Path)
    parser.add_argument("--srt", required=True, type=Path)
    parser.add_argument("--vtt", type=Path)
    parser.add_argument("--aligned-json", type=Path)
    args = parser.parse_args()

    direction_path = args.direction.expanduser().resolve()
    audio_path = args.audio.expanduser().resolve()
    direction = load_direction(direction_path)
    approval = direction.get("approval") or {}
    audio_approval = approval.get("audio") or {}

    if direction.get("status") not in {"audio_approved", "subtitled"}:
        raise ValueError("字幕只能绑定到已经人工批准的最终音频")
    if audio_approval.get("status") != "approved":
        raise ValueError("缺少最终音频批准记录")
    if audio_approval.get("direction_sha256") != direction_sha256(
        direction_path, direction
    ):
        raise ValueError("音频批准后导演稿或绑定原稿已变更")
    if not audio_path.is_file():
        raise ValueError(f"最终音频不存在：{audio_path}")
    if file_sha256(audio_path) != audio_approval.get("sha256"):
        raise ValueError("字幕所用音频与人工批准的最终音频不一致")

    deliverables: dict[str, dict[str, str]] = {}
    for label, raw_path in (
        ("srt", args.srt),
        ("vtt", args.vtt),
        ("aligned_json", args.aligned_json),
    ):
        if raw_path is None:
            continue
        path = raw_path.expanduser().resolve()
        if not path.is_file() or path.stat().st_size == 0:
            raise ValueError(f"字幕交付文件不存在或为空：{path}")
        deliverables[label] = {
            "path": str(path),
            "sha256": file_sha256(path),
        }

    approval["subtitles"] = {
        "status": "aligned_from_approved_audio",
        "audio_path": str(audio_path),
        "audio_sha256": file_sha256(audio_path),
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "deliverables": deliverables,
    }
    direction["approval"] = approval
    direction["status"] = "subtitled"
    write_direction(direction_path, direction)
    print(f"已登记字幕交付：{deliverables['srt']['path']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
