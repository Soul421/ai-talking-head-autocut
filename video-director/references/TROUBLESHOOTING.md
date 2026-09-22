# 效果不好？先看这里

使用本 skill 时若成片不对劲，**90% 不是 skill 坏了，是接错了模型或跳过了门禁**。

## 30 秒自查

```bash
python3 video-director/scripts/doctor.py
```

有 ✗ 先修；有 ⚠ 看提示。然后再动画面。

## 最常见的 4 种翻车

| 现象 | 真正原因 | 怎么修 |
| --- | --- | --- |
| 声音是复读机/不是人话 | 克隆 ref_text 与参考音不符，或 TTS 当英文念 | 跑最新 `voice-studio`（会 ASR 自动对齐 ref_text，强制 `--lang_code zh`） |
| 脸很假、口型不对 | 用了不该用的模型，或拿短 take 配长稿 | 查 [digital-human-routing.md](../references/digital-human-routing.md) §2；脸视频时长必须=锁定音频 |
| 音画不同步 | 用预览音/剪过的 take 进合成 | 只用 `video-handoff.json` 里的 `locked_audio` |
| 和官方 demo 差很远 | 没接 HeyGen 真脸 + 用了占位 PIP | 路由表 §1 S4；或接受占位并写进交付说明 |

## 该接哪个数字人？

**不要猜。** 打开：

`video-director/references/digital-human-routing.md`

- 按**生产阶段**（S1–S6）查「此刻该不该出脸」
- 按**需求**（像真人 / 本地免费 / 只要版式）选服务
- 复制 §3 决策树、§4 五项检查

## 责任边界（请转告你的客户）

本 skill 保证：音文一致、时间轴对齐、人工门禁、可追溯。  
本 skill **不保证**：某家数字人的脸好不好看、肖像是否授权、平台是否过审。

交付说明模板：

> 数字人由 ________（HeyGen / 其他）提供；形象与声音授权由使用方负责。
