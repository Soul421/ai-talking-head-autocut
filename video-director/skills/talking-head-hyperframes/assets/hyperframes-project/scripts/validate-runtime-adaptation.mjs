#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const adaptationPath = args[0];
const sourcePath = args[1];
const htmlFlag = args.indexOf("--html");
const htmlPath = htmlFlag >= 0 ? args[htmlFlag + 1] : null;

if (!adaptationPath || !sourcePath || (htmlFlag >= 0 && !htmlPath)) {
  console.error("Usage: node validate_runtime_adaptation.mjs <runtime-adaptation.json> <motion-contract.json> [--html <composition.html>]");
  process.exit(2);
}

const errors = [];
const add = (code, location, message) => errors.push({ code, location, message });
const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const sha256 = (filePath) => crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
const equalJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const adaptationRoot = path.dirname(path.resolve(adaptationPath));
const insideRoot = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

let adaptation;
let source;
try {
  adaptation = JSON.parse(fs.readFileSync(adaptationPath, "utf8"));
} catch (error) {
  console.error(`[ADAPT_READ] Cannot read ${adaptationPath}: ${error.message}`);
  process.exit(2);
}
try {
  source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
} catch (error) {
  console.error(`[ADAPT_SOURCE_READ] Cannot read ${sourcePath}: ${error.message}`);
  process.exit(2);
}

if (adaptation.version !== 1) add("ADAPT_VERSION", "version", "must equal 1");
const sourceDigest = sha256(sourcePath);
if (!adaptation.sourceContract || typeof adaptation.sourceContract !== "object") {
  add("ADAPT_SOURCE_TRACE", "sourceContract", "is required");
} else {
  if (!nonEmpty(adaptation.sourceContract.path)) add("ADAPT_SOURCE_TRACE", "sourceContract.path", "is required");
  else {
    const declaredSource = path.resolve(adaptationRoot, adaptation.sourceContract.path);
    if (!insideRoot(adaptationRoot, declaredSource) || declaredSource !== path.resolve(sourcePath)) {
      add("ADAPT_SOURCE_TRACE", "sourceContract.path", "must resolve to the supplied source contract inside the project root");
    }
  }
  if (adaptation.sourceContract.sha256 !== sourceDigest) {
    add("ADAPT_SOURCE_TRACE", "sourceContract.sha256", `must match source bytes (${sourceDigest})`);
  }
  if (adaptation.sourceContract.pipeline !== source.pipeline) {
    add("ADAPT_SOURCE_TRACE", "sourceContract.pipeline", `must equal source pipeline ${source.pipeline}`);
  }
  if (adaptation.sourceContract.preservedVerbatim !== true) {
    add("ADAPT_SOURCE_TRACE", "sourceContract.preservedVerbatim", "must be true; adaptation never rewrites the source contract");
  }
}
if (!adaptation.design || !nonEmpty(adaptation.design.path) || !hash(adaptation.design.sha256)) {
  add("ADAPT_DESIGN_TRACE", "design", "must record DESIGN.md path and SHA-256");
} else if (adaptation.design.path !== "DESIGN.md") {
  add("ADAPT_DESIGN_TRACE", "design.path", 'must equal root "DESIGN.md"');
} else {
  const designPath = path.resolve(adaptationRoot, adaptation.design.path);
  if (!insideRoot(adaptationRoot, designPath)) {
    add("ADAPT_DESIGN_TRACE", "design.path", "must stay inside the project root");
  } else {
    try {
      const actualDesignDigest = sha256(designPath);
      if (actualDesignDigest !== adaptation.design.sha256) {
        add("ADAPT_DESIGN_TRACE", "design.sha256", `must match DESIGN.md bytes (${actualDesignDigest})`);
      }
    } catch (error) {
      add("ADAPT_DESIGN_TRACE", "design.path", `cannot read DESIGN.md: ${error.message}`);
    }
  }
}

const runtime = adaptation.runtime;
if (!runtime || typeof runtime !== "object") {
  add("ADAPT_RUNTIME", "runtime", "is required");
} else {
  if (runtime.engine !== "gsap") add("ADAPT_RUNTIME", "runtime.engine", 'must equal "gsap"');
  if (!nonEmpty(runtime.compositionId)) add("ADAPT_RUNTIME", "runtime.compositionId", "is required");
  const master = runtime.masterTimeline;
  if (!master || typeof master !== "object") add("ADAPT_TIMELINE", "runtime.masterTimeline", "is required");
  else {
    if (master.synchronous !== true) add("ADAPT_TIMELINE", "runtime.masterTimeline.synchronous", "must be true");
    if (master.paused !== true) add("ADAPT_TIMELINE", "runtime.masterTimeline.paused", "must be true");
    if (master.registeredKey !== runtime.compositionId) {
      add("ADAPT_TIMELINE", "runtime.masterTimeline.registeredKey", "must equal runtime.compositionId");
    }
    if (!Array.isArray(master.labels) || master.labels.length === 0 || master.labels.some((item) => !nonEmpty(item))) {
      add("ADAPT_TIMELINE", "runtime.masterTimeline.labels", "must contain named choreography labels");
    }
  }
  if (runtime.visibilityPolicy !== "opacity-clip-transform-only") {
    add("ADAPT_VISIBILITY", "runtime.visibilityPolicy", "must ban visibility and autoAlpha animation");
  }
  if (runtime.frameworkOwnsClipLifecycle !== true) {
    add("ADAPT_VISIBILITY", "runtime.frameworkOwnsClipLifecycle", "must be true");
  }
  if (runtime.mediaPolicy?.frameworkOwnedPlayback !== true || runtime.mediaPolicy?.timedVideoMotionTarget !== "wrapper") {
    add("ADAPT_MEDIA", "runtime.mediaPolicy", "must assign playback to HyperFrames and visual motion to an untimed wrapper");
  }
}

