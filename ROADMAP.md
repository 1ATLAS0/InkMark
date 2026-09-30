# InkMark 版本迭代计划

> 目标：免费的、功能对齐 Typora 的 Markdown 编辑器，桌面 + Android 双端可用（并覆盖信创 ARM64）。
> 制定日期：2026-09-29　|　基线版本：v0.1 PoC（双端可运行成品已产出）

---

## 0. 基线盘点（v0.1，已完成）

**已完成**

| 项 | 状态 |
| --- | --- |
| 桌面 Windows x64 安装包 / 免安装包 | ✅ 实测可运行（Electron 42.1.0） |
| Android 签名版 APK | ✅ `com.inkmark.app`，证书 CN=InkMark |
| 品牌化（名称 / appId / 图标 / 默认主题强调色 / 中文界面） | ✅ 41 个文件，脚本化可重放（`tools/rebrand.mjs`） |
| 双端共用引擎 | ✅ 均为 Muya（桌面 Electron 内嵌 / 安卓 Capacitor 内嵌） |
| 一键构建脚本、APK 签名工具链、截图工具 | ✅ `tools/` |
| 渲染能力验证 | ✅ 表格 / KaTeX / Mermaid / 代码高亮 / 任务列表 / front matter |

**遗留（必须在 v0.2 清掉，否则是"半成品感"来源）**

- 更新检查仍指向上游（桌面 electron-updater 无 publish 源、安卓 `appInfo.ts` 的 URL 指向上游仓库）→ 会引导用户装回上游版本
- exe 元数据 `CompanyName=Jocs`、无代码签名（首装 SmartScreen 提示）
- 没有自有仓库 → 无法做 CI、无法发版、无法协作
- 未做真机矩阵测试（麒麟 ARM64 / Android 各厂商输入法）
- 名称 `InkMark` 是占位，未做商标与域名初筛

---

## 1. 目标、约束与时间预算

**硬约束**

1. 免费（许可链路：MarkText/muya/marktext-android 均 MIT；随包分发第三方组件需保留其许可证）
2. 功能对齐 Typora（分三档推进，见附件 A）
3. 双端体验一致（同一引擎是最大红利，务必守住）
4. 信创可跑（银河麒麟 V10 + 飞腾 D3000 ARM64，你手上有 20 台现成验证环境）

**软约束**

- 不复制 Typora 的代码 / 图标 / 主题 CSS / 文案（功能对齐合法，素材复制不合法）
- 改动分层：品牌层（可脚本重放）+ 功能层（薄补丁）→ 便于跟随上游

**时间预算（按 1 人计，需你校准）**

| 投入方式 | 到 v0.2（能日常用） | 到 v1.0（可发布） |
| --- | --- | --- |
| 全职 | 2 周 | 约 14–16 周 |
| 业余（每天 2–3h） | 3–4 周 | 约 5–6 个月 |

**关键判断**：v0.2 结束就能当主力编辑器天天用；后面每一版都是"更好"，而不是"才可用"。

---

## 2. 版本节奏总览

| 版本 | 主题 | 一句话目标 | 建议周期 | 核心验收 |
| --- | --- | --- | --- | --- |
| **v0.2** | 可用与闭环 | 能当主力编辑器，更新/发布链路自洽 | 2 周 | 你连续用 7 天，零数据丢失、零阻塞崩溃 |
| **v0.3** | 对齐 Typora（一档） | 日常使用面上不输 Typora | 3 周 | 附件 A 的第一档全部打勾 |
| **v0.4** | 移动端可用 | 安卓从"能开"到"能用" | 3 周 | 手机端连续编辑 7 天，无丢字无卡死 |
| **v0.5** | 全平台与信创 | 覆盖麒麟 ARM64 + CI 自动出包 | 3 周 | 飞腾机器完成"打开 10MB → 编辑 → 导出 PDF" |
| **v0.6** | 打磨与稳定 | 长稳、安全、文档齐备 | 3 周 | 100 人内测问题收敛 |
| **v1.0** | 正式发布 | 对外发版，签名+渠道+公告 | 2 周 | 干净机器全流程通过（附件 B） |

---

## 3. 各版本详细任务

### v0.2 「可用与闭环」

**目标**：把自己从"试用者"变成"用户"，同时把发布链路从上游摘干净。

