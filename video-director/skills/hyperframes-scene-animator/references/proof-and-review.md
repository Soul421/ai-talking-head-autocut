# Proof, review, and preview-v1 contract

Use this reference after runtime adaptation and content HTML pass their gates. Proof is a reproducible project artifact, not a claim in chat.

## Required order

Run only the generated project's public package scripts. Every HyperFrames command must begin with the exact verified pin `npx --yes hyperframes@0.7.65`.

1. Run `npm run proof:lock -- <stable-executor-id>` once at takeover. The immutable lock records the original executor, source-contract hash, DESIGN hash, and takeover fingerprint.
2. `npm run proof:generate` (also exposed as `proof:all`) starts with `proof:prepare`, which removes stale receipts and previews, invalidates old approval, and derives the objective evidence inventory from `runtime-adaptation.json` so a fresh arbitrary-path scaffold can complete the public chain.
3. Project-local gate runners execute `check:inputs`, fixed-stage, motion-contract, runtime-adaptation, 0/4/9s stage parity, doctor, lint, validate, inspect, check, snapshots, animation-map, and internal render. Every gate writes a JSON receipt containing the exact argv, CLI pin, exit code, timestamps, current project fingerprint, log path, and log SHA-256.
4. `proof:snapshots` captures every source acceptance mapping, including all cue-before/cue-after states. `proof:animation-map` records actual registered timeline tweens, dead zones, flags, and explanations.
5. `proof:render-internal` creates `renders/internal-preview-v1.mp4` with draft quality only. `proof:contact-sheet` builds the ordered 1920×1080 montage; `proof:media` records ffprobe, full decode, first/last audio regions, black-tail, and silent-tail evidence.
6. The same executor writes `review/executor-report-vN.md`; the lead writes `review/lead-review-vN.md` and the four-pass result. Human/lead approval remains an explicit decision; generation never grants it.
7. Run `npm run proof:bind-review`. It binds executor, reports, four passes, findings/rechecks, and the SHA-256/byte length of every referenced human-review file to the current proof version, project fingerprint, execution-lock digest, and internal-preview SHA-256.
8. The explicit approver runs `npm run proof:approve -- <reviewer> <proof-version>`. This validates the review decision, writes a separately hashed approval receipt, and advances lifecycle to `REVIEW_APPROVED`; generation and binding never grant approval.
9. Run `npm run proof:finalize`. Promotion preflight rejects stale files or assets, failed/fabricated logs, altered review bytes/decision fields, unbound approval, changed preview bytes, or unresolved findings. Promotion uses a durable recovery marker for the preview and manifest transaction, then runs the final bundle validator.

Do not run formal-release encoding in this skill. Record its later target as deferred: 1920x1080, 30fps, H.264 High, yuv420p, 12 Mbps, slow two-pass.

## Evidence inventory

`review/proof-manifest-vN.json` must point to existing non-empty files for:

- every source acceptance frame and every cue-before/cue-after pair;
- representative chapter and density states;
- the widest caption at a visible active timestamp;
- PIP crop, or a real manifest/report proving `NOT_APPLICABLE` when PIP is absent;
- first and last locked-audio regions;
- every actual scene-transition midpoint;
- every source `readable-hold`;
- the animation map and explanations for every flag;
- the ordered contact sheet;
- the complete internal preview;
- black-tail and silent-tail analysis with reproducible FFmpeg commands;
- executor report, lead review, and approved preview-v1.

Reports use only `PASS`, `FAIL`, or `NOT_APPLICABLE` for proof items. `NOT_APPLICABLE` still points to evidence that proves why the role is absent. A subjective visual result is closed by a review record plus the visible artifact; do not pretend a script can prove taste.

The validator must reject missing/tampered gate receipts, project or locked-input drift, symlink/traversal evidence, altered stage goldens/candidates, missing roles, illegal statuses, incomplete source mapping, unreviewed animation flags, or a preview that is undecodable, empty, not 1920x1080, not 30fps, the wrong duration, missing locked voice, or byte-different from the reviewed internal preview.

## Four passes

### Montage

Look only at the ordered contact sheet and do not read captions. Judge whether attention, information density, and state progression form one visual world rather than a stack of slides. A prose report cannot substitute for the contact sheet.

### Static

Inspect the full-resolution acceptance images for composition, typography, real evidence/UI hierarchy, safe areas, active captions, and PIP crop when present. Verify cue-before does not leak the later concept and cue-after establishes it.

### Motion

Watch the complete `internal-preview-vN.mp4` from start to finish. Confirm state changes, still readable holds, anchored handoffs, readable transition midpoints, rhythm, easing, audio sync, and the final hold. Static frames cannot substitute for this pass; record the watched artifact and full-decode evidence.

### Delivery

Confirm pinned checks, assets, dimensions, fps, duration, voice stream, tail relationship, complete decode, black/silent tail analysis, report paths, and output paths. Draft preview quality is correct here; release encoding is still deferred.

## Anti-PPT / AI-tell hard gate

Reject any repeated generic entrance, same-shape relabeling, ambient foreground float/breathe/glow, unanchored connector, generic AI filler, empty reset, or unreadable transition midpoint. The visible contact sheet, acceptance frame, animation map, or full preview must show the basis for each decision.

## Findings, revision, and promotion

Lead findings use only `BLOCKER`, `MAJOR`, or `MINOR`. Every finding records status (`OPEN` or `CLOSED`), evidence, required fix, original executor lock, recheck status/evidence, and proof version. `CLOSED` requires a current bound `PASS` recheck; `FAIL` and `NOT_APPLICABLE` cannot close a finding. All revisions return to the original executor. Rerun only affected proof, but update its version and recheck path.

Any open BLOCKER or MAJOR blocks preview-v1. An open MINOR with `blocksPreview: true` also blocks it when the first impression is materially harmed. A `renders/preview-v1.mp4` that appears before explicit approval and a clear promotion preflight is itself a proof failure.

Reusable report skeletons live under `assets/review-templates/`. The representative authored fixture under `evals/fixtures/ready-project/` demonstrates the complete public command chain and proof schema.