const boundary = adaptation.fixedBoundary;
const requiredProtected = [
  "DESIGN.md",
  "manifest.json",
  "inputs/**",
  "index.html",
  "styles.css",
  "compositions/studio-background.html",
  "compositions/caption-overlay.html",
  "compositions/pip-overlay.html",
  "assets/video/talking-head/**",
  "assets/audio/voice/**",
];
const allowedOwned = new Set([
  "compositions/content.html",
  "compositions/scenes/**",
  "runtime-adaptation.json",
  "STORYBOARD.md",
  "SCENE_SCHEMA.json",
  "VECTOR_TEMPLATES.json",
  "MOTION_PRIMITIVES.json",
  "MOTION_MAP.json",
  "assets/images/**",
  "assets/audio/music/**",
  "assets/audio/sfx/**",
  "snapshots/acceptance/**",
  "snapshots/transitions/**",
  "review/executor-*.md",
  "renders/internal-preview-*.mp4",
]);
if (!boundary || !Array.isArray(boundary.contentOwned) || !Array.isArray(boundary.protected)) {
  add("ADAPT_FIXED_BOUNDARY", "fixedBoundary", "must declare contentOwned and protected arrays");
} else {
  for (const item of requiredProtected) {
    if (!boundary.protected.includes(item)) add("ADAPT_FIXED_BOUNDARY", "fixedBoundary.protected", `must protect ${item}`);
  }
  if (!boundary.contentOwned.includes("compositions/content.html") || !boundary.contentOwned.includes("compositions/scenes/**")) {
    add("ADAPT_FIXED_BOUNDARY", "fixedBoundary.contentOwned", "must own content.html and compositions/scenes/**");
  }
  const overlap = boundary.contentOwned.filter((item) => boundary.protected.includes(item));
  if (overlap.length > 0) add("ADAPT_FIXED_BOUNDARY", "fixedBoundary", `owned/protected paths overlap: ${overlap.join(", ")}`);
  const unauthorized = boundary.contentOwned.filter((item) => !allowedOwned.has(item));
  if (unauthorized.length > 0) {
    add("ADAPT_FIXED_BOUNDARY", "fixedBoundary.contentOwned", `contains factory-owned or unsupported paths: ${unauthorized.join(", ")}`);
  }
}

const continuous = adaptation.continuousMotionPolicy;
if (!continuous || !Array.isArray(continuous.defaultAllowlist) || !equalJson(continuous.defaultAllowlist, ["studio-background"])) {
  add("ADAPT_CONTINUOUS_ALLOWLIST", "continuousMotionPolicy.defaultAllowlist", "must contain only studio-background");
}
if (!continuous || !Array.isArray(continuous.contractOverrides)) {
  add("ADAPT_CONTINUOUS_ALLOWLIST", "continuousMotionPolicy.contractOverrides", "must be an array; use [] by default");
}

const beats = Array.isArray(source.beats) ? source.beats : [];
const sourceById = new Map(beats.map((beat) => [beat.beatId, beat]));
const beatOrder = new Map(beats.map((beat, index) => [beat.beatId, index]));
if (Array.isArray(continuous?.contractOverrides)) {
  const expectedOverrides = beats.flatMap((beat) =>
    (beat.continuousMotions ?? []).map((motion) => ({ beatId: beat.beatId, ...motion })),
  );
  for (const [index, override] of continuous.contractOverrides.entries()) {
    const sourceMotion = expectedOverrides.find(
      (candidate) => candidate.beatId === override?.beatId && candidate.object === override?.object,
    );
    if (!sourceMotion) {
      add("ADAPT_CONTINUOUS_OVERRIDE", `continuousMotionPolicy.contractOverrides[${index}]`, "has no matching source beat continuousMotions entry");
      continue;
    }
    for (const field of ["periodSeconds", "amplitude", "startSeconds", "endSeconds", "semanticReason", "deletionTest"]) {
      if (override[field] !== sourceMotion[field]) {
        add("ADAPT_CONTINUOUS_OVERRIDE", `continuousMotionPolicy.contractOverrides[${index}].${field}`, "must preserve the source value");
      }
    }
  }
  if (continuous.contractOverrides.length !== expectedOverrides.length) {
    add(
      "ADAPT_CONTINUOUS_OVERRIDE",
      "continuousMotionPolicy.contractOverrides",
      `must trace exactly ${expectedOverrides.length} source continuous motion(s), received ${continuous.contractOverrides.length}`,
    );
  }
}
const mappings = Array.isArray(adaptation.beatMappings) ? adaptation.beatMappings : [];
const mappingById = new Map();
for (const [index, mapping] of mappings.entries()) {
  if (!mapping || !nonEmpty(mapping.beatId)) {
    add("ADAPT_BEAT_COVERAGE", `beatMappings[${index}].beatId`, "is required");
    continue;
  }
  if (mappingById.has(mapping.beatId)) add("ADAPT_BEAT_COVERAGE", `beatMappings[${index}].beatId`, `duplicates ${mapping.beatId}`);
  else mappingById.set(mapping.beatId, mapping);
  if (!sourceById.has(mapping.beatId)) add("ADAPT_BEAT_COVERAGE", `beatMappings[${index}].beatId`, "does not exist in source contract");
}
for (const beat of beats) {
  if (!mappingById.has(beat.beatId)) add("ADAPT_BEAT_COVERAGE", "beatMappings", `missing exactly-one mapping for ${beat.beatId}`);
}
if (mappings.length !== beats.length) {
  add("ADAPT_BEAT_COVERAGE", "beatMappings", `must contain exactly ${beats.length} mappings, received ${mappings.length}`);
}