> **执行记录（2026-09-30）** — 本机与 CI 双线推进，已完成下列条目：
> - 仓库：`github.com/1ATLAS0/InkMark`（私有，单仓库 monorepo：desktop/ + android/ + tools/）
> - 推送链路：本机直连 github.com 被间歇阻断，改用 **SSH over 443**（`ssh://git@ssh.github.com:443/…`）稳定推送
> - 更新链路：桌面 `publish` → 本仓库 Releases，已生成 `app-update.yml`；安卓 `appInfo` 三个地址已改指本仓库
> - 版本号：统一 `0.20.1`（桌面/安卓同步，versionCode 5）；元数据 author/CompanyName → 1ATLAS0
> - CI：tag 触发 → Windows 安装包 + Android APK → 自动建 Release（含 latest.yml 与 SHA256SUMS）；
>   `report` job 把运行结果与失败日志写到 `ci-status` 分支（私有仓库下的可观测通道）
> - 真实缺陷修复：**Windows 标题栏从不显示目录层级**（preload 暴露的 `path.sep` 取自 pathe，恒为 `/`）
> - 测试基线：单元 **946 通过 / 0 失败**；e2e 全量在 **Windows 本机**跑通（上游 e2e 只在 ubuntu 跑，
>   暴露并修复 5 处 Windows 假设：file:///C:/ 前缀、.cmd 需 shell、双击选词带尾随空格等）
> - 工具：`tools/perf-baseline.mjs`（CDP 测启动/渲染 + GBK/CRLF 校验）、`tools/probe-dom.mjs`（DOM 探针）

任务清单：

- [x] 建立自有仓库并推送（单仓库 monorepo：desktop/android/tools 统一管理）
- [x] 更新链路闭环
  - [x] 桌面：`electron-builder.yml` 增加 `publish: github(1ATLAS0/InkMark)`，生成 `app-update.yml`
  - [x] 安卓：`src/lib/appInfo.ts` 的 `releasesUrl` / `latestReleaseApiUrl` 改为自有仓库
  - [ ] 双端各跑一次"旧版 → 检测到新版 → 更新"演练（待首个 Release 落地后做）
- [x] 元数据
  - [x] `author` / `CompanyName` → 1ATLAS0；版本号统一 0.20.1
  - [ ] 申请代码签名证书（Windows：Azure Trusted Signing，**需先核实中国开发者资格**；备选 OV 证书）
  - [ ] APK 换用长期 keystore（当前 `tools/keystore/inkmark.jks` 是 PoC 口令 `inkmark-poc`，正式分发前必须更换并离线备份；换 keystore 会导致已装用户无法覆盖升级）
- [~] 稳定性基线
  - [x] 跑通上游测试套件（单元 946 通过；e2e 全量在 Windows 跑通，含 5 处用例修正 + 1 个真实 bug 修复）
  - [ ] 大文档性能基线：1MB / 5MB / 10MB 打开与滚动耗时（脚本 `tools/perf-baseline.mjs` 已就绪，待记录数值）
  - [ ] 文件编码与换行实测（GBK / CRLF 样例已备，随性能基线一起跑）
  - [ ] 中文输入法真机测试（桌面：微软拼音 / 搜狗；安卓：Gboard / 搜狗 / 百度 / 华为）
- [ ] 首次体验：欢迎页/空白页文案、默认快捷键说明、语言跟随系统

**验收**：连续 7 天作为主力编辑器使用；无数据丢失；崩溃可恢复（草稿恢复机制实测）。

---

### v0.3 「对齐 Typora 一档」

**目标**：附件 A 里"第二档：需补齐"的功能全部落地。

- [ ] **导出矩阵**：HTML / PDF 已有 → 补 Pandoc 通道：docx、odt、epub、LaTeX、GFM Markdown、OPML
  - [ ] 导出选项 UI：页边距、页眉页脚、分页符、页码、纸张
  - [ ] Pandoc 缺失时的引导（下载/配置路径）与失败回滚
