#!/usr/bin/env python3
"""Materialize approved candidate choices as numbered WAV files for final assembly."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import yaml

from direction_contract import file_sha256


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results", required=True, type=Path)
    parser.add_argument("--selection", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()

    results_path = args.results.expanduser().resolve()
    selection_path = args.selection.expanduser().resolve()
    output_dir = args.output_dir.expanduser().resolve()
    results = json.loads(results_path.read_text(encoding="utf-8"))
    selection = yaml.safe_load(selection_path.read_text(encoding="utf-8"))
    if not isinstance(selection, dict):
        raise ValueError("take-selection.yaml 必须是对象")
    if selection.get("direction_sha256") != results.get("direction_sha256"):
        raise ValueError("Take 选择与渲染结果不属于同一版导演稿")

    choices = selection.get("selections")
    if not isinstance(choices, dict):
        raise ValueError("缺少 selections")
    segment_results = results.get("segments", {})
    ordered = sorted(segment_results.items(), key=lambda item: item[1]["index"])
    expected_names = {f"{data['index']:04d}.wav" for _, data in ordered}
    output_dir.mkdir(parents=True, exist_ok=True)
    stale = [path for path in output_dir.glob("*.wav") if path.name not in expected_names]
    if stale:
        raise ValueError(
            "选中目录存在不属于当前计划的 WAV，拒绝自动删除："
            + ", ".join(str(path) for path in stale)
        )

    selected_report: list[dict] = []
    for segment_id, data in ordered:
        selected_take = choices.get(segment_id)
        if not isinstance(selected_take, int):
            raise ValueError(f"还没有选定 {segment_id} 的 Take")
        candidates = {
            item["take"]: item
            for item in data.get("takes", [])
            if item.get("success")
        }
        if selected_take not in candidates:
            raise ValueError(f"{segment_id} 的 Take {selected_take} 不存在或生成失败")
        source = Path(candidates[selected_take]["path"])
        if not source.is_file():
            raise FileNotFoundError(source)
        expected_hash = candidates[selected_take].get("sha256")
        if not expected_hash or file_sha256(source) != expected_hash:
            raise ValueError(f"{segment_id} 的候选 Take 文件与生成记录不一致")
        target = output_dir / f"{data['index']:04d}.wav"
        shutil.copy2(source, target)
        selected_report.append(
            {
                "id": segment_id,
                "index": data["index"],
                "take": selected_take,
                "source": str(source),
                "selected": str(target),
                "sha256": file_sha256(target),
            }
        )

    report_path = output_dir / "selection-report.json"
    report_path.write_text(
        json.dumps(
            {
                "direction_sha256": results["direction_sha256"],
                "segments": selected_report,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"已选定 {len(selected_report)} 段：{output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
