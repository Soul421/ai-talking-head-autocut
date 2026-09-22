#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const contractPath = process.argv[2];
if (!contractPath) {
  console.error("Usage: node validate_motion_contract.mjs <inputs/motion-contract.json>");
  process.exit(2);
}

const errors = [];
const add = (code, location, message) => errors.push({ code, location, message });
const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const normalizeMotionText = (value) =>
  String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
const genericMotion = /(?:^|-)(fade|slide|pop|opacity|translate|scale|glow|breathe|float|pulse|hover|bob|shimmer)(?:-|$)/;
const hasGenericMotion = (value) => genericMotion.test(normalizeMotionText(value));
const requiredHardRejections = [
  "repeated-generic-entrance",
  "decorative-continuous-motion",
  "unanchored-decoration",
  "generic-ai-decoration",
  "empty-reset-transition",
  "unreadable-transition-midpoint",
];

let contract;
try {
  contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
} catch (error) {
  console.error(`[MOTION_READ] Cannot read ${contractPath}: ${error.message}`);
  process.exit(2);
}

if (contract.version !== 1) add("MOTION_VERSION", "version", "must equal 1");
if (!new Set(["remotion", "hyperframes"]).has(contract.pipeline)) {
  add("MOTION_PIPELINE", "pipeline", 'must equal "remotion" or "hyperframes"');
}
if (contract.fps !== 30) add("MOTION_FPS", "fps", "must equal the workspace default 30");
const tolerance = 1 / 60;

const timeline = contract.timeline;
if (!timeline || typeof timeline !== "object" || Array.isArray(timeline)) {
  add("MOTION_TIMELINE", "timeline", "is required");
} else {
  if (!finite(timeline.programDurationSeconds) || timeline.programDurationSeconds <= 0) {
    add("MOTION_TIMELINE", "timeline.programDurationSeconds", "must be positive");
  }
  if (!finite(timeline.audioDurationSeconds) || timeline.audioDurationSeconds <= 0) {
    add("MOTION_TIMELINE", "timeline.audioDurationSeconds", "must be positive");
  }
  if (!finite(timeline.captionsEndSeconds) || timeline.captionsEndSeconds <= 0) {
    add("MOTION_TIMELINE", "timeline.captionsEndSeconds", "must be positive");
  }
  if (finite(timeline.audioDurationSeconds) && finite(timeline.programDurationSeconds)) {
    const tail = timeline.programDurationSeconds - timeline.audioDurationSeconds;
    if (tail < -tolerance) add("MOTION_TIMELINE", "timeline.programDurationSeconds", "cannot end before locked audio");
    if (tail > 3) add("MOTION_TIMELINE", "timeline.programDurationSeconds", "tail after locked audio cannot exceed 3 seconds");
  }
  if (finite(timeline.captionsEndSeconds) && finite(timeline.audioDurationSeconds)) {
    if (timeline.captionsEndSeconds > timeline.audioDurationSeconds + 0.5) {
      add("MOTION_TIMELINE", "timeline.captionsEndSeconds", "cannot extend more than 0.5 seconds past locked audio");
    }
    if (timeline.captionsEndSeconds < timeline.audioDurationSeconds - 3) {
      add("MOTION_TIMELINE", "timeline.captionsEndSeconds", "cannot end more than 3 seconds before locked audio");
    }
  }
}

if (!contract.sourceHashes || typeof contract.sourceHashes !== "object" || Array.isArray(contract.sourceHashes)) {
  add("MOTION_SOURCE_HASH", "sourceHashes", "is required");
} else {
  for (const key of ["directorScript", "productionSpec", "assetPlan", "audio", "captionsAligned"]) {
    if (!hash(contract.sourceHashes[key])) add("MOTION_SOURCE_HASH", `sourceHashes.${key}`, "must be a 64-character SHA-256");
  }
}

if (!Array.isArray(contract.hardRejections)) {
  add("MOTION_HARD_REJECTION", "hardRejections", "must be an array");
} else {
  for (const rejection of requiredHardRejections) {
    if (!contract.hardRejections.includes(rejection)) {
      add("MOTION_HARD_REJECTION", "hardRejections", `must include ${rejection}`);
    }
  }
  const unknown = contract.hardRejections.filter((item) => !requiredHardRejections.includes(item));
  if (contract.hardRejections.length !== requiredHardRejections.length || unknown.length > 0) {
    add("MOTION_HARD_REJECTION", "hardRejections", `must contain exactly the six locked roles; unknown: ${unknown.join(", ") || "none"}`);
  }
}

