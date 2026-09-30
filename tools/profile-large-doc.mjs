#!/usr/bin/env node
/**
 * 剖析大文档打开过程（CDP + V8 CPU profile）。
 *
 * 做法：先启动一个空实例并开启 Profiler，再启动第二个实例把目标文件转发给正在运行的实例，
 * 这样采样区间完整覆盖"解析 + 渲染"的阻塞过程，而不是在阻塞发生后才尝试连接。
 *
 * 用法:
 *   node tools/profile-large-doc.mjs perf/scale-1000kb.md [--port 9700] [--timeout 300]
 *
 * 产物:
 *   perf/profile-<文件名>.cpuprofile   （可用 Chrome DevTools 的 Performance 面板加载）
 *   perf/profile-<文件名>.json         （主线程阻塞时长 + 自耗时最高的函数）
 */
import { spawn, execSync } from 'node:child_process'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const fixture = args[0]
if (!fixture || !existsSync(fixture)) {
  console.error('用法: node tools/profile-large-doc.mjs <file.md> [--port 9700] [--timeout 300]')
  process.exit(1)
}
const portIdx = args.indexOf('--port')
const port = portIdx >= 0 ? Number(args[portIdx + 1]) : 9700
const timeoutIdx = args.indexOf('--timeout')
const hardCapMs = (timeoutIdx >= 0 ? Number(args[timeoutIdx + 1]) : 300) * 1000
// 默认测打包产物；--dev 用 node_modules 里的 Electron 直接跑源码构建（out/），迭代更快
const DEV = args.includes('--dev')
const APP = DEV
  ? join(ROOT, 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe')
  : join(ROOT, 'desktop', 'dist', 'win-unpacked', 'inkmark.exe')
const appArgs = (extra) => (DEV ? [join(ROOT, 'desktop', 'packages', 'desktop'), ...extra] : extra)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

const spawned = []

function killApp() {
  if (!DEV) {
    try {
      execSync('taskkill /F /IM inkmark.exe', { stdio: 'ignore' })
    } catch {
      /* none running */
    }
  }
  for (const pid of spawned.splice(0)) {
    try {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' })
    } catch {
      /* already gone */
    }
  }
}

function launch(extra) {
  const a = spawn(APP, appArgs(extra), { windowsHide: true, stdio: 'ignore' })
  a.unref()
  spawned.push(a.pid)
  return a
}

async function pageTarget(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) })
      const list = await res.json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* not up yet */
    }
    await sleep(150)
  }
  throw new Error('等待 CDP 目标超时')
}

function connect(url) {
  const ws = new WebSocket(url)
  let seq = 0
  const pending = new Map()
  const settle = (msg) => {
    for (const [, r] of pending) r(msg)
    pending.clear()
  }
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    const r = pending.get(m.id)
    if (r) {
      pending.delete(m.id)
      r(m)
    }
  })
  ws.addEventListener('close', () => settle(null))
  ws.addEventListener('error', () => settle(null))
  const ready = new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  const call = (method, params = {}) => {
    const id = ++seq
    return new Promise((res) => {
      pending.set(id, res)
      ws.send(JSON.stringify({ id, method, params }))
    })
  }
  return { ready, call, close: () => ws.close() }
}

const esc = (s) => JSON.stringify(s)