- [ ] **图片体系**：粘贴 / 拖拽 → 复制到 `./assets` 相对路径策略 → PicGo / uPic / 自定义命令上传 → 上传失败回滚与重试
- [ ] **中文排版**：中英文自动间距、中文标点智能转换、`==高亮==`、上下标、定义列表
- [ ] **表格细节**：列宽拖拽、行列增删快捷键、对齐切换、单元格内换行、跨行选择
- [ ] **查找替换**：正则、大小写敏感、全词匹配；跨文件搜索（可复用已在依赖里的 `@vscode/ripgrep`）
- [ ] **侧栏与大纲**：文件树排序/排除规则、拖拽移动、大纲跳转、文档内锚点
- [ ] **主题**：内置 InkMark 浅色/深色主题打磨；CSS 主题导入导出；Typora 主题迁移说明（用户自制主题可参考，**不得内置其素材**）

**验收**：附件 A 第一档清单 100% 打勾；与 Typora 并排操作 10 个典型任务无落差。

---

### v0.4 「移动端可用」

**目标**：安卓端从"能打开文件"变成"愿意用"。

- [ ] **文件与意图**：SAF 单文件打开、最近列表、目录授权（已有插件基础：`DocumentGrantPolicy` / `ContentResolverDocumentIo`）、外部"用 InkMark 打开"、分享接收
- [ ] **编辑体验**：软键盘工具条（加粗/标题/列表/表格/图片）、选区手柄与长按菜单、粘贴 HTML→Markdown、相册/拍照插图（`ImportedImageStorage` 已有）
- [ ] **触摸优先 UI**：首页最近文档与草稿恢复、暗色模式、字号/行距/行宽设置、只读预览切换
- [ ] **输入法深测**：候选词上屏、拼音期间光标跳动、模糊音、emoji、华为 WebView 兼容（已有版本闸门）
- [ ] **性能**：4GB 内存中低端机型打开 1MB 文档耗时 < 2s；长文档滚动不卡顿
- [ ] **分享导出**：分享为 HTML；PDF 走系统打印服务（Chromium 打印在 Android 上受限，需评估替代）

**验收**：手机端连续编辑 7 天；与桌面通过同一文件夹（网盘/Syncthing）同步无冲突。

---

### v0.5 「全平台与信创」

**目标**：覆盖你自己的麒麟/飞腾环境，并让出包自动化。

- [ ] **Linux**：AppImage / deb（x64 + **arm64**）/ rpm；在银河麒麟 V10 SP1 飞腾 D3000 实机验证（glibc、字体、FCITX 输入法、沙箱、启动参数）
- [ ] **Windows arm64** 构建
- [ ] **macOS**：dmg（不签名，README 说明首次 `xattr -cr`；签名=Apple Developer $99/年，可选）
- [ ] **CI/CD**：GitHub Actions 矩阵 —— win x64/arm64、linux x64/arm64、mac x64/arm64、android APK/AAB；tag 触发自动发 Release（含 SHA256SUMS）
- [ ] **自更新**：打包源接入 CI 产物；安卓自更新指向自有仓库并实测
- [ ] （可选）崩溃收集：优先本地日志；如需远程，自建端点而非引入第三方

**验收**：麒麟 ARM64 机器完成"打开 10MB 文档 → 编辑 → 导出 PDF"全流程；一次打 tag 自动产出全平台包。

---

### v0.6 「打磨与稳定」

- [ ] 长稳与性能：长时间编辑内存曲线、10MB+ 文档编辑优化、恢复机制压力测试
- [ ] 安全审计：`webPreferences`（contextIsolation / sandbox / nodeIntegration）固化并加断言（上游已有 `context-isolation.spec.ts` 可扩展）；外链白名单；图片上传命令注入防护
- [ ] 无障碍与键盘：全键盘可达、焦点可见、快捷键自定义实测（上游有 `keybindings.json` 机制）
- [ ] 文档：使用手册、与 Typora 差异说明、迁移指南（Typora 主题/CSS 兼容性）
- [ ] 治理文件：LICENSE 与 ATTRIBUTION（上游 MIT 署名 + 商标声明"非官方/与上游无隶属关系"）、CONTRIBUTING
- [ ] 内测：找 10–100 人试用，问题收敛

---

### v1.0 「正式发布」

