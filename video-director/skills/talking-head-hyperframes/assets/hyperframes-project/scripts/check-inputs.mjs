#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { trustedExecutable } from "./project-integrity.mjs";

export const FIXED_STAGE_VERSION = "studio-warm-white-fixed-stage-v3";
export const REQUIRED_HARD_REJECTIONS = [
  "repeated-generic-entrance",
  "decorative-continuous-motion",
  "unanchored-decoration",
  "generic-ai-decoration",
  "empty-reset-transition",
  "unreadable-transition-midpoint",
];

const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const CAPTION_OVERLAP_TOLERANCE = 0.05;
const CONTRACT_TIME_TOLERANCE = 0.05;

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function roundSeconds(value) {
  return Number(Number(value).toFixed(3));
}

export async function sha256(file) {
  const content = await readFile(file);
  return createHash("sha256").update(content).digest("hex");
}

export function probeDuration(file) {
  const ffprobe = trustedExecutable("ffprobe", process.cwd());
  const result = spawnSync(
    ffprobe,
    [
      "-hide_banner",
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      file,
    ],
    { encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.error) throw new Error(`ffprobe could not start for ${file}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`ffprobe could not decode ${file} (exit ${result.status}${result.signal ? `, signal ${result.signal}` : ""}): ${(result.stderr ?? "").trim()}`);
  }
  const duration = Number(result.stdout.trim());
  return Number.isFinite(duration) && duration > 0 ? roundSeconds(duration) : null;
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function requireContainedRegularFile(projectDir, relative, label) {
  if (!nonEmpty(relative) || path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) {
    throw new Error(`${label} must be a safe project-relative path`);
  }
  const root = await realpath(projectDir);
  const absolute = path.resolve(root, relative);
  if (!inside(root, absolute)) throw new Error(`${label} escapes the project root`);
  let cursor = root;
  for (const part of path.relative(root, absolute).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) throw new Error(`${label} must not traverse a symbolic link: ${path.relative(root, cursor)}`);
  }
  const actual = await realpath(absolute);
  if (!inside(root, actual)) throw new Error(`${label} resolves outside the project root`);
  const info = await stat(actual);
  if (!info.isFile()) throw new Error(`${label} is not a regular file`);
  return { absolute: actual, info };
}

function runFullMotionContractValidator(projectDir, file) {
  const validator = path.join(path.dirname(fileURLToPath(import.meta.url)), "validate-motion-contract.mjs");
  const result = spawnSync(process.execPath, [validator, file], { encoding: "utf8", timeout: 120_000 });
  if (result.error) throw new Error(`Full motion-contract validator could not run: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`Full motion-contract validation failed:\n${(result.stderr || result.stdout).trim()}`);
  }
}

export function validateAlignedCaptionsPayload(payload, label = "aligned captions") {
  const errors = [];
  const captions = payload && !Array.isArray(payload) ? payload.captions : null;
  if (!Array.isArray(captions) || captions.length === 0) {
    throw new Error(`${label} must contain a non-empty top-level captions array`);
  }

  let previousEnd = 0;
  for (const [index, caption] of captions.entries()) {
    const at = `captions[${index}]`;
    if (!caption || typeof caption !== "object" || Array.isArray(caption)) {
      errors.push(`${at} must be an object`);
      continue;
    }
    const { start, end, text, parts } = caption;
    if (!finite(start) || !finite(end) || start < 0 || end <= start) {
      errors.push(`${at} must have valid numeric start/end times`);
    }
    if (finite(start) && start < previousEnd - CAPTION_OVERLAP_TOLERANCE - 1e-9) {
      errors.push(`${at} overlaps the previous caption by more than 0.05 seconds`);
    }

    const hasText = nonEmpty(text);
    let hasParts = false;
    if (parts !== undefined) {
      if (!Array.isArray(parts) || parts.length === 0) {
        errors.push(`${at}.parts must be a non-empty array when provided`);
      } else {
        const invalidPart = parts.findIndex(
          (part) => !part || typeof part !== "object" || Array.isArray(part) || !nonEmpty(part.text),
        );
        if (invalidPart >= 0) errors.push(`${at}.parts[${invalidPart}].text must be non-empty`);
        else hasParts = true;
      }
    }
    if (!hasText && !hasParts) errors.push(`${at} must contain non-empty text or valid rich-text parts`);
    if (finite(end)) previousEnd = end;
  }

  if (errors.length > 0) throw new Error(errors.join("\n"));
  return {
    captions,
    count: captions.length,
    endSeconds: roundSeconds(captions.at(-1).end),
  };
}

