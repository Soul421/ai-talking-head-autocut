#!/usr/bin/env python3
"""开工体检：出画面之前检查数字人/声音/工具是否就位，避免效果崩了才发现。

用法：
  python3 doctor.py              # 全量检查
  python3 doctor.py --stage s4   # 只查「出脸」阶段
  python3 doctor.py --json       # 机器可读
  python3 doctor.py --next       # 显示当前最先要做的动作
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

try:
    from tth_config import load_config
except Exception:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "runtime-source" / "voice-studio" / "app"))
    try:
        from tth_config import load_config
    except Exception:
        def load_config():
            return {}


def ok(msg: str) -> dict:
    return {"level": "ok", "msg": msg}


def warn(msg: str, hint: str = "") -> dict:
    return {"level": "warn", "msg": msg, "hint": hint}


def bad(msg: str, hint: str = "") -> dict:
    return {"level": "bad", "msg": msg, "hint": hint}


def check_voice(cfg: dict) -> list[dict]:
    out = []
    for key, label in (("qwen_python", "TTS Python"), ("qwen_model", "TTS 模型"),
                       ("reference_audio", "克隆参考音"), ("baocut_bin", "BaoCut")):
        raw = cfg.get(key) or ""
        p = Path(raw).expanduser() if raw else None
        if p and p.exists():
            out.append(ok(f"{label}: {p}"))
        else:
            out.append(bad(f"{label}: 未配置或不存在", f"写入 config.json 的 {key} 或设 TTH_*"))
    return out


def check_locked_handoff() -> list[dict]:
    runs = Path.home() / ".codex/skills/voice-studio/runs"
    if not runs.is_dir():
        runs = Path.home() / ".config/ai-talking-head-autocut/runs"
    latest = None
    if runs.is_dir():
        mans = sorted(runs.glob("*/video-handoff.json"))
        latest = mans[-1] if mans else None
    if not latest:
        return [warn("未找到 video-handoff.json", "先完成 voice-studio generate→qa→approve→handoff")]
    try:
        data = json.loads(latest.read_text(encoding="utf-8"))
    except Exception as e:
        return [bad(f"handoff 无法解析: {e}")]
    status = data.get("status")
    if status == "ready":
        return [ok(f"交接单 ready: {latest.parent.name}  audio={str(data.get('audio_sha256',''))[:12]}…")]
    return [bad(f"交接单未 ready（{status}）", "禁止进入数字人与复杂画面")]


def check_tools() -> list[dict]:
    out = []
    for cmd, label, hint in (
        ("node", "Node.js", "安装 Node 18+"),
        ("ffmpeg", "FFmpeg", "brew install ffmpeg"),
        ("ffprobe", "FFprobe", "同 FFmpeg"),
    ):
        if shutil.which(cmd):
            out.append(ok(f"{label}: {shutil.which(cmd)}"))
        else:
            out.append(bad(f"{label}: 未安装", hint))
    if shutil.which("docker"):
        out.append(ok(f"Docker: {shutil.which('docker')}"))
    else:
        out.append(warn("Docker: 未安装（部分 proof 工具可选）", "brew install --cask docker"))
    return out


def check_digital_human(cfg: dict) -> list[dict]:
    out = []
    heygen_key = os.environ.get("HEYGEN_API_KEY") or cfg.get("heygen_api_key") or ""
    if heygen_key:
        out.append(ok("HeyGen API Key: 已配置"))
    else:
        out.append(warn(
            "HeyGen: 无 API Key → 只能 PIP 占位或本地开源",
            "设置 HEYGEN_API_KEY；没有账号时先按路由表使用 PIP 占位",
        ))
    # 路由表必读
    routing = Path(__file__).resolve().parents[1] / "references" / "digital-human-routing.md"
    if routing.is_file():
        out.append(ok(f"路由表: {routing}"))
    else:
        out.append(warn("路由表缺失", "安装完整 skill 包"))
    out.append(ok("责任边界: 形象/肖像授权由使用方负责（见路由表 §5）"))
    return out


def check_stage_s4_only() -> list[dict]:
    return check_digital_human(load_config()) + check_locked_handoff()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", choices=["all", "s3", "s4", "s5", "s6"], default="all")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--next", action="store_true", help="显示第一条阻断项的具体下一步")
    args = ap.parse_args()
    cfg = load_config()
    results: list[dict] = []
    if args.stage in ("all", "s3"):
        results += [{"section": "voice"}, *check_voice(cfg)]
    if args.stage in ("all", "s4"):
        results += [{"section": "digital-human"}, *check_digital_human(cfg)]
    if args.stage in ("all", "s5", "s6"):
        results += [{"section": "tools"}, *check_tools()]
    if args.stage in ("all", "s4"):
        results += [{"section": "handoff"}, *check_locked_handoff()]

    if args.json:
        print(json.dumps({"results": results}, ensure_ascii=False, indent=2))
    else:
        print("=== 开工体检 doctor ===")
        for r in results:
            if "section" in r:
                print(f"\n[{r['section']}]")
                continue
            mark = {"ok": "✓", "warn": "⚠", "bad": "✗"}[r["level"]]
            print(f"  {mark} {r['msg']}")
            if r.get("hint"):
                print(f"      → {r['hint']}")
        bad_n = sum(1 for r in results if r.get("level") == "bad")
        warn_n = sum(1 for r in results if r.get("level") == "warn")
        print(f"\n结论: {bad_n} 项阻断, {warn_n} 项警告。"
              + (" 可以进入下一阶段。" if bad_n == 0 else " 先解决 ✗ 再出脸/出片。"))
        print("路由表: video-director/references/digital-human-routing.md")
        if args.next:
            first = next((r for r in results if r.get("level") in {"bad", "warn"}), None)
            if first:
                print(f"\n下一步: {first['msg']}。{first.get('hint', '')}")
            else:
                print("\n下一步: 运行 voice-studio generate 开始第一条口播。")
    return 1 if any(r.get("level") == "bad" and args.stage != "all" for r in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
