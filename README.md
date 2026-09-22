# AI 口播分身｜从文稿到成片

把一篇口播稿，做成有数字人出镜、同步字幕、重点花字和画面动效的短视频。

串联配音、字幕对齐、数字人素材衔接、分镜设计、自动剪辑与成片检查，适合知识口播、个人 IP 和产品讲解。支持先审声音、再审画面，确认后导出成片。

![视频封面](covers/video-cover.png)

## 效果示例

约 9 秒实际链路测试，展示数字人口播、同步字幕与分屏排版。

[demo.mp4](demo.mp4)

> 技术演示，不代表人工嘴型听审已通过。

## 包内模块

根目录 `video-director/` 为总控 Skill，`skills/` 下为配套模块：

| 模块 | 职责 |
| --- | --- |
| video-director | 端到端总控与生产协调 |
| fanhuayu-voice-studio | 本地克隆配音与声音验收 |
| baocut | 本地转写、字幕与剪辑 |
| video-script | 导演稿与 Beat Graph |
| video-spec-builder | 制作规格与分镜 |
| talking-head-hyperframes | 数字人 PIP 固定舞台模板 |
| hyperframes-scene-animator | 镜头实现、动效与 proof |
| talking-head-dynamic-editing | 口播动态剪辑语法 |
| douyin-cover | 封面诊断与模板 |
| minimax-voice-director | MiniMax 云端配音（可选） |

## 安装

1. 将 `video-director/` 根目录作为 `video-director` Skill 安装。
2. 将 `video-director/skills/` 下各目录安装到目标 Agent 的 Skill 搜索路径。
3. 先读取根 `SKILL.md`，并按阶段读取对应模块。

详细说明见 [video-director/README-导入说明.md](video-director/README-导入说明.md)。

## 外部依赖

- Python、Node.js、FFmpeg
- BaoCut、本地 Qwen3-TTS 环境和模型
- HyperFrames 0.7.65 及 hyperframes / hyperframes-cli / gsap 等官方插件
- HeyGen 数字人（需自行配置账号与授权素材；包内没有独立的 HeyGen 生成器）
- MiniMax API（可选，需单独授权）

## 迁移边界

- 保留原始脚本和本机路径，跨设备使用前须映射路径、安装运行环境并重新验证。
- 包内不含账号凭据、环境配置、私人音色参考音、人物照片、模型权重或真实项目运行记录。
- 测试夹具未打包；需运行回归测试时使用源工程。
- 第三方工具及插件不作为原创内容重新分发。
- 声音工作室应用源码在 `video-director/runtime-source/voice-studio/app`，原入口指向作者本机，迁移时需调整。
- 封面参考人物图片须由使用者提供。

## License

个人作品与工作流 Skill，供学习与二次开发参考。第三方依赖遵循各自许可证。
