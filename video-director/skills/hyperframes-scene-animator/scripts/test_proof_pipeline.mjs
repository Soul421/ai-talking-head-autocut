#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(SCRIPT_DIR, "..");
const SOURCE_PROJECT = path.join(SKILL_DIR, "evals", "fixtures", "ready-project");
const RUN_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "hf-proof-suite-"));
const PROJECT_REQUESTED = path.join(RUN_ROOT, "ready-project");
fs.cpSync(SOURCE_PROJECT, PROJECT_REQUESTED, { recursive: true });
const PROJECT = fs.realpathSync(PROJECT_REQUESTED);
const VALIDATOR = path.join(SCRIPT_DIR, "validate_project_proof.mjs");
const CONTACT_SHEET = path.join(SCRIPT_DIR, "build_contact_sheet.mjs");
const VERIFY_BUNDLE = path.join(SCRIPT_DIR, "verify_project_bundle.mjs");
const CANONICAL_PROOF = path.join(PROJECT, "review", "proof-manifest-v1.json");
const TMP = fs.mkdtempSync(path.join(PROJECT, ".proof-test-"));
const TMP_RELATIVE = path.relative(PROJECT, TMP);

const scenarios = [];
const record = (name, run) => scenarios.push({ name, run });
const clone = (value) => structuredClone(value);

function command(program, args, cwd = PROJECT, env = process.env) {
  return spawnSync(program, args, { cwd, env, encoding: "utf8" });
}

function output(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function writeProof(name, mutate) {
  const proof = clone(JSON.parse(fs.readFileSync(CANONICAL_PROOF, "utf8")));
  mutate(proof);
  const relative = path.join(TMP_RELATIVE, `${name}.json`);
  fs.writeFileSync(path.join(PROJECT, relative), `${JSON.stringify(proof, null, 2)}\n`);
  return relative;
}

function expectRejected(name, mutate, diagnostic) {
  record(name, () => {
    const proof = writeProof(name, mutate);
    const result = command(process.execPath, [VALIDATOR, PROJECT, proof]);
    assert.notEqual(result.status, 0, `${name} unexpectedly passed`);
    assert.match(output(result), new RegExp(`\\[${diagnostic}\\]`), `${name} did not emit ${diagnostic}`);
  });
}

function makePreview(name, { size, fps }) {
  const target = path.join(TMP, `${name}.mp4`);
  const result = command("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `color=c=#20242c:s=${size}:r=${fps}:d=4`,
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=4",
    "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "40",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", target,
  ]);
  assert.equal(result.status, 0, `could not create ${name}: ${output(result)}`);
  return path.relative(PROJECT, target);
}

assert.equal(JSON.parse(fs.readFileSync(path.join(PROJECT, "manifest.json"), "utf8")).status, "READY_FOR_EXECUTION");
assert.ok(fs.existsSync(VALIDATOR), "proof validator is missing");
assert.ok(fs.existsSync(CONTACT_SHEET), "contact-sheet builder is missing");
assert.ok(fs.existsSync(CANONICAL_PROOF), "proof manifest is missing");

record("canonical proof passes", () => {
  const result = command(process.execPath, [VALIDATOR, PROJECT]);
  assert.equal(result.status, 0, output(result));
  assert.match(output(result), /PASS project proof/);
});

for (const gate of ["lint", "inspect", "snapshot", "animation-map", "render"]) {
  expectRejected(`missing-${gate}-gate`, (proof) => {
    proof.commandGates = proof.commandGates.filter((item) => item.id !== gate);
  }, "PROOF_GATE_MISSING");
}

expectRejected("missing-source-acceptance", (proof) => {
  const target = proof.evidence.findLast((item) => item.role === "source_acceptance");
  proof.evidence = proof.evidence.filter((item) => item !== target);
}, "PROOF_SOURCE_ACCEPTANCE");

for (const role of ["transition_midpoint", "readable_hold", "widest_caption", "audio_first_region", "full_watch_decode"]) {
  expectRejected(`missing-${role}`, (proof) => {
    proof.evidence = proof.evidence.filter((item) => item.role !== role);
  }, "PROOF_EVIDENCE_ROLE");
}

