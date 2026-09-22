---
name: video-spec-builder
description: Use when the user explicitly asks to create or revise a video specification, storyboard, 分镜, video-spec.md, narration timing, shot sequence, transitions, subtitles, or other scene-level creative decisions, or when `video-director` delegates specification work. Do not use as the entrypoint for producing a complete video.
---

# Video Spec Builder

把用户意图转成可制作、可验收的 `video-spec.md`。适用于单独规格、分镜或已有规格修改；完整视频由 `video-director` 承接。

## 判断与澄清

- 先读现有项目、输入素材与已定风格；多个规格文件先根据当前任务、引用关系与内容定位，无法消歧才问。
- 用户给出的形容词是设计输入。将“科技感”“安静”“你定”转成具体画面与节奏，由模型承担制作判断，不强迫用户回答镜头、字体或动效问卷。
- 目的、受众、平台、时长、核心信息从请求、素材和项目约定提取；只有缺项会实质改变结果且无法合理推断时才问。可逆的创意默认直接写入规格，标明关键假设，不标成必须批准的待办。
- 区分事实、用户要求与模型设计。真实数据、引语、经历、产品承诺必须有依据；hook、情绪曲线和转场可以由模型创作，不冒充用户原话。
- 缺素材先盘点和搜索可用来源；仅完整制作任务允许总控在授权内获取或生成。无需为无关的 3D、字体或素材维度提问。
- 外部事实、指定参考和当前能力按需要验证。不要为了写规格升级已锁定依赖或增加技术栈。

## 产物

`video-spec.md` 至少写清：目标与受众、交付平台与尺寸/时长、核心内容、素材与来源、视觉规范、分镜与时序、音画关系、必要验收条件和真实未决项。

每镜头说明时间区间、信息/叙事作用、可读文案、画面构成、资产来源、动作与转场。允许有叙事目的的留白；时长由可读性与节奏决定，不套固定秒数阈值。

沿用已有主题；没有主题时根据目标选择合适方案，必要时创建 `design.md`。用户明确要比较方案时才列备选。组件 ID 只在所选渲染器确实要求时填写，不强制 Remotion 使用 HyperFrames 组件。

## 执行与衔接

1. 读取已有输入，确定新建还是局部修改。
2. 形成具体规格；只有影响授权或目标的未决项才阻塞对应内容。
3. 迭代时直接修改已授权部分，检查连带的时长、素材、字幕与镜头引用，保留无关内容。改动总览用于解释结果，不是自动增加的写前审批。
4. 检查时间连续性、文案可读性、素材可得性与约束一致性。失败先修复，不伪造齐全。
5. 用户只要规格时交付文件；用户要完整视频时交回 `video-director` 继续生产。项目明确要求的声音听审或静态画面批准仍由对应阶段核对，已有同版本批准不重问。

## 按需参考

- `templates/video-spec-template.md`：字段参考，只保留当前任务需要的字段。
- `references/scene-breakdown.md`、`references/pacing-rules.md`、`references/components-catalog.md`：镜头、节奏与组件参考。
- `references/question-bank.md`、`references/dialogue-style.md`：可选问题和表达素材，不是必须完成的问卷。
- `references/workflow-0-1.md`、`references/workflow-iteration.md`：工作模式说明。

本入口定义决策与授权规则；参考资料中的机械追问、逐阶段复述确认、必须二次确认和固定风格清单不再作为闸门。实际渲染能力以当前启用的 renderer Skill 与项目为准。
