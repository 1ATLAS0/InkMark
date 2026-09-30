# InkMark

InkMark 是一个免费、开源的 Markdown 编辑器，支持 Windows、Linux、macOS 与 Android。编辑与渲染在同一视图中完成：
光标位于某个块内时显示该块的标记符号，光标离开后标记折叠为排版结果。

[English](README.md) · [迭代计划](ROADMAP.zh-CN.md) · [发行版](https://github.com/1ATLAS0/InkMark/releases)

## 功能

桌面端基于 Electron，Android 端基于 Capacitor，两端内嵌同一个编辑引擎（Muya），同一份文档在两端渲染结果一致。

- Markdown：CommonMark 与 GFM、表格、任务列表、脚注、YAML front matter、emoji
- KaTeX 数学公式、Mermaid 与 flowchart 图表、代码高亮、代码块行号与折行
- 文件树、大纲、标签页、主题、源码 / 专注 / 打字机模式
- 导出 HTML 与 PDF，并通过 Pandoc 导出 Word 等格式
- 图片：粘贴或拖入，复制到本地 `assets` 目录，或经 PicGo 及兼容的命令行上传器上传
- 自动保存与崩溃恢复、拼写检查、命令面板、中文界面

## 当前状态

开发中。本仓库发布的每个版本都附带 Windows 安装包、免安装压缩包与 Android APK。
计划中的工作与已知问题记录在[迭代计划](ROADMAP.zh-CN.md)中。

## 安装

从 [Releases](https://github.com/1ATLAS0/InkMark/releases) 下载最新构建。

- Windows：`inkmark-win-x64-<version>-setup.exe`（安装版）或 `inkmark-win-x64-<version>.zip`（解压即用）
- Android：`InkMark-<version>-android.apk`，安装时需允许"未知来源"
- macOS 与 Linux 安装包尚未提供

## 从源码构建

依赖：Node.js 20 及以上、pnpm 10（无需全局安装，用 `npx pnpm@10` 即可）、生成图标需要 Python 3。

桌面端（Windows）：

    tools\build-desktop.cmd

Android 端：

    tools\build-android.cmd

工具链说明：

- 桌面端构建需要带 C++ 工具链的 Visual Studio。脚本内设置 `msvs_version=2019`，原因是部分 VS2022
  安装未向 vswhere 注册 VC 组件，会导致 node-gyp 找不到编译器。
- Electron 二进制经 npmmirror 镜像下载。
- `tools/patch-native-keymap.mjs` 去掉 `native-keymap` 对 Spectre 缓解库的要求，该组件并非所有
  Visual Studio 工作负载都会安装。
- Android 构建需要 JDK 21（Capacitor 8 以 Java 21 编译）以及包含 `platforms;android-36` 与
  `build-tools;36.0.0` 的 Android SDK。
- APK 签名：`tools\make-keystore.cmd` 生成 keystore，`tools\sign-apk.cmd` 完成签名。keystore 与口令
  不进入版本库，CI 从仓库 secrets 读取（`ANDROID_KEYSTORE_BASE64`、`ANDROID_STORE_PASSWORD`、
  `ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`）；未配置这些 secrets 时，发版流水线发布 debug 签名包。

## 目录结构

    desktop/    Electron 桌面端
    android/    Capacitor 安卓端
    tools/      构建、品牌、签名与测量脚本
    demo*.md    用于检查渲染结果的示例文档
    ROADMAP.md  里程碑、已知问题与发布流程

## 品牌化

`tools/rebrand.mjs` 集中保存产品名、应用 ID 与仓库地址，修改后运行 `node tools/rebrand.mjs` 即可生效。
`tools/make_brand_assets.py` 按单一规格生成整套图标（桌面端 ICO / ICNS / PNG、Android 启动图标、favicon）。

## 许可证与致谢

InkMark 基于以下 MIT 许可项目构建，并保留其版权声明：

- [marktext/marktext](https://github.com/marktext/marktext) —— 桌面端基座
- [@muyajs/core](https://github.com/marktext/muya) —— 编辑引擎
- [Renakoni/marktext-android](https://github.com/Renakoni/marktext-android) —— Android 端基座

随包分发的 KaTeX、Mermaid、Prism.js 等第三方组件保留各自许可证，随各发行版一并提供。

InkMark 为独立社区项目，与上述项目及其维护者不存在隶属或背书关系。