expectRejected("illegal-evidence-status", (proof) => {
  proof.evidence.find((item) => item.role === "widest_caption").status = "OK";
}, "PROOF_STATUS");

expectRejected("illegal-report-status", (proof) => {
  proof.reports.lead.status = "APPROVED";
}, "PROOF_STATUS");

for (const severity of ["BLOCKER", "MAJOR"]) {
  expectRejected(`open-${severity.toLowerCase()}`, (proof) => {
    proof.reviews.findings.push({
      id: `OPEN-${severity}`,
      severity,
      status: "OPEN",
      blocksPreview: true,
      evidence: "review/lead-review-v1.md",
      recheck: {
        status: "NOT_APPLICABLE",
        evidence: "review/lead-review-v1.md",
      },
    });
  }, "PROOF_FINDING_OPEN");
}

expectRejected("missing-evidence-file", (proof) => {
  proof.evidence.find((item) => item.role === "widest_caption").path = "snapshots/acceptance/does-not-exist.png";
}, "PROOF_EVIDENCE_PATH");

expectRejected("undecodable-preview", (proof) => {
  const relative = path.join(TMP_RELATIVE, "undecodable.mp4");
  fs.writeFileSync(path.join(PROJECT, relative), "not a media file\n");
  proof.previews.internal.path = relative;
}, "PROOF_PREVIEW_DECODE");

expectRejected("wrong-preview-dimensions", (proof) => {
  proof.previews.internal.path = makePreview("wrong-dimensions", { size: "640x360", fps: 30 });
}, "PROOF_PREVIEW_DIMENSIONS");

expectRejected("wrong-preview-fps", (proof) => {
  proof.previews.internal.path = makePreview("wrong-fps", { size: "1920x1080", fps: 24 });
}, "PROOF_PREVIEW_FPS");

expectRejected("preview-v1-before-approval", (proof) => {
  proof.approval.previewV1Approved = false;
  proof.lifecycle.status = "REVIEWING";
}, "PROOF_PREVIEW_UNAPPROVED");

expectRejected("montage-method-substitution", (proof) => {
  proof.reviews.fourPasses.montage.readCaptions = true;
  proof.reviews.fourPasses.montage.evidenceRoles = ["source_acceptance"];
}, "PROOF_MONTAGE_METHOD");

expectRejected("motion-stills-substitution", (proof) => {
  proof.reviews.fourPasses.motion.watchedFullPreview = false;
  proof.reviews.fourPasses.motion.evidenceRoles = ["transition_midpoint", "readable_hold"];
}, "PROOF_MOTION_METHOD");

expectRejected("revision-owner-changed", (proof) => {
  proof.reviews.revisionOwner = "parallel-scene-fixer";
}, "PROOF_REVISION_OWNER");

expectRejected("closed-blocker-with-failed-recheck", (proof) => {
  proof.reviews.findings.push({
    id: "BLOCKER-CLOSED-WITHOUT-PASS",
    severity: "BLOCKER",
    status: "CLOSED",
    blocksPreview: true,
    evidence: "review/lead-review-v1.md",
    proofVersion: proof.proofVersion,
    executionLockSha256: proof.executor.executionLockSha256,
    recheck: {
      status: "FAIL",
      evidence: "review/lead-review-v1.md",
      proofVersion: proof.proofVersion,
      previewSha256: proof.executor.previewSha256,
      projectFingerprint: proof.executor.projectFingerprint,
      executionLockSha256: proof.executor.executionLockSha256,
    },
  });
}, "PROOF_FINDING_RECHECK");

record("changed content invalidates every stored PASS receipt", () => {
  const file = path.join(PROJECT, "compositions", "content.html");
  const before = fs.readFileSync(file);
  try {
    fs.appendFileSync(file, "\n<!-- stale proof mutation -->\n");
    const result = command(process.execPath, [VALIDATOR, PROJECT]);
    assert.notEqual(result.status, 0, "stale proof unexpectedly passed after content mutation");
    assert.match(output(result), /\[PROOF_STALE\]/);
  } finally {
    fs.writeFileSync(file, before);
  }
});

