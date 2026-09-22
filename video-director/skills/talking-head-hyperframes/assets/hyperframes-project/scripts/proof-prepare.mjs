#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { canonicalProjectRoot, safeProjectPath, writeJsonAtomic } from "./project-integrity.mjs";

const projectDir = canonicalProjectRoot(process.cwd());
const resetPaths = [
  "review/cli",
  "review/gate-receipts",
  "review/stage-parity",
  "review/media",
  "review/media-analysis-v1.json",
  "review/executor-contact-sheet-v1.png",
  "review/approval-receipt-v1.json",
  "renders/internal-preview-v1.mp4",
  "renders/preview-v1.mp4",
];

for (const relative of resetPaths) {
  const absolute = safeProjectPath(projectDir, relative, { mustExist: false });
  if (!fs.existsSync(absolute)) continue;
  const info = fs.lstatSync(absolute);
  if (info.isSymbolicLink()) throw new Error(`Refusing to remove symbolic link: ${relative}`);
  fs.rmSync(absolute, { recursive: info.isDirectory(), force: true });
}
for (const relative of ["review/cli", "review/gate-receipts", "review/stage-parity", "review/media", "renders", "snapshots/acceptance", "snapshots/stage"]) {
  fs.mkdirSync(safeProjectPath(projectDir, relative, { mustExist: false }), { recursive: true });
}