- [ ] 版本号与 CHANGELOG 策略固化（见 §4.5）
- [ ] 发布流程文档化 + 演练（附件 B）
- [ ] 渠道：GitHub Releases（主）、F-Droid（可选，免费）、官网下载页（静态页即可）
- [ ] 发布公告 + 演示文档/视频 + 常见问题
- [ ] 干净机器验收：安装 → 编辑 → 导出 → 卸载无残留（除 SmartScreen 提示，若证书已到位则无）

---

## 4. 贯穿性工程实践

### 4.1 分支与上游同步（每月一次）

```bash
# 桌面
cd desktop && git remote add upstream https://github.com/marktext/marktext.git
git fetch upstream && git checkout -b sync/upstream-YYYYMM && git merge upstream/develop
# 冲突集中在品牌层 → 若冲突过多，直接重放品牌：git checkout upstream/develop -- . && node ../tools/rebrand.mjs
cd android && git remote add upstream https://github.com/Renakoni/marktext-android.git
# 同上流程（安卓改动更少，冲突概率低）
```

**同步后的必检项**：`node tools/rebrand.mjs`（幂等，会报告"上游改动导致规则失效"）、双端各跑一次构建、跑 e2e 冒烟。

### 4.2 改动分层原则（决定长期维护成本）

| 层 | 内容 | 维护方式 |
| --- | --- | --- |
| 品牌层 | 名称/appId/图标/默认主题色/文案 | 全部脚本化（`rebrand.mjs` + `make_brand_assets.py`），可随时重放 |
| 功能层 | 新增能力（导出矩阵、中文排版…） | 薄补丁 + 独立模块，尽量少碰上游文件，便于 rebase |
| 上游层 | 引擎与主体功能 | 只跟随，不魔改 |

### 4.3 测试策略（复用上游现成设施）

- **桌面**：90 个 Playwright e2e（`test/e2e/*.spec.ts`）+ 引擎 vitest + 单元测试 → 每次改动的回归闸门
- **安卓**：`tests/e2e/mobile-*.spec.ts` + vitest
- **新增**：每修一个 bug 补一个用例；发布前跑附件 B 的冒烟清单
- **真机矩阵**：见附件 C

### 4.4 发布流程（每个版本重复）

1. `node tools/rebrand.mjs --dry-run` 确认品牌一致
2. 双端构建：`tools\build-desktop.cmd`、`tools\build-android.cmd`
3. 跑 e2e 冒烟 + 附件 B 清单
4. 计算 SHA256、写 CHANGELOG、打 tag
5. 上传 GitHub Release（CI 自动化后仅需打 tag）
6. 自更新演练（旧版 → 新版）

### 4.5 版本号策略

- 跟随上游阶段：`0.2x` 保持与上游大版本对齐（便于判断底座），用第四段表示我方迭代（如 `0.20.0-ink.3`）
- v1.0 起切换自有语义化版本：`MAJOR.MINOR.PATCH`，MAJOR 只在格式/行为不兼容时递增

---

## 5. 风险登记表

| 风险 | 影响 | 概率 | 缓解 | 触发信号 |
| --- | --- | --- | --- | --- |
| 上游持续重构（muya v2 仍在 RC） | 同步成本高、功能被打断 | 高 | 锁版本 + 每月同步 + 改动分层；必要时冻结上游版本只做自己迭代 | 同步冲突超 1 天工作量 |
| marktext-android 单人维护、作者备考 | 安卓侧上游停滞 | 高 | 我们 fork 自己维护（已做）；关键路径不依赖上游新功能 | 上游 3 个月无提交 |
| 麒麟 ARM64 兼容（glibc / 输入法 / 沙箱） | 信创机器跑不起来 | 中 | v0.5 前用 1 台机器提前试跑 Electron ARM64；准备 `--no-sandbox` 等回退方案 | 实机启动失败或输入法不工作 |
| 代码签名资格（Azure 国内个人受限） | 首装体验差、企业分发受阻 | 中 | 先接受 SmartScreen 提示；同时评估 OV 证书 / 自建签名说明页 | 申请被拒 |
| 名称/商标冲突 | 发布后被迫改名 | 低-中 | v0.5 前做一次商标与域名初筛；品牌层已脚本化，改名成本约 1 小时 | 检索到近似商标 |
| Android 厂商 WebView 差异（华为等） | 白屏/排版异常 | 中 | 已有版本闸门；建立机型测试清单（附件 C） | 用户反馈白屏 |
| 单人精力不足（本职工作冲突） | 版本延期 | 高 | 每版都留"可停可交付"的收尾点；v0.2 后即使停更也能自用 | 连续两周无法推进 |

