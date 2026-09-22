#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const REQUIRED_FILES = [
  ".npmrc",
  "index.html",
  "styles.css",
  "package.json",
  "hyperframes.json",
  "meta.json",
  "DESIGN.md",
  "caption-overrides.json",
  "manifest.json",
  "review/proof-manifest-v1.json",
  "compositions/studio-background.html",
  "compositions/content.html",
  "compositions/caption-overlay.html",
  "compositions/pip-overlay.html",
  "scripts/check-inputs.mjs",
  "scripts/check-fixed-stage.mjs",
  "scripts/build-pip-review.mjs",
  "scripts/validate-motion-contract.mjs",
  "scripts/validate-runtime-adaptation.mjs",
  "scripts/validate-project-proof.mjs",
  "scripts/project-integrity.mjs",
  "scripts/proof-gate.mjs",
  "scripts/proof-stage.mjs",
  "scripts/proof-approve.mjs",
  "proof/goldens/narrow-center-grid-t000.png",
  "proof/goldens/narrow-center-grid-t004.png",
  "proof/goldens/narrow-center-grid-t009.png",
  "assets/fonts/NotoSansSC-400.ttf",
  "assets/fonts/NotoSansSC-500.ttf",
  "assets/fonts/NotoSansSC-700.ttf",
  "assets/fonts/SpaceGrotesk-400.ttf",
];

const PINNED_CLI = "npx --yes hyperframes@0.7.65";
const REQUIRED_EXACT_SCRIPTS = {
  dev: `${PINNED_CLI} preview`,
  doctor: `${PINNED_CLI} doctor`,
  lint: `${PINNED_CLI} lint`,
  validate: `${PINNED_CLI} validate`,
  check: `${PINNED_CLI} check`,
  "check:inputs": "node scripts/check-inputs.mjs",
  "check:fixed-stage": "node scripts/check-fixed-stage.mjs",
  "check:motion-contract": "node scripts/validate-motion-contract.mjs inputs/motion-contract.json",
  "check:runtime-map": "node scripts/validate-runtime-adaptation.mjs runtime-adaptation.json inputs/motion-contract.json",
  "check:runtime-adaptation": "node scripts/validate-runtime-adaptation.mjs runtime-adaptation.json inputs/motion-contract.json --html compositions/content.html",
  "check:stage-parity": "node scripts/proof-stage.mjs",
  "check:template": "node scripts/run-workflow.mjs check-template",
  "review:pip": "node scripts/build-pip-review.mjs",
  "proof:lock": "node scripts/proof-lock.mjs",
  "proof:prepare": "node scripts/proof-prepare.mjs",
  "proof:inputs": "node scripts/proof-gate.mjs inputs",
  "proof:fixed-stage": "node scripts/proof-gate.mjs fixed-stage",
  "proof:motion-contract": "node scripts/proof-gate.mjs motion-contract",
  "proof:runtime-adaptation": "node scripts/proof-gate.mjs runtime-adaptation",
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
  "proof:bind-review": "node scripts/proof-bind-review.mjs",
  "proof:approve": "node scripts/proof-approve.mjs",
  "proof:generate": "node scripts/run-workflow.mjs proof-generate",
  "proof:all": "node scripts/run-workflow.mjs proof-generate",
  "proof:finalize": "node scripts/run-workflow.mjs proof-finalize",
};

const projectArg = process.argv[2] ?? process.cwd();
const projectDir = path.resolve(process.cwd(), projectArg);
const errors = [];
const files = new Map();

function report(message) {
  errors.push(message);
}

function requireText(text, needle, label) {
  if (!text.includes(needle)) {
    report(`${label}: missing exact contract marker ${JSON.stringify(needle)}`);
  }
}

function forbidText(text, needle, label) {
  if (text.includes(needle)) {
    report(`${label}: forbidden marker ${JSON.stringify(needle)}`);
  }
}

