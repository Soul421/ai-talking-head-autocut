#!/usr/bin/env python3
"""Contract, validation, approval hashing, and compilation for voice direction YAML."""

from __future__ import annotations

import copy
import hashlib
import json
import re
import unicodedata
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import yaml


PAUSE_RANGES: dict[str, dict[str, tuple[int, int]]] = {
    "compact": {
        "none": (0, 0),
        "flow": (80, 160),
        "emphasis": (180, 280),
        "section": (320, 450),
        "final": (0, 0),
    },
    "hybrid": {
        "none": (0, 0),
        "flow": (120, 220),
        "emphasis": (280, 380),
        "section": (420, 550),
        "final": (0, 0),
    },
    "natural": {
        "none": (0, 0),
        "flow": (160, 260),
        "emphasis": (300, 480),
        "section": (500, 650),
        "final": (0, 0),
    },
}
STATUSES = (
    "draft",
    "reviewed",
    "approved",
    "rendered",
    "audio_approved",
    "subtitled",
)
APPROVED_STATUSES = {"approved", "rendered", "audio_approved", "subtitled"}
BOUNDARIES = {"none", "flow", "emphasis", "section", "final"}
INTENSITIES = {"low", "medium", "high"}
FOCUS_STRENGTHS = {"subtle", "moderate", "strong"}
POSITIONS = {"before", "after", "before_anchor", "after_anchor"}
SOUND_TAGS = {
    "laughs",
    "chuckle",
    "coughs",
    "clear-throat",
    "groans",
    "breath",
    "pant",
    "inhale",
    "exhale",
    "gasps",
    "sniffs",
    "sighs",
    "snorts",
    "burps",
    "lip-smacking",
    "humming",
    "hissing",
    "emm",
    "sneezes",
}
SOUND_MODELS = {"speech-2.8-hd", "speech-2.8-turbo"}
PAUSE_TAG_RE = re.compile(r"<#\s*[0-9.]+\s*#>")
SOUND_TAG_RE = re.compile(
    r"\((?:" + "|".join(re.escape(tag) for tag in sorted(SOUND_TAGS)) + r")\)"
)


@dataclass(frozen=True)
class Issue:
    severity: str
    code: str
    path: str
    message: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