const scenes = Array.isArray(adaptation.scenes) ? adaptation.scenes : [];
const sceneById = new Map();
const sceneEntranceSignatures = new Map();
for (const [index, scene] of scenes.entries()) {
  const at = `scenes[${index}]`;
  if (!scene || !nonEmpty(scene.sceneId)) {
    add("ADAPT_SCENE", `${at}.sceneId`, "is required");
    continue;
  }
  if (sceneById.has(scene.sceneId)) add("ADAPT_SCENE", `${at}.sceneId`, `duplicates ${scene.sceneId}`);
  else sceneById.set(scene.sceneId, scene);
  if (!Array.isArray(scene.beatIds) || scene.beatIds.length === 0) add("ADAPT_SCENE", `${at}.beatIds`, "must contain consecutive source beats");
  else {
    const indexes = scene.beatIds.map((id) => beatOrder.get(id));
    if (indexes.some((value) => value === undefined)) add("ADAPT_SCENE", `${at}.beatIds`, "contains an unknown source beat");
    for (let cursor = 1; cursor < indexes.length; cursor += 1) {
      if (indexes[cursor] !== indexes[cursor - 1] + 1) add("ADAPT_SCENE", `${at}.beatIds`, "must be chronological and consecutive");
    }
  }
  const entrance = scene.entrance;
  if (!entrance || typeof entrance !== "object") {
    add("ADAPT_SCENE_ENTRANCE", `${at}.entrance`, "every true scene requires an authored entrance");
  } else {
    if (!nonEmpty(entrance.id) || !nonEmpty(entrance.semanticReason)) {
      add("ADAPT_SCENE_ENTRANCE", `${at}.entrance`, "requires a semantic id and reason");
    }
    if (!Array.isArray(entrance.selectors) || entrance.selectors.length === 0 || entrance.selectors.some((item) => !nonEmpty(item))) {
      add("ADAPT_SCENE_ENTRANCE", `${at}.entrance.selectors`, "must name scene-specific elements");
    }
    if (!Array.isArray(entrance.properties) || entrance.properties.length === 0) {
      add("ADAPT_SCENE_ENTRANCE", `${at}.entrance.properties`, "must name explicit visual properties");
    } else if (entrance.properties.some((item) => new Set(["visibility", "autoAlpha", "display"]).has(item))) {
      add("ADAPT_VISIBILITY", `${at}.entrance.properties`, "cannot animate visibility, autoAlpha, or display");
    }
    if (!finite(entrance.startSeconds) || !finite(entrance.endSeconds) || entrance.endSeconds <= entrance.startSeconds) {
      add("ADAPT_SCENE_ENTRANCE", `${at}.entrance`, "requires a positive explicit time interval");
    }
    if (entrance.sharedHelper !== false) add("ADAPT_SHARED_ENTRANCE", `${at}.entrance.sharedHelper`, "must be false");
    const signature = `${entrance.id}|${JSON.stringify(entrance.properties ?? [])}`;
    if (sceneEntranceSignatures.has(signature)) {
      add("ADAPT_SHARED_ENTRANCE", `${at}.entrance`, `duplicates ${sceneEntranceSignatures.get(signature)} instead of authoring this scene`);
    } else sceneEntranceSignatures.set(signature, scene.sceneId);
  }

  const final = index === scenes.length - 1;
  if (final) {
    if (scene.transitionOut !== null) add("ADAPT_TRANSITION", `${at}.transitionOut`, "must be null on final scene");
  } else {
    const transition = scene.transitionOut;
    if (!transition || typeof transition !== "object") {
      add("ADAPT_TRANSITION", `${at}.transitionOut`, "every non-final scene requires a semantic transition");
    } else {
      if (!nonEmpty(transition.transitionId) || !nonEmpty(transition.kind) || !nonEmpty(transition.semanticReason)) {
        add("ADAPT_TRANSITION", `${at}.transitionOut`, "requires id, kind, and semantic reason");
      }
      if (transition.toSceneId !== scenes[index + 1]?.sceneId) add("ADAPT_TRANSITION", `${at}.transitionOut.toSceneId`, "must target the next scene");
      if (!finite(transition.startSeconds) || !finite(transition.endSeconds) || transition.endSeconds <= transition.startSeconds) {
        add("ADAPT_TRANSITION", `${at}.transitionOut`, "requires a positive explicit interval");
      }
      if (!finite(transition.midpointSeconds) || transition.midpointSeconds < transition.startSeconds || transition.midpointSeconds > transition.endSeconds) {
        add("ADAPT_TRANSITION", `${at}.transitionOut.midpointSeconds`, "must be inside transition interval");
      }
      if (transition.midpointReadable !== true) add("ADAPT_TRANSITION_MIDPOINT", `${at}.transitionOut.midpointReadable`, "must be true");
      if (transition.emptyReset !== false) add("ADAPT_EMPTY_RESET", `${at}.transitionOut.emptyReset`, "must be false");
      if (transition.outgoingPreFade !== false) add("ADAPT_PREFADE_OUTGOING", `${at}.transitionOut.outgoingPreFade`, "must be false");
      if (!transition.anchors || !nonEmpty(transition.anchors.start) || !nonEmpty(transition.anchors.end)) {
        add("ADAPT_HANDOFF_ANCHOR", `${at}.transitionOut.anchors`, "must name visible start and end anchors");
      }
    }
  }
}

