# InkMark

免费、开源的 Markdown 编辑器，目标是在功能上对齐 Typora，并同时提供**桌面端与 Android 端**。

- 桌面：Electron + [Muya](https://github.com/marktext/muya) 引擎（实时预览 / 所见即所得）
- Android：Capacitor + 同一 Muya 引擎 → **双端渲染完全一致**
- 支持：CommonMark / GFM、表格、KaTeX 数学公式、Mermaid 流程图、代码高亮、任务列表、
  大纲、文件树、标签页、主题、HTML / PDF 导出、Pandoc 导出 Word、PicGo 图床、拼写检查、
  自动保存与恢复、中文界面

> 当前状态：**v0.1 PoC 已完成**（双端可运行成品已产出），迭代计划见 [ROADMAP.md](ROADMAP.md)。

## 下载

见 [Releases](https://github.com/1ATLAS0/InkMark/releases)。

- Windows：`InkMark-*-setup-win-x64.exe`（安装版）或 `-portable.zip`（免安装）
- Android：`InkMark-*-android.apk`（需允许"未知来源"安装）

## 从源码构建

前置：Node 20+、pnpm（用 `npx pnpm@10` 亦可）、Python 3（生成图标）

### Windows 桌面

```
tools\build-desktop.cmd
```

需要 Visual Studio 2019 BuildTools（含 C++ 工具链）。脚本内部已固化必要环境：

- 强制 `msvs_version=2019`（部分 VS2022 安装的 VC 组件未注册到 vswhere，会导致 node-gyp 找不到编译器）
- Electron 使用 npmmirror 镜像下载
- `tools/patch-native-keymap.mjs` 关闭 `native-keymap` 的 Spectre 库要求（未安装该 VS 组件时必需）

### Android

```
tools\build-android.cmd
```

需要 **JDK 21**（Capacitor 8 的 `sourceCompatibility` 为 21）、Android SDK（platforms;android-36、build-tools;36.0.0）。
签名相关：`tools\make-keystore.cmd` 生成 keystore，`tools\sign-apk.cmd` 签名。

## 目录结构

```
desktop/   Electron 桌面端（fork 自 marktext/marktext，MIT）
android/   Android 端（fork 自 Renakoni/marktext-android，MIT）
tools/     品牌资产生成、品牌化脚本、构建脚本、签名与截图工具
ROADMAP.md 版本迭代计划
demo*.md   渲染能力演示文档
```

## 品牌化（改名 / 换色 / 换图标）

- 改 `tools/rebrand.mjs` 顶部的 `BRAND` 常量后运行 `node tools/rebrand.mjs`（幂等，会自动校验上游改动）
- 改 `tools/make_brand_assets.py` 顶部的 `BRAND` 设计规格后运行，重新生成全套图标（桌面 ico/icns/png + Android mipmap + favicon）

## 许可证与致谢

本项目基于以下 MIT 许可的开源项目构建，保留其版权声明：

- [marktext/marktext](https://github.com/marktext/marktext) — 桌面端基座
- [@muyajs/core](https://github.com/marktext/muya) — Markdown 编辑器引擎
- [Renakoni/marktext-android](https://github.com/Renakoni/marktext-android) — Android 端基座

同时随包分发 KaTeX、Mermaid、Prism.js 等第三方组件，其许可证随发行包一并提供。

**声明**：本项目为非官方社区项目，与 Typora、MarkText 及其维护者无隶属或背书关系；
不含任何 Typora 的代码或素材。Typora 是其各自所有者的商标。
