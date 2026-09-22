#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { canonicalProjectRoot, projectFingerprint, safeProjectPath, sha256File, writeFileAtomic, writeJsonAtomic } from "./project-integrity.mjs";

const projectDir = canonicalProjectRoot(process.cwd());
const validator = safeProjectPath(projectDir, "scripts/validate-project-proof.mjs", { type: "file" });
const manifestPath = safeProjectPath(projectDir, "review/proof-manifest-v1.json", { type: "file" });
const internal = safeProjectPath(projectDir, "renders/internal-preview-v1.mp4", { type: "file" });
const preview = safeProjectPath(projectDir, "renders/preview-v1.mp4", { mustExist: false });
const marker = safeProjectPath(projectDir, "review/.promotion-transaction.json", { mustExist: false });
const backup = safeProjectPath(projectDir, "review/.proof-manifest-v1.promotion-backup.json", { mustExist: false });
const nextManifest = safeProjectPath(projectDir, "review/.proof-manifest-v1.promotion-next.json", { mustExist: false });
const tempPreview = safeProjectPath(projectDir, "renders/.preview-v1.promotion.tmp", { mustExist: false });

function exists(candidate) {
  try {
    fs.lstatSync(candidate);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function removeRegular(candidate, label) {
  if (!exists(candidate)) return;
  const info = fs.lstatSync(candidate);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`${label} must be a regular file`);
  fs.rmSync(candidate, { force: true });
}

function recoverPromotion() {
  if (!exists(marker)) {
    for (const [candidate, label] of [[backup, "promotion backup"], [nextManifest, "next manifest"], [tempPreview, "temporary preview"]]) removeRegular(candidate, label);
    return;
  }
  const transaction = JSON.parse(fs.readFileSync(safeProjectPath(projectDir, "review/.promotion-transaction.json", { type: "file" }), "utf8"));
  if (transaction.version !== 1 || transaction.previewPath !== "renders/preview-v1.mp4" || transaction.manifestPath !== "review/proof-manifest-v1.json") {
    throw new Error("Refusing malformed preview promotion transaction");
  }
  if (!exists(backup)) throw new Error("Cannot recover preview promotion: manifest backup is missing");
  removeRegular(preview, "promoted preview");
  fs.renameSync(backup, manifestPath);
  removeRegular(nextManifest, "next manifest");
  removeRegular(tempPreview, "temporary preview");
  removeRegular(marker, "promotion marker");
  console.log("RECOVERED interrupted preview promotion; restored REVIEW_APPROVED manifest and removed unpublished preview");
}

function validate(extra = []) {
  const result = spawnSync(process.execPath, [validator, projectDir, "review/proof-manifest-v1.json", ...extra], { cwd: projectDir, encoding: "utf8", timeout: 300_000, maxBuffer: 20 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`);
  process.stdout.write(result.stdout ?? "");
}

function testFailpoint(name) {
  if (process.env.HYPERFRAMES_TEST_PROMOTION_FAILPOINT === name) throw new Error(`Injected promotion failure at ${name}`);
}

recoverPromotion();
if (exists(preview)) throw new Error("Refusing promotion because renders/preview-v1.mp4 already exists; run proof:prepare first");
validate(["--promotion-check"]);

const oldProofText = fs.readFileSync(manifestPath, "utf8");
const proof = JSON.parse(oldProofText);
const previewSha256 = sha256File(internal);
const fingerprint = projectFingerprint(projectDir).sha256;
const lock = safeProjectPath(projectDir, "review/execution-lock.json", { type: "file" });
const lockSha256 = sha256File(lock);
if (proof.approval?.previewSha256 !== previewSha256 || proof.approval?.projectFingerprint !== fingerprint || proof.approval?.executionLockSha256 !== lockSha256) {
  throw new Error("Approval is not bound to the current preview, project fingerprint, and execution lock");
}

proof.lifecycle.status = "PREVIEW_READY";
proof.previews.previewV1 = { status: "PASS", path: "renders/preview-v1.mp4", sha256: previewSha256 };
proof.evidence = (proof.evidence ?? []).filter((item) => item.role !== "preview_v1");
proof.evidence.push({ id: "preview-v1", role: "preview_v1", status: "PASS", path: "renders/preview-v1.mp4", sha256: previewSha256, projectFingerprint: fingerprint, executionLockSha256: lockSha256, proofVersion: proof.proofVersion });

fs.mkdirSync(path.dirname(preview), { recursive: true });
try {
  fs.copyFileSync(internal, tempPreview, fs.constants.COPYFILE_EXCL);
  if (sha256File(tempPreview) !== previewSha256) throw new Error("Preview copy digest mismatch");
  writeFileAtomic(backup, oldProofText);
  writeFileAtomic(nextManifest, `${JSON.stringify(proof, null, 2)}\n`);
  writeJsonAtomic(marker, {
    version: 1,
    manifestPath: "review/proof-manifest-v1.json",
    previewPath: "renders/preview-v1.mp4",
    internalPreviewSha256: previewSha256,
    originalManifestSha256: sha256File(backup),
  });
  testFailpoint("after-transaction-marker");
  fs.renameSync(tempPreview, preview);
  testFailpoint("after-preview-install");
  fs.renameSync(nextManifest, manifestPath);
  testFailpoint("after-manifest-install");
  validate();
  removeRegular(backup, "promotion backup");
  removeRegular(marker, "promotion marker");
  console.log("PASS preview-v1 promoted transactionally from the reviewed internal preview; no formal release render was run");
} catch (error) {
  try {
    removeRegular(preview, "promoted preview");
    if (exists(backup)) fs.renameSync(backup, manifestPath);
    removeRegular(nextManifest, "next manifest");
    removeRegular(tempPreview, "temporary preview");
    removeRegular(marker, "promotion marker");
  } catch (rollbackError) {
    throw new AggregateError([error, rollbackError], "Preview promotion failed and automatic rollback could not complete; rerun proof:finalize to recover from the durable transaction marker");
  }
  throw error;
}
