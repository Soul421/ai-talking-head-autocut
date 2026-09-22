# 数字人结合自动剪辑 · 原始 Skill 链路导出

导出日期：2026-09-16。根目录 SKILL.md 为现有总控；skills/ 保存配套模块。未修改原安装目录。

## 使用

将根目录作为 `video-director` 安装，将 skills/ 下各目录安装到目标 Agent 的 Skill 搜索路径。先读取根 SKILL.md，并按阶段读取对应模块。炉子上传是资产存储，不表示运行环境已经安装或完成端到端测试。

## 模块

- video-director
- voice-studio
- baocut
- video-script
- video-spec-builder
- talking-head-hyperframes
- hyperframes-scene-animator
- talking-head-dynamic-editing
- douyin-cover
- minimax-voice-director

## 迁移边界

保留原始脚本和本机路径，跨设备使用前须映射路径、安装运行环境并重新验证。包内不含账号凭据、环境配置、私人音色参考音、人物照片、模型权重或真实项目运行记录。测试夹具未打包；需运行回归测试时使用源工程。第三方工具及插件不作为原创内容重新分发。

视频外部依赖：Python、Node.js、FFmpeg、BaoCut、本地 Qwen3-TTS 环境和模型、HyperFrames 0.7.65 及 hyperframes/hyperframes-cli/gsap 等官方插件。HeyGen 数字人需自行配置账号与授权素材，包内没有独立的 HeyGen 生成器。声音工作室应用源码已附在 runtime-source/voice-studio/app；原入口指向作者本机，迁移时需调整。封面参考人物图片须由使用者提供。MiniMax 为需单独授权的可选云服务。
