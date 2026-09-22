#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { approvalDecisionSha256, canonicalProjectRoot, projectFingerprint, safeProjectPath, sha256File, sha256Text, trustedExecutable } from "./project-integrity.mjs";

const argv = process.argv.slice(2);
const promotionCheck = argv.includes("--promotion-check");
const positional = argv.filter((item) => item !== "--promotion-check");
if (positional.length < 1 || positional.length > 2) {
  console.error("Usage: node validate_project_proof.mjs <project-dir> [review/proof-manifest-v1.json] [--promotion-check]");
  process.exit(2);
}

const projectDir = canonicalProjectRoot(path.resolve(positional[0]));
const proofPath = safeProjectPath(projectDir, positional[1] ?? "review/proof-manifest-v1.json", { type: "file" });
const errors = [];
const add = (code, location, message) => errors.push({ code, location, message });
const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const allowedReportStatuses = new Set(["PASS", "FAIL", "NOT_APPLICABLE"]);

function readJson(file, code) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    add(code, path.relative(projectDir, file) || file, error.message);
    return null;
  }
}

function projectPath(relative, location) {
  try {
    return safeProjectPath(projectDir, relative, { mustExist: false });
  } catch (error) {
    add("PROOF_EVIDENCE_PATH", location, error.message);
    return null;
  }
}

function requireEvidenceFile(relative, location) {
  const file = projectPath(relative, location);
  if (!file) return null;
  try {
    const safe = safeProjectPath(projectDir, relative, { type: "file" });
    const info = fs.statSync(safe);
    if (!info.isFile() || info.size === 0) add("PROOF_EVIDENCE_PATH", location, `${relative} is missing, empty, or not a file`);
    return safe;
  } catch {
    add("PROOF_EVIDENCE_PATH", location, `${relative} does not exist`);
  }
  return null;
}

function parseRate(value) {
  if (typeof value !== "string") return Number.NaN;
  const [numerator, denominator = "1"] = value.split("/").map(Number);
  return denominator ? numerator / denominator : Number.NaN;
}

function probeMedia(file, location) {
  let ffprobe;
  try {
    ffprobe = trustedExecutable("ffprobe", projectDir);
  } catch (error) {
    add("PROOF_PREVIEW_DECODE", location, error.message);
    return null;
  }
  const result = spawnSync(ffprobe, [
    "-v", "error",
    "-show_entries", "format=duration,size:stream=index,codec_type,width,height,avg_frame_rate,r_frame_rate,duration",
    "-of", "json",
    file,
  ], { encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    add("PROOF_PREVIEW_DECODE", location, `ffprobe could not decode ${path.relative(projectDir, file)}: ${result.error?.message ?? (result.stderr ?? "").trim()}`);
    return null;
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    add("PROOF_PREVIEW_DECODE", location, `invalid ffprobe JSON: ${error.message}`);
    return null;
  }
}

function validatePreview(relative, location, expected) {
  const file = requireEvidenceFile(relative, location);
  if (!file || !fs.existsSync(file)) return null;
  const probe = probeMedia(file, location);
  if (!probe) return null;
  const video = probe.streams?.find((stream) => stream.codec_type === "video");
  const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
  if (!video) add("PROOF_PREVIEW_DECODE", location, "preview has no video stream");
  else {
    if (video.width !== expected.width || video.height !== expected.height) {
      add("PROOF_PREVIEW_DIMENSIONS", location, `must be ${expected.width}x${expected.height}; received ${video.width}x${video.height}`);
    }
    const fps = parseRate(video.avg_frame_rate || video.r_frame_rate);
    if (!Number.isFinite(fps) || Math.abs(fps - expected.fps) > 0.01) {
      add("PROOF_PREVIEW_FPS", location, `must be ${expected.fps}fps; received ${Number.isFinite(fps) ? fps : "unknown"}`);
    }
  }
  if (!audio) add("PROOF_PREVIEW_AUDIO", location, "preview must contain the locked voice audio stream");
  const duration = Number(probe.format?.duration);
  if (!Number.isFinite(duration) || Math.abs(duration - expected.durationSeconds) > Math.max(0.08, 2 / expected.fps)) {
    add("PROOF_PREVIEW_DURATION", location, `must be ${expected.durationSeconds}s within two frames; received ${probe.format?.duration ?? "unknown"}`);
  }
  if (Number(probe.format?.size ?? 0) <= 1000) add("PROOF_PREVIEW_DECODE", location, "preview file is unexpectedly small");
  return { file, probe };
}

if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
  console.error(`[PROOF_PROJECT] Project directory does not exist: ${projectDir}`);
  process.exit(2);
}

const manifest = readJson(path.join(projectDir, "manifest.json"), "PROOF_PROJECT_MANIFEST");
const source = readJson(path.join(projectDir, "inputs", "motion-contract.json"), "PROOF_SOURCE_CONTRACT");
const adaptation = readJson(path.join(projectDir, "runtime-adaptation.json"), "PROOF_RUNTIME_ADAPTATION");
const pkg = readJson(path.join(projectDir, "package.json"), "PROOF_PACKAGE");
const proof = readJson(proofPath, "PROOF_MANIFEST");

