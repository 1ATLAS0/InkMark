# 性能优化计划

本文件记录大文档下卡顿的成因、支撑结论的实测数据，以及各问题的处理顺序。

## 测量方法

| 目标 | 手段 |
|---|---|
| 打开、关闭 | 应用日志时间戳（`MarkTextAndroid` 记录了 intent、导入与编辑器初始化） |
| 后台负载 | 打开后用 `adb shell top` 每隔数秒采样应用 CPU |
| 滚动 | `dumpsys gfxinfo <包名>` 的帧统计与输入延迟计数 |
| 引擎行为 | 对开启 WebView 调试的 debug 构建使用 `dumpsys` 与 CDP 探针 |

测试设备：vivo PD2509，Android 16。测试文档：1 MB Markdown，2839 节，每节包含表格、围栏代码块与行内公式，属刻意构造的重负载样本。

## 实测数据

| 阶段 | 指标 | 数值 |
|---|---|---|
| 打开 | intent → 编辑器初始化完成 | 3.1 s（其中引擎初始化 1.4 s） |
| 打开后 | 第 8 / 15 / 25 / 40 / 60 秒的应用 CPU | 43% → 24% → 23% → 27% → 27% |
| 滚动 | 15 次滑动中的掉帧 | 0.08%，50 分位 6 ms |
| 滚动 | High input latency 计数 | 4685 |
| 关闭 | 返回键 → 首页 | 导航 2 ms，帧 99 分位 950 ms |

## 数据说明的问题

1. **画面没问题，主线程有问题。** 滚动时帧率正常，但输入事件排在引擎工作之后。瓶颈是主线程占用，不是绘制性能。
2. **引擎会渲染整篇文档。** 每个顶层块都建 DOM 子树，每个代码块执行语法高亮、每个公式执行排版。分片挂载把这份工作摊开，但没有减少总量，因此文档出现后应用仍持续繁忙一分多钟。
3. **离开编辑器要付同样的代价。** 拆除数万个节点与相关缓存，导致首页出现后立刻出现接近一秒的卡帧。

## 计划

| # | 措施 | 预期效果 | 状态 |
|---|---|---|---|
| 1 | 交互期间暂停后台挂载，界面静止后继续 | 改善滚动时的输入延迟 | 已实现（`_interactionPauseMs`，位于滚动页的调度逻辑） |
| 2 | 大文档的销毁延后到首页获得一帧之后；小文档仍同步销毁 | 消除离开编辑器时的秒级卡帧 | 已实现（按文档体积阈值判断） |
| 3 | 语法高亮与公式排版仅对视口附近的块执行，其余先占位 | 降低打开后的持续 CPU | 计划中 |
| 4 | 块元素使用 `content-visibility: auto` 与 `contain-intrinsic-size`，屏外块跳过布局与绘制 | 滚动更稳、打开更快 | 计划中 |
| 5 | 超大文档的轻量模式（默认关闭实时高亮与公式，或首次打开时提示） | 最重文件的兜底 | 计划中 |
| 6 | 视口虚拟化：只为视口附近的块保留 DOM，其余按需生成 | 从根上消除这类开销 | 长期 |

第 1、2 项已实现，并有既有测试覆盖（721 项单元测试全部通过）。效果仍需一次受控复测：首次复测受锁屏影响，系统冻结应用后 CPU 读数会归零，无法对比。

## 复测方法

```bash
# 打开后观察 CPU
adb shell am force-stop com.inkmark.app
adb shell am start -a android.intent.action.VIEW -d "<content-uri>" -t text/markdown --grant-read-uri-permission -p com.inkmark.app

# 滚动
adb shell dumpsys gfxinfo com.inkmark.app reset
for i in $(seq 1 15); do adb shell input swipe 600 1900 600 600 140; sleep 0.25; done
adb shell dumpsys gfxinfo com.inkmark.app
```

测量期间保持屏幕常亮（`adb shell svc power stayon true`）且设备解锁；否则系统会冻结应用，数据失去意义。
