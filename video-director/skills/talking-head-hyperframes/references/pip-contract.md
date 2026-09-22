# 数字人 PIP 固定契约

## 区域与层级

在 `1920×1080` 画布中使用以下唯一几何：

| 层 | 绝对区域 | CSS | z-index |
|---|---|---|---|
| 外圈 | `x=1610, y=724, w=206, h=206` | `right:104px; bottom:150px` | `90` |
| 媒体区 | `x=1618, y=732, w=190, h=190` | `right:112px; bottom:158px` | `89` |
| 字幕 | 固定字幕层 | 模板原值 | `100` |

数字人只属于 `#pip-media-wrapper` 媒体层；`pip-overlay` 只画透明圆框和阴影。不要把视频塞进圆框 composition，也不要让圆框的 mask 背景盖住视频。媒体 wrapper 无时间属性；`video` 自身携带 `data-start`、`data-duration`、`muted` 和 `playsinline`。

## 当前人物裁切

Bozhou Digital Twin v1 使用：

```css
#talking-head-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 66.7% 50%;
}
```

对 `1920×1080` 源视频，`cover` 到正方形时显示源图 `1080×1080`：

- 可见源区域：`x=560..1640, y=0..1080`；
- 左侧裁掉 `560px`（源宽 `29.17%`）；
- 右侧裁掉 `280px`（源宽 `14.58%`）；
- 总水平裁切 `840px`（源宽 `43.75%`）；
- 不裁上下；可见正方形缩放到 `190×190px`。

`66.7%` 是经主体 alpha 边界测量后的源图定位，不是任意视觉偏移。更换数字人时通过 `--pip-object-x` / `--pip-object-y` 覆盖，禁止直接在成片 CSS 里试数而不更新 manifest。

## 人物安全区

在 `190×190px` 媒体区中检查：

- 人脸水平中心落在 `48%..52%`；
- 头发最高点落在 `25%..32%`；
- 眼线落在 `45%..52%`；
- 下巴落在 `68%..76%`；
- 肩部可触及下边缘，底部肩宽占媒体区 `70%..90%`；
- 头顶不得切边，脸、眼镜和下巴不得被圆框遮挡。

当前模板的裁切值满足该人物。其他人物不满足时，先重新量测和审核，再改变 manifest 中的裁切值。

## 背景

真实数字人必须有独立、不透明的 C 方案背景：

```css
background-color: #f2f6f8;
background-image:
  radial-gradient(circle at 50% 18%, rgba(255, 255, 255, 0.74) 0%, transparent 58%),
  linear-gradient(180deg, #f2f6f8 0%, rgba(47, 111, 255, 0.30) 140%);
```

`background-color` 是强制不透明底；两个半透明渐变只能叠在它上面。禁止只写半透明 gradient、`background: transparent`、或依靠主舞台给数字人“补背景”。PIP 占位模式继续使用模板灰底，不挂真实媒体层。

## 审查门

1. 在动效前的全镜头最终静态页中审查 PIP，不得只看独立人物素材。
2. 至少抽查节目早段、中段、尾段三个时间点；人物中心和背景应稳定。
3. 从 20 Mbps 母版和 12 Mbps 发布候选各抽取至少一帧。
4. 对实际成片使用固定 review crop：`crop=300:300:1560:680`，再放大到 `900×900`。
5. 圆内出现任何舞台网格、主画面线条或透底即失败；人物不满足安全区也失败。
6. manifest/receipt 记录 object position、背景不透明状态、抽查时间和放大审查结果。

生成实际编码证据：

```bash
npm run review:pip -- renders/internal-preview-v1.mp4 [seconds]
```

检查 `review/pip/internal-preview-v1-crop-3x.png` 后，只在真实通过时把相邻 review JSON 的 `status` 改为 `PASS`，并把 `acceptance.noStageGridInsideCircle`、`acceptance.subjectInsideSafeArea` 都改为 `true`。proof validator 会核对该 receipt 的视频 SHA-256，禁止用别的帧或旧成片顶替。
