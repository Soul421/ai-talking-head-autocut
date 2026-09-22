#!/usr/bin/env python3
"""Create reproducible proof frames, a contact sheet, and a media probe."""

from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import subprocess
from pathlib import Path


def run(command: list[str], capture: bool = False) -> str:
    result = subprocess.run(
        command,
        check=True,
        text=True,
        capture_output=capture,
    )
    return result.stdout if capture else ""


def safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip("-") or "frame"


def parse_time(value: str) -> tuple[str, str]:
    if "=" in value:
        label, timestamp = value.split("=", 1)
        return safe_name(label), timestamp
    return safe_name(value.replace(":", "-")), value


def probe(ffprobe: str, video: Path) -> dict:
    output = run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-of",
            "json",
            str(video),
        ],
        capture=True,
    )
    return json.loads(output)


def duration_seconds(payload: dict) -> float:
    duration = payload.get("format", {}).get("duration")
    if duration is None:
        raise SystemExit("ffprobe did not report a video duration")
    return float(duration)


def default_times(duration: float, count: int) -> list[tuple[str, str]]:
    return [
        (f"sample-{index + 1:02d}", f"{duration * (index + 1) / (count + 1):.3f}")
        for index in range(count)
    ]


def extract_frame(ffmpeg: str, video: Path, timestamp: str, output: Path) -> None:
    run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            timestamp,
            "-i",
            str(video),
            "-frames:v",
            "1",
            "-update",
            "1",
            str(output),
        ]
    )


def make_contact_sheet(
    ffmpeg: str,
    images: list[Path],
    output: Path,
    columns: int,
    thumb_width: int,
) -> None:
    rows = math.ceil(len(images) / columns)
    thumb_height = round(thumb_width * 9 / 16)
    inputs: list[str] = []
    filters: list[str] = []
    labels: list[str] = []
    layout: list[str] = []

    for index, image in enumerate(images):
        inputs.extend(["-i", str(image)])
        label = f"frame{index}"
        filters.append(
            f"[{index}:v]scale={thumb_width}:{thumb_height}:"
            f"force_original_aspect_ratio=decrease,"
            f"pad={thumb_width}:{thumb_height}:(ow-iw)/2:(oh-ih)/2:black[{label}]"
        )
        labels.append(f"[{label}]")
        layout.append(
            f"{(index % columns) * thumb_width}_{(index // columns) * thumb_height}"
        )

    output.parent.mkdir(parents=True, exist_ok=True)
    filter_complex = (
        ";".join(filters)
        + ";"
        + "".join(labels)
        + f"xstack=inputs={len(images)}:layout={'|'.join(layout)}:"
        + f"fill=black[out]"
    )
    run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            *inputs,
            "-filter_complex",
            filter_complex,
            "-map",
            "[out]",
            "-frames:v",
            "1",
            "-update",
            "1",
            str(output),
        ]
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument(
        "--time",
        "-t",
        action="append",
        default=[],
        help="Timestamp or label=timestamp. Repeatable.",
    )
    parser.add_argument("--sample-count", type=int, default=5)
    parser.add_argument("--output-dir", type=Path, default=Path("qa/proof-frames"))
    parser.add_argument("--contact-sheet", type=Path, default=Path("qa/contact-sheet.png"))
    parser.add_argument("--probe-output", type=Path, default=Path("qa/media-probe.json"))
    parser.add_argument("--columns", type=int, default=3)
    parser.add_argument("--thumb-width", type=int, default=480)
    args = parser.parse_args()

    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        raise SystemExit("ffmpeg and ffprobe must be available on PATH")
    if not args.video.is_file():
        raise SystemExit(f"video not found: {args.video}")
    if args.sample_count < 1 or args.columns < 1 or args.thumb_width < 1:
        raise SystemExit("sample count, columns, and thumbnail width must be positive")

    payload = probe(ffprobe, args.video)
    times = [parse_time(item) for item in args.time]
    if not times:
        times = default_times(duration_seconds(payload), args.sample_count)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    outputs: list[Path] = []
    for index, (label, timestamp) in enumerate(times, start=1):
        output = args.output_dir / f"proof-{index:02d}-{label}.png"
        extract_frame(ffmpeg, args.video, timestamp, output)
        outputs.append(output)
        print(output)

    make_contact_sheet(ffmpeg, outputs, args.contact_sheet, args.columns, args.thumb_width)
    args.probe_output.parent.mkdir(parents=True, exist_ok=True)
    args.probe_output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(args.contact_sheet)
    print(args.probe_output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
