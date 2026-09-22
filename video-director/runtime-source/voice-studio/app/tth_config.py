#!/usr/bin/env python3
"""Shared config loader for voice studio / mini example.

Search order:
1. $TTH_CONFIG (file path)
2. $XDG_CONFIG_HOME/ai-talking-head-autocut/config.json
3. ~/.config/ai-talking-head-autocut/config.json
4. ./config.json next to the pack root

Env overrides: TTH_SPEAKER, TTH_REVIEWER, TTH_QWEN_PYTHON, TTH_QWEN_MODEL,
TTH_REFERENCE_AUDIO, TTH_REFERENCE_TEXT, TTH_BAOCUT, TTH_VOICE_ENGINE
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def _config_path() -> Path | None:
    candidates = []
    if os.environ.get("TTH_CONFIG"):
        candidates.append(Path(os.environ["TTH_CONFIG"]).expanduser())
    xdg = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    candidates.append(Path(xdg) / "ai-talking-head-autocut" / "config.json")
    candidates.append(Path.home() / ".config" / "ai-talking-head-autocut" / "config.json")
    # pack-local
    here = Path(__file__).resolve()
    for p in here.parents:
        cfg = p / "config.json"
        candidates.append(cfg)
        if (p / "config.example.json").exists():
            break
    for c in candidates:
        if c.is_file():
            return c
    return None


def load_config() -> dict[str, Any]:
    path = _config_path()
    data: dict[str, Any] = {}
    if path:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            data = {}
    env = os.environ
    out = {
        "speaker_name": env.get("TTH_SPEAKER") or data.get("speaker_name") or "Speaker",
        "reviewer_name": env.get("TTH_REVIEWER") or data.get("reviewer_name") or "Reviewer",
        "voice_engine": env.get("TTH_VOICE_ENGINE") or data.get("voice_engine") or "qwen-local",
        "qwen_python": env.get("TTH_QWEN_PYTHON") or data.get("qwen_python") or "",
        "qwen_model": env.get("TTH_QWEN_MODEL") or data.get("qwen_model") or "",
        "reference_audio": env.get("TTH_REFERENCE_AUDIO") or data.get("reference_audio") or "",
        "reference_text": env.get("TTH_REFERENCE_TEXT") or data.get("reference_text") or "",
        "baocut_bin": env.get("TTH_BAOCUT") or data.get("baocut_bin") or "",
        "terms_file": data.get("terms_file") or "",
        "config_path": str(path) if path else "",
    }
    return out
