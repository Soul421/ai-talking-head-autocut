# Studio 暖白固定舞台视觉契约

## 权威与边界

生成项目的 root `DESIGN.md` 是视觉真值。本文仅说明固定舞台实现与验证方式，不向场景执行器引入通用动效。高清图只用于核对背景，必须排除 TopBar、项目内容、卡片、字幕与 PIP。

## 画布与固定层

- `1920×1080` / `30fps`；基础骨架时长 18 秒，后续由输入时长替换。
- root 无条件挂载 `studio-background` / 透明 `content` / 透明 `caption-overlay`。
- 纯 TTS 或空模板不挂 PIP；仅有 talking-head 视频或显式占位指令才挂。无最终 voice 音频时不挂 audio。
- `content.html` 当前必须视觉为空；固定层不得出现 TopBar、Claude 卡片、demo 或全局 crossfade。

## 背景几何

背景必须以 SVG/CSS/同步 GSAP 直接实现，不得用视频、预渲染图或全宽横线代替。

- `canvasHeight=1080`, `nearY=-78`, `farY=342`, `rowStep=62`, `rowSpeed=34px/s`。
- 上下各 8 条动态横线：`rowDrift=(seconds*34)%62`，`y=-78+((index*62+rowDrift)%420)`。
- 投影端点：`t=clamp((y+78)/420,0,1)`，`left=-230+t*420`，`right=2150-t*420`。
- 23 条竖线，index 为 -11…11：`nearX=960+index*154`，`farX=960+index*76`。
- 下半平面独立使用 `mirrorY(y)=1080-y`，并从 `farX/mirrorY(farY)` 反向连到 `nearX/mirrorY(nearY)`。
- 蓝金竖线渐变固定为 `x1=0,y1=0,x2=1,y2=0`。wash、horizon（上下 184px）、grain 与 glow 保留。原本横跨全高、从 16% 到 84% 的线性 center veil 已取消，只允许 `18%×22%`、最大不透明度 `0.18` 的局部径向光斑；顶部和底部的中轴网格不得被遮空。

## 字幕与 PIP

- 字幕单行、居中、底部 96px、最大宽 1680px，无底板、无 blur、无药丸边框；没有 active caption 时必须视觉为空。
- PIP 为 206px 稳定圆形，right 104px / bottom 150px，不循环。真实媒体区固定为 190px，right 112px / bottom 158px。视频必须 `muted playsinline`，且由无时间属性的 wrapper 承载。
- 数字人的精确层级、当前 `66.7% 50%` 裁切、不透明 C 背景、人物安全区和放大审查见 [pip-contract.md](pip-contract.md)；挂载 PIP 时必须读取并执行。

## 证据

1. `validate_fixed_stage.mjs` 检查结构与精确常量，并必须拒绝几何或固定 mount 篡改。
2. 在 0s / 4s / 9s 生成 HyperFrames 背景-only 快照，与用户确认的窄中心光斑 fixed-stage golden 比较。
3. `compare_stage_parity.mjs` 按正式交付的 `yuv420p` 色域以 FFmpeg SSIM 比较，默认要求不低于 `0.995`；禁止把 HyperFrames 自身快照冒充 Remotion golden。

窄中心光斑 goldens 位于 `assets/golden-backgrounds/narrow-center-grid-t000.png`、`narrow-center-grid-t004.png` 和 `narrow-center-grid-t009.png`；来源、时间戳与 SHA-256 记录在 `evals/fixtures/fixed-stage/parity-fixture.json`。
