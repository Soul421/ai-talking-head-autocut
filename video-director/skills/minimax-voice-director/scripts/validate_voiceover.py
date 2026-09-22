#!/usr/bin/env python3
"""Validate a generated voiceover and report its silence distribution."""

from __future__ import annotations

import argparse
import json
import re
import statistics
import subprocess
from pathlib import Path


SILENCE_RE = re.compile(r"silence_duration: ([0-9.]+)")


def probe_duration(path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def silence_durations(path: Path) -> list[float]:
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostats",
            "-i",
            str(path),
            "-af",
            "silencedetect=noise=-35dB:d=0.08",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr[-2000:])
    return [float(value) for value in SILENCE_RE.findall(result.stderr)]


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = round((len(ordered) - 1) * fraction)
    return ordered[index]


def inspect(path: Path) -> dict:
    if not path.is_file() or path.stat().st_size == 0:
        raise ValueError(f"音频不存在或为空：{path}")
    duration = probe_duration(path)
    if duration <= 0:
        raise ValueError("音频时长必须大于 0")
    silences = silence_durations(path)
    return {
        "path": str(path),
        "duration_seconds": round(duration, 3),
        "silence_count": len(silences),
        "silence_median_ms": round(statistics.median(silences) * 1000)
        if silences
        else None,
        "silence_p75_ms": round(percentile(silences, 0.75) * 1000)
        if silences
        else None,
        "silence_p90_ms": round(percentile(silences, 0.90) * 1000)
        if silences
        else None,
        "silence_max_ms": round(max(silences) * 1000) if silences else None,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", type=Path)
    parser.add_argument("--json-output", type=Path)
    args = parser.parse_args()
    report = inspect(args.audio.expanduser().resolve())
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    print(rendered, end="")
    if args.json_output:
        output = args.json_output.expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
