#!/usr/bin/env node

import fs from "node:fs";
import { canonicalProjectRoot, projectFingerprint, safeProjectPath, sha256File, sha256Text, writeJsonAtomic } from "./project-integrity.mjs";

const projectDir = canonicalProjectRoot(process.cwd());
const proofPath = safeProjectPath(projectDir, "review/proof-manifest-v1.json", { type: "file" });
const internal = safeProjectPath(projectDir, "renders/internal-preview-v1.mp4", { type: "file" });
const lockPath = safeProjectPath(projectDir, "review/execution-lock.json", { type: "file" });
const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
const previewSha256 = sha256File(internal);
const fingerprint = projectFingerprint(projectDir).sha256;
const executionLockSha256 = sha256File(lockPath);
const binding = { proofVersion: proof.proofVersion, previewSha256, projectFingerprint: fingerprint, executionLockSha256 };
const reviewArtifacts = new Map();

function bindArtifact(owner, pathKey, hashKey, bytesKey, label) {
  const relative = owner?.[pathKey];
  const file = safeProjectPath(projectDir, relative, { type: "file" });
  const info = fs.statSync(file);
  if (info.size === 0) throw new Error(`${label} must not be empty`);
  const record = { path: relative, sha256: sha256File(file), bytes: info.size };
  owner[hashKey] = record.sha256;
  owner[bytesKey] = record.bytes;
  reviewArtifacts.set(relative, record);
}

for (const [name, report] of Object.entries(proof.reports ?? {})) {
  Object.assign(report, binding);
  bindArtifact(report, "path", "artifactSha256", "artifactBytes", `${name} report`);
}
for (const pass of Object.values(proof.reviews?.fourPasses ?? {})) Object.assign(pass, binding);
for (const finding of proof.reviews?.findings ?? []) {
  finding.proofVersion = proof.proofVersion;
  finding.executionLockSha256 = executionLockSha256;
  bindArtifact(finding, "evidence", "evidenceSha256", "evidenceBytes", `finding ${finding.id ?? "(unnamed)"}`);
  if (finding.recheck) {
    Object.assign(finding.recheck, binding);
    bindArtifact(finding.recheck, "evidence", "evidenceSha256", "evidenceBytes", `finding ${finding.id ?? "(unnamed)"} recheck`);
  }
}
Object.assign(proof.executor ?? (proof.executor = {}), binding);
proof.reviewBundle = {
  version: 1,
  artifacts: [...reviewArtifacts.values()].sort((a, b) => a.path.localeCompare(b.path)),
};
proof.reviewBundle.sha256 = sha256Text(JSON.stringify(proof.reviewBundle.artifacts));
Object.assign(proof.approval ?? (proof.approval = {}), binding, { reviewBundleSha256: proof.reviewBundle.sha256 });
proof.projectFingerprint = fingerprint;
writeJsonAtomic(proofPath, proof);
console.log(`PASS review records and ${reviewArtifacts.size} review artifact(s) bound to the current project, executor lock, proof version, and internal preview bytes`);
