#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { canonicalProjectRoot, safeProjectPath, sha256File, trustedExecutable, writeJsonAtomic } from "./project-integrity.mjs";

const GOLDENS = [
  { at: 0, file: "narrow-center-grid-t000.png", sha256: "0d480d93f1e4fad0ad1f8526eddbce5a77a940157485a4b329ec0cf52719a0cf" },
  { at: 4, file: "narrow-center-grid-t004.png", sha256: "69acc380bf992fd351a4cedd952b94a79e4f124f96bb4041d88edd78e8da98ed" },
  { at: 9, file: "narrow-center-grid-t009.png", sha256: "388e9390d09d44cd56ebb5a55b56dc5dbc92b061a88efcc550d2a855f65fc18a" },
];
const THRESHOLD = 0.995;
const projectDir = canonicalProjectRoot(process.cwd());
const npx = trustedExecutable("npx", projectDir);
const ffmpeg = trustedExecutable("ffmpeg", projectDir);
const outputDir = safeProjectPath(projectDir, "review/stage-parity", { mustExist: false });
fs.mkdirSync(outputDir, { recursive: true });

for (const golden of GOLDENS) {
  const file = safeProjectPath(projectDir, `proof/goldens/${golden.file}`, { type: "file" });
  if (sha256File(file) !== golden.sha256) throw new Error(`Golden hash mismatch: ${golden.file}`);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hyperframes-stage-proof-"));
const tempProject = path.join(tempRoot, "project");
try {
  fs.cpSync(projectDir, tempProject, { recursive: true, dereference: false });
  const stylesPath = path.join(tempProject, "styles.css");
  fs.appendFileSync(stylesPath, "\n#content-mount,#caption-mount,#pip-mount,#pip-media-wrapper{display:none!important}\n");
  for (const relative of ["index.html", "compositions/studio-background.html", "compositions/content.html", "compositions/caption-overlay.html", "compositions/pip-overlay.html"]) {
    const file = path.join(tempProject, relative);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8").replace(/data-duration=["'][0-9.]+["']/g, 'data-duration="10"').replace(/const DURATION_SECONDS = [0-9.]+;/g, "const DURATION_SECONDS = 10;");
    fs.writeFileSync(file, text);
  }
  const metaPath = path.join(tempProject, "meta.json");
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  meta.duration = 10;
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  const snapshots = path.join(tempRoot, "snapshots");
  const snapshot = spawnSync(npx, ["--yes", "hyperframes@0.7.65", "snapshot", "--at", "0,4,9", "--no-end", "--output", snapshots, "--describe", "false"], {
    cwd: tempProject,
    encoding: "utf8",
    timeout: 300_000,
  });
  if (snapshot.error) throw new Error(`HyperFrames stage snapshot could not start: ${snapshot.error.message}`);
  if (snapshot.status !== 0) throw new Error(`HyperFrames stage snapshot failed:\n${snapshot.stdout}${snapshot.stderr}`);
  const candidates = fs.readdirSync(snapshots).filter((name) => name.endsWith(".png")).sort().map((name) => path.join(snapshots, name));
  if (candidates.length !== GOLDENS.length) throw new Error(`Expected 3 stage snapshots, found ${candidates.length}`);
  const comparisons = [];
  for (const [index, golden] of GOLDENS.entries()) {
    const goldenPath = path.join(projectDir, "proof/goldens", golden.file);
    const candidatePath = candidates[index];
    const compare = spawnSync(ffmpeg, ["-hide_banner", "-i", goldenPath, "-i", candidatePath, "-filter_complex", "[0:v]format=yuv420p[a];[1:v]format=yuv420p[b];[a][b]ssim", "-f", "null", "-"], { encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
    if (compare.error || compare.status !== 0) throw new Error(`SSIM comparison failed for t=${golden.at}: ${compare.error?.message ?? compare.stderr}`);
    const ssim = Number(`${compare.stdout}${compare.stderr}`.match(/All:([0-9.]+)/)?.[1]);
    if (!Number.isFinite(ssim) || ssim < THRESHOLD) throw new Error(`Stage parity failed at ${golden.at}s: SSIM ${ssim} < ${THRESHOLD}`);
    const storedRelative = `review/stage-parity/hyperframes-t${String(golden.at).padStart(3, "0")}.png`;
    const stored = safeProjectPath(projectDir, storedRelative, { mustExist: false });
    if (fs.existsSync(stored) && fs.lstatSync(stored).isSymbolicLink()) throw new Error(`Stage candidate output must not be a symbolic link: ${storedRelative}`);
    const storedTemp = `${stored}.${process.pid}.${Date.now()}.tmp`;
    fs.copyFileSync(candidatePath, storedTemp, fs.constants.COPYFILE_EXCL);
    fs.renameSync(storedTemp, stored);
    comparisons.push({ atSeconds: golden.at, golden: `proof/goldens/${golden.file}`, goldenSha256: golden.sha256, candidate: storedRelative, candidateSha256: sha256File(stored), ssim });
  }
  writeJsonAtomic(path.join(outputDir, "stage-parity-receipt.json"), { version: 1, threshold: THRESHOLD, cli: "hyperframes@0.7.65", comparisons });
  console.log(`PASS fixed-stage parity at 0s, 4s, and 9s (SSIM >= ${THRESHOLD})`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
