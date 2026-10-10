#!/usr/bin/env node
/**
 * 真机性能分项测量：打开 / 滚动 / 关闭三个阶段各自的 JS、布局、样式耗时。
 *
 * 依赖：调试版应用（WebView 调试开启）、已授权的设备、目标文档已在媒体库中。
 *
 * 用法:
 *   node tools/android-profile.mjs --uri content://media/external/file/1000032499 \
 *     [--pkg com.inkmark.app.debug] [--port 9223] [--swipes 10] [--out perf/device-profile.json]
 */
import { execFileSync, execSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const ADB = join(ROOT, '.toolchain', 'android-sdk', 'platform-tools', 'adb.exe')

const args = process.argv.slice(2)
const getArg = (n, d) => {
  const i = args.indexOf(n)
  return i >= 0 ? args[i + 1] : d
}
const URI = getArg('--uri')
const PKG = getArg('--pkg', 'com.inkmark.app.debug')
const PORT = Number(getArg('--port', 9223))
const SWIPES = Number(getArg('--swipes', 10))
const OUT = getArg('--out', 'perf/device-profile.json')
if (!URI) {
  console.error('缺少 --uri（要打开的文档 content URI）')
  process.exit(1)
}

const env = { ...process.env, MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' }
const adb = (a, opts = {}) =>
  execFileSync(ADB, a, { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024, ...opts }).toString()

function pickSerial() {
  const lines = adb(['devices']).split('\n').slice(1)
  // adb 用制表符分隔：<serial>	device；无线调试偶尔会多出一条带空格后缀的重复项
  const serials = lines
    .map((l) => l.trim().split(/\s+/))
    .filter((parts) => parts.length === 2 && parts[1] === 'device')
    .map((parts) => parts[0])
  if (!serials.length) throw new Error('没有已授权的设备')
  return serials[0]
}
const SERIAL = getArg('--serial', pickSerial())
const sh = (cmd) => execSync(cmd, { encoding: 'utf8', env })
const adbShell = (cmd) => execSync(`"${ADB}" -s "${SERIAL}" shell ${cmd}`, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pageTarget(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(2000) })).json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page
    } catch {
      /* 还没起来 */
    }
    await sleep(300)
  }
  throw new Error('等待 WebView 调试目标超时')
}

function connect(url) {
  const ws = new WebSocket(url)
  let seq = 0
  const pending = new Map()
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    const r = pending.get(m.id)
    if (r) {
      pending.delete(m.id)
      r(m)
    }
  })
  ws.addEventListener('close', () => {
    for (const [, r] of pending) r(null)
    pending.clear()
  })
  const ready = new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  const call = (method, params = {}) =>
    new Promise((res) => {
      const id = ++seq
      pending.set(id, res)
      ws.send(JSON.stringify({ id, method, params }))
    })
  return { ready, call, close: () => ws.close() }
}

const METRIC_KEYS = ['ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration', 'LayoutCount', 'RecalcStyleCount']

async function metrics(cdp) {
  const r = await cdp.call('Performance.getMetrics')
  const out = {}
  for (const m of r?.result?.metrics || []) if (METRIC_KEYS.includes(m.name)) out[m.name] = m.value
  return out
}
const diff = (a, b) => Object.fromEntries(METRIC_KEYS.map((k) => [k, +(((b[k] ?? 0) - (a[k] ?? 0)) * 1000).toFixed(0)])) // ms

