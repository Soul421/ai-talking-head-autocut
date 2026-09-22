# 导演文件合约

读取本文件的时机：创建、审批或调试 `voice-direction.yaml` 时。

## 单一真值

`voice-direction.yaml` 是唯一可编辑的导演真值。下列文件都是派生物，不得手动反向维护：

- `voice-direction-review.md`：给人审查的风险视图。
- `direction-lint.json`：确定性规则报告。
- `minimax-render.jsonl`：渲染和最终停顿重建清单。
- `minimax-render.meta.json`：引擎、音频、hash 和是否可渲染的元数据。
- `subtitle-source.txt`：不包含停顿和 sound tags 的字幕文本真值。

从 `assets/voice-direction.template.yaml` 复制模板，再用真实稿件重写；不要把模板例句当作正式内容。

## 状态机

```text
draft -> reviewed -> approved -> rendered -> audio_approved -> subtitled
```

- `draft`：导演正在编辑。
- `reviewed`：已通过 `mark_reviewed.py` 记录独立审查及内容 hash，尚未经用户批准。
- `approved`：静态检查和人工批准均通过，可调用云端 API。
- `rendered`：候选 Take 已生成，尚未批准最终音频。
- `audio_approved`：已在最终速度下听审并批准音频。
- `subtitled`：已以最终音频生成和回填字幕。

## 审批失效

`approve_direction.py` 对下列内容计算 SHA-256：

- 全部导演内容，不包含 `status` 和 `approval`。
- `source.path` 指向的当前原稿文件。

任何导演字段或原稿变化都会同时使独立审查和用户批准 hash 不匹配。`render_segments.py` 必须因此拒绝调用 MiniMax，直到重新审查与批准。

## 关键字段

- `global`：全片的场景、观众关系、表演目标、情绪弧线、最终速度和禁止项。
- `subtitle_text`：字幕和内容真值，不得包含引擎标签。
- `spoken_text`：实际朗读文本，可为口语自然调整，但改字时必须记录 `rewrite`。
- `speech_act` 与 `subtext`：该段在做什么，以及希望观众如何理解。
- `emotion`：当前状态、强度和相对上一段的变化。它是导演语义，不自动等于 API `emotion`。
- `rhythm`：基础节奏、局部速度曲线和连贯性。
- `focus`：信息焦点、类型、强度和理由；默认不超过两个。
- `intonation`：开头、转向和结尾的语调意图。
- `micro_breaks`：段内语义停顿，使用唯一锚点和毫秒值，编译为 `<#x#>`。
- `nonverbal`：默认空数组；仅保留有明确理由的 Speech 2.8 sound tag。
- `boundary`：段后 `none/flow/emphasis/section/final` 和符合个人 profile 的实际毫秒。
- `render`：可选的局部 speed/vol/pitch 近似实现；任何偏离都必须写原因。
- `takes`：1–3。普通句 1，关键转折 2，只有开头或核心落点使用 3。

## 平台标签隔离

`subtitle_text` 和 `spoken_text` 都不允许直接写 `<#0.2#>` 或 `(breath)`。停顿和声音事件只能用结构字段表示，由 `compile_direction.py` 产生 MiniMax 私有语法。