function runCurrentValidator(id, args) {
  const result = spawnSync(process.execPath, args, { cwd: projectDir, encoding: "utf8", timeout: 180_000 });
  if (result.error || result.status !== 0) {
    add("PROOF_CURRENT_GATE", id, `${result.error?.message ?? "validator failed"}\n${result.stdout ?? ""}${result.stderr ?? ""}`.trim());
  }
}

runCurrentValidator("check:inputs", ["scripts/check-inputs.mjs", projectDir]);
runCurrentValidator("check:fixed-stage", ["scripts/check-fixed-stage.mjs", projectDir]);
runCurrentValidator("check:motion-contract", ["scripts/validate-motion-contract.mjs", "inputs/motion-contract.json"]);
runCurrentValidator("check:runtime-adaptation", ["scripts/validate-runtime-adaptation.mjs", "runtime-adaptation.json", "inputs/motion-contract.json", "--html", "compositions/content.html"]);

if (manifest?.status !== "READY_FOR_EXECUTION") {
  add("PROOF_PROJECT_STATUS", "manifest.json.status", 'must remain "READY_FOR_EXECUTION"');
}
if (proof?.version !== 1) add("PROOF_VERSION", "version", "must equal 1");
if (!Number.isInteger(proof?.proofVersion) || proof.proofVersion < 1) add("PROOF_VERSION", "proofVersion", "must be a positive integer");
const currentProjectFingerprint = projectFingerprint(projectDir).sha256;
if (proof?.projectFingerprint !== currentProjectFingerprint) {
  add("PROOF_STALE", "projectFingerprint", `must match current project bytes (${currentProjectFingerprint})`);
}

const expected = {
  width: manifest?.fixedStage?.width ?? 1920,
  height: manifest?.fixedStage?.height ?? 1080,
  fps: manifest?.fixedStage?.fps ?? 30,
  durationSeconds: manifest?.durationSeconds,
};
if (expected.width !== 1920 || expected.height !== 1080 || expected.fps !== 30 || !finite(expected.durationSeconds)) {
  add("PROOF_PROJECT_FORMAT", "manifest.json", "must declare a finite 1920x1080@30 program");
}

const pinned = "npx --yes hyperframes@0.7.65";
const requiredScripts = {
  "proof:prepare": "node scripts/proof-prepare.mjs",
  "proof:stage": "node scripts/proof-gate.mjs stage",
  "proof:doctor": "node scripts/proof-gate.mjs doctor",
  "proof:lint": "node scripts/proof-gate.mjs lint",
  "proof:validate": "node scripts/proof-gate.mjs validate",
  "proof:inspect": "node scripts/proof-gate.mjs inspect",
  "proof:check": "node scripts/proof-gate.mjs check",
  "proof:snapshots": "node scripts/proof-gate.mjs snapshot",
  "proof:animation-map": "node scripts/proof-gate.mjs animation-map",
  "proof:render-internal": "node scripts/proof-gate.mjs render",
  "proof:contact-sheet": "node scripts/proof-gate.mjs contact-sheet",
  "proof:media": "node scripts/proof-gate.mjs media",
  "proof:validate-bundle": "node scripts/validate-project-proof.mjs . review/proof-manifest-v1.json",
  "proof:preview-v1": "node scripts/promote-preview.mjs",
};
for (const [name, expectedCommand] of Object.entries(requiredScripts)) {
  if (pkg?.scripts?.[name] !== expectedCommand) add("PROOF_SCRIPT_MISSING", `package.json.scripts.${name}`, `must equal ${JSON.stringify(expectedCommand)}`);
}
for (const [name, command] of Object.entries(pkg?.scripts ?? {})) {
  if (typeof command !== "string") continue;
  if (/\bhyperframes(?:@|\s)/i.test(command) && !command.startsWith(pinned)) {
    add("PROOF_CLI_PIN", `package.json.scripts.${name}`, `every HyperFrames command must start with ${pinned}`);
  }
  if (/hyperframes@(latest|\^|~|\*)/i.test(command) || /\bnpx\s+hyperframes\b/.test(command)) {
    add("PROOF_CLI_PIN", `package.json.scripts.${name}`, "contains an unbounded HyperFrames version");
  }
}

