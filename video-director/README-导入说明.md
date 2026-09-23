# AI 口播分身 · 可移植 Skill 包

当前版本：2026-09-23。根目录 `SKILL.md` 是唯一总控；`skills/` 保存配套模块。

## 一键安装

在仓库根目录运行：

```bash
./install.sh --speaker "你的名字" --reviewer "你的名字"
```

安装器会把总控和配套模块装入检测到的 Agent Skill 目录，并生成 `~/.config/ai-talking-head-autocut/config.json`。也可以使用 `python3 install.py --dry-run` 先查看安装范围。

安装后先配置自己的声音参考音、Qwen 模型、BaoCut、数字人账号和渲染器，再阅读根目录 `SKILL.md` 开始工作。不要把多个同名 `video-director` 副本同时放进同一个 Agent 的搜索路径。

## 模块

- video-director：端到端总控
- voice-studio：使用者自己的声音工作室（源目录保留历史兼容名）
- baocut：本地转写、字幕和剪辑
- video-script：导演稿与 Beat Graph
- video-spec-builder：制作规格与分镜
- talking-head-hyperframes：数字人固定舞台
- hyperframes-scene-animator：镜头实现与动效
- talking-head-dynamic-editing：口播动态剪辑
- douyin-cover：封面诊断与模板
- minimax-voice-director：MiniMax 云端配音（可选）

## 使用边界

安装器只负责复制 Skill 和生成配置模板，不会自动申请账号、上传音频或下载模型。每个使用者必须提供自己的参考音频、模型和授权数字人素材，并亲自完成声音听审、静态画面审核和成片播放验收。

完整出片依赖 Python、Node.js、FFmpeg、BaoCut、本地 Qwen3-TTS、HyperFrames 及其官方插件；HeyGen 等数字人服务需要自行配置。安装预检通过不等于新设备已经完成端到端成片验证，首次使用必须按质量门禁跑一个真实项目。

第三方工具和插件遵循各自许可证，公开包不包含账号凭据、私人音色、人物照片或模型权重。
