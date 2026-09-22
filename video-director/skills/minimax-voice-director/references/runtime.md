# 运行环境与兼容入口

读取本文件的时机：调用 MiniMax API、检查环境、进行 Voice ID/声音克隆/声音设计兼容工作时。

## 环境优先级

如果项目使用本地环境文件，先在当前 shell 加载它：

```bash
set -a
source "/path/to/project/.env"
set +a
```

正式人声至少使用：

```text
MINIMAX_API_KEY
MINIMAX_API_HOST
MINIMAX_VOICE_ID
MINIMAX_TTS_MODEL
MINIMAX_TTS_SPEED
```

不输出 API Key、Secret 或 Voice ID 原值。只允许报告变量是否存在、模型名、速度和输出路径。

依赖：Python 3、`requests`、`PyYAML`、`ffmpeg`、`ffprobe`。

## 兼容 Python 入口

`assets/minimax_tts.py` 保留低层兼容入口：

```python
import sys
sys.path.insert(0, "/path/to/minimax-voice-director/assets")

from minimax_tts import text_to_audio
```

`text_to_audio()` 现在优先读取 `MINIMAX_VOICE_ID` 和 `MINIMAX_TTS_MODEL`，缺少模型时退回 `speech-2.8-hd`。默认不发送 `emotion`，避免解释类视频被旧的 `happy` 默认值污染。

它还支持 `language_boost`、`subtitle_enable`、`subtitle_type`、`channel` 和 `output_format`，但导演流程应使用 `scripts/render_segments.py`，不应绕过审批门直接调用底层函数。

## 旧声音工具

`list_voices()`、`voice_clone()` 和 `voice_design()` 保留为旧项目兼容函数，不属于三阶段导演主路径。由于 MiniMax 声音管理端点会演进，每次执行克隆、设计或删除前都要先核对当前官方文档，不得因为函数存在就假定端点仍然有效。

音乐、BGM、歌曲和 cover 任务路由到同级 `music`（ElevenLabs Music API）。底层模块中的历史音乐函数只为不破坏旧导入而保留，不在本 skill 主流程中暴露。
