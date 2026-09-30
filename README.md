# InkMark

InkMark is a free, open-source Markdown editor for Windows, Linux, macOS and Android. Documents are
edited and rendered in one view: block markup stays visible while the cursor is inside a block and
collapses into formatted text when the cursor leaves it.

[中文说明](README.zh-CN.md) · [Roadmap](ROADMAP.md) · [Releases](https://github.com/1ATLAS0/InkMark/releases)

## Features

The desktop application is built with Electron; the Android application is built with Capacitor.
Both embed the same editor engine (Muya), so a document renders identically on either platform.

- Markdown: CommonMark and GFM, tables, task lists, footnotes, YAML front matter, emoji
- KaTeX math, Mermaid and flowchart diagrams, syntax highlighting, code block options
- File tree, outline, tabs, themes, source / focus / typewriter modes
- Export to HTML and PDF, and to Word and other formats through Pandoc
- Images: paste or drag in, copy to a local `assets` folder, or upload through PicGo and
  compatible command-line uploaders
- Autosave with crash recovery, spell checking, command palette, Chinese interface

## Status

In development. Windows installers, a portable ZIP and Android APKs are attached to every release
published from this repository. Planned work and known problems are tracked in [ROADMAP.md](ROADMAP.md).

## Install

Download the latest build from [Releases](https://github.com/1ATLAS0/InkMark/releases).

- Windows: `inkmark-win-x64-<version>-setup.exe` (installer) or `inkmark-win-x64-<version>.zip`
  (portable, unpack and run)
- Android: `InkMark-<version>-android.apk`. Installation requires allowing installs from unknown
  sources.
- macOS and Linux packages are not built yet.

## Build from source

Requirements: Node.js 20 or newer, pnpm 10 (`npx pnpm@10` works without a global install), and
Python 3 for icon generation.

Desktop (Windows):

    tools\build-desktop.cmd

Android:

    tools\build-android.cmd

Toolchain notes:

- The desktop build needs Visual Studio with the C++ toolchain. The script sets
  `msvs_version=2019` because some VS2022 installations do not register the VC components that
  node-gyp resolves through vswhere, which makes the compiler lookup fail.
- Electron binaries are downloaded from the npmmirror mirror.
- `tools/patch-native-keymap.mjs` removes the Spectre-mitigated library requirement of
  `native-keymap`; that component is not installed by every Visual Studio workload.
- The Android build needs JDK 21 (Capacitor 8 compiles against Java 21) and an Android SDK with
  `platforms;android-36` and `build-tools;36.0.0`.
- APK signing: `tools\make-keystore.cmd` creates a keystore and `tools\sign-apk.cmd` signs an APK.
  Keystores and passwords are not stored in the repository; CI reads them from repository secrets
  (`ANDROID_KEYSTORE_BASE64`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
  `ANDROID_KEY_PASSWORD`). Without those secrets the release workflow publishes a debug-signed APK.

## Repository layout

    desktop/    Electron application
    android/    Capacitor application
    tools/      build, branding, signing and measurement scripts
    demo*.md    documents used to check rendering output
    ROADMAP.md  milestones, known issues and release process

## Branding

`tools/rebrand.mjs` keeps the product name, application IDs and repository URLs in one place; run
`node tools/rebrand.mjs` after editing it. `tools/make_brand_assets.py` generates the icon set
(ICO, ICNS and PNG for desktop, launcher icons for Android, favicon) from a single specification.

## License and attribution

InkMark is built on MIT-licensed projects and keeps their copyright notices:

- [marktext/marktext](https://github.com/marktext/marktext) — desktop base
- [@muyajs/core](https://github.com/marktext/muya) — editor engine
- [Renakoni/marktext-android](https://github.com/Renakoni/marktext-android) — Android base

Bundled third-party components such as KaTeX, Mermaid and Prism.js keep their own licenses, which
are included with each release.

InkMark is an independent community project and is not affiliated with or endorsed by the projects
listed above.