record("changed generated font invalidates the approved project fingerprint", () => {
  const file = path.join(PROJECT, "assets", "fonts", "NotoSansSC-400.ttf");
  const before = fs.readFileSync(file);
  try {
    fs.writeFileSync(file, Buffer.concat([before, Buffer.from("asset-drift") ]));
    const result = command(process.execPath, [VALIDATOR, PROJECT]);
    assert.notEqual(result.status, 0, "asset drift unexpectedly passed");
    assert.match(output(result), /\[PROOF_STALE\]|\[PROOF_REVIEW_BINDING\]|\[PROOF_APPROVAL_RECEIPT\]/);
  } finally {
    fs.writeFileSync(file, before);
  }
});

record("tampered human review report is rejected after binding", () => {
  const file = path.join(PROJECT, "review", "lead-review-v1.md");
  const before = fs.readFileSync(file);
  try {
    fs.appendFileSync(file, "\nTAMPERED REVIEW\n");
    const result = command(process.execPath, [VALIDATOR, PROJECT]);
    assert.notEqual(result.status, 0, "tampered review report unexpectedly passed");
    assert.match(output(result), /\[PROOF_REVIEW_ARTIFACT\]|\[PROOF_APPROVAL_RECEIPT\]/);
  } finally {
    fs.writeFileSync(file, before);
  }
});

record("tampered approval decision is rejected by its receipt", () => {
  const proof = writeProof("tampered-approval-decision", (value) => {
    value.approval.reviewer = "different-reviewer";
  });
  const result = command(process.execPath, [VALIDATOR, PROJECT, proof]);
  assert.notEqual(result.status, 0, "tampered approval decision unexpectedly passed");
  assert.match(output(result), /\[PROOF_APPROVAL_RECEIPT\]/);
});

record("proof approval preflight rejects unexplained animation flags without state change", () => {
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "hf-approval-preflight-"));
  const copy = path.join(isolated, "project");
  try {
    fs.cpSync(PROJECT, copy, { recursive: true });
    fs.rmSync(path.join(copy, "renders", "preview-v1.mp4"), { force: true });
    const proofPath = path.join(copy, "review", "proof-manifest-v1.json");
    const receiptPath = path.join(copy, "review", "approval-receipt-v1.json");
    const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
    proof.lifecycle.status = "REVIEWING";
    proof.previews.previewV1 = { status: "NOT_APPLICABLE", path: "renders/preview-v1.mp4" };
    proof.evidence = proof.evidence.filter((item) => item.role !== "preview_v1");
    proof.approval.previewV1Approved = false;
    proof.approval.approvedProofVersion = null;
    proof.animationMapReview.explainedFlags = [];
    fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
    const beforeProof = fs.readFileSync(proofPath);
    const beforeReceipt = fs.readFileSync(receiptPath);
    const result = command(process.execPath, [path.join(copy, "scripts", "proof-approve.mjs"), "reviewer", "1"], copy);
    assert.notEqual(result.status, 0, "approval with unexplained animation flags unexpectedly passed");
    assert.match(output(result), /Approval preflight failed|unexplained/);
    assert.deepEqual(fs.readFileSync(proofPath), beforeProof, "failed approval changed proof lifecycle");
    assert.deepEqual(fs.readFileSync(receiptPath), beforeReceipt, "failed approval changed the prior receipt");
  } finally {
    fs.rmSync(isolated, { recursive: true, force: true });
  }
});

record("trusted wrapper rejects a replaced project-local proof validator", () => {
  const file = path.join(PROJECT, "scripts", "validate-project-proof.mjs");
  const before = fs.readFileSync(file);
  try {
    fs.writeFileSync(file, "#!/usr/bin/env node\nprocess.exit(0);\n");
    const result = command(process.execPath, [VALIDATOR, PROJECT]);
    assert.notEqual(result.status, 0, "replaced project validator unexpectedly passed trusted wrapper");
    assert.match(output(result), /TRUSTED_PROJECT_BUNDLE/);
  } finally {
    fs.writeFileSync(file, before);
  }
});

