#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(scriptDir, "..");
const fixtureDir = path.join(skillDir, "evals", "fixtures", "contracts");
const regressionHtml = path.join(skillDir, "evals", "fixtures", "hyperframes-motion-regression.html");
const motionValidator = path.join(scriptDir, "validate_motion_contract.mjs");
const adaptationValidator = path.join(scriptDir, "validate_runtime_adaptation.mjs");
const legacyContract = path.join(fixtureDir, "valid-legacy-remotion.json");
const hyperframesContract = path.join(fixtureDir, "valid-hyperframes.json");
const validAdaptation = path.join(fixtureDir, "valid-runtime-adaptation.json");
const validHtml = path.join(fixtureDir, "valid-runtime-content.html");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hf-contract-adapter-"));

const sha256 = (filePath) => crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
const json = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const clone = (value) => structuredClone(value);
const writeTemp = (name, value) => {
  const filePath = path.join(tempRoot, name);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
};
const writeTempHtml = (name, value) => {
  const filePath = path.join(tempRoot, name);
  fs.writeFileSync(filePath, value);
  return filePath;
};
const run = (script, args) => {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  return { ...result, combined: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
};
const expectPass = (label, script, args) => {
  const result = run(script, args);
  assert.equal(result.status, 0, `${label} should pass:\n${result.combined}`);
  assert.match(result.combined, /PASS/, `${label} should emit PASS`);
};
const expectFail = (label, script, args, diagnostics) => {
  const result = run(script, args);
  assert.notEqual(result.status, 0, `${label} should fail`);
  for (const diagnostic of diagnostics) {
    assert.match(result.combined, new RegExp(`\\[${diagnostic}\\]`), `${label} should report ${diagnostic}:\n${result.combined}`);
  }
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("accepts a valid legacy Remotion source contract without modifying it", () => {
  const before = sha256(legacyContract);
  expectPass("legacy contract", motionValidator, [legacyContract]);
  assert.equal(sha256(legacyContract), before, "source contract validator must remain read-only");
});

test("accepts a valid native HyperFrames source contract", () => {
  expectPass("HyperFrames contract", motionValidator, [hyperframesContract]);
});

test("rejects an unknown source pipeline", () => {
  const value = clone(json(hyperframesContract));
  value.pipeline = "other-runtime";
  expectFail("unknown pipeline", motionValidator, [writeTemp("bad-pipeline.json", value)], ["MOTION_PIPELINE"]);
});

test("rejects a source contract gap in full-timeline beat coverage", () => {
  const value = clone(json(legacyContract));
  value.beats[1].startSeconds = 4.5;
  expectFail("beat gap", motionValidator, [writeTemp("beat-gap.json", value)], ["MOTION_BEAT_COVERAGE"]);
});

test("rejects missing hard-rejection roles", () => {
  const value = clone(json(legacyContract));
  value.hardRejections = value.hardRejections.slice(0, -1);
  expectFail("missing hard rejection", motionValidator, [writeTemp("missing-rejection.json", value)], ["MOTION_HARD_REJECTION"]);
});

test("accepts a complete traceable runtime adaptation", () => {
  expectPass("valid adaptation", adaptationValidator, [validAdaptation, legacyContract, "--html", validHtml]);
});

const materializeInvalidFixture = (fixtureName) => {
  const spec = json(path.join(fixtureDir, fixtureName));
  const value = clone(json(path.join(fixtureDir, spec.base)));
  const mutation = spec.mutation;
  if (mutation.removeBeatMapping) {
    value.beatMappings = value.beatMappings.filter((item) => item.beatId !== mutation.removeBeatMapping);
  }
  if (mutation.removeAcceptanceMapping) {
    const key = mutation.removeAcceptanceMapping;
    value.acceptanceMappings = value.acceptanceMappings.filter(
      (item) => `${item.beatId}@${item.sourceAtSeconds}#${item.sourceRole}` !== key,
    );
  }
  if (mutation.beatId && mutation.set) {
    const target = value.beatMappings.find((item) => item.beatId === mutation.beatId);
    for (const [key, next] of Object.entries(mutation.set)) {
      if (key === "readableHold.static") target.readableHold.static = next;
      else target[key] = next;
    }
  }
  return { spec, filePath: writeTemp(fixtureName, value) };
};

for (const fixtureName of [
  "invalid-missing-beat-mapping.json",
  "invalid-missing-acceptance-mapping.json",
  "invalid-readable-hold-motion.json",
]) {
  test(`rejects ${fixtureName}`, () => {
    const { spec, filePath } = materializeInvalidFixture(fixtureName);
    expectFail(fixtureName, adaptationValidator, [filePath, legacyContract], [spec.expectedDiagnostic]);
  });
}

test("rejects replaying a scene entrance for a consecutive beat in the same scene", () => {
  const value = clone(json(validAdaptation));
  const hold = value.beatMappings.find((item) => item.beatId === "B02");
  hold.entersScene = true;
  hold.replaysEntrance = true;
  expectFail("replayed entrance", adaptationValidator, [writeTemp("replayed-entrance.json", value), legacyContract], ["ADAPT_ENTRANCE_REPLAY"]);
});

test("rejects a pre-faded outgoing scene in the runtime map", () => {
  const value = clone(json(validAdaptation));
  value.scenes[0].transitionOut.outgoingPreFade = true;
  expectFail("pre-fade map", adaptationValidator, [writeTemp("prefade-map.json", value), legacyContract], ["ADAPT_PREFADE_OUTGOING"]);
});

test("rejects a shared entrance helper and duplicated entrance signature", () => {
  const value = clone(json(validAdaptation));
  value.scenes[1].entrance.sharedHelper = true;
  value.scenes[1].entrance.id = value.scenes[0].entrance.id;
  value.scenes[1].entrance.properties = clone(value.scenes[0].entrance.properties);
  expectFail("shared entrance", adaptationValidator, [writeTemp("shared-entrance.json", value), legacyContract], ["ADAPT_SHARED_ENTRANCE"]);
});

test("rejects broad default continuous-motion allowlists", () => {
  const value = clone(json(validAdaptation));
  value.continuousMotionPolicy.defaultAllowlist.push("cards");
  expectFail("continuous allowlist", adaptationValidator, [writeTemp("bad-allowlist.json", value), legacyContract], ["ADAPT_CONTINUOUS_ALLOWLIST"]);
});

test("rejects a continuous-motion override that the source contract does not prove", () => {
  const value = clone(json(validAdaptation));
  value.continuousMotionPolicy.contractOverrides.push({
    beatId: "B02",
    object: "evidence-card",
    periodSeconds: 2,
    amplitude: "8px",
    startSeconds: 4,
    endSeconds: 6,
    semanticReason: "Keep it lively.",
    deletionTest: "Only looks less busy."
  });
  expectFail("unproved continuous override", adaptationValidator, [writeTemp("unproved-loop.json", value), legacyContract], ["ADAPT_CONTINUOUS_OVERRIDE"]);
});

test("requires all complex choreography production contracts", () => {
  const value = clone(json(validAdaptation));
  delete value.derivedContracts.artifacts.motionMap;
  expectFail("derived contracts", adaptationValidator, [writeTemp("missing-motion-map.json", value), legacyContract], ["ADAPT_DERIVED_CONTRACT"]);
});

test("rejects executor ownership of a factory-owned fixed mount", () => {
  const value = clone(json(validAdaptation));
  value.fixedBoundary.contentOwned.push("manifest.json");
  expectFail("fixed boundary", adaptationValidator, [writeTemp("bad-fixed-boundary.json", value), legacyContract], ["ADAPT_FIXED_BOUNDARY"]);
});

test("passes deterministic registered GSAP HTML", () => {
  expectPass("valid HTML", adaptationValidator, [validAdaptation, legacyContract, "--html", validHtml]);
});

test("rejects DESIGN.md hash drift before authoring", () => {
  const value = clone(json(validAdaptation));
  value.design.sha256 = "0".repeat(64);
  value.derivedContracts.designSha256 = value.design.sha256;
  expectFail("design drift", adaptationValidator, [writeTemp("design-drift.json", value), legacyContract], ["ADAPT_DESIGN_TRACE"]);
});

test("rejects property overlap scheduled with GSAP labels", () => {
  const source = fs.readFileSync(validHtml, "utf8").replace(
    'window.__timelines["content"] = tl;',
    'tl.to("#evidence-panel", { opacity: 0, duration: 1 }, "evidence");\n      tl.to("#evidence-panel", { opacity: 1, duration: 1 }, "evidence+=0.2");\n      window.__timelines["content"] = tl;',
  );
  expectFail("labeled overlap", adaptationValidator, [validAdaptation, legacyContract, "--html", writeTempHtml("labeled-overlap.html", source)], ["PROPERTY_OVERLAP"]);
});

test("rejects content motion inside a readable hold", () => {
  const source = fs.readFileSync(validHtml, "utf8").replace(
    'window.__timelines["content"] = tl;',
    'tl.to("#evidence-panel", { rotation: 20, duration: 1 }, "hold");\n      window.__timelines["content"] = tl;',
  );
  expectFail("moving hold", adaptationValidator, [validAdaptation, legacyContract, "--html", writeTempHtml("moving-hold.html", source)], ["ADAPT_HOLD_MOTION"]);
});

test("rejects a variable tween target that could hide readable-hold motion", () => {
  const source = fs.readFileSync(validHtml, "utf8").replace(
    'window.__timelines["content"] = tl;',
    'const holdTarget = "#evidence-panel";\n      tl.to(holdTarget, { rotation: 20, duration: 1 }, "hold");\n      window.__timelines["content"] = tl;',
  );
  expectFail("variable target", adaptationValidator, [validAdaptation, legacyContract, "--html", writeTempHtml("variable-target.html", source)], ["UNRESOLVED_TARGET"]);
});

test("rejects finite CSS animation that could move during a readable hold", () => {
  const source = fs.readFileSync(validHtml, "utf8").replace(
    "</style>",
    "#evidence-panel { animation: hold-spin 1s linear 4s both; } @keyframes hold-spin { to { transform: rotate(20deg); } }</style>",
  );
  expectFail("finite CSS motion", adaptationValidator, [validAdaptation, legacyContract, "--html", writeTempHtml("finite-css-motion.html", source)], ["CSS_MOTION_FORBIDDEN"]);
});

test("rejects placeholder-only mapped HTML with an empty timeline", () => {
  const ids = ["scene-evidence", "evidence-panel", "source-route", "verified-result-card", "scene-validation", "validation-input-slot", "validation-rail"];
  const source = `<template><div id="content" data-composition-id="content">${ids.map((id) => `<div id="${id}"></div>`).join("")}<script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});window.__timelines["content"]=tl;</script></div></template>`;
  expectFail("placeholder-only content", adaptationValidator, [validAdaptation, legacyContract, "--html", writeTempHtml("placeholder-only.html", source)], ["TIMELINE_EMPTY", "ADAPT_SCENE_ENTRANCE"]);
});

test("rejects an empty composition that declares mapped scenes only in JSON", () => {
  const source = `<template><div id="content" data-composition-id="content"><script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});window.__timelines["content"]=tl;</script></div></template>`;
  expectFail("empty content", adaptationValidator, [validAdaptation, legacyContract, "--html", writeTempHtml("empty-content.html", source)], ["ADAPT_SCENE_MISSING", "ADAPT_SCENE_ENTRANCE"]);
});

test("rejects every stability and Anti-PPT class in the regression HTML", () => {
  expectFail("regression HTML", adaptationValidator, [validAdaptation, legacyContract, "--html", regressionHtml], [
    "STABILITY_RANDOM",
    "STABILITY_CLOCK",
    "STABILITY_ASYNC",
    "STABILITY_TIMER",
    "MEDIA_MANUAL_PLAYBACK",
    "TIMELINE_NOT_PAUSED",
    "TIMELINE_UNREGISTERED",
    "INFINITE_REPEAT",
    "PROPERTY_OVERLAP",
    "TIMED_MEDIA_MOTION",
    "VISIBILITY_POLICY",
    "PREFADE_OUTGOING",
    "GENERIC_CROSSFADE",
    "GLOBAL_ENTER_STYLE",
    "GENERIC_REPEATED_ENTRANCE",
    "DECORATIVE_LOOP",
    "UNANCHORED_DECORATION",
    "GENERIC_AI_DECORATION",
    "EMPTY_RESET",
    "UNREADABLE_MIDPOINT"
  ]);
});

test("mutation: autoAlpha is rejected by the stricter project visibility policy", () => {
  const source = fs.readFileSync(validHtml, "utf8").replace(
    '{ clipPath: "inset(0 0% 0 0)" }',
    '{ clipPath: "inset(0 0% 0 0)", autoAlpha: 1 }',
  );
  expectFail("autoAlpha mutation", adaptationValidator, [validAdaptation, legacyContract, "--html", writeTempHtml("auto-alpha.html", source)], ["VISIBILITY_POLICY"]);
});

test("mutation: deleting timeline registration is rejected", () => {
  const source = fs.readFileSync(validHtml, "utf8").replace('window.__timelines["content"] = tl;', "");
  expectFail("unregistered mutation", adaptationValidator, [validAdaptation, legacyContract, "--html", writeTempHtml("unregistered.html", source)], ["TIMELINE_UNREGISTERED"]);
});

test("mutation: overlapping property tweens are rejected", () => {
  const source = fs.readFileSync(validHtml, "utf8").replace(
    'window.__timelines["content"] = tl;',
    'tl.to("#evidence-panel", { opacity: 0, duration: 1 }, 2);\n      tl.to("#evidence-panel", { opacity: 1, duration: 1 }, 2.2);\n      window.__timelines["content"] = tl;',
  );
  expectFail("overlap mutation", adaptationValidator, [validAdaptation, legacyContract, "--html", writeTempHtml("overlap.html", source)], ["PROPERTY_OVERLAP"]);
});

test("mutation: motion directly targeting timed video is rejected", () => {
  const source = fs.readFileSync(validHtml, "utf8").replace(
    'window.__timelines["content"] = tl;',
    'tl.to("#presenter-video", { x: 40, duration: 1 }, 2);\n      window.__timelines["content"] = tl;',
  );
  expectFail("video target mutation", adaptationValidator, [validAdaptation, legacyContract, "--html", writeTempHtml("video-target.html", source)], ["TIMED_MEDIA_MOTION"]);
});

let passed = 0;
try {
  for (const { name, fn } of tests) {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  }
  console.log(`PASS test_contract_adapter (${passed}/${tests.length} scenarios)`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
