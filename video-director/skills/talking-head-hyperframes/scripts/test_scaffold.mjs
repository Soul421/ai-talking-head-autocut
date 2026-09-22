#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(SCRIPT_DIR, "..");
const SCAFFOLD = path.join(SCRIPT_DIR, "scaffold_talking_head_hyperframes_project.mjs");
const VALIDATE_INPUTS = path.join(SCRIPT_DIR, "validate_inputs.mjs");
const VALIDATE_STAGE = path.join(SCRIPT_DIR, "validate_fixed_stage.mjs");
const FIXTURES = path.join(SKILL_DIR, "evals/fixtures/ingestion");
const HARD_REJECTIONS = [
  "repeated-generic-entrance",
  "decorative-continuous-motion",
  "unanchored-decoration",
  "generic-ai-decoration",
  "empty-reset-transition",
  "unreadable-transition-midpoint",
];

let passed = 0;
let failed = 0;

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });
}

function scaffold(args) {
  return run(process.execPath, [SCAFFOLD, ...args]);
}

function output(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
}

function expectOk(result, label) {
  assert.equal(result.status, 0, `${label} failed:\n${output(result)}`);
}

function expectFail(result, pattern, label) {
  assert.notEqual(result.status, 0, `${label} unexpectedly passed`);
  assert.match(output(result), pattern, `${label} emitted the wrong error:\n${output(result)}`);
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function json(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function treeDigest(root) {
  const records = [];
  const visit = async (directory) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) records.push(`${relative}:link`);
      else if (info.isDirectory()) await visit(absolute);
      else records.push(`${relative}:${await sha256(absolute)}`);
    }
  };
  await visit(root);
  return createHash("sha256").update(records.join("\n")).digest("hex");
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error.stack ?? error.message}`);
  }
}

function writeContract(file, { hashes, duration = 2.4, pipeline = "remotion", mutate = (value) => value }) {
  const contract = {
    version: 1,
    pipeline,
    fps: 30,
    timeline: {
      programDurationSeconds: duration,
      audioDurationSeconds: 2.4,
      captionsEndSeconds: 2.2,
    },
    sourceHashes: { ...hashes },
    hardRejections: HARD_REJECTIONS,
    fixedStage: {
      template: "studio-warm-grid",
      contentMotionDefault: "none",
      globalSceneTransition: "none",
      continuousMotionAllowlist: ["PremiumGridBackground"],
    },
    beats: [
      {
        beatId: "FIXTURE-B01",
        startSeconds: 0,
        endSeconds: duration,
        mode: "readable-hold",
        state: {
          from: "The audience has the raw fixture input.",
          to: "The audience can read the locked fixture state.",
          newUnderstanding: "The fixture proves a static semantic state.",
        },
        primaryMotion: null,
        stillReason: "The fixture intentionally holds one readable state.",
        supportMotion: null,
        continuousMotions: [],
        readableHold: {
          startSeconds: 0,
          endSeconds: duration,
          reason: "The complete fixture is a readable hold.",
        },
        deletionTest: "Removing this beat removes the only asserted state.",
        rejectionConditions: ["Any content motion during the hold fails."],
        acceptanceFrames: [
          { atSeconds: 0, role: "start", assertions: ["The fixture state is visible."] },
          { atSeconds: Number((duration / 2).toFixed(3)), role: "readable_hold", assertions: ["The fixture remains static and readable."] },
        ],
        handoff: null,
      },
    ],
  };
  return writeFile(file, `${JSON.stringify(mutate(contract), null, 2)}\n`);
}

async function main() {
  const scratch = await mkdtemp(path.join(os.tmpdir(), "talking-head-hyperframes-u3-"));
  try {
    const media = path.join(scratch, "media");
    await mkdir(media);
    const audio = path.join(media, "voice.wav");
    const talkingHead = path.join(media, "talking-head.mp4");
    const recording = path.join(media, "recording.mp4");
    const screenshot = path.join(media, "screenshot.png");
    const font = path.join(SKILL_DIR, "assets/hyperframes-project/assets/fonts/SpaceGrotesk-400.ttf");

    expectOk(
      run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=880:duration=2.4", "-c:a", "pcm_s16le", audio]),
      "fixture audio generation",
    );
    for (const file of [talkingHead, recording]) {
      expectOk(
        run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180:d=2.4", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", file]),
        `fixture video generation (${path.basename(file)})`,
      );
    }
    expectOk(
      run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=64x64:d=0.04", "-frames:v", "1", screenshot]),
      "fixture screenshot generation",
    );

    const director = path.join(FIXTURES, "director-script.md");
    const production = path.join(FIXTURES, "production-spec.md");
    const assetPlan = path.join(FIXTURES, "asset-plan.md");
    const captions = path.join(FIXTURES, "captions-aligned.json");
    const hashes = {
      directorScript: await sha256(director),
      productionSpec: await sha256(production),
      assetPlan: await sha256(assetPlan),
      audio: await sha256(audio),
      captionsAligned: await sha256(captions),
    };
    const contract = path.join(scratch, "motion-contract.json");
    await writeContract(contract, { hashes });
    const fullArgs = (project) => [
      "--project-dir", project,
      "--title", "Ready Fixture",
      "--audio", audio,
      "--captions", captions,
      "--captions", path.join(FIXTURES, "captions.srt"),
      "--captions", path.join(FIXTURES, "captions.vtt"),
      "--director-script", director,
      "--production-spec", production,
      "--asset-plan", assetPlan,
      "--motion-contract", contract,
      "--talking-head", talkingHead,
      "--screen-recording", recording,
      "--screenshot", screenshot,
      "--font", font,
    ];

    await test("project-dir alone produces an honest TEMPLATE_ONLY project", async () => {
      const project = path.join(scratch, "template-only");
      const result = scaffold(["--project-dir", project, "--title", "Bare Fixture"]);
      expectOk(result, "template-only scaffold");
      const manifest = await json(path.join(project, "manifest.json"));
      assert.equal(manifest.status, "TEMPLATE_ONLY");
      assert.equal(manifest.durationSeconds, 18);
      assert.equal(manifest.nextSkill, null);
      assert.equal(manifest.fixedStage.version, "studio-warm-white-fixed-stage-v3");
      assert.match(manifest.design.sha256, /^[a-f0-9]{64}$/);
      assert.deepEqual(
        manifest.missingInputs.map((item) => item.id),
        ["directorScript", "productionSpec", "assetPlan", "motionContract", "audio", "captionsAligned"],
      );
      for (const item of manifest.missingInputs) {
        assert.ok(item.action && item.expectedPath, `missing input ${item.id} must be actionable`);
      }
      for (const absent of [
        "inputs/视频脚本.md",
        "inputs/制作规格.md",
        "inputs/素材计划.md",
        "inputs/motion-contract.json",
        "inputs/captions/captions_aligned.json",
        "assets/audio/voice/voice.wav",
        "assets/video/talking-head/talking-head.mp4",
        "STORYBOARD.md",
        "SCENE_SCHEMA.json",
      ]) {
        assert.equal(await exists(path.join(project, absent)), false, `must not invent ${absent}`);
      }
      const index = await readFile(path.join(project, "index.html"), "utf8");
      assert.doesNotMatch(index, /<audio\b|pip-overlay\.html/);
      const pkg = await json(path.join(project, "package.json"));
      assert.equal(pkg.scripts["check:inputs"], "node scripts/check-inputs.mjs");
      assert.equal(pkg.scripts["check:fixed-stage"], "node scripts/check-fixed-stage.mjs");
      assert.equal(pkg.scripts["check:template"], "node scripts/run-workflow.mjs check-template");
      assert.equal(pkg.scripts["review:pip"], "node scripts/build-pip-review.mjs");
      assert.ok(await exists(path.join(project, "scripts/check-inputs.mjs")));
      assert.ok(await exists(path.join(project, "scripts/check-fixed-stage.mjs")));
      assert.match(await readFile(path.join(project, "review/template-handoff.md"), "utf8"), /TEMPLATE_ONLY[\s\S]*Missing before execution/);
      expectOk(run(process.execPath, [VALIDATE_INPUTS, project]), "template-only input validator");
      expectOk(run(process.execPath, [VALIDATE_STAGE, project]), "template-only stage validator");
      expectOk(run("npm", ["run", "check:inputs"], { cwd: project }), "project-local template input check");
      expectOk(run("npm", ["run", "check:fixed-stage"], { cwd: project }), "project-local template stage check");
      if (process.env.RUN_HYPERFRAMES_INTEGRATION === "1") {
        expectOk(run("npm", ["run", "check:stage-parity"], { cwd: project }), "TEMPLATE_ONLY stage parity proof");
      }
    });

    await test("complete locked inputs produce READY_FOR_EXECUTION with native assets", async () => {
      const project = path.join(scratch, "ready");
      const args = fullArgs(project);
      expectOk(scaffold(args), "ready scaffold");
      const manifest = await json(path.join(project, "manifest.json"));
      assert.equal(manifest.status, "READY_FOR_EXECUTION");
      assert.equal(manifest.durationSeconds, 2.4);
      assert.equal(manifest.motionContract.pipeline, "remotion");
      assert.equal(manifest.nextSkill, "hyperframes-scene-animator");
      assert.deepEqual(manifest.missingInputs, []);
      assert.equal(manifest.validation.audioDecodable, true);
      assert.equal(manifest.validation.alignedCaptionCount, 2);
      assert.equal(manifest.validation.contractSourcesMatch, true);
      const inputRecords = Object.values(manifest.inputs).flat().filter(Boolean);
      for (const record of inputRecords) {
        assert.ok(record.sourcePath);
        assert.ok(record.path && !path.isAbsolute(record.path));
        assert.match(record.sha256, /^[a-f0-9]{64}$/);
        assert.ok(record.bytes > 0);
      }
      assert.equal(manifest.inputs.audio.path, "assets/audio/voice/voice.wav");
      assert.equal(manifest.inputs.talkingHead.path, "assets/video/talking-head/talking-head.mp4");
      assert.equal(manifest.inputs.screenRecordings[0].path, "assets/video/screen-recordings/screen-01.mp4");
      assert.equal(manifest.inputs.screenshots[0].path, "assets/images/screenshots/screenshot-01.png");
      assert.equal(manifest.inputs.fonts[0].path, "assets/fonts/custom-01.ttf");
      assert.equal(
        await readFile(path.join(project, "inputs/motion-contract.json"), "utf8"),
        await readFile(contract, "utf8"),
        "the original semantic contract must be preserved byte-for-byte",
      );
      assert.ok(manifest.inputs.audio.durationSeconds > 2.3);
      assert.ok(manifest.inputs.talkingHead.durationSeconds > 2.3);
      assert.ok(manifest.inputs.screenRecordings[0].durationSeconds > 2.3);
      const index = await readFile(path.join(project, "index.html"), "utf8");
      assert.match(index, /<audio\b[^>]*id="voice-audio"[^>]*data-start="0"[^>]*data-duration="2\.4"[^>]*data-track-index="200"[^>]*src="assets\/audio\/voice\/voice\.wav"/s);
      assert.match(index, /compositions\/pip-overlay\.html/);
      for (const relative of ["index.html", "compositions/studio-background.html", "compositions/content.html", "compositions/caption-overlay.html", "compositions/pip-overlay.html"]) {
        assert.match(await readFile(path.join(project, relative), "utf8"), /data-duration="2\.4"/, `${relative} duration`);
      }
      assert.match(await readFile(path.join(project, "compositions/studio-background.html"), "utf8"), /const DURATION_SECONDS = 2\.4;/);
      const captionHtml = await readFile(path.join(project, "compositions/caption-overlay.html"), "utf8");
      assert.equal((captionHtml.match(/class="caption-group clip"/g) ?? []).length, 2);
      assert.match(captionHtml, /id="caption-group-0"[^>]*class="caption-group clip"[^>]*data-start="0\.1"[^>]*data-duration="0\.93"[^>]*data-track-index="100"/s);
      assert.match(captionHtml, /id="caption-group-1"[^>]*class="caption-group clip"[^>]*data-start="1\.03"[^>]*data-duration="1\.17"[^>]*data-track-index="100"/s);
      assert.match(captionHtml, /timeline\.set\("#caption-body-0", \{ opacity: 0, visibility: "hidden" \}, 1\.05\);/);
      assert.doesNotMatch(captionHtml, /async|setTimeout|Promise|<br\s*\/?>/);
      const pip = await readFile(path.join(project, "compositions/pip-overlay.html"), "utf8");
      assert.doesNotMatch(pip, /<video\b/);
      assert.match(index, /<div id="pip-media-wrapper"[^>]*>\s*<video id="talking-head-video" class="clip"[^>]*data-start="0"[^>]*data-duration="2\.4"[^>]*src="assets\/video\/talking-head\/talking-head\.mp4"[^>]*muted[^>]*playsinline/s);
      assert.doesNotMatch(index.match(/<div id="pip-media-wrapper"[^>]*>/)[0], /data-start|data-duration/);
      assert.doesNotMatch(pip, /\.play\(|\.pause\(|autoplay/);
      assert.deepEqual(manifest.fixedStage.pipContract.frameRegion, {
        x: 1610, y: 724, width: 206, height: 206, right: 104, bottom: 150, zIndex: 90,
      });
      assert.deepEqual(manifest.fixedStage.pipContract.mediaRegion, {
        x: 1618, y: 732, width: 190, height: 190, right: 112, bottom: 158, zIndex: 89,
      });
      assert.equal(manifest.fixedStage.pipContract.sourceCrop.objectPositionXPercent, 66.7);
      assert.equal(manifest.fixedStage.pipContract.sourceCrop.objectPositionYPercent, 50);
      assert.equal(manifest.fixedStage.pipContract.sourceCrop.profile, "bozhou-digital-twin-v1");
      assert.equal(manifest.fixedStage.pipContract.background.opaque, true);
      assert.equal(manifest.fixedStage.pipContract.background.base, "#f2f6f8");
      const styles = await readFile(path.join(project, "styles.css"), "utf8");
      assert.match(styles, /#pip-media-wrapper[\s\S]*right: 112px;[\s\S]*bottom: 158px;[\s\S]*width: 190px;[\s\S]*height: 190px;/);
      assert.match(styles, /background-color: #f2f6f8;/);
      assert.match(styles, /linear-gradient\(180deg, #f2f6f8 0%, rgba\(47, 111, 255, 0\.30\) 140%\)/);
      assert.match(styles, /object-fit: cover;[\s\S]*object-position: 66\.7% 50%;/);
      assert.match(pip, /\.pip-inner[\s\S]*background-color: transparent;/);
      assert.match(pip, /\.pip-mask[\s\S]*background: transparent;/);
      await mkdir(path.join(project, "renders"), { recursive: true });
      expectOk(
        run("ffmpeg", [
          "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=1920x1080:d=1.5",
          "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(project, "renders/internal-preview-v1.mp4"),
        ]),
        "generated 1080p PIP review fixture",
      );
      expectOk(
        run("npm", ["run", "review:pip", "--", "renders/internal-preview-v1.mp4", "1"], { cwd: project }),
        "generated PIP review evidence",
      );
      assert.equal(await exists(path.join(project, "review/pip/internal-preview-v1-frame.png")), true);
      assert.equal(await exists(path.join(project, "review/pip/internal-preview-v1-crop-3x.png")), true);
      const pipReview = await json(path.join(project, "review/pip/internal-preview-v1-review.json"));
      assert.equal(pipReview.status, "REQUIRES_VISUAL_REVIEW");
      assert.equal(pipReview.acceptance.noStageGridInsideCircle, false);
      assert.equal(pipReview.acceptance.subjectInsideSafeArea, false);
      assert.match(await readFile(path.join(project, "review/template-handoff.md"), "utf8"), /READY_FOR_EXECUTION[\s\S]*hyperframes-scene-animator/);
      expectOk(run(process.execPath, [VALIDATE_INPUTS, project]), "ready input validator");
      expectOk(run(process.execPath, [VALIDATE_STAGE, project]), "ready stage validator");
      expectOk(run("npm", ["run", "check:inputs"], { cwd: project }), "project-local ready input check");
      expectOk(run("npm", ["run", "check:fixed-stage"], { cwd: project }), "project-local ready stage check");
      if (process.env.RUN_HYPERFRAMES_INTEGRATION === "1") {
        expectOk(run("npm", ["run", "check:template"], { cwd: project }), "generated READY HyperFrames template check");
      }
    });

    await test("--force repairs READY without demoting status or losing provenance", async () => {
      const project = path.join(scratch, "ready-repair");
      expectOk(scaffold(fullArgs(project)), "initial READY scaffold");
      const before = await json(path.join(project, "manifest.json"));
      await writeFile(path.join(project, "compositions/content.html"), "DOWNSTREAM READY CONTENT\n");
      await writeFile(path.join(project, "index.html"), "BROKEN TEMPLATE INDEX\n");
      await writeFile(path.join(project, "package.json"), "{}\n");
      await writeFile(path.join(project, "proof/goldens/remotion-t000.png"), "OBSOLETE GOLDEN\n");
      expectOk(scaffold(["--project-dir", project, "--force"]), "READY force repair");
      const after = await json(path.join(project, "manifest.json"));
      assert.equal(after.status, "READY_FOR_EXECUTION");
      assert.equal(after.durationSeconds, before.durationSeconds);
      assert.equal(after.inputs.audio.sourcePath, before.inputs.audio.sourcePath);
      assert.equal(after.inputs.motionContract.sourcePath, before.inputs.motionContract.sourcePath);
      assert.equal(after.fixedStage.pipMode, "talking-head-video");
      assert.equal(await readFile(path.join(project, "compositions/content.html"), "utf8"), "DOWNSTREAM READY CONTENT\n");
      assert.match(await readFile(path.join(project, "index.html"), "utf8"), /studio-background/);
      assert.equal((await json(path.join(project, "package.json"))).scripts["proof:approve"], "node scripts/proof-approve.mjs");
      assert.equal(await exists(path.join(project, "proof/goldens/remotion-t000.png")), false);
    });

    await test("--force migrates pristine TEMPLATE_ONLY content to a changed contract duration", async () => {
      const project = path.join(scratch, "template-to-ready-duration-migration");
      expectOk(scaffold(["--project-dir", project]), "initial TEMPLATE_ONLY scaffold");
      assert.match(await readFile(path.join(project, "compositions/content.html"), "utf8"), /data-duration="18"/);

      expectOk(scaffold([...fullArgs(project), "--force"]), "TEMPLATE_ONLY to READY force migration");
      const manifest = await json(path.join(project, "manifest.json"));
      assert.equal(manifest.status, "READY_FOR_EXECUTION");
      assert.equal(manifest.durationSeconds, 2.4);
      assert.match(await readFile(path.join(project, "compositions/content.html"), "utf8"), /data-duration="2\.4"/);
      expectOk(run(process.execPath, [VALIDATE_STAGE, project]), "migrated fixed-stage validator");
      expectOk(run("npm", ["run", "check:fixed-stage"], { cwd: project }), "migrated project-local fixed-stage validator");
    });

    await test("--force rejects duration changes that would invalidate customized content", async () => {
      const project = path.join(scratch, "custom-content-duration-migration");
      expectOk(scaffold(["--project-dir", project]), "custom duration baseline");
      const contentPath = path.join(project, "compositions/content.html");
      await writeFile(contentPath, `${await readFile(contentPath, "utf8")}\n<!-- downstream timing -->\n`);
      const before = await treeDigest(project);
      expectFail(
        scaffold([...fullArgs(project), "--force"]),
        /cannot migrate customized compositions\/content\.html.*invalidate downstream-owned content timing/i,
        "customized content duration migration",
      );
      assert.equal(await treeDigest(project), before, "rejected content migration must leave the project unchanged");
    });

    await test("--force rejects manifest path traversal before reading external bytes", async () => {
      const project = path.join(scratch, "manifest-traversal");
      expectOk(scaffold(fullArgs(project)), "manifest traversal baseline");
      const external = path.join(scratch, "outside-secret.md");
      await writeFile(external, "OUTSIDE SECRET\n");
      const manifestPath = path.join(project, "manifest.json");
      const manifest = await json(manifestPath);
      manifest.inputs.directorScript.path = path.relative(project, external);
      manifest.inputs.directorScript.bytes = (await stat(external)).size;
      manifest.inputs.directorScript.sha256 = await sha256(external);
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      expectFail(scaffold(["--project-dir", project, "--force"]), /safe project-relative path|escapes/i, "manifest traversal");
      assert.equal(await readFile(external, "utf8"), "OUTSIDE SECRET\n");
    });

    await test("an interrupted force commit is recovered from its durable marker", async () => {
      const project = path.join(scratch, "transaction-recovery");
      expectOk(scaffold(["--project-dir", project]), "transaction baseline");
      await writeFile(path.join(project, "compositions/content.html"), "RECOVER ME\n");
      const staging = path.join(scratch, `.${path.basename(project)}.stage-interrupted`);
      const backup = `${staging}.backup`;
      await mkdir(staging, { recursive: true });
      await writeFile(path.join(staging, "partial.txt"), "PARTIAL\n");
      await rename(project, backup);
      const marker = path.join(scratch, `.${path.basename(project)}.scaffold-transaction.json`);
      await writeFile(marker, `${JSON.stringify({ version: 1, pid: 999999, projectDir: project, stagingDir: staging, backupDir: backup }, null, 2)}\n`);
      expectOk(scaffold(["--project-dir", project, "--force"]), "transaction recovery force");
      assert.equal(await readFile(path.join(project, "compositions/content.html"), "utf8"), "RECOVER ME\n");
      assert.equal(await exists(marker), false);
      assert.equal(await exists(backup), false);
      assert.equal(await exists(staging), false);
    });

    await test("late force collisions leave the original project byte-identical", async () => {
      const project = path.join(scratch, "atomic-force");
      expectOk(scaffold(["--project-dir", project]), "atomic baseline scaffold");
      await mkdir(path.join(project, "assets/audio/voice"), { recursive: true });
      await copyFile(audio, path.join(project, "assets/audio/voice/voice.wav"));
      const alternate = path.join(media, "alternate.wav");
      expectOk(run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2.4", "-c:a", "pcm_s16le", alternate]), "alternate audio generation");
      const before = await treeDigest(project);
      expectFail(scaffold(["--project-dir", project, "--force", "--audio", alternate]), /Refusing to overwrite existing project asset/i, "late force collision");
      assert.equal(await treeDigest(project), before, "failed force repair must leave every original byte unchanged");
    });

    await test("hostile filenames are normalized and cannot inject HTML", async () => {
      const hostile = path.join(media, 'voice" onerror="alert(1).wav');
      await copyFile(audio, hostile);
      const project = path.join(scratch, "hostile-name");
      expectOk(scaffold(["--project-dir", project, "--audio", hostile]), "hostile-name scaffold");
      const index = await readFile(path.join(project, "index.html"), "utf8");
      assert.match(index, /src="assets\/audio\/voice\/voice\.wav"/);
      assert.doesNotMatch(index, /onerror|alert\(1\)/i);
    });

    await test("force repair refuses project and destination symlinks", async () => {
      const project = path.join(scratch, "symlink-project");
      expectOk(scaffold(["--project-dir", project]), "symlink baseline scaffold");
      const external = path.join(scratch, "external-target.txt");
      await writeFile(external, "EXTERNAL SENTINEL\n");
      await unlink(path.join(project, "package.json"));
      await symlink(external, path.join(project, "package.json"));
      expectFail(scaffold(["--project-dir", project, "--force"]), /symbolic link/i, "symlink destination repair");
      assert.equal(await readFile(external, "utf8"), "EXTERNAL SENTINEL\n");

      const realRoot = path.join(scratch, "real-root");
      expectOk(scaffold(["--project-dir", realRoot]), "real root scaffold");
      const linkedRoot = path.join(scratch, "linked-root");
      await symlink(realRoot, linkedRoot);
      expectFail(scaffold(["--project-dir", linkedRoot, "--force"]), /symbolic-link project root/i, "symlink root repair");
    });

    await test("explicit duration beats media and contract beats explicit duration", async () => {
      const explicit = path.join(scratch, "explicit-duration");
      expectOk(scaffold(["--project-dir", explicit, "--audio", audio, "--duration", "7.25"]), "explicit duration scaffold");
      assert.equal((await json(path.join(explicit, "manifest.json"))).durationSeconds, 7.25);
      const contracted = path.join(scratch, "contract-duration");
      expectOk(scaffold([
        "--project-dir", contracted,
        "--audio", audio,
        "--captions", captions,
        "--director-script", director,
        "--production-spec", production,
        "--asset-plan", assetPlan,
        "--motion-contract", contract,
        "--duration", "2.4",
      ]), "contract duration scaffold");
      assert.equal((await json(path.join(contracted, "manifest.json"))).durationSeconds, 2.4);
      const mediaTail = path.join(scratch, "media-tail");
      expectOk(scaffold(["--project-dir", mediaTail, "--audio", audio]), "media-tail scaffold");
      assert.ok(Math.abs((await json(path.join(mediaTail, "manifest.json"))).durationSeconds - 3.6) < 0.02);
    });

    await test("PIP mounts only for media or an explicit placeholder", async () => {
      const placeholder = path.join(scratch, "placeholder");
      expectOk(scaffold(["--project-dir", placeholder, "--show-pip-placeholder"]), "placeholder scaffold");
      assert.match(await readFile(path.join(placeholder, "index.html"), "utf8"), /compositions\/pip-overlay\.html/);
      assert.doesNotMatch(await readFile(path.join(placeholder, "compositions/pip-overlay.html"), "utf8"), /<video\b/);
      const noPip = path.join(scratch, "no-pip");
      expectOk(scaffold(["--project-dir", noPip]), "no-PIP scaffold");
      assert.doesNotMatch(await readFile(path.join(noPip, "index.html"), "utf8"), /compositions\/pip-overlay\.html/);
    });

    await test("PIP crop overrides are recorded, rendered, and preserved by force repair", async () => {
      const project = path.join(scratch, "custom-pip-crop");
      expectOk(scaffold([
        "--project-dir", project,
        "--talking-head", talkingHead,
        "--pip-object-x", "61.2",
        "--pip-object-y", "47.5",
      ]), "custom PIP crop scaffold");
      const before = await json(path.join(project, "manifest.json"));
      assert.equal(before.fixedStage.pipContract.sourceCrop.objectPositionXPercent, 61.2);
      assert.equal(before.fixedStage.pipContract.sourceCrop.objectPositionYPercent, 47.5);
      assert.equal(before.fixedStage.pipContract.sourceCrop.profile, "custom-review-required");
      assert.match(await readFile(path.join(project, "styles.css"), "utf8"), /object-position: 61\.2% 47\.5%;/);
      expectOk(run(process.execPath, [VALIDATE_STAGE, project]), "custom PIP crop stage validator");
      expectOk(scaffold(["--project-dir", project, "--force"]), "custom PIP crop force repair");
      const after = await json(path.join(project, "manifest.json"));
      assert.equal(after.fixedStage.pipContract.sourceCrop.objectPositionXPercent, 61.2);
      assert.equal(after.fixedStage.pipContract.sourceCrop.objectPositionYPercent, 47.5);
      assert.match(await readFile(path.join(project, "styles.css"), "utf8"), /object-position: 61\.2% 47\.5%;/);
    });

    await test("non-empty targets reject and force preserves downstream-owned work", async () => {
      const project = path.join(scratch, "force-project");
      expectOk(scaffold(["--project-dir", project]), "initial force-repair scaffold");
      await mkdir(path.join(project, "compositions/scenes"), { recursive: true });
      await mkdir(path.join(project, "assets/images/generated"), { recursive: true });
      await mkdir(path.join(project, "renders"), { recursive: true });
      await writeFile(path.join(project, "compositions/content.html"), "DOWNSTREAM CONTENT\n");
      await writeFile(path.join(project, "compositions/scenes/scene-01.html"), "DOWNSTREAM SCENE\n");
      await writeFile(path.join(project, "assets/images/generated/art.txt"), "PROJECT ASSET\n");
      await writeFile(path.join(project, "renders/internal-preview-v1.mp4"), "EXECUTION OUTPUT\n");
      expectFail(scaffold(["--project-dir", project]), /not empty.*--force/i, "non-empty target");
      expectOk(scaffold(["--project-dir", project, "--force"]), "force scaffold");
      assert.equal(await readFile(path.join(project, "compositions/content.html"), "utf8"), "DOWNSTREAM CONTENT\n");
      assert.equal(await readFile(path.join(project, "compositions/scenes/scene-01.html"), "utf8"), "DOWNSTREAM SCENE\n");
      assert.equal(await readFile(path.join(project, "assets/images/generated/art.txt"), "utf8"), "PROJECT ASSET\n");
      assert.equal(await readFile(path.join(project, "renders/internal-preview-v1.mp4"), "utf8"), "EXECUTION OUTPUT\n");
      assert.ok(await exists(path.join(project, "index.html")));
    });

    await test("invalid captions, media, and contracts fail preflight without creating projects", async () => {
      const cases = [
        {
          name: "pip-object-x",
          args: ["--pip-object-x", "100.1"],
          pattern: /--pip-object-x must be a number from 0 to 100/i,
        },
        {
          name: "pip-object-y",
          args: ["--pip-object-y", "not-a-number"],
          pattern: /--pip-object-y must be a number from 0 to 100/i,
        },
        {
          name: "schema",
          args: ["--captions", path.join(FIXTURES, "invalid-captions-schema.json")],
          pattern: /captions\[0\].*(text|parts)/i,
        },
        {
          name: "overlap",
          args: ["--captions", path.join(FIXTURES, "invalid-captions-overlap.json")],
          pattern: /overlaps.*0\.05/i,
        },
        {
          name: "bounds",
          args: ["--audio", audio, "--captions", path.join(FIXTURES, "invalid-captions-bounds.json")],
          pattern: /more than 0\.5s after audio/i,
        },
      ];
      const badMedia = path.join(scratch, "not-audio.wav");
      await writeFile(badMedia, "not media");
      cases.push({ name: "media", args: ["--audio", badMedia], pattern: /ffprobe could not decode/i });
      const mismatch = path.join(scratch, "hash-mismatch-contract.json");
      await writeContract(mismatch, {
        hashes,
        mutate(value) {
          value.sourceHashes.audio = "0".repeat(64);
          return value;
        },
      });
      cases.push({
        name: "hash",
        args: [
          "--audio", audio,
          "--captions", captions,
          "--director-script", director,
          "--production-spec", production,
          "--asset-plan", assetPlan,
          "--motion-contract", mismatch,
        ],
        pattern: /sourceHashes\.audio.*does not match/i,
      });
      const invalidContract = path.join(scratch, "invalid-contract.json");
      await writeContract(invalidContract, {
        hashes,
        mutate(value) {
          value.version = 2;
          value.hardRejections = [];
          value.beats[0].startSeconds = 0.5;
          return value;
        },
      });
      cases.push({ name: "contract", args: ["--motion-contract", invalidContract], pattern: /version.*must equal 1/i });

      for (const item of cases) {
        const project = path.join(scratch, `invalid-${item.name}`);
        const result = scaffold(["--project-dir", project, ...item.args]);
        expectFail(result, item.pattern, `invalid ${item.name}`);
        assert.equal(await exists(project), false, `invalid ${item.name} must fail before target creation`);
      }
    });

    await test("zero-byte required documents cannot produce READY_FOR_EXECUTION", async () => {
      for (const [key, flag, label] of [
        ["directorScript", "--director-script", "Director script"],
        ["productionSpec", "--production-spec", "Production specification"],
        ["assetPlan", "--asset-plan", "Asset plan"],
      ]) {
        const empty = path.join(scratch, `empty-${key}.md`);
        await writeFile(empty, "");
        const emptyHashes = { ...hashes, [key]: await sha256(empty) };
        const emptyContract = path.join(scratch, `empty-${key}-contract.json`);
        await writeContract(emptyContract, { hashes: emptyHashes });
        const project = path.join(scratch, `zero-byte-${key}`);
        const args = fullArgs(project);
        args[args.indexOf(flag) + 1] = empty;
        args[args.indexOf("--motion-contract") + 1] = emptyContract;
        const result = scaffold(args);
        expectFail(result, new RegExp(`${label} must contain at least one byte`, "i"), `zero-byte ${key}`);
        assert.equal(await exists(project), false, `zero-byte ${key} must fail before project creation`);
      }
    });

    await test("--script remains a director-script compatibility alias", async () => {
      const project = path.join(scratch, "script-alias");
      expectOk(scaffold(["--project-dir", project, "--script", director]), "script alias scaffold");
      assert.equal((await json(path.join(project, "manifest.json"))).inputs.directorScript.path, "inputs/视频脚本.md");
    });

    await test("a HyperFrames-native source contract is accepted and preserved", async () => {
      const hyperframesContract = path.join(scratch, "hyperframes-motion-contract.json");
      await writeContract(hyperframesContract, { hashes, pipeline: "hyperframes" });
      const project = path.join(scratch, "hyperframes-contract");
      expectOk(scaffold([
        "--project-dir", project,
        "--audio", audio,
        "--captions", captions,
        "--director-script", director,
        "--production-spec", production,
        "--asset-plan", assetPlan,
        "--motion-contract", hyperframesContract,
      ]), "HyperFrames contract scaffold");
      const manifest = await json(path.join(project, "manifest.json"));
      assert.equal(manifest.status, "READY_FOR_EXECUTION");
      assert.equal(manifest.motionContract.pipeline, "hyperframes");
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

await main();
