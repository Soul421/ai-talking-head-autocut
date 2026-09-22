#!/usr/bin/env python3
"""Publish an approved WAV as a rollback-safe set below a trusted project root."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import stat
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

from direction_contract import direction_sha256, file_sha256, load_direction


PUBLIC_NAMES = ("voice.wav", "voice.m4a", "voice.mp3", "voice-publish.json")


class PublicationRollbackError(RuntimeError):
    """A failed install whose automatic rollback also failed."""


def lexical_absolute(path: Path) -> Path:
    return Path(os.path.abspath(os.path.expanduser(os.fspath(path))))


def reject_symlink_components(path: Path, *, label: str) -> None:
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            break
        if stat.S_ISLNK(mode):
            raise ValueError(f"{label} 路径不能包含符号链接：{current}")


def secure_output_dir(project_root_arg: Path, output_dir_arg: Path) -> tuple[Path, Path]:
    project_root = lexical_absolute(project_root_arg)
    output_dir = lexical_absolute(output_dir_arg)
    reject_symlink_components(project_root, label="project-root")
    if not project_root.is_dir():
        raise ValueError(f"project-root 必须是已存在的目录：{project_root}")
    try:
        output_dir.relative_to(project_root)
    except ValueError as exc:
        raise ValueError("output-dir 必须位于 project-root 之内") from exc
    reject_symlink_components(output_dir, label="output-dir")
    output_dir.mkdir(parents=True, exist_ok=True)
    reject_symlink_components(output_dir, label="output-dir")
    if not output_dir.is_dir():
        raise ValueError(f"output-dir 必须是目录：{output_dir}")
    return project_root, output_dir


def existing_regular_file(path: Path) -> bool:
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError:
        return False
    if not stat.S_ISREG(mode):
        raise ValueError(f"已有发布目标必须是普通文件：{path}")
    return True


def copy_exclusive(source: Path, target: Path) -> None:
    with source.open("rb") as source_handle, target.open("xb") as target_handle:
        shutil.copyfileobj(source_handle, target_handle)
        target_handle.flush()
        os.fsync(target_handle.fileno())


def write_exclusive(path: Path, content: str) -> None:
    with path.open("x", encoding="utf-8") as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())


def validate_staged_file(path: Path) -> None:
    mode = path.lstat().st_mode
    if not stat.S_ISREG(mode) or path.stat().st_size == 0:
        raise ValueError(f"待发布产物必须是非空普通文件：{path}")


def run_ffmpeg(source: Path, target: Path, codec_args: list[str]) -> None:
    if target.exists() or target.is_symlink():
        raise FileExistsError(target)
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-n",
            "-i",
            str(source),
            *codec_args,
            str(target),
        ],
        check=True,
    )


def create_archive(output_dir: Path, targets: dict[str, Path]) -> Path | None:
    existing = [target for target in targets.values() if existing_regular_file(target)]
    if not existing:
        return None
    archive_root = output_dir / "archive"
    if archive_root.exists() or archive_root.is_symlink():
        mode = archive_root.lstat().st_mode
        if not stat.S_ISDIR(mode):
            raise ValueError(f"archive 必须是非符号链接目录：{archive_root}")
    else:
        archive_root.mkdir()
    archive_dir = archive_root / datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    archive_dir.mkdir(mode=0o700)
    try:
        for source in existing:
            copy_exclusive(source, archive_dir / source.name)
    except Exception:
        shutil.rmtree(archive_dir)
        raise
    return archive_dir


def install_public_set(staged: dict[str, Path], targets: dict[str, Path], rollback: Path) -> None:
    moved: list[str] = []
    installed: list[str] = []
    try:
        for name, target in targets.items():
            if existing_regular_file(target):
                os.replace(target, rollback / name)
                moved.append(name)
        for name, target in targets.items():
            os.replace(staged[name], target)
            installed.append(name)
    except Exception as install_error:
        rollback_errors: list[Exception] = []
        for name in reversed(installed):
            try:
                targets[name].unlink()
            except FileNotFoundError:
                pass
            except Exception as exc:
                rollback_errors.append(exc)
        for name in reversed(moved):
            try:
                os.replace(rollback / name, targets[name])
            except Exception as exc:
                rollback_errors.append(exc)
        if rollback_errors:
            raise PublicationRollbackError(
                f"发布失败且无法完整回滚；旧文件保留在 {rollback}"
            ) from install_error
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--direction", required=True, type=Path)
    parser.add_argument("--audio", required=True, type=Path)
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args(argv)

    _, output_dir = secure_output_dir(args.project_root, args.output_dir)
    direction_path = args.direction.expanduser().resolve()
    audio_path = args.audio.expanduser().resolve()
    direction = load_direction(direction_path)
    audio_approval = (direction.get("approval") or {}).get("audio") or {}
    digest = direction_sha256(direction_path, direction)
    if direction.get("status") not in {"audio_approved", "subtitled"}:
        raise ValueError("发布前必须显式批准最终音频")
    if audio_approval.get("status") != "approved":
        raise ValueError("缺少音频批准记录")
    if audio_approval.get("direction_sha256") != digest:
        raise ValueError("音频批准后导演稿已变更")
    if file_sha256(audio_path) != audio_approval.get("sha256"):
        raise ValueError("待发布音频与批准时的文件不一致")

    targets = {name: output_dir / name for name in PUBLIC_NAMES}
    for target in targets.values():
        existing_regular_file(target)

    staging_dir = Path(tempfile.mkdtemp(prefix=".voice-publish-", dir=output_dir))
    rollback_dir = staging_dir / "rollback"
    rollback_dir.mkdir(mode=0o700)
    archive_dir: Path | None = None
    preserve_staging = False
    try:
        staged = {name: staging_dir / name for name in PUBLIC_NAMES}
        copy_exclusive(audio_path, staged["voice.wav"])
        if file_sha256(staged["voice.wav"]) != file_sha256(audio_path):
            raise ValueError("暂存 WAV 与批准音频不一致")
        run_ffmpeg(
            audio_path,
            staged["voice.m4a"],
            ["-c:a", "aac", "-b:a", "192k"],
        )
        run_ffmpeg(
            audio_path,
            staged["voice.mp3"],
            ["-c:a", "libmp3lame", "-b:a", "192k"],
        )
        for name in PUBLIC_NAMES[:3]:
            validate_staged_file(staged[name])

        archive_dir = create_archive(output_dir, targets)
        report = {
            "direction_sha256": digest,
            "source": str(audio_path),
            "published": {
                name.removeprefix("voice."): {
                    "path": str(targets[name]),
                    "sha256": file_sha256(staged[name]),
                }
                for name in PUBLIC_NAMES[:3]
            },
            "archive": str(archive_dir) if archive_dir else None,
        }
        write_exclusive(
            staged["voice-publish.json"],
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        )
        validate_staged_file(staged["voice-publish.json"])
        install_public_set(staged, targets, rollback_dir)
    except PublicationRollbackError:
        preserve_staging = True
        raise
    finally:
        if not preserve_staging:
            shutil.rmtree(staging_dir, ignore_errors=True)

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
