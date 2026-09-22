#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { canonicalProjectRoot, safeProjectPath, trustedExecutable, writeFileAtomic } from "./project-integrity.mjs";

const args = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const projectDir = canonicalProjectRoot(process.cwd());
const inputRelative = valueOf("--input", "renders/internal-preview-v1.mp4");
const outputRelative = valueOf("--output", "review/media-analysis-v1.json");
if (inputRelative !== "renders/internal-preview-v1.mp4" || outputRelative !== "review/media-analysis-v1.json") {
  throw new Error("Media proof accepts only the canonical internal preview and review output paths");
}
const input = safeProjectPath(projectDir, inputRelative, { type: "file" });
const output = safeProjectPath(projectDir, outputRelative, { mustExist: false });
const logsDir = safeProjectPath(projectDir, "review/media", { mustExist: false });
const executables = {
  ffmpeg: trustedExecutable("ffmpeg", projectDir),
  ffprobe: trustedExecutable("ffprobe", projectDir),
};

function run(command, commandArgs) {
  const result = spawnSync(executables[command] ?? command, commandArgs, { encoding: "utf8", timeout: 300_000, maxBuffer: 20 * 1024 * 1024 });
  if (result.error) fail(`${command} could not run: ${result.error.message}`);
  return result;
}

function quotedCommand(command, commandArgs) {
  const portable = commandArgs.map((item) => item === input ? inputRelative : item);
  return [command, ...portable].map((item) => /[\s#]/.test(item) ? JSON.stringify(item) : item).join(" ");
}

function writeLog(name, value) {
  const relative = `review/media/${name}`;
  const file = safeProjectPath(projectDir, relative, { mustExist: false });
  writeFileAtomic(file, value);
  return path.relative(projectDir, file).split(path.sep).join("/");
}

function fail(message) {
  console.error(`[media-proof] ${message}`);
  process.exit(1);
}

try {
  const inputInfo = fs.statSync(input);
  if (!inputInfo.isFile() || inputInfo.size === 0) fail(`missing internal preview ${inputRelative}`);
} catch {
  fail(`missing internal preview ${inputRelative}`);
}
fs.mkdirSync(logsDir, { recursive: true });
fs.mkdirSync(path.dirname(output), { recursive: true });

const probeArgs = [
  "-v", "error",
  "-show_entries", "format=duration,size:stream=codec_type,width,height,avg_frame_rate",
  "-of", "json",
  input,
];
const probe = run("ffprobe", probeArgs);
if (probe.status !== 0) fail(`ffprobe failed: ${probe.stderr.trim()}`);
const probeJson = JSON.parse(probe.stdout);
const duration = Number(probeJson.format?.duration);
if (!Number.isFinite(duration) || duration <= 0) fail("preview duration is unavailable");
const probeEvidence = writeLog("ffprobe.json", `${JSON.stringify(probeJson, null, 2)}\n`);

const fullDecodeArgs = [
  "-hide_banner", "-i", input,
  "-map", "0:v:0", "-map", "0:a:0?", "-f", "null", "-",
];
const fullDecode = run("ffmpeg", fullDecodeArgs);
const fullDecodeText = `${fullDecode.stdout ?? ""}${fullDecode.stderr ?? ""}`;
const fullDecodeEvidence = writeLog("full-watch-decode.txt", fullDecodeText);
const decodedFrames = [...fullDecodeText.matchAll(/frame=\s*(\d+)/g)].map((match) => Number(match[1])).at(-1) ?? 0;
const expectedFrames = Math.round(duration * 30);
const fullDecodePass = fullDecode.status === 0 && decodedFrames >= expectedFrames;

const blackStart = Math.max(0, duration - 0.5);
const blackArgs = [
  "-hide_banner", "-ss", blackStart.toFixed(3), "-i", input,
  "-vf", "blackdetect=d=0.08:pic_th=0.98:pix_th=0.1", "-an", "-f", "null", "-",
];
const black = run("ffmpeg", blackArgs);
const blackText = `${black.stdout ?? ""}${black.stderr ?? ""}`;
const blackEvidence = writeLog("black-tail.txt", blackText);
const blackPass = black.status === 0 && !/black_duration:([0-9.]+)/.test(blackText);

const silenceArgs = [
  "-hide_banner", "-i", input,
  "-af", "silencedetect=n=-45dB:d=0.15", "-vn", "-f", "null", "-",
];
const silence = run("ffmpeg", silenceArgs);
const silenceText = `${silence.stdout ?? ""}${silence.stderr ?? ""}`;
const silenceEvidence = writeLog("silent-tail.txt", silenceText);
const starts = [...silenceText.matchAll(/silence_start:\s*([0-9.]+)/g)].map((match) => Number(match[1]));
const ends = [...silenceText.matchAll(/silence_end:\s*([0-9.]+)/g)].map((match) => Number(match[1]));
const finalStart = starts.at(-1);
const finalEnd = ends.at(-1);
const reachesEof = Number.isFinite(finalStart) && (starts.length > ends.length || (Number.isFinite(finalEnd) && finalEnd >= duration - 0.03 && finalEnd >= finalStart));
const trailingSilence = reachesEof ? duration - finalStart : 0;
const silencePass = silence.status === 0 && trailingSilence <= 0.15;

function audioRegion(name, start) {
  const regionArgs = [
    "-hide_banner", "-ss", start.toFixed(3), "-t", "0.4", "-i", input,
    "-vn", "-af", "volumedetect", "-f", "null", "-",
  ];
  const result = run("ffmpeg", regionArgs);
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const evidence = writeLog(`${name}.txt`, text);
  const max = Number(text.match(/max_volume:\s*(-?[0-9.]+) dB/)?.[1]);
  return {
    status: result.status === 0 && Number.isFinite(max) && max > -50 ? "PASS" : "FAIL",
    startSeconds: Number(start.toFixed(3)),
    durationSeconds: 0.4,
    maxVolumeDb: Number.isFinite(max) ? max : null,
    command: quotedCommand("ffmpeg", regionArgs),
    evidence,
  };
}

const analysis = {
  version: 1,
  previewPath: inputRelative,
  previewSha256: crypto.createHash("sha256").update(fs.readFileSync(input)).digest("hex"),
  probe: {
    status: "PASS",
    command: quotedCommand("ffprobe", probeArgs),
    evidence: probeEvidence,
    durationSeconds: duration,
  },
  fullDecode: {
    status: fullDecodePass ? "PASS" : "FAIL",
    decodedFrames,
    expectedFrames,
    command: quotedCommand("ffmpeg", fullDecodeArgs),
    evidence: fullDecodeEvidence,
  },
  blackTail: {
    status: blackPass ? "PASS" : "FAIL",
    checkedFromSeconds: Number(blackStart.toFixed(3)),
    detectedBlackInterval: /black_duration:([0-9.]+)/.test(blackText),
    command: quotedCommand("ffmpeg", blackArgs),
    evidence: blackEvidence,
  },
  silentTail: {
    status: silencePass ? "PASS" : "FAIL",
    trailingSilenceSeconds: Number(trailingSilence.toFixed(3)),
    allowedTrailingSilenceSeconds: 0.15,
    command: quotedCommand("ffmpeg", silenceArgs),
    evidence: silenceEvidence,
  },
  firstAudioRegion: audioRegion("audio-first-region", 0),
  lastAudioRegion: audioRegion("audio-last-region", Math.max(0, duration - 0.4)),
};

fs.writeFileSync(output, `${JSON.stringify(analysis, null, 2)}\n`);
const allPass = [analysis.fullDecode, analysis.blackTail, analysis.silentTail, analysis.firstAudioRegion, analysis.lastAudioRegion].every((item) => item.status === "PASS");
if (!allPass) fail(`media proof failed; inspect ${outputRelative}`);
console.log(`PASS media proof ${outputRelative} (${duration.toFixed(3)}s, no black/silent tail)`);