async function main() {
  console.log(`设备: ${SERIAL}`)
  console.log('启动调试版应用 …')
  adbShell(`am force-stop ${PKG}`)
  await sleep(800)
  // 不用 monkey：它偶尔以非 0 退出码返回；直接指定 Activity 启动更确定
  try {
    adbShell(`am start -n ${PKG}/io.github.renakoni.marktextandroid.MainActivity`)
  } catch {
    adbShell(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`)
  }
  await sleep(5000)

  // 绑定 devtools 套接字（应用每次启动都会换名字）
  const unix = adb(['-s', SERIAL, 'shell', 'cat /proc/net/unix'])
  const socks = [...unix.matchAll(/@(webview_devtools_remote_\d+)/g)].map((m) => m[1])
  if (!socks.length) throw new Error('没找到 devtools 套接字')
  try {
    adb(['-s', SERIAL, 'forward', '--remove', `tcp:${PORT}`])
  } catch {
    /* ignore */
  }
  adb(['-s', SERIAL, 'forward', `tcp:${PORT}`, `localabstract:${socks[socks.length - 1]}`])

  const page = await pageTarget()
  const cdp = connect(page.webSocketDebuggerUrl)
  await cdp.ready
  await cdp.call('Performance.enable')
  await cdp.call('Profiler.enable')

  const phases = {}
  const mHome = await metrics(cdp)

  // ---- 打开 ----
  console.log('打开文档 …')
  await cdp.call('Profiler.start', { samplingInterval: 200 })
  const tOpen0 = Date.now()
  adbShell(`am start -a android.intent.action.VIEW -d "${URI}" -t "text/markdown" --grant-read-uri-permission -p ${PKG}`)
  let openMs = null
  for (let i = 0; i < 120; i += 1) {
    const r = await Promise.race([
      cdp.call('Runtime.evaluate', { expression: "document.body.innerText.replace(/\\s+/g,' ').length", returnByValue: true }),
      sleep(8000).then(() => null),
    ])
    const len = r?.result?.result?.value ?? 0
    if (len > 300000) {
      openMs = Date.now() - tOpen0
      break
    }
    await sleep(500)
  }
  const mOpen = await metrics(cdp)
  phases.open = { ms: openMs, metrics: diff(mHome, mOpen) }
  console.log(`  可交互: ${openMs === null ? '超时' : openMs + ' ms'}`)

  const prof = await cdp.call('Profiler.stop')
  const profile = prof?.result?.profile
  if (profile) {
    const interval = 200
    const nodes = new Map(profile.nodes.map((n) => [n.id, n]))
    const self = new Map()
    for (const id of profile.samples) {
      const n = nodes.get(id)
      if (!n) continue
      const f = n.callFrame
      const key = `${f.functionName || '(anonymous)'} @ ${(f.url || '').split('/').slice(-1)[0]}:${f.lineNumber + 1}`
      self.set(key, (self.get(key) || 0) + interval)
    }
    phases.open.topSelf = [...self.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([fn, us]) => ({ fn, ms: Math.round(us / 1000) }))
    writeFileSync(join(ROOT, 'perf', 'device-open.cpuprofile'), JSON.stringify(profile))
  }

  // ---- 滚动 ----
  console.log(`滚动 ${SWIPES} 次 …`)
  const mScroll0 = await metrics(cdp)
  const tScroll0 = Date.now()
  for (let i = 0; i < SWIPES; i += 1) adbShell('input swipe 600 1900 600 500 120')
  const scrollMs = Date.now() - tScroll0
  await sleep(1500)
  const mScroll1 = await metrics(cdp)
  phases.scroll = { ms: scrollMs, perSwipeMs: Math.round(scrollMs / SWIPES), metrics: diff(mScroll0, mScroll1) }
  console.log(`  总耗时 ${scrollMs} ms（每次滑动 ${phases.scroll.perSwipeMs} ms）`)

  // ---- 关闭 ----
  console.log('关闭文档 …')
  const mClose0 = await metrics(cdp)
  const tClose0 = Date.now()
  for (let i = 0; i < 3; i += 1) {
    adbShell('input keyevent 4')
    await sleep(400)
  }
  const mClose1 = await metrics(cdp)
  phases.close = { ms: Date.now() - tClose0, metrics: diff(mClose0, mClose1) }
  console.log(`  返回首页耗时 ${phases.close.ms} ms`)

  cdp.close()
  mkdirSync(join(ROOT, 'perf'), { recursive: true })
  writeFileSync(join(ROOT, OUT), JSON.stringify({ uri: URI, pkg: PKG, swipes: SWIPES, phases }, null, 2))
  console.log(`\n已写入 ${OUT}`)
  for (const [name, p] of Object.entries(phases)) {
    const m = p.metrics || {}
    console.log(
      `${name.padEnd(6)} 墙钟 ${String(p.ms ?? '-').padStart(6)} ms | JS ${String(m.ScriptDuration ?? 0).padStart(6)} ms | 布局 ${String(
        m.LayoutDuration ?? 0,
      ).padStart(5)} ms (${m.LayoutCount ?? 0} 次) | 样式 ${String(m.RecalcStyleDuration ?? 0).padStart(5)} ms (${m.RecalcStyleCount ?? 0} 次)`,
    )
  }
}

main().catch((e) => {
  console.error('测量失败:', e.message)
  process.exit(1)
})
