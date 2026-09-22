#!/usr/bin/env python3
"""Check whether a video-director project has the records needed for delivery."""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    errors: list[str] = []
    warnings: list[str] = []

    required = ["video-spec.md", "render-plan.md", "qa-report.md"]
    for relative in required:
        if not (root / relative).is_file():
            errors.append(f"missing required file: {relative}")

    ledger = root / "research/source-ledger.md"
    if not ledger.is_file():
        warnings.append("no research/source-ledger.md; acceptable only if the video has no factual claims")
    else:
        text = ledger.read_text(encoding="utf-8")
        blocked_rows = [
            line
            for line in text.splitlines()
            if line.lstrip().startswith("| SRC-") and "| blocked |" in line.lower()
        ]
        if blocked_rows:
            warnings.append("source ledger contains blocked claims; confirm none appear in the final video")

    manifest = root / "assets/asset-manifest.json"
    if not manifest.is_file():
        warnings.append("no assets/asset-manifest.json; acceptable only if no external assets are used")
    else:
        try:
            payload = json.loads(manifest.read_text(encoding="utf-8"))
            assets = payload.get("assets", [])
            for index, asset in enumerate(assets, start=1):
                if asset.get("licenseStatus") in {"", "unknown", None}:
                    warnings.append(f"asset {index} has unknown license status")
                local_path = asset.get("localPath")
                if local_path and not (root / local_path).exists():
                    errors.append(f"asset {index} local path does not exist: {local_path}")
        except (json.JSONDecodeError, AttributeError) as exc:
            errors.append(f"invalid assets/asset-manifest.json: {exc}")

    output_dir = root / "output"
    outputs = list(output_dir.glob("*")) if output_dir.is_dir() else []
    if not outputs:
        errors.append("no rendered file found under output/")

    for warning in warnings:
        print(f"WARNING: {warning}")
    for error in errors:
        print(f"ERROR: {error}")

    if errors:
        print(f"FAILED: {len(errors)} error(s), {len(warnings)} warning(s)")
        return 1

    print(f"PASSED: 0 errors, {len(warnings)} warning(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
