#!/usr/bin/env node
/**
 * 捕获页面里的控制台输出与未捕获异常（CDP），用于端上排查。
 *
 * 用法:
 *   node tools/cdp-capture.mjs --port 9222 --seconds 40 --out .toolchain/capture.log
 *
 * 说明：先启动捕获，再触发要复现的操作（例如用 intent 重新打开文档），
 * 捕获期间产生的 console.* 与异常都会落盘。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const args = process.argv.slice(2)
const getArg = (n, d) => {
  const i = args.indexOf(n)
  return i >= 0 ? args[i + 1] : d
}
const port = Number(getArg('--port', 9222))
const seconds = Number(getArg('--seconds', 40))
const out = getArg('--out', '.toolchain/capture.log')

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find((t) => t.type === 'page')
if (!page) {
  console.error('没有可调试页面')
  process.exit(1)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r, j) => {
  ws.onopen = r
  ws.onerror = j
})

const lines = []
const stamp = () => new Date().toISOString().slice(11, 23)
let seq = 0
const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++seq, method, params }))

ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = (m.params.args || [])
      .map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type))
      .join(' ')
    lines.push(`${stamp()} [console.${m.params.type}] ${text.slice(0, 500)}`)
  } else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails
    const desc = d.exception?.description || d.text || ''
    lines.push(`${stamp()} [EXCEPTION] ${String(desc).slice(0, 1500)}`)
  } else if (m.method === 'Log.entryAdded') {
    const en = m.params.entry
    if (en.level === 'error' || en.level === 'warning') {
      lines.push(`${stamp()} [log.${en.level}] ${String(en.text).slice(0, 500)}`)
    }
  }
})

send('Runtime.enable')
send('Log.enable')
console.log(`捕获中（${seconds}s）… 页面：${page.title}`)
await new Promise((r) => setTimeout(r, seconds * 1000))
ws.close()

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, lines.join('\n') || '(无控制台输出/异常)')
console.log(`已写入 ${out}（${lines.length} 条）`)
for (const l of lines.slice(-25)) console.log(l)
