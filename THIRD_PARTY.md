# 第三方软件与授权

这个 repo 本身没有包含、也没有修改任何第三方源代码。下列工具只在构建或测试时由用户自行安装、以外部程序的方式调用：

| 工具 | 用途 | 授权 | 是否包含在 repo |
|---|---|---|---|
| [JPEXS Free Flash Decompiler (FFDec)](https://github.com/jindrapetrik/jpexs-decompiler) 22.0.2 | 把矢量图形渲染成 PNG、变形图形导出成 SVG、导出 MP3 音效 | GPL-3.0（程序）／LGPL-3.0（`ffdec_lib`） | 否。`tools/get_ffdec.py` 从官方 GitHub Releases 下载并验证 SHA-256，放到 `third_party/`（已列入 `.gitignore`） |
| Java 8 以上 | 运行 FFDec | 依各发行版（例如 OpenJDK：GPL-2.0 + Classpath Exception） | 否 |
| Python 3.8 以上 | 构建脚本 | PSF License | 否 |
| [Pillow](https://python-pillow.org/) | 读 PNG、输出无失真 WebP | MIT-CMU（HPND） | 否，`pip install -r requirements.txt` |
| Node.js（可选） | `node --check` 检查生成的 JS、跑测试 | MIT | 否 |
| [Playwright](https://playwright.dev/)（可选，只用于测试） | 用无头 Chromium 自动跑一场对战 | Apache-2.0 | 否，`npm install` |

FFDec 是 GPL 授权，但本项目只是把它当成独立程序运行（通过命令行），没有链接、也没有分发它，所以本项目的 MIT 授权不受影响。若你要把 FFDec 一起打包分发，请遵守它的 GPL-3.0 条款。

`runtime/` 里的运行环境是手写的，没有拷贝其他项目的代码。影格动作运行顺序参考了 [Ruffle](https://github.com/ruffle-rs/ruffle)（MIT / Apache-2.0）的做法，但没有使用它的代码。