const requiredGates = ["inputs", "fixed-stage", "motion-contract", "runtime-adaptation", "stage", "doctor", "lint", "validate", "inspect", "check", "snapshot", "animation-map", "render", "contact-sheet", "media"];
const acceptanceTimes = [...new Set((source?.beats ?? []).flatMap((beat) => (beat.acceptanceFrames ?? []).map((frame) => frame.atSeconds)))].sort((a, b) => a - b);
const canonicalGateCommands = {
  inputs: ["node", "scripts/check-inputs.mjs", "."],
  "fixed-stage": ["node", "scripts/check-fixed-stage.mjs", "."],
  "motion-contract": ["node", "scripts/validate-motion-contract.mjs", "inputs/motion-contract.json"],
  "runtime-adaptation": ["node", "scripts/validate-runtime-adaptation.mjs", "runtime-adaptation.json", "inputs/motion-contract.json", "--html", "compositions/content.html"],
  stage: ["node", "scripts/proof-stage.mjs"],
  doctor: ["npx", "--yes", "hyperframes@0.7.65", "doctor"],
  lint: ["npx", "--yes", "hyperframes@0.7.65", "lint"],
  validate: ["npx", "--yes", "hyperframes@0.7.65", "validate"],
  inspect: ["npx", "--yes", "hyperframes@0.7.65", "inspect", "--at", acceptanceTimes.join(","), "--at-transitions", "--strict"],
  check: ["npx", "--yes", "hyperframes@0.7.65", "check"],
  snapshot: ["npx", "--yes", "hyperframes@0.7.65", "snapshot", "--at", acceptanceTimes.join(","), "--no-end", "--output", "snapshots/acceptance", "--describe", "false"],
  "animation-map": ["node", "scripts/build-animation-map.mjs"],
  render: ["npx", "--yes", "hyperframes@0.7.65", "render", "--quality", "draft", "--fps", "30", "--resolution", "1080p", "--workers", "2", "--output", "renders/internal-preview-v1.mp4"],
  "contact-sheet": ["node", "scripts/build-contact-sheet.mjs"],
  media: ["node", "scripts/analyze-preview.mjs", "--input", "renders/internal-preview-v1.mp4", "--output", "review/media-analysis-v1.json"],
};
const gates = Array.isArray(proof?.commandGates) ? proof.commandGates : [];
const gateById = new Map();
for (const [index, gate] of gates.entries()) {
  if (!nonEmpty(gate?.id)) {
    add("PROOF_GATE_MISSING", `commandGates[${index}].id`, "is required");
    continue;
  }
  if (gateById.has(gate.id)) add("PROOF_GATE_MISSING", `commandGates[${index}].id`, `duplicates ${gate.id}`);
  gateById.set(gate.id, gate);
  if (gate.status !== "PASS") add("PROOF_GATE_STATUS", `commandGates.${gate.id}.status`, "must be PASS");
  const evidenceFile = requireEvidenceFile(gate.evidence, `commandGates.${gate.id}.evidence`);
  const receiptFile = requireEvidenceFile(gate.receipt, `commandGates.${gate.id}.receipt`);
  if (receiptFile) {
    const receipt = readJson(receiptFile, "PROOF_GATE_RECEIPT");
    const currentFingerprint = projectFingerprint(projectDir).sha256;
    if (receipt?.id !== gate.id || receipt?.status !== "PASS" || receipt?.exitCode !== 0 || receipt?.timedOut === true) {
      add("PROOF_GATE_RECEIPT", `commandGates.${gate.id}.receipt`, "must record the matching successful non-timeout gate");
    }
    if (JSON.stringify(receipt?.command) !== JSON.stringify(canonicalGateCommands[gate.id])) {
      add("PROOF_GATE_RECEIPT", `commandGates.${gate.id}.receipt`, "does not record the canonical trusted command argv");
    }
    if (receipt?.projectFingerprint !== currentFingerprint) add("PROOF_STALE", `commandGates.${gate.id}.receipt`, "was produced for different project bytes");
    if (receipt?.cliVersion !== (receipt?.command?.includes("hyperframes@0.7.65") ? "0.7.65" : "project-local")) add("PROOF_CLI_PIN", `commandGates.${gate.id}.receipt`, "records the wrong CLI version");
    if (receipt?.commandSha256 !== sha256Text(JSON.stringify(receipt?.command))) add("PROOF_GATE_RECEIPT", `commandGates.${gate.id}.receipt`, "command digest mismatch");
    if (evidenceFile && receipt?.logSha256 !== sha256File(evidenceFile)) add("PROOF_GATE_RECEIPT", `commandGates.${gate.id}.receipt`, "log digest mismatch");
    if (receipt?.log !== gate.evidence) add("PROOF_GATE_RECEIPT", `commandGates.${gate.id}.receipt`, "does not bind the declared evidence log");
    if (new Set(["stage", "snapshot", "animation-map", "render", "contact-sheet", "media"]).has(gate.id) && !(receipt?.artifacts?.length > 0)) {
      add("PROOF_GATE_RECEIPT", `commandGates.${gate.id}.artifacts`, "must bind generated artifacts");
    }
    for (const [artifactIndex, artifact] of (receipt?.artifacts ?? []).entries()) {
      const artifactFile = requireEvidenceFile(artifact?.path, `commandGates.${gate.id}.artifacts[${artifactIndex}]`);
      if (artifactFile && (sha256File(artifactFile) !== artifact.sha256 || fs.statSync(artifactFile).size !== artifact.bytes)) {
        add("PROOF_GATE_RECEIPT", `commandGates.${gate.id}.artifacts[${artifactIndex}]`, "artifact digest or byte count mismatch");
      }
    }
  }
}
for (const id of requiredGates) {
  if (!gateById.has(id)) add("PROOF_GATE_MISSING", "commandGates", `missing ${id}`);
}
const stageReceiptPath = requireEvidenceFile("review/stage-parity/stage-parity-receipt.json", "stageParity.receipt");
const stageReceipt = stageReceiptPath ? readJson(stageReceiptPath, "PROOF_STAGE_PARITY") : null;
if (stageReceipt?.threshold !== 0.995 || stageReceipt?.comparisons?.length !== 3) {
  add("PROOF_STAGE_PARITY", "stageParity.receipt", "must contain the three 0/4/9s comparisons at threshold 0.995");
} else {
  for (const comparison of stageReceipt.comparisons) {
    const golden = requireEvidenceFile(comparison.golden, `stageParity.${comparison.atSeconds}.golden`);
    const candidate = requireEvidenceFile(comparison.candidate, `stageParity.${comparison.atSeconds}.candidate`);
    if (golden && sha256File(golden) !== comparison.goldenSha256) add("PROOF_STAGE_PARITY", `stageParity.${comparison.atSeconds}.goldenSha256`, "golden digest mismatch");
    if (candidate && sha256File(candidate) !== comparison.candidateSha256) add("PROOF_STAGE_PARITY", `stageParity.${comparison.atSeconds}.candidateSha256`, "candidate digest mismatch");
    if (comparison.ssim < 0.995) add("PROOF_STAGE_PARITY", `stageParity.${comparison.atSeconds}.ssim`, "must be at least 0.995");
  }
}