async function main() {
  killApp()
  await sleep(1500)

  log('启动空实例并开启 CPU 剖析 …')
  launch([`--remote-debugging-port=${port}`])
  const page = await pageTarget()
  const cdp = connect(page.webSocketDebuggerUrl)
  await cdp.ready
  await cdp.call('Profiler.enable')
  await cdp.call('Profiler.start', { samplingInterval: 200 })

  log('让第二个实例把文件转发给运行中的实例：', basename(fixture))
  const t0 = Date.now()
  launch([fixture])

  // 就绪判据：正文字符数达到“源文件字节数 * 0.5”并连续两次不增长。
  // 每次探针都会被排在渲染阻塞之后，因此第一次达到阈值的时刻即“文档可交互”的时刻。
  const bytes = readFileSync(fixture).length
  const threshold = Math.floor(bytes * 0.5)
  let readyMs = null
  let mainThreadMs = null
  let prevLen = -1
  let stable = 0
  const curve = []
  while (Date.now() - t0 < hardCapMs) {
    const r = await cdp.call('Runtime.evaluate', {
      expression: "document.body.innerText.replace(/\\s+/g,' ').length",
      returnByValue: true,
    })
    const len = r?.result?.result?.value ?? 0
    if (mainThreadMs === null) mainThreadMs = Date.now() - t0
    curve.push({ t: Date.now() - t0, len })
    if (len >= threshold && Math.abs(len - prevLen) < Math.max(1000, len * 0.02)) {
      stable += 1
      if (stable >= 2) {
        readyMs = Date.now() - t0
        break
      }
    } else {
      stable = 0
    }
    prevLen = len
    await sleep(500)
  }
  if (readyMs === null) log(`警告：${hardCapMs / 1000}s 内未达到就绪判据（继续取剖析结果）`);

  await sleep(3000) // 让收尾工作（布局、图片、滚动）进入采样
  log('停止剖析并读取文档状态 …')
  const chars = await cdp.call('Runtime.evaluate', {
    expression: "document.body.innerText.replace(/\\s+/g,' ').length",
    returnByValue: true,
  })
  const title = await cdp.call('Runtime.evaluate', { expression: 'document.title', returnByValue: true })
  const prof = await cdp.call('Profiler.stop')
  cdp.close()
  killApp()

  const profile = prof?.result?.profile
  if (!profile) {
    console.error('未取到 CPU profile')
    process.exit(1)
  }

  mkdirSync(join(ROOT, 'perf'), { recursive: true })
  const name = basename(fixture).replace(/\.md$/, '')
  const profPath = join(ROOT, 'perf', `profile-${name}.cpuprofile`)
  writeFileSync(profPath, JSON.stringify(profile))

  // 自耗时聚合（按函数名+位置）
  const intervalUs = 200
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]))
  const self = new Map()
  for (const [i, id] of profile.samples.entries()) {
    const node = nodes.get(id)
    if (!node) continue
    const f = node.callFrame
    const key = `${f.functionName || '(anonymous)'} @ ${(f.url || '').split('/').slice(-2).join('/')}:${f.lineNumber + 1}`
    self.set(key, (self.get(key) || 0) + intervalUs)
  }
  const top = [...self.entries()].sort((x, y) => y[1] - x[1]).slice(0, 18)

  const summary = {
    fixture: basename(fixture),
    bytes: readFileSync(fixture).length,
    readyMs,
    mainThreadMs,
    progressCurve: curve.slice(-8),
    docChars: chars?.result?.result?.value ?? null,
    docTitle: title?.result?.result?.value ?? null,
    totalSamples: profile.samples.length,
    sampledMs: Math.round((profile.samples.length * intervalUs) / 1000),
    topSelfTime: top.map(([fn, us]) => ({ fn, ms: Math.round(us / 1000) })),
  }
  const jsonPath = join(ROOT, 'perf', `profile-${name}.json`)
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2))

  console.log('\n=== 结果 ===')
  console.log(`文件         : ${summary.fixture} (${(summary.bytes / 1048576).toFixed(2)} MB)`)
  console.log(`文档可交互   : ${readyMs === null ? '未完成（超过 ' + hardCapMs / 1000 + 's）' : readyMs + ' ms'}`)
  console.log(`首次探针返回 : ${mainThreadMs === null ? '未返回' : mainThreadMs + ' ms'}`)
  console.log(`文档标题     : ${summary.docTitle}`)
  console.log(`正文字符数   : ${summary.docChars}`)
  console.log(`采样总时长   : ${summary.sampledMs} ms（${summary.totalSamples} 样本）`)
  console.log('\n自耗时最高的函数：')
  for (const { fn, ms } of summary.topSelfTime) console.log(`  ${String(ms).padStart(6)} ms  ${fn}`)
  console.log(`\nprofile: ${profPath}`)
}

await main()
