from __future__ import annotations

import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path
from unittest import mock

import yaml


SKILL_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = SKILL_ROOT / "scripts"
ASSETS = SKILL_ROOT / "assets"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(ASSETS))

from direction_contract import (  # noqa: E402
    direction_sha256,
    file_sha256,
    load_direction,
    validate_direction,
    write_direction,
)
import minimax_tts  # noqa: E402
import finalize_voice  # noqa: E402
import publish_voice  # noqa: E402


class VoiceDirectorIntegrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.tts_dir = self.root / "work" / "tts"
        self.source_dir = self.root / "work" / "source"
        self.tts_dir.mkdir(parents=True)
        self.source_dir.mkdir(parents=True)
        self.source = self.source_dir / "script.md"
        self.source.write_text("测试原稿\n", encoding="utf-8")
        self.direction = self.tts_dir / "voice-direction.yaml"
        shutil.copy2(ASSETS / "voice-direction.template.yaml", self.direction)
        self.env = os.environ.copy()
        self.env["PYTHONDONTWRITEBYTECODE"] = "1"

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def run_script(self, script: str, *args: object) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPTS / script), *(str(arg) for arg in args)],
            text=True,
            capture_output=True,
            env=self.env,
        )

    def compile(self) -> tuple[Path, Path]:
        manifest = self.tts_dir / "minimax-render.jsonl"
        meta = self.tts_dir / "minimax-render.meta.json"
        result = self.run_script(
            "compile_direction.py",
            self.direction,
            "--manifest",
            manifest,
            "--meta",
            meta,
            "--review",
            self.tts_dir / "voice-direction-review.md",
            "--lint-report",
            self.tts_dir / "direction-lint.json",
            "--subtitle-source",
            self.tts_dir / "subtitle-source.txt",
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return manifest, meta

    def approve(self) -> None:
        reviewed = self.run_script(
            "mark_reviewed.py",
            self.direction,
            "--reviewed-by",
            "test-reviewer",
        )
        self.assertEqual(reviewed.returncode, 0, reviewed.stdout + reviewed.stderr)
        result = self.run_script(
            "approve_direction.py",
            self.direction,
            "--approved-by",
            "test-user",
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def write_tone(self, path: Path, frequency: float) -> None:
        sample_rate = 32000
        edge_frames = round(sample_rate * 0.08)
        tone_frames = round(sample_rate * 0.42)
        samples = [0] * edge_frames
        samples.extend(
            round(9000 * math.sin(2 * math.pi * frequency * i / sample_rate))
            for i in range(tone_frames)
        )
        samples.extend([0] * edge_frames)
        path.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(path), "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(sample_rate)
            handle.writeframes(b"".join(struct.pack("<h", value) for value in samples))

    def test_approval_gate_compilation_and_source_invalidation(self) -> None:
        manifest, meta = self.compile()
        self.assertFalse(json.loads(meta.read_text(encoding="utf-8"))["render_allowed"])
        rows = [json.loads(line) for line in manifest.read_text(encoding="utf-8").splitlines()]
        self.assertIn("<#0.16#>", rows[1]["text"])
        self.assertNotIn("<#", rows[1]["subtitle_text"])

        before_approval = self.run_script(
            "render_segments.py",
            "--direction",
            self.direction,
            "--manifest",
            manifest,
            "--meta",
            meta,
            "--output-dir",
            self.root / "candidates",
            "--results",
            self.root / "results.json",
            "--selection",
            self.root / "selection.yaml",
            "--dry-run",
        )
        self.assertNotEqual(before_approval.returncode, 0)

        skipped_review = self.run_script(
            "approve_direction.py",
            self.direction,
            "--approved-by",
            "test-user",
        )
        self.assertNotEqual(skipped_review.returncode, 0)
        self.assertIn("独立审查", skipped_review.stdout)

        self.approve()
        manifest, meta = self.compile()
        self.assertTrue(json.loads(meta.read_text(encoding="utf-8"))["render_allowed"])
        dry_run = self.run_script(
            "render_segments.py",
            "--direction",
            self.direction,
            "--manifest",
            manifest,
            "--meta",
            meta,
            "--output-dir",
            self.root / "candidates",
            "--results",
            self.root / "results.json",
            "--selection",
            self.root / "selection.yaml",
            "--dry-run",
        )
        self.assertEqual(dry_run.returncode, 0, dry_run.stdout + dry_run.stderr)

        manifest.write_text(
            manifest.read_text(encoding="utf-8").replace("很多人以为", "文件被改过"),
            encoding="utf-8",
        )
        tampered_manifest = self.run_script(
            "render_segments.py",
            "--direction",
            self.direction,
            "--manifest",
            manifest,
            "--meta",
            meta,
            "--output-dir",
            self.root / "candidates",
            "--results",
            self.root / "results.json",
            "--selection",
            self.root / "selection.yaml",
            "--dry-run",
        )
        self.assertNotEqual(tampered_manifest.returncode, 0)
        self.assertIn("manifest", tampered_manifest.stderr)

        self.source.write_text("审批后修改的原稿\n", encoding="utf-8")
        invalid = self.run_script(
            "validate_direction.py", self.direction, "--require-approved"
        )
        self.assertNotEqual(invalid.returncode, 0)
        self.assertIn("approval-invalidated", invalid.stdout)

    def test_model_capability_validation(self) -> None:
        payload = load_direction(self.direction)
        payload["model"] = "speech-2.6-hd"
        payload["segments"][0]["nonverbal"] = [
            {
                "type": "breath",
                "position": "before",
                "reason": "测试模型能力边界",
            }
        ]
        issues = validate_direction(self.direction, payload)
        self.assertIn("sound-tag-model-mismatch", {issue.code for issue in issues})

    def test_offline_take_finalize_approve_publish_and_subtitle_binding(self) -> None:
        self.approve()
        manifest, meta = self.compile()
        payload = load_direction(self.direction)
        digest = direction_sha256(self.direction, payload)

        candidates = self.root / "candidates"
        first = candidates / "0001-take01.wav"
        second = candidates / "0002-take01.wav"
        self.write_tone(first, 220)
        self.write_tone(second, 330)
        results = {
            "version": 1,
            "direction_sha256": digest,
            "model": "speech-2.8-hd",
            "segments": {
                "s001": {
                    "index": 1,
                    "subtitle_text": "第一段",
                    "takes": [
                        {
                            "take": 1,
                            "path": str(first),
                            "success": True,
                            "sha256": file_sha256(first),
                        }
                    ],
                },
                "s002": {
                    "index": 2,
                    "subtitle_text": "第二段",
                    "takes": [
                        {
                            "take": 1,
                            "path": str(second),
                            "success": True,
                            "sha256": file_sha256(second),
                        }
                    ],
                },
            },
        }
        results_path = self.root / "render-results.json"
        results_path.write_text(json.dumps(results, ensure_ascii=False), encoding="utf-8")
        selection_path = self.root / "take-selection.yaml"
        selection_path.write_text(
            yaml.safe_dump(
                {
                    "version": 1,
                    "direction_sha256": digest,
                    "selections": {"s001": 1, "s002": 1},
                },
                allow_unicode=True,
                sort_keys=False,
            ),
            encoding="utf-8",
        )
        selected = self.root / "selected"
        selected_result = self.run_script(
            "select_takes.py",
            "--results",
            results_path,
            "--selection",
            selection_path,
            "--output-dir",
            selected,
        )
        self.assertEqual(
            selected_result.returncode, 0, selected_result.stdout + selected_result.stderr
        )

        payload["status"] = "rendered"
        write_direction(self.direction, payload)
        final_dir = self.root / "final"
        finalized = self.run_script(
            "finalize_voice.py",
            "--direction",
            self.direction,
            "--manifest",
            manifest,
            "--meta",
            meta,
            "--selected-dir",
            selected,
            "--output-dir",
            final_dir,
        )
        self.assertEqual(finalized.returncode, 0, finalized.stdout + finalized.stderr)
        final_audio = final_dir / "voice.wav"
        self.assertTrue(final_audio.is_file())

        approved = self.run_script(
            "approve_audio.py",
            "--direction",
            self.direction,
            "--audio",
            final_audio,
            "--approved-by",
            "test-user",
        )
        self.assertEqual(approved.returncode, 0, approved.stdout + approved.stderr)

        public_audio = self.root / "public" / "assets" / "audio"
        published = self.run_script(
            "publish_voice.py",
            "--direction",
            self.direction,
            "--audio",
            final_audio,
            "--project-root",
            self.root,
            "--output-dir",
            public_audio,
        )
        self.assertEqual(published.returncode, 0, published.stdout + published.stderr)
        self.assertTrue((public_audio / "voice.m4a").is_file())

        captions = self.root / "captions"
        captions.mkdir()
        srt = captions / "captions.srt"
        vtt = captions / "captions.vtt"
        aligned = captions / "captions_aligned.json"
        srt.write_text("1\n00:00:00,000 --> 00:00:00,500\n测试\n", encoding="utf-8")
        vtt.write_text("WEBVTT\n", encoding="utf-8")
        aligned.write_text("[]\n", encoding="utf-8")
        marked = self.run_script(
            "mark_subtitled.py",
            "--direction",
            self.direction,
            "--audio",
            final_audio,
            "--srt",
            srt,
            "--vtt",
            vtt,
            "--aligned-json",
            aligned,
        )
        self.assertEqual(marked.returncode, 0, marked.stdout + marked.stderr)
        self.assertEqual(load_direction(self.direction)["status"], "subtitled")


class SelectionReportIntegrityTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.selected = self.root / "selected"
        self.selected.mkdir()
        self.manifest = [
            {"id": "s001", "index": 1},
            {"id": "s002", "index": 2},
        ]
        self.files = []
        for index in (1, 2):
            path = self.selected / f"{index:04d}.wav"
            path.write_bytes(f"segment-{index}".encode())
            self.files.append(path)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def item(self, segment_id: str, index: int) -> dict:
        path = self.selected / f"{index:04d}.wav"
        return {
            "id": segment_id,
            "index": index,
            "selected": str(path),
            "sha256": file_sha256(path),
        }

    def validate(self, segments: list[dict]) -> None:
        finalize_voice.validate_selection_report(
            {"segments": segments},
            manifest=self.manifest,
            selected_dir=self.selected,
        )

    def test_rejects_empty_and_partial_reports(self) -> None:
        for segments in ([], [self.item("s001", 1)]):
            with self.subTest(count=len(segments)), self.assertRaises(ValueError):
                self.validate(segments)

    def test_rejects_duplicate_report_segments(self) -> None:
        duplicate = self.item("s001", 1)
        with self.assertRaisesRegex(ValueError, "重复"):
            self.validate([duplicate, duplicate.copy()])

    def test_rejects_id_index_path_and_hash_mismatches(self) -> None:
        valid_first = self.item("s001", 1)
        valid_second = self.item("s002", 2)
        mismatch_cases = {
            "id-index": {**valid_second, "index": 1},
            "path": {**valid_second, "selected": str(self.files[0])},
            "hash": {**valid_second, "sha256": "0" * 64},
            "extra": {
                "id": "s999",
                "index": 999,
                "selected": str(self.files[1]),
                "sha256": file_sha256(self.files[1]),
            },
        }
        for name, mismatch in mismatch_cases.items():
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.validate([valid_first, mismatch])


class PublishVoiceIntegrityTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.project = self.root / "project"
        self.project.mkdir()
        self.audio = self.root / "approved.wav"
        self.audio.write_bytes(b"new approved audio")
        self.direction = self.root / "direction.yaml"
        self.direction.write_text("test: true\n", encoding="utf-8")
        self.digest = "direction-digest"
        self.payload = {
            "status": "audio_approved",
            "approval": {
                "audio": {
                    "status": "approved",
                    "direction_sha256": self.digest,
                    "sha256": file_sha256(self.audio),
                }
            },
        }

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def invoke(self, output_dir: Path) -> int:
        with mock.patch.object(publish_voice, "load_direction", return_value=self.payload), mock.patch.object(
            publish_voice, "direction_sha256", return_value=self.digest
        ):
            return publish_voice.main(
                [
                    "--direction",
                    str(self.direction),
                    "--audio",
                    str(self.audio),
                    "--project-root",
                    str(self.project),
                    "--output-dir",
                    str(output_dir),
                ]
            )

    @staticmethod
    def fake_conversion(source: Path, target: Path, codec_args: list[str]) -> None:
        del codec_args
        publish_voice.copy_exclusive(source, target)

    def test_rejects_symlinked_output_component_without_touching_external_sentinel(self) -> None:
        external = self.root / "external"
        external.mkdir()
        sentinel = external / "sentinel.txt"
        sentinel.write_text("keep", encoding="utf-8")
        (self.project / "public").symlink_to(external, target_is_directory=True)

        with mock.patch.object(publish_voice, "run_ffmpeg") as convert, self.assertRaisesRegex(
            ValueError, "符号链接"
        ):
            self.invoke(self.project / "public" / "audio")

        convert.assert_not_called()
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep")
        self.assertFalse((external / "audio").exists())

    def test_rejects_symlinked_voice_target_without_touching_external_sentinel(self) -> None:
        output = self.project / "public" / "audio"
        output.mkdir(parents=True)
        sentinel = self.root / "sentinel.wav"
        sentinel.write_bytes(b"keep")
        (output / "voice.wav").symlink_to(sentinel)

        with mock.patch.object(publish_voice, "run_ffmpeg") as convert, self.assertRaisesRegex(
            ValueError, "普通文件"
        ):
            self.invoke(output)

        convert.assert_not_called()
        self.assertEqual(sentinel.read_bytes(), b"keep")
        self.assertTrue((output / "voice.wav").is_symlink())

    def test_conversion_failure_leaves_no_public_generation_or_receipt(self) -> None:
        output = self.project / "public" / "audio"
        conversions = 0

        def fail_second(source: Path, target: Path, codec_args: list[str]) -> None:
            nonlocal conversions
            conversions += 1
            if conversions == 2:
                raise subprocess.CalledProcessError(1, ["ffmpeg"])
            self.fake_conversion(source, target, codec_args)

        with mock.patch.object(publish_voice, "run_ffmpeg", side_effect=fail_second), self.assertRaises(
            subprocess.CalledProcessError
        ):
            self.invoke(output)

        for name in publish_voice.PUBLIC_NAMES:
            self.assertFalse((output / name).exists(), name)

    def test_replacement_failure_restores_previous_complete_generation(self) -> None:
        output = self.project / "public" / "audio"
        output.mkdir(parents=True)
        previous = {
            name: f"old-{name}".encode() for name in publish_voice.PUBLIC_NAMES
        }
        for name, content in previous.items():
            (output / name).write_bytes(content)

        real_replace = publish_voice.os.replace
        failed = False

        def fail_m4a_install(source: object, target: object) -> None:
            nonlocal failed
            source_path = Path(source)
            target_path = Path(target)
            if (
                not failed
                and source_path.parent.name.startswith(".voice-publish-")
                and target_path == output / "voice.m4a"
            ):
                failed = True
                raise OSError("injected replacement failure")
            real_replace(source, target)

        with mock.patch.object(
            publish_voice, "run_ffmpeg", side_effect=self.fake_conversion
        ), mock.patch.object(
            publish_voice.os, "replace", side_effect=fail_m4a_install
        ), self.assertRaisesRegex(OSError, "injected"):
            self.invoke(output)

        self.assertTrue(failed)
        for name, content in previous.items():
            self.assertEqual((output / name).read_bytes(), content, name)


class MiniMaxPayloadTest(unittest.TestCase):
    def test_public_package_uses_only_bundled_audio_helpers(self) -> None:
        direction_contract = (SCRIPTS / "direction_contract.py").read_text(
            encoding="utf-8"
        )
        finalize_voice = (SCRIPTS / "finalize_voice.py").read_text(encoding="utf-8")

        self.assertNotIn("/Users/", direction_contract)
        self.assertNotIn("/Users/", finalize_voice)
        self.assertTrue((SCRIPTS / "finalize_segments.py").is_file())
        self.assertTrue((SCRIPTS / "validate_voiceover.py").is_file())

    def test_default_speech28_payload_omits_unverified_emotion(self) -> None:
        response = mock.Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "data": {"audio": "0001", "duration": 123, "subtitle_file": "x"},
            "trace_id": "trace-test",
        }
        with tempfile.TemporaryDirectory() as temporary, mock.patch.dict(
            os.environ,
            {
                "MINIMAX_API_KEY": "not-a-real-key",
                "MINIMAX_VOICE_ID": "test-voice",
                "MINIMAX_TTS_MODEL": "speech-2.8-hd",
            },
            clear=False,
        ), mock.patch.object(minimax_tts.requests, "post", return_value=response) as post:
            result = minimax_tts.text_to_audio(
                "测试",
                output_path=str(Path(temporary) / "test.wav"),
                format="wav",
                subtitle_enable=True,
            )
        self.assertTrue(result["success"])
        payload = post.call_args.kwargs["json"]
        self.assertNotIn("emotion", payload["voice_setting"])
        self.assertEqual(payload["model"], "speech-2.8-hd")
        self.assertEqual(payload["voice_setting"]["voice_id"], "test-voice")
        self.assertTrue(payload["subtitle_enable"])
        self.assertNotIn("audio", result["response_metadata"])


if __name__ == "__main__":
    unittest.main()
