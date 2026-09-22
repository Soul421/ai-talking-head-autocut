# Validation Registry

## 2026-09-09 — validating

- `baseline`: 参考作品《吸引力法则改变人生》采用人物主画面、两侧关键词、半透明概念字、节点连接和证据素材插入；现有样片已有声音锁定、构图预设和 MP4 验收，但动效语法未固化。
- `trace`: 读取抖音作品 7682765064264305966 的公开页面与多个时间点画面，观察开头、人物讲解段、关系节点和素材插入段；对照现有 `fanhuayu-voice-studio`、`video-script` 与 `review_export.py`。
- `artifact`: 本 Skill 的 `SKILL.md`、`references/visual-language.md`、`references/beat-template.md`、`references/production-gates.md`。
- `scorer`: 结构验证通过；代表片段覆盖本片实际使用的构图和切换，不强制添加元素；实际 MP4 验收需生成关键帧并完成人工播放记录。
- `human_review`: 用户需判断数字人形象、背景、花字审美和口播嘴型；模型不能替代这一步。

当前只标记为 `validating`。至少完成 3 条真实作品并复盘后，才可升级为 `stable`。

## 2026-09-09 — 构图与信息减量修订（validating）

- trace：用户指出新版花哨、文字遮脸、页眉多余；明确认可按语义分配30秒画面，并要求写入Skill。
- baseline：旧规则强制代表片段包含多类元素，可能诱发装饰堆叠；改为人物全屏默认，每次增加元素或切换均解释收益。
- artifact：本次SKILL.md与visual-language、beat-template、production-gates修订；样片位于 /Users/fanhuayu/Documents/晓儿/50_个人项目/技术项目/本地声音克隆/voice-studio/pilots/2026-09-07-audio-avatar/fanfan-motion-test/refined-v3/fanfan-clean-v4.mp4 。样片不是30秒规则的端到端验证。
- scorer：结构校验与引用检查；场景推演：纯观点30秒可以全程人物＋字幕；解释关系仅在对应语义段侧置；无真实证据时不强制插素材；参考含金字不自动复制样式。上述为规则推演，非新片实测。
- human_review：保留实际成片人工听看与审美评价；当前新规则未完成3条真实作品验证，状态不升级。
