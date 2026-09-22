#!/usr/bin/env node

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { approvalDecisionSha256, canonicalProjectRoot, projectFingerprint, safeProjectPath, sha256File, sha256Text, writeFileAtomic, writeJsonAtomic } from "./project-integrity.mjs";

const [reviewer, versionArg, ...extra] = process.argv.slice(2);
if (!reviewer?.trim() || !/^\d+$/.test(versionArg ?? "") || extra.length > 0) {
  console.error("Usage: npm run proof:approve -- <reviewer> <proof-version>");
  process.exit(2);
}

const projectDir = canonicalProjectRoot(process.cwd());
const proofPath = safeProjectPath(projectDir, "review/proof-manifest-v1.json", { type: "file" });
const internal = safeProjectPath(projectDir, "renders/internal-preview-v1.mp4", { type: "file" });
const lockPath = safeProjectPath(projectDir, "review/execution-lock.json", { type: "file" });
const receiptPath = safeProjectPath(projectDir, "review/approval-receipt-v1.json", { mustExist: false });
const candidatePath = safeProjectPath(projectDir, "review/.proof-manifest-v1.approval-candidate.json", { mustExist: false });
const validator = safeProjectPath(projectDir, "scripts/validate-project-proof.mjs", { type: "file" });
const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
const proofVersion = Number(versionArg);

if (proof.proofVersion !== proofVersion) throw new Error(`Approval proof version ${proofVersion} does not match current ${proof.proofVersion}`);
if (proof.lifecycle?.status !== "REVIEWING") throw new Error("Approval requires REVIEWING lifecycle");
if (!proof.executor?.id || proof.reviews?.revisionOwner !== proof.executor.id) throw new Error("Approval requires one stable executor/revision owner");
if (proof.animationMapReview?.status !== "PASS" || (proof.animationMapReview?.unexplainedFlags ?? []).length > 0) {
  throw new Error("Approval requires a passing animation-map review with no unexplained flags");
}
for (const [name, report] of Object.entries(proof.reports ?? {})) {
  if (report.status !== "PASS") throw new Error(`Approval requires PASS report ${name}`);
}
for (const [name, pass] of Object.entries(proof.reviews?.fourPasses ?? {})) {
  if (pass.status !== "PASS") throw new Error(`Approval requires PASS ${name} review`);
}
if (proof.reviews?.fourPasses?.motion?.watchedFullPreview !== true) throw new Error("Approval requires a full-preview motion watch");
for (const finding of proof.reviews?.findings ?? []) {
  if (finding.status !== "CLOSED" || finding.recheck?.status !== "PASS") throw new Error(`Approval requires a closed PASS recheck for finding ${finding.id ?? "(unnamed)"}`);
}
if (!proof.reviewBundle?.sha256 || !Array.isArray(proof.reviewBundle?.artifacts)) throw new Error("Run proof:bind-review before proof:approve");
const currentReviewArtifacts = proof.reviewBundle.artifacts.map((artifact) => {
  const file = safeProjectPath(projectDir, artifact.path, { type: "file" });
  const info = fs.statSync(file);
  const current = { path: artifact.path, sha256: sha256File(file), bytes: info.size };
  if (current.sha256 !== artifact.sha256 || current.bytes !== artifact.bytes) throw new Error(`Review artifact changed after binding: ${artifact.path}`);
  return current;
}).sort((left, right) => left.path.localeCompare(right.path));
if (sha256Text(JSON.stringify(currentReviewArtifacts)) !== proof.reviewBundle.sha256) throw new Error("Review bundle digest changed after binding");

const fingerprint = projectFingerprint(projectDir).sha256;
const previewSha256 = sha256File(internal);
const executionLockSha256 = sha256File(lockPath);
for (const [label, actual, expected] of [
  ["project fingerprint", fingerprint, proof.executor.projectFingerprint],
  ["internal preview", previewSha256, proof.executor.previewSha256],
  ["execution lock", executionLockSha256, proof.executor.executionLockSha256],
]) {
  if (actual !== expected) throw new Error(`Bound ${label} changed after review`);
}

proof.lifecycle.status = "REVIEW_APPROVED";
Object.assign(proof.approval ?? (proof.approval = {}), {
  previewV1Approved: true,
  reviewer: reviewer.trim(),
  approvedProofVersion: proofVersion,
  previewSha256,
  projectFingerprint: fingerprint,
  executionLockSha256,
  reviewBundleSha256: proof.reviewBundle.sha256,
});
const decisionSha256 = approvalDecisionSha256(proof);
const receipt = {
  version: 1,
  status: "PASS",
  reviewer: reviewer.trim(),
  proofVersion,
  previewSha256,
  projectFingerprint: fingerprint,
  executionLockSha256,
  reviewBundleSha256: proof.reviewBundle.sha256,
  decisionSha256,
};
proof.approval.decisionSha256 = decisionSha256;
proof.approval.receiptPath = "review/approval-receipt-v1.json";
const previousReceipt = fs.existsSync(receiptPath) ? fs.readFileSync(receiptPath) : null;
try {
  writeJsonAtomic(receiptPath, receipt);
  proof.approval.receiptSha256 = sha256File(receiptPath);
  writeJsonAtomic(candidatePath, proof);
  const validation = spawnSync(process.execPath, [validator, projectDir, "review/.proof-manifest-v1.approval-candidate.json", "--promotion-check"], {
    cwd: projectDir,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (validation.error || validation.status !== 0) {
    throw new Error(`Approval preflight failed without changing lifecycle:\n${validation.stdout ?? ""}${validation.stderr ?? ""}${validation.error?.message ?? ""}`);
  }
  fs.renameSync(candidatePath, proofPath);
} catch (error) {
  fs.rmSync(candidatePath, { force: true });
  if (previousReceipt) writeFileAtomic(receiptPath, previousReceipt);
  else fs.rmSync(receiptPath, { force: true });
  throw error;
}
console.log(`PASS preview approval recorded for ${reviewer.trim()} at proof version ${proofVersion}`);
