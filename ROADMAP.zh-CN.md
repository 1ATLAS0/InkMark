# 迭代计划

版本发布均在本仓库进行。版本号跟随基座编辑器代次：`0.<次版本>.<修订号>`，次版本对应上游编辑器代次（当前
为 0.20），修订号记录 InkMark 的改动次数。发布标签以 `v` 开头，推送后触发发版流水线。

以下条目是计划而非承诺，优先级会随上游变更与测试结果调整。

## 0.20.x —— 可日常使用

已完成：

- 单个标签即可产出桌面端与 Android 端构建，发行版附带安装包、校验和与更新订阅文件（`latest.yml`）
- 品牌层由脚本维护，名称、标识符、图标与默认主题色可在合并上游后重放
- 建立测试基线：单元测试 946 项通过；Playwright 用例集在 Windows 上跑通。上游仅在 Linux 上运行该
  用例集，其中若干 Windows 相关假设需要修正。

待办：

- **大文档。** 打开 1 MB 的 Markdown 文件会让渲染进程主线程阻塞 30 秒以上，该数据来自发行版通过
  Chrome DevTools Protocol 的实测。几 KB 的文件不受影响。引擎在大输入下存在已知的二次复杂度问题。
- **Android 正式签名包。** 未配置 keystore secrets 前，发版流水线附带 debug 签名包。
- **更新往返验证。** 安装旧版本、确认其检测并应用新版本，这一完整流程尚未实测。
- **输入法。** Windows 上的微软拼音与搜狗、Android 上的 Gboard / 搜狗 / 百度 / 华为输入法均未测试。
- **编码。** GB18030/GBK 识别与 CRLF 处理需要用真实文件做一轮验证。

## 0.21 —— 编辑与导出

- 导出矩阵：经 Pandoc 导出 docx、odt、epub、LaTeX、OPML，并支持 PDF 页边距、页眉页脚与分页符
- 图片流程：相对 `assets` 目录策略，uPic 与自定义命令上传，失败重试与回滚
- Markdown 扩展：高亮、上下标、定义列表
- 中文排版：中英文间距、标点转换
- 表格编辑：列宽调整、行列操作、对齐方式
- 搜索：正则、大小写与全词匹配、跨文件搜索
- 主题：自定义 CSS 的导入与导出

## 0.22 —— 平台覆盖

- Linux 安装包：x64 与 arm64 的 AppImage、deb、rpm，并在银河麒麟 V10 + 飞腾 CPU 上验证
- Windows arm64 与 macOS 构建
- 覆盖全部目标平台的 CI 矩阵

## 已知问题

| 问题 | 影响 | 状态 |
|---|---|---|
| 1 MB 文档阻塞渲染进程 30 秒以上 | 该量级文档不可用 | 排查中 |
| Android 发行包为 debug 签名 | 启动器显示 debug 后缀 | 等待 keystore secrets |
| 缺少 macOS 与 Linux 构建 | 两个平台暂不支持 | 计划于 0.22 |
| 输入法与文件编码未验证 | 可能存在输入或解码问题 | 待测试 |

## 发布流程

1. 更新版本号：`desktop/package.json`、`desktop/packages/desktop/package.json`、
   `android/android/app/build.gradle`（`versionName` 与 `versionCode`）、`android/src/lib/appInfo.ts`
2. 检查品牌层：执行 `node tools/rebrand.mjs --dry-run`，应报告无改动
3. 如需本地验证：`tools\build-desktop.cmd`、`tools\build-android.cmd`
4. 创建并推送标签：`git tag -a v<版本> -m "<说明>"`。发版流水线会构建两端、创建发行版，并把运行结果写入
   `ci-status` 分支
5. 核对发行版内容：安装包、免安装压缩包、APK、`latest.yml`、`SHA256SUMS.txt` 均应在列

## 测试

- 单元测试（在 `desktop/` 下）：`npx pnpm@10 --filter inkmark test:unit`
- 端到端：`npx pnpm@10 --filter inkmark test:e2e`。Playwright 驱动本地 Electron 构建，无需下载浏览器
- 性能与编码：`node tools/perf-baseline.mjs`，结果写入 `perf/baseline.json`；测试物料由
  `tools/make-perf-fixtures.py` 生成
- 无仓库访问权限时查看 CI 结果：拉取 `ci-status` 分支并读取 `.ci/status.json`

## 维护说明

- 品牌层已脚本化。合并上游后重新执行 `tools/rebrand.mjs` 与 `tools/make_brand_assets.py`，不要手工解决
  这部分冲突
- 功能性改动尽量集中在少数上游文件中，以便上游合并可持续进行
- 发行版从 `main` 分支产出；`ci-status` 分支由 CI 写入，不要手工修改