for (const [index, mapping] of mappings.entries()) {
  const sourceBeat = sourceById.get(mapping.beatId);
  if (!sourceBeat) continue;
  const at = `beatMappings[${index}]`;
  const scene = sceneById.get(mapping.sceneId);
  if (!scene || !scene.beatIds?.includes(mapping.beatId)) add("ADAPT_BEAT_COVERAGE", `${at}.sceneId`, "must reference the scene that lists this beat");
  const expectedKind = sourceBeat.mode === "readable-hold" ? "readable-hold" : "scene-state";
  if (mapping.kind !== expectedKind) add("ADAPT_BEAT_KIND", `${at}.kind`, `must equal ${expectedKind}`);
  if (!nonEmpty(mapping.stateId)) add("ADAPT_BEAT_KIND", `${at}.stateId`, "is required");
  const firstInScene = scene?.beatIds?.[0] === mapping.beatId;
  if (mapping.entersScene !== firstInScene) {
    add(firstInScene ? "ADAPT_SCENE_ENTRANCE" : "ADAPT_ENTRANCE_REPLAY", `${at}.entersScene`, `must be ${firstInScene}`);
  }
  if (mapping.replaysEntrance !== false) add("ADAPT_ENTRANCE_REPLAY", `${at}.replaysEntrance`, "must be false");
  const sourcePrimary = sourceBeat.primaryMotion?.id ?? null;
  const sourceSupport = sourceBeat.supportMotion?.id ?? null;
  if (mapping.primaryMotionId !== sourcePrimary) add("ADAPT_MOTION_TRACE", `${at}.primaryMotionId`, `must trace source value ${sourcePrimary}`);
  if (mapping.supportMotionId !== sourceSupport) add("ADAPT_MOTION_TRACE", `${at}.supportMotionId`, `must trace source value ${sourceSupport}`);
  if (!Array.isArray(mapping.continuousMotions)) add("ADAPT_CONTINUOUS_ALLOWLIST", `${at}.continuousMotions`, "must be an array");
  else {
    const expectedContinuous = (sourceBeat.continuousMotions ?? []).map((motion) => motion.object);
    if (!equalJson(mapping.continuousMotions, expectedContinuous)) {
      add("ADAPT_CONTINUOUS_OVERRIDE", `${at}.continuousMotions`, "must exactly trace source continuous-motion objects");
    }
  }
  if (sourceBeat.mode === "readable-hold") {
    if (mapping.primaryMotionId !== null || mapping.supportMotionId !== null || mapping.continuousMotions?.length > 0) {
      add("ADAPT_HOLD_STATIC", at, "readable hold cannot add primary, support, or continuous motion");
    }
    if (
      mapping.readableHold?.static !== true ||
      mapping.readableHold?.startSeconds !== sourceBeat.readableHold?.startSeconds ||
      mapping.readableHold?.endSeconds !== sourceBeat.readableHold?.endSeconds
    ) {
      add("ADAPT_HOLD_STATIC", `${at}.readableHold`, "must preserve source interval and remain static");
    }
  }
}

for (const scene of scenes) {
  const actual = mappings.filter((item) => item.sceneId === scene.sceneId).map((item) => item.beatId);
  if (!equalJson(actual, scene.beatIds)) add("ADAPT_BEAT_COVERAGE", `scenes.${scene.sceneId}.beatIds`, "must exactly match ordered beatMappings");
}

const acceptance = Array.isArray(adaptation.acceptanceMappings) ? adaptation.acceptanceMappings : [];
const acceptanceKeys = new Map();
for (const [index, item] of acceptance.entries()) {
  const key = `${item?.beatId}@${item?.sourceAtSeconds}#${item?.sourceRole}`;
  if (acceptanceKeys.has(key)) add("ADAPT_ACCEPTANCE_COVERAGE", `acceptanceMappings[${index}]`, `duplicates ${key}`);
  else acceptanceKeys.set(key, item);
  if (!nonEmpty(item?.snapshotId) || !nonEmpty(item?.path) || !item.path.startsWith("snapshots/acceptance/")) {
    add("ADAPT_ACCEPTANCE_COVERAGE", `acceptanceMappings[${index}]`, "requires snapshotId and snapshots/acceptance path");
  }
}
let expectedAcceptanceCount = 0;
for (const beat of beats) {
  for (const frame of beat.acceptanceFrames ?? []) {
    expectedAcceptanceCount += 1;
    const key = `${beat.beatId}@${frame.atSeconds}#${frame.role}`;
    const item = acceptanceKeys.get(key);
    if (!item) add("ADAPT_ACCEPTANCE_COVERAGE", "acceptanceMappings", `missing snapshot assertion for ${key}`);
    else if (!equalJson(item.assertions, frame.assertions)) {
      add("ADAPT_ACCEPTANCE_COVERAGE", `acceptanceMappings.${key}.assertions`, "must preserve source assertions verbatim");
    }
  }
}
if (acceptance.length !== expectedAcceptanceCount) {
  add("ADAPT_ACCEPTANCE_COVERAGE", "acceptanceMappings", `must contain exactly ${expectedAcceptanceCount} mappings, received ${acceptance.length}`);
}