const stage = contract.fixedStage;
if (!stage || typeof stage !== "object" || Array.isArray(stage)) {
  add("MOTION_FIXED_STAGE", "fixedStage", "is required");
} else {
  if (stage.template !== "studio-warm-grid") add("MOTION_FIXED_STAGE", "fixedStage.template", 'must equal "studio-warm-grid"');
  if (stage.contentMotionDefault !== "none") add("MOTION_FIXED_STAGE", "fixedStage.contentMotionDefault", 'must equal "none"');
  if (stage.globalSceneTransition !== "none") add("MOTION_FIXED_STAGE", "fixedStage.globalSceneTransition", 'must equal "none"');
  const allowlist = stage.continuousMotionAllowlist;
  const knownBackgrounds = new Set(["PremiumGridBackground", "studio-background"]);
  if (!Array.isArray(allowlist) || allowlist.length !== 1 || !knownBackgrounds.has(allowlist[0])) {
    add(
      "MOTION_FIXED_STAGE",
      "fixedStage.continuousMotionAllowlist",
      'must contain only the fixed background alias "PremiumGridBackground" or "studio-background"',
    );
  }
}

const beats = contract.beats;
if (!Array.isArray(beats) || beats.length === 0) {
  add("MOTION_BEAT_COVERAGE", "beats", "must contain the complete program timeline");
} else {
  const ids = new Set();
  for (const [index, beat] of beats.entries()) {
    const at = `beats[${index}]`;
    if (!beat || typeof beat !== "object" || Array.isArray(beat)) {
      add("MOTION_BEAT", at, "must be an object");
      continue;
    }
    if (!nonEmpty(beat.beatId)) add("MOTION_BEAT_ID", `${at}.beatId`, "is required");
    else if (ids.has(beat.beatId)) add("MOTION_BEAT_ID", `${at}.beatId`, `duplicates ${beat.beatId}`);
    else ids.add(beat.beatId);

    if (!finite(beat.startSeconds) || beat.startSeconds < 0) add("MOTION_BEAT_COVERAGE", `${at}.startSeconds`, "must be non-negative");
    if (!finite(beat.endSeconds) || beat.endSeconds <= beat.startSeconds) {
      add("MOTION_BEAT_COVERAGE", `${at}.endSeconds`, "must be greater than startSeconds");
    }
    if (index === 0 && finite(beat.startSeconds) && Math.abs(beat.startSeconds) > tolerance) {
      add("MOTION_BEAT_COVERAGE", `${at}.startSeconds`, "full timeline must start at 0");
    }
    if (index > 0 && finite(beat.startSeconds) && finite(beats[index - 1]?.endSeconds)) {
      const gap = beat.startSeconds - beats[index - 1].endSeconds;
      if (gap < -tolerance) add("MOTION_BEAT_COVERAGE", `${at}.startSeconds`, "overlaps previous beat");
      if (gap > tolerance) add("MOTION_BEAT_COVERAGE", `${at}.startSeconds`, `leaves an uncovered gap of ${gap.toFixed(3)} seconds`);
    }
    if (!new Set(["motion", "readable-hold"]).has(beat.mode)) {
      add("MOTION_BEAT_MODE", `${at}.mode`, 'must be "motion" or "readable-hold"');
    }

    if (!beat.state || typeof beat.state !== "object" || Array.isArray(beat.state)) {
      add("MOTION_STATE_CHANGE", `${at}.state`, "is required");
    } else {
      for (const field of ["from", "to", "newUnderstanding"]) {
        if (!nonEmpty(beat.state[field])) add("MOTION_STATE_CHANGE", `${at}.state.${field}`, "is required");
      }
    }

    if (beat.mode === "motion") {
      if (!beat.primaryMotion || typeof beat.primaryMotion !== "object" || Array.isArray(beat.primaryMotion)) {
        add("MOTION_PRIMARY", `${at}.primaryMotion`, "is required for a motion beat");
      } else {
        if (!nonEmpty(beat.primaryMotion.id)) add("MOTION_PRIMARY", `${at}.primaryMotion.id`, "is required");
        if (!nonEmpty(beat.primaryMotion.semanticReason)) add("MOTION_PRIMARY", `${at}.primaryMotion.semanticReason`, "is required");
        if (nonEmpty(beat.primaryMotion.id) && hasGenericMotion(beat.primaryMotion.id)) {
          add("MOTION_PRIMARY", `${at}.primaryMotion.id`, "must name a semantic state change, not a generic primitive");
        }
      }
    } else {
      if (beat.primaryMotion !== null) add("MOTION_HOLD", `${at}.primaryMotion`, "must be null for readable-hold");
      if (!nonEmpty(beat.stillReason)) add("MOTION_HOLD", `${at}.stillReason`, "is required for readable-hold");
    }

    if (beat.supportMotion !== null && beat.supportMotion !== undefined) {
      if (Array.isArray(beat.supportMotion) || typeof beat.supportMotion !== "object") {
        add("MOTION_SUPPORT", `${at}.supportMotion`, "must be one object or null");
      } else {
        if (!nonEmpty(beat.supportMotion.id)) add("MOTION_SUPPORT", `${at}.supportMotion.id`, "is required");
        if (!nonEmpty(beat.supportMotion.semanticReason)) add("MOTION_SUPPORT", `${at}.supportMotion.semanticReason`, "is required");
        if (hasGenericMotion(beat.supportMotion.id) || hasGenericMotion(beat.supportMotion.semanticReason)) {
          add("MOTION_SUPPORT", `${at}.supportMotion`, "cannot be a generic or decorative motion primitive");
        }
      }
    }
    if (beat.mode === "readable-hold" && beat.supportMotion !== null) {
      add("MOTION_HOLD", `${at}.supportMotion`, "must be null for readable-hold");
    }

    if (!Array.isArray(beat.continuousMotions)) {
      add("MOTION_CONTINUOUS", `${at}.continuousMotions`, "must be an array; use [] when none is justified");
    } else {
      if (beat.mode === "readable-hold" && beat.continuousMotions.length > 0) {
        add("MOTION_HOLD", `${at}.continuousMotions`, "must be empty for readable-hold");
      }
      for (const [motionIndex, motion] of beat.continuousMotions.entries()) {
        const motionAt = `${at}.continuousMotions[${motionIndex}]`;
        if (!motion || typeof motion !== "object" || Array.isArray(motion)) {
          add("MOTION_CONTINUOUS", motionAt, "must be an object");
          continue;
        }
        if (!nonEmpty(motion.object)) add("MOTION_CONTINUOUS", `${motionAt}.object`, "is required");
        if (!finite(motion.periodSeconds) || motion.periodSeconds <= 0) add("MOTION_CONTINUOUS", `${motionAt}.periodSeconds`, "must be positive");
        if (!finite(motion.amplitude) && !nonEmpty(motion.amplitude)) add("MOTION_CONTINUOUS", `${motionAt}.amplitude`, "is required");
        if (!finite(motion.startSeconds) || motion.startSeconds < beat.startSeconds) add("MOTION_CONTINUOUS", `${motionAt}.startSeconds`, "must be inside beat");
        if (!finite(motion.endSeconds) || motion.endSeconds <= motion.startSeconds || motion.endSeconds > beat.endSeconds) {
          add("MOTION_CONTINUOUS", `${motionAt}.endSeconds`, "must be after start and inside beat");
        }
        if (!nonEmpty(motion.semanticReason)) add("MOTION_CONTINUOUS", `${motionAt}.semanticReason`, "is required");
        if (!nonEmpty(motion.deletionTest)) add("MOTION_CONTINUOUS", `${motionAt}.deletionTest`, "is required");
      }
    }

    const hold = beat.readableHold;
    if (!hold || typeof hold !== "object" || Array.isArray(hold)) {
      add("MOTION_READABLE_HOLD", `${at}.readableHold`, "is required");
    } else {
      if (!finite(hold.startSeconds) || hold.startSeconds < beat.startSeconds) add("MOTION_READABLE_HOLD", `${at}.readableHold.startSeconds`, "must be inside beat");
      if (!finite(hold.endSeconds) || hold.endSeconds <= hold.startSeconds || hold.endSeconds > beat.endSeconds) {
        add("MOTION_READABLE_HOLD", `${at}.readableHold.endSeconds`, "must be after start and inside beat");
      }
      if (!nonEmpty(hold.reason)) add("MOTION_READABLE_HOLD", `${at}.readableHold.reason`, "is required");
    }

    if (!nonEmpty(beat.deletionTest)) add("MOTION_DELETION_TEST", `${at}.deletionTest`, "is required");
    if (!Array.isArray(beat.rejectionConditions) || beat.rejectionConditions.length === 0 || beat.rejectionConditions.some((item) => !nonEmpty(item))) {
      add("MOTION_REJECTION", `${at}.rejectionConditions`, "must contain explicit non-empty rejection conditions");
    }
    if (!Array.isArray(beat.acceptanceFrames) || beat.acceptanceFrames.length === 0) {
      add("MOTION_ACCEPTANCE", `${at}.acceptanceFrames`, "must contain acceptance frames");
    } else {
      const roles = new Set();
      for (const [frameIndex, frame] of beat.acceptanceFrames.entries()) {
        const frameAt = `${at}.acceptanceFrames[${frameIndex}]`;
        if (!finite(frame.atSeconds) || frame.atSeconds < beat.startSeconds || frame.atSeconds >= beat.endSeconds) {
          add("MOTION_ACCEPTANCE", `${frameAt}.atSeconds`, "must be inside the beat's end-exclusive interval");
        }
        if (!nonEmpty(frame.role)) add("MOTION_ACCEPTANCE", `${frameAt}.role`, "is required");
        else roles.add(frame.role);
        if (!Array.isArray(frame.assertions) || frame.assertions.length === 0 || frame.assertions.some((item) => !nonEmpty(item))) {
          add("MOTION_ACCEPTANCE", `${frameAt}.assertions`, "must contain visible assertions");
        }
      }
      if (!roles.has("start")) add("MOTION_ACCEPTANCE", `${at}.acceptanceFrames`, 'must include role "start"');
      if (beat.mode === "motion" && !roles.has("state_complete")) add("MOTION_ACCEPTANCE", `${at}.acceptanceFrames`, 'motion beat must include role "state_complete"');
      if (beat.mode === "readable-hold" && !roles.has("readable_hold")) add("MOTION_ACCEPTANCE", `${at}.acceptanceFrames`, 'readable-hold beat must include role "readable_hold"');
      if (beat.handoff && !roles.has("transition_midpoint")) add("MOTION_ACCEPTANCE", `${at}.acceptanceFrames`, 'beat with handoff must include role "transition_midpoint"');
    }
  }

  if (timeline && finite(timeline.programDurationSeconds)) {
    const last = beats.at(-1);
    if (last && finite(last.endSeconds) && Math.abs(last.endSeconds - timeline.programDurationSeconds) > tolerance) {
      add("MOTION_BEAT_COVERAGE", "beats", "must cover continuously through timeline.programDurationSeconds");
    }
  }

  const knownIds = new Set(beats.map((beat) => beat?.beatId));
  for (const [index, beat] of beats.entries()) {
    if (!beat || typeof beat !== "object") continue;
    const at = `beats[${index}].handoff`;
    const final = index === beats.length - 1;
    if (final) {
      if (beat.handoff !== null) add("MOTION_HANDOFF", at, "must be null on final beat");
      continue;
    }
    if (!beat.handoff || typeof beat.handoff !== "object" || Array.isArray(beat.handoff)) {
      add("MOTION_HANDOFF", at, "is required before final beat");
      continue;
    }
    if (!knownIds.has(beat.handoff.toBeatId)) add("MOTION_HANDOFF", `${at}.toBeatId`, "must reference an existing beat");
    if (beat.handoff.toBeatId !== beats[index + 1]?.beatId) add("MOTION_HANDOFF", `${at}.toBeatId`, "must reference the next chronological beat");
    if (!nonEmpty(beat.handoff.object)) add("MOTION_HANDOFF", `${at}.object`, "is required");
    if (!finite(beat.handoff.midpointSeconds) || beat.handoff.midpointSeconds < beat.startSeconds || beat.handoff.midpointSeconds >= beat.endSeconds) {
      add("MOTION_HANDOFF", `${at}.midpointSeconds`, "must be inside source beat's end-exclusive interval");
    }
    if (!nonEmpty(beat.handoff.midpointAssertion)) add("MOTION_HANDOFF", `${at}.midpointAssertion`, "is required");
  }
}

if (errors.length > 0) {
  console.error(`Motion contract failed (${errors.length} issue${errors.length === 1 ? "" : "s"}):`);
  for (const error of errors) console.error(`- [${error.code}] ${error.location}: ${error.message}`);
  process.exit(1);
}

console.log(`PASS ${path.resolve(contractPath)} (${contract.pipeline}, ${contract.beats.length} beats, full 30fps timeline)`);
