#!/usr/bin/env python3
"""Stable entrypoint for the local voice studio application.

Search order:
1. $TTH_VOICE_STUDIO_APP
2. installed skill layout: <skills>/video-director/runtime-source/voice-studio/app/studio.py
3. bundled copy: <this skill>/app/studio.py  (install copies runtime here)
4. pack source layout: <pack>/video-director/runtime-source/... or <pack>/runtime-source/...
"""

from __future__ import annotations

import os
import runpy
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
SKILL_DIR = HERE.parents[1]          # .../voice-studio
SKILLS_ROOT = HERE.parents[2]        # .../skills or equivalent

CANDIDATES = []
if os.environ.get("TTH_VOICE_STUDIO_APP"):
    CANDIDATES.append(Path(os.environ["TTH_VOICE_STUDIO_APP"]).expanduser())

CANDIDATES += [
    # installed: voice-studio/app/studio.py (copied by installer)
    SKILL_DIR / "app" / "studio.py",
    # installed: sibling video-director skill holds runtime-source
    SKILLS_ROOT / "video-director" / "runtime-source" / "voice-studio" / "app" / "studio.py",
    SKILLS_ROOT / "video-director" / "runtime-source" / "voice-studio" / "app" / "studio.py",
    # pack checkout: skills/voice-studio/scripts → pack/video-director/runtime-source
    HERE.parents[3] / "runtime-source" / "voice-studio" / "app" / "studio.py",
    HERE.parents[3] / "video-director" / "runtime-source" / "voice-studio" / "app" / "studio.py",
    HERE.parents[4] / "video-director" / "runtime-source" / "voice-studio" / "app" / "studio.py",
]

# last resort: walk up looking for runtime-source
for parent in HERE.parents:
    hit = parent / "runtime-source" / "voice-studio" / "app" / "studio.py"
    CANDIDATES.append(hit)
    hit2 = parent / "video-director" / "runtime-source" / "voice-studio" / "app" / "studio.py"
    CANDIDATES.append(hit2)

APP = next((p for p in CANDIDATES if p.is_file()), None)
if APP is None:
    tried = "\n  ".join(str(p) for p in dict.fromkeys(str(p) for p in CANDIDATES))
    raise SystemExit(
        "声音工作室应用不存在。\n"
        "请设置 TTH_VOICE_STUDIO_APP，或重新运行 install.sh（会把 app 装进 voice-studio/app/）。\n"
        f"查找过:\n  {tried}"
    )

sys.path.insert(0, str(APP.parent))
runpy.run_path(str(APP), run_name="__main__")
