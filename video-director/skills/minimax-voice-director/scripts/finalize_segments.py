#!/usr/bin/env python3
"""Trim segment-edge silence, rebuild pauses, and set final tempo."""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
import wave
from array import array
from dataclasses import dataclass
from pathlib import Path


DEFAULT_TEMPO = 1.1


@dataclass
class SegmentAudio:
    path: Path
    sample_rate: int
    samples: array
    trimmed: array
    trim_start_frames: int
    trim_end_frames: int
    kept_leading_frames: int
    kept_trailing_frames: int


def load_manifest(path: Path) -> list[dict]:
    rows: list[dict] = []
    for line_number, raw_line in enumerate(
        path.read_text(encoding="utf-8").splitlines(), start=1
    ):
        if not raw_line.strip():
            continue
        try:
            row = json.loads(raw_line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"manifest 第 {line_number} 行不是有效 JSON：{exc}") from exc
        if not isinstance(row, dict):
            raise ValueError(f"manifest 第 {line_number} 行必须是对象")
        pause = row.get("silence_after_ms", 0)
        if isinstance(pause, bool) or not isinstance(pause, (int, float)) or pause < 0:
            raise ValueError(f"manifest 第 {line_number} 行 silence_after_ms 无效")
        rows.append(row)
    if not rows:
        raise ValueError("manifest 不能为空")
    return rows


def read_pcm16_mono(path: Path) -> tuple[int, array]:
    with wave.open(str(path), "rb") as handle:
        if handle.getcomptype() != "NONE":
            raise ValueError(f"仅支持未压缩 PCM WAV：{path}")
        if handle.getnchannels() != 1 or handle.getsampwidth() != 2:
            raise ValueError(f"仅支持 16-bit 单声道 WAV：{path}")
        sample_rate = handle.getframerate()
        payload = handle.readframes(handle.getnframes())
    samples = array("h")
    samples.frombytes(payload)
    if sys.byteorder == "big":
        samples.byteswap()
    if not samples:
        raise ValueError(f"音频为空：{path}")
    return sample_rate, samples


