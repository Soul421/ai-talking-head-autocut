# 视频交接合同

只有工作室生成的 `video-handoff.json` 可进入正式视频时间线。

## 准入检查

1. `status` 必须为 `ready`。
2. 重新计算 `locked_audio` 的 SHA-256，必须等于 `audio_sha256` 和审批记录中的 hash。
3. `captions_srt`、`captions_vtt` 必须存在，且来源项目为 `baocut_project_id`。
4. `locked_text` 是显示文字真值；BaoCut ASR 只负责时间轴和内容核查，不擅自润色正文。
5. 若音频、文字、语速、剪裁或拼接发生变化，交接单立即失效，返回声音工作室重新走完整门禁。

## 下游顺序

```text
video-handoff.json
  → video-script（正式导演稿和 Beat Graph）
  → video-spec / 制作规格
  → HyperFrames 等单一执行管线
  → 预览、QA、最终成片
```

数字人、口型、字幕和镜头时间码全部引用同一份 `locked_audio`。不得用试听 Take、MP3 衍生物或旧字幕替代。

## 生产与交付门禁
付费数字人生成前检查 approval.rhythm_review.status=approved，并复核当前音频 hash；旧交接文件不豁免。下游读取交接单 production_preset，按 [production-review.md](production-review.md) 保存本项目实际构图并验收最终 MP4。预览和成功导出均不能替代成片验收；最终交付说明必须如实报告尚未完成的人工播放检查。