record("trusted bundle rejects npm lifecycle hooks", () => {
  const file = path.join(PROJECT, "package.json");
  const before = fs.readFileSync(file, "utf8");
  try {
    const pkg = JSON.parse(before);
    pkg.scripts["precheck:inputs"] = "node payload.mjs";
    fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
    const result = command(process.execPath, [VERIFY_BUNDLE, PROJECT]);
    assert.notEqual(result.status, 0, "npm lifecycle hook unexpectedly passed trusted bundle verification");
    assert.match(output(result), /pre\/post hooks|factory-owned names/);
  } finally {
    fs.writeFileSync(file, before);
  }
});

record("trusted bundle rejects project npm configuration injection", () => {
  const file = path.join(PROJECT, ".npmrc");
  const before = fs.readFileSync(file, "utf8");
  try {
    fs.writeFileSync(file, "ignore-scripts=true\nnode-options=--require=./payload.cjs\n");
    const result = command(process.execPath, [VERIFY_BUNDLE, PROJECT]);
    assert.notEqual(result.status, 0, "project node-options unexpectedly passed trusted bundle verification");
    assert.match(output(result), /\.npmrc/);
  } finally {
    fs.writeFileSync(file, before);
  }
});

record("project-local producer shadowing is rejected and never executed", () => {
  const nodeModules = path.join(PROJECT, "node_modules");
  const fakePackage = path.join(nodeModules, "@hyperframes", "producer");
  const sentinel = path.join(RUN_ROOT, "malicious-producer-executed.txt");
  try {
    fs.mkdirSync(fakePackage, { recursive: true });
    fs.writeFileSync(
      path.join(fakePackage, "package.json"),
      `${JSON.stringify({ name: "@hyperframes/producer", version: "0.7.65", type: "module", exports: "./index.mjs" }, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(fakePackage, "index.mjs"),
      `import fs from "node:fs";\nfs.writeFileSync(process.env.HF_SHADOW_SENTINEL, "EXECUTED\\n");\nexport const malicious = true;\n`,
    );

    const verification = command(process.execPath, [VERIFY_BUNDLE, PROJECT]);
    assert.notEqual(verification.status, 0, "project-local producer unexpectedly passed trusted bundle verification");
    assert.match(output(verification), /project-local node_modules.*forbidden/i);
    assert.equal(fs.existsSync(sentinel), false, "bundle verification executed the malicious producer");

    const loader = pathToFileURL(path.join(PROJECT, "scripts", "package-loader.mjs")).href;
    const source = `import { importPackagesOrBootstrap } from ${JSON.stringify(loader)};\nawait importPackagesOrBootstrap(["@hyperframes/producer"], { npmPackages: ["@hyperframes/producer@0.7.65"] });\n`;
    const env = {
      ...process.env,
      HF_SHADOW_SENTINEL: sentinel,
      HYPERFRAMES_SKILL_BOOTSTRAP_DEPS: "0",
    };
    const load = command(process.execPath, ["--input-type=module", "--eval", source], PROJECT, env);
    assert.notEqual(load.status, 0, "package loader accepted a project-local producer without isolated bootstrap");
    assert.match(output(load), /isolated temporary install|Project-local packages.*never imported/i);
    assert.equal(fs.existsSync(sentinel), false, "package loader executed the malicious project-local producer");
  } finally {
    fs.rmSync(nodeModules, { recursive: true, force: true });
    fs.rmSync(sentinel, { force: true });
  }
});

record("tampered gate log is rejected by its receipt digest", () => {
  const file = path.join(PROJECT, "review", "cli", "lint.txt");
  const before = fs.readFileSync(file);
  try {
    fs.appendFileSync(file, "\nTAMPERED\n");
    const result = command(process.execPath, [VALIDATOR, PROJECT]);
    assert.notEqual(result.status, 0, "tampered gate log unexpectedly passed");
    assert.match(output(result), /\[PROOF_GATE_RECEIPT\]/);
  } finally {
    fs.writeFileSync(file, before);
  }
});

record("tampered acceptance snapshot is rejected by the gate artifact digest", () => {
  const file = path.join(PROJECT, "snapshots", "acceptance", "frame-00-at-0.1s.png");
  const before = fs.readFileSync(file);
  try {
    fs.writeFileSync(file, Buffer.concat([before, Buffer.from("tampered")]));
    const result = command(process.execPath, [VALIDATOR, PROJECT]);
    assert.notEqual(result.status, 0, "tampered acceptance snapshot unexpectedly passed");
    assert.match(output(result), /\[PROOF_GATE_RECEIPT\]/);
  } finally {
    fs.writeFileSync(file, before);
  }
});

record("package command suffixes are rejected before execution", () => {
  const file = path.join(PROJECT, "package.json");
  const before = fs.readFileSync(file, "utf8");
  try {
    const pkg = JSON.parse(before);
    pkg.scripts["proof:lint"] += "; echo unsafe";
    fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
    const result = command(process.execPath, [VALIDATOR, PROJECT]);
    assert.notEqual(result.status, 0, "shell suffix unexpectedly passed");
    assert.match(output(result), /\[(?:PROOF_SCRIPT_MISSING|PROOF_CURRENT_GATE)\]/);
  } finally {
    fs.writeFileSync(file, before);
  }
});

record("stage candidate tampering is rejected", () => {
  const file = path.join(PROJECT, "review", "stage-parity", "hyperframes-t000.png");
  const before = fs.readFileSync(file);
  try {
    fs.writeFileSync(file, Buffer.concat([before, Buffer.from("tampered")]));
    const result = command(process.execPath, [VALIDATOR, PROJECT]);
    assert.notEqual(result.status, 0, "altered stage candidate unexpectedly passed");
    assert.match(output(result), /\[PROOF_STAGE_PARITY\]/);
  } finally {
    fs.writeFileSync(file, before);
  }
});

record("visual stage proof rejects a hidden background mutation", () => {
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "hf-stage-mutation-"));
  const copy = path.join(isolated, "project");
  try {
    fs.cpSync(PROJECT, copy, { recursive: true });
    const backgroundPath = path.join(copy, "compositions", "studio-background.html");
    const background = fs.readFileSync(backgroundPath, "utf8").replace("</style>", "#studio-background-root { display: none !important; }</style>");
    fs.writeFileSync(backgroundPath, background);
    const result = command(process.execPath, [path.join(copy, "scripts", "proof-stage.mjs")], copy);
    assert.notEqual(result.status, 0, "hidden fixed background unexpectedly passed visual parity");
    assert.match(output(result), /Stage parity failed|SSIM/i);
  } finally {
    fs.rmSync(isolated, { recursive: true, force: true });
  }
});

record("promotion is atomic and blocked approval has zero side effects", () => {
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "hf-promotion-test-"));
  const copy = path.join(isolated, "project");
  try {
    fs.cpSync(PROJECT, copy, { recursive: true });
    const preview = path.join(copy, "renders", "preview-v1.mp4");
    fs.rmSync(preview, { force: true });
    const proofPath = path.join(copy, "review", "proof-manifest-v1.json");
    const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
    proof.lifecycle.status = "REVIEW_APPROVED";
    proof.previews.previewV1 = { status: "NOT_APPLICABLE", path: "renders/preview-v1.mp4" };
    proof.evidence = proof.evidence.filter((item) => item.role !== "preview_v1");
    proof.approval.previewV1Approved = false;
    fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
    const before = fs.readFileSync(proofPath);
    const result = command(process.execPath, [path.join(copy, "scripts", "promote-preview.mjs")], copy);
    assert.notEqual(result.status, 0, "disapproved promotion unexpectedly passed");
    assert.equal(fs.existsSync(preview), false, "blocked promotion created preview-v1");
    assert.deepEqual(fs.readFileSync(proofPath), before, "blocked promotion changed the proof manifest");
  } finally {
    fs.rmSync(isolated, { recursive: true, force: true });
  }
});

record("promotion rolls back after manifest installation fails", () => {
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "hf-promotion-rollback-"));
  const copy = path.join(isolated, "project");
  try {
    fs.cpSync(PROJECT, copy, { recursive: true });
    const preview = path.join(copy, "renders", "preview-v1.mp4");
    fs.rmSync(preview, { force: true });
    const proofPath = path.join(copy, "review", "proof-manifest-v1.json");
    const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
    proof.lifecycle.status = "REVIEW_APPROVED";
    proof.previews.previewV1 = { status: "NOT_APPLICABLE", path: "renders/preview-v1.mp4" };
    proof.evidence = proof.evidence.filter((item) => item.role !== "preview_v1");
    fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
    const before = fs.readFileSync(proofPath);
    const result = command(
      process.execPath,
      [path.join(copy, "scripts", "promote-preview.mjs")],
      copy,
      { ...process.env, HYPERFRAMES_TEST_PROMOTION_FAILPOINT: "after-manifest-install" },
    );
    assert.notEqual(result.status, 0, "injected post-manifest failure unexpectedly passed");
    assert.match(output(result), /Injected promotion failure/);
    assert.equal(fs.existsSync(preview), false, "rollback left preview-v1 installed");
    assert.deepEqual(fs.readFileSync(proofPath), before, "rollback did not restore the approved manifest");
    for (const relative of ["review/.promotion-transaction.json", "review/.proof-manifest-v1.promotion-backup.json", "review/.proof-manifest-v1.promotion-next.json", "renders/.preview-v1.promotion.tmp"]) {
      assert.equal(fs.existsSync(path.join(copy, relative)), false, `rollback left ${relative}`);
    }
  } finally {
    fs.rmSync(isolated, { recursive: true, force: true });
  }
});

record("promotion recovers an interrupted manifest-preview transaction", () => {
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "hf-promotion-recovery-"));
  const copy = path.join(isolated, "project");
  try {
    fs.cpSync(PROJECT, copy, { recursive: true });
    const proofPath = path.join(copy, "review", "proof-manifest-v1.json");
    const preview = path.join(copy, "renders", "preview-v1.mp4");
    const internal = path.join(copy, "renders", "internal-preview-v1.mp4");
    const approved = JSON.parse(fs.readFileSync(proofPath, "utf8"));
    approved.lifecycle.status = "REVIEW_APPROVED";
    approved.previews.previewV1 = { status: "NOT_APPLICABLE", path: "renders/preview-v1.mp4" };
    approved.evidence = approved.evidence.filter((item) => item.role !== "preview_v1");
    const approvedText = `${JSON.stringify(approved, null, 2)}\n`;
    fs.writeFileSync(path.join(copy, "review", ".proof-manifest-v1.promotion-backup.json"), approvedText);
    const interrupted = clone(approved);
    interrupted.lifecycle.status = "PREVIEW_READY";
    fs.writeFileSync(proofPath, `${JSON.stringify(interrupted, null, 2)}\n`);
    fs.copyFileSync(internal, preview);
    fs.writeFileSync(path.join(copy, "review", ".promotion-transaction.json"), `${JSON.stringify({ version: 1, manifestPath: "review/proof-manifest-v1.json", previewPath: "renders/preview-v1.mp4" }, null, 2)}\n`);
    const result = command(process.execPath, [path.join(copy, "scripts", "promote-preview.mjs")], copy);
    assert.equal(result.status, 0, output(result));
    assert.match(output(result), /RECOVERED interrupted preview promotion/);
    assert.equal(JSON.parse(fs.readFileSync(proofPath, "utf8")).lifecycle.status, "PREVIEW_READY");
    assert.equal(fs.existsSync(path.join(copy, "review", ".promotion-transaction.json")), false);
  } finally {
    fs.rmSync(isolated, { recursive: true, force: true });
  }
});

record("media proof refuses a dangling log symlink without touching its target", () => {
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "hf-media-symlink-"));
  const copy = path.join(isolated, "project");
  const outside = path.join(isolated, "outside.txt");
  try {
    fs.cpSync(PROJECT, copy, { recursive: true });
    fs.writeFileSync(outside, "EXTERNAL SENTINEL\n");
    const log = path.join(copy, "review", "media", "ffprobe.json");
    fs.rmSync(log, { force: true });
    fs.symlinkSync(outside, log);
    const result = command(process.execPath, [path.join(copy, "scripts", "analyze-preview.mjs")], copy);
    assert.notEqual(result.status, 0, "media proof followed a log symlink");
    assert.equal(fs.readFileSync(outside, "utf8"), "EXTERNAL SENTINEL\n");
  } finally {
    fs.rmSync(isolated, { recursive: true, force: true });
  }
});

record("contact sheet builds in declared order", () => {
  const colorDir = path.join(PROJECT, "snapshots", "acceptance", `.proof-test-colors-${process.pid}`);
  fs.mkdirSync(colorDir, { recursive: true });
  const colors = ["red", "green", "blue", "yellow", "magenta", "cyan"];
  const frames = colors.map((color, index) => {
    const frame = path.join(colorDir, `${index}-${color}.png`);
    const generated = command("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${color}:s=64x64:d=0.04`, "-frames:v", "1", "-y", frame]);
    assert.equal(generated.status, 0, output(generated));
    return frame;
  });
  const target = path.join(PROJECT, "review", `.proof-test-contact-${process.pid}.png`);
  const invocationFrames = frames.map((file) => file.startsWith("/private/var/") ? file.replace("/private/var/", "/var/") : file);
  try {
    const result = command(process.execPath, [CONTACT_SHEET, "--output", target, ...invocationFrames]);
    assert.equal(result.status, 0, output(result));
    const probe = command("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height", "-of", "json", target,
    ]);
    assert.equal(probe.status, 0, output(probe));
    const stream = JSON.parse(probe.stdout).streams[0];
    assert.deepEqual({ width: stream.width, height: stream.height }, { width: 1920, height: 1080 });
    const expected = [[255, 0, 0], [0, 128, 0], [0, 0, 255], [255, 255, 0], [255, 0, 255], [0, 255, 255]];
    const samples = [[240, 270], [720, 270], [1200, 270], [1680, 270], [240, 810], [720, 810]];
    for (const [index, [x, y]] of samples.entries()) {
      const sample = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", target, "-vf", `crop=1:1:${x}:${y},format=rgb24`, "-frames:v", "1", "-f", "rawvideo", "pipe:1"]);
      assert.equal(sample.status, 0, sample.stderr?.toString());
      const pixel = [...sample.stdout.subarray(0, 3)];
      assert.ok(pixel.every((value, channel) => Math.abs(value - expected[index][channel]) <= 12), `cell ${index} has pixel ${pixel}, expected ${expected[index]}`);
    }
  } finally {
    fs.rmSync(target, { force: true });
    fs.rmSync(colorDir, { recursive: true, force: true });
  }
});

