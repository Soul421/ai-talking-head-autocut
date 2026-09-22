#!/usr/bin/env python3
"""Explicit MiniMax backup adapter for the local voice studio."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ASSET_DIR = Path("/Users/fanhuayu/.codex/skills/minimax-voice-director/assets")
sys.path.insert(0, str(ASSET_DIR))

from minimax_tts import text_to_audio  # noqa: E402


def main() -> int:
    request_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    request = json.loads(request_path.read_text(encoding="utf-8"))
    if not request.get("cloud_confirmed") or request.get("engine") != "minimax-api":
        raise PermissionError("缺少 MiniMax 云端明确授权")
    result = text_to_audio(
        text=request["text"], output_path=str(output_path), speed=float(request["speed"]),
        format="wav", channel=1, subtitle_enable=False,
    )
    if not result.get("success"):
        raise RuntimeError(result.get("error", "MiniMax 生成失败"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
