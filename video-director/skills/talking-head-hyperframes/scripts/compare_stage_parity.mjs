#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

function usage() {
  console.error("Usage: node compare_stage_parity.mjs <remotion-golden.png> <hyperframes-snapshot.png> [--threshold <0..1>]");
}

const positional = [];
let threshold = 0.995;

for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--threshold") {
    const value = process.argv[index + 1];
    if (value === undefined) {
      usage();
      process.exit(2);
    }
    threshold = Number(value);
    index += 1;
  } else if (argument.startsWith("--threshold=")) {
    threshold = Number(argument.slice("--threshold=".length));
  } else {
    positional.push(argument);
  }
}

if (positional.length !== 2 || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
  usage();
  process.exit(2);
}

const [goldenArg, candidateArg] = positional;
const golden = path.resolve(process.cwd(), goldenArg);
const candidate = path.resolve(process.cwd(), candidateArg);

for (const [label, file] of [["Remotion golden", golden], ["HyperFrames snapshot", candidate]]) {
  try {
    const info = statSync(file);
    if (!info.isFile()) throw new Error("path is not a file");
  } catch (error) {
    console.error(`[stage-parity] FAIL: ${label} is unavailable at ${file}: ${error.message}`);
    process.exit(1);
  }
}

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const result = spawnSync(
  ffmpeg,
  [
    "-hide_banner",
    "-nostdin",
    "-i",
    golden,
    "-i",
    candidate,
    "-lavfi",
    "[0:v]format=yuv420p[golden];[1:v]format=yuv420p[candidate];[golden][candidate]ssim=stats_file=-",
    "-f",
    "null",
    "-",
  ],
  { encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
);

if (result.error) {
  console.error(`[stage-parity] FAIL: could not run ${ffmpeg}: ${result.error.message}`);
  process.exit(1);
}

const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
if (result.status !== 0) {
  console.error(`[stage-parity] FAIL: FFmpeg exited ${result.status}. Images must be readable PNGs with identical dimensions.`);
  console.error(output.trim());
  process.exit(1);
}

const matches = [...output.matchAll(/SSIM[^\n]*All:([0-9.]+)/g)];
if (matches.length === 0) {
  console.error("[stage-parity] FAIL: FFmpeg completed but emitted no parseable SSIM All score.");
  console.error(output.trim());
  process.exit(1);
}

const score = Number(matches.at(-1)[1]);
if (!Number.isFinite(score)) {
  console.error(`[stage-parity] FAIL: invalid SSIM score ${JSON.stringify(matches.at(-1)[1])}`);
  process.exit(1);
}

if (score < threshold) {
  console.error(
    `[stage-parity] FAIL: delivery-space yuv420p SSIM ${score.toFixed(6)} is below threshold ${threshold.toFixed(6)}\n` +
      `  Remotion golden: ${golden}\n` +
      `  HyperFrames snapshot: ${candidate}`,
  );
  process.exit(1);
}

console.log(
  `[stage-parity] PASS: delivery-space yuv420p SSIM ${score.toFixed(6)} >= ${threshold.toFixed(6)}\n` +
    `  Remotion golden: ${golden}\n` +
    `  HyperFrames snapshot: ${candidate}`,
);
