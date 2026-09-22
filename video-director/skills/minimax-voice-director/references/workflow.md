# 三阶段制作流程

读取本文件的时机：执行正式视频配音、局部重生、Take 挑选、发布人声或生成字幕时。

## 阶段一：导演与审批

1. 确认发音：数字、英文缩写、产品名、人名和多音字先统一读法。
2. 从 `assets/voice-direction.template.yaml` 复制项目的 `work/tts/voice-direction.yaml`。
3. 按 `references/directing.md` 生成全片基线和逐段表演谱。
4. 运行静态检查和编译。先将 `<SKILL_ROOT>` 替换为**已安装 Skills 目录**（例如 `~/.agents/skills`、项目的 `.agents/skills` 或平台对应目录）；在每个新终端会话中设置一次：

```bash
SKILL_ROOT="<SKILL_ROOT>"
SKILL_DIR="$SKILL_ROOT/minimax-voice-director"
python "$SKILL_DIR/scripts/validate_direction.py" work/tts/voice-direction.yaml \
  --json-output work/tts/direction-lint.json
python "$SKILL_DIR/scripts/compile_direction.py" work/tts/voice-direction.yaml \
  --manifest work/tts/minimax-render.jsonl \
  --meta work/tts/minimax-render.meta.json \
  --review work/tts/voice-direction-review.md \
  --lint-report work/tts/direction-lint.json \
  --subtitle-source work/tts/subtitle-source.txt
```

5. 用独立审查视角检查导演稿，不允许导演回合自己完成人工签发。审查通过后登记审查人和内容 hash：

```bash
python "$SKILL_DIR/scripts/mark_reviewed.py" work/tts/voice-direction.yaml \
  --reviewed-by "independent-review"
```

6. 向用户展示风险摘要和所有显式偏离。用户明确批准后才运行：

```bash
python "$SKILL_DIR/scripts/approve_direction.py" work/tts/voice-direction.yaml \
  --approved-by "<user>"
```

7. 批准后再编译一次，此时 meta 必须显示 `render_allowed=true`。

## 阶段二：生成、选 Take 与音频验收

如果项目使用本地 `.env`，先加载它，不要输出 API Key 或 Voice ID。

```bash
set -a
source "/path/to/project/.env"
set +a
python "$SKILL_DIR/scripts/render_segments.py" \
  --direction work/tts/voice-direction.yaml \
  --manifest work/tts/minimax-render.jsonl \
  --meta work/tts/minimax-render.meta.json \
  --output-dir work/audio/generated/minimax/candidates \
  --results work/audio/generated/minimax/render-results.json \
  --selection work/audio/generated/minimax/take-selection.yaml
```

对局部随机执行失败的段落，不改导演稿时可增加 Take：

```bash
python "$SKILL_DIR/scripts/render_segments.py" ... \
  --segment s004 --take-start 3 --takes 1
```

在 `take-selection.yaml` 中填入每段最终 Take，然后物化为按序号命名的 WAV：

```bash
python "$SKILL_DIR/scripts/select_takes.py" \
  --results work/audio/generated/minimax/render-results.json \
  --selection work/audio/generated/minimax/take-selection.yaml \
  --output-dir work/audio/generated/minimax/selected
```

裁掉每段自带的多余头尾静音，按导演边界重建停顿，再应用最终速度：

```bash
python "$SKILL_DIR/scripts/finalize_voice.py" \
  --direction work/tts/voice-direction.yaml \
  --manifest work/tts/minimax-render.jsonl \
  --meta work/tts/minimax-render.meta.json \
  --selected-dir work/audio/generated/minimax/selected \
  --output-dir work/audio/generated/minimax/final
```

以 `final/voice.wav` 听审，不用 `voice-paced.wav` 代替最终速度。干声通过后，还要在视频粗剪、BGM 和数字人口型上检查一次。

用户明确批准最终音频后：先把 `PROJECT_ROOT` 设为项目根目录的实际路径。该目录必须已存在，且路径中的任何一层都不能是符号链接；发布目录必须在此根目录之内。

```bash
PROJECT_ROOT="/absolute/path/to/project"
python "$SKILL_DIR/scripts/approve_audio.py" \
  --direction work/tts/voice-direction.yaml \
  --audio work/audio/generated/minimax/final/voice.wav \
  --approved-by "<user>"
python "$SKILL_DIR/scripts/publish_voice.py" \
  --direction work/tts/voice-direction.yaml \
  --audio work/audio/generated/minimax/final/voice.wav \
  --project-root "$PROJECT_ROOT" \
  --output-dir "$PROJECT_ROOT/public/assets/audio"
```

`publish_voice.py` 会先备份已有 `voice.*`，再发布 WAV/M4A/MP3。

## 阶段三：以最终音频生成字幕

1. 只对批准记录中 hash 匹配的 `work/audio/generated/minimax/final/voice.wav` 生成时间轴。M4A/MP3 是发布衍生物，不作为字幕时间基准。
2. 范铧屿本机项目默认使用 BaoCut 本地 `qwen3-asr-0.6b` 生成时间轴、SRT/VTT 和审计证据，并用专名词典修正“范铧屿”等固定词。该路径不上传音频。只有用户明确选择云端字幕服务时，才使用 `audio-to-subtitles` 完成 R2 上传和 MediaKit ASR，并再次确认上传边界。
3. ASR 只提供时间轴。用 `work/tts/subtitle-source.txt` 回填显示文本，删除所有 TTS 私有标记和发音辅助。
4. 项目交付到 `work/captions/`：`captions.srt`、`captions.vtt`、`captions_aligned.json`，并保留 raw ASR 和 `asr-result.json`。
5. 检查时间轴和显示文本后，把字幕绑定到已批准音频；本机工作室用 `video-handoff.json` 保存 BaoCut 项目编号、字幕路径和音频 hash。旧 MiniMax 项目仍可使用：

```bash
python "$SKILL_DIR/scripts/mark_subtitled.py" \
  --direction work/tts/voice-direction.yaml \
  --audio work/audio/generated/minimax/final/voice.wav \
  --srt work/captions/captions.srt \
  --vtt work/captions/captions.vtt \
  --aligned-json work/captions/captions_aligned.json
```

6. 任何 Take、最终速度或音频剪辑变化都使旧字幕时间轴失效，必须重生。