record("contact sheet rejects missing input", () => {
  const target = path.join(PROJECT, "review", `.proof-test-missing-contact-${process.pid}.png`);
  const result = command(process.execPath, [
    CONTACT_SHEET,
    "--output", target,
    path.join(PROJECT, "snapshots", "acceptance", "does-not-exist.png"),
  ]);
  assert.notEqual(result.status, 0, "contact-sheet builder accepted a missing input");
  assert.match(output(result), /does not exist|missing or empty input frame/);
});

record("contact sheet rejects output traversal", () => {
  const input = path.join(PROJECT, "snapshots", "acceptance", "frame-00-at-0.1s.png");
  const outside = path.join(os.tmpdir(), `hf-contact-outside-${process.pid}.png`);
  const result = command(process.execPath, [CONTACT_SHEET, "--output", outside, input]);
  assert.notEqual(result.status, 0, "contact-sheet builder accepted an output outside review/");
  assert.match(output(result), /must stay inside review/i);
  assert.equal(fs.existsSync(outside), false);
});

let completed = 0;
try {
  for (const scenario of scenarios) {
    scenario.run();
    completed += 1;
  }
} finally {
  fs.rmSync(RUN_ROOT, { recursive: true, force: true });
}

console.log(`PASS test_proof_pipeline (${completed}/${scenarios.length} scenarios)`);
