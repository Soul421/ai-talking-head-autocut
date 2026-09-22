# 人工听审与批准合同（通用模板）

适用范围：口播/数字人成片链路中的**声音节奏听审**、**静态镜头审核**、**成片播放验收**。  
本合同不绑定任何个人姓名；批准人由 `config.json` 的 `reviewer_name` 或 CLI `--by` 指定。

## 不可替代原则

| 记录类型 | 能否替代人工批准 |
| --- | --- |
| 模型自检 / lint / 脚本校验 | 否 |
| 静帧抽样观察 | 否（可作证据附件） |
| 等待超时 / Agent 自动勾选 | 否 |
| 可回溯的人工听审/看片记录 | 是（且仅覆盖对应 hash/版本） |

## A. 声音节奏听审（进入数字人/正式画面前）

对当前 `audio_sha256` 对应的音频，逐项确认：

- [ ] 读音（专有名词、多音字、数字单位）
- [ ] 停顿（句读、段落、呼吸）
- [ ] 重音（关键词是否落到正确位置）
- [ ] 语速（整体与段落节奏）
- [ ] 结尾（收束是否完整、有无截断）

批准记录必填：

```json
{
  "kind": "voice-rhythm-review",
  "artifact_sha256": "<audio_sha256>",
  "status": "approved",
  "approved_by": "<reviewer_name>",
  "approved_at": "<ISO-8601>",
  "items": ["读音", "停顿", "重音", "语速", "结尾"],
  "notes": ""
}
```

任一项未通过 → `status: rejected` 或 `pending`，禁止生成付费数字人与复杂动效。

## B. 全镜头静态审核（动效实现前）

- [ ] 每个镜头有最终静态页（非草图）
- [ ] 屏幕文案与锁定逐字稿一致（不增删改）
- [ ] 构图/安全区/遮挡符合舞台合同
- [ ] 入/出状态与 Beat 一致
- [ ] 文件归属与 motion contract 未越权

批准记录 kind：`static-shot-review`，`artifact_sha256` 为导演稿/beat-graph 的 hash。

## C. 成片播放验收（交付前）

- [ ] 实际播放完整成片（不可用预览/导出成功替代）
- [ ] 音画同步、字幕对齐
- [ ] 无黑帧/截断/爆音
- [ ] 门禁问题已关闭或如实记入 `qa-report.md`

批准记录 kind：`final-playback-review`，`artifact_sha256` 为最终 MP4 的 hash。

## 复用规则

- 同一 artifact hash + 同一版本的已有人工批准可直接复用；换轮次/重跑技术检查**不得**重复征求。
- 正文、声音、语速、剪裁或拼接变化 → 旧批准失效，必须重新走受影响阶段。
- 批准人变更不自动作废旧批准，但交付说明应记录当前责任人。

## CLI 约定

```bash
# 只记录已经完成的真实人工听审，Agent 不得代批
voice-studio approve <job_id> --by "$TTH_REVIEWER" --rhythm-reviewed
```

`--rhythm-reviewed` 的语义是「批准人声明已完成 A 节五项听审」，不是自动通过开关。