const handoffs = Array.isArray(adaptation.handoffMappings) ? adaptation.handoffMappings : [];
const handoffByKey = new Map(handoffs.map((item) => [`${item.fromBeatId}->${item.toBeatId}`, item]));
let expectedHandoffs = 0;
for (const beat of beats) {
  if (!beat.handoff) continue;
  expectedHandoffs += 1;
  const key = `${beat.beatId}->${beat.handoff.toBeatId}`;
  const item = handoffByKey.get(key);
  if (!item) {
    add("ADAPT_HANDOFF_COVERAGE", "handoffMappings", `missing ${key}`);
    continue;
  }
  for (const field of ["object", "midpointSeconds", "midpointAssertion"]) {
    if (item[field] !== beat.handoff[field]) add("ADAPT_HANDOFF_COVERAGE", `handoffMappings.${key}.${field}`, "must preserve source value");
  }
  if (item.anchored !== true || !nonEmpty(item.startAnchor) || !nonEmpty(item.endAnchor)) {
    add("ADAPT_HANDOFF_ANCHOR", `handoffMappings.${key}`, "must have visible start/end anchors");
  }
  const fromMapping = mappingById.get(beat.beatId);
  const toMapping = mappingById.get(beat.handoff.toBeatId);
  if (fromMapping && toMapping) {
    const changesScene = fromMapping.sceneId !== toMapping.sceneId;
    const expectedType = changesScene ? "scene-transition" : "state-continuity";
    if (item.type !== expectedType) add("ADAPT_HANDOFF_COVERAGE", `handoffMappings.${key}.type`, `must equal ${expectedType}`);
    if (changesScene) {
      const transition = sceneById.get(fromMapping.sceneId)?.transitionOut;
      if (!transition || item.transitionId !== transition.transitionId) {
        add("ADAPT_HANDOFF_COVERAGE", `handoffMappings.${key}.transitionId`, "must reference source scene transition");
      }
    } else if (item.sceneId !== fromMapping.sceneId) {
      add("ADAPT_HANDOFF_COVERAGE", `handoffMappings.${key}.sceneId`, "must reference the continuing scene");
    }
  }
}
if (handoffs.length !== expectedHandoffs) {
  add("ADAPT_HANDOFF_COVERAGE", "handoffMappings", `must contain exactly ${expectedHandoffs} mappings, received ${handoffs.length}`);
}

const derived = adaptation.derivedContracts;
if (!derived || !new Set(["simple", "complex"]).has(derived.choreographyComplexity)) {
  add("ADAPT_DERIVED_CONTRACT", "derivedContracts.choreographyComplexity", 'must equal "simple" or "complex"');
} else {
  if (derived.sourceContractSha256 !== sourceDigest) add("ADAPT_DERIVED_CONTRACT", "derivedContracts.sourceContractSha256", "must match source bytes");
  if (derived.designSha256 !== adaptation.design?.sha256) add("ADAPT_DERIVED_CONTRACT", "derivedContracts.designSha256", "must match design.sha256");
  if (derived.choreographyComplexity === "complex") {
    const required = {
      storyboard: "STORYBOARD.md",
      sceneSchema: "SCENE_SCHEMA.json",
      vectorTemplates: "VECTOR_TEMPLATES.json",
      motionPrimitives: "MOTION_PRIMITIVES.json",
      motionMap: "MOTION_MAP.json",
    };
    for (const [key, expected] of Object.entries(required)) {
      if (derived.artifacts?.[key] !== expected) add("ADAPT_DERIVED_CONTRACT", `derivedContracts.artifacts.${key}`, `must equal ${expected}`);
    }
  }
}

const stripComments = (value) => value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const splitTopLevel = (value) => {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (new Set(['"', "'", "`"]).has(char)) {
      quote = char;
      continue;
    }
    if (new Set(["(", "{", "["]).has(char)) depth += 1;
    else if (new Set([")", "}", "]"]).has(char)) depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
};

