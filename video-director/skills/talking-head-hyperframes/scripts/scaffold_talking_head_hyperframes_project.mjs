#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import {
  cp,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  FIXED_STAGE_VERSION,
  probeDuration,
  readAlignedCaptions,
  readMotionContract,
  requireNear,
  sha256,
  validateCaptionBounds,
} from "./validate_inputs.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(SCRIPT_DIR, "..");
const TEMPLATE_DIR = path.join(SKILL_DIR, "assets/hyperframes-project");
const DEFAULT_PIP_OBJECT_X = 66.7;
const DEFAULT_PIP_OBJECT_Y = 50;

const REQUIRED_INPUTS = [
  {
    id: "directorScript",
    action: "Provide the user-confirmed director script with --director-script (or --script).",
    expectedPath: "inputs/视频脚本.md",
  },
  {
    id: "productionSpec",
    action: "Provide the confirmed production specification with --production-spec.",
    expectedPath: "inputs/制作规格.md",
  },
  {
    id: "assetPlan",
    action: "Provide the approved asset plan with --asset-plan.",
    expectedPath: "inputs/素材计划.md",
  },
  {
    id: "motionContract",
    action: "Provide a full-timeline motion contract with --motion-contract.",
    expectedPath: "inputs/motion-contract.json",
  },
  {
    id: "audio",
    action: "Provide decodable locked voice media with --audio.",
    expectedPath: "assets/audio/voice/voice.<ext>",
  },
  {
    id: "captionsAligned",
    action: "Provide non-empty aligned JSON captions with --captions.",
    expectedPath: "inputs/captions/captions_aligned.json",
  },
];

const TEMPLATE_FILES = [
  ".npmrc",
  "DESIGN.md",
  "caption-overrides.json",
  "hyperframes.json",
  "index.html",
  "manifest.json",
  "meta.json",
  "package.json",
  "styles.css",
  "compositions/studio-background.html",
  "compositions/caption-overlay.html",
  "compositions/pip-overlay.html",
  "scripts/check-inputs.mjs",
  "scripts/check-fixed-stage.mjs",
  "scripts/validate-motion-contract.mjs",
  "scripts/validate-runtime-adaptation.mjs",
  "scripts/validate-project-proof.mjs",
  "scripts/project-integrity.mjs",
  "scripts/proof-prepare.mjs",
  "scripts/proof-lock.mjs",
  "scripts/proof-stage.mjs",
  "scripts/proof-gate.mjs",
  "scripts/proof-bind-review.mjs",
  "scripts/proof-approve.mjs",
  "scripts/promote-preview.mjs",
  "scripts/run-workflow.mjs",
  "scripts/build-animation-map.mjs",
  "scripts/build-pip-review.mjs",
  "scripts/hyperframes-animation-map.mjs",
  "scripts/package-loader.mjs",
  "scripts/build-contact-sheet.mjs",
  "scripts/analyze-preview.mjs",
  "proof/goldens/narrow-center-grid-t000.png",
  "proof/goldens/narrow-center-grid-t004.png",
  "proof/goldens/narrow-center-grid-t009.png",
  "review/proof-manifest-v1.json",
  "review/executor-report-v1.md",
  "review/lead-review-v1.md",
];
const DOWNSTREAM_TEMPLATE_FILES = new Set([
  "review/proof-manifest-v1.json",
  "review/executor-report-v1.md",
  "review/lead-review-v1.md",
]);
const OBSOLETE_FACTORY_FILES = [
  "proof/goldens/remotion-t000.png",
  "proof/goldens/remotion-t004.png",
  "proof/goldens/remotion-t009.png",
  "proof/goldens/continuous-grid-t000.png",
  "proof/goldens/continuous-grid-t004.png",
  "proof/goldens/continuous-grid-t009.png",
];

