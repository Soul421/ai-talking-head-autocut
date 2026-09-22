# Runtime adaptation contract

Use this reference after a project is `READY_FOR_EXECUTION` and before authoring `compositions/content.html`.

The source `inputs/motion-contract.json` remains the semantic authority. The adapter does not translate it in place. It writes a separate `runtime-adaptation.json` that explains how each locked beat, acceptance timestamp, and handoff becomes a HyperFrames state, snapshot, or scene transition.

## Authority and stop order

1. Locked source files and their manifest hashes.
2. Source motion contract, with `pipeline` equal to `remotion` or `hyperframes`.
3. Root `DESIGN.md` and its hash.
4. This project-specific runtime adapter.
5. Active HyperFrames core, animation, GSAP, and transition contracts.

Stop before composition code when any authority is missing, contradictory, or hash-mismatched. Never repair a source contract by silently rewriting it. Send semantic omissions upstream; send scaffold/path/hash problems to `talking-head-hyperframes`.

Run the source gate first:

```bash
npm run check:motion-contract
```

The gate preserves the existing platform-neutral contract:

- version 1 and 30fps;
- program/audio/caption duration relationship;
- five locked source SHA-256 values;
- exactly the six Anti-PPT hard rejections;
- continuous, non-overlapping full-program beat coverage and unique beat ids;
- named state A→B and new understanding;
- one semantic primary motion and at most one support motion;
- no primary/support motion on a readable hold;
- structured foreground continuous-motion proof;
- readable hold, deletion test, rejection conditions, acceptance roles, and anchored chronological handoff.

The legacy fixed-background name `PremiumGridBackground` may remain in a Remotion-source contract. A native source may use `studio-background`. This compatibility is only a source-reading alias; the HyperFrames runtime adapter always names the fixed mount `studio-background` and never edits the source bytes.

## Adapter file

Create `runtime-adaptation.json` beside the root production contracts. It has these top-level sections:

| Section | Purpose |
| --- | --- |
| `sourceContract` | Relative path, actual SHA-256, source pipeline, and `preservedVerbatim: true` |
| `design` | Root `DESIGN.md` path and actual SHA-256 |
| `runtime` | Composition id, synchronous paused registered master timeline, visibility policy, and media ownership |
| `fixedBoundary` | Content-owned surfaces and protected factory-owned surfaces |
| `continuousMotionPolicy` | Fixed-background default and contract-proved exceptions |
| `scenes` | Actual HyperFrames scenes, per-scene entrance, and semantic transition |
| `beatMappings` | Exactly one scene state or readable hold for every source beat |
| `handoffMappings` | State continuity or anchored scene transition for every source handoff |
| `acceptanceMappings` | Exactly one snapshot assertion for every source acceptance timestamp |
| `derivedContracts` | Source/DESIGN hashes and the structured production artifacts |

The canonical examples live in `evals/fixtures/contracts/`.

## Beats are not scenes

A source beat describes a semantic state interval. A HyperFrames scene describes a visual environment with one entrance lifecycle. Therefore:

- The first beat assigned to a scene sets `entersScene: true`.
- Later consecutive beats in that same scene set `entersScene: false` and never replay the entrance.
- A `motion` beat maps to `kind: "scene-state"` and traces the exact source primary/support ids.
- A `readable-hold` maps to `kind: "readable-hold"`, keeps primary/support/continuous motion empty, preserves the source hold interval, and sets `static: true`.
- Scene `beatIds` must be chronological, consecutive, and exactly equal the corresponding ordered `beatMappings`.

Do not create a new scene just to satisfy a beat boundary. Create one only when the visual world, evidence state, spatial relationship, or narrative section truly changes.

## Scene entrances and transitions

Every actual scene has one authored `entrance`:

- semantic id and reason;
- scene-specific selectors;
- explicit visual properties and start/end times;
- `sharedHelper: false`.

Every GSAP tween target in the authored composition must be an explicit selector string. Variable, computed, node, or unresolved targets fail closed because the validator cannot prove their property overlap, scene ownership, or readable-hold behavior. Render-critical CSS `animation`/`@keyframes` is also forbidden—even when finite—because it is outside the paused seekable master timeline and can move during a readable hold. A registered but empty timeline, or placeholder IDs without an actual entrance tween for each scene, is not an implementation.

Entrances cannot be a shared `enterStyle`, a universal helper, or the same `opacity+y` signature repeated across scenes. A transition may use a recurring project language, but its object, anchors, midpoint, and state change remain scene-specific.

Every non-final scene has `transitionOut` with:

- transition id, kind, semantic reason, and next scene id;
- start, end, and inspectable midpoint timestamps;
- `midpointReadable: true`;
- `emptyReset: false`;
- `outgoingPreFade: false`;
- visible start/end anchors and explicit properties.

The outgoing scene remains readable until the semantic transition begins. The transition is its exit. Only the final scene may perform a restrained end-of-program exit.

Use the active HyperFrames transition overview, catalog, and only the selected transition category. Keep the catalog's lifecycle order: position incoming scene, animate the outgoing/incoming handoff together, swap, then clean temporary overlays. Do not insert a fade-to-empty reset.

## Acceptance and handoff trace

