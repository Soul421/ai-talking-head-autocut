# Quality Gates

Use review-quality outputs while iterating. Render final quality only after
material issues are fixed.

## Evidence gate

- Every important on-screen number and factual claim maps to
  `research/source-ledger.md`.
- Estimates and uncertain claims are labeled appropriately.
- Data units, date ranges, ranking rules, and transformations match the visual.
- Every external asset maps to `assets/asset-manifest.json`.
- No unresolved rights issue affects the final output.

## Narrative gate

- The opening establishes a reason to keep watching.
- Each scene advances the story or communicates useful information.
- Key conclusions follow from the evidence.
- The CTA matches the video's purpose.
- Total duration and scene timing match the specification.

## Visual gate

- Inspect representative frames from the opening, key transitions, dense data
  scenes, and ending.
- Save the inspected exact-timestamp frames under `qa/proof-frames/` and create
  `qa/contact-sheet.png` so the reviewed evidence is reproducible.
- Check text overflow, clipping, unsafe margins, contrast, and readability.
- Check chart labels, ordering, colors, interpolation, and number formatting.
- Check logos and images for distortion or poor resolution.
- For layered scenes, check z-order, edge exposure, parallax depth, mask
  artifacts, and whether foreground motion blocks subtitles or faces.
- Confirm animation is deterministic and free of flicker.

For HyperFrames, run lint and visual inspect before rendering.
For Remotion, render representative stills and use Studio or a review render to
inspect timing and layout.

Generate reusable evidence with:

```bash
python3 ~/.codex/skills/video-director/scripts/review_evidence.py \
  output/review.mp4 \
  --time opening=00:00:01 \
  --time transition=00:00:08.5 \
  --time ending=00:00:19 \
  --output-dir qa/proof-frames \
  --contact-sheet qa/contact-sheet.png \
  --probe-output qa/media-probe.json
```

If exact timestamps are not yet known, omit `--time` to sample five evenly
spaced frames. Replace them with intentional timestamps before final delivery.

## Audio gate

- Narration is intelligible and synchronized.
- Music does not overpower speech.
- No accidental silence, clipping, abrupt cut, or mismatched duration.
- Captions match spoken words and remain readable.

## Delivery gate

- Dimensions, aspect ratio, fps, codec, and duration match the request.
- A review render was inspected after the last material code or asset change.
- Proof frames and the contact sheet come from that reviewed render, not an
  older output.
- The final file opens and plays successfully.
- `qa-report.md` records checks, fixes, remaining caveats, and final status.
