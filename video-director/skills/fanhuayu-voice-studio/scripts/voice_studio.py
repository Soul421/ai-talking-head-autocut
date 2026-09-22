#!/usr/bin/env python3
"""Stable entrypoint for the local voice studio application.

Resolves the app relative to this skill pack first, then falls back to
$TTH_VOICE_STUDIO_APP or a sibling runtime-source copy.
"""

from __future__ import annotations

import os
import runpy
from pathlib import Path

HERE = Path(__file__).resolve()
CANDIDATES = [
    HERE.parents[3] / "runtime-source" / "voice-studio" / "app" / "studio.py",  # skills/voice-studio/scripts/ → pack
    HERE.parents[2] / "runtime-source" / "voice-studio" / "app" / "studio.py",
    HERE.parents[1].parent / "runtime-source" / "voice-studio" / "app" / "studio.py",
    Path(__file__).resolve().parents[2] / "runtime-source" / "voice-studio" / "app" / "studio.py",
]
if os.environ.get("TTH_VOICE_STUDIO_APP"):
    CANDIDATES.insert(0, Path(os.environ["TTH_VOICE_STUDIO_APP"]).expanduser())

APP = next((p for p in CANDIDATES if p.is_file()), None)
if APP is None:
    raise SystemExit(
        "声音工作室应用不存在。请设置 TTH_VOICE_STUDIO_APP，或保证 skill 包内 "
        "runtime-source/voice-studio/app/studio.py 可访问。\n"
        "查找过: " + ", ".join(str(p) for p in CANDIDATES)
    )

runpy.run_path(str(APP), run_name="__main__")
