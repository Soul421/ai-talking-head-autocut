---
name: voice-studio
description: 口播/个人视频的统一配音入口。用于克隆音色、生成口播或旁白、把最终声音接入视频生产流程。默认使用本机 Qwen-TTS，MiniMax API 仅作明确授权的备用；生成后必须由 BaoCut 本地转写验收并经配置的 reviewer 听审批准，才交给 video-script、HyperFrames、数字人或最终剪辑。
---

# 本地声音工作室

把“稿件 → 本地克隆声音 → 本地转写验收 → 人工批准 → 视频交接”收成一个可追溯入口。应用、模型、参考音和每次运行结果都保留在本机。

配置来自 `~/.config/ai-talking-head-autocut/config.json` 或 `TTH_*` 环境变量（见 `config.example.json`）。批准人使用 `reviewer_name`，不绑定特定个人。

## 阶段阻塞与批准复用

本 Skill 的停止条件只界定本阶段。完整视频请求交回总控继续已授权的下游工作；最终本地导出不等于对外发布。缺文件、映射或 hash 不一致时先修复上游与受影响证据，不伪造状态或绕过执行完整性校验。

已有可回溯、对应当前版本的人工批准直接复用；不得因换轮次、换 Skill 或重跑技术检查重复征求。同一内容发生实质变化时按现有合同重新验收受影响部分。人工听审、整套静态镜头审核与脚本校验仍按 [review-contract](../../templates/review-contract.md) 执行，模型自检和等待超时不能冒充人工批准。

## 固定路由

1. 主账号口播、旁白和视频配音默认使用 `qwen-local`（路径在 config 中配置）。
2. 本地生成失败时先报告真实错误，不得自动改用 MiniMax。
3. 只有用户明确选择 MiniMax，并确认文字上传与 API 费用后，才使用 `minimax-api`。
4. 所有声音统一使用 BaoCut 本地 ASR 生成转写、SRT/VTT 和质量报告。转写强制离线，不自动下载或上传音频。
5. 只有 `qa.status=pass` 且存在 hash 匹配的人工批准记录，才允许生成 `video-handoff.json`。

## 使用工作室

```bash
python scripts/voice_studio.py serve
python scripts/voice_studio.py status
python scripts/voice_studio.py generate --text "已经确认的口播稿"
python scripts/voice_studio.py qa <job_id>
python scripts/voice_studio.py approve <job_id> --by "$TTH_REVIEWER" --rhythm-reviewed
python scripts/voice_studio.py handoff <job_id>
```

界面中的顺序不可跳过：生成 → 节奏听审（读音/停顿/重音/语速/结尾）→ BaoCut 验收 → 人工批准 → 视频交接。

调用 MiniMax 时必须同时写 `--engine minimax-api --confirm-cloud`。缺任一项即拒绝。

## 视频流程交接

读取 [video-handoff.md](references/video-handoff.md) 与 [review-contract](../../templates/review-contract.md)。下游必须使用 `video-handoff.json` 中的 `locked_text`、`locked_audio` + `audio_sha256`、字幕与人工批准记录。声音、字幕或正文任一变化都会使旧交接单失效。

## 完成条件

- 音频、原稿、参考音、模型和 hash 已落盘。
- BaoCut 本地审计为 PASS。
- reviewer 已实际听审并批准当前音频 hash。
- `video-handoff.json` 状态为 `ready`。
- 没有未经明确授权的云端上传或 API 调用。
