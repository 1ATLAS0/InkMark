#!/usr/bin/env node
/**
 * InkMark 性能与文件兼容性基线测量。
 *
 * 用 CDP 观测启动与渲染耗时，避免依赖窗口前台；同时验证 GBK / CRLF 文件打开效果。
 *
 * 用法:
 *   node tools/perf-baseline.mjs                 # 用默认 win-unpacked 路径
 *   node tools/perf-baseline.mjs --app <exe>     # 指定可执行文件
 */
import { spawn, execSync } from 'node:child_process'
import { writeFileSync, mkdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const argv = process.argv.slice(2)
const appArg = argv.indexOf('--app')
const APP =
  appArg >= 0
    ? argv[appArg + 1]
    : join(ROOT, 'desktop', 'dist', 'win-unpacked', 'inkmark.exe')

if (!existsSync(APP)) {
  console.error('未找到应用可执行文件:', APP)
  process.exit(1)
}

const ONLY = process.argv.includes('--quick')
const FIXTURES = (ONLY
  ? [{ file: join(ROOT, 'perf', 'gbk-sample.md'), label: 'GBK 编码文件（快速自检）', expect: '这是一段 GBK 编码的中文文本' }]
  : [
  { file: join(ROOT, 'perf', 'perf-1mb.md'), label: '1 MB 文档' },
  { file: join(ROOT, 'perf', 'perf-5mb.md'), label: '5 MB 文档' },
  { file: join(ROOT, 'perf', 'perf-10mb.md'), label: '10 MB 文档' },
  { file: join(ROOT, 'perf', 'gbk-sample.md'), label: 'GBK 编码文件', expect: '这是一段 GBK 编码的中文文本' },
  { file: join(ROOT, 'perf', 'crlf-sample.md'), label: 'CRLF 换行文件', expect: '第二行' },
])

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function cdpTarget(port, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) })
      const list = await res.json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* 还没起来 */
    }
    await sleep(150)
  }
  throw new Error('等待 CDP 页面超时')
}

function connect(url) {
  const ws = new WebSocket(url)
  let seq = 0
  const pending = new Map()
  const settleAll = (msg) => {
    for (const [, resolve] of pending) resolve(msg)
    pending.clear()
  }
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data)
    const resolve = pending.get(msg.id)
    if (resolve) {
      pending.delete(msg.id)
      resolve(msg)
    }
  })
  // 连接意外关闭时唤醒所有等待中的调用，否则 promise 永不 settle（表现为脚本静默卡死）
  ws.addEventListener('close', () => settleAll({ result: { result: { value: undefined } } }))
  ws.addEventListener('error', () => settleAll({ result: { result: { value: undefined } } }))
  const ready = new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  const call = (method, params) => {
    const id = ++seq
    return new Promise((res) => {
      pending.set(id, res)
      ws.send(JSON.stringify({ id, method, params }))
    })
  }
  return { ready, call, close: () => ws.close() }
}

async function killApp() {
  try {
    execSync('taskkill /F /IM inkmark.exe', { stdio: 'ignore' })
  } catch {
    /* 没有在跑的实例 */
  }
  await sleep(1200)
}

async function measureOne(port, fixture) {
  await killApp()
  const t0 = Date.now()
  const child = spawn(APP, [`--remote-debugging-port=${port}`, fixture.file], {
    windowsHide: true,
    stdio: 'ignore',
  })
  child.unref()

  const page = await cdpTarget(port)
  const t1 = Date.now() - t0 // 窗口/渲染进程可用

  const { ready, call, close } = connect(page.webSocketDebuggerUrl)
  await ready

  // 大文档渲染会把渲染进程主线程占满，此时 CDP 的 Runtime.evaluate 不会应答。
  // 因此用一个"空调用"来测主线程恢复时间：它就是"文档可交互"的时刻。
  const probe = await Promise.race([
    call('Runtime.evaluate', { expression: '1', returnByValue: true }),
    sleep(120000).then(() => null),
  ])
  const mainThreadMs = Date.now() - t0
  if (!probe) throw new Error(`渲染进程 ${120}s 内未恢复响应（文档过大或卡死）`)

  // 轮询正文长度，连续 3 次不增长视为渲染完成
  let last = -1
  let stable = 0
  let chars = 0
  const renderDeadline = Date.now() + 240000
  while (Date.now() < renderDeadline) {
    const r = await call('Runtime.evaluate', {
      expression: "document.body.innerText.replace(/\\s+/g,' ').length",
      returnByValue: true,
    })
    chars = r.result?.result?.value ?? 0
    if (chars === last && chars > 0) {
      stable++
      if (stable >= 3) break
    } else {
      stable = 0
    }
    last = chars
    await sleep(400)
  }
  const t2 = Date.now() - t0

  let sanity = null
  if (fixture.expect) {
    const r = await call('Runtime.evaluate', {
      expression: `document.body.innerText.includes(${JSON.stringify(fixture.expect)})`,
      returnByValue: true,
    })
    sanity = r.result?.result?.value === true
  }

  close()
  return { label: fixture.label, windowMs: t1, renderMs: t2, mainThreadMs, chars, sanity }
}

const results = []
const port = 9333
for (const fixture of FIXTURES) {
  process.stdout.write(`测量中: ${fixture.label} ... `)
  const r = await measureOne(port, fixture)
  results.push(r)
  console.log(`窗口 ${r.windowMs}ms / 主线程恢复 ${r.mainThreadMs}ms / 渲染稳定 ${r.renderMs}ms / 正文字符 ${r.chars}${r.sanity === null ? '' : r.sanity ? ' / 内容正确' : ' / ✗ 内容不符'}`)
}
await killApp()

mkdirSync(join(ROOT, 'perf'), { recursive: true })
writeFileSync(join(ROOT, 'perf', 'baseline.json'), JSON.stringify({ measuredAt: new Date().toISOString(), app: basename(APP), results }, null, 2))
console.log('\n已写入 perf/baseline.json')
