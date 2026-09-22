#!/usr/bin/env python3
"""Assemble selected WAV takes, rebuild pauses, apply final tempo, and measure audio."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from direction_contract import (
    direction_sha256,
    error_count,
    file_sha256,
    load_direction,
    normalized_spoken_text,
    validate_direction,
)
from finalize_segments import finalize, load_manifest
from validate_voiceover import inspect


def validate_selection_report(
    selection_report: object,
    *,
    manifest: list[dict],
    selected_dir: Path,
) -> None:
    if not isinstance(selection_report, dict):
        raise ValueError("selection-report.json 必须是对象")
    report_segments = selection_report.get("segments")
    if not isinstance(report_segments, list):
        raise ValueError("selection-report.json 缺少 segments 列表")

    manifest_by_id: dict[str, dict] = {}
    manifest_by_index: dict[int, dict] = {}
    for row in manifest:
        segment_id = row.get("id")
        index = row.get("index")
        if not isinstance(segment_id, str) or not segment_id:
            raise ValueError("manifest 片段缺少有效 id")
        if isinstance(index, bool) or not isinstance(index, int) or index < 1:
            raise ValueError(f"manifest 片段 {segment_id} 缺少有效 index")
        if segment_id in manifest_by_id or index in manifest_by_index:
            raise ValueError("manifest 片段 id/index 必须唯一")
        manifest_by_id[segment_id] = row
        manifest_by_index[index] = row

    seen_ids: set[str] = set()
    seen_indices: set[int] = set()
    for item in report_segments:
        if not isinstance(item, dict):
            raise ValueError("selection-report.json 的片段记录必须是对象")
        segment_id = item.get("id")
        index = item.get("index")
        if not isinstance(segment_id, str) or not segment_id:
            raise ValueError("Take 选择记录缺少有效 id")
        if isinstance(index, bool) or not isinstance(index, int) or index < 1:
            raise ValueError(f"Take 选择记录 {segment_id} 缺少有效 index")
        if segment_id in seen_ids or index in seen_indices:
            raise ValueError(f"Take 选择记录存在重复片段：{segment_id}/{index}")
        seen_ids.add(segment_id)
        seen_indices.add(index)
        row = manifest_by_id.get(segment_id)
        if row is None or manifest_by_index.get(index) is not row:
            raise ValueError(f"Take 选择记录与 manifest 不匹配：{segment_id}/{index}")

        expected_path = selected_dir / f"{index:04d}.wav"
        selected_value = item.get("selected")
        if not isinstance(selected_value, str):
            raise ValueError(f"{segment_id} 缺少选中 WAV 路径")
        selected_path = Path(selected_value).expanduser()
        if (
            not selected_path.is_absolute()
            or selected_path != expected_path
            or expected_path.is_symlink()
            or not expected_path.is_file()
        ):
            raise ValueError(f"选中片段不是规范编号 WAV：{selected_path}")
        if file_sha256(expected_path) != item.get("sha256"):
            raise ValueError(f"选中片段已被替换：{expected_path}")

    expected_ids = set(manifest_by_id)
    expected_indices = set(manifest_by_index)
    if seen_ids != expected_ids or seen_indices != expected_indices:
        missing = sorted(expected_ids - seen_ids)
        extra = sorted(seen_ids - expected_ids)
        raise ValueError(
            "Take 选择记录必须逐段与 manifest 一致"
            f"（缺少={missing}，多余={extra}）"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--direction", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--meta", required=True, type=Path)
    parser.add_argument("--selected-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--tempo", type=float)
    args = parser.parse_args()

    direction_path = args.direction.expanduser().resolve()
    manifest_path = args.manifest.expanduser().resolve()
    meta_path = args.meta.expanduser().resolve()
    selected_dir = args.selected_dir.expanduser().resolve()
    output_dir = args.output_dir.expanduser().resolve()

    direction = load_direction(direction_path)
    issues = validate_direction(direction_path, direction, require_approved=True)
    if error_count(issues):
        for issue in issues:
            if issue.severity == "error":
                print(f"ERROR {issue.path}: {issue.message}")
        return 1
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    digest = direction_sha256(direction_path, direction)
    if meta.get("direction_sha256") != digest:
        raise ValueError("导演稿与编译产物 hash 不一致")
    if (
        meta.get("artifacts", {}).get("manifest_sha256")
        != file_sha256(manifest_path)
    ):
        raise ValueError("render manifest 已被改动，请重新编译")
    rows = load_manifest(manifest_path)

    selection_report_path = selected_dir / "selection-report.json"
    if not selection_report_path.is_file():
        raise ValueError("缺少 selection-report.json，不能证明最终片段来自已选 Take")
    selection_report = json.loads(selection_report_path.read_text(encoding="utf-8"))
    if not isinstance(selection_report, dict):
        raise ValueError("selection-report.json 必须是对象")
    if selection_report.get("direction_sha256") != digest:
        raise ValueError("Take 选择记录与当前导演稿不一致")
    validate_selection_report(
        selection_report,
        manifest=rows,
        selected_dir=selected_dir,
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    paced_output = output_dir / "voice-paced.wav"
    final_output = output_dir / "voice.wav"
    finalize_report = output_dir / "finalize-report.json"
    validation_path = output_dir / "validation.json"
    tempo = float(args.tempo or meta.get("final_tempo", 1.1))

    finalize_report_payload = finalize(
        segments_dir=selected_dir,
        manifest_path=manifest_path,
        paced_output=paced_output,
        output=final_output,
        tempo=tempo,
        report_path=finalize_report,
    )
    validation = inspect(final_output)
    normalized_chars = len(
        normalized_spoken_text("".join(row["subtitle_text"] for row in rows))
    )
    duration = validation["duration_seconds"]
    validation["normalized_characters"] = normalized_chars
    validation["characters_per_second"] = (
        round(normalized_chars / duration, 3) if duration else None
    )
    validation["target_characters_per_second"] = direction["global"].get(
        "target_characters_per_second", [5.0, 5.3]
    )
    validation["direction_sha256"] = digest
    validation["audio_sha256"] = file_sha256(final_output)
    validation["selection_report_sha256"] = file_sha256(selection_report_path)
    validation_path.write_text(
        json.dumps(validation, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "finalize": finalize_report_payload,
                "validation": validation,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
