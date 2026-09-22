# Remotion Layered Production

Use this when a video should feel like layered paper cut, collage, parallax,
scrolling illustration, depth-separated scene, or reusable animated artwork.
Do not treat a single finished image as enough source material unless the user
only wants a flat Ken Burns move.

## When This Applies

- The scene needs background, architecture, characters, props, foreground, text,
  and atmosphere to move at different speeds.
- The same visual language will be reused across multiple videos.
- The layer timing, camera drift, or parallax should be controlled precisely.
- The scene is easier to reason about as React components and frame-based
  motion than as one-off timeline edits.

If the project already uses HyperFrames and only needs simple media layering,
keep HyperFrames. Switch to Remotion only when explicit layer ownership,
parameterized reuse, or frame-level motion control is the main value.

## Required Layer Plan

For every layered scene, record a layer inventory in `render-plan.md` or
`assets/layer-manifest.json`:

| Field | Meaning |
|---|---|
| `layer_id` | Stable readable ID, such as `bg_sky`, `mid_palace`, `fg_lantern` |
| `source` | Local path, generated asset prompt, or acquisition source |
| `rights_status` | `owned`, `generated`, `licensed`, `needs_review`, or `blocked` |
| `role` | background, midground, character, foreground, text, atmosphere |
| `z_index` | Front-to-back order |
| `anchor` | Main screen position and safe-area intent |
| `motion` | Pan, drift, scale, reveal, bob, opacity, or hold |
| `edge_policy` | How blank edges are avoided during motion |
| `verification` | Timestamp or still-frame check that proves it works |

## Asset Rules

- Prefer separate transparent PNG/WebP layers, SVG layers, or programmatic
  shapes over a single flattened illustration.
- When generating assets, ask for separable layers and consistent camera,
  lighting, palette, and perspective across every layer.
- For Codex + Remotion work, do not start from "make a nice video" or a single
  finished hero image. First lock the audio/script timeline, then produce a
  layer packet per scene: background, architecture/large props, main character,
  supporting character, foreground occluders, text, and atmosphere. A scene is
  ready for Remotion only when every layer has an owner, z-order, motion role,
  and edge policy.
- For paper-cut, scroll, historical, collage, or illustrated explainers, ask
  image generation for independent assets rather than one flattened picture:
  same aspect ratio, same camera angle, same lighting, transparent background
  for character/prop layers where possible, and extra bleed around backgrounds
  so camera drift does not reveal blank edges.
- Treat sound as part of the motion contract. If the video has narration,
  captions, music, or sound effects, record the beat each layer supports before
  animating it; a moving layer with no narrative or audio reason is decorative
  debt.
- Keep the original generation prompt or acquisition URL in
  `assets/asset-manifest.json`.
- If extracting layers from a flattened image, mark the artifact risk and
  inspect edges during motion before final render.
- Never invent rights status. Block final delivery when a central visual asset
  remains `needs_review` or `blocked`.

## Remotion Implementation Notes

- Use reusable components for repeated layer behaviors rather than duplicating
  animation logic.
- Use sequences or frame offsets to reveal groups of layers at intentional
  narrative moments.
- Use props or JSON input when the same template will be reused with new
  images, text, timing, or scene order.
- Record the component/composition mapping in `render-plan.md`; do not bury
  the mapping only in source files.
- Inspect the local project first. Install or invoke Remotion Skills only when
  the project actually uses Remotion and the user has not asked for a
  local-only/no-install path.

## QA Checks

- Opening frame shows the full intended composition without uninitialized
  assets.
- Parallax or camera drift never exposes blank edges.
- Foreground layers do not cover important faces, captions, logos, or CTA text.
- Layer movement supports the narrative beat; no scene is just decorative
  motion.
- Audio, subtitles, and visible motion agree on timing; reject renders that are
  visually acceptable but feel like silent PPT pages with voice pasted on top.
- Key frames prove the layer stack at the start, densest moment, transition,
  and ending.
