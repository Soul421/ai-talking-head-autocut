#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { trustedExecutable } from "../../talking-head-hyperframes/assets/hyperframes-project/scripts/project-integrity.mjs";

function usage() {
  return "Usage: node build_contact_sheet.mjs --output <sheet.png|sheet.jpg> [--width 1920] [--height 1080] [--columns 4] <ordered-frame.png>...";
}

function parseArgs(argv) {
  const options = { width: 1920, height: 1080, columns: 4, background: "#151922", inputs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") return { help: true };
    if (["--output", "--width", "--height", "--columns", "--background"].includes(token)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${token} requires a value`);
      index += 1;
      if (token === "--output") options.output = value;
      else if (token === "--background") options.background = value;
      else options[token.slice(2)] = Number(value);
      continue;
    }
    if (token.startsWith("--")) throw new Error(`Unknown option ${token}`);
    options.inputs.push(token);
  }
  return options;
}

const projectRoot = fs.realpathSync(process.cwd());
const executables = {
  ffmpeg: trustedExecutable("ffmpeg", projectRoot),
  ffprobe: trustedExecutable("ffprobe", projectRoot),
};

function run(command, args) {
  return spawnSync(executables[command], args, { encoding: "utf8", timeout: 120_000, maxBuffer: 20 * 1024 * 1024 });
}

function probeImage(file) {
  const result = run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,codec_type",
    "-of", "json",
    file,
  ]);
  if (result.error || result.status !== 0) throw new Error(`ffprobe could not decode ${file}: ${result.error?.message ?? (result.stderr ?? "").trim()}`);
  const stream = JSON.parse(result.stdout).streams?.[0];
  if (!stream || stream.codec_type !== "video" || stream.width <= 0 || stream.height <= 0) {
    throw new Error(`No decodable image stream in ${file}`);
  }
  return stream;
}

function safeInsideProject(value, allowedPrefix, label, { mustExist = true } = {}) {
  const requested = path.resolve(value);
  const lexicalCwd = path.resolve(process.cwd());
  const cwdRelative = path.relative(lexicalCwd, requested);
  let resolved;
  if (cwdRelative === "" || (!cwdRelative.startsWith("..") && !path.isAbsolute(cwdRelative))) {
    resolved = path.resolve(projectRoot, cwdRelative);
  } else if (mustExist) {
    resolved = fs.realpathSync(requested);
  } else {
    resolved = path.join(fs.realpathSync(path.dirname(requested)), path.basename(requested));
  }
  const relative = path.relative(projectRoot, resolved).split(path.sep).join("/");
  if (relative.startsWith("../") || path.isAbsolute(relative) || !relative.startsWith(`${allowedPrefix}/`)) {
    throw new Error(`${label} must stay inside ${allowedPrefix}/ under the current project`);
  }
  let cursor = projectRoot;
  for (const part of relative.split("/").filter(Boolean)) {
    cursor = path.join(cursor, part);
    let info;
    try {
      info = fs.lstatSync(cursor);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (mustExist) throw new Error(`${label} does not exist: ${relative}`);
      break;
    }
    if (info.isSymbolicLink()) throw new Error(`${label} must not traverse a symbolic link: ${relative}`);
  }
  return resolved;
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    process.exit(0);
  }
  if (!options.output) throw new Error("--output is required");
  if (options.inputs.length === 0) throw new Error("at least one ordered input frame is required");
  for (const key of ["width", "height", "columns"]) {
    if (!Number.isInteger(options[key]) || options[key] <= 0) throw new Error(`--${key} must be a positive integer`);
  }
  if (!/^#[0-9a-f]{6}$/i.test(options.background)) throw new Error("--background must be a six-digit hex color");
  if (!/\.(?:png|jpe?g)$/i.test(options.output)) throw new Error("--output must end in .png, .jpg, or .jpeg");
} catch (error) {
  console.error(`[contact-sheet] ${error.message}\n${usage()}`);
  process.exit(2);
}

let inputPaths;
let output;
try {
  inputPaths = options.inputs.map((item) => safeInsideProject(item, "snapshots/acceptance", "input frame"));
  output = safeInsideProject(options.output, "review", "contact-sheet output", { mustExist: false });
} catch (error) {
  console.error(`[contact-sheet] ${error.message}`);
  process.exit(1);
}
for (const file of inputPaths) {
  try {
    const inputInfo = fs.statSync(file);
    if (!inputInfo.isFile() || inputInfo.size === 0) throw new Error(`missing or empty input frame: ${file}`);
  } catch {
    console.error(`[contact-sheet] missing or empty input frame: ${file}`);
    process.exit(1);
  }
  try {
    probeImage(file);
  } catch (error) {
    console.error(`[contact-sheet] ${error.message}`);
    process.exit(1);
  }
}

fs.mkdirSync(path.dirname(output), { recursive: true });
const columns = Math.min(options.columns, inputPaths.length);
const rows = Math.ceil(inputPaths.length / columns);
const cellWidth = Math.floor(options.width / columns);
const cellHeight = Math.floor(options.height / rows);
const ffmpegArgs = ["-hide_banner", "-loglevel", "error"];
for (const input of inputPaths) ffmpegArgs.push("-i", input);

const filters = inputPaths.map((_, index) =>
  `[${index}:v]scale=${cellWidth}:${cellHeight}:force_original_aspect_ratio=decrease,` +
  `pad=${cellWidth}:${cellHeight}:(ow-iw)/2:(oh-ih)/2:color=${options.background},setsar=1[v${index}]`,
);
const layout = inputPaths.map((_, index) => `${(index % columns) * cellWidth}_${Math.floor(index / columns) * cellHeight}`).join("|");
const stacked = inputPaths.map((_, index) => `[v${index}]`).join("");
filters.push(`${stacked}xstack=inputs=${inputPaths.length}:layout=${layout}:fill=${options.background}[grid]`);
filters.push(`[grid]pad=${options.width}:${options.height}:0:0:color=${options.background},format=rgb24[out]`);
ffmpegArgs.push("-filter_complex", filters.join(";"), "-map", "[out]", "-frames:v", "1");
if (/\.jpe?g$/i.test(output)) ffmpegArgs.push("-q:v", "2");
ffmpegArgs.push("-y", output);

const result = run("ffmpeg", ffmpegArgs);
if (result.error || result.status !== 0) {
  console.error(`[contact-sheet] ffmpeg failed: ${result.error?.message ?? (result.stderr ?? "").trim()}`);
  process.exit(1);
}

try {
  const stream = probeImage(output);
  if (stream.width !== options.width || stream.height !== options.height) {
    throw new Error(`output is ${stream.width}x${stream.height}; expected ${options.width}x${options.height}`);
  }
} catch (error) {
  console.error(`[contact-sheet] ${error.message}`);
  process.exit(1);
}

console.log(`PASS contact sheet ${output} (${inputPaths.length} ordered frames, ${options.width}x${options.height})`);
