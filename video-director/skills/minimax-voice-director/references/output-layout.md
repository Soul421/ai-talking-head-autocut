# 项目交付与证据

读取本文件的时机：开始正式视频配音或发布最终音频时。

```text
<project>/
├── public/assets/audio/
│   ├── voice.wav
│   ├── voice.m4a
│   ├── voice.mp3
│   ├── voice-publish.json
│   └── archive/
└── work/
    ├── source/
    │   └── script.md
    ├── tts/
    │   ├── voice-direction.yaml
    │   ├── voice-direction-review.md
    │   ├── direction-lint.json
    │   ├── minimax-render.jsonl
    │   ├── minimax-render.meta.json
    │   └── subtitle-source.txt
    ├── audio/generated/minimax/
    │   ├── candidates/
    │   ├── selected/
    │   ├── final/
    │   ├── render-results.json
    │   └── take-selection.yaml
    └── captions/
        ├── captions.srt
        ├── captions.vtt
        ├── captions_aligned.json
        ├── captions.raw.srt
        └── asr-result.json
```

规则：

- 只有 `public/assets/audio/voice.*` 是当前正式成果。
- 所有候选 Take、请求 trace、选择结果、停顿重建报告和指标都留在 `work/`，用于局部返工和模型回归。
- 不把 API Key、Voice ID 原值、上传凭证或完整请求头写入证据文件。
- 正式音频发布前备份旧版；不直接删除用户的旧成果。
- 字幕永远跟随已批准的最终音频，不跟随导演预览或原始候选 Take。
