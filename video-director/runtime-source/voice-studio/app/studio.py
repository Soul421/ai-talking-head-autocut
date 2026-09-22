#!/usr/bin/env python3
"""本地声音工作室：Qwen-TTS、BaoCut 验收与视频交接。路径与批准人来自 config / TTH_* 环境变量。"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import wave
import webbrowser
from datetime import datetime, timezone
from difflib import SequenceMatcher
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

try:
    from tth_config import load_config
except Exception:  # pragma: no cover - fallback when helper missing
    def load_config() -> dict[str, Any]:
        return {}

_TTH = load_config()

ROOT = Path(__file__).resolve().parents[1]
RUNS_DIR = ROOT / "runs"
INDEX_PATH = Path(__file__).with_name("index.html")

def _cfg_path(key: str, default: str = "") -> Path:
    raw = _TTH.get(key) or default
    return Path(raw).expanduser() if raw else Path("")

QWEN_PYTHON = _cfg_path("qwen_python") or Path(sys.executable)
QWEN_MODEL = _cfg_path("qwen_model")
REFERENCE_AUDIO = _cfg_path("reference_audio")
REFERENCE_TEXT = _TTH.get("reference_text") or (
    "大家好，今天想跟大家聊聊人工智能正在怎样改变我们的工作和生活。"
    "很多变化看起来很遥远。实际上，离我们却很近。"
    "面对新的技术，我们不必焦虑。更重要的是，理解它、使用它，并找到真正适合自己的方式。"
)
SPEAKER_NAME = _TTH.get("speaker_name") or "Speaker"
REVIEWER_NAME = _TTH.get("reviewer_name") or "Reviewer"
LEGACY_BAOCUT = _cfg_path("baocut_bin")
BAOCUT = Path(os.environ.get(
    "VOICE_STUDIO_BAOCUT",
    _TTH.get("baocut_bin") or str(Path.home() / ".local/share/voice-studio/baocut/1.1.4/bcut"),
))
TERMS_FILE = Path(_TTH.get("terms_file") or ROOT / "terms.txt")
if not TERMS_FILE.is_file():
    # optional glossary: missing file means empty dictionary, not a hard failure
    TERMS_FILE = Path(os.environ.get("TTH_TERMS", str(ROOT / "terms.txt")))
MINIMAX_HELPER = Path(__file__).with_name("minimax_generate.py")
SCHEMA_VERSION = 1


def load_terms() -> list[str]:
    if not TERMS_FILE.is_file():
        return []
    try:
        return [ln.strip() for ln in TERMS_FILE.read_text(encoding="utf-8").splitlines() if ln.strip() and not ln.startswith("#")]
    except Exception:
        return []


def transcribe_reference(audio: Path) -> str:
    """ASR the reference clip so ref_text always matches ref_audio.

    Voice-cloning TTS treats (ref_audio, ref_text) as one worked example.
    Mismatched transcript → loops/filler. Users should never hand-type this.
    """
    if not BAOCUT.exists() or not audio.is_file():
        return ""
    # copy into a scratch dir so we never touch a sibling .bcut next to the source
    scratch = Path(tempfile.mkdtemp(prefix="ref-asr-"))
    local_audio = scratch / audio.name
    shutil.copy2(audio, local_audio)
    result = subprocess.run(
        [str(BAOCUT), "--json", "transcribe", str(local_audio),
         "--model", "qwen3-asr-0.6b", "--source-lang", "zh", "--no-speakers", "--yes"],
        capture_output=True, text=True, cwd=str(scratch),
    )
    blob = (result.stdout or "") + "\n" + (result.stderr or "")
    if result.returncode != 0 and "transcript.json" not in blob:
        return ""
    try:
        payload = extract_json(blob)
        project = Path(payload.get("project") or "")
        if not project.is_absolute():
            project = scratch / project
        transcript = project / "transcript.json"
        if not transcript.is_file():
            # bcut may write alongside the media
            candidates = list(scratch.rglob("transcript.json"))
            if candidates:
                transcript = candidates[0]
            else:
                return ""
        words = json.loads(transcript.read_text(encoding="utf-8")).get("words") or []
        return "".join(w.get("text", "") for w in words).strip()
    except Exception:
        return ""


def resolve_ref_text(configured: str, audio: Path) -> str:
    """Prefer auto-ASR of the actual audio; fall back to configured text."""
    if not audio.is_file():
        return configured
    spoken = transcribe_reference(audio)
    if spoken and len(spoken) >= 8:
        return spoken
    return configured


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"不是 JSON 对象：{path}")
    return value


def extract_json(text: str) -> dict[str, Any]:
    """Parse BaoCut JSON even when native model loaders print before it."""
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < start:
        raise json.JSONDecodeError("没有找到 JSON 对象", text, 0)
    value = json.loads(text[start : end + 1])
    if not isinstance(value, dict):
        raise json.JSONDecodeError("JSON 不是对象", text, start)
    return value


def run(command: list[str], timeout: int = 1800) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, text=True, capture_output=True, timeout=timeout, check=False)


def audio_info(path: Path) -> dict[str, Any]:
    with wave.open(str(path), "rb") as source:
        frames = source.getnframes()
        rate = source.getframerate()
        return {
            "duration_seconds": round(frames / rate, 3),
            "sample_rate": rate,
            "channels": source.getnchannels(),
            "sample_width_bytes": source.getsampwidth(),
        }


def normalize_text(text: str) -> str:
    return "".join(re.findall(r"[\u3400-\u9fffA-Za-z0-9]", text)).lower()


def srt_text(path: Path) -> str:
    lines = []
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        value = line.strip()
        if not value or value.isdigit() or "-->" in value:
            continue
        lines.append(value)
    return "".join(lines)


def safe_job_id(value: str) -> str:
    if not re.fullmatch(r"[0-9]{8}-[0-9]{6}-[a-f0-9]{6}", value):
        raise ValueError("无效任务编号")
    return value


class VoiceStudio:
    def __init__(self, runs_dir: Path = RUNS_DIR):
        self.runs_dir = runs_dir
        self.runs_dir.mkdir(parents=True, exist_ok=True)

    def status(self) -> dict[str, Any]:
        local_ready = all(
            item.exists() for item in (QWEN_PYTHON, QWEN_MODEL, REFERENCE_AUDIO, BAOCUT)
        )
        return {
            "studio": "本地声音工作室",
            "schema_version": SCHEMA_VERSION,
            "default_engine": "qwen-local",
            "local_ready": local_ready,
            "qwen_model": str(QWEN_MODEL),
            "reference_audio": str(REFERENCE_AUDIO),
            "baocut_ready": BAOCUT.exists(),
            "minimax_ready": bool(os.environ.get("MINIMAX_API_KEY") and os.environ.get("MINIMAX_VOICE_ID")),
            "minimax_policy": "仅在明确选择并确认云端上传与费用后启用；绝不自动回退",
        }

    def list_runs(self) -> list[dict[str, Any]]:
        rows = []
        for path in sorted(self.runs_dir.glob("*/manifest.json"), reverse=True):
            try:
                manifest = load_json(path)
            except (OSError, ValueError, json.JSONDecodeError):
                continue
            rows.append(
                {
                    "job_id": manifest.get("job_id"),
                    "created_at": manifest.get("created_at"),
                    "engine": manifest.get("engine"),
                    "text": manifest.get("text"),
                    "qa_status": manifest.get("qa", {}).get("status", "pending"),
                    "approved": manifest.get("approval", {}).get("status") == "approved",
                    "rhythm_approved": manifest.get("approval", {}).get("rhythm_review", {}).get("status") == "approved",
                    "handoff_ready": manifest.get("handoff", {}).get("status") == "ready",
                }
            )
        return rows

    def _new_job(self) -> tuple[str, Path]:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        suffix = hashlib.sha256(f"{time.time_ns()}".encode()).hexdigest()[:6]
        job_id = f"{stamp}-{suffix}"
        job_dir = self.runs_dir / job_id
        job_dir.mkdir(parents=True, exist_ok=False)
        return job_id, job_dir

    def _job(self, job_id: str) -> tuple[Path, dict[str, Any]]:
        job_dir = self.runs_dir / safe_job_id(job_id)
        manifest_path = job_dir / "manifest.json"
        if not manifest_path.is_file():
            raise FileNotFoundError("任务不存在")
        return job_dir, load_json(manifest_path)

    def delete(self, job_id: str) -> dict[str, Any]:
        job_id = safe_job_id(job_id)
        job_dir = self.runs_dir / job_id
        if job_dir.is_symlink() or job_dir.resolve().parent != self.runs_dir.resolve():
            raise PermissionError("不允许删除工作室目录之外的文件")
        if not job_dir.is_dir():
            raise FileNotFoundError("任务不存在或已删除")
        # Only remove files owned by this run, never paths referenced by its manifest.
        shutil.rmtree(job_dir)
        return {"job_id": job_id, "deleted": True}

    def generate(self, text: str, speed: float = 1.0, engine: str = "qwen-local", confirm_cloud: bool = False) -> dict[str, Any]:
        text = text.strip()
        if not text:
            raise ValueError("配音文字不能为空")
        if not 0.7 <= speed <= 1.3:
            raise ValueError("语速必须在 0.7 到 1.3 之间")
        if engine not in {"qwen-local", "minimax-api"}:
            raise ValueError("不支持的声音引擎")
        if engine == "minimax-api" and not confirm_cloud:
            raise PermissionError("MiniMax 会上传文字并产生费用，必须明确勾选云端确认")
        if engine == "minimax-api" and not self.status()["minimax_ready"]:
            raise RuntimeError("MiniMax 备用未开通：需要 MINIMAX_API_KEY 和 MINIMAX_VOICE_ID")
        if engine == "qwen-local" and not self.status()["local_ready"]:
            raise RuntimeError("本地声音环境不完整，请先运行状态检查")

        job_id, job_dir = self._new_job()
        ref_text = REFERENCE_TEXT
        ref_text_source = "config"
        request = {
            "schema_version": SCHEMA_VERSION,
            "job_id": job_id,
            "created_at": now_iso(),
            "engine": engine,
            "text": text,
            "speed": speed,
            "cloud_confirmed": bool(confirm_cloud),
        }
        atomic_json(job_dir / "request.json", request)

        started = time.monotonic()
        if engine == "qwen-local":
            # ref_text MUST match ref_audio content; always re-derive from ASR
            # so callers never need a hand-typed "exact" transcript.
            ref_text = resolve_ref_text(REFERENCE_TEXT, REFERENCE_AUDIO)
            if ref_text != REFERENCE_TEXT:
                ref_text_source = "baocut-asr"
            command = [
                str(QWEN_PYTHON), "-m", "mlx_audio.tts.generate",
                "--model", str(QWEN_MODEL), "--text", text,
                "--ref_audio", str(REFERENCE_AUDIO), "--ref_text", ref_text,
                "--lang_code", "zh", "--repetition_penalty", "1.2", "--max_tokens", "2048",
                "--speed", str(speed), "--output_path", str(job_dir),
                "--file_prefix", "voice", "--audio_format", "wav",
            ]
        else:
            command = [sys.executable, str(MINIMAX_HELPER), str(job_dir / "request.json"), str(job_dir / "voice.wav")]
        result = run(command)
        (job_dir / "generation.log").write_text(
            (result.stdout or "") + ("\nSTDERR\n" + result.stderr if result.stderr else ""),
            encoding="utf-8",
        )
        if result.returncode != 0:
            raise RuntimeError(f"配音生成失败，详情见 {job_dir / 'generation.log'}")

        output = job_dir / "voice.wav"
        if engine == "qwen-local":
            candidates = sorted(job_dir.glob("voice_*.wav"))
            if not candidates:
                raise RuntimeError("Qwen3-TTS 没有生成 WAV 文件")
            candidates[0].replace(output)
        if not output.is_file():
            raise RuntimeError("没有找到生成后的 voice.wav")

        manifest = {
            **request,
            "generation_seconds": round(time.monotonic() - started, 3),
            "audio": {"path": str(output), "sha256": sha256(output), **audio_info(output)},
            "reference": {
                "path": str(REFERENCE_AUDIO),
                "sha256": sha256(REFERENCE_AUDIO),
                "text": ref_text,
                "text_source": ref_text_source,
            },
            "model": {
                "path": str(QWEN_MODEL) if engine == "qwen-local" else "MiniMax API",
                "config_sha256": sha256(QWEN_MODEL / "config.json") if engine == "qwen-local" else None,
            },
            "qa": {"status": "pending"},
            "approval": {"status": "pending"},
            "handoff": {"status": "blocked", "reason": "等待 BaoCut 验收和人工批准"},
        }
        atomic_json(job_dir / "manifest.json", manifest)
        # freeze the artifact so preview players cannot rewrite it after hashing
        try:
            os.chmod(output, 0o444)
        except OSError:
            pass
        return manifest

    def qa(self, job_id: str) -> dict[str, Any]:
        job_dir, manifest = self._job(job_id)
        audio = Path(manifest["audio"]["path"])
        if sha256(audio) != manifest["audio"]["sha256"]:
            raise PermissionError("音频已被修改，请重新生成和验收")
        # Revalidation must revoke the old approval even if a CLI step fails.
        manifest["qa"] = {"status": "pending"}
        manifest["approval"] = {"status": "pending"}
        manifest["handoff"] = {"status": "blocked", "reason": "正在重新验收"}
        atomic_json(job_dir / "manifest.json", manifest)
        for name in ("approval.json", "video-handoff.json"):
            (job_dir / name).unlink(missing_ok=True)
        version = run([str(BAOCUT), "--json", "version"])
        if version.returncode == 0:
            info = extract_json(version.stdout)
            if not str(info.get("appVersion", "")).startswith("1."):
                raise RuntimeError("尚未适配此 BaoCut 版本")
            project_id, audit = self._qa_v1(job_dir, audio)
        else:
            legacy_version = run([str(BAOCUT), "--version"])
            if legacy_version.returncode != 0 or not legacy_version.stdout.startswith("baocut 0.2."):
                raise RuntimeError("无法确认 BaoCut 版本；未自动切换或重跑")
            project_id, audit = self._qa_legacy(job_id, job_dir, audio)

        recognized = srt_text(job_dir / "captions.srt")
        similarity = SequenceMatcher(None, normalize_text(manifest["text"]), normalize_text(recognized)).ratio()
        qa_pass = audit.get("status") == "PASS" and similarity >= 0.80
        manifest["qa"] = {
            "status": "pass" if qa_pass else "needs_review",
            "checked_at": now_iso(),
            "baocut_project_id": str(project_id),
            "baocut_model": "qwen3-asr-0.6b",
            "audit_status": audit.get("status"),
            "text_similarity": round(similarity, 4),
            "recognized_text": recognized,
            "captions_srt": str(job_dir / "captions.srt"),
            "captions_vtt": str(job_dir / "captions.vtt"),
        }
        manifest["approval"] = {"status": "pending"}
        manifest["handoff"] = {"status": "blocked", "reason": "等待人工听审批准"}
        atomic_json(job_dir / "manifest.json", manifest)
        return manifest

    def _qa_legacy(self, job_id: str, job_dir: Path, audio: Path):
        command = [
            str(BAOCUT), "--json", "transcribe", str(audio),
            "--model", "qwen3-asr-0.6b", "--source-lang", "zh", "--no-speakers",
            "--terms-file", str(TERMS_FILE),
            "--title", f"声音工作室 {job_id}",
            "--desc", "本地 Qwen3-TTS 或明确授权的 MiniMax 备用配音；用于内容完整性与字幕时间轴验收。",
        ]
        result = run(command)
        (job_dir / "baocut-transcribe.log").write_text((result.stdout or "") + (result.stderr or ""), encoding="utf-8")
        if result.returncode != 0:
            raise RuntimeError(f"BaoCut 转写失败，详情见 {job_dir / 'baocut-transcribe.log'}")
        try:
            response = extract_json(result.stdout)
        except json.JSONDecodeError as error:
            raise RuntimeError("BaoCut 没有返回有效 JSON") from error
        project_id = response.get("projectId") or response.get("id")
        if not project_id:
            raise RuntimeError("BaoCut 没有返回 projectId")

        terms_result = run([str(BAOCUT), "--json", "terms", "fix", str(project_id), "--map-file", str(TERMS_FILE)])
        (job_dir / "baocut-terms.log").write_text(
            (terms_result.stdout or "") + (terms_result.stderr or ""), encoding="utf-8"
        )
        if terms_result.returncode != 0:
            raise RuntimeError("BaoCut 专名修复失败")

        audit_result = run([str(BAOCUT), "--json", "audit", str(project_id)])
        audit = extract_json(audit_result.stdout) if audit_result.stdout.strip() else {"status": "ERROR"}
        if audit_result.returncode != 0:
            audit["status"] = "FAIL"
        atomic_json(job_dir / "baocut-audit.json", audit)
        for flag, filename in (("--srt", "captions.srt"), ("--vtt", "captions.vtt")):
            exported = run([str(BAOCUT), "export", str(project_id), flag, "-o", str(job_dir / filename)])
            if exported.returncode != 0:
                raise RuntimeError(f"BaoCut 导出 {flag} 失败")
        transcript = run([
            str(BAOCUT), "export", str(project_id), "--markdown", "--no-speakers",
            "--no-timestamps", "--no-chapters", "-o", str(job_dir / "transcript.md"),
        ])
        if transcript.returncode != 0:
            raise RuntimeError("BaoCut 导出逐字稿失败")

        return str(project_id), audit

    def _qa_v1(self, job_dir: Path, audio: Path):
        attempt = Path(tempfile.mkdtemp(prefix="baocut-", dir=job_dir))
        project = attempt / "voice.bcut"

        def invoke(args, label, allowed=(0,)):
            result = run([str(BAOCUT), *args, "--json"])
            (attempt / f"{label}.log").write_text(
                (result.stdout or "") + (result.stderr or ""), encoding="utf-8"
            )
            if result.returncode not in allowed:
                raise RuntimeError(f"BaoCut {label} 失败，详情见 {attempt}")
            payload = extract_json(result.stdout)
            if payload.get("status") != "ok":
                raise RuntimeError(f"BaoCut {label} 返回失败状态，详情见 {attempt}")
            return payload, result.returncode

        response, _ = invoke([
            "transcribe", str(audio), "--project", str(project),
            "--model", "qwen3-asr-0.6b", "--source-lang", "zh",
            "--no-speakers", "--offline",
        ], "transcribe")
        if response.get("project") != str(project) or not project.is_dir():
            raise RuntimeError("BaoCut 没有返回预期的新项目路径")
        # CLI replacement preserves word timing; never edit transcript JSON directly.
        for index, line in enumerate(load_terms()):
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            canonical, variants = line.split("=", 1)
            for part, variant in enumerate(variants.split("|")):
                if variant.strip() and variant.strip() != canonical.strip():
                    invoke(["transcript", "replace", str(project), variant.strip(),
                            canonical.strip(), "--scope", "text"], f"terms-{index}-{part}")
        reports = {}
        passed = True
        for target in ("srt", "vtt"):
            report, code = invoke(["check", str(project), "--strict", "--for", target],
                                  f"check-{target}", allowed=(0, 2))
            reports[target] = report
            passed = passed and code == 0 and report.get("data", {}).get("ready") is True
        audit = {"status": "PASS" if passed else "FAIL", "backend": "bcut-v1", "reports": reports}
        atomic_json(attempt / "audit.json", audit)
        for target, name in (("srt", "captions.srt"), ("vtt", "captions.vtt"),
                             ("markdown", "transcript.md")):
            args = ["export", str(project), "--to", target, "--mode", "original",
                    "--no-speakers", "-o", str(attempt / name)]
            if target == "markdown":
                args += ["--no-timestamps", "--no-chapters"]
            invoke(args, f"export-{target}")
            if not (attempt / name).is_file() or not (attempt / name).stat().st_size:
                raise RuntimeError(f"BaoCut 没有生成有效的 {name}")
        for name in ("captions.srt", "captions.vtt", "transcript.md"):
            shutil.copy2(attempt / name, job_dir / name)
        atomic_json(job_dir / "baocut-audit.json", audit)
        return str(project), audit

    def approve(self, job_id: str, approved_by: str = "", rhythm_reviewed: bool = False) -> dict[str, Any]:
        job_dir, manifest = self._job(job_id)
        if manifest.get("qa", {}).get("status") != "pass":
            raise PermissionError("BaoCut 验收尚未通过，不能批准")
        audio = Path(manifest["audio"]["path"])
        if sha256(audio) != manifest["audio"]["sha256"]:
            raise PermissionError("音频已被修改，请重新生成和验收")
        if rhythm_reviewed is not True:
            raise PermissionError("请先听审读音、停顿、重音、语速和结尾，再确认节奏听审通过")
        approval = {
            "review_version": 2,
            "rhythm_review": {"status": "approved", "items": ["读音", "停顿", "重音", "语速", "结尾"]},
            "status": "approved",
            "approved_at": now_iso(),
            "approved_by": (approved_by or "").strip() or REVIEWER_NAME,
            "audio_sha256": sha256(audio),
            "text_sha256": hashlib.sha256(manifest["text"].encode("utf-8")).hexdigest(),
        }
        manifest["approval"] = approval
        manifest["handoff"] = {"status": "blocked", "reason": "已批准，尚未生成视频交接单"}
        atomic_json(job_dir / "approval.json", approval)
        atomic_json(job_dir / "manifest.json", manifest)
        return manifest

    def handoff(self, job_id: str) -> dict[str, Any]:
        job_dir, manifest = self._job(job_id)
        if manifest.get("qa", {}).get("status") != "pass":
            raise PermissionError("当前验收未通过，不能交接")
        approval = manifest.get("approval", {})
        audio = Path(manifest["audio"]["path"])
        if approval.get("status") != "approved" or approval.get("audio_sha256") != sha256(audio):
            raise PermissionError("只有 hash 匹配的人工批准音频才能交给视频流程")
        if approval.get("rhythm_review", {}).get("status") != "approved":
            raise PermissionError("旧版声音批准未包含节奏听审；请补审读音、停顿、重音、语速和结尾")
        if approval.get("text_sha256") != hashlib.sha256(manifest["text"].encode("utf-8")).hexdigest():
            raise PermissionError("正文已变化，请重新验收并听审")
        handoff = {
            "schema_version": SCHEMA_VERSION,
            "status": "ready",
            "created_at": now_iso(),
            "job_id": job_id,
            "next_skill": "video-script",
            "preferred_renderer": "hyperframes",
            "production_preset": str(Path(__file__).resolve().parents[1] / "presets/avatar-composition-v1.json"),
            "export_review_required": True,
            "locked_text": manifest["text"],
            "locked_audio": str(audio),
            "audio_sha256": sha256(audio),
            "captions_srt": manifest["qa"]["captions_srt"],
            "captions_vtt": manifest["qa"]["captions_vtt"],
            "baocut_project_id": manifest["qa"]["baocut_project_id"],
            "engine": manifest["engine"],
            "model": manifest["model"],
            "reference": manifest["reference"],
            "approval": approval,
            "rule": "video-script、数字人、HyperFrames 和最终剪辑必须引用本音频及其 hash。",
        }
        manifest["handoff"] = handoff
        atomic_json(job_dir / "video-handoff.json", handoff)
        atomic_json(job_dir / "manifest.json", manifest)
        return handoff


class Handler(BaseHTTPRequestHandler):
    studio = VoiceStudio()
    mutation_lock = threading.Lock()

    def log_message(self, format: str, *args: Any) -> None:
        return

    def send_json(self, payload: Any, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        try:
            if parsed.path == "/":
                body = INDEX_PATH.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            elif parsed.path == "/api/status":
                self.send_json(self.studio.status())
            elif parsed.path == "/api/runs":
                self.send_json(self.studio.list_runs())
            elif parsed.path == "/media":
                query = urllib.parse.parse_qs(parsed.query)
                job_id = safe_job_id(query.get("job", [""])[0])
                name = query.get("name", [""])[0]
                if name not in {"voice.wav", "captions.srt", "captions.vtt", "transcript.md", "video-handoff.json"}:
                    raise ValueError("不允许读取这个文件")
                target = self.studio.runs_dir / job_id / name
                body = target.read_bytes()
                content_type = "audio/wav" if name.endswith(".wav") else "text/plain; charset=utf-8"
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                self.send_json({"error": "not found"}, 404)
        except Exception as error:
            self.send_json({"error": str(error)}, 400)

    def do_POST(self) -> None:
        if not self.mutation_lock.acquire(blocking=False):
            self.send_json({"error": "工作室正在处理其他操作，请完成后再试"}, HTTPStatus.CONFLICT)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            data = json.loads(self.rfile.read(length) or b"{}")
            if self.path == "/api/generate":
                result = self.studio.generate(
                    data.get("text", ""), float(data.get("speed", 1.0)),
                    data.get("engine", "qwen-local"), bool(data.get("confirm_cloud", False)),
                )
            elif self.path == "/api/delete":
                result = self.studio.delete(data.get("job_id", ""))
            elif self.path == "/api/qa":
                result = self.studio.qa(data.get("job_id", ""))
            elif self.path == "/api/approve":
                result = self.studio.approve(data.get("job_id", ""), data.get("approved_by", ""), data.get("rhythm_reviewed", False))
            elif self.path == "/api/handoff":
                result = self.studio.handoff(data.get("job_id", ""))
            else:
                self.send_json({"error": "not found"}, 404)
                return
            self.send_json(result)
        except PermissionError as error:
            self.send_json({"error": str(error)}, HTTPStatus.FORBIDDEN)
        except Exception as error:
            self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)

        finally:
            self.mutation_lock.release()


def serve(host: str, port: int, open_browser: bool) -> None:
    Handler.studio = VoiceStudio()
    server = ThreadingHTTPServer((host, port), Handler)
    url = f"http://{host}:{port}"
    print(f"本地声音工作室已启动：{url}")
    if open_browser:
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n声音工作室已关闭。")
    finally:
        server.server_close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    server_parser = sub.add_parser("serve")
    server_parser.add_argument("--host", default="127.0.0.1")
    server_parser.add_argument("--port", type=int, default=8765)
    server_parser.add_argument("--no-open", action="store_true")
    sub.add_parser("status")
    sub.add_parser("list")
    generate_parser = sub.add_parser("generate")
    generate_parser.add_argument("--text", required=True)
    generate_parser.add_argument("--speed", type=float, default=1.0)
    generate_parser.add_argument("--engine", choices=("qwen-local", "minimax-api"), default="qwen-local")
    generate_parser.add_argument("--confirm-cloud", action="store_true")
    for name in ("qa", "handoff"):
        action = sub.add_parser(name)
        action.add_argument("job_id")
    approve_parser = sub.add_parser("approve")
    approve_parser.add_argument("job_id")
    approve_parser.add_argument("--by", default=REVIEWER_NAME)
    approve_parser.add_argument("--rhythm-reviewed", action="store_true", help="本人已听审读音、停顿、重音、语速及结尾并通过")
    args = parser.parse_args()
    studio = VoiceStudio()
    if args.command == "serve":
        serve(args.host, args.port, not args.no_open)
        return 0
    if args.command == "status":
        output = studio.status()
    elif args.command == "list":
        output = studio.list_runs()
    elif args.command == "generate":
        output = studio.generate(args.text, args.speed, args.engine, args.confirm_cloud)
    elif args.command == "qa":
        output = studio.qa(args.job_id)
    elif args.command == "approve":
        output = studio.approve(args.job_id, args.by, args.rhythm_reviewed)
    else:
        output = studio.handoff(args.job_id)
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
