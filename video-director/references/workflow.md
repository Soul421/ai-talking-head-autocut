# End-to-End Workflow

Use the smallest amount of process that still protects quality. A short,
straightforward video can move through these steps quickly; a data-heavy or
high-stakes video needs deeper research and verification.

## 1. Understand the outcome

Extract what the user already provided:

- purpose and desired viewer action;
- audience and platform;
- duration and aspect ratio;
- central message;
- available data and assets;
- visual feeling and references;
- delivery expectation.

Use `video-spec-builder` to close important creative gaps. Ask only one or two
high-value questions at a time. Do not make the user translate their idea into
technical vocabulary.

## 2. Build the research and asset plan

Identify every external dependency:

- factual claims and quotations;
- datasets and CSV files;
- logos, screenshots, photos, video, music, fonts, and sound effects;
- separate layer assets for paper-cut, collage, parallax, or depth scenes;
- reference videos used only for creative direction.

Classify each item as:

- already available locally;
- can be generated programmatically;
- must be researched or acquired;
- optional and removable.

For research and acquisition, prefer primary sources and legally reusable
assets. Use Browser when a visible webpage, logged-in session, or interactive
site is necessary. Use direct web research or official APIs when they are more
reliable and efficient.

Create:

- `research/source-ledger.md` from the bundled template;
- `assets/asset-manifest.json` from the bundled template;
- `assets/layer-manifest.json` when layered scene motion is central;
- `data/schema-report.md` when structured data drives the video.

## 3. Verify before writing the story

Follow `source-verification.md`.

Do not build a narrative around a surprising statistic before checking its
definition, time period, unit, and source methodology. Preserve raw data
unchanged, write transformations to a cleaned file, and document them.

If research changes the user's original premise, say so directly and rebuild
the story around what the evidence supports.

## 4. Write the creative specification

Use `video-spec-builder` to produce or update `video-spec.md`.

The spec should describe visible outcomes and scene intent. It may mention
technical implementations when useful, but the user's approval should be based
on what the audience will see and understand.

For data-driven videos, ensure each important chart or claim maps to an entry
in `source-ledger.md` and the relevant cleaned-data fields.

For Fan Huayu's own narration-led videos, obtain a ready
`video-handoff.json` from `fanhuayu-voice-studio` before creating a formal
timeline. Its approved WAV and BaoCut captions are the single audio-timebase;
do not substitute a draft take or silently fall back to MiniMax.

## 5. Select the renderer

Follow `renderer-routing.md` and write `render-plan.md`.

Choose one primary renderer. The render plan translates storyboard scenes into
renderer-specific components and records:

- decision and rationale;
- composition dimensions, fps, and duration;
- scene/component mapping;
- data and asset inputs;
- audio plan;
- review and final render commands;
- any mixed-renderer join points.

For Remotion-led paper-cut, collage, parallax, or depth-separated scenes, read
`remotion-layered-production.md` and add a layer inventory before coding. The
plan must show each layer's source, z-order, motion, edge policy, and
verification frame.

## 6. Produce a review render

Implement using the selected specialist skill:

- For Remotion, use its current enabled Skill if available. If absent, inspect the existing project and official Remotion documentation, then use its verified build/render commands. Do not invent a missing Skill or install a new dependency solely to satisfy this name; keep the existing renderer when it meets the request.
- HyperFrames: load `hyperframes` and `hyperframes-cli`.

Generate a low-cost review output first. Check representative stills and the
full timeline before spending time on the final render. Use
`scripts/review_evidence.py` to save exact-timestamp proof frames and a contact
sheet under `qa/`; choose timestamps that cover the opening, dense or important
scenes, layered-motion extremes, transitions, and ending.

## 7. Inspect, fix, and deliver

Follow `quality-gates.md`. Record results in `qa-report.md`.

Loop until the material checks pass. Then render the final output into
`output/`. Report remaining caveats honestly; do not call a render final when a
central claim, missing asset, or obvious visual defect remains unresolved.

After the last material code, asset, narration, or timing change, regenerate
the proof frames from the new review or final render. Evidence from an older
render does not satisfy the delivery gate.

## 8. Make surgical final edits

When an approved video needs only one or two small changes, create
`change-request.md` from the bundled template before editing.

- Preserve approved timing, scenes, and styling outside the requested scope.
- Change the smallest source artifact that owns the visible or audio result.
- Check adjacent scenes for duplicated text, carryover frames, or reused assets.
- Re-render affected scenes and rebuild from source; do not patch an old final
  MP4 when source scenes and assembly commands exist.
- Regenerate proof frames at the changed timestamps and scene joins, then probe
  the rebuilt final output.
