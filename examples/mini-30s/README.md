# 30 秒最小可跑示例

目标：不依赖 HeyGen / 不上传云端，也能**跑通门禁链路**并产出可审计的交接单骨架。

## 前置

```bash
./install.sh --speaker "你的名字" --reviewer "你的名字"
# 按需填写 ~/.config/ai-talking-head-autocut/config.json
```

## 跑法（两档）

### A. 离线门禁演练（默认，无需 TTS 模型）

```bash
python3 examples/mini-30s/run_minimal.py
```

会完成：
1. 锁定 `script.txt` 正文 hash
2. 生成模拟音频占位 + 30s 时间轴字幕（SRT/VTT）
3. 写出 `review-contract` 所需的**待审**批准记录
4. 产出 `video-handoff.json`（`status: pending_review`）
5. 打印下一步：真实听审 → `approve` → `ready`

约 30 秒脚本时长；本地执行数秒完成。

### B. 真实声音（配置了 Qwen-TTS 后）

```bash
python3 examples/mini-30s/run_minimal.py --real-voice
```

会额外调用 voice-studio：`generate → qa →（等你听审）approve → handoff`。

## 产物目录

```
examples/mini-30s/out/
  script.locked.json    # 正文 + hash
  audio.placeholder.wav # 或真实 wav
  captions.srt / .vtt
  review-pending.json   # 待人工批准
  video-handoff.json    # 交接单
  gate-log.txt          # 门禁日志
```

## 与全链路的关系

本示例验证的是**合同与门禁**（hash、听审、交接），不是成片画质。
完整成片仍走 `video-director` → `video-script` → `talking-head-hyperframes` → 渲染。