export async function readAlignedCaptions(file) {
  let payload;
  try {
    payload = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`Aligned captions JSON is unreadable: ${file}: ${error.message}`);
  }
  return validateAlignedCaptionsPayload(payload, `Aligned captions JSON ${file}`);
}

export function validateCaptionBounds(captionsEnd, audioDuration) {
  if (captionsEnd > audioDuration + 0.5 + 1e-9) {
    throw new Error(
      `Aligned captions end at ${captionsEnd.toFixed(3)}s, more than 0.5s after audio ends at ${audioDuration.toFixed(3)}s`,
    );
  }
  if (captionsEnd < audioDuration - 3 - 1e-9) {
    throw new Error(
      `Aligned captions end at ${captionsEnd.toFixed(3)}s, more than 3s before audio ends at ${audioDuration.toFixed(3)}s`,
    );
  }
}

export function validateMotionContract(contract, label = "Motion contract") {
  const errors = [];
  const add = (location, message) => errors.push(`${location}: ${message}`);
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    throw new Error(`${label} must be a JSON object`);
  }
  if (contract.version !== 1) add("version", "must equal 1");
  if (!["remotion", "hyperframes"].includes(contract.pipeline)) {
    add("pipeline", 'must equal "remotion" or "hyperframes"');
  }
  if (contract.fps !== 30) add("fps", "must equal 30");

  const timeline = contract.timeline;
  if (!timeline || typeof timeline !== "object" || Array.isArray(timeline)) {
    add("timeline", "is required");
  } else {
    for (const key of ["programDurationSeconds", "audioDurationSeconds", "captionsEndSeconds"]) {
      if (!finite(timeline[key]) || timeline[key] <= 0) add(`timeline.${key}`, "must be positive");
    }
    if (finite(timeline.programDurationSeconds) && finite(timeline.audioDurationSeconds)) {
      const tail = timeline.programDurationSeconds - timeline.audioDurationSeconds;
      if (tail < -1 / 60) add("timeline.programDurationSeconds", "cannot end before the locked audio");
      if (tail > 3) add("timeline.programDurationSeconds", "tail after locked audio cannot exceed 3 seconds");
    }
    if (finite(timeline.captionsEndSeconds) && finite(timeline.audioDurationSeconds)) {
      if (timeline.captionsEndSeconds > timeline.audioDurationSeconds + 0.5) {
        add("timeline.captionsEndSeconds", "cannot extend more than 0.5 seconds past locked audio");
      }
      if (timeline.captionsEndSeconds < timeline.audioDurationSeconds - 3) {
        add("timeline.captionsEndSeconds", "cannot end more than 3 seconds before locked audio");
      }
    }
  }

  const sourceHashes = contract.sourceHashes;
  if (!sourceHashes || typeof sourceHashes !== "object" || Array.isArray(sourceHashes)) {
    add("sourceHashes", "is required");
  } else {
    for (const key of ["directorScript", "productionSpec", "assetPlan", "audio", "captionsAligned"]) {
      if (!HASH_PATTERN.test(sourceHashes[key] ?? "")) add(`sourceHashes.${key}`, "must be a 64-character SHA-256");
    }
  }

  if (!Array.isArray(contract.hardRejections)) {
    add("hardRejections", "must be an array");
  } else {
    for (const rejection of REQUIRED_HARD_REJECTIONS) {
      if (!contract.hardRejections.includes(rejection)) add("hardRejections", `must include ${rejection}`);
    }
  }

  if (!Array.isArray(contract.beats) || contract.beats.length === 0) {
    add("beats", "must contain the complete program timeline");
  } else {
    const tolerance = contract.fps === 30 ? 1 / 60 : 1 / 60;
    const ids = new Set();
    for (const [index, beat] of contract.beats.entries()) {
      const at = `beats[${index}]`;
      if (!beat || typeof beat !== "object" || Array.isArray(beat)) {
        add(at, "must be an object");
        continue;
      }
      if (!nonEmpty(beat.beatId)) add(`${at}.beatId`, "is required");
      else if (ids.has(beat.beatId)) add(`${at}.beatId`, `duplicates ${beat.beatId}`);
      else ids.add(beat.beatId);
      if (!finite(beat.startSeconds) || beat.startSeconds < 0) add(`${at}.startSeconds`, "must be non-negative");
      if (!finite(beat.endSeconds) || beat.endSeconds <= beat.startSeconds) add(`${at}.endSeconds`, "must be after startSeconds");
      if (index === 0 && finite(beat.startSeconds) && Math.abs(beat.startSeconds) > tolerance) {
        add(`${at}.startSeconds`, "complete coverage must start at 0");
      }
      if (index > 0 && finite(beat.startSeconds) && finite(contract.beats[index - 1]?.endSeconds)) {
        const gap = beat.startSeconds - contract.beats[index - 1].endSeconds;
        if (gap < -tolerance) add(`${at}.startSeconds`, "overlaps the previous beat");
        if (gap > tolerance) add(`${at}.startSeconds`, `leaves an uncovered gap of ${gap.toFixed(3)} seconds`);
      }
    }
    const last = contract.beats.at(-1);
    if (
      finite(timeline?.programDurationSeconds) &&
      finite(last?.endSeconds) &&
      Math.abs(last.endSeconds - timeline.programDurationSeconds) > tolerance
    ) {
      add("beats", "must cover continuously through timeline.programDurationSeconds");
    }
  }

  if (errors.length > 0) throw new Error(`${label} is invalid:\n${errors.join("\n")}`);
  return contract;
}