const proofPath = safeProjectPath(projectDir, "review/proof-manifest-v1.json", { mustExist: false });
if (fs.existsSync(proofPath)) {
  const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
  const adaptationPath = safeProjectPath(projectDir, "runtime-adaptation.json", { type: "file" });
  const manifestPath = safeProjectPath(projectDir, "manifest.json", { type: "file" });
  const adaptation = JSON.parse(fs.readFileSync(adaptationPath, "utf8"));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const acceptance = adaptation.acceptanceMappings ?? [];
  if (acceptance.length === 0) throw new Error("runtime-adaptation.json must declare acceptanceMappings before proof generation");
  const evidence = acceptance.map((item) => ({
    id: `accept-${item.snapshotId}`,
    role: "source_acceptance",
    status: "PASS",
    sourceKey: `${item.beatId}@${item.sourceAtSeconds}#${item.sourceRole}`,
    path: item.path,
  }));
  for (const role of ["cue_before", "cue_after"]) {
    for (const item of acceptance.filter((mapping) => mapping.sourceRole === role)) {
      evidence.push({ id: `${role.replace("_", "-")}-${item.snapshotId}`, role, status: "PASS", sourceKey: `${item.beatId}@${item.sourceAtSeconds}#${item.sourceRole}`, path: item.path });
    }
  }
  for (const scene of adaptation.scenes ?? []) {
    const sceneFrames = acceptance.filter((item) => (scene.beatIds ?? []).includes(item.beatId));
    const chapter = sceneFrames.find((item) => item.sourceRole === "state_complete") ?? sceneFrames.at(-1);
    if (chapter) evidence.push({ id: `chapter-${scene.sceneId}`, role: "chapter_state", status: "PASS", path: chapter.path });
    if (scene.transitionOut) {
      const transition = acceptance.find((item) => item.sourceRole === "transition_midpoint" && Math.abs(item.sourceAtSeconds - scene.transitionOut.midpointSeconds) <= 0.25)
        ?? acceptance.find((item) => item.sourceRole === "transition_midpoint" && (scene.beatIds ?? []).includes(item.beatId));
      if (!transition) throw new Error(`No transition_midpoint acceptance mapping for ${scene.transitionOut.transitionId}`);
      evidence.push({ id: `transition-${scene.transitionOut.transitionId}`, role: "transition_midpoint", status: "PASS", transitionId: scene.transitionOut.transitionId, path: transition.path });
    }
  }
  for (const mapping of adaptation.beatMappings ?? []) {
    if (mapping.kind !== "readable-hold") continue;
    const hold = acceptance.find((item) => item.beatId === mapping.beatId && item.sourceRole === "readable_hold");
    if (!hold) throw new Error(`No readable_hold acceptance mapping for ${mapping.beatId}`);
    evidence.push({ id: `hold-${mapping.beatId}`, role: "readable_hold", status: "PASS", beatId: mapping.beatId, path: hold.path });
  }
  const representative = acceptance.find((item) => item.sourceRole === "state_complete") ?? acceptance[Math.floor(acceptance.length / 2)];
  let widestFrame = representative;
  const captionsRelative = manifest.inputs?.captionsAligned?.path;
  if (captionsRelative) {
    const captionsPath = safeProjectPath(projectDir, captionsRelative, { type: "file" });
    const captions = JSON.parse(fs.readFileSync(captionsPath, "utf8")).captions ?? [];
    const widest = captions.toSorted((left, right) => {
      const text = (item) => typeof item.text === "string" ? item.text : (item.parts ?? []).map((part) => part.text ?? "").join("");
      return [...text(right)].length - [...text(left)].length;
    })[0];
    if (widest) {
      const midpoint = (widest.start + widest.end) / 2;
      widestFrame = acceptance.toSorted((left, right) => Math.abs(left.sourceAtSeconds - midpoint) - Math.abs(right.sourceAtSeconds - midpoint))[0] ?? representative;
    }
  }
  evidence.push(
    { id: "density-state", role: "density_state", status: "PASS", path: representative.path },
    { id: "widest-caption", role: "widest_caption", status: "PASS", path: widestFrame.path },
    { id: manifest.fixedStage?.pipMounted ? "pip-crop" : "pip-not-supplied", role: "pip_crop", status: manifest.fixedStage?.pipMounted ? "PASS" : "NOT_APPLICABLE", path: manifest.fixedStage?.pipMounted ? "review/pip/internal-preview-v1-crop-3x.png" : "manifest.json" },
    { id: "audio-first", role: "audio_first_region", status: "PASS", path: "review/media-analysis-v1.json" },
    { id: "audio-last", role: "audio_last_region", status: "PASS", path: "review/media-analysis-v1.json" },
    { id: "full-watch-decode", role: "full_watch_decode", status: "PASS", path: "review/media/full-watch-decode.txt" },
    { id: "black-tail", role: "black_tail", status: "PASS", path: "review/media-analysis-v1.json" },
    { id: "silent-tail", role: "silent_tail", status: "PASS", path: "review/media-analysis-v1.json" },
    { id: "animation-map", role: "animation_map", status: "PASS", path: "review/animation-map-v1/animation-map.json" },
    { id: "montage-sheet", role: "contact_sheet", status: "PASS", path: "review/executor-contact-sheet-v1.png" },
    { id: "internal-preview", role: "internal_preview", status: "PASS", path: "renders/internal-preview-v1.mp4" },
    { id: "executor-report", role: "executor_report", status: "PASS", path: "review/executor-report-v1.md" },
    { id: "lead-review", role: "lead_review", status: "PASS", path: "review/lead-review-v1.md" },
  );
  proof.lifecycle = { status: "REVIEWING" };
  proof.commandGates = [];
  if (proof.animationMapReview) {
    proof.animationMapReview.status = "FAIL";
    proof.animationMapReview.explainedFlags = [];
    proof.animationMapReview.unexplainedFlags = [];
  }
  for (const report of Object.values(proof.reports ?? {})) report.status = "FAIL";
  for (const pass of Object.values(proof.reviews?.fourPasses ?? {})) pass.status = "FAIL";
  if (proof.reviews?.fourPasses?.motion) proof.reviews.fourPasses.motion.watchedFullPreview = false;
  for (const finding of proof.reviews?.findings ?? []) {
    finding.status = "OPEN";
    if (finding.recheck) finding.recheck.status = "FAIL";
  }
  if (proof.previews?.internal) {
    proof.previews.internal.status = "FAIL";
    delete proof.previews.internal.sha256;
  }
  if (proof.previews?.previewV1) {
    proof.previews.previewV1.status = "NOT_APPLICABLE";
    delete proof.previews.previewV1.sha256;
  }
  if (proof.approval) {
    proof.approval.previewV1Approved = false;
    proof.approval.approvedProofVersion = null;
    delete proof.approval.previewSha256;
    delete proof.approval.projectFingerprint;
    delete proof.approval.executionLockSha256;
    delete proof.approval.reviewBundleSha256;
    delete proof.approval.decisionSha256;
    delete proof.approval.receiptPath;
    delete proof.approval.receiptSha256;
  }
  delete proof.reviewBundle;
  proof.evidence = evidence;
  writeJsonAtomic(proofPath, proof);
}

console.log("PASS proof workspace prepared; stale receipts, previews, and approval were invalidated");