const evidence = Array.isArray(proof?.evidence) ? proof.evidence : [];
const evidenceByRole = new Map();
for (const [index, item] of evidence.entries()) {
  if (!nonEmpty(item?.id)) add("PROOF_EVIDENCE_ROLE", `evidence[${index}].id`, "is required");
  if (!nonEmpty(item?.role)) add("PROOF_EVIDENCE_ROLE", `evidence[${index}].role`, "is required");
  if (!allowedReportStatuses.has(item?.status)) {
    add("PROOF_STATUS", `evidence[${index}].status`, "must be PASS, FAIL, or NOT_APPLICABLE");
  }
  requireEvidenceFile(item?.path, `evidence[${index}].path`);
  if (nonEmpty(item?.role)) evidenceByRole.set(item.role, [...(evidenceByRole.get(item.role) ?? []), item]);
}

function requireRole(role, { count = 1, status = "PASS" } = {}) {
  const items = evidenceByRole.get(role) ?? [];
  if (items.length < count) add("PROOF_EVIDENCE_ROLE", "evidence", `missing ${role} evidence (need ${count}, received ${items.length})`);
  for (const item of items) {
    if (item.status !== status) add("PROOF_EVIDENCE_STATUS", `evidence.${item.id}.status`, `${role} must be ${status}`);
  }
  return items;
}

const sourceAcceptance = (adaptation?.acceptanceMappings ?? []).map((item) => `${item.beatId}@${item.sourceAtSeconds}#${item.sourceRole}`);
const acceptanceItems = requireRole("source_acceptance", { count: sourceAcceptance.length });
const acceptanceByKey = new Map(acceptanceItems.map((item) => [item.sourceKey, item]));
for (const key of sourceAcceptance) {
  if (!acceptanceByKey.has(key)) add("PROOF_SOURCE_ACCEPTANCE", "evidence.source_acceptance", `missing ${key}`);
}
if (acceptanceItems.length !== sourceAcceptance.length) {
  add("PROOF_SOURCE_ACCEPTANCE", "evidence.source_acceptance", `must contain exactly ${sourceAcceptance.length} source frames`);
}
for (const item of adaptation?.acceptanceMappings ?? []) {
  const key = `${item.beatId}@${item.sourceAtSeconds}#${item.sourceRole}`;
  const proofItem = acceptanceByKey.get(key);
  if (proofItem && proofItem.path !== item.path) {
    add("PROOF_SOURCE_ACCEPTANCE", `evidence.${proofItem.id}.path`, `must equal runtime mapping ${item.path}`);
  }
}

const cueBeforeCount = sourceAcceptance.filter((key) => key.endsWith("#cue_before")).length;
const cueAfterCount = sourceAcceptance.filter((key) => key.endsWith("#cue_after")).length;
requireRole("cue_before", { count: cueBeforeCount });
requireRole("cue_after", { count: cueAfterCount });
requireRole("chapter_state");
requireRole("density_state");
requireRole("widest_caption");
requireRole("audio_first_region");
requireRole("audio_last_region");
requireRole("full_watch_decode");
requireRole("black_tail");
requireRole("silent_tail");
requireRole("animation_map");
requireRole("contact_sheet");
requireRole("internal_preview");
requireRole("executor_report");
requireRole("lead_review");
if (!promotionCheck) requireRole("preview_v1");

