#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { canonicalProjectRoot, projectFingerprint, safeProjectPath, sha256File, sha256Text, trustedExecutable, writeFileAtomic, writeJsonAtomic } from "./project-integrity.mjs";

const id = process.argv[2];
const projectDir = canonicalProjectRoot(process.cwd());
const proofPath = safeProjectPath(projectDir, "review/proof-manifest-v1.json", { mustExist: false });
const manifest = JSON.parse(fs.readFileSync(safeProjectPath(projectDir, "manifest.json", { type: "file" }), "utf8"));
const contractPath = safeProjectPath(projectDir, "inputs/motion-contract.json", { mustExist: false });
const adaptationPath = safeProjectPath(projectDir, "runtime-adaptation.json", { mustExist: false });

function snapshotTimes() {
  if (!fs.existsSync(contractPath)) return [0];
  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  return [...new Set((contract.beats ?? []).flatMap((beat) => (beat.acceptanceFrames ?? []).map((frame) => frame.atSeconds)))].sort((a, b) => a - b);
}

const times = snapshotTimes();
const commands = {
  inputs: [process.execPath, ["scripts/check-inputs.mjs", "."]],
  "fixed-stage": [process.execPath, ["scripts/check-fixed-stage.mjs", "."]],
  "motion-contract": [process.execPath, ["scripts/validate-motion-contract.mjs", "inputs/motion-contract.json"]],
  "runtime-adaptation": [process.execPath, ["scripts/validate-runtime-adaptation.mjs", "runtime-adaptation.json", "inputs/motion-contract.json", "--html", "compositions/content.html"]],
  stage: [process.execPath, ["scripts/proof-stage.mjs"]],
  doctor: ["npx", ["--yes", "hyperframes@0.7.65", "doctor"]],
  lint: ["npx", ["--yes", "hyperframes@0.7.65", "lint"]],
  validate: ["npx", ["--yes", "hyperframes@0.7.65", "validate"]],
  inspect: ["npx", ["--yes", "hyperframes@0.7.65", "inspect", "--at", times.join(","), "--at-transitions", "--strict"]],
  check: ["npx", ["--yes", "hyperframes@0.7.65", "check"]],
  snapshot: ["npx", ["--yes", "hyperframes@0.7.65", "snapshot", "--at", times.join(","), "--no-end", "--output", "snapshots/acceptance", "--describe", "false"]],
  "animation-map": [process.execPath, ["scripts/build-animation-map.mjs"]],
  render: ["npx", ["--yes", "hyperframes@0.7.65", "render", "--quality", "draft", "--fps", "30", "--resolution", "1080p", "--workers", "2", "--output", "renders/internal-preview-v1.mp4"]],
  "contact-sheet": [process.execPath, ["scripts/build-contact-sheet.mjs"]],
  media: [process.execPath, ["scripts/analyze-preview.mjs", "--input", "renders/internal-preview-v1.mp4", "--output", "review/media-analysis-v1.json"]],
};

if (!commands[id]) {
  console.error(`Unknown proof gate ${JSON.stringify(id)}. Expected: ${Object.keys(commands).join(", ")}`);
  process.exit(2);
}
if (id === "runtime-adaptation" && !fs.existsSync(adaptationPath)) throw new Error("runtime-adaptation.json is required before executor proof");
if (manifest.status !== "READY_FOR_EXECUTION") throw new Error("Proof gates require READY_FOR_EXECUTION");

const fingerprint = projectFingerprint(projectDir).sha256;
const [command, commandArgs] = commands[id];
const commandRecord = [command === process.execPath ? "node" : command, ...commandArgs];
const executable = command === process.execPath ? command : trustedExecutable(command, projectDir);
const startedAt = new Date().toISOString();
const result = spawnSync(executable, commandArgs, { cwd: projectDir, encoding: "utf8", timeout: 600_000, maxBuffer: 20 * 1024 * 1024 });
const finishedAt = new Date().toISOString();
const log = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? `\n${result.error.message}\n` : ""}`;
const logRelative = `review/cli/${id}.txt`;
const logPath = safeProjectPath(projectDir, logRelative, { mustExist: false });
fs.mkdirSync(path.dirname(logPath), { recursive: true });
writeFileAtomic(logPath, log);
const receiptRelative = `review/gate-receipts/${id}.json`;
const receiptPath = safeProjectPath(projectDir, receiptRelative, { mustExist: false });
const receipt = {
  version: 1,
  id,
  status: result.status === 0 && !result.error ? "PASS" : "FAIL",
  command: commandRecord,
  commandSha256: sha256Text(JSON.stringify(commandRecord)),
  cliVersion: commandRecord.includes("hyperframes@0.7.65") ? "0.7.65" : "project-local",
  exitCode: result.status,
  signal: result.signal ?? null,
  timedOut: result.error?.code === "ETIMEDOUT",
  projectFingerprint: fingerprint,
  log: logRelative,
  logSha256: sha256File(logPath),
  startedAt,
  finishedAt,
};

function collectArtifacts(relative, output) {
  const absolute = safeProjectPath(projectDir, relative, { mustExist: false });
  if (!fs.existsSync(absolute)) return;
  const info = fs.lstatSync(absolute);
  if (info.isSymbolicLink()) throw new Error(`Proof artifact must not be a symbolic link: ${relative}`);
  if (info.isDirectory()) {
    for (const name of fs.readdirSync(absolute).sort()) collectArtifacts(path.posix.join(relative, name), output);
    return;
  }
  output.push({ path: relative, sha256: sha256File(absolute), bytes: info.size });
}
const artifactRoots = {
  stage: ["review/stage-parity"],
  snapshot: ["snapshots/acceptance"],
  "animation-map": ["review/animation-map-v1"],
  render: ["renders/internal-preview-v1.mp4"],
  "contact-sheet": ["review/executor-contact-sheet-v1.png"],
  media: ["review/media-analysis-v1.json", "review/media"],
};
receipt.artifacts = [];
for (const relative of artifactRoots[id] ?? []) collectArtifacts(relative, receipt.artifacts);
writeJsonAtomic(receiptPath, receipt);

if (fs.existsSync(proofPath)) {
  const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
  proof.commandGates = (proof.commandGates ?? []).filter((gate) => gate.id !== id);
  proof.commandGates.push({ id, status: receipt.status, evidence: logRelative, receipt: receiptRelative });
  proof.projectFingerprint = fingerprint;
  if (id === "render" && receipt.status === "PASS") {
    const preview = safeProjectPath(projectDir, "renders/internal-preview-v1.mp4", { type: "file" });
    const previewSha256 = sha256File(preview);
    proof.previews = proof.previews ?? {};
    proof.previews.internal = { status: "PASS", path: "renders/internal-preview-v1.mp4", sha256: previewSha256 };
    if (proof.approval?.previewSha256 !== previewSha256) {
      proof.approval.previewV1Approved = false;
      proof.approval.approvedProofVersion = null;
    }
  }
  writeJsonAtomic(proofPath, proof);
}

process.stdout.write(log);
if (receipt.status !== "PASS") process.exit(result.status ?? 1);
console.log(`PASS proof gate ${id}; receipt ${receiptRelative}`);
