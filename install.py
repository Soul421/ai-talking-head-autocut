#!/usr/bin/env python3
"""One-click installer for ai-talking-head-autocut skill pack.

Usage:
  ./install.sh                 # install to detected agent skill dirs
  ./install.sh --dir ~/.codex/skills
  ./install.sh --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import stat
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PACK = ROOT / "video-director"
SKILLS_SRC = PACK / "skills"

# skill dirs to try when --dir is not given
CANDIDATE_DIRS = [
    Path.home() / ".codex" / "skills",
    Path.home() / ".claude" / "skills",
    Path.home() / ".agents" / "skills",
    Path.home() / ".config" / "mimocode" / "skills",
]

# rename personal skill dir → generic (keys are source dir names on disk)
RENAME = {
    "fanhuayu-voice-studio": "voice-studio",
}

SKIP_DIR_NAMES = {"__pycache__", ".git", "node_modules", "out", ".DS_Store"}

# replacements applied to text files at install time
TEXT_SUBS = [
    ("voice-studio", "voice-studio"),
    ("本地声音工作室", "本地声音工作室"),
    ("声音工作室", "声音工作室"),
    ("口播/个人视频", "口播/个人视频"),
    ("主账号", "主账号"),
    ("本机项目", "本机项目"),
    ("{SPEAKER}", "{SPEAKER}"),
]


def is_text(path: Path) -> bool:
    if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ttf", ".otf", ".mp4", ".wav", ".mp3"}:
        return False
    try:
        path.read_text(encoding="utf-8")
        return True
    except Exception:
        return False


def apply_subs(text: str, speaker: str, reviewer: str) -> str:
    for a, b in TEXT_SUBS:
        text = text.replace(a, b)
    text = text.replace("{SPEAKER}", speaker).replace("{REVIEWER}", reviewer)
    return text


def copy_tree(src: Path, dst: Path, speaker: str, reviewer: str, dry: bool) -> int:
    n = 0
    if dst.exists() and not dry:
        shutil.rmtree(dst)
    for p in src.rglob("*"):
        if any(part in SKIP_DIR_NAMES for part in p.relative_to(src).parts):
            continue
        rel = p.relative_to(src)
        # rename top-level skill folder if needed
        parts = list(rel.parts)
        if parts and parts[0] in RENAME:
            parts[0] = RENAME[parts[0]]
            rel = Path(*parts)
        out = dst / rel
        if dry:
            print(f"  would install {out}")
            n += 1
            continue
        if p.is_dir():
            out.mkdir(parents=True, exist_ok=True)
            continue
        out.parent.mkdir(parents=True, exist_ok=True)
        if is_text(p):
            out.write_text(apply_subs(p.read_text(encoding="utf-8"), speaker, reviewer), encoding="utf-8")
        else:
            shutil.copy2(p, out)
        n += 1
    return n


def write_config(target: Path, dry: bool) -> Path:
    cfg_path = Path.home() / ".config" / "ai-talking-head-autocut" / "config.json"
    example = json.loads((ROOT / "config.example.json").read_text(encoding="utf-8"))
    if cfg_path.exists():
        print(f"keep existing config: {cfg_path}")
        return cfg_path
    if dry:
        print(f"  would write {cfg_path}")
        return cfg_path
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    cfg_path.write_text(json.dumps(example, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {cfg_path}  — 请填 qwen_model / reference_audio 等路径")
    return cfg_path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", action="append", default=[], help="skill install dir (repeatable)")
    ap.add_argument("--speaker", default=os.environ.get("TTH_SPEAKER", "Speaker"))
    ap.add_argument("--reviewer", default=os.environ.get("TTH_REVIEWER", "Reviewer"))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not PACK.is_dir():
        print(f"missing pack: {PACK}", file=sys.stderr)
        return 1

    targets = [Path(d).expanduser() for d in args.dir] if args.dir else []
    if not targets:
        targets = [d for d in CANDIDATE_DIRS if d.parent.exists() or d.exists()]
        # always install at least to ~/.codex/skills or ~/.claude/skills
        if not targets:
            targets = [Path.home() / ".codex" / "skills"]

    print(f"speaker={args.speaker!r} reviewer={args.reviewer!r}")
    print(f"install targets: {[str(t) for t in targets]}")

    total = 0
    for target in targets:
        target.mkdir(parents=True, exist_ok=True)
        print(f"\n== {target} ==")
        # 1) video-director as one skill
        n1 = copy_tree(PACK, target / "video-director", args.speaker, args.reviewer, args.dry_run)
        # 2) each module as sibling skill (fanhuayu-voice-studio → voice-studio)
        for mod in sorted(SKILLS_SRC.iterdir()):
            if not mod.is_dir() or mod.name in SKIP_DIR_NAMES:
                continue
            name = RENAME.get(mod.name, mod.name)
            n1 += copy_tree(mod, target / name, args.speaker, args.reviewer, args.dry_run)
            # bundle voice studio app into the skill so entrypoint works standalone
            if name == "voice-studio":
                app_src = PACK / "runtime-source" / "voice-studio" / "app"
                if app_src.is_dir():
                    n1 += copy_tree(app_src, target / "voice-studio" / "app",
                                    args.speaker, args.reviewer, args.dry_run)
        print(f"  {n1} files")
        total += n1

    write_config(Path.home() / ".config" / "ai-talking-head-autocut", args.dry_run)

    print(f"""
完成。下一步：
  1. 编辑 ~/.config/ai-talking-head-autocut/config.json（或设 TTH_* 环境变量）
  2. 跑 30 秒最小示例：
       python3 "{ROOT}/examples/mini-30s/run_minimal.py"
  3. 在 Agent 里说：「用 video-director 做一条口播」
""")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