const transitionIds = (adaptation?.scenes ?? []).map((scene) => scene.transitionOut?.transitionId).filter(Boolean);
const transitionItems = requireRole("transition_midpoint", { count: transitionIds.length });
for (const id of transitionIds) {
  if (!transitionItems.some((item) => item.transitionId === id)) {
    add("PROOF_EVIDENCE_ROLE", "evidence.transition_midpoint", `missing ${id}`);
  }
}
const holdBeatIds = (source?.beats ?? []).filter((beat) => beat.mode === "readable-hold").map((beat) => beat.beatId);
const holdItems = requireRole("readable_hold", { count: holdBeatIds.length });
for (const id of holdBeatIds) {
  if (!holdItems.some((item) => item.beatId === id)) add("PROOF_EVIDENCE_ROLE", "evidence.readable_hold", `missing ${id}`);
}

const pipItems = evidenceByRole.get("pip_crop") ?? [];
if (pipItems.length !== 1) add("PROOF_EVIDENCE_ROLE", "evidence.pip_crop", "requires exactly one PIP disposition");
else {
  const expectedPip = manifest?.fixedStage?.pipMounted ? "PASS" : "NOT_APPLICABLE";
  if (pipItems[0].status !== expectedPip) add("PROOF_EVIDENCE_STATUS", "evidence.pip_crop.status", `must be ${expectedPip}`);
  if (manifest?.fixedStage?.pipMounted) {
    if (pipItems[0].path !== "review/pip/internal-preview-v1-crop-3x.png") {
      add("PROOF_PIP_REVIEW", "evidence.pip_crop.path", "must use the fixed 3x crop from the actual internal preview");
    }
    const pipReviewPath = requireEvidenceFile("review/pip/internal-preview-v1-review.json", "review.pip");
    const pipReview = pipReviewPath ? readJson(pipReviewPath, "PROOF_PIP_REVIEW") : null;
    if (pipReview?.status !== "PASS") add("PROOF_PIP_REVIEW", "review.pip.status", "must equal PASS after human visual review");
    if (pipReview?.evidence?.crop3x !== "review/pip/internal-preview-v1-crop-3x.png") {
      add("PROOF_PIP_REVIEW", "review.pip.evidence.crop3x", "must reference the fixed 3x crop");
    }
    if (pipReview?.acceptance?.noStageGridInsideCircle !== true) {
      add("PROOF_PIP_REVIEW", "review.pip.acceptance.noStageGridInsideCircle", "must be explicitly approved");
    }
    if (pipReview?.acceptance?.subjectInsideSafeArea !== true) {
      add("PROOF_PIP_REVIEW", "review.pip.acceptance.subjectInsideSafeArea", "must be explicitly approved");
    }
    const previewPath = requireEvidenceFile("renders/internal-preview-v1.mp4", "review.pip.input");
    if (previewPath && pipReview?.input?.sha256 !== sha256File(previewPath)) {
      add("PROOF_PIP_REVIEW", "review.pip.input.sha256", "must match renders/internal-preview-v1.mp4");
    }
  }
}

const executionLockPath = requireEvidenceFile("review/execution-lock.json", "executor.executionLock");
const executionLock = executionLockPath ? readJson(executionLockPath, "PROOF_EXECUTION_LOCK") : null;
const executionLockSha256 = executionLockPath ? sha256File(executionLockPath) : null;
if (executionLock?.version !== 1 || !nonEmpty(executionLock?.executorId)) add("PROOF_EXECUTION_LOCK", "review/execution-lock.json", "must contain a versioned stable executor id");
if (executionLock?.executorId !== proof?.executor?.id) add("PROOF_EXECUTION_LOCK", "executor.id", "must match the immutable execution lock owner");
const currentSourceHash = fs.existsSync(path.join(projectDir, "inputs/motion-contract.json")) ? sha256File(path.join(projectDir, "inputs/motion-contract.json")) : null;
const currentDesignHash = fs.existsSync(path.join(projectDir, "DESIGN.md")) ? sha256File(path.join(projectDir, "DESIGN.md")) : null;
if (executionLock?.sourceContractSha256 !== currentSourceHash || executionLock?.designSha256 !== currentDesignHash) {
  add("PROOF_EXECUTION_LOCK", "review/execution-lock.json", "source contract or DESIGN.md changed after executor takeover");
}

const internalDeclaredPath = proof?.previews?.internal?.path;
const internalDeclaredFile = nonEmpty(internalDeclaredPath) ? requireEvidenceFile(internalDeclaredPath, "previews.internal.path") : null;
const reviewedPreviewSha256 = internalDeclaredFile ? sha256File(internalDeclaredFile) : null;
const bindingMatches = (value) =>
  value?.proofVersion === proof?.proofVersion &&
  value?.previewSha256 === reviewedPreviewSha256 &&
  value?.projectFingerprint === currentProjectFingerprint &&
  value?.executionLockSha256 === executionLockSha256;
if (!bindingMatches(proof?.executor)) add("PROOF_REVIEW_BINDING", "executor", "must bind the current proof version, project, executor lock, and internal preview bytes");