---

## 附件 A：Typora 功能对照清单

**第一档：已具备**（v0.1 实测验证）

- [x] 实时预览 WYSIWYG、源码 / 专注 / 打字机三种模式
- [x] CommonMark + GFM、KaTeX 数学、Mermaid / flowchart
- [x] front matter、emoji、表格、图片粘贴、大纲、文件树、标签页
- [x] HTML / PDF 导出、Pandoc 导出 Word、PicGo 图床上传、拼写检查
- [x] 自动保存与恢复、中文界面、CLI

**第二档：需补齐**（→ v0.3）

- [ ] 导出矩阵补全（docx/odt/epub/latex/OPML）+ 排版选项
- [ ] 图床协议完整性（uPic / 自定义命令 / 相对路径策略）
- [ ] `==高亮==`、上下标、定义列表
- [ ] 中文排版（中英间距、标点智能转换）
- [ ] 表格 WYSIWYG 细节（列宽拖拽、行列增删）
- [ ] 查找替换（正则 / 跨文件）
- [ ] PDF 排版选项（页边距 / 页眉页脚 / 分页符）
- [ ] 主题导入导出与迁移说明

**第三档：可延后**（v1.0 之后）

- [ ] 图床服务商 API 直连、发布到博客/公众号
- [ ] 版本对比、协作、云同步
- [ ] 移动端专属能力（手写、语音转写）

---

## 附件 B：发布前检查清单

**打包前**

- [ ] `tools/rebrand.mjs --dry-run` 无待改项
- [ ] 版本号已更新（desktop/android 三处：package.json、build.gradle versionName、appInfo.ts）
- [ ] CHANGELOG 已写

**打包后（双端）**

- [ ] Windows：安装包可装可卸；`--disable-gpu` 与默认两条路径都能启动；打开 md 关联正常
- [ ] Linux（v0.5 起）：AppImage 免安装可运行；deb 可装
- [ ] 安卓：APK 可装可升（覆盖安装旧版）；SAF 目录授权后能读写；中文输入法候选词正常
- [ ] 三件事实测：打开 → 编辑 → 导出（PDF/Word）
- [ ] SHA256SUMS 生成并随 Release 发布
- [ ] 自更新演练：旧版检测到新版并能完成更新

**发布后**

- [ ] Release 说明包含：新功能、修复、已知问题、升级方式
- [ ] 回滚预案：保留上一个版本的安装包与 APK

---

## 附件 C：真机测试矩阵

| 平台 | 设备/系统 | 重点 |
| --- | --- | --- |
| Windows x64 | Win10 21H2 / Win11 | 安装、关联、深色模式、DPI 缩放 |
| Windows arm64 | 骁龙 X 机型或虚拟机 | 启动与输入法 |
| 麒麟 ARM64 | 银河麒麟 V10 SP1 + 飞腾 D3000（你现成 20 台） | glibc、FCITX、字体、导出 PDF |
| Ubuntu | 22.04 / 24.04 | deb 安装、Wayland/X11 |
| Android | 华为（鸿蒙 WebView）、小米、三星、低端 4GB 机 | 输入法、SAF、长文档性能、暗色模式 |

---

## 附件 D：立刻可执行的下一步（v0.2 起点）

```bash
# 1. 建仓库并推送（三处各自的 git 历史已就绪）
#    desktop/ 与 android/ 各有两次提交：upstream snapshot → brand
cd D:/Markdown/desktop && git remote add origin <你的仓库> && git push -u origin master
cd D:/Markdown/android && git remote add origin <你的仓库> && git push -u origin master
cd D:/Markdown        && git remote add origin <你的仓库> && git push -u origin master

# 2. 改更新源（改完重新打包即可闭环）
#    桌面：packages/desktop/electron-builder.yml 增加 publish 段
#    安卓：src/lib/appInfo.ts 的 releasesUrl / latestReleaseApiUrl

# 3. 记录性能基线（改版前后可对比）
#    打开 demo.md / 5MB 文档，记录启动到可编辑的耗时
```