function openingTagById(html, id, label) {
  const tags = html.match(/<div\b[^>]*>/g) ?? [];
  const matches = tags.filter((tag) => new RegExp(`\\bid=["']${id}["']`).test(tag));
  if (matches.length !== 1) {
    report(`${label}: expected exactly one <div id=${JSON.stringify(id)}>, found ${matches.length}`);
    return "";
  }
  return matches[0];
}

function requireAttribute(tag, attribute, expected, label) {
  if (!tag) return;
  const match = tag.match(new RegExp(`\\b${attribute}=["']([^"']*)["']`));
  if (!match) {
    report(`${label}: missing ${attribute}`);
  } else if (match[1] !== expected) {
    report(`${label}: ${attribute} must be ${JSON.stringify(expected)}, received ${JSON.stringify(match[1])}`);
  }
}

async function readRequired(relativePath) {
  const absolutePath = path.join(projectDir, relativePath);
  try {
    const info = await stat(absolutePath);
    if (!info.isFile()) {
      report(`${relativePath}: required path is not a file`);
      return "";
    }
    const text = await readFile(absolutePath, "utf8");
    files.set(relativePath, text);
    return text;
  } catch (error) {
    report(`${relativePath}: required file is missing (${error.code ?? error.message})`);
    return "";
  }
}

try {
  const info = await stat(projectDir);
  if (!info.isDirectory()) {
    console.error(`[fixed-stage] FAIL: ${projectDir} is not a directory`);
    process.exit(1);
  }
} catch (error) {
  console.error(`[fixed-stage] FAIL: project directory does not exist: ${projectDir}`);
  process.exit(1);
}

await Promise.all(REQUIRED_FILES.map(readRequired));

const index = files.get("index.html") ?? "";
const styles = files.get("styles.css") ?? "";
const design = files.get("DESIGN.md") ?? "";
const background = files.get("compositions/studio-background.html") ?? "";
const content = files.get("compositions/content.html") ?? "";
const caption = files.get("compositions/caption-overlay.html") ?? "";
const pip = files.get("compositions/pip-overlay.html") ?? "";
let manifest = null;

if (files.get(".npmrc") !== "ignore-scripts=true\n") {
  report(".npmrc: must contain only ignore-scripts=true to suppress project-controlled pre/post lifecycle hooks");
}

