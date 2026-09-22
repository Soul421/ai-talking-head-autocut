# Studio Warm-White Fixed Stage

This file is the visual source of truth for the reusable talking-head stage. It must exist and be approved before `compositions/content.html` or any scene composition is authored. Fixed-stage code and downstream scene code must preserve these values exactly.

## Canvas and delivery

- Composition: `1920×1080` at `30fps`.
- Fixed-stage scaffold duration: 18 seconds. Input ingestion replaces this with the verified source duration.
- Formal release target: H.264 High Profile, `yuv420p`, 11–12 Mbps with a 12 Mbps target; prefer slow-preset two-pass allocation.

## Exact palette

| Role | Value |
|---|---|
| Canvas | `#f7f8f3` |
| Ink | `#151922` |
| Muted | `#747982` |
| Weak | `#b6bbb5` |
| Accent blue | `#2f6fff` |
| Warm gold | `#f6c466` |
| Claude accent | `#c26a35` |
| Fine line | `rgba(28,38,54,0.10)` |
| Strong line | `rgba(28,38,54,0.14)` |
| Glass | `rgba(255,255,255,0.74)` |
| PIP inner | `rgba(255,255,255,0.92)` |
| PIP mask | `#dcdce2` |
| PIP media base | `#f2f6f8` |
| PIP media blue overlay | `rgba(47,111,255,0.30)` |
| PIP placeholder | `#a9a9a3` |

The background additionally uses the source-locked values `#fbfcf8`, `#f2f6f8`, `#fbfaf4`, `rgba(37,50,72,0.30)`, `rgba(44,58,78,0.16)`, `rgba(47,111,255,0.30)`, and `rgba(235,178,82,0.22)`. These are fixed-background implementation colors, not a downstream scene palette extension.

## Typography identity exception

- Chinese and general UI copy: `"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`.
- English and numeric metadata: `"Space Grotesk", "SFMono-Regular", "Menlo", "Consolas", monospace`.
- Noto Sans SC is a deliberate 1:1 reference-matching identity exception to the generic-font rejection list. Do not substitute it in this project.
- The scaffold bundles reference-matching Noto Sans SC 400/500/700 and Space Grotesk 400 TTF files under `assets/fonts/`; OS faces remain explicit local fallbacks.

## Safe areas and overlays

- Content safe area: `196px 120px 196px` (top, horizontal, bottom).
- Caption: one line, centered, transparent, bottom 96px, maximum width 1680px, ink `#151922`; accent parts use `#2f6fff` at weight 700.
- PIP frame: stable 206px circle at `x=1610, y=724` (`right:104px; bottom:150px`), z-index 90; outer ring `1.5px solid rgba(20,82,255,0.55)`.
- PIP media: stable 190px circle at `x=1618, y=732` (`right:112px; bottom:158px`), z-index 89. The frame composition stays transparent over real media.
- Bozhou Digital Twin v1 crop: `object-fit: cover; object-position: 66.7% 50%`. For a 1920×1080 source this exposes `x=560..1640, y=0..1080`, cropping 29.17% from the left and 14.58% from the right.
- PIP media background: an opaque `#f2f6f8` base plus the approved pale-blue-gray radial/linear overlays. Semi-transparent gradients may not exist without that opaque base.
- Subject safety: face center x 48–52%, hair top y 25–32%, eye line y 45–52%, chin y 68–76%, shoulder width at the bottom 70–90% of the 190px media region.

## Fixed layers

The unconditional root topology is **background / content / caption**. PIP and voice are conditional: the root mounts PIP only when a talking-head video or explicit placeholder is supplied, and mounts voice only when verified final voice audio exists. The empty scaffold mounts neither.

- Background: native SVG/CSS/GSAP implementation of the locked mirrored perspective grid, wash, horizon, glow, and grain. The original top and bottom plane heights remain unchanged, while their vertical center strips must retain visible grid lines. Only a small, low-opacity radial highlight may soften the exact canvas center.
- Content: transparent, visually empty composition owned downstream.
- Caption: transparent overlay, visually empty while no caption is active.
- PIP: optional stable overlay. The real video belongs to the non-timed root media wrapper below the transparent frame, is muted and `playsinline`, and uses the crop values recorded in `manifest.fixedStage.pipContract`.
- Voice: optional audio clip controlled by HyperFrames.

## Motion whitelist

The fixed background is the only default continuous motion. It may advance the exact 34 px/s row drift, ambient wash coordinates, horizon/grid glow, and deterministic grain offsets. Captions, PIP, content, cards, titles, code, icons, evidence, and decorative marks remain still unless a locked motion contract assigns a semantic state change. All timelines are synchronous, paused, deterministic, seekable, and registered in `window.__timelines`.

## Forbidden

- No TopBar, navigation, Claude card, demo scene, preview shell, or project content in the fixed template.
- No universal entrance helper, `enterStyle`, global crossfade, automatic scene choreography, or foreground loop.
- No broad or full-height center veil, empty vertical center strip, old flat grid, full-width row shortcut, `nearY=1078`, shared top/bottom column direction, pre-rendered background video, or raster background replacement.
- No `Math.random()`, `Date.now()`, async timeline construction, `setTimeout`, infinite repeat, or manual media play/pause/seek.
- No caption pill, panel, blur, background, forced wrap, or second line.
- No transparent-only real-media PIP background, implicit `50% 50%` crop, unrecorded crop override, frame mask covering the media layer, or stage grid visible inside the PIP circle.

## Ownership

- **Fixed-stage owner:** template factory. It owns this file, root topology, `studio-background.html`, `caption-overlay.html`, `pip-overlay.html`, fixed constants, structure guards, and template-only proof.
- **Scene executor owner:** scene executor. It owns `content.html` and later scene sub-compositions after a READY_FOR_EXECUTION handoff, but must not mutate fixed mounts or fixed-stage files.
