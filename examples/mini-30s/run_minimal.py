#!/usr/bin/env python3
"""30s minimal runnable example: walk the review/handoff gates offline.

No HeyGen, no cloud, no TTS model required (default mode).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
import subprocess
import sys
import wave
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
PACK = HERE.parents[1]  # repo root
sys.path.insert(0, str(PACK / "video-director" / "runtime-source" / "voice-studio" / "app"))

try:
    from tth_config import load_config
except Exception:
    def load_config():
        return {"speaker_name": "Speaker", "reviewer_name": "Reviewer"}


def now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def log(lines: list[str], msg: str) -> None:
    line = f"[{now()}] {msg}"
    print(line)
    lines.append(line)


def make_placeholder_wav(path: Path, seconds: float = 30.0, rate: int = 24000) -> None:
    """Silent mono wav so hash/handoff machinery can run without TTS."""
    n = int(seconds * rate)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * n)


def split_sentences(text: str) -> list[str]:
    parts = []
    buf = ""
    for ch in text.strip():
        buf += ch
        if ch in "。！？!?\n":
            s = buf.strip()
            if s:
                parts.append(s)
            buf = ""
    if buf.strip():
        parts.append(buf.strip())
    return parts or [text.strip()]


def make_captions(text: str, seconds: float = 30.0) -> tuple[str, str]:
    sentences = split_sentences(text)
    total_chars = sum(len(s) for s in sentences) or 1
    t = 0.0
    srt_lines, vtt_lines = ["WEBVTT", ""], []
    for i, s in enumerate(sentences, 1):
        dur = seconds * (len(s) / total_chars)
        t0, t1 = t, min(seconds, t + dur)
        t = t1

        def ts(x: float, comma: bool) -> str:
            ms = int(x * 1000)
            h, ms = divmod(ms, 3600000)
            m, ms = divmod(ms, 60000)
            sec, ms = divmod(ms, 1000)
            sep = "," if comma else "."
            return f"{h:02d}:{m:02d}:{sec:02d}{sep}{ms:03d}"

        span = f"{ts(t0, True)} --> {ts(t1, True)}"
        span_v = f"{ts(t0, False)} --> {ts(t1, False)}"
        srt_lines += [str(i), span, s, ""]
        vtt_lines += [span_v, s, ""]
    return "\n".join(srt_lines) + "\n", "\n".join(vtt_lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--real-voice", action="store_true", help="调用 voice-studio 真实生成（需已配置）")
    ap.add_argument("--seconds", type=float, default=30.0)
    args = ap.parse_args()

    cfg = load_config()
    OUT.mkdir(parents=True, exist_ok=True)
    glog: list[str] = []

    # 1) lock script
    script = (HERE / "script.txt").read_text(encoding="utf-8").strip()
    text_bytes = script.encode("utf-8")
    text_hash = sha256_bytes(text_bytes)
    lock = {
        "locked_text": script,
        "text_sha256": text_hash,
        "target_seconds": args.seconds,
        "speaker_name": cfg.get("speaker_name"),
        "locked_at": now(),
    }
    (OUT / "script.locked.json").write_text(json.dumps(lock, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    log(glog, f"GATE text-lock  sha256={text_hash[:12]}…")

    # 2) audio
    audio_path = OUT / "audio.placeholder.wav"
    if args.real_voice:
        log(glog, "GATE real-voice → voice-studio generate/qa（需配置）")
        # Keep offline path deterministic here; real path is documented in README.
        print("真实声音请按 README 调 voice-studio CLI；本脚本默认走离线门禁。", file=sys.stderr)
        return 2
    make_placeholder_wav(audio_path, args.seconds)
    audio_hash = sha256_file(audio_path)
    log(glog, f"GATE audio-lock sha256={audio_hash[:12]}…  ({args.seconds:.0f}s placeholder)")

    # 3) captions
    srt, vtt = make_captions(script, args.seconds)
    (OUT / "captions.srt").write_text(srt, encoding="utf-8")
    (OUT / "captions.vtt").write_text(vtt, encoding="utf-8")
    log(glog, f"GATE captions   srt+vtt written")

    # 4) pending review (human must approve)
    review = {
        "kind": "voice-rhythm-review",
        "artifact_sha256": audio_hash,
        "text_sha256": text_hash,
        "status": "pending",
        "approved_by": None,
        "approved_at": None,
        "items": ["读音", "停顿", "重音", "语速", "结尾"],
        "notes": "等待人工听审；Agent 不得代批。",
        "contract": "templates/review-contract.md",
    }
    (OUT / "review-pending.json").write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    log(glog, "GATE review     pending（需人工节奏听审）")

    # 5) handoff skeleton
    handoff = {
        "schema_version": 1,
        "status": "pending_review",
        "reason": "等待人工节奏听审后 approve",
        "locked_text": script,
        "text_sha256": text_hash,
        "locked_audio": str(audio_path.resolve()),
        "audio_sha256": audio_hash,
        "captions_srt": str((OUT / "captions.srt").resolve()),
        "captions_vtt": str((OUT / "captions.vtt").resolve()),
        "engine": "placeholder" if not args.real_voice else "qwen-local",
        "reviewer_name": cfg.get("reviewer_name"),
        "speaker_name": cfg.get("speaker_name"),
        "created_at": now(),
        "next": [
            "人工完成 review-contract §A 五项听审",
            f'voice-studio approve <job_id> --by "{cfg.get("reviewer_name")}" --rhythm-reviewed',
            "handoff 后进入 video-script 导演稿",
        ],
    }
    (OUT / "video-handoff.json").write_text(json.dumps(handoff, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    log(glog, "GATE handoff    pending_review  →  examples/mini-30s/out/video-handoff.json")

    (OUT / "gate-log.txt").write_text("\n".join(glog) + "\n", encoding="utf-8")
    print("\n✓ 30s 最小示例门禁链路已跑通（离线）。产物在", OUT)
    print("  下一步：完成听审 → 批准 → 将 status 置为 ready")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