if (files.has("package.json")) {
  try {
    const pkg = JSON.parse(files.get("package.json"));
    for (const [name, expected] of Object.entries(REQUIRED_EXACT_SCRIPTS)) {
      if (pkg.scripts?.[name] !== expected) {
        report(`package.json: script ${JSON.stringify(name)} must equal ${JSON.stringify(expected)}`);
      }
    }
    const dynamicScripts = {
      inspect: /^npx --yes hyperframes@0\.7\.65 inspect --at \d+(?:\.\d+)?(?:,\d+(?:\.\d+)?)* --strict$/,
      "snapshot:stage": /^npx --yes hyperframes@0\.7\.65 snapshot --at \d+(?:\.\d+)?(?:,\d+(?:\.\d+)?)* --no-end --output snapshots\/stage --describe false$/,
      "render:draft": /^npx --yes hyperframes@0\.7\.65 render --quality draft --fps 30 --resolution 1080p --output renders\/fixed-stage-draft\.mp4$/,
    };
    for (const [name, pattern] of Object.entries(dynamicScripts)) {
      if (!pattern.test(pkg.scripts?.[name] ?? "")) {
        report(`package.json: script ${JSON.stringify(name)} must match the canonical pinned command`);
      }
    }
    if (pkg.scripts?.["check:template"] !== "node scripts/run-workflow.mjs check-template") {
      report("package.json: check:template must use the canonical project-local workflow runner");
    }
    for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
      if (typeof command !== "string") {
        report(`package.json: script ${JSON.stringify(name)} must be a string`);
        continue;
      }
      if (/[;&|`$<>\n\r]/.test(command)) {
        report(`package.json: script ${JSON.stringify(name)} contains forbidden shell metacharacters`);
      }
      if (/\bhyperframes(?:@|\s)/i.test(command) && !command.startsWith(PINNED_CLI)) {
        report(`package.json: every HyperFrames command must use the pinned CLI; ${JSON.stringify(name)} does not`);
      }
      if (/hyperframes@(latest|\^|~|\*)/i.test(command) || /\bnpx\s+hyperframes\b/.test(command)) {
        report(`package.json: script ${JSON.stringify(name)} uses an unbounded HyperFrames version`);
      }
    }
  } catch (error) {
    report(`package.json: invalid JSON (${error.message})`);
  }
}

for (const jsonFile of ["hyperframes.json", "meta.json", "manifest.json", "caption-overrides.json"]) {
  if (!files.has(jsonFile)) continue;
  try {
    JSON.parse(files.get(jsonFile));
  } catch (error) {
    report(`${jsonFile}: invalid JSON (${error.message})`);
  }
}

if (files.has("manifest.json")) {
  manifest = JSON.parse(files.get("manifest.json"));
  if (!["TEMPLATE_ONLY", "READY_FOR_EXECUTION"].includes(manifest.status)) {
    report(`manifest.json: unsupported status ${JSON.stringify(manifest.status)}`);
  } else if (manifest.status === "TEMPLATE_ONLY") {
    if (!Array.isArray(manifest.missingInputs) || manifest.missingInputs.length === 0) {
      report("manifest.json: TEMPLATE_ONLY missingInputs must be a non-empty actionable list");
    }
    if (manifest.nextSkill !== null) report("manifest.json: TEMPLATE_ONLY nextSkill must be null");
  } else {
    if (!Array.isArray(manifest.missingInputs) || manifest.missingInputs.length !== 0) {
      report("manifest.json: READY_FOR_EXECUTION missingInputs must be empty");
    }
    if (manifest.nextSkill !== "hyperframes-scene-animator") {
      report("manifest.json: READY_FOR_EXECUTION must route to hyperframes-scene-animator");
    }
  }
}

const rawExpectedDuration = manifest?.durationSeconds ?? manifest?.fixedStage?.scaffoldDurationSeconds ?? 18;
const expectedDuration = String(Number(Number(rawExpectedDuration).toFixed(3)));

requireText(design, "# Studio Warm-White Fixed Stage", "DESIGN.md");
for (const marker of [
  "`#f7f8f3`",
  "`#151922`",
  "`#747982`",
  "`#b6bbb5`",
  "`#2f6fff`",
  "`#f6c466`",
  "`#c26a35`",
  "Noto Sans SC",
  "PingFang SC",
  "Microsoft YaHei",
  "Space Grotesk",
  "196px 120px 196px",
  "1920×1080",
  "30fps",
  "background / content / caption",
  "PIP and voice are conditional",
  "fixed background is the only default continuous motion",
  "TopBar",
  "global crossfade",
  "Fixed-stage owner",
  "Scene executor owner",
]) {
  requireText(design, marker, "DESIGN.md");
}

requireText(styles, "width: 1920px;", "styles.css");
requireText(styles, "height: 1080px;", "styles.css");
requireText(styles, 'font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;', "styles.css");
requireText(styles, "background: #f7f8f3;", "styles.css");
forbidText(styles, "transition:", "styles.css");

forbidText(index, "<template", "index.html");
requireText(index, 'data-composition-id="studio-fixed-stage"', "index.html");
requireText(index, 'data-fps="30"', "index.html");
requireText(index, 'window.__timelines["studio-fixed-stage"] = rootTimeline;', "index.html");
requireText(index, "gsap.timeline({ paused: true })", "index.html");

const root = openingTagById(index, "fixed-stage-root", "index.html root");
for (const [attribute, expected] of [
  ["data-composition-id", "studio-fixed-stage"],
  ["data-start", "0"],
  ["data-duration", expectedDuration],
  ["data-width", "1920"],
  ["data-height", "1080"],
  ["data-fps", "30"],
]) {
  requireAttribute(root, attribute, expected, "index.html root");
}

for (const mountContract of [
  ["background-mount", "studio-background", "compositions/studio-background.html", "0"],
  ["content-mount", "content", "compositions/content.html", "10"],
  ["caption-mount", "caption-overlay", "compositions/caption-overlay.html", "100"],
]) {
  const [id, compositionId, src, track] = mountContract;
  const tag = openingTagById(index, id, `index.html ${id}`);
  requireAttribute(tag, "data-composition-id", compositionId, `index.html ${id}`);
  requireAttribute(tag, "data-composition-src", src, `index.html ${id}`);
  requireAttribute(tag, "data-start", "0", `index.html ${id}`);
  requireAttribute(tag, "data-duration", expectedDuration, `index.html ${id}`);
  requireAttribute(tag, "data-track-index", track, `index.html ${id}`);
  requireAttribute(tag, "data-width", "1920", `index.html ${id}`);
  requireAttribute(tag, "data-height", "1080", `index.html ${id}`);
}

const pipMounted = manifest?.fixedStage?.pipMounted === true;
if (pipMounted) {
  const tag = openingTagById(index, "pip-mount", "index.html pip-mount");
  requireAttribute(tag, "data-composition-id", "pip-overlay", "index.html pip-mount");
  requireAttribute(tag, "data-composition-src", "compositions/pip-overlay.html", "index.html pip-mount");
  requireAttribute(tag, "data-duration", expectedDuration, "index.html pip-mount");
  requireAttribute(tag, "data-track-index", "90", "index.html pip-mount");
} else {
  forbidText(index, "compositions/pip-overlay.html", "index.html");
}
const voiceMounted = Boolean(manifest?.inputs?.audio);
if (voiceMounted) {
  const tag = (index.match(/<audio\b[^>]*>/g) ?? []).find((candidate) => /\bid=["']voice-audio["']/.test(candidate)) ?? "";
  if (!tag) report("index.html: locked audio requires exactly one voice-audio mount");
  else {
    requireAttribute(tag, "data-start", "0", "index.html voice-audio");
    requireAttribute(tag, "data-track-index", "200", "index.html voice-audio");
    requireAttribute(tag, "src", manifest.inputs.audio.path, "index.html voice-audio");
  }
} else {
  forbidText(index, "<audio", "index.html");
}
for (const marker of ["TopBar", "topbar", "demo", "card", "enterStyle", "crossfade"]) {
  forbidText(index, marker, "index.html");
}

for (const [relativePath, html, id] of [
  ["compositions/studio-background.html", background, "studio-background"],
  ["compositions/content.html", content, "content"],
  ["compositions/caption-overlay.html", caption, "caption-overlay"],
  ["compositions/pip-overlay.html", pip, "pip-overlay"],
]) {
  requireText(html, "<template", relativePath);
  requireText(html, `data-composition-id="${id}"`, relativePath);
  requireText(html, "data-width=\"1920\"", relativePath);
  requireText(html, "data-height=\"1080\"", relativePath);
  requireText(html, `data-duration="${expectedDuration}"`, relativePath);
  requireText(html, "gsap.timeline({ paused: true })", relativePath);
  requireText(html, `window.__timelines["${id}"]`, relativePath);
}

for (const marker of [
  `const DURATION_SECONDS = ${expectedDuration};`,
  "const CANVAS_HEIGHT = 1080;",
  "const NEAR_Y = -78;",
  "const FAR_Y = 342;",
  "const ROW_STEP = 62;",
  "const ROW_SPEED = 34;",
  "const ROW_COUNT = 8;",
  "const VERTICAL_COUNT = 23;",
  "const VERTICAL_RADIUS = 11;",
  "const PLANE_HEIGHT = FAR_Y - NEAR_Y;",
  "const rowDrift = (seconds * ROW_SPEED) % ROW_STEP;",
  "NEAR_Y + ((index * ROW_STEP + rowDrift) % PLANE_HEIGHT)",
  "const t = clamp((y - NEAR_Y) / PLANE_HEIGHT, 0, 1);",
  "const left = -230 + t * 420;",
  "const right = 2150 - t * 420;",
  "const mirrorY = (y) => CANVAS_HEIGHT - y;",
  "const nearX = (index) => 960 + index * 154;",
  "const farX = (index) => 960 + index * 76;",
  "x1: nearX(index), y1: NEAR_Y, x2: farX(index), y2: FAR_Y",
  "x1: farX(index), y1: mirrorY(FAR_Y), x2: nearX(index), y2: mirrorY(NEAR_Y)",
  "const bottomY = mirrorY(topY);",
  'id="top-rows"',
  'id="top-verticals"',
  'id="bottom-rows"',
  'id="bottom-verticals"',
  'id="center-veil"',
  'id="grid-stroke" x1="0" y1="0" x2="1" y2="0"',
  'stop-color="rgba(44,58,78,0.16)"',
  'stop-color="rgba(47,111,255,0.30)"',
  'stop-color="rgba(235,178,82,0.22)"',
  'stroke: "rgba(37,50,72,0.30)"',
  "rgba(47,111,255,0.10)",
  "rgba(246,196,102,0.10)",
  "#fbfcf8 0%, #f2f6f8 46%, #fbfaf4 100%",
  "top: 184px;",
  "bottom: 184px;",
  "radial-gradient(18% 22% at 50% 51%, rgba(255,255,255,0.18), transparent 74%)",
  "opacity: 0.06;",
  "background-size: 4px 4px;",
  "const glow = 0.5 + Math.sin(seconds * 0.48) * 0.5;",
  "const state = { seconds: 0 };",
  "seconds: DURATION_SECONDS",
  "duration: DURATION_SECONDS",
  "ease: \"none\"",
  "onUpdate: renderFrame",
]) {
  requireText(background, marker, "compositions/studio-background.html");
}
forbidText(background, "linear-gradient(90deg, transparent 0%", "compositions/studio-background.html");

requireText(content, 'class="content-canvas"', "compositions/content.html");
requireText(content, "background: transparent;", "compositions/content.html");
for (const marker of ["<h1", "<p", "<img", "<video", "demo", "card", "TopBar"]) {
  forbidText(content, marker, "compositions/content.html");
}

for (const marker of [
  'class="caption-line"',
  "bottom: 96px;",
  "max-width: 1680px;",
  "white-space: nowrap;",
  "background: transparent;",
  "text-align: center;",
  "color: #151922;",
]) {
  requireText(caption, marker, "compositions/caption-overlay.html");
}
if (!caption.includes('aria-hidden="true"') && !/class="[^"]*\bcaption-group\b/.test(caption)) {
  report('compositions/caption-overlay.html: expected an empty aria-hidden caption line or generated caption groups');
}
const captionGroups = [...caption.matchAll(/<div\b[^>]*class="[^"]*\bcaption-group\b[^"]*"[^>]*>/g)].map((match) => match[0]);
if (manifest?.validation?.alignedCaptionCount !== null && manifest?.validation?.alignedCaptionCount !== captionGroups.length) {
  report(`compositions/caption-overlay.html: expected ${manifest?.validation?.alignedCaptionCount} caption groups, found ${captionGroups.length}`);
}
let priorCaptionEnd = 0;
for (const [index, tag] of captionGroups.entries()) {
  const start = Number(tag.match(/\bdata-start=["']([^"']*)["']/)?.[1]);
  const duration = Number(tag.match(/\bdata-duration=["']([^"']*)["']/)?.[1]);
  requireAttribute(tag, "data-track-index", "100", `caption group ${index}`);
  if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) {
    report(`caption group ${index}: invalid start/duration`);
  } else if (index > 0 && start < priorCaptionEnd - 1e-9) {
    report(`caption group ${index}: more than one caption would be visible`);
  }
  priorCaptionEnd = start + duration;
  requireText(
    caption,
    `timeline.set("#caption-body-${index}", { opacity: 0, visibility: "hidden" }`,
    `caption group ${index}`,
  );
}
for (const marker of ["backdrop-filter", "border-radius", "filter: blur", "<br"]) {
  forbidText(caption, marker, "compositions/caption-overlay.html");
}

for (const marker of [
  'class="pip-frame"',
  'data-media-slot="talking-head-video"',
  "width: 206px;",
  "height: 206px;",
  "right: 104px;",
  "bottom: 150px;",
  "border-radius: 50%;",
  "1.5px solid rgba(20,82,255,0.55)",
]) {
  requireText(pip, marker, "compositions/pip-overlay.html");
}

const pipContract = manifest?.fixedStage?.pipContract;
const exactPipContract = [
  ["frameRegion.x", pipContract?.frameRegion?.x, 1610],
  ["frameRegion.y", pipContract?.frameRegion?.y, 724],
  ["frameRegion.width", pipContract?.frameRegion?.width, 206],
  ["frameRegion.height", pipContract?.frameRegion?.height, 206],
  ["frameRegion.right", pipContract?.frameRegion?.right, 104],
  ["frameRegion.bottom", pipContract?.frameRegion?.bottom, 150],
  ["frameRegion.zIndex", pipContract?.frameRegion?.zIndex, 90],
  ["mediaRegion.x", pipContract?.mediaRegion?.x, 1618],
  ["mediaRegion.y", pipContract?.mediaRegion?.y, 732],
  ["mediaRegion.width", pipContract?.mediaRegion?.width, 190],
  ["mediaRegion.height", pipContract?.mediaRegion?.height, 190],
  ["mediaRegion.right", pipContract?.mediaRegion?.right, 112],
  ["mediaRegion.bottom", pipContract?.mediaRegion?.bottom, 158],
  ["mediaRegion.zIndex", pipContract?.mediaRegion?.zIndex, 89],
  ["sourceCrop.fit", pipContract?.sourceCrop?.fit, "cover"],
  ["background.mode", pipContract?.background?.mode, "pale-blue-gray-c"],
  ["background.opaque", pipContract?.background?.opaque, true],
  ["background.base", pipContract?.background?.base, "#f2f6f8"],
  ["review.staticBeforeMotion", pipContract?.review?.staticBeforeMotion, true],
  ["review.encodedZoomRequired", pipContract?.review?.encodedZoomRequired, true],
  ["review.crop", pipContract?.review?.crop, "300:300:1560:680"],
  ["review.scale", pipContract?.review?.scale, "900:900"],
];
for (const [field, actual, expected] of exactPipContract) {
  if (actual !== expected) {
    report(`manifest.fixedStage.pipContract.${field} must equal ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
for (const [field, expected] of [
  ["faceCenterXPercent", [48, 52]],
  ["hairTopYPercent", [25, 32]],
  ["eyeLineYPercent", [45, 52]],
  ["chinYPercent", [68, 76]],
  ["shoulderWidthPercent", [70, 90]],
]) {
  if (JSON.stringify(pipContract?.subjectSafeArea?.[field]) !== JSON.stringify(expected)) {
    report(`manifest.fixedStage.pipContract.subjectSafeArea.${field} must equal ${JSON.stringify(expected)}`);
  }
}
for (const field of ["objectPositionXPercent", "objectPositionYPercent"]) {
  const value = pipContract?.sourceCrop?.[field];
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    report(`manifest.fixedStage.pipContract.sourceCrop.${field} must be a number from 0 to 100`);
  }
}
const isDefaultPipCrop =
  pipContract?.sourceCrop?.objectPositionXPercent === 66.7 &&
  pipContract?.sourceCrop?.objectPositionYPercent === 50;
const expectedPipProfile = isDefaultPipCrop ? "bozhou-digital-twin-v1" : "custom-review-required";
if (pipContract?.sourceCrop?.profile !== expectedPipProfile) {
  report(`manifest.fixedStage.pipContract.sourceCrop.profile must equal ${JSON.stringify(expectedPipProfile)}`);
}

if (/<video\b/i.test(pip)) {
  if (!/<video\b[^>]*\bmuted\b[^>]*\bplaysinline\b/i.test(pip)) {
    report("compositions/pip-overlay.html: any future video must be muted and playsinline");
  }
  if (!/<div class="pip-mask">\s*<video\b/i.test(pip)) {
    report("compositions/pip-overlay.html: talking-head video must be inside the non-timed pip-mask wrapper");
  }
  if (/\.play\(|\.pause\(|\bautoplay\b/i.test(pip)) {
    report("compositions/pip-overlay.html: framework must control talking-head playback");
  }
}
if (manifest?.inputs?.talkingHead) {
  const wrapper = openingTagById(index, "pip-media-wrapper", "index.html pip-media-wrapper");
  if (wrapper && /\bdata-(?:start|duration)=/i.test(wrapper)) {
    report("index.html: pip-media-wrapper must be non-timed");
  }
  if (!/<div\b[^>]*id=["']pip-media-wrapper["'][^>]*>\s*<video\b[^>]*id=["']talking-head-video["'][^>]*\bmuted\b[^>]*\bplaysinline\b/i.test(index)) {
    report("index.html: talking-head video must be muted playsinline inside the non-timed root PIP wrapper");
  }
  if (/\.play\(|\.pause\(|\bautoplay\b/i.test(index)) {
    report("index.html: framework must control talking-head playback");
  }
  for (const marker of [
    "right: 112px;",
    "bottom: 158px;",
    "width: 190px;",
    "height: 190px;",
    "z-index: 89;",
    "border-radius: 50%;",
    "background-color: #f2f6f8;",
    "background-image:",
    "radial-gradient(circle at 50% 18%, rgba(255, 255, 255, 0.74) 0%, transparent 58%)",
    "linear-gradient(180deg, #f2f6f8 0%, rgba(47, 111, 255, 0.30) 140%)",
    "object-fit: cover;",
    `object-position: ${pipContract?.sourceCrop?.objectPositionXPercent}% ${pipContract?.sourceCrop?.objectPositionYPercent}%;`,
  ]) {
    requireText(styles, marker, "styles.css real-media PIP contract");
  }
  if (/#pip-media-wrapper\s*\{[^}]*\bbackground\s*:\s*transparent/i.test(styles)) {
    report("styles.css: real-media PIP wrapper must never have a transparent-only background");
  }
  if (!/\.pip-inner\s*\{[^}]*background-color:\s*transparent;/s.test(pip)) {
    report("compositions/pip-overlay.html: real-media PIP frame layer must be transparent");
  }
  if (!/\.pip-mask\s*\{[^}]*background:\s*transparent;/s.test(pip)) {
    report("compositions/pip-overlay.html: real-media PIP mask must not cover the media layer");
  }
} else {
  forbidText(index, "talking-head-video", "index.html");
}

const allHtml = [index, background, content, caption, pip].join("\n");
for (const marker of ["Math.random", "Date.now", "setTimeout", "repeat: -1", "repeat:-1", ".play(", ".pause("]) {
  forbidText(allHtml, marker, "composition HTML");
}
if (/#studio-background-root\s*\{[^}]*display\s*:\s*none/i.test(`${styles}\n${background}`)) {
  report("fixed background cannot be hidden with display:none");
}
if (/\basync\s+(?:function|\()/m.test(allHtml)) {
  report("composition HTML: asynchronous timeline construction is forbidden");
}

if (errors.length > 0) {
  console.error(`[fixed-stage] FAIL: ${errors.length} contract violation(s) in ${projectDir}`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`[fixed-stage] PASS: native fixed-stage contract verified in ${projectDir}`);
