# Locked Input and Handoff Contract

## Factory command

```bash
node scripts/scaffold_talking_head_hyperframes_project.mjs \
  --project-dir /absolute/path/to/project \
  --title "Project title" \
  --audio /absolute/path/to/voice.wav \
  --captions /absolute/path/to/captions_aligned.json \
  --captions /absolute/path/to/captions.srt \
  --director-script /absolute/path/to/视频脚本.md \
  --production-spec /absolute/path/to/制作规格.md \
  --asset-plan /absolute/path/to/素材计划.md \
  --motion-contract /absolute/path/to/motion-contract.json
```

`--script` is a compatibility alias for `--director-script`. `--captions`, `--screen-recording`, `--screenshot`, and `--font` are repeatable. Captions accept at most one JSON, one SRT, and one VTT file. Optional PIP inputs are `--talking-head` and `--show-pip-placeholder`. `--pip-object-x <0..100>` and `--pip-object-y <0..100>` override the source positioning recorded in the fixed-stage PIP contract. The Bozhou Digital Twin v1 defaults are `66.7` and `50`; any override must be preserved by `--force` repair and reviewed under [pip-contract.md](pip-contract.md).

The scaffold refuses a non-empty target unless `--force` is explicit. Read [project-layout.md](project-layout.md) before using force on a project that already contains downstream work.

## Manifest records

Every archived input record contains:

- `sourcePath`: absolute source path at ingestion time;
- `path`: project-relative archive path;
- `sha256`: SHA-256 of the archived bytes;
- `bytes`: archived file size;
- `durationSeconds`: ffprobe duration for audio and video.

The manifest also records the root `DESIGN.md` hash and size, fixed-stage version, program duration, readiness status, validation evidence, actionable `missingInputs`, and `nextSkill`. The original motion contract is copied byte-for-byte. Its `pipeline` may be `remotion` (legacy semantic source) or `hyperframes` and is preserved in the manifest.

## READY gate

`READY_FOR_EXECUTION` requires all of the following:

- decodable locked voice audio with a positive duration;
- non-empty aligned JSON captions whose entries have valid `start`, `end`, and `text` or valid `parts`;
- caption overlap no greater than 0.05 seconds;
- captions ending no more than 0.5 seconds after audio and no more than 3 seconds before audio;
- provided director script and production specification, which count as the confirmed approval artifacts;
- an asset plan;
- motion contract version 1 at 30fps with a positive timeline, all required source hashes, all six hard rejections, and beats continuously covering the program duration;
- exact SHA-256 agreement between the contract and director script, production specification, asset plan, audio, and aligned captions.

Invalid provided material is a preflight error. Missing material produces an honest `TEMPLATE_ONLY` project with one `missingInputs` object per prerequisite. Only a valid READY project routes `nextSkill` to `hyperframes-scene-animator`.

## Caption overlay

Aligned JSON is the executable caption source; SRT and VTT are archived variants. The generated overlay is synchronous and deterministic. Each caption group has `data-start`, a clipped non-overlapping `data-duration`, and the same track index. The framework owns clip visibility and unloading, while the registered paused timeline hard-kills the group's untimed text child at the source group's end. There are no timers, promises, manual media calls, or multiple visible groups.

## Independent validation

From the skill root:

```bash
node scripts/validate_inputs.mjs /absolute/path/to/project
node scripts/validate_fixed_stage.mjs /absolute/path/to/project
```

From the generated project:

```bash
npm run check:inputs
npm run check:fixed-stage
npm run check:template
```

The project-local scripts are the human/agent shared gate; no hidden validator or legacy Remotion runtime is required.
