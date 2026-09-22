# Generated Project Layout

The factory creates a normal HyperFrames project. It does not create `src/`, `public/`, `work/`, or another Remotion-shaped compatibility tree.

```text
project/
  .npmrc                       # exact ignore-scripts=true; suppresses npm pre/post hooks
  DESIGN.md
  caption-overrides.json            # HyperFrames caption-editor runtime state; initially []
  index.html
  styles.css
  package.json
  hyperframes.json
  meta.json
  manifest.json
  compositions/
    studio-background.html
    content.html
    caption-overlay.html
    pip-overlay.html
    scenes/                       # downstream-owned; not created by the factory
  assets/
    audio/voice/voice.<ext>
    video/talking-head/talking-head.<ext>
    video/screen-recordings/screen-01.<ext>
    images/screenshots/screenshot-01.<ext>
    fonts/custom-01.<ext>
  inputs/
    视频脚本.md
    制作规格.md
    素材计划.md
    motion-contract.json
    captions/
      captions_aligned.json
      captions.srt
      captions.vtt
  scripts/
    check-inputs.mjs
    check-fixed-stage.mjs
    validate-motion-contract.mjs
    validate-runtime-adaptation.mjs
    validate-project-proof.mjs
    proof-stage.mjs
    proof-gate.mjs
    proof-prepare.mjs
    proof-lock.mjs
    proof-bind-review.mjs
    proof-approve.mjs
    promote-preview.mjs
    build-animation-map.mjs
    build-pip-review.mjs
    build-contact-sheet.mjs
    analyze-preview.mjs
  proof/
    goldens/
      narrow-center-grid-t000.png
      narrow-center-grid-t004.png
      narrow-center-grid-t009.png
  review/
    template-handoff.md
    execution-lock.json            # created on first executor takeover
    proof-manifest-v1.json
    approval-receipt-v1.json       # created only by explicit proof:approve
    executor-report-v1.md
    lead-review-v1.md
    pip/                         # generated actual-encode full frame, 3x crop, and review receipt
```

Only files backed by a real source are created under `inputs/` and the optional media directories. A bare scaffold does not create fake audio, captions, documents, scenes, or execution contracts.

## Fixed and downstream ownership

The factory owns `.npmrc`, `DESIGN.md`, the root composition, styles/configuration, `studio-background.html`, `caption-overlay.html`, `pip-overlay.html`, the project-local validator/proof programs, stage goldens, `manifest.json`, and `review/template-handoff.md`. `.npmrc` contains only `ignore-scripts=true`, so explicit public scripts run without project-controlled pre/post lifecycle hooks. It installs review skeletons once but does not overwrite populated downstream review files during repair.

The scene executor owns `content.html`, `compositions/scenes/`, derived scene contracts, generated assets, renders, snapshots beyond fixed-stage proof, and execution review artifacts. On an existing project, `--force` replaces only factory-owned fixed files. It preserves the existing `content.html`, `compositions/scenes/`, assets, renders, and execution outputs. If a supplied locked input would overwrite a different existing project asset, the factory refuses the collision.

## Duration and conditional mounts

Duration is selected in this order:

1. `motion-contract.json` `timeline.programDurationSeconds`;
2. explicit `--duration`;
3. locked voice duration, otherwise talking-head video duration, plus a 1.2 second tail;
4. 18 seconds.

The selected duration is written to the root, every factory-created subcomposition, the background timeline, `meta.json`, and `manifest.json`. On `--force`, an existing downstream-owned `content.html` is preserved byte-for-byte; the root content mount still receives the selected program duration.

Voice is mounted only when `--audio` exists. PIP is mounted only for `--talking-head` or `--show-pip-placeholder`. The fixed PIP subcomposition draws only the frame. Talking-head video is mounted at the root inside a non-timed `190×190px` media wrapper below that frame, is `muted playsinline`, and is controlled by HyperFrames through its own `data-start`, `data-duration`, and `clip` attributes. The manifest always carries the PIP geometry/background contract and, when media exists, the actual `object-position` values. See [pip-contract.md](pip-contract.md).

## Reproducible checks

Every generated project exposes:

```bash
npm run check:inputs
npm run check:fixed-stage
npm run check:template
npm run check:stage-parity
```

`check:template` runs the two project-local gates and then the pinned HyperFrames check. `check:stage-parity` verifies the project background against hash-locked 0/4/9s goldens at SSIM ≥ 0.995. Executor gates are also public through `check:motion-contract`, `check:runtime-map`, `check:runtime-adaptation`, `proof:generate`, `proof:bind-review`, `proof:approve -- <reviewer> <proof-version>`, and `proof:finalize`. `proof:prepare` derives the acceptance/cue/transition/hold evidence inventory from `runtime-adaptation.json`; approval writes `review/approval-receipt-v1.json`. Every command that invokes HyperFrames uses exact CLI version `0.7.65`; local Node checks do not invoke the CLI.

For mounted PIP, run `npm run review:pip -- renders/internal-preview-v1.mp4 [seconds]`. It writes the fixed full frame, 3× PIP crop, and a review receipt under `review/pip/`. Proof validation requires the receipt to be explicitly changed to `PASS` with both visual acceptance fields true; a generic representative frame cannot satisfy the PIP gate.