const ALLOWED_EXTENSIONS = {
  audio: new Set([".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".mp4"]),
  video: new Set([".mp4", ".mov", ".m4v", ".webm"]),
  image: new Set([".png", ".jpg", ".jpeg", ".webp"]),
  font: new Set([".ttf", ".otf", ".woff", ".woff2"]),
};

function usage() {
  return `Usage: node scaffold_talking_head_hyperframes_project.mjs --project-dir <dir> [options]

Options:
  --title <text>
  --audio <file>
  --captions <json|srt|vtt>       Repeatable; at most one of each format
  --director-script <file>        --script is a compatibility alias
  --production-spec <file>
  --asset-plan <file>
  --motion-contract <json>
  --talking-head <video>
  --pip-object-x <0..100>          Default: 66.7 (Bozhou Digital Twin v1)
  --pip-object-y <0..100>          Default: 50
  --screen-recording <video>      Repeatable
  --screenshot <image>            Repeatable
  --font <file>                    Repeatable
  --duration <seconds>
  --show-pip-placeholder
  --force
`;
}

function parseArgs(argv) {
  const args = {
    title: "Talking Head HyperFrames Video",
    captions: [],
    screenRecordings: [],
    screenshots: [],
    fonts: [],
    force: false,
    showPipPlaceholder: false,
  };
  const repeatable = new Map([
    ["--captions", "captions"],
    ["--screen-recording", "screenRecordings"],
    ["--screenshot", "screenshots"],
    ["--font", "fonts"],
  ]);
  const values = new Map([
    ["--project-dir", "projectDir"],
    ["--title", "title"],
    ["--audio", "audio"],
    ["--director-script", "directorScript"],
    ["--script", "directorScript"],
    ["--production-spec", "productionSpec"],
    ["--asset-plan", "assetPlan"],
    ["--motion-contract", "motionContract"],
    ["--talking-head", "talkingHead"],
    ["--pip-object-x", "pipObjectX"],
    ["--pip-object-y", "pipObjectY"],
    ["--duration", "duration"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") return { help: true };
    if (token === "--force") {
      args.force = true;
      continue;
    }
    if (token === "--show-pip-placeholder") {
      args.showPipPlaceholder = true;
      continue;
    }
    const key = values.get(token) ?? repeatable.get(token);
    if (!key) throw new Error(`Unknown option: ${token}\n\n${usage()}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${token} requires a value`);
    index += 1;
    if (repeatable.has(token)) args[key].push(value);
    else args[key] = value;
  }

  if (!args.projectDir) throw new Error(`--project-dir is required\n\n${usage()}`);
  if (args.duration !== undefined) {
    args.duration = Number(args.duration);
    if (!Number.isFinite(args.duration) || args.duration <= 0) throw new Error("--duration must be a positive number");
  }
  for (const [key, flag] of [["pipObjectX", "--pip-object-x"], ["pipObjectY", "--pip-object-y"]]) {
    if (args[key] === undefined) continue;
    args[key] = Number(args[key]);
    if (!Number.isFinite(args[key]) || args[key] < 0 || args[key] > 100) {
      throw new Error(`${flag} must be a number from 0 to 100`);
    }
  }
  return args;
}

async function isFile(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function extensionFor(file, kind) {
  const extension = path.extname(file).toLowerCase();
  if (!ALLOWED_EXTENSIONS[kind]?.has(extension)) {
    throw new Error(`Unsupported ${kind} extension ${JSON.stringify(extension || "(none)")} for ${path.resolve(file)}`);
  }
  return extension;
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function assertNoSymlinks(root) {
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink()) throw new Error(`Refusing symbolic-link project root: ${root}`);
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new Error(`Refusing symbolic link inside project: ${path.relative(root, absolute)}`);
      if (info.isDirectory()) await visit(absolute);
    }
  };
  if (rootInfo.isDirectory()) await visit(root);
}

async function validateProjectPath(projectDir) {
  const parent = path.dirname(projectDir);
  await mkdir(parent, { recursive: true });
  if ((await lstat(parent)).isSymbolicLink()) throw new Error(`Refusing symbolic-link project parent: ${parent}`);
  const canonicalParent = await realpath(parent);
  if (!inside(canonicalParent, path.resolve(canonicalParent, path.basename(projectDir)))) {
    throw new Error(`Project path must stay inside its canonical parent: ${projectDir}`);
  }
  try {
    await assertNoSymlinks(projectDir);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function pathExists(candidate) {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function scaffoldTransactionPath(projectDir) {
  return path.join(path.dirname(projectDir), `.${path.basename(projectDir)}.scaffold-transaction.json`);
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

async function recoverInterruptedCommit(projectDir) {
  const transactionPath = scaffoldTransactionPath(projectDir);
  if (!(await pathExists(transactionPath))) return;
  const markerInfo = await lstat(transactionPath);
  if (markerInfo.isSymbolicLink() || !markerInfo.isFile()) throw new Error(`Invalid scaffold transaction marker: ${transactionPath}`);
  const marker = JSON.parse(await readFile(transactionPath, "utf8"));
  const parent = path.dirname(projectDir);
  const expectedStagePrefix = `.${path.basename(projectDir)}.stage-`;
  if (
    marker.version !== 1 ||
    path.resolve(marker.projectDir ?? "") !== projectDir ||
    path.dirname(path.resolve(marker.stagingDir ?? "")) !== parent ||
    !path.basename(marker.stagingDir ?? "").startsWith(expectedStagePrefix) ||
    path.resolve(marker.backupDir ?? "") !== `${path.resolve(marker.stagingDir ?? "")}.backup`
  ) {
    throw new Error(`Refusing malformed scaffold transaction marker: ${transactionPath}`);
  }
  if (marker.pid !== process.pid && processIsAlive(marker.pid)) {
    throw new Error(`Another scaffold process (${marker.pid}) is committing ${projectDir}`);
  }
  const targetExists = await pathExists(projectDir);
  const backupExists = await pathExists(marker.backupDir);
  if (!targetExists && backupExists) {
    await rename(marker.backupDir, projectDir);
  } else if (targetExists && backupExists) {
    await rm(marker.backupDir, { recursive: true, force: true });
  } else if (!targetExists) {
    throw new Error(`Interrupted scaffold cannot recover ${projectDir}: both target and backup are missing`);
  }
  if (await pathExists(marker.stagingDir)) await rm(marker.stagingDir, { recursive: true, force: true });
  await rm(transactionPath, { force: true });
}

function runFullMotionContractValidator(file) {
  const validator = path.join(TEMPLATE_DIR, "scripts/validate-motion-contract.mjs");
  const result = spawnSync(process.execPath, [validator, path.resolve(file)], { encoding: "utf8", timeout: 120_000 });
  if (result.error) throw new Error(`Motion-contract validator could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Motion contract failed the executor schema:\n${(result.stderr || result.stdout).trim()}`);
}

function replaceRequired(text, marker, replacement, label) {
  const occurrences = text.split(marker).length - 1;
  if (occurrences !== 1) throw new Error(`${label} requires exactly one ${marker} marker; found ${occurrences}`);
  return text.replace(marker, replacement);
}

async function assertSourcesExist(args) {
  const values = [
    args.audio,
    args.directorScript,
    args.productionSpec,
    args.assetPlan,
    args.motionContract,
    args.talkingHead,
    ...args.captions,
    ...args.screenRecordings,
    ...args.screenshots,
    ...args.fonts,
  ].filter(Boolean);
  for (const value of values) {
    const absolute = path.resolve(value);
    if (!(await isFile(absolute))) throw new Error(`Input file does not exist: ${absolute}`);
  }
}

async function assertRequiredDocumentsNonEmpty(args) {
  for (const [key, label] of [
    ["directorScript", "Director script"],
    ["productionSpec", "Production specification"],
    ["assetPlan", "Asset plan"],
    ["motionContract", "Motion contract"],
  ]) {
    if (!args[key]) continue;
    if ((await stat(path.resolve(args[key]))).size <= 0) {
      throw new Error(`${label} must contain at least one byte: ${path.resolve(args[key])}`);
    }
  }
}

function normalizedDuration(value) {
  return Number(Number(value).toFixed(3));
}

function durationText(value) {
  return String(normalizedDuration(value));
}

function buildPipContract(objectPositionXPercent, objectPositionYPercent) {
  const isDefaultProfile =
    objectPositionXPercent === DEFAULT_PIP_OBJECT_X && objectPositionYPercent === DEFAULT_PIP_OBJECT_Y;
  return {
    frameRegion: { x: 1610, y: 724, width: 206, height: 206, right: 104, bottom: 150, zIndex: 90 },
    mediaRegion: { x: 1618, y: 732, width: 190, height: 190, right: 112, bottom: 158, zIndex: 89 },
    sourceCrop: {
      fit: "cover",
      objectPositionXPercent,
      objectPositionYPercent,
      profile: isDefaultProfile ? "bozhou-digital-twin-v1" : "custom-review-required",
    },
    background: { mode: "pale-blue-gray-c", opaque: true, base: "#f2f6f8" },
    subjectSafeArea: {
      faceCenterXPercent: [48, 52],
      hairTopYPercent: [25, 32],
      eyeLineYPercent: [45, 52],
      chinYPercent: [68, 76],
      shoulderWidthPercent: [70, 90],
    },
    review: {
      staticBeforeMotion: true,
      encodedZoomRequired: true,
      crop: "300:300:1560:680",
      scale: "900:900",
    },
  };
}

async function preflight(args) {
  await assertSourcesExist(args);
  await assertRequiredDocumentsNonEmpty(args);
  if (args.audio) extensionFor(args.audio, "audio");
  if (args.talkingHead) extensionFor(args.talkingHead, "video");
  for (const item of args.screenRecordings) extensionFor(item, "video");
  for (const item of args.screenshots) extensionFor(item, "image");
  for (const item of args.fonts) extensionFor(item, "font");
  const suffixes = args.captions.map((item) => path.extname(item).toLowerCase());
  const unsupported = suffixes.find((suffix) => ![".json", ".srt", ".vtt"].includes(suffix));
  if (unsupported) throw new Error(`Unsupported caption format ${unsupported}. Use .json, .srt, or .vtt.`);
  for (const suffix of [".json", ".srt", ".vtt"]) {
    if (suffixes.filter((value) => value === suffix).length > 1) {
      throw new Error(`Only one ${suffix} caption input is allowed.`);
    }
  }

  const captionJson = args.captions.find((item) => path.extname(item).toLowerCase() === ".json");
  const captionSummary = captionJson ? await readAlignedCaptions(path.resolve(captionJson)) : null;
  const audioDuration = args.audio ? probeDuration(path.resolve(args.audio)) : null;
  if (args.audio && !audioDuration) throw new Error(`Locked audio cannot be decoded or has no duration: ${path.resolve(args.audio)}`);
  if (captionSummary && audioDuration) validateCaptionBounds(captionSummary.endSeconds, audioDuration);

  const talkingHeadDuration = args.talkingHead ? probeDuration(path.resolve(args.talkingHead)) : null;
  if (args.talkingHead && !talkingHeadDuration) {
    throw new Error(`Talking-head video cannot be decoded or has no duration: ${path.resolve(args.talkingHead)}`);
  }
  const screenRecordingDurations = [];
  for (const item of args.screenRecordings) {
    const duration = probeDuration(path.resolve(item));
    if (!duration) throw new Error(`Screen recording cannot be decoded or has no duration: ${path.resolve(item)}`);
    screenRecordingDurations.push(duration);
  }

  const contract = args.motionContract ? await readMotionContract(path.resolve(args.motionContract)) : null;
  if (args.motionContract) runFullMotionContractValidator(args.motionContract);
  if (contract) {
    const sources = {
      directorScript: args.directorScript,
      productionSpec: args.productionSpec,
      assetPlan: args.assetPlan,
      audio: args.audio,
      captionsAligned: captionJson,
    };
    for (const [key, source] of Object.entries(sources)) {
      if (!source) continue;
      const actualHash = await sha256(path.resolve(source));
      if (actualHash.toLowerCase() !== contract.sourceHashes[key].toLowerCase()) {
        throw new Error(`Motion contract sourceHashes.${key} does not match ${path.resolve(source)}`);
      }
    }
    if (audioDuration) requireNear(audioDuration, contract.timeline.audioDurationSeconds, "Audio duration");
    if (captionSummary) requireNear(captionSummary.endSeconds, contract.timeline.captionsEndSeconds, "Captions end");
  }

  const contractDuration = contract?.timeline.programDurationSeconds;
  const mediaDuration = audioDuration ?? talkingHeadDuration;
  let duration = contractDuration ?? args.duration ?? mediaDuration ?? 18;
  if (contractDuration === undefined && args.duration === undefined && mediaDuration !== null && mediaDuration !== undefined) {
    duration += 1.2;
  }

  return {
    audioDuration,
    captionJson,
    captionSummary,
    contract,
    duration: Number(duration),
    screenRecordingDurations,
    talkingHeadDuration,
  };
}

async function contentMigrationPolicy(projectDir, target, nextDuration) {
  if (!target.exists) return { preserveContent: false, migrateFactoryContent: false };

  const previousDuration = target.manifest?.durationSeconds;
  if (
    !Number.isFinite(previousDuration) ||
    normalizedDuration(previousDuration) === normalizedDuration(nextDuration)
  ) {
    return { preserveContent: true, migrateFactoryContent: false };
  }

  const contentPath = path.join(projectDir, "compositions/content.html");
  const current = await readFile(contentPath, "utf8");
  const factory = (await readFile(path.join(TEMPLATE_DIR, "compositions/content.html"), "utf8")).replaceAll(
    'data-duration="18"',
    `data-duration="${durationText(previousDuration)}"`,
  );
  if (current === factory) {
    return { preserveContent: true, migrateFactoryContent: true };
  }

  throw new Error(
    [
      `--force cannot migrate customized compositions/content.html from ${durationText(previousDuration)}s to ${durationText(nextDuration)}s.`,
      "The new motion contract would invalidate downstream-owned content timing.",
      "Migrate the composition to the new duration explicitly, then rerun with --force using matching locked inputs.",
    ].join(" "),
  );
}

async function ensureTarget(projectDir, force) {
  await validateProjectPath(projectDir);
  await recoverInterruptedCommit(projectDir);
  let entries = [];
  let directoryExists = true;
  try {
    entries = await readdir(projectDir);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    directoryExists = false;
  }
  if (entries.length > 0 && !force) {
    throw new Error(`${projectDir} already exists and is not empty. Re-run with --force to replace template-owned files.`);
  }
  if (entries.length === 0) return { exists: directoryExists, manifest: null };
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(projectDir, "manifest.json"), "utf8"));
  } catch (error) {
    throw new Error(`--force repair requires a readable existing manifest.json: ${error.message}`);
  }
  return { exists: true, manifest };
}

async function trustedHydratedPath(projectDir, record, label) {
  if (!record || typeof record.path !== "string" || record.path.trim() === "" || path.isAbsolute(record.path) || record.path.split(/[\\/]/).includes("..")) {
    throw new Error(`${label}.path must be a safe project-relative path`);
  }
  const root = await realpath(projectDir);
  const candidate = path.resolve(root, record.path);
  if (!inside(root, candidate)) throw new Error(`${label}.path escapes the existing project`);
  let cursor = root;
  for (const part of path.relative(root, candidate).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) throw new Error(`${label}.path must not traverse a symbolic link`);
  }
  const actual = await realpath(candidate);
  if (!inside(root, actual)) throw new Error(`${label}.path resolves outside the existing project`);
  const info = await stat(actual);
  if (!info.isFile()) throw new Error(`${label}.path is not a regular file`);
  if (!Number.isInteger(record.bytes) || record.bytes !== info.size) throw new Error(`${label}.bytes does not match the archived file`);
  if (!/^[a-f0-9]{64}$/i.test(record.sha256 ?? "") || (await sha256(actual)).toLowerCase() !== record.sha256.toLowerCase()) {
    throw new Error(`${label}.sha256 does not match the archived file`);
  }
  return actual;
}

async function hydrateArgs(args, projectDir, manifest) {
  if (!manifest) {
    return {
      args: {
        ...args,
        pipObjectX: args.pipObjectX ?? DEFAULT_PIP_OBJECT_X,
        pipObjectY: args.pipObjectY ?? DEFAULT_PIP_OBJECT_Y,
      },
      hydrated: new Set(),
    };
  }
  const next = { ...args, captions: [...args.captions], screenRecordings: [...args.screenRecordings], screenshots: [...args.screenshots], fonts: [...args.fonts] };
  const hydrated = new Set();
  const scalar = {
    directorScript: "directorScript",
    productionSpec: "productionSpec",
    assetPlan: "assetPlan",
    motionContract: "motionContract",
    audio: "audio",
    talkingHead: "talkingHead",
  };
  for (const [argKey, recordKey] of Object.entries(scalar)) {
    if (!next[argKey] && manifest.inputs?.[recordKey]?.path) {
      next[argKey] = await trustedHydratedPath(projectDir, manifest.inputs[recordKey], `manifest.inputs.${recordKey}`);
      hydrated.add(recordKey);
    }
  }
  if (next.captions.length === 0) {
    for (const recordKey of ["captionsAligned", "captionsSrt", "captionsVtt"]) {
      if (manifest.inputs?.[recordKey]?.path) {
        next.captions.push(await trustedHydratedPath(projectDir, manifest.inputs[recordKey], `manifest.inputs.${recordKey}`));
        hydrated.add(recordKey);
      }
    }
  }
  for (const [argKey, recordKey] of [["screenRecordings", "screenRecordings"], ["screenshots", "screenshots"], ["fonts", "fonts"]]) {
    if (next[argKey].length === 0 && Array.isArray(manifest.inputs?.[recordKey])) {
      next[argKey] = await Promise.all(manifest.inputs[recordKey].map((record, index) => trustedHydratedPath(projectDir, record, `manifest.inputs.${recordKey}[${index}]`)));
      hydrated.add(recordKey);
    }
  }
  if (args.title === "Talking Head HyperFrames Video" && typeof manifest.title === "string") next.title = manifest.title;
  if (args.duration === undefined && Number.isFinite(manifest.durationSeconds) && manifest.durationSeconds > 0) next.duration = manifest.durationSeconds;
  if (args.pipObjectX === undefined) {
    next.pipObjectX =
      manifest.fixedStage?.pipContract?.sourceCrop?.objectPositionXPercent ?? DEFAULT_PIP_OBJECT_X;
  }
  if (args.pipObjectY === undefined) {
    next.pipObjectY =
      manifest.fixedStage?.pipContract?.sourceCrop?.objectPositionYPercent ?? DEFAULT_PIP_OBJECT_Y;
  }
  if (manifest.fixedStage?.pipMode === "explicit-placeholder") next.showPipPlaceholder = true;
  return { args: next, hydrated };
}

async function copyTemplateFile(projectDir, relativePath) {
  const source = path.join(TEMPLATE_DIR, relativePath);
  const destination = path.join(projectDir, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

async function copyTemplate(projectDir, preserveContent) {
  await mkdir(projectDir, { recursive: true });
  for (const relativePath of OBSOLETE_FACTORY_FILES) {
    await rm(path.join(projectDir, relativePath), { force: true });
  }
  for (const relativePath of TEMPLATE_FILES) {
    if (preserveContent && DOWNSTREAM_TEMPLATE_FILES.has(relativePath) && (await isFile(path.join(projectDir, relativePath)))) continue;
    await copyTemplateFile(projectDir, relativePath);
  }
  const contentDestination = path.join(projectDir, "compositions/content.html");
  if (!preserveContent || !(await isFile(contentDestination))) await copyTemplateFile(projectDir, "compositions/content.html");

  const fontDir = path.join(TEMPLATE_DIR, "assets/fonts");
  for (const name of await readdir(fontDir)) {
    const source = path.join(fontDir, name);
    if (!(await isFile(source))) continue;
    const destination = path.join(projectDir, "assets/fonts", name);
    await mkdir(path.dirname(destination), { recursive: true });
    if (!(await isFile(destination))) await copyFile(source, destination);
  }
}

async function archiveFile(projectDir, sourceArg, relativePath, { durationSeconds = undefined } = {}) {
  if (!sourceArg) return null;
  const source = path.resolve(sourceArg);
  const destination = path.join(projectDir, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  if (await isFile(destination)) {
    const [existingHash, sourceHash] = await Promise.all([sha256(destination), sha256(source)]);
    if (existingHash !== sourceHash) {
      throw new Error(`Refusing to overwrite existing project asset ${relativePath}; move it or choose a clean project directory.`);
    }
  } else {
    await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
  }
  const info = await stat(destination);
  const [destinationHash, finalSourceHash] = await Promise.all([sha256(destination), sha256(source)]);
  if (destinationHash !== finalSourceHash) {
    throw new Error(`Source changed while archiving ${source}; retry with stable locked input bytes.`);
  }
  const record = {
    sourcePath: source,
    path: relativePath.split(path.sep).join("/"),
    sha256: destinationHash,
    bytes: info.size,
  };
  if (durationSeconds !== undefined) record.durationSeconds = durationSeconds;
  return record;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderCaptionText(caption) {
  if (Array.isArray(caption.parts) && caption.parts.length > 0) {
    return caption.parts
      .map((part) => `<span${part.accent === true ? ' class="accent"' : ""}>${escapeHtml(part.text)}</span>`)
      .join("");
  }
  return escapeHtml(caption.text);
}

async function renderCaptionOverlay(projectDir, duration, captionSummary) {
  const file = path.join(projectDir, "compositions/caption-overlay.html");
  let html = await readFile(file, "utf8");
  html = html.replaceAll('data-duration="18"', `data-duration="${durationText(duration)}"`);
  if (!captionSummary) {
    await writeFile(file, html);
    return;
  }

  const groups = captionSummary.captions.map((caption, index, all) => {
    const visibleEnd = Math.min(caption.end, all[index + 1]?.start ?? caption.end);
    const visibleDuration = normalizedDuration(visibleEnd - caption.start);
    return `    <div id="caption-group-${index}" class="caption-group clip" data-start="${durationText(caption.start)}" data-duration="${durationText(visibleDuration)}" data-track-index="100" aria-label="${escapeHtml(
      caption.text ?? caption.parts.map((part) => part.text).join(""),
    )}"><div id="caption-body-${index}" class="caption-line">${renderCaptionText(caption)}</div></div>`;
  });
  html = replaceRequired(
    html,
    "    <!-- HYPERFRAMES_CAPTION_GROUPS -->\n    <div class=\"caption-line\" aria-hidden=\"true\"></div>",
    groups.join("\n"),
    "caption group generation",
  );
  html = replaceRequired(
    html,
    "      /* HYPERFRAMES_CAPTION_STYLES */",
    `      .caption-group {\n        position: absolute;\n        inset: 0;\n        width: 1920px;\n        height: 1080px;\n        pointer-events: none;\n      }\n\n      .caption-group.clip {\n        visibility: hidden;\n      }`,
    "caption style generation",
  );
  const kills = captionSummary.captions
    .map(
      (caption, index) =>
        `      timeline.set("#caption-body-${index}", { opacity: 0, visibility: "hidden" }, ${durationText(caption.end)});`,
    )
    .join("\n");
  html = replaceRequired(html, "      /* HYPERFRAMES_CAPTION_KILLS */", kills, "caption timeline generation");
  await writeFile(file, html);
}

async function renderPipOverlay(projectDir, duration, talkingHead) {
  const file = path.join(projectDir, "compositions/pip-overlay.html");
  let html = await readFile(file, "utf8");
  html = html.replaceAll('data-duration="18"', `data-duration="${durationText(duration)}"`);
  if (talkingHead) {
    html = html.replace(
      `          <div class="avatar-placeholder" aria-hidden="true">\n            <div class="avatar-head"></div>\n            <div class="avatar-body"></div>\n          </div>`,
      "",
    );
    html = html.replace("background-color: rgba(255,255,255,0.92);", "background-color: transparent;");
    html = html.replace("background: #dcdce2;", "background: transparent;");
  }
  await writeFile(file, html);
}

async function renderFixedFiles(
  projectDir,
  {
    duration,
    audio,
    captionSummary,
    pipMounted,
    talkingHead,
    title,
    preserveContent,
    migrateFactoryContent,
    pipObjectX,
    pipObjectY,
  },
) {
  const durationValue = durationText(duration);
  const indexPath = path.join(projectDir, "index.html");
  let index = await readFile(indexPath, "utf8");
  index = index.replaceAll('data-duration="18"', `data-duration="${durationValue}"`);
  const mounts = [];
  if (pipMounted) {
    mounts.push(`      <div
        id="pip-mount"
        data-composition-id="pip-overlay"
        data-composition-src="compositions/pip-overlay.html"
        data-start="0"
        data-duration="${durationValue}"
        data-track-index="90"
        data-width="1920"
        data-height="1080"
      ></div>`);
  }
  if (talkingHead) {
    mounts.push(`      <div id="pip-media-wrapper" aria-label="Talking-head picture in picture">
        <video id="talking-head-video" class="clip" data-start="0" data-duration="${durationText(
          talkingHead.durationSeconds,
        )}" data-track-index="91" src="${escapeHtml(talkingHead.path)}" muted playsinline></video>
      </div>`);
  }
  if (audio) {
    mounts.push(
      `      <audio id="voice-audio" data-start="0" data-duration="${durationText(audio.durationSeconds)}" data-track-index="200" src="${escapeHtml(audio.path)}" data-volume="1"></audio>`,
    );
  }
  if (mounts.length > 0) {
    const marker = "    </div>\n\n    <script>";
    if (!index.includes(marker)) throw new Error("Template index.html is missing the fixed-stage root insertion marker");
    index = index.replace(marker, `${mounts.join("\n")}\n    </div>\n\n    <script>`);
  }
  await writeFile(indexPath, index);

  if (talkingHead) {
    const stylesPath = path.join(projectDir, "styles.css");
    const styles = await readFile(stylesPath, "utf8");
    await writeFile(
      stylesPath,
      `${styles}\n#pip-media-wrapper {\n  position: absolute;\n  right: 112px;\n  bottom: 158px;\n  width: 190px;\n  height: 190px;\n  overflow: hidden;\n  z-index: 89;\n  border-radius: 50%;\n  background-color: #f2f6f8;\n  background-image:\n    radial-gradient(circle at 50% 18%, rgba(255, 255, 255, 0.74) 0%, transparent 58%),\n    linear-gradient(180deg, #f2f6f8 0%, rgba(47, 111, 255, 0.30) 140%);\n  pointer-events: none;\n}\n\n#talking-head-video {\n  display: block;\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n  object-position: ${pipObjectX}% ${pipObjectY}%;\n}\n\n#talking-head-video.clip {\n  visibility: hidden;\n}\n`,
    );
  }

  const backgroundPath = path.join(projectDir, "compositions/studio-background.html");
  let background = await readFile(backgroundPath, "utf8");
  background = background
    .replaceAll('data-duration="18"', `data-duration="${durationValue}"`)
    .replace("const DURATION_SECONDS = 18;", `const DURATION_SECONDS = ${durationValue};`);
  await writeFile(backgroundPath, background);

  const contentPath = path.join(projectDir, "compositions/content.html");
  if (!preserveContent || migrateFactoryContent) {
    const content = (await readFile(contentPath, "utf8")).replaceAll(
      /data-duration="(?:18|\d+(?:\.\d+)?)"/g,
      `data-duration="${durationValue}"`,
    );
    await writeFile(contentPath, content);
  }

  await renderCaptionOverlay(projectDir, duration, captionSummary);
  await renderPipOverlay(projectDir, duration, talkingHead);

  const metaPath = path.join(projectDir, "meta.json");
  const meta = JSON.parse(await readFile(metaPath, "utf8"));
  meta.name = title;
  meta.duration = duration;
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

  const endSample = Math.max(0, normalizedDuration(duration - 1 / 30));
  const samples = [...new Set([0, Math.min(4, endSample), Math.min(9, endSample), endSample].map(normalizedDuration))].sort((a, b) => a - b);
  const packagePath = path.join(projectDir, "package.json");
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  pkg.scripts.inspect = `npx --yes hyperframes@0.7.65 inspect --at ${samples.join(",")} --strict`;
  pkg.scripts["snapshot:stage"] = `npx --yes hyperframes@0.7.65 snapshot --at ${samples.slice(0, 3).join(",")} --no-end --output snapshots/stage --describe false`;
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function createRecords(projectDir, args, preflightResult) {
  const captionBySuffix = Object.fromEntries(
    args.captions.map((item) => [path.extname(item).toLowerCase(), item]),
  );
  const records = {
    directorScript: await archiveFile(projectDir, args.directorScript, "inputs/视频脚本.md"),
    productionSpec: await archiveFile(projectDir, args.productionSpec, "inputs/制作规格.md"),
    assetPlan: await archiveFile(projectDir, args.assetPlan, "inputs/素材计划.md"),
    motionContract: await archiveFile(projectDir, args.motionContract, "inputs/motion-contract.json"),
    audio: await archiveFile(
      projectDir,
      args.audio,
      args.audio ? `assets/audio/voice/voice${extensionFor(args.audio, "audio")}` : "",
      { durationSeconds: preflightResult.audioDuration },
    ),
    talkingHead: await archiveFile(
      projectDir,
      args.talkingHead,
      args.talkingHead ? `assets/video/talking-head/talking-head${extensionFor(args.talkingHead, "video")}` : "",
      { durationSeconds: preflightResult.talkingHeadDuration },
    ),
    captionsAligned: await archiveFile(
      projectDir,
      captionBySuffix[".json"],
      "inputs/captions/captions_aligned.json",
    ),
    captionsSrt: await archiveFile(projectDir, captionBySuffix[".srt"], "inputs/captions/captions.srt"),
    captionsVtt: await archiveFile(projectDir, captionBySuffix[".vtt"], "inputs/captions/captions.vtt"),
    screenRecordings: [],
    screenshots: [],
    fonts: [],
  };
  for (const [index, source] of args.screenRecordings.entries()) {
    records.screenRecordings.push(
      await archiveFile(
        projectDir,
        source,
        `assets/video/screen-recordings/screen-${String(index + 1).padStart(2, "0")}${extensionFor(source, "video")}`,
        { durationSeconds: preflightResult.screenRecordingDurations[index] },
      ),
    );
  }
  for (const [index, source] of args.screenshots.entries()) {
    records.screenshots.push(
      await archiveFile(
        projectDir,
        source,
        `assets/images/screenshots/screenshot-${String(index + 1).padStart(2, "0")}${extensionFor(source, "image")}`,
      ),
    );
  }
  for (const [index, source] of args.fonts.entries()) {
    records.fonts.push(await archiveFile(projectDir, source, `assets/fonts/custom-${String(index + 1).padStart(2, "0")}${extensionFor(source, "font")}`));
  }
  return records;
}

function preserveHydratedProvenance(records, existingInputs, hydrated) {
  if (!existingInputs) return records;
  for (const key of hydrated) {
    if (Array.isArray(records[key]) && Array.isArray(existingInputs[key])) {
      records[key] = records[key].map((record, index) => ({ ...record, sourcePath: existingInputs[key][index]?.sourcePath ?? record.sourcePath }));
    } else if (records[key] && existingInputs[key]) {
      records[key].sourcePath = existingInputs[key].sourcePath ?? records[key].sourcePath;
    }
  }
  return records;
}

async function internalRecord(projectDir, relativePath) {
  const absolute = path.join(projectDir, relativePath);
  const info = await stat(absolute);
  return { path: relativePath, sha256: await sha256(absolute), bytes: info.size };
}

function buildMissingInputs(records) {
  return REQUIRED_INPUTS.filter((item) => !records[item.id]).map((item) => ({ ...item, actualPath: null }));
}

function inputRows(records) {
  const rows = [
    ["Director script", records.directorScript],
    ["Production spec", records.productionSpec],
    ["Asset plan", records.assetPlan],
    ["Motion contract", records.motionContract],
    ["Voice audio", records.audio],
    ["Aligned captions", records.captionsAligned],
    ["SRT captions", records.captionsSrt],
    ["VTT captions", records.captionsVtt],
    ["Talking-head video", records.talkingHead],
  ];
  return rows.map(([label, record]) => {
    if (!record) return `| ${label} | MISSING | — | — |`;
    const cell = (value) => String(value).replaceAll("|", "\\|").replaceAll("`", "\\`").replace(/[\r\n]+/g, " ");
    return `| ${label} | \`${cell(record.path)}\` | \`${cell(record.sha256)}\` | \`${cell(record.sourcePath)}\` |`;
  });
}

async function writeHandoff(projectDir, manifest) {
  const lines = [
    "# Template Handoff",
    "",
    `- Project: ${manifest.title}`,
    `- Status: \`${manifest.status}\``,
    `- Duration: \`${manifest.durationSeconds}s\` at \`30fps\``,
    `- Fixed stage: \`${manifest.fixedStage.version}\` (background / content / caption${manifest.fixedStage.pipMounted ? " / optional PIP" : ""}${manifest.inputs.audio ? " / voice" : ""})`,
    `- PIP contract: frame \`206px @ right 104 / bottom 150\`; media \`190px @ right 112 / bottom 158\`; crop \`${manifest.fixedStage.pipContract.sourceCrop.objectPositionXPercent}% ${manifest.fixedStage.pipContract.sourceCrop.objectPositionYPercent}%\`; background \`opaque ${manifest.fixedStage.pipContract.background.base}\`.`,
    `- DESIGN.md: \`${manifest.design.sha256}\``,
    "- Content motion default: `none`; global scene transition: `none`.",
    "",
    "## Locked inputs",
    "",
    "| Input | Project path | SHA-256 | Source path |",
    "|---|---|---|---|",
    ...inputRows(manifest.inputs),
    "",
    "## Fixed boundary",
    "",
    "The factory owns the fixed background, root mounts, caption overlay, optional stable PIP, voice mount, DESIGN.md, manifest, and template checks. `content.html`, `compositions/scenes/`, semantic motion, transitions, sound design, proof, and review execution belong downstream.",
    "",
  ];
  if (manifest.missingInputs.length > 0) {
    lines.push("## Missing before execution", "");
    for (const item of manifest.missingInputs) {
      lines.push(`- **${item.id}**: ${item.action} Expected project path: \`${item.expectedPath}\`. Actual: not provided.`);
    }
    lines.push(
      "",
      "## Next step",
      "",
      "Do not invoke a scene executor. Supply every item above and rerun this factory with `--force`.",
      "",
    );
  } else {
    lines.push(
      "## Next step",
      "",
      "Invoke `hyperframes-scene-animator`. It is the sole owner of shot implementation, scene motion, transitions, sound, proof, review, and revisions.",
      "",
    );
  }
  const file = path.join(projectDir, "review/template-handoff.md");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, lines.join("\n"));
}

async function commitStagedProject(stagingDir, projectDir, targetExists) {
  if (!targetExists) {
    await rename(stagingDir, projectDir);
    return;
  }
  const backupDir = `${stagingDir}.backup`;
  const transactionPath = scaffoldTransactionPath(projectDir);
  await writeFile(transactionPath, `${JSON.stringify({ version: 1, pid: process.pid, projectDir, stagingDir, backupDir }, null, 2)}\n`, { flag: "wx" });
  await rename(projectDir, backupDir);
  try {
    await rename(stagingDir, projectDir);
  } catch (error) {
    await rename(backupDir, projectDir);
    await rm(transactionPath, { force: true });
    throw error;
  }
  await rm(backupDir, { recursive: true, force: true });
  await rm(transactionPath, { force: true });
}

async function main() {
  let stagingDir = null;
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    const projectDir = path.resolve(args.projectDir);
    const target = await ensureTarget(projectDir, args.force);
    const hydrated = await hydrateArgs(args, projectDir, target.manifest);
    args = hydrated.args;
    const preflightResult = await preflight(args);
    const contentPolicy = await contentMigrationPolicy(projectDir, target, preflightResult.duration);
    stagingDir = await mkdtemp(path.join(path.dirname(projectDir), `.${path.basename(projectDir)}.stage-`));
    if (target.exists) await cp(projectDir, stagingDir, { recursive: true, errorOnExist: false, force: true, dereference: false });
    await copyTemplate(stagingDir, target.exists);
    const records = preserveHydratedProvenance(
      await createRecords(stagingDir, args, preflightResult),
      target.manifest?.inputs,
      hydrated.hydrated,
    );
    if (preflightResult.contract) {
      for (const key of ["directorScript", "productionSpec", "assetPlan", "audio", "captionsAligned"]) {
        if (records[key] && records[key].sha256.toLowerCase() !== preflightResult.contract.sourceHashes[key].toLowerCase()) {
          throw new Error(`Archived ${key} bytes no longer match motion contract sourceHashes.${key}`);
        }
      }
    }
    const pipMounted = Boolean(records.talkingHead || args.showPipPlaceholder);
    await renderFixedFiles(stagingDir, {
      duration: preflightResult.duration,
      audio: records.audio,
      captionSummary: preflightResult.captionSummary,
      pipMounted,
      preserveContent: contentPolicy.preserveContent,
      migrateFactoryContent: contentPolicy.migrateFactoryContent,
      talkingHead: records.talkingHead,
      title: args.title,
      pipObjectX: args.pipObjectX,
      pipObjectY: args.pipObjectY,
    });
    const missingInputs = buildMissingInputs(records);
    const status = missingInputs.length === 0 ? "READY_FOR_EXECUTION" : "TEMPLATE_ONLY";
    const design = await internalRecord(stagingDir, "DESIGN.md");
    const manifest = {
      schemaVersion: 1,
      title: args.title,
      status,
      durationSeconds: preflightResult.duration,
      fixedStage: {
        version: FIXED_STAGE_VERSION,
        compositionId: "studio-fixed-stage",
        geometryContract: "studio-blue-gold-narrow-center-grid-v2",
        width: 1920,
        height: 1080,
        fps: 30,
        background: "studio-background",
        content: "content",
        captions: "caption-overlay",
        pipMounted,
        pipMode: records.talkingHead ? "talking-head-video" : pipMounted ? "explicit-placeholder" : "absent",
        pipContract: buildPipContract(args.pipObjectX, args.pipObjectY),
        contentMotionDefault: "none",
        globalSceneTransition: "none",
      },
      design,
      inputs: records,
      motionContract: preflightResult.contract
        ? { version: preflightResult.contract.version, pipeline: preflightResult.contract.pipeline }
        : null,
      validation: {
        audioDecodable: Boolean(records.audio && preflightResult.audioDuration),
        alignedCaptionCount: preflightResult.captionSummary?.count ?? null,
        alignedCaptionsEndSeconds: preflightResult.captionSummary?.endSeconds ?? null,
        captionBoundsValid: Boolean(
          records.audio && records.captionsAligned && preflightResult.audioDuration && preflightResult.captionSummary,
        ),
        contractSchemaValid: Boolean(preflightResult.contract),
        contractSourcesMatch: Boolean(preflightResult.contract && missingInputs.length === 0),
      },
      missingInputs,
      nextSkill: status === "READY_FOR_EXECUTION" ? "hyperframes-scene-animator" : null,
    };
    await writeFile(path.join(stagingDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeHandoff(stagingDir, manifest);
    await commitStagedProject(stagingDir, projectDir, target.exists);
    stagingDir = null;
    console.log(projectDir);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (stagingDir) await rm(stagingDir, { recursive: true, force: true });
  }
}

await main();