function verifyReviewArtifact(relative, expectedSha256, expectedBytes, location) {
  const file = requireEvidenceFile(relative, location);
  if (!file) return null;
  const info = fs.statSync(file);
  if (sha256File(file) !== expectedSha256 || info.size !== expectedBytes) {
    add("PROOF_REVIEW_ARTIFACT", location, `${relative} changed after review binding`);
  }
  return { path: relative, sha256: sha256File(file), bytes: info.size };
}

const currentReviewArtifacts = [];

const reports = proof?.reports;
for (const name of ["executor", "lead"]) {
  const report = reports?.[name];
  if (!allowedReportStatuses.has(report?.status)) add("PROOF_STATUS", `reports.${name}.status`, "must be PASS, FAIL, or NOT_APPLICABLE");
  else if (report.status !== "PASS") add("PROOF_REPORT_FAIL", `reports.${name}.status`, "must be PASS before preview-v1");
  const artifact = verifyReviewArtifact(report?.path, report?.artifactSha256, report?.artifactBytes, `reports.${name}.path`);
  if (artifact) currentReviewArtifacts.push(artifact);
  if (!bindingMatches(report)) add("PROOF_REVIEW_BINDING", `reports.${name}`, "must bind the current proof version, project, executor lock, and internal preview bytes");
}

const fourPasses = proof?.reviews?.fourPasses;
for (const name of ["montage", "static", "motion", "delivery"]) {
  const pass = fourPasses?.[name];
  if (pass?.status !== "PASS") add("PROOF_REVIEW_PASS", `reviews.fourPasses.${name}.status`, "must be PASS");
  if (!bindingMatches(pass)) add("PROOF_REVIEW_BINDING", `reviews.fourPasses.${name}`, "must bind the current proof version, project, executor lock, and internal preview bytes");
  if (!Array.isArray(pass?.evidenceRoles) || pass.evidenceRoles.length === 0) {
    add("PROOF_REVIEW_PASS", `reviews.fourPasses.${name}.evidenceRoles`, "must identify visible evidence roles");
  } else {
    for (const role of pass.evidenceRoles) {
      if (!(evidenceByRole.get(role)?.length > 0)) add("PROOF_REVIEW_PASS", `reviews.fourPasses.${name}.evidenceRoles`, `references missing role ${role}`);
    }
  }
}
if (fourPasses?.montage?.readCaptions !== false || JSON.stringify(fourPasses?.montage?.evidenceRoles) !== JSON.stringify(["contact_sheet"])) {
  add("PROOF_MONTAGE_METHOD", "reviews.fourPasses.montage", "must use only the contact sheet and explicitly avoid reading captions");
}
if (fourPasses?.motion?.watchedFullPreview !== true || !(fourPasses?.motion?.evidenceRoles ?? []).includes("internal_preview")) {
  add("PROOF_MOTION_METHOD", "reviews.fourPasses.motion", "must watch the full internal preview; stills cannot substitute");
}

const findings = Array.isArray(proof?.reviews?.findings) ? proof.reviews.findings : [];
for (const [index, finding] of findings.entries()) {
  if (!new Set(["BLOCKER", "MAJOR", "MINOR"]).has(finding?.severity)) {
    add("PROOF_FINDING_SEVERITY", `reviews.findings[${index}].severity`, "must be BLOCKER, MAJOR, or MINOR");
  }
  if (!new Set(["OPEN", "CLOSED"]).has(finding?.status)) {
    add("PROOF_FINDING_STATUS", `reviews.findings[${index}].status`, "must be OPEN or CLOSED");
  }
  const findingArtifact = verifyReviewArtifact(finding?.evidence, finding?.evidenceSha256, finding?.evidenceBytes, `reviews.findings[${index}].evidence`);
  if (findingArtifact) currentReviewArtifacts.push(findingArtifact);
  if (!allowedReportStatuses.has(finding?.recheck?.status)) {
    add("PROOF_STATUS", `reviews.findings[${index}].recheck.status`, "must be PASS, FAIL, or NOT_APPLICABLE");
  }
  const recheckArtifact = verifyReviewArtifact(finding?.recheck?.evidence, finding?.recheck?.evidenceSha256, finding?.recheck?.evidenceBytes, `reviews.findings[${index}].recheck.evidence`);
  if (recheckArtifact) currentReviewArtifacts.push(recheckArtifact);
  if (finding?.status === "CLOSED" && finding?.recheck?.status !== "PASS") {
    add("PROOF_FINDING_RECHECK", `reviews.findings[${index}].recheck.status`, "CLOSED findings require a PASS recheck");
  }
  if (finding?.status === "CLOSED" && !bindingMatches(finding?.recheck)) {
    add("PROOF_REVIEW_BINDING", `reviews.findings[${index}].recheck`, "must bind the current proof version, project, executor lock, and preview bytes");
  }
  if (finding?.proofVersion !== proof?.proofVersion || finding?.executionLockSha256 !== executionLockSha256) {
    add("PROOF_REVIEW_BINDING", `reviews.findings[${index}]`, "must identify the current proof version and original executor lock");
  }
  if (finding?.status === "OPEN" && (finding.severity === "BLOCKER" || finding.severity === "MAJOR" || finding.blocksPreview === true)) {
    add("PROOF_FINDING_OPEN", `reviews.findings[${index}]`, `${finding.severity} remains open and blocks preview-v1`);
  }
}
const uniqueReviewArtifacts = [...new Map(currentReviewArtifacts.map((item) => [item.path, item])).values()].sort((a, b) => a.path.localeCompare(b.path));
const currentReviewBundleSha256 = sha256Text(JSON.stringify(uniqueReviewArtifacts));
if (proof?.reviewBundle?.sha256 !== currentReviewBundleSha256 || JSON.stringify(proof?.reviewBundle?.artifacts) !== JSON.stringify(uniqueReviewArtifacts)) {
  add("PROOF_REVIEW_ARTIFACT", "reviewBundle", "review artifact inventory or digest changed after binding");
}
if (!nonEmpty(proof?.executor?.id) || proof?.reviews?.revisionOwner !== proof?.executor?.id) {
  add("PROOF_REVISION_OWNER", "reviews.revisionOwner", "must return revisions to the original executor id");
}

