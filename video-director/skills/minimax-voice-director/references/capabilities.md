# MiniMax Speech 执行边界

读取本文件的时机：导演稿使用 sound tag、局部 API 参数、字幕元数据，或在 MiniMax 发布新模型后做回归验证时。

## 能力等级

- `native`：当前官方 HTTP 文档明确支持，仍需听审执行效果。
- `approximate`：导演层存在意图，但通过文本改写、分段、整段参数和多 Take 近似实现。
- `experimental`：文档与旧封装之间不完全一致，只能在小样本 A/B 后使用。
- `unsupported`：不得宣称引擎能执行。

## Speech 2.8 当前映射

| 导演意图 | 等级 | MiniMax 实现 |
|---|---|---|
| 段内定时停顿 | native | `<#x#>`，x 为秒 |
| 呼吸、叹气、迟疑、笑声等 | native | Speech 2.8 HTTP sound tags |
| 整段 speed/vol/pitch | native | `voice_setting` |
| 语言增强 | native | `language_boost` |
| 句级/词级字幕元数据 | native | `subtitle_enable` + `subtitle_type` |
| 词级重音 | approximate | 信息结构、句法、意群、整段参数和 Take 挑选 |
| 局部速度曲线 | approximate | 口语改写或完整意群分段 |
| 局部音高 contour | unsupported/approximate | 只能依靠问句语义、标点和 Take 选择 |
| Speech 2.8 `emotion` 字段 | experimental | 现有旧封装可发送，但当前 HTTP schema 未清晰列出 |

## HTTP 共通 sound tags

`speech-2.8-hd` 和 `speech-2.8-turbo` 支持的共通列表：

```text
laughs, chuckle, coughs, clear-throat, groans, breath, pant,
inhale, exhale, gasps, sniffs, sighs, snorts, burps,
lip-smacking, humming, hissing, emm, sneezes
```

不要把其他端点中出现的 `whistles/crying/applause` 自动当成同步 HTTP T2A 共通能力。

## 静态规则不等于执行保证

sound tag 和停顿语法合法，只说明请求可以提交；不保证强度、时长和风格正确。每个新声线或模型更新都应先用 20–40 秒回归稿测试，再生成全片。