For every source acceptance frame, write one `acceptanceMappings` item whose key is:

```text
<beatId>@<sourceAtSeconds>#<sourceRole>
```

It records a unique snapshot id, a path under `snapshots/acceptance/`, and the source assertions without paraphrasing. Missing, duplicate, extra, or changed assertions fail validation.

For every non-final source handoff:

- same scene → `type: "state-continuity"`;
- new scene → `type: "scene-transition"` and the scene transition id;
- preserve the source object, midpoint time, and midpoint assertion;
- declare `anchored: true`, `startAnchor`, and `endAnchor`.

A line, rail, scan, arc, glow, or decoration without both visible anchors and a job is not a handoff.

## Continuous motion policy

The default runtime allowlist is exactly:

```json
{ "defaultAllowlist": ["studio-background"], "contractOverrides": [] }
```

Captions, PIP, cards, titles, code, icons, evidence, connectors, decorative marks, and glows remain still by default. This is a project-specific override of any generic HyperFrames ambient-motion house style.

An exception must trace one source beat `continuousMotions` entry and preserve its object, bounded start/end, period, amplitude, semantic reason, and deletion test. It still uses a finite lifecycle. `repeat: -1`, CSS `infinite`, or a loop that survives the declared beat is always invalid.

## Runtime rules

Each composition constructs exactly one GSAP master timeline:

```js
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({
  paused: true,
  defaults: { duration: 0.6, ease: "power2.out" },
});
tl.addLabel("evidence", 0);
// Per-scene authored choreography with explicit positions.
window.__timelines["content"] = tl;
```

The timeline is created synchronously at page load. Its registry key exactly matches the root `data-composition-id`. HyperFrames seeks it; do not call `play()`.

Reject:

- `Math.random`, `Date.now`, `performance.now`;
- async functions, `await`, Promise construction, timers, or event-driven timeline construction;
- manual `video.play()`, `video.pause()`, or `currentTime` mutation;
- unregistered or unpaused timelines;
- `repeat: -1` or CSS infinite animation;
- two overlapping tweens/timelines targeting the same property on the same element;
- visual animation directly targeting timed `<video>`/`<audio>` elements;
- render-critical network state.

Voice and timed video playback belong to HyperFrames. Visual PIP/person motion targets a non-timed wrapper. Media volume may remain framework/timeline controlled when the production contract calls for a bounded mix cue.

## Visibility conflict resolution

This adapter intentionally adopts a stricter policy than generic GSAP guidance:

- Do not animate `display`, raw `visibility`, or `autoAlpha`.
- Use `opacity`, `clipPath`, or transform aliases on content inside a clip.
- Let HyperFrames own `.clip` and timed-composition lifecycle.
- Do not use page-load visibility sets for future clips.

Generic GSAP references recommend `autoAlpha`; HyperFrames core permits it only in narrow non-clip cases. This talking-head pipeline bans it entirely so fixed mounts, sub-composition lifecycle, and independent seeking cannot diverge.

## Fixed ownership boundary

The executor may write:

- `compositions/content.html` and `compositions/scenes/**`;
- `runtime-adaptation.json` and derived production contracts;
- content-specific images, generated assets, music, and SFX;
- acceptance/transition snapshots, executor reports, and internal previews.

The executor must not modify:

- root `DESIGN.md`;
- `manifest.json`, `inputs/**`, or their locked source bytes;
- root `index.html`, fixed mounts, or `styles.css`;
- `compositions/studio-background.html`;
- `compositions/caption-overlay.html`;
- `compositions/pip-overlay.html`;
- locked talking-head video/final voice assets or framework media ownership.

If a fixed surface is wrong, stop and return it to the factory. Do not patch around the guard inside content scenes.

## Derived production contracts

Set `derivedContracts.choreographyComplexity` to `simple` or `complex` and record the exact source-contract and DESIGN hashes. Complex choreography requires all five artifacts:

- `STORYBOARD.md`;
- `SCENE_SCHEMA.json`;
- `VECTOR_TEMPLATES.json`;
- `MOTION_PRIMITIVES.json`;
- `MOTION_MAP.json`.

They are derived, not new direction. Each must remain traceable to locked source beats and DESIGN tokens. They may select approved scene/vector/motion vocabulary but cannot change the source state change, cue, hold, handoff, rejection, or acceptance assertion.

## Validation

Before HTML:

```bash
npm run check:runtime-map
```

After HTML:

```bash
npm run check:runtime-adaptation
```

The HTML pass resolves numeric positions and declared GSAP labels (including `label+=offset` / `label-=offset`), fails closed on unresolved tween timing, and emits line-addressed diagnostics for missing mapped scenes/selectors/anchors, motion intersecting a readable-hold interval, determinism, timeline registration, visibility, media ownership, property conflicts, pre-fades, generic entrances, crossfade/enterStyle helpers, decorative loops, unanchored decoration, generic AI imagery, empty resets, and unreadable midpoints. It reads `DESIGN.md` and rejects a digest that merely has the right shape but does not match the file bytes.

Run the adapter regression suite after changing the schema or validator:

```bash
node <skill-directory>/scripts/test_contract_adapter.mjs
```