def write_pcm16_mono(path: Path, sample_rate: int, samples: array) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    payload = array("h", samples)
    if sys.byteorder == "big":
        payload.byteswap()
    with wave.open(str(temporary), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(payload.tobytes())
    temporary.replace(path)


def active_span(
    samples: array,
    sample_rate: int,
    *,
    threshold_db: float,
    window_ms: float,
) -> tuple[int, int]:
    window_frames = max(1, round(sample_rate * window_ms / 1000))
    threshold = 32767 * (10 ** (threshold_db / 20))
    first_active: int | None = None
    last_active_end: int | None = None
    for start in range(0, len(samples), window_frames):
        end = min(len(samples), start + window_frames)
        energy = sum(value * value for value in samples[start:end]) / (end - start)
        if math.sqrt(energy) >= threshold:
            if first_active is None:
                first_active = start
            last_active_end = end
    if first_active is None or last_active_end is None:
        raise ValueError("片段没有检测到可朗读声音，拒绝把整段当静音处理")
    return first_active, last_active_end


def prepare_segment(
    path: Path,
    *,
    threshold_db: float,
    window_ms: float,
    edge_pad_ms: float,
) -> SegmentAudio:
    sample_rate, samples = read_pcm16_mono(path)
    first_active, last_active_end = active_span(
        samples,
        sample_rate,
        threshold_db=threshold_db,
        window_ms=window_ms,
    )
    pad_frames = round(sample_rate * edge_pad_ms / 1000)
    trim_start = max(0, first_active - pad_frames)
    trim_end = min(len(samples), last_active_end + pad_frames)
    return SegmentAudio(
        path=path,
        sample_rate=sample_rate,
        samples=samples,
        trimmed=array("h", samples[trim_start:trim_end]),
        trim_start_frames=trim_start,
        trim_end_frames=len(samples) - trim_end,
        kept_leading_frames=first_active - trim_start,
        kept_trailing_frames=trim_end - last_active_end,
    )


def finalize(
    *,
    segments_dir: Path,
    manifest_path: Path,
    paced_output: Path,
    output: Path,
    tempo: float,
    report_path: Path | None,
    threshold_db: float = -35.0,
    window_ms: float = 10.0,
    edge_pad_ms: float = 20.0,
) -> dict:
    if not 0.5 <= tempo <= 2.0:
        raise ValueError("tempo 必须在 0.5 到 2.0 之间")
    manifest = load_manifest(manifest_path)
    segment_paths = sorted(segments_dir.glob("[0-9][0-9][0-9][0-9].wav"))
    if len(segment_paths) != len(manifest):
        raise ValueError(
            f"逐段 WAV 数量（{len(segment_paths)}）与 manifest（{len(manifest)}）不一致"
        )

    segments = [
        prepare_segment(
            path,
            threshold_db=threshold_db,
            window_ms=window_ms,
            edge_pad_ms=edge_pad_ms,
        )
        for path in segment_paths
    ]
    sample_rate = segments[0].sample_rate
    if any(segment.sample_rate != sample_rate for segment in segments):
        raise ValueError("所有逐段 WAV 必须使用相同采样率")

    combined = array("h")
    boundaries: list[dict] = []
    for index, (segment, row) in enumerate(zip(segments, manifest)):
        combined.extend(segment.trimmed)
        if index == len(segments) - 1:
            continue
        target_frames = round(sample_rate * float(row.get("silence_after_ms", 0)) / 1000)
        next_segment = segments[index + 1]
        residual_frames = (
            segment.kept_trailing_frames + next_segment.kept_leading_frames
        )
        inserted_frames = max(0, target_frames - residual_frames)
        combined.extend(array("h", [0]) * inserted_frames)
        boundaries.append(
            {
                "after_segment": index + 1,
                "target_ms_pretempo": round(target_frames * 1000 / sample_rate),
                "retained_edge_ms": round(residual_frames * 1000 / sample_rate),
                "inserted_silence_ms": round(inserted_frames * 1000 / sample_rate),
                "estimated_ms_after_tempo": round(
                    target_frames * 1000 / sample_rate / tempo
                ),
            }
        )

    write_pcm16_mono(paced_output, sample_rate, combined)
    output.parent.mkdir(parents=True, exist_ok=True)
    if tempo == 1.0:
        shutil.copyfile(paced_output, output)
    else:
        temporary = output.with_suffix(output.suffix + ".tmp.wav")
        subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(paced_output),
                "-af",
                f"atempo={tempo:.6f}",
                "-c:a",
                "pcm_s16le",
                "-ar",
                str(sample_rate),
                "-ac",
                "1",
                str(temporary),
            ],
            check=True,
        )
        temporary.replace(output)

    report = {
        "manifest": str(manifest_path),
        "segments_dir": str(segments_dir),
        "paced_output": str(paced_output),
        "output": str(output),
        "sample_rate": sample_rate,
        "tempo": tempo,
        "threshold_db": threshold_db,
        "window_ms": window_ms,
        "edge_pad_ms": edge_pad_ms,
        "duration_seconds_pretempo": round(len(combined) / sample_rate, 3),
        "estimated_duration_seconds": round(len(combined) / sample_rate / tempo, 3),
        "segments": [
            {
                "index": index,
                "path": str(segment.path),
                "original_ms": round(len(segment.samples) * 1000 / sample_rate),
                "trimmed_ms": round(len(segment.trimmed) * 1000 / sample_rate),
                "trimmed_leading_ms": round(
                    segment.trim_start_frames * 1000 / sample_rate
                ),
                "trimmed_trailing_ms": round(
                    segment.trim_end_frames * 1000 / sample_rate
                ),
            }
            for index, segment in enumerate(segments, start=1)
        ],
        "boundaries": boundaries,
    }
    if report_path:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = report_path.with_suffix(report_path.suffix + ".tmp")
        temporary.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        temporary.replace(report_path)
    return report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--segments-dir", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--paced-output", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--tempo", type=float, default=DEFAULT_TEMPO)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--threshold-db", type=float, default=-35.0)
    parser.add_argument("--window-ms", type=float, default=10.0)
    parser.add_argument("--edge-pad-ms", type=float, default=20.0)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    report = finalize(
        segments_dir=args.segments_dir.expanduser().resolve(),
        manifest_path=args.manifest.expanduser().resolve(),
        paced_output=args.paced_output.expanduser().resolve(),
        output=args.output.expanduser().resolve(),
        tempo=args.tempo,
        report_path=args.report.expanduser().resolve() if args.report else None,
        threshold_db=args.threshold_db,
        window_ms=args.window_ms,
        edge_pad_ms=args.edge_pad_ms,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
