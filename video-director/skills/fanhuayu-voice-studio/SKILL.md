---
name: fanhuayu-voice-studio
description: 范铧屿个人视频的统一配音入口。用于克隆范铧屿音色、生成口播或旁白、把最终声音接入视频生产流程。默认使用本机 Qwen3-TTS 1.7B MLX，MiniMax API 仅作明确授权的备用；生成后必须由 BaoCut 本地转写验收并经本人听审批准，才交给 video-script、HyperFrames、数字人或最终剪辑。
---

# 范铧屿本地声音工作室

把“稿件 → 本地克隆声音 → 本地转写验收 → 人工批准 → 视频交接”收成一个可追溯入口。应用、模型、参考音和每次运行结果都保留在本机。

## 阶段阻塞与批准复用

本 Skill 的停止条件只界定本阶段。完整视频请求交回总控继续已授权的下游工作；最终本地导出不等于对外发布。缺文件、映射或 hash 不一致时先修复上游与受影响证据，不伪造状态或绕过执行完整性校验。只有确实缺少人工决定或外部条件才暂停依赖步骤。

已有可回溯、对应当前版本的人工批准直接复用；不得因换轮次、换 Skill 或重跑技术检查重复征求。同一内容发生实质变化时按现有合同重新验收受影响部分。本人听审、整套静态镜头审核与脚本校验仍按各自合同执行，模型自检和等待超时不能冒充人工批准。

## 固定路由

1. 范铧屿本人账号、口播、旁白和视频配音默认使用 `qwen-local`。
2. 本地生成失败时先报告真实错误，不得自动改用 MiniMax。
3. 只有用户明确选择 MiniMax，并确认文字上传与 API 费用后，才使用 `minimax-api`。
4. 所有声音统一使用 BaoCut 本地 `qwen3-asr-0.6b` 生成转写、SRT/VTT 和质量报告。声音工作室默认使用独立安装的 CLI 1.1.4，转写强制 `--offline`，不自动下载或上传音频；旧版全局 Skill 入口不变。
5. 只有 `qa.status=pass` 且存在 hash 匹配的人工批准记录，才允许生成 `video-handoff.json`。

## 使用工作室

用户要打开、生成、试听、验收或批准声音时，运行：

```bash
python "/Users/fanhuayu/.codex/skills/fanhuayu-voice-studio/scripts/voice_studio.py" serve
```

也可以直接双击：

```text
/Users/fanhuayu/Documents/晓儿/50_个人项目/技术项目/本地声音克隆/voice-studio/启动范铧屿声音工作室.command
```

界面中的顺序不可跳过：

1. 粘贴已经确认的口播稿并生成。
2. 节奏听审生成音频：逐项核对读音、停顿、重音、语速和结尾；需要修改时先改声音再生成数字人口型。
3. 运行“BaoCut 本地验收”。
4. 本人完成当前版本节奏听审后勾选检查项，点“节奏听审后批准”。
5. 点“交给视频制作”生成锁定交接单。

## 命令行入口

需要自动化时使用同一脚本：

```bash
python "/Users/fanhuayu/.codex/skills/fanhuayu-voice-studio/scripts/voice_studio.py" status
python "/Users/fanhuayu/.codex/skills/fanhuayu-voice-studio/scripts/voice_studio.py" generate --text "已经确认的口播稿"
python "/Users/fanhuayu/.codex/skills/fanhuayu-voice-studio/scripts/voice_studio.py" qa <job_id>
python "/Users/fanhuayu/.codex/skills/fanhuayu-voice-studio/scripts/voice_studio.py" approve <job_id> --by "范铧屿" --rhythm-reviewed
python "/Users/fanhuayu/.codex/skills/fanhuayu-voice-studio/scripts/voice_studio.py" handoff <job_id>
```

调用 MiniMax 时必须同时写 `--engine minimax-api --confirm-cloud`。缺任一项即拒绝，不得绕过。

## 视频流程交接

读取 `references/video-handoff.md` 和 [构图、合成与成片验收](references/production-review.md)。下游必须使用 `video-handoff.json` 中的：

- `locked_text`；
- `locked_audio` 与 `audio_sha256`；
- BaoCut 生成的 `captions_srt`、`captions_vtt` 与 `baocut_project_id`；
- 引擎、模型、参考音和人工批准记录。

先进入 `video-script` 生成正式导演稿，再按视频总控选择 HyperFrames 或其他渲染器。声音、字幕或正文任一变化都会使旧交接单失效，必须重新验收和批准。

## 完成条件

- 音频、原稿、参考音、模型和 hash 已落盘。
- BaoCut 本地审计为 PASS，文字相似度门通过。
- 用户已实际听审并批准当前音频 hash。
- `video-handoff.json` 状态为 `ready`。
- 没有未经明确授权的云端上传或 API 调用。

## BaoCut 1.x 兼容适配

`baocut_project_id` 仍是字符串定位字段：旧任务为 `p…`，新任务为 `.bcut` 项目绝对路径。下游直接使用交接单内的音频和字幕，不解析该字段格式。输出仍为 captions.srt、captions.vtt、transcript.md，审批与交接字段保持兼容。

重跑验收先撤销旧批准和交接，成功后仍需真实人工听审。新版失败保留日志，不自动切回旧版。`VOICE_STUDIO_BAOCUT` 可显式指定旧 CLI；当前旧 CLI 的 ASR 模型检查失败，恢复其模型前不能作为可用生产回退。修改后重启已运行的声音工作室进程才会加载新代码。

## 节奏批准
HeyGen 等付费数字人生成前，必须存在当前音频 hash 对应的节奏听审批准（读音、停顿、重音、语速、结尾）。CLI 的 --rhythm-reviewed 只能记录本人已明确给出的实际听审结论，不能由 Agent 自行代批。旧批准记录保留，不自动补写为节奏已审；已经包含这五项的可回溯批准可复用。
