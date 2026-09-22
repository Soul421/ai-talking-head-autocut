#!/usr/bin/env python3
"""Stable entrypoint for the personal voice studio application."""

from __future__ import annotations

import runpy
from pathlib import Path

APP = Path(
    "/Users/fanhuayu/Documents/晓儿/50_个人项目/技术项目/"
    "本地声音克隆/voice-studio/app/studio.py"
)

if not APP.is_file():
    raise SystemExit(f"声音工作室应用不存在：{APP}")

runpy.run_path(str(APP), run_name="__main__")
