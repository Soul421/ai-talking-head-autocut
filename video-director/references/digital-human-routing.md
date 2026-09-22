# 数字人接入路由表（何时接哪个模型）

> 给使用本 skill 包的人：**不要凭感觉选数字人**。按「你在哪一步、要什么脸」查表接。

## 0. 三句话结论

1. **本 skill 不绑定任何一家数字人公司**，只规定「脸从哪来、怎么验收、何时允许出现」。
2. **脸的效果 ≠ 本 skill 的效果**。本 skill 保证音画对齐、门禁和可追溯；脸好不好看，取决于你接的模型。
3. **没有脸也能先跑通**（PIP 占位 + 本地克隆音），验证流程后再接脸。

---

## 1. 按生产阶段选数字人

| 阶段 | 你要什么 | 推荐接入 | 不该用 | 门禁 |
| --- | --- | --- | --- | --- |
| **S1 声音锁定前** | 不需要脸 | **无** | 任何数字人 | 只做 TTS/听审 |
| **S2 声音已批准 + 交接 ready** | 允许开始做脸 | — | — | `video-handoff.status=ready` |
| **S3 导演稿/分镜** | 只要脸的**规格**（构图/朝向/安全区） | 不出脸 | 出成片 | 先过 video-script |
| **S4 数字人成片** | 说话人的视频（口型对齐） | **HeyGen / D-ID / Synthesia / 腾讯智影** 等 SaaS；或 **HeyGen Avatar** | 手搓 GAN | 节奏听审 + hash |
| **S5 合成舞台** | 脸放进版式（PIP/分屏） | `talking-head-hyperframes` | 在合成里再生成脸 | 固定舞台合同 |
| **S6 镜头动效** | 花字/关系动效/证据 | `hyperframes-scene-animator` | 改口型 | motion contract |

**口播分身默认链：**  
`本地克隆音 → S4 出脸视频 → S5 固定舞台合成 → S6 动效`

---

## 2. 数字人模型对照（按需求选）

### A. 要「像真人、口型稳、省事」→ SaaS

| 服务 | 适合 | 接入方式 | 费用 | 注意 |
| --- | --- | --- | --- | --- |
| **HeyGen** | 个人 IP 口播、Avatar 克隆 | 网页/Avatar API | 订阅+点数 | 本包默认假想；需账号与授权素材 |
| **D-ID** | 快速 talking head | REST API | 按分钟 | 形象库风格偏商务 |
| **Synthesia** | 企业培训 | REST | 贵 | 不适合个人 IP 脸 |
| **腾讯智影 / 闪剪** | 国内合规、中文好 | 产品内 | 国内计费 | 导出规格先对齐 16:9/9:16 |

**S4 接入清单（缺一不可）：**
1. 账号 + API Key（或网页导出成片）
2. **授权的形象**（你的脸/声音须合法）
3. **锁定的 `voice.wav`**（禁止用试听 take）
4. 输出规格：时长 = 锁定音频时长，fps=30，1920×1080 或项目分辨率

### B. 要「免费/本地/可打码」→ 开源

| 项目 | 适合 | 难度 | 效果 |
| --- | --- | --- | --- |
| **SadTalker** | 单图说话 | 中 | 表情一般 |
| **LivePortrait** | 视频驱动表情迁移 | 中高 | 更生动 |
| **EchoMimic / Hallo** | 音频驱动半身 | 高 | 近研究向 |
| **HeyGen 克隆 / 开源 wav2lip 类** | 口型贴合 | 中 | 口型优先 |

**本地开源默认不进本 skill 主链**——除非你显式写进 `asset-plan` 并过同一套听审/hash。

### C. 「只要版式、脸以后再补」→ PIP 占位

```bash
scaffold_talking_head_hyperframes_project.mjs ... --show-pip-placeholder
```

适合：先验证音画对齐与动效，脸后补。**交付说明必须写明占位。**

---

## 3. 流程决策树（复制就能用）

```text
有锁定 voice.wav 了吗？
├─ 否 → 先 voice-studio generate → 听审 → approve → handoff
└─ 是 → 要真人脸吗？
    ├─ 否 → --show-pip-placeholder 直接进 S5/S6
    └─ 是 → 有 HeyGen/D-ID 等账号与授权形象吗？
        ├─ 否 → 先去开通；或用开源（效果自担）；禁止用未授权素材
        └─ 是 → 用【锁定 audio 的时长】生成 S4 视频
                 → 放入 asset-plan.assets[A03]
                 → talking-head-hyperframes 重建舞台
                 → hyperframes-scene-animator 做镜头
```

---

## 4. 效果不好时，先查这 5 项（按序）

| # | 检查 | 不合格怎么办 |
| --- | --- | --- |
| 1 | `voice-handoff` 是否 ready 且 hash 匹配 | 重走听审，禁止拿旧 take |
| 2 | 数字人视频**时长**是否 = 锁定音频 | 重新出脸，禁止剪短/拼接当锁定音 |
| 3 | ref_text / 口播稿是否与声音一致 | ASR 复核；文案变了必须重听审 |
| 4 | 是否在 S4 之前就做花字/转场 | 停止；先完成导演稿与舞台 |
| 5 | 声音是否被二次编码/改速 | 校验 `audio_sha256`；变了重新验收 |

**永远不要用预览帧代替成片验收。**

---

## 5. 本 skill 的责任边界（写进交付说明）

| 本 skill 负责 | 本 skill 不负责 |
| --- | --- |
| 音文一致、时间轴对齐 | 脸是否像你本人 |
| 人工听审与 hash 交接 | 某家 SaaS 的口型质量 |
| 固定舞台、构图与安全区 | 形象版权/肖像授权 |
| 动效语义与验收帧 | BGM 版权 |
| 可追溯的门禁日志 | 平台过审（抖音/视频号规则） |

交付给客户/自己的说明里必须写清：**「数字人由 _____ 提供，形象授权由使用方负责。」**

---

## 6. 推荐写法（asset-plan 摘录）

```json
{
  "id": "A03",
  "role": "talking-head-video",
  "provider": "heygen",
  "asset_id": "avatar_xxx",
  "duration_must_equal_audio": true,
  "path": "assets/video/talking-head.mp4",
  "rights": "user-provided-consent",
  "fallback": "pip-placeholder"
}
```

不知道填什么 provider？先填 `pip-placeholder`，**不要瞎猜模型名**。
