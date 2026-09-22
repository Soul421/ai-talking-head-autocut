# 字体说明（包体精简）

本 skill 包为了满足 ≤20MB 的上传限制，**未打包 Noto Sans SC 字体**（3 个 TTF 约 30MB）。

## 需要字体时

项目模板路径：

```
skills/talking-head-hyperframes/assets/hyperframes-project/assets/fonts/
```

请自行放入：

| 文件 | 来源 |
| --- | --- |
| NotoSansSC-400.ttf | [Google Fonts · Noto Sans SC](https://fonts.google.com/noto/specimen/Noto+Sans+SC) |
| NotoSansSC-500.ttf | 同上（Medium） |
| NotoSansSC-700.ttf | 同上（Bold） |
| SpaceGrotesk-400.ttf | 包内已含 |

也可用系统字体替代：在 `styles.css` / `DESIGN.md` 中把字体族改成 `"PingFang SC", "Microsoft YaHei", sans-serif`。

## 完整包

含字体的完整仓库见 GitHub：

https://github.com/Soul421/ai-talking-head-autocut

（Release `assets-v1` 也可单独下载字体。）