const previewV1File = path.join(projectDir, "renders", "preview-v1.mp4");
const approval = proof?.approval;
const lifecycle = proof?.lifecycle?.status;
if (approval?.previewV1Approved === true && !bindingMatches(approval)) {
  add("PROOF_REVIEW_BINDING", "approval", "must bind the current proof version, project, executor lock, and preview bytes");
}
if (approval?.previewV1Approved === true && (approval?.approvedProofVersion !== proof?.proofVersion || !nonEmpty(approval?.reviewer))) {
  add("PROOF_REVIEW_BINDING", "approval", "must name the reviewer and approved current proof version");
}
if (approval?.previewV1Approved === true) {
  if (approval.reviewBundleSha256 !== currentReviewBundleSha256) add("PROOF_REVIEW_ARTIFACT", "approval.reviewBundleSha256", "approval must bind the current review artifact bundle");
  const receiptRelative = approval.receiptPath;
  const receiptFile = nonEmpty(receiptRelative) ? requireEvidenceFile(receiptRelative, "approval.receiptPath") : null;
  const receipt = receiptFile ? readJson(receiptFile, "PROOF_APPROVAL_RECEIPT") : null;
  const decisionSha256 = approvalDecisionSha256(proof);
  if (approval.decisionSha256 !== decisionSha256) add("PROOF_APPROVAL_RECEIPT", "approval.decisionSha256", "approval decision fields changed after approval");
  if (!receiptFile || approval.receiptSha256 !== sha256File(receiptFile)) add("PROOF_APPROVAL_RECEIPT", "approval.receiptSha256", "approval receipt is missing or changed");
  if (
    receipt?.status !== "PASS" ||
    receipt?.reviewer !== approval.reviewer ||
    receipt?.proofVersion !== proof.proofVersion ||
    receipt?.previewSha256 !== reviewedPreviewSha256 ||
    receipt?.projectFingerprint !== currentProjectFingerprint ||
    receipt?.executionLockSha256 !== executionLockSha256 ||
    receipt?.reviewBundleSha256 !== currentReviewBundleSha256 ||
    receipt?.decisionSha256 !== decisionSha256
  ) {
    add("PROOF_APPROVAL_RECEIPT", "approval.receiptPath", "approval receipt does not match the current reviewed decision");
  }
}
if (fs.existsSync(previewV1File) && (approval?.previewV1Approved !== true || lifecycle !== "PREVIEW_READY")) {
  add("PROOF_PREVIEW_UNAPPROVED", "renders/preview-v1.mp4", "preview-v1 exists before an approved PREVIEW_READY state");
}
if (promotionCheck) {
  if (approval?.previewV1Approved !== true || !new Set(["REVIEW_APPROVED", "PREVIEW_READY"]).has(lifecycle)) {
    add("PROOF_PREVIEW_UNAPPROVED", "approval", "promotion requires explicit approval and REVIEW_APPROVED/PREVIEW_READY lifecycle");
  }
} else if (approval?.previewV1Approved !== true || lifecycle !== "PREVIEW_READY") {
  add("PROOF_PREVIEW_UNAPPROVED", "approval", "final proof requires explicit approval and PREVIEW_READY lifecycle");
}

const internalPath = proof?.previews?.internal?.path;
const previewPath = proof?.previews?.previewV1?.path;
if (proof?.previews?.internal?.status !== "PASS") add("PROOF_PREVIEW_STATUS", "previews.internal.status", "must be PASS");
const internal = validatePreview(internalPath, "previews.internal.path", expected);
if (proof?.previews?.internal?.sha256 !== reviewedPreviewSha256) {
  add("PROOF_PREVIEW_DIGEST", "previews.internal.sha256", "must match current internal preview bytes");
}
if (!promotionCheck) {
  if (proof?.previews?.previewV1?.status !== "PASS") add("PROOF_PREVIEW_STATUS", "previews.previewV1.status", "must be PASS");
  const promoted = validatePreview(previewPath, "previews.previewV1.path", expected);
  if (promoted?.file) {
    const promotedSha256 = sha256File(promoted.file);
    if (promotedSha256 !== reviewedPreviewSha256 || proof?.previews?.previewV1?.sha256 !== promotedSha256) {
      add("PROOF_PREVIEW_DIGEST", "previews.previewV1.sha256", "promoted preview must be byte-identical to the reviewed internal preview");
    }
  }
}

