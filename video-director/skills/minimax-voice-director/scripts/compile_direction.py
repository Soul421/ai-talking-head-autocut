#!/usr/bin/env python3
"""Compile platform-neutral voice direction into a MiniMax render manifest and review."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from direction_contract import (
    capability_summary,
    compile_segment_text,
    direction_sha256,
    error_count,
    load_direction,
    validate_direction,
    warning_count,
)


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)


def text_sha256(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def voice_settings(payload: dict[str, Any]) -> dict[str, Any]:
    global_direction = payload.get("global", {})
    voice = global_direction.get("voice", {})
    return {
        "voice_id_env": voice.get("id_env", "MINIMAX_VOICE_ID"),
        "speed": float(voice.get("speed", 1.0)),
        "vol": float(voice.get("vol", 1.0)),
        "pitch": int(voice.get("pitch", 0)),
        "language_boost": voice.get("language_boost", "auto"),
    }


def build_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    base_voice = voice_settings(payload)
    rows: list[dict[str, Any]] = []
    for index, segment in enumerate(payload["segments"], start=1):
        render = segment.get("render") or {}
        row_voice = {
            "speed": float(render.get("speed", base_voice["speed"])),
            "vol": float(render.get("vol", base_voice["vol"])),
            "pitch": int(render.get("pitch", base_voice["pitch"])),
        }
        if render.get("emotion"):
            row_voice["emotion"] = render["emotion"]
        rows.append(
            {
                "index": index,
                "id": segment["id"],
                "text": compile_segment_text(segment),
                "subtitle_text": segment["subtitle_text"].strip(),
                "spoken_text": segment["spoken_text"].strip(),
                "silence_after_ms": segment["boundary"]["pause_after_ms"],
                "takes": segment.get("takes", 1),
                "voice_setting": row_voice,
                "director": {
                    "speech_act": segment["speech_act"],
                    "subtext": segment["subtext"],
                    "emotion": segment["emotion"],
                    "rhythm": segment["rhythm"],
                    "focus": segment.get("focus", []),
                    "intonation": segment["intonation"],
                    "reason": segment["director_reason"],
                    "rewrite": segment.get("rewrite") or {"level": "none"},
                },
                "capability": capability_summary(segment),
            }
        )
    return rows


def render_review(
    payload: dict[str, Any], rows: list[dict[str, Any]], issues: list[Any]
) -> str:
    global_direction = payload["global"]
    lines = [
        "# 声音导演审查",
        "",
        f"- 状态：`{payload.get('status')}`",
        f"- 引擎：`{payload.get('model')}`",
        f"- 场景：{global_direction.get('scene')}",
        f"- 表演目标：{global_direction.get('performance_goal')}",
        f"- 情绪弧线：{global_direction.get('emotional_arc')}",
        f"- 最终速度：`{global_direction.get('final_tempo', 1.1)}x`",
        "",
        "## 风险摘要",
        "",
    ]
    risky_rows = [
        row
        for row, segment in zip(rows, payload["segments"])
        if segment.get("nonverbal")
        or segment.get("micro_breaks")
        or segment.get("render")
        or (segment.get("rewrite") or {}).get("level", "none") != "none"
        or segment["boundary"]["after"] in {"emphasis", "section"}
        or any(item.get("strength") == "strong" for item in segment.get("focus", []))
        or segment.get("takes", 1) > 1
    ]
    if risky_rows:
        lines.extend(
            [
                "| ID | 言语动作 | 边界 | 改写/声音事件/停顿 | 局部参数 | Take |",
                "|---|---|---:|---|---|---:|",
            ]
        )
        segment_by_id = {segment["id"]: segment for segment in payload["segments"]}
        for row in risky_rows:
            segment = segment_by_id[row["id"]]
            events = ", ".join(
                event["type"] for event in segment.get("nonverbal", [])
            ) or "-"
            if segment.get("micro_breaks"):
                micro = ", ".join(
                    f"{item['pause_ms']}ms" for item in segment["micro_breaks"]
                )
                events = f"{events}; micro={micro}"
            rewrite = (segment.get("rewrite") or {}).get("level", "none")
            decisions = f"rewrite={rewrite}; {events}"
            render = segment.get("render") or {}
            render_summary = ", ".join(
                f"{key}={value}"
                for key, value in render.items()
                if key != "reason"
            ) or "-"
            lines.append(
                f"| {row['id']} | {row['director']['speech_act']} | "
                f"{row['silence_after_ms']}ms | {decisions} | {render_summary} | {row['takes']} |"
            )
    else:
        lines.append("无显式高风险决策。")

    lines.extend(["", "## 静态检查", ""])
    if issues:
        for issue in issues:
            lines.append(
                f"- **{issue.severity.upper()} {issue.code}** `{issue.path}`：{issue.message}"
            )
    else:
        lines.append("- 没有错误或警告。")

    lines.extend(["", "## 逐段表演谱", ""])
    for row in rows:
        director = row["director"]
        focus = "、".join(
            f"{item['text']}({item['strength']})" for item in director["focus"]
        ) or "无显式焦点"
        lines.extend(
            [
                f"### {row['id']}",
                "",
                f"- 字幕：{row['subtitle_text']}",
                f"- 口语：{row['spoken_text']}",
                f"- 改写：{director['rewrite'].get('level', 'none')}；{director['rewrite'].get('reason') or '无'}",
                f"- 言语动作：{director['speech_act']}",
                f"- 潜台词：{director['subtext']}",
                f"- 情绪：{director['emotion']['state']} / {director['emotion']['intensity']} / {director['emotion']['transition']}",
                f"- 节奏：{director['rhythm']['base']}；{director['rhythm']['curve']}；{director['rhythm']['continuity']}",
                f"- 焦点：{focus}",
                f"- 语调：{director['intonation']['opening']} → {director['intonation']['turn']} → {director['intonation']['ending']}",
                f"- 编译预览：`{row['text']}`",
                f"- 实现边界：原生={', '.join(row['capability']['native'])}；近似={', '.join(row['capability']['approximate'])}",
                f"- 导演理由：{director['reason']}",
                "",
            ]
        )
    lines.extend(
        [
            "## 审批门",
            "",
            "本文件只是审查视图。只有在 `voice-direction.yaml` 中记录人工批准且 hash 未失效后，才允许调用 MiniMax。",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("direction", type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--meta", required=True, type=Path)
    parser.add_argument("--review", required=True, type=Path)
    parser.add_argument("--lint-report", required=True, type=Path)
    parser.add_argument("--subtitle-source", required=True, type=Path)
    args = parser.parse_args()

    direction_path = args.direction.expanduser().resolve()
    payload = load_direction(direction_path)
    issues = validate_direction(direction_path, payload)
    if error_count(issues):
        for issue in issues:
            if issue.severity == "error":
                print(f"ERROR {issue.path}: {issue.message}")
        return 1

    rows = build_rows(payload)
    digest = direction_sha256(direction_path, payload)
    approval = payload.get("approval") or {}
    render_allowed = (
        payload.get("status") in {"approved", "rendered", "audio_approved", "subtitled"}
        and approval.get("human") == "approved"
        and approval.get("lint") == "passed"
        and approval.get("content_sha256") == digest
    )
    base_voice = voice_settings(payload)
    manifest_content = "".join(
        json.dumps(row, ensure_ascii=False) + "\n" for row in rows
    )
    subtitle_content = "\n".join(row["subtitle_text"] for row in rows) + "\n"
    meta = {
        "version": 1,
        "direction": str(direction_path),
        "direction_sha256": digest,
        "status": payload.get("status"),
        "render_allowed": render_allowed,
        "model": payload["model"],
        "profile": payload.get("profile", "hybrid"),
        "final_tempo": payload["global"].get("final_tempo", 1.1),
        "voice": base_voice,
        "audio": {
            "format": "wav",
            "sample_rate": 32000,
            "channel": 1,
        },
        "segment_count": len(rows),
        "artifacts": {
            "manifest_sha256": text_sha256(manifest_content),
            "subtitle_source_sha256": text_sha256(subtitle_content),
        },
    }
    lint_report = {
        "errors": error_count(issues),
        "warnings": warning_count(issues),
        "issues": [issue.to_dict() for issue in issues],
    }

    atomic_write(
        args.manifest.expanduser().resolve(),
        manifest_content,
    )
    atomic_write(
        args.meta.expanduser().resolve(),
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
    )
    atomic_write(
        args.review.expanduser().resolve(), render_review(payload, rows, issues) + "\n"
    )
    atomic_write(
        args.lint_report.expanduser().resolve(),
        json.dumps(lint_report, ensure_ascii=False, indent=2) + "\n",
    )
    atomic_write(
        args.subtitle_source.expanduser().resolve(),
        subtitle_content,
    )
    print(f"已编译 {len(rows)} 段；render_allowed={str(render_allowed).lower()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