const extractLabels = (value) => {
  const labels = new Map();
  for (const match of value.matchAll(/\.addLabel\s*\(\s*(["'`])([^"'`]+)\1\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g)) {
    labels.set(match[2], Number(match[3]));
  }
  return labels;
};

const resolvePosition = (positionArg, labels) => {
  if (typeof positionArg !== "string") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(positionArg)) return Number(positionArg);
  const literal = positionArg.match(/^(["'`])([^"'`]+)\1$/)?.[2];
  if (!literal) return null;
  const match = literal.match(/^([A-Za-z_$][\w$-]*)(?:([+-])=(\d+(?:\.\d+)?))?$/);
  if (!match || !labels.has(match[1])) return null;
  const base = labels.get(match[1]);
  if (!match[2]) return base;
  const offset = Number(match[3]);
  return match[2] === "+" ? base + offset : base - offset;
};

const extractTweenCalls = (value) => {
  const calls = [];
  const labels = extractLabels(value);
  const pattern = /(?:(?:\b[A-Za-z_$][\w$]*|\bgsap)\s*)?\.(to|from|fromTo|set)\s*\(/g;
  let match;
  while ((match = pattern.exec(value))) {
    const open = pattern.lastIndex - 1;
    let depth = 0;
    let quote = null;
    let escaped = false;
    let close = -1;
    for (let index = open; index < value.length; index += 1) {
      const char = value[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = null;
        continue;
      }
      if (new Set(['"', "'", "`"]).has(char)) {
        quote = char;
        continue;
      }
      if (char === "(") depth += 1;
      else if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          close = index;
          break;
        }
      }
    }
    if (close < 0) continue;
    const callArgs = splitTopLevel(value.slice(open + 1, close));
    const method = match[1];
    const vars = method === "fromTo" ? `${callArgs[1] ?? ""}\n${callArgs[2] ?? ""}` : callArgs[1] ?? "";
    const toVars = method === "fromTo" ? callArgs[2] ?? "" : callArgs[1] ?? "";
    const positionArg = method === "fromTo" ? callArgs[3] : callArgs[2];
    const selectorMatch = callArgs[0]?.match(/^(["'`])([\s\S]*?)\1$/);
    const target = selectorMatch?.[2] ?? null;
    const durationMatch = toVars.match(/\bduration\s*:\s*(-?\d+(?:\.\d+)?)/);
    const propertyMatches = [...vars.matchAll(/(?:^|[{,])\s*([A-Za-z_$][\w$-]*)\s*:/g)].map((item) => item[1]);
    const control = new Set(["duration", "delay", "ease", "stagger", "overwrite", "immediateRender", "repeat", "yoyo", "onComplete", "onStart", "onUpdate"]);
    calls.push({
      method,
      target,
      vars,
      toVars,
      args: callArgs,
      index: match.index,
      properties: [...new Set(propertyMatches.filter((item) => !control.has(item)))],
      start: resolvePosition(positionArg, labels),
      duration: durationMatch ? Number(durationMatch[1]) : method === "set" ? 0 : 0.5,
    });
    pattern.lastIndex = close + 1;
  }
  return calls;
};

if (htmlPath) {
  let html;
  try {
    html = fs.readFileSync(htmlPath, "utf8");
  } catch (error) {
    console.error(`[HTML_READ] Cannot read ${htmlPath}: ${error.message}`);
    process.exit(2);
  }
  const code = stripComments(html);
  const lineAt = (index) => code.slice(0, Math.max(0, index)).split("\n").length;
  const addHtml = (codeName, index, message) => add(codeName, `${path.basename(htmlPath)}:${lineAt(index)}`, message);
  const firstIndex = (regex) => {
    const match = regex.exec(code);
    regex.lastIndex = 0;
    return match?.index ?? 0;
  };

  if (/\bMath\.random\s*\(/.test(code)) addHtml("STABILITY_RANDOM", firstIndex(/\bMath\.random\s*\(/g), "unseeded Math.random is not seek-safe");
  if (/\b(?:Date\.now|performance\.now)\s*\(/.test(code)) addHtml("STABILITY_CLOCK", firstIndex(/\b(?:Date\.now|performance\.now)\s*\(/g), "wall-clock state is not seek-safe");
  if (/\basync\s+(?:function|\([^)]*\)\s*=>)|\bawait\b|\bnew\s+Promise\b|\bPromise\.(?:resolve|reject|all|race|any)\b/.test(code)) {
    addHtml("STABILITY_ASYNC", firstIndex(/\b(?:async|await|Promise)\b/g), "timeline construction and render state must be synchronous");
  }
  if (/\b(?:setTimeout|setInterval|requestAnimationFrame)\s*\(/.test(code)) {
    addHtml("STABILITY_TIMER", firstIndex(/\b(?:setTimeout|setInterval|requestAnimationFrame)\s*\(/g), "timers cannot construct or drive render-critical motion");
  }
  if (/\.(?:play|pause)\s*\(|\.currentTime\s*=/.test(code)) {
    addHtml("MEDIA_MANUAL_PLAYBACK", firstIndex(/\.(?:play|pause)\s*\(|\.currentTime\s*=/g), "HyperFrames must own media playback and currentTime");
  }
  if (/\brepeat\s*:\s*-1\b|animation(?:-iteration-count)?\s*:[^;{}]*\binfinite\b/i.test(code)) {
    addHtml("INFINITE_REPEAT", firstIndex(/\brepeat\s*:\s*-1\b|\binfinite\b/gi), "infinite repeats are forbidden in a finite render timeline");
  }
  if (/@keyframes\b|\banimation(?:-name|-duration|-delay|-timing-function|-iteration-count|-direction|-fill-mode|-play-state)?\s*:/i.test(code)) {
    addHtml("CSS_MOTION_FORBIDDEN", firstIndex(/@keyframes\b|\banimation(?:-[a-z-]+)?\s*:/gi), "render-critical CSS animation is not seek-verifiable; author motion on the registered paused GSAP timeline");
  }
  if (/\bautoAlpha\s*:/.test(code) || /\.(?:to|from|fromTo|set)\s*\([\s\S]{0,400}?\bvisibility\s*:/.test(code)) {
    addHtml("VISIBILITY_POLICY", firstIndex(/\b(?:autoAlpha|visibility)\s*:/g), "this project forbids visibility and autoAlpha animation; use opacity, clipPath, or transform on non-clip content");
  }

  const rootId = code.match(/data-composition-id\s*=\s*["']([^"']+)["']/)?.[1];
  if (!rootId) addHtml("TIMELINE_REGISTRY", 0, "composition root must declare data-composition-id");
  else if (rootId !== runtime?.compositionId) addHtml("TIMELINE_REGISTRY", 0, `root id ${rootId} does not match runtime mapping ${runtime?.compositionId}`);

  const timelineDeclarations = [...code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*gsap\.timeline\s*\(\s*\{([\s\S]*?)\}\s*\)/g)];
  const allTimelineCalls = [...code.matchAll(/\bgsap\.timeline\s*\(/g)];
  if (allTimelineCalls.length === 0) addHtml("TIMELINE_MISSING", 0, "composition requires one synchronous paused GSAP timeline");
  for (const declaration of timelineDeclarations) {
    if (!/\bpaused\s*:\s*true\b/.test(declaration[2])) {
      addHtml("TIMELINE_NOT_PAUSED", declaration.index, `timeline ${declaration[1]} must use paused: true`);
    }
  }
  const registryPattern = /window\.__timelines(?:\s*\[\s*["']([^"']+)["']\s*\]|\.([A-Za-z_$][\w$]*))\s*=\s*([A-Za-z_$][\w$]*)/g;
  const registrations = [...code.matchAll(registryPattern)].map((match) => ({ key: match[1] ?? match[2], variable: match[3], index: match.index }));
  const registeredVariables = new Set(registrations.map((item) => item.variable));
  for (const declaration of timelineDeclarations) {
    if (!registeredVariables.has(declaration[1])) addHtml("TIMELINE_UNREGISTERED", declaration.index, `timeline ${declaration[1]} is not registered`);
  }
  if (allTimelineCalls.length > registrations.length) {
    addHtml("TIMELINE_UNREGISTERED", allTimelineCalls[registrations.length]?.index ?? 0, `${allTimelineCalls.length - registrations.length} timeline(s) are not registered`);
  }
  if (registrations.length !== 1 || registrations[0]?.key !== rootId || registrations[0]?.variable !== timelineDeclarations[0]?.[1]) {
    addHtml("TIMELINE_UNREGISTERED", registrations[0]?.index ?? 0, "register exactly the one master timeline under the root composition id");
  }
  if (/\b[A-Za-z_$][\w$]*\.play\s*\(/.test(code)) {
    addHtml("TIMELINE_NOT_PAUSED", firstIndex(/\b[A-Za-z_$][\w$]*\.play\s*\(/g), "do not play a render-critical timeline; HyperFrames seeks it");
  }

  const calls = extractTweenCalls(code);
  if (calls.length === 0) addHtml("TIMELINE_EMPTY", 0, "composition timeline must contain explicit semantic motion");
  for (const call of calls) {
    if (!call.target) {
      addHtml("UNRESOLVED_TARGET", call.index, "tween target must be an explicit selector string so motion and readable holds can be verified");
    }
  }
  const presentIds = new Set([...code.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => `#${match[1]}`));
  for (const scene of scenes) {
    if (!presentIds.has(`#${scene.sceneId}`)) {
      addHtml("ADAPT_SCENE_MISSING", 0, `mapped scene #${scene.sceneId} is absent from the composition`);
    }
    for (const selector of scene.entrance?.selectors ?? []) {
      const baseId = selector.match(/^#[A-Za-z0-9_-]+/)?.[0];
      if (!baseId || !presentIds.has(baseId)) {
        addHtml("ADAPT_SCENE_ENTRANCE", 0, `entrance selector ${selector} is absent from the composition`);
      }
    }
    const entranceSelectors = new Set([`#${scene.sceneId}`, ...(scene.entrance?.selectors ?? [])]);
    if (!calls.some((call) => call.target && [...entranceSelectors].some((selector) => call.target === selector || call.target.startsWith(`${selector} `)))) {
      addHtml("ADAPT_SCENE_ENTRANCE", 0, `scene #${scene.sceneId} has no explicit timeline call implementing its declared entrance`);
    }
    for (const anchor of Object.values(scene.transitionOut?.anchors ?? {})) {
      const baseId = anchor.match(/^#[A-Za-z0-9_-]+/)?.[0];
      if (!baseId || !presentIds.has(baseId)) {
        addHtml("ADAPT_HANDOFF_ANCHOR", 0, `transition anchor ${anchor} is absent from the composition`);
      }
    }
  }
  const timedMediaIds = new Set([...code.matchAll(/<(?:video|audio)\b[^>]*\bid=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]));
  for (const call of calls) {
    if (!call.target) continue;
    const directMedia = call.target === "video" || call.target === "audio" || [...timedMediaIds].some((id) => call.target.includes(`#${id}`));
    const onlyVolume = call.properties.length === 1 && call.properties[0] === "volume";
    if (directMedia && !onlyVolume) addHtml("TIMED_MEDIA_MOTION", call.index, `visual motion targets timed media ${call.target}; target an untimed wrapper`);
  }

  const intervals = [];
  for (const call of calls) {
    if (!call.target || call.duration <= 0) continue;
    if (call.start === null) {
      addHtml("UNRESOLVED_TIMING", call.index, `cannot resolve explicit timing for ${call.target}; use a numeric time or a declared GSAP label`);
      continue;
    }
    for (const property of call.properties) {
      intervals.push({ target: call.target, property, start: call.start, end: call.start + call.duration, index: call.index });
    }
  }
  for (const mapping of mappings.filter((item) => item?.kind === "readable-hold")) {
    const holdStart = mapping.readableHold?.startSeconds;
    const holdEnd = mapping.readableHold?.endSeconds;
    if (!finite(holdStart) || !finite(holdEnd)) continue;
    for (const interval of intervals) {
      if (interval.target.includes("studio-background")) continue;
      if (Math.max(interval.start, holdStart) < Math.min(interval.end, holdEnd)) {
        addHtml(
          "ADAPT_HOLD_MOTION",
          interval.index,
          `${interval.target}.${interval.property} moves during readable hold ${mapping.beatId} (${holdStart}-${holdEnd}s)`,
        );
      }
    }
    for (const call of calls) {
      if (call.method !== "set" || call.start === null || call.target?.includes("studio-background")) continue;
      if (call.start >= holdStart && call.start < holdEnd && call.properties.length > 0) {
        addHtml("ADAPT_HOLD_MOTION", call.index, `${call.target} changes state with set() during readable hold ${mapping.beatId}`);
      }
    }
  }
  for (let left = 0; left < intervals.length; left += 1) {
    for (let right = left + 1; right < intervals.length; right += 1) {
      const a = intervals[left];
      const b = intervals[right];
      if (a.target === b.target && a.property === b.property && Math.max(a.start, b.start) < Math.min(a.end, b.end)) {
        addHtml("PROPERTY_OVERLAP", b.index, `${a.target}.${a.property} overlaps at ${Math.max(a.start, b.start).toFixed(3)}s`);
      }
    }
  }

  const sceneStarts = new Map(
    [...code.matchAll(/<[^>]+\bid=["']([^"']+)["'][^>]*\bdata-transition-start=["']([0-9.]+)["'][^>]*>/gi)].map((match) => [match[1], Number(match[2])]),
  );
  for (const call of calls) {
    if (!call.target || call.start === null) continue;
    const sceneId = call.target.match(/^#([A-Za-z0-9_-]+)$/)?.[1];
    const transitionStart = sceneStarts.get(sceneId);
    const fadesToZero = /\b(?:opacity|autoAlpha)\s*:\s*0(?:\D|$)/.test(call.toVars);
    if (transitionStart !== undefined && fadesToZero && call.start < transitionStart) {
      addHtml("PREFADE_OUTGOING", call.index, `${call.target} fades before semantic transition at ${transitionStart}s`);
    }
  }

  if (/\b(?:universal|global)?crossfade\b/i.test(code)) {
    addHtml("GENERIC_CROSSFADE", firstIndex(/\b(?:universal|global)?crossfade\b/gi), "universal crossfade helpers are forbidden");
  }
  if (/\benterStyle\b/.test(code)) addHtml("GLOBAL_ENTER_STYLE", firstIndex(/\benterStyle\b/g), "shared enterStyle is forbidden");

  const genericEntranceSignatures = new Map();
  for (const call of calls.filter((item) => item.method === "fromTo" && item.target)) {
    const fromVars = call.args[1] ?? "";
    const toVars = call.args[2] ?? "";
    if (/\bopacity\s*:\s*0\b/.test(fromVars) && /\by\s*:\s*-?\d/.test(fromVars) && /\bopacity\s*:\s*1\b/.test(toVars) && /\by\s*:\s*0\b/.test(toVars)) {
      const signature = "opacity+y";
      const prior = genericEntranceSignatures.get(signature);
      if (prior && prior !== call.target) {
        addHtml("GENERIC_REPEATED_ENTRANCE", call.index, `${call.target} repeats generic opacity+y entrance used by ${prior}`);
      } else genericEntranceSignatures.set(signature, call.target);
    }
  }

  if (/animation(?:-iteration-count)?\s*:[^;{}]*\binfinite\b/i.test(code) || calls.some((call) => /(?:float|glow|decor|pulse|breathe)/i.test(call.target ?? "") && /\brepeat\s*:\s*-1\b/.test(call.vars))) {
    addHtml("DECORATIVE_LOOP", firstIndex(/\b(?:infinite|floating|glow|repeat\s*:\s*-1)\b/gi), "floating/glow/decorative loops are forbidden without a contract override");
  }

  for (const tag of code.matchAll(/<([a-z][\w:-]*)\b([^>]*\bclass=["'][^"']*(?:connector|decorative-line|route-line|scan-line|floating-arc)[^"']*["'][^>]*)>/gi)) {
    const attrs = tag[2];
    if (!/\bdata-start-anchor=["'][^"']+["']/.test(attrs) || !/\bdata-end-anchor=["'][^"']+["']/.test(attrs) || !/\bdata-job=["'][^"']+["']/.test(attrs)) {
      addHtml("UNANCHORED_DECORATION", tag.index, "connector/decoration requires start anchor, end anchor, and job");
    }
  }
  for (const image of code.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = image[1];
    if (/(?:generic[-_ ]?ai|ai[-_ ]?(?:chip|brain|sparkle|rocket|particle)|(?:sparkle|rocket)[-_ ]?ai)/i.test(attrs)) {
      if (!/\bdata-source-phrase=["'][^"']+["']/.test(attrs) || !/\bdata-semantic-role=["'][^"']+["']/.test(attrs)) {
        addHtml("GENERIC_AI_DECORATION", image.index, "AI imagery requires a source phrase and semantic evidence role");
      }
    }
  }

  if (calls.some((call) => call.target === ".scene" && /\bopacity\s*:\s*0(?:\D|$)/.test(call.toVars)) || /data-transition-midpoint=["'](?:empty|blank|reset)["']/i.test(code)) {
    addHtml("EMPTY_RESET", firstIndex(/\.scene|data-transition-midpoint/gi), "transition cannot reset all scenes to an empty frame");
  }
  if (/data-transition-midpoint-readable=["']false["']|data-transition-midpoint=["'](?:unreadable|effects-only)["']/i.test(code)) {
    addHtml("UNREADABLE_MIDPOINT", firstIndex(/data-transition-midpoint/gi), "transition midpoint must retain an intentional readable subject");
  }
}

if (errors.length > 0) {
  console.error(`Runtime adaptation failed (${errors.length} issue${errors.length === 1 ? "" : "s"}):`);
  for (const error of errors) console.error(`- [${error.code}] ${error.location}: ${error.message}`);
  process.exit(1);
}

console.log(
  `PASS ${path.resolve(adaptationPath)} (${beats.length} beats -> ${scenes.length} scenes, ${acceptance.length} acceptance snapshots${htmlPath ? ", HTML checked" : ""})`,
);