def load_direction(path: Path) -> dict[str, Any]:
    try:
        payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise ValueError(f"导演 YAML 无法解析：{exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError("导演文件顶层必须是对象")
    return payload


def write_direction(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        yaml.safe_dump(
            payload,
            allow_unicode=True,
            sort_keys=False,
            width=1000,
        ),
        encoding="utf-8",
    )
    temporary.replace(path)


def normalized_spoken_text(text: str) -> str:
    chars: list[str] = []
    for char in unicodedata.normalize("NFKC", text):
        category = unicodedata.category(char)
        if char.isspace() or category.startswith("P"):
            continue
        chars.append(char.casefold())
    return "".join(chars)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_source_path(direction_path: Path, payload: dict[str, Any]) -> Path | None:
    source = payload.get("source")
    if not isinstance(source, dict):
        return None
    raw_path = source.get("path")
    if not isinstance(raw_path, str) or not raw_path.strip():
        return None
    source_path = Path(raw_path).expanduser()
    if not source_path.is_absolute():
        source_path = direction_path.parent / source_path
    return source_path.resolve()


def direction_sha256(direction_path: Path, payload: dict[str, Any]) -> str:
    canonical = copy.deepcopy(payload)
    canonical.pop("status", None)
    canonical.pop("approval", None)
    source_path = resolve_source_path(direction_path, payload)
    canonical["_source_file_sha256"] = (
        file_sha256(source_path) if source_path and source_path.is_file() else None
    )
    encoded = json.dumps(
        canonical,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _issue(
    issues: list[Issue], severity: str, code: str, path: str, message: str
) -> None:
    issues.append(Issue(severity, code, path, message))


def _validate_text_fields(
    segment: dict[str, Any], label: str, issues: list[Issue]
) -> tuple[str, str]:
    subtitle_text = segment.get("subtitle_text")
    spoken_text = segment.get("spoken_text")
    if not isinstance(subtitle_text, str) or not subtitle_text.strip():
        _issue(issues, "error", "missing-subtitle-text", f"{label}.subtitle_text", "必须是非空字符串")
        subtitle_text = ""
    if not isinstance(spoken_text, str) or not spoken_text.strip():
        _issue(issues, "error", "missing-spoken-text", f"{label}.spoken_text", "必须是非空字符串")
        spoken_text = ""
    for field_name, text in (
        ("subtitle_text", subtitle_text),
        ("spoken_text", spoken_text),
    ):
        if PAUSE_TAG_RE.search(text) or SOUND_TAG_RE.search(text):
            _issue(
                issues,
                "error",
                "engine-tag-in-direction",
                f"{label}.{field_name}",
                "导演中间层不得直接包含 MiniMax 停顿或 sound tag",
            )

    if subtitle_text and spoken_text:
        same_spoken_chars = normalized_spoken_text(subtitle_text) == normalized_spoken_text(
            spoken_text
        )
        rewrite = segment.get("rewrite") or {"level": "none"}
        if not isinstance(rewrite, dict):
            _issue(issues, "error", "invalid-rewrite", f"{label}.rewrite", "必须是对象")
        else:
            level = rewrite.get("level", "none")
            if level not in {"none", "oral", "content"}:
                _issue(
                    issues,
                    "error",
                    "invalid-rewrite-level",
                    f"{label}.rewrite.level",
                    "只支持 none, oral, content",
                )
            if not same_spoken_chars and level == "none":
                _issue(
                    issues,
                    "error",
                    "unexplained-rewrite",
                    f"{label}.rewrite",
                    "口语稿改变了可朗读字符，必须声明 oral 或 content 改写及原因",
                )
            if not same_spoken_chars and not str(rewrite.get("reason", "")).strip():
                _issue(
                    issues,
                    "error",
                    "missing-rewrite-reason",
                    f"{label}.rewrite.reason",
                    "改写必须说明原因",
                )
            if level == "content":
                _issue(
                    issues,
                    "warning",
                    "content-rewrite",
                    f"{label}.rewrite",
                    "涉及内容层改写，审批时必须单独核对语义",
                )
    return subtitle_text.strip(), spoken_text.strip()


def validate_direction(
    direction_path: Path,
    payload: dict[str, Any],
    *,
    require_approved: bool = False,
) -> list[Issue]:
    issues: list[Issue] = []
    if payload.get("version") != 1:
        _issue(issues, "error", "invalid-version", "version", "必须为 1")
    if payload.get("engine") != "minimax":
        _issue(issues, "error", "invalid-engine", "engine", "必须为 minimax")

    model = payload.get("model")
    if not isinstance(model, str) or not model.strip():
        _issue(issues, "error", "missing-model", "model", "必须是非空字符串")
        model = ""

    status = payload.get("status")
    if status not in STATUSES:
        _issue(
            issues,
            "error",
            "invalid-status",
            "status",
            f"必须是 {', '.join(STATUSES)} 之一",
        )

    profile = payload.get("profile", "hybrid")
    if profile not in PAUSE_RANGES:
        _issue(
            issues,
            "error",
            "invalid-profile",
            "profile",
            f"只支持 {', '.join(PAUSE_RANGES)}",
        )
        profile = "hybrid"

    global_direction = payload.get("global")
    if not isinstance(global_direction, dict):
        _issue(issues, "error", "missing-global", "global", "必须是对象")
        global_direction = {}
    for key in (
        "scene",
        "audience",
        "relationship",
        "performance_goal",
        "base_emotion",
        "emotional_arc",
    ):
        if not str(global_direction.get(key, "")).strip():
            _issue(
                issues,
                "error",
                "missing-global-direction",
                f"global.{key}",
                "必须填写",
            )
    avoid = global_direction.get("avoid")
    if not isinstance(avoid, list) or not avoid:
        _issue(
            issues,
            "error",
            "missing-avoid-list",
            "global.avoid",
            "必须至少列出一个需要避免的表演问题",
        )
    final_tempo = global_direction.get("final_tempo", 1.1)
    if (
        isinstance(final_tempo, bool)
        or not isinstance(final_tempo, (int, float))
        or not 0.5 <= float(final_tempo) <= 2.0
    ):
        _issue(
            issues,
            "error",
            "invalid-final-tempo",
            "global.final_tempo",
            "必须在 0.5..2.0",
        )
    target_cps = global_direction.get("target_characters_per_second")
    if (
        not isinstance(target_cps, list)
        or len(target_cps) != 2
        or any(
            isinstance(value, bool) or not isinstance(value, (int, float))
            for value in target_cps
        )
        or not 0 < float(target_cps[0]) < float(target_cps[1]) <= 20
    ):
        _issue(
            issues,
            "error",
            "invalid-target-cps",
            "global.target_characters_per_second",
            "必须是递增的两个正数，例如 [5.0, 5.3]",
        )

    voice = global_direction.get("voice", {})
    if not isinstance(voice, dict):
        _issue(issues, "error", "invalid-voice", "global.voice", "必须是对象")
    else:
        voice_id_env = voice.get("id_env", "MINIMAX_VOICE_ID")
        if not isinstance(voice_id_env, str) or not re.fullmatch(
            r"[A-Z_][A-Z0-9_]*", voice_id_env
        ):
            _issue(
                issues,
                "error",
                "invalid-voice-env",
                "global.voice.id_env",
                "必须是大写环境变量名",
            )
        for key, lower, upper in (
            ("speed", 0.5, 2.0),
            ("vol", 0.1, 10.0),
            ("pitch", -12, 12),
        ):
            value = voice.get(key, {"speed": 1.0, "vol": 1.0, "pitch": 0}[key])
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not lower <= float(value) <= upper
            ):
                _issue(
                    issues,
                    "error",
                    "invalid-global-voice-value",
                    f"global.voice.{key}",
                    f"必须在 {lower}..{upper}",
                )

    source_path = resolve_source_path(direction_path, payload)
    if source_path is None:
        _issue(
            issues,
            "warning",
            "missing-source-path",
            "source.path",
            "未绑定原稿，无法自动发现审批后原稿变更",
        )
    elif not source_path.is_file():
        _issue(
            issues,
            "error" if status in APPROVED_STATUSES else "warning",
            "source-file-missing",
            "source.path",
            f"原稿不存在：{source_path}",
        )

    segments = payload.get("segments")
    if not isinstance(segments, list) or not segments:
        _issue(issues, "error", "missing-segments", "segments", "必须是非空数组")
        segments = []

    ids: set[str] = set()
    for index, segment in enumerate(segments, start=1):
        label = f"segments[{index - 1}]"
        if not isinstance(segment, dict):
            _issue(issues, "error", "invalid-segment", label, "必须是对象")
            continue
        segment_id = segment.get("id")
        if not isinstance(segment_id, str) or not segment_id.strip():
            _issue(issues, "error", "missing-segment-id", f"{label}.id", "必须填写")
        elif segment_id in ids:
            _issue(issues, "error", "duplicate-segment-id", f"{label}.id", f"重复 id：{segment_id}")
        else:
            ids.add(segment_id)

        _, spoken_text = _validate_text_fields(segment, label, issues)
        if len(normalized_spoken_text(spoken_text)) > 300:
            _issue(
                issues,
                "warning",
                "long-performance-segment",
                f"{label}.spoken_text",
                "单段超过 300 个可朗读字符，难以稳定控制节奏、焦点和 Take 选择",
            )
        for key in ("speech_act", "subtext", "director_reason"):
            if not str(segment.get(key, "")).strip():
                _issue(
                    issues,
                    "error",
                    "missing-performance-direction",
                    f"{label}.{key}",
                    "必须填写",
                )

        emotion = segment.get("emotion")
        if not isinstance(emotion, dict):
            _issue(issues, "error", "invalid-emotion", f"{label}.emotion", "必须是对象")
        else:
            for key in ("state", "transition"):
                if not str(emotion.get(key, "")).strip():
                    _issue(issues, "error", "missing-emotion-direction", f"{label}.emotion.{key}", "必须填写")
            if emotion.get("intensity") not in INTENSITIES:
                _issue(issues, "error", "invalid-emotion-intensity", f"{label}.emotion.intensity", "只支持 low, medium, high")

        rhythm = segment.get("rhythm")
        if not isinstance(rhythm, dict):
            _issue(issues, "error", "invalid-rhythm", f"{label}.rhythm", "必须是对象")
        else:
            for key in ("base", "curve", "continuity"):
                if not str(rhythm.get(key, "")).strip():
                    _issue(issues, "error", "missing-rhythm-direction", f"{label}.rhythm.{key}", "必须填写")

        intonation = segment.get("intonation")
        if not isinstance(intonation, dict):
            _issue(issues, "error", "invalid-intonation", f"{label}.intonation", "必须是对象")
        else:
            for key in ("opening", "turn", "ending"):
                if not str(intonation.get(key, "")).strip():
                    _issue(issues, "error", "missing-intonation-direction", f"{label}.intonation.{key}", "必须填写")

        focus = segment.get("focus", [])
        if not isinstance(focus, list):
            _issue(issues, "error", "invalid-focus", f"{label}.focus", "必须是数组")
            focus = []
        if len(focus) > 2:
            _issue(
                issues,
                "warning",
                "too-many-focuses",
                f"{label}.focus",
                "单段超过两个显式焦点，可能导致没有主次",
            )
        for focus_index, item in enumerate(focus):
            focus_label = f"{label}.focus[{focus_index}]"
            if not isinstance(item, dict):
                _issue(issues, "error", "invalid-focus-item", focus_label, "必须是对象")
                continue
            span = item.get("text")
            if not isinstance(span, str) or not span.strip() or span not in spoken_text:
                _issue(issues, "error", "focus-not-in-text", f"{focus_label}.text", "必须精确出现在 spoken_text 中")
            if item.get("strength") not in FOCUS_STRENGTHS:
                _issue(issues, "error", "invalid-focus-strength", f"{focus_label}.strength", "只支持 subtle, moderate, strong")
            if not str(item.get("reason", "")).strip():
                _issue(issues, "error", "missing-focus-reason", f"{focus_label}.reason", "必须说明为什么是焦点")

        boundary = segment.get("boundary")
        if not isinstance(boundary, dict):
            _issue(issues, "error", "invalid-boundary", f"{label}.boundary", "必须是对象")
            boundary = {}
        boundary_type = boundary.get("after")
        pause_ms = boundary.get("pause_after_ms")
        if boundary_type not in BOUNDARIES:
            _issue(issues, "error", "invalid-boundary-type", f"{label}.boundary.after", "边界类型无效")
        if isinstance(pause_ms, bool) or not isinstance(pause_ms, int):
            _issue(issues, "error", "invalid-pause", f"{label}.boundary.pause_after_ms", "必须是整数毫秒")
            pause_ms = 0
        if boundary_type in PAUSE_RANGES.get(profile, {}):
            lower, upper = PAUSE_RANGES[profile][boundary_type]
            if not lower <= pause_ms <= upper:
                _issue(
                    issues,
                    "error",
                    "pause-out-of-profile",
                    f"{label}.boundary.pause_after_ms",
                    f"{profile}/{boundary_type} 必须在 {lower}..{upper}ms",
                )
        if index == len(segments) and (boundary_type != "final" or pause_ms != 0):
            _issue(issues, "error", "invalid-final-boundary", f"{label}.boundary", "最后一段必须是 final/0ms")

        micro_breaks = segment.get("micro_breaks", [])
        if not isinstance(micro_breaks, list):
            _issue(issues, "error", "invalid-micro-breaks", f"{label}.micro_breaks", "必须是数组")
            micro_breaks = []
        for break_index, item in enumerate(micro_breaks):
            break_label = f"{label}.micro_breaks[{break_index}]"
            if not isinstance(item, dict):
                _issue(issues, "error", "invalid-micro-break", break_label, "必须是对象")
                continue
            anchor = item.get("after")
            if not isinstance(anchor, str) or spoken_text.count(anchor) != 1:
                _issue(issues, "error", "ambiguous-break-anchor", f"{break_label}.after", "必须在 spoken_text 中精确出现一次")
            pause = item.get("pause_ms")
            if isinstance(pause, bool) or not isinstance(pause, int) or not 10 <= pause <= 650:
                _issue(issues, "error", "invalid-micro-pause", f"{break_label}.pause_ms", "必须在 10..650ms")
            if not str(item.get("reason", "")).strip():
                _issue(issues, "error", "missing-break-reason", f"{break_label}.reason", "必须说明停顿的语义或表演理由")

        nonverbal = segment.get("nonverbal", [])
        if not isinstance(nonverbal, list):
            _issue(issues, "error", "invalid-nonverbal", f"{label}.nonverbal", "必须是数组")
            nonverbal = []
        if len(nonverbal) > 1:
            _issue(issues, "warning", "dense-nonverbal", f"{label}.nonverbal", "中文知识口播单段默认不应超过一个非言语声")
        for event_index, item in enumerate(nonverbal):
            event_label = f"{label}.nonverbal[{event_index}]"
            if not isinstance(item, dict):
                _issue(issues, "error", "invalid-nonverbal-item", event_label, "必须是对象")
                continue
            event_type = item.get("type")
            if event_type not in SOUND_TAGS:
                _issue(issues, "error", "unsupported-sound-tag", f"{event_label}.type", "不在 Speech 2.8 HTTP sound tag 列表中")
            if model not in SOUND_MODELS:
                _issue(issues, "error", "sound-tag-model-mismatch", event_label, "sound tag 只能用于 speech-2.8-hd/turbo")
            position = item.get("position")
            if position not in POSITIONS:
                _issue(issues, "error", "invalid-nonverbal-position", f"{event_label}.position", "位置无效")
            if position in {"before_anchor", "after_anchor"}:
                anchor = item.get("anchor")
                if not isinstance(anchor, str) or spoken_text.count(anchor) != 1:
                    _issue(issues, "error", "ambiguous-nonverbal-anchor", f"{event_label}.anchor", "必须在 spoken_text 中精确出现一次")
            if not str(item.get("reason", "")).strip():
                _issue(issues, "error", "missing-nonverbal-reason", f"{event_label}.reason", "非言语声必须有生理或表演理由")
            if position == "after" and isinstance(pause_ms, int) and pause_ms >= 420:
                _issue(issues, "warning", "stacked-sound-and-long-pause", event_label, "段尾声音事件与长停顿叠加，优先二选一")

        takes = segment.get("takes", 1)
        if isinstance(takes, bool) or not isinstance(takes, int) or not 1 <= takes <= 3:
            _issue(issues, "error", "invalid-takes", f"{label}.takes", "必须在 1..3")

        render = segment.get("render") or {}
        if not isinstance(render, dict):
            _issue(issues, "error", "invalid-render-override", f"{label}.render", "必须是对象")
        elif render:
            if not str(render.get("reason", "")).strip():
                _issue(issues, "error", "missing-render-reason", f"{label}.render.reason", "局部 API 参数偏离必须说明原因")
            for key, lower, upper in (
                ("speed", 0.5, 2.0),
                ("vol", 0.1, 10.0),
                ("pitch", -12, 12),
            ):
                if key not in render:
                    continue
                value = render[key]
                if (
                    isinstance(value, bool)
                    or not isinstance(value, (int, float))
                    or not lower <= float(value) <= upper
                ):
                    _issue(issues, "error", "invalid-render-value", f"{label}.render.{key}", f"必须在 {lower}..{upper}")
            if render.get("emotion"):
                _issue(
                    issues,
                    "warning",
                    "experimental-speech28-emotion",
                    f"{label}.render.emotion",
                    "Speech 2.8 的 HTTP schema 未明确公开 emotion 字段，仅可在 A/B 验证后保留",
                )

    approval = payload.get("approval")
    if not isinstance(approval, dict):
        approval = {}
        if status in APPROVED_STATUSES or require_approved:
            _issue(issues, "error", "missing-approval", "approval", "缺少审批记录")
    if status in APPROVED_STATUSES or require_approved:
        expected_hash = direction_sha256(direction_path, payload)
        if status not in APPROVED_STATUSES:
            _issue(issues, "error", "not-approved", "status", "云端生成前状态必须已批准")
        if approval.get("lint") != "passed":
            _issue(issues, "error", "lint-not-approved", "approval.lint", "必须为 passed")
        if approval.get("human") != "approved":
            _issue(issues, "error", "human-not-approved", "approval.human", "必须为 approved")
        review = approval.get("review") or {}
        if review.get("status") != "passed":
            _issue(issues, "error", "review-not-passed", "approval.review", "必须先完成独立审查")
        elif review.get("content_sha256") != expected_hash:
            _issue(
                issues,
                "error",
                "review-invalidated",
                "approval.review.content_sha256",
                "独立审查后的导演稿或绑定原稿已变更",
            )
        if approval.get("content_sha256") != expected_hash:
            _issue(
                issues,
                "error",
                "approval-invalidated",
                "approval.content_sha256",
                "导演稿或绑定原稿已变更，必须重新审批",
            )
    return issues


def error_count(issues: list[Issue]) -> int:
    return sum(issue.severity == "error" for issue in issues)


def warning_count(issues: list[Issue]) -> int:
    return sum(issue.severity == "warning" for issue in issues)


def insert_after_once(text: str, anchor: str, insertion: str) -> str:
    if text.count(anchor) != 1:
        raise ValueError(f"锚点必须精确出现一次：{anchor}")
    index = text.index(anchor) + len(anchor)
    return text[:index] + insertion + text[index:]


def insert_before_once(text: str, anchor: str, insertion: str) -> str:
    if text.count(anchor) != 1:
        raise ValueError(f"锚点必须精确出现一次：{anchor}")
    index = text.index(anchor)
    return text[:index] + insertion + text[index:]


def compile_segment_text(segment: dict[str, Any]) -> str:
    text = segment["spoken_text"].strip()
    for micro_break in segment.get("micro_breaks", []):
        seconds = micro_break["pause_ms"] / 1000
        marker = f"<#{seconds:.2f}#>"
        text = insert_after_once(text, micro_break["after"], marker)
    for event in segment.get("nonverbal", []):
        marker = f"({event['type']})"
        position = event["position"]
        if position == "before":
            text = marker + text
        elif position == "after":
            text = text + marker
        elif position == "before_anchor":
            text = insert_before_once(text, event["anchor"], marker)
        elif position == "after_anchor":
            text = insert_after_once(text, event["anchor"], marker)
    return text


def capability_summary(segment: dict[str, Any]) -> dict[str, list[str]]:
    native: list[str] = ["spoken_text", "boundary_pause"]
    approximate: list[str] = ["speech_act", "emotion", "rhythm", "intonation"]
    if segment.get("micro_breaks"):
        native.append("micro_breaks")
    if segment.get("nonverbal"):
        native.append("nonverbal")
    if segment.get("focus"):
        approximate.append("focus")
    return {"native": native, "approximate": approximate, "unsupported": []}