if (proof?.formalRelease?.status !== "NOT_APPLICABLE" || proof?.formalRelease?.deferred !== true) {
  add("PROOF_FORMAL_RELEASE", "formalRelease", "must remain explicitly deferred and NOT_APPLICABLE");
}
for (const marker of ["1920x1080", "30fps", "H.264 High", "yuv420p", "12 Mbps", "two-pass"]) {
  if (!String(proof?.formalRelease?.target ?? "").includes(marker)) add("PROOF_FORMAL_RELEASE", "formalRelease.target", `must record ${marker}`);
}

const mediaAnalysisPath = (evidenceByRole.get("black_tail") ?? [])[0]?.path;
if (mediaAnalysisPath) {
  const mediaFile = projectPath(mediaAnalysisPath, "evidence.black_tail.path");
  const analysis = mediaFile && fs.existsSync(mediaFile) ? readJson(mediaFile, "PROOF_MEDIA_ANALYSIS") : null;
  if (analysis) {
    if (analysis.version !== 1) add("PROOF_MEDIA_ANALYSIS", "media-analysis.version", "must equal 1");
    const internalFile = internal?.file;
    if (internalFile) {
      const actualHash = crypto.createHash("sha256").update(fs.readFileSync(internalFile)).digest("hex");
      if (analysis.previewSha256 !== actualHash) add("PROOF_MEDIA_ANALYSIS", "media-analysis.previewSha256", "must match the current internal preview bytes");
    }
    for (const field of ["fullDecode", "blackTail", "silentTail", "firstAudioRegion", "lastAudioRegion"]) {
      if (analysis[field]?.status !== "PASS") add("PROOF_MEDIA_ANALYSIS", `media-analysis.${field}.status`, "must be PASS");
      requireEvidenceFile(analysis[field]?.evidence, `media-analysis.${field}.evidence`);
      if (!nonEmpty(analysis[field]?.command)) add("PROOF_MEDIA_ANALYSIS", `media-analysis.${field}.command`, "must record a reproducible ffmpeg/ffprobe command");
    }
  }
}

const contact = (evidenceByRole.get("contact_sheet") ?? [])[0];
if (contact?.path) {
  const file = projectPath(contact.path, "evidence.contact_sheet.path");
  if (file && fs.existsSync(file)) {
    const probe = probeMedia(file, "evidence.contact_sheet.path");
    const stream = probe?.streams?.find((item) => item.codec_type === "video");
    if (stream && (stream.width !== 1920 || stream.height !== 1080)) {
      add("PROOF_CONTACT_SHEET", "evidence.contact_sheet.path", `must be 1920x1080; received ${stream.width}x${stream.height}`);
    }
  }
}

const animation = (evidenceByRole.get("animation_map") ?? [])[0];
if (animation?.path) {
  const file = projectPath(animation.path, "evidence.animation_map.path");
  const map = file && fs.existsSync(file) ? readJson(file, "PROOF_ANIMATION_MAP") : null;
  if (map && (!Array.isArray(map.tweens) || !Array.isArray(map.deadZones) || map.totalTweens < 1)) {
    add("PROOF_ANIMATION_MAP", "animation-map", "must contain actual tweens and dead-zone analysis");
  }
  if (proof?.animationMapReview?.status !== "PASS" || !Array.isArray(proof?.animationMapReview?.unexplainedFlags) || proof.animationMapReview.unexplainedFlags.length !== 0) {
    add("PROOF_ANIMATION_MAP", "animationMapReview", "must PASS with zero unexplained flags");
  }
  if (map?.tweens) {
    const explained = proof?.animationMapReview?.explainedFlags ?? [];
    for (const tween of map.tweens) {
      for (const flag of tween.flags ?? []) {
        const match = explained.find((item) => item.selector === tween.selector && item.flag === flag && nonEmpty(item.reason));
        if (!match) add("PROOF_ANIMATION_MAP", "animationMapReview.explainedFlags", `unexplained ${tween.selector}:${flag}`);
        else requireEvidenceFile(match.evidence, `animationMapReview.explainedFlags.${tween.selector}.${flag}.evidence`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`Project proof failed (${errors.length} issue${errors.length === 1 ? "" : "s"}):`);
  for (const error of errors) console.error(`- [${error.code}] ${error.location}: ${error.message}`);
  process.exit(1);
}

console.log(`PASS project proof ${proofPath} (${sourceAcceptance.length} source frames, ${transitionIds.length} transition midpoint, ${holdBeatIds.length} readable hold${promotionCheck ? ", promotion clear" : ", preview-v1 ready"})`);