export async function readMotionContract(file) {
  let contract;
  try {
    contract = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`Motion contract is unreadable: ${file}: ${error.message}`);
  }
  return validateMotionContract(contract, `Motion contract ${file}`);
}

export function requireNear(actual, expected, label, tolerance = CONTRACT_TIME_TOLERANCE) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label} mismatch: actual ${actual.toFixed(3)}s, contract ${expected.toFixed(3)}s`);
  }
}

async function requireFileRecord(projectDir, label, record, { media = false } = {}) {
  const errors = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) return [`${label}: record is missing`];
  if (!nonEmpty(record.sourcePath)) errors.push(`${label}.sourcePath must be recorded`);
  if (!nonEmpty(record.path) || path.isAbsolute(record.path) || record.path.split("/").includes("..")) {
    errors.push(`${label}.path must be a safe project-relative path`);
    return errors;
  }
  try {
    const { absolute, info } = await requireContainedRegularFile(projectDir, record.path, `${label}.path`);
    if (info.size !== record.bytes) errors.push(`${label}.bytes mismatch for ${record.path}`);
    const actualHash = await sha256(absolute);
    if (actualHash !== record.sha256) errors.push(`${label}.sha256 mismatch for ${record.path}`);
    if (media) {
      const duration = probeDuration(absolute);
      if (!duration) errors.push(`${label} cannot be decoded or has no duration: ${record.path}`);
      else if (!finite(record.durationSeconds) || Math.abs(record.durationSeconds - duration) > 0.01) {
        errors.push(`${label}.durationSeconds mismatch for ${record.path}`);
      }
    }
  } catch (error) {
    errors.push(`${label}.path is missing: ${record.path} (${error.code ?? error.message})`);
  }
  if (!HASH_PATTERN.test(record.sha256 ?? "")) errors.push(`${label}.sha256 must be a SHA-256 digest`);
  if (!Number.isInteger(record.bytes) || record.bytes <= 0) errors.push(`${label}.bytes must be positive`);
  return errors;
}

export async function validateProjectInputs(projectDirArg = process.cwd()) {
  const projectDir = path.resolve(projectDirArg);
  const errors = [];
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(projectDir, "manifest.json"), "utf8"));
  } catch (error) {
    throw new Error(`manifest.json is unreadable in ${projectDir}: ${error.message}`);
  }

  if (!["TEMPLATE_ONLY", "READY_FOR_EXECUTION"].includes(manifest.status)) {
    errors.push(`manifest.status is invalid: ${JSON.stringify(manifest.status)}`);
  }
  if (manifest.fixedStage?.version !== FIXED_STAGE_VERSION) {
    errors.push(`manifest.fixedStage.version must equal ${FIXED_STAGE_VERSION}`);
  }
  if (!finite(manifest.durationSeconds) || manifest.durationSeconds <= 0) {
    errors.push("manifest.durationSeconds must be positive");
  }
  try {
    const { absolute: safeDesignPath, info: designInfo } = await requireContainedRegularFile(projectDir, "DESIGN.md", "DESIGN.md");
    if (manifest.design?.path !== "DESIGN.md") errors.push("manifest.design.path must equal DESIGN.md");
    if ((await sha256(safeDesignPath)) !== manifest.design?.sha256) errors.push("manifest.design.sha256 mismatch");
    if (designInfo.size !== manifest.design?.bytes) errors.push("manifest.design.bytes mismatch");
  } catch (error) {
    errors.push(`DESIGN.md is missing (${error.code ?? error.message})`);
  }

  const inputs = manifest.inputs ?? {};
  const scalarKinds = [
    ["directorScript", false],
    ["productionSpec", false],
    ["assetPlan", false],
    ["motionContract", false],
    ["audio", true],
    ["talkingHead", true],
    ["captionsAligned", false],
    ["captionsSrt", false],
    ["captionsVtt", false],
  ];
  for (const [key, media] of scalarKinds) {
    if (inputs[key]) errors.push(...(await requireFileRecord(projectDir, `inputs.${key}`, inputs[key], { media })));
  }
  for (const [key, media] of [["screenRecordings", true], ["screenshots", false], ["fonts", false]]) {
    if (!Array.isArray(inputs[key])) errors.push(`inputs.${key} must be an array`);
    else {
      for (const [index, record] of inputs[key].entries()) {
        errors.push(...(await requireFileRecord(projectDir, `inputs.${key}[${index}]`, record, { media })));
      }
    }
  }

  let captionSummary = null;
  if (inputs.captionsAligned?.path) {
    try {
      captionSummary = await readAlignedCaptions(path.join(projectDir, inputs.captionsAligned.path));
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (captionSummary && inputs.audio?.durationSeconds) {
    try {
      validateCaptionBounds(captionSummary.endSeconds, inputs.audio.durationSeconds);
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (captionSummary && manifest.validation?.alignedCaptionCount !== captionSummary.count) {
    errors.push(`manifest.validation.alignedCaptionCount must equal ${captionSummary.count}`);
  }

  let contract = null;
  if (inputs.motionContract?.path) {
    try {
      contract = await readMotionContract(path.join(projectDir, inputs.motionContract.path));
      runFullMotionContractValidator(projectDir, path.join(projectDir, inputs.motionContract.path));
      const sources = {
        directorScript: inputs.directorScript,
        productionSpec: inputs.productionSpec,
        assetPlan: inputs.assetPlan,
        audio: inputs.audio,
        captionsAligned: inputs.captionsAligned,
      };
      for (const [key, record] of Object.entries(sources)) {
        if (record && contract.sourceHashes[key]?.toLowerCase() !== record.sha256?.toLowerCase()) {
          errors.push(`motion contract sourceHashes.${key} does not match ${record.path}`);
        }
      }
      if (inputs.audio?.durationSeconds) {
        try {
          requireNear(inputs.audio.durationSeconds, contract.timeline.audioDurationSeconds, "Audio duration");
        } catch (error) {
          errors.push(error.message);
        }
      }
      if (captionSummary) {
        try {
          requireNear(captionSummary.endSeconds, contract.timeline.captionsEndSeconds, "Captions end");
        } catch (error) {
          errors.push(error.message);
        }
      }
      if (manifest.durationSeconds !== contract.timeline.programDurationSeconds) {
        errors.push("manifest.durationSeconds must equal motion contract timeline.programDurationSeconds");
      }
      if (manifest.motionContract?.pipeline !== contract.pipeline) {
        errors.push("manifest.motionContract.pipeline must preserve the source contract pipeline");
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  const required = ["directorScript", "productionSpec", "assetPlan", "motionContract", "audio", "captionsAligned"];
  const missingIds = required.filter((key) => !inputs[key]);
  const ready = missingIds.length === 0 && errors.length === 0;
  if (manifest.status === "READY_FOR_EXECUTION" && !ready) {
    errors.push(`READY_FOR_EXECUTION is not justified; missing or invalid: ${missingIds.join(", ") || "see errors above"}`);
  }
  if (manifest.status === "READY_FOR_EXECUTION" && manifest.nextSkill !== "hyperframes-scene-animator") {
    errors.push("READY_FOR_EXECUTION must route nextSkill to hyperframes-scene-animator");
  }
  if (manifest.status === "TEMPLATE_ONLY" && manifest.nextSkill !== null) {
    errors.push("TEMPLATE_ONLY must keep nextSkill null");
  }
  if (!Array.isArray(manifest.missingInputs)) errors.push("manifest.missingInputs must be an array");
  else {
    const declaredIds = manifest.missingInputs.map((item) => item?.id);
    if (JSON.stringify(declaredIds) !== JSON.stringify(missingIds)) {
      errors.push(`manifest.missingInputs does not match absent prerequisites (${missingIds.join(", ")})`);
    }
    for (const [index, item] of manifest.missingInputs.entries()) {
      if (!nonEmpty(item?.action) || !nonEmpty(item?.expectedPath)) {
        errors.push(`manifest.missingInputs[${index}] must include action and expectedPath`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`[inputs] FAIL: ${errors.length} issue(s) in ${projectDir}\n${errors.map((item) => `  - ${item}`).join("\n")}`);
  }
  return { projectDir, status: manifest.status, missingIds, manifest };
}

async function runCli() {
  const projectDir = process.argv[2] ?? process.cwd();
  try {
    const result = await validateProjectInputs(projectDir);
    console.log(`[inputs] PASS: ${result.status} (${result.missingIds.length} missing) in ${result.projectDir}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
