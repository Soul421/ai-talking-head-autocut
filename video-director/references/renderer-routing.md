# Renderer Routing

Choose based on the dominant production need, not familiarity.

## Choose Remotion when

- CSV, JSON, or API data drives the visuals.
- The video needs ranking changes, animated charts, maps, or repeated numeric
  updates.
- The composition should be reusable with different inputs.
- React components and explicit frame-based control make the logic clearer.
- The project needs parameterized or batch-rendered variants.
- Illustrated, paper-cut, collage, or parallax scenes need separately owned
  layers with precise frame-level motion and reuse across videos.

Typical examples: bar-chart races, market dashboards, annual reports, product
metric explainers, automated personalized videos, reusable layered explainer
templates.

## Choose HyperFrames when

- The video is primarily motion design, typography, captions, transitions, or
  media layering.
- It needs fast HTML/CSS/GSAP visual composition.
- TTS, transcription, caption timing, shader transitions, or audio-reactive
  effects are central.
- Existing video, images, and audio carry most of the story.

Typical examples: brand promos, cinematic explainers, caption-heavy social
videos, product trailers, visual essays.

## Use both only when

- the video contains clearly separable segments;
- each segment strongly benefits from a different renderer;
- both can render with identical dimensions, fps, color handling, and audio
  expectations;
- the added join and QA work is justified.

Prefer rendering a Remotion data segment with transparency or a clean
background, then compositing it into a HyperFrames-led video, or render full
segments and combine them with FFmpeg. Do not alternate renderers scene by
scene without a strong reason.

## Decision score

Use this quick score when the choice is unclear:

| Signal | Remotion | HyperFrames |
|---|---:|---:|
| Structured data is central | +3 | 0 |
| Reusable or parameterized template | +3 | 0 |
| Complex chart/ranking logic | +3 | 0 |
| Explicit multi-layer scene motion | +2 | +1 |
| Existing media is central | 0 | +2 |
| Captions/TTS/transcription central | +1 | +3 |
| Typography and transitions central | +1 | +3 |
| Audio-reactive or shader effects central | 0 | +3 |

Choose the higher score. If the scores are close, prefer the renderer already
used by the project. Record the result in `render-plan.md`.
