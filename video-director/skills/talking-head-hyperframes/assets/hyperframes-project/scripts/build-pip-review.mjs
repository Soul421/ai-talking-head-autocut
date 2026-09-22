#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import {
  canonicalProjectRoot,
  safeProjectPath,
  sha256File,
  trustedExecutable,
  writeJsonAtomic,
} from "./project-integrity.mjs";

const projectDir = canonicalProjectRoot(process.cwd());
const inputRelative = process.argv[2];
if (!inputRelative) {
  console.error("Usage: npm run review:pip -- <project-relative-video> [seconds]");
  process.exit(2);
}

const input = safeProjectPath(projectDir, inputRelative, { type: "file" });
const ffprobe = trustedExecutable("ffprobe", projectDir);
const ffmpeg = trustedExecutable("ffmpeg", projectDir);
const probe = spawnSync(
  ffprobe,
  ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", input],
  { encoding: "utf8", timeout: 60_000 },
);
if (probe.status !== 0) {
  throw new Error(`Could not probe ${inputRelative}: ${(probe.stderr ?? "").trim()}`);
}
const probeData = JSON.parse(probe.stdout ?? "{}");
const duration = Number(probeData.format?.duration);
if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Invalid video duration for ${inputRelative}`);
const videoStream = (probeData.streams ?? []).find((stream) => stream.codec_type === "video");
if (videoStream?.width !== 1920 || videoStream?.height !== 1080) {
  throw new Error(`PIP review evidence must be an actual 1920x1080 composition; received ${videoStream?.width ?? "?"}x${videoStream?.height ?? "?"}`);
}

const requestedSeconds = process.argv[3] === undefined ? duration / 2 : Number(process.argv[3]);
if (!Number.isFinite(requestedSeconds) || requestedSeconds < 0 || requestedSeconds >= duration) {
  throw new Error(`Review time must be within 0..${duration}`);
}
const seconds = Number(requestedSeconds.toFixed(3));
const stem = path.basename(inputRelative, path.extname(inputRelative)).replace(/[^a-zA-Z0-9._-]+/g, "-");
const outputDir = safeProjectPath(projectDir, "review/pip", { mustExist: false });
fs.mkdirSync(outputDir, { recursive: true });
const frameRelative = `review/pip/${stem}-frame.png`;
const zoomRelative = `review/pip/${stem}-crop-3x.png`;
const receiptRelative = `review/pip/${stem}-review.json`;
const frame = safeProjectPath(projectDir, frameRelative, { mustExist: false });
const zoom = safeProjectPath(projectDir, zoomRelative, { mustExist: false });

function run(args, label) {
  const result = spawnSync(ffmpeg, args, { encoding: "utf8", timeout: 120_000 });
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${(result.stderr ?? "").trim()}`);
  }
}

run(["-y", "-v", "error", "-ss", String(seconds), "-i", input, "-frames:v", "1", "-update", "1", frame], "PIP full-frame extraction");
run(
  [
    "-y",
    "-v",
    "error",
    "-ss",
    String(seconds),
    "-i",
    input,
    "-vf",
    "crop=300:300:1560:680,scale=900:900:flags=neighbor",
    "-frames:v",
    "1",
    "-update",
    "1",
    zoom,
  ],
  "PIP zoom extraction",
);

const manifest = JSON.parse(fs.readFileSync(safeProjectPath(projectDir, "manifest.json", { type: "file" }), "utf8"));
writeJsonAtomic(safeProjectPath(projectDir, receiptRelative, { mustExist: false }), {
  version: 1,
  status: "REQUIRES_VISUAL_REVIEW",
  input: { path: inputRelative, sha256: sha256File(input), durationSeconds: duration },
  atSeconds: seconds,
  pipContract: manifest.fixedStage?.pipContract ?? null,
  evidence: {
    fullFrame: frameRelative,
    crop3x: zoomRelative,
    canvas: "1920:1080",
    crop: "300:300:1560:680",
    scale: "900:900",
  },
  acceptance: {
    noStageGridInsideCircle: false,
    subjectInsideSafeArea: false,
  },
});

console.log(frameRelative);
console.log(zoomRelative);
console.log(receiptRelative);
