# AI 口播分身｜从文稿到成片

把一篇口播稿，做成有数字人出镜、同步字幕、重点花字和画面动效的短视频。

串联配音、字幕对齐、数字人素材衔接、分镜设计、自动剪辑与成片检查，适合知识口播、个人 IP 和产品讲解。支持先审声音、再审画面，确认后导出成片。

![视频封面](covers/video-cover.png)

## 效果示例

约 9 秒实际链路测试，展示数字人口播、同步字幕与分屏排版。

[demo.mp4](demo.mp4)

> 技术演示，不代表人工嘴型听审已通过。

## 一键安装

```bash
git clone https://github.com/Soul421/ai-talking-head-autocut.git
cd ai-talking-head-autocut
./install.sh --speaker "你的名字" --reviewer "你的名字"
```

脚本会：

1. 把 `video-director` 与 9 个配套 skill 装进本机 Agent 的 Skill 目录（`~/.codex/skills`、`~/.claude/skills` 等，可用 `--dir` 指定）
2. 生成 `~/.config/ai-talking-head-autocut/config.json`（路径、音色参考、批准人）
3. 自动去掉作者本机绝对路径，把人名替换成你传入的 speaker/reviewer

可选依赖（完整出片才需要）：Python 3.9+、Node.js、FFmpeg、BaoCut、本地 Qwen-TTS、HyperFrames 0.7.65、HeyGen 账号。

## 30 秒最小可跑示例

不配 TTS、不连云端，也能跑通**门禁链路**：

```bash
python3 examples/mini-30s/run_minimal.py
```

会锁定正文 hash → 生成 30s 时间轴字幕与占位音频 → 写出待审批准记录 → 产出 `video-handoff.json`。  
配置好声音模型后，加 `--real-voice` 走真实 generate → 听审 → approve → handoff。

详见 [examples/mini-30s/README.md](examples/mini-30s/README.md)。

## 通用听审合同

人工批准**不绑定个人**，统一按 [video-director/templates/review-contract.md](video-director/templates/review-contract.md)：

- §A 声音节奏听审（读音/停顿/重音/语速/结尾）
- §B 全镜头静态审核
- §C 成片播放验收

`approve --by` 只是记录谁审过；Agent 不得代批。

## 包内模块

根目录 `video-director/` 为总控 Skill，`skills/` 下为配套模块：

| 模块 | 职责 |
| --- | --- |
| video-director | 端到端总控与生产协调 |
| voice-studio（安装时由 fanhuayu-voice-studio 映射） | 本地克隆配音与声音验收 |
| baocut | 本地转写、字幕与剪辑 |
| video-script | 导演稿与 Beat Graph |
| video-spec-builder | 制作规格与分镜 |
| talking-head-hyperframes | 数字人 PIP 固定舞台模板 |
| hyperframes-scene-animator | 镜头实现、动效与 proof |
| talking-head-dynamic-editing | 口播动态剪辑语法 |
| douyin-cover | 封面诊断与模板 |
| minimax-voice-director | MiniMax 云端配音（可选） |

## 配置

`~/.config/ai-talking-head-autocut/config.json` 或环境变量：

| 变量 | 含义 |
| --- | --- |
| `TTH_SPEAKER` / `TTH_REVIEWER` | 出镜人 / 听审批准人 |
| `TTH_QWEN_PYTHON` / `TTH_QWEN_MODEL` | 本地 TTS |
| `TTH_REFERENCE_AUDIO` / `TTH_REFERENCE_TEXT` | 克隆参考音 |
| `TTH_BAOCUT` | BaoCut 可执行文件 |

## 迁移边界

- 不含账号凭据、私人音色、人物照片、模型权重。
- 第三方工具及插件不作为原创内容再分发。
- HeyGen 数字人需自行配置账号与授权素材。

## License

个人作品与工作流 Skill，供学习与二次开发参考。第三方依赖遵循各自许可证。
