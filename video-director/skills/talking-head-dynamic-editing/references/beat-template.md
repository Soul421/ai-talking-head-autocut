# Talking-head Beat 模板

每个 beat 至少填写：

```yaml
id: beat-01
start: 0.00
end: 3.20
spoken_text: "锁定字幕中的原句"
narrative_task: "建立信任 / 提出问题 / 解释关系 / 展示证据 / 给出结论"
primary_carrier: "person | keyword | relation | evidence | stillness"
person_layout: "全屏中近景 / 侧置配图解 / 素材主画面 / 必要的小窗"
layout_reason: "相较保持原构图，观众更容易理解什么；无收益则保持"
caption: "原SRT，低位稳定，按背景设对比度"
highlight_words: [] # 仅填有必要强调的短词
relation: "若无关系则 null；例如 cause_to_effect、step_to_step、before_after"
asset: null # 有需要时填真实素材路径，不为凑版式准备素材
motion:
  state_before: "开始状态"
  state_after: "结束状态"
  primary: "出现 / 建立连接 / 放大 / 推入 / 淡化 / 静止"
  secondary: null
  readable_hold: "关键词和证据何时可读"
  exit: "语义完成后如何退出"
  deletion_test: "删掉该运动会损失什么含义"
handoff: "如何把注意力交给下一 beat"
qa_points: ["字幕不丢", "不遮嘴", "人物裁切安全"]
```

`primary_carrier` 必须具体。不能只写“动效”“流程图”“高级感”。`deletion_test` 如果回答不出语义损失，默认改为静止或删除。
