#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { canonicalProjectRoot, safeProjectPath, trustedExecutable } from "./project-integrity.mjs";

const projectDir = canonicalProjectRoot(process.cwd());
const ffmpeg = trustedExecutable("ffmpeg", projectDir);
const ffprobe = trustedExecutable("ffprobe", projectDir);
const proofPath = safeProjectPath(projectDir, "review/proof-manifest-v1.json", { type: "file" });
const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
const ordered = (proof.evidence ?? []).filter((item) => item.role === "source_acceptance").map((item) => item.path);
if (ordered.length === 0) throw new Error("Proof manifest has no ordered source_acceptance evidence");
const inputs = ordered.map((relative) => {
  if (!relative.startsWith("snapshots/acceptance/")) throw new Error(`Contact-sheet input is outside snapshots/acceptance: ${relative}`);
  return safeProjectPath(projectDir, relative, { type: "file" });
});
const outputRelative = "review/executor-contact-sheet-v1.png";
const output = safeProjectPath(projectDir, outputRelative, { mustExist: false });
if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink()) throw new Error("Contact-sheet output must not be a symbolic link");
fs.mkdirSync(path.dirname(output), { recursive: true });

const width = 1920;
const height = 1080;
const columns = Math.min(4, inputs.length);
const rows = Math.ceil(inputs.length / columns);
const cellWidth = Math.floor(width / columns);
const cellHeight = Math.floor(height / rows);
const args = ["-hide_banner", "-loglevel", "error"];
for (const input of inputs) args.push("-i", input);
const filters = inputs.map((_, index) => `[${index}:v]scale=${cellWidth}:${cellHeight}:force_original_aspect_ratio=decrease,pad=${cellWidth}:${cellHeight}:(ow-iw)/2:(oh-ih)/2:color=#151922,setsar=1[v${index}]`);
const layout = inputs.map((_, index) => `${(index % columns) * cellWidth}_${Math.floor(index / columns) * cellHeight}`).join("|");
filters.push(`${inputs.map((_, index) => `[v${index}]`).join("")}xstack=inputs=${inputs.length}:layout=${layout}:fill=#151922[grid]`);
filters.push(`[grid]pad=${width}:${height}:0:0:color=#151922,format=rgb24[out]`);
args.push("-filter_complex", filters.join(";"), "-map", "[out]", "-frames:v", "1", "-y", output);
const result = spawnSync(ffmpeg, args, { encoding: "utf8", timeout: 120_000, maxBuffer: 20 * 1024 * 1024 });
if (result.error || result.status !== 0) throw new Error(`Contact-sheet render failed: ${result.error?.message ?? result.stderr}`);
const probe = spawnSync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", output], { encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
if (probe.error || probe.status !== 0) throw new Error(`Contact-sheet probe failed: ${probe.error?.message ?? probe.stderr}`);
const stream = JSON.parse(probe.stdout).streams?.[0];
if (stream?.width !== width || stream?.height !== height) throw new Error(`Contact sheet must be ${width}x${height}`);
console.log(`PASS contact sheet ${outputRelative} (${inputs.length} ordered frames, ${width}x${height})`);
