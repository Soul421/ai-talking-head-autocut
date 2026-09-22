#!/usr/bin/env python3
"""Render approved MiniMax voice-direction manifest rows into candidate WAV takes."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

import yaml

SKILL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL_ROOT / "assets"))

from direction_contract import (  # noqa: E402
    direction_sha256,
    error_count,
    file_sha256,
    load_direction,
    validate_direction,
    write_direction,
)
from minimax_tts import text_to_audio  # noqa: E402


def load_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"必须是 JSON 对象：{path}")
    return payload


def load_manifest(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        if not isinstance(row, dict):
            raise ValueError(f"manifest 第 {line_number} 行必须是对象")
        rows.append(row)
    if not rows:
        raise ValueError("manifest 为空")
    return rows


def atomic_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def atomic_yaml(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        yaml.safe_dump(payload, allow_unicode=True, sort_keys=False, width=1000),
        encoding="utf-8",
    )
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--direction", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--meta", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--results", required=True, type=Path)
    parser.add_argument("--selection", required=True, type=Path)
    parser.add_argument("--segment", action="append", dest="segments")
    parser.add_argument("--take-start", type=int, default=1)
    parser.add_argument("--takes", type=int, help="局部重生时覆盖计划 Take 数")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.take_start < 1 or (args.takes is not None and not 1 <= args.takes <= 3):
        raise ValueError("take-start 必须 >= 1，takes 必须在 1..3")

    direction_path = args.direction.expanduser().resolve()
    manifest_path = args.manifest.expanduser().resolve()
    meta_path = args.meta.expanduser().resolve()
    output_dir = args.output_dir.expanduser().resolve()
    results_path = args.results.expanduser().resolve()
    selection_path = args.selection.expanduser().resolve()

    direction = load_direction(direction_path)
    issues = validate_direction(direction_path, direction, require_approved=True)
    if error_count(issues):
        for issue in issues:
            if issue.severity == "error":
                print(f"ERROR {issue.path}: {issue.message}")
        return 1

    meta = load_json(meta_path)
    current_hash = direction_sha256(direction_path, direction)
    if not meta.get("render_allowed"):
        raise ValueError("编译产物未通过审批门，拒绝云端生成")
    if meta.get("direction_sha256") != current_hash:
        raise ValueError("导演稿已变更，请重新编译和审批")
    if (
        meta.get("artifacts", {}).get("manifest_sha256")
        != file_sha256(manifest_path)
    ):
        raise ValueError("render manifest 已被改动，请从导演稿重新编译")

    rows = load_manifest(manifest_path)
    requested_ids = set(args.segments or [])
    known_ids = {row["id"] for row in rows}
    unknown_ids = requested_ids - known_ids
    if unknown_ids:
        raise ValueError(f"未知 segment：{', '.join(sorted(unknown_ids))}")
    selected_rows = [row for row in rows if not requested_ids or row["id"] in requested_ids]

    sanitized_plan = [
        {
            "id": row["id"],
            "index": row["index"],
            "takes": args.takes or row["takes"],
            "text": row["text"],
            "voice_setting": row["voice_setting"],
        }
        for row in selected_rows
    ]
    if args.dry_run:
        print(json.dumps({"dry_run": True, "segments": sanitized_plan}, ensure_ascii=False, indent=2))
        return 0

    voice_env = meta.get("voice", {}).get("voice_id_env", "MINIMAX_VOICE_ID")
    voice_id = os.environ.get(voice_env)
    if not voice_id:
        raise ValueError(f"缺少声音环境变量：{voice_env}")

    output_dir.mkdir(parents=True, exist_ok=True)
    if results_path.is_file():
        results = load_json(results_path)
        if results.get("direction_sha256") != current_hash:
            raise ValueError("现有 render-results.json 属于另一版导演稿")
    else:
        results = {
            "version": 1,
            "direction_sha256": current_hash,
            "model": meta["model"],
            "segments": {},
        }

    failures = 0
    for row in selected_rows:
        segment_results = results["segments"].setdefault(
            row["id"],
            {"index": row["index"], "subtitle_text": row["subtitle_text"], "takes": []},
        )
        planned_takes = args.takes or row["takes"]
        for take_number in range(args.take_start, args.take_start + planned_takes):
            output_path = output_dir / f"{row['index']:04d}-take{take_number:02d}.wav"
            if output_path.exists():
                raise FileExistsError(
                    f"候选 Take 已存在，为避免覆盖请改 take-start：{output_path}"
                )
            voice_setting = row["voice_setting"]
            result = text_to_audio(
                text=row["text"],
                voice_id=voice_id,
                output_path=str(output_path),
                model=meta["model"],
                speed=voice_setting["speed"],
                vol=voice_setting["vol"],
                pitch=voice_setting["pitch"],
                emotion=voice_setting.get("emotion"),
                format="wav",
                sample_rate=meta.get("audio", {}).get("sample_rate", 32000),
                channel=1,
                language_boost=meta.get("voice", {}).get("language_boost", "auto"),
                subtitle_enable=True,
                subtitle_type="word",
            )
            take_result = {
                "take": take_number,
                "path": str(output_path),
                "success": bool(result.get("success")),
                "trace_id": result.get("trace_id"),
                "duration": result.get("duration"),
                "extra_info": result.get("extra_info"),
                "response_metadata": result.get("response_metadata"),
            }
            if result.get("success"):
                take_result["sha256"] = file_sha256(output_path)
            if not result.get("success"):
                take_result["error"] = result.get("error")
                failures += 1
            segment_results["takes"].append(take_result)
            atomic_json(results_path, results)

    selection = {
        "version": 1,
        "direction_sha256": current_hash,
        "selections": {},
    }
    if selection_path.is_file():
        loaded = yaml.safe_load(selection_path.read_text(encoding="utf-8")) or {}
        if isinstance(loaded, dict) and loaded.get("direction_sha256") == current_hash:
            selection = loaded
            selection.setdefault("selections", {})
    for row in rows:
        successful = [
            item["take"]
            for item in results.get("segments", {}).get(row["id"], {}).get("takes", [])
            if item.get("success")
        ]
        current = selection["selections"].get(row["id"])
        if current not in successful:
            selection["selections"][row["id"]] = successful[0] if len(successful) == 1 else None
    atomic_yaml(selection_path, selection)

    complete = all(
        any(
            item.get("success")
            for item in results.get("segments", {}).get(row["id"], {}).get("takes", [])
        )
        for row in rows
    )
    if not failures and complete:
        direction["status"] = "rendered"
        write_direction(direction_path, direction)
    print(
        f"生成完成：{len(selected_rows)} 段，失败 Take={failures}，"
        f"全片候选完整={str(complete).lower()}"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
