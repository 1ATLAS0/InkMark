#!/usr/bin/env node
/**
 * 在运行中的应用里求值一段 JS 并打印结果（调试用）。
 *
 * 用法:
 *   1) 以 --remote-debugging-port=9222 启动应用
 *   2) node tools/probe-dom.mjs "document.title"
 *      node tools/probe-dom.mjs --port 9222 "document.querySelector('.title-bar').outerHTML"
 */
const args = process.argv.slice(2)
const portIdx = args.indexOf('--port')
const port = portIdx >= 0 ? Number(args[portIdx + 1]) : 9222
const expr = args.filter((a, i) => (portIdx < 0 || (i !== portIdx && i !== portIdx + 1))).join(' ')

if (!expr) {
  console.error('用法: node tools/probe-dom.mjs [--port 9222] "<js 表达式>"')
  process.exit(1)
}

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = targets.find((t) => t.type === 'page')
if (!page) {
  console.error('没有可调试页面，应用是否以 --remote-debugging-port 启动？')
  process.exit(1)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})
const reply = await new Promise((res) => {
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id === 1) res(m)
  })
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }))
})
ws.close()
const r = reply.result?.result
console.log(r?.value !== undefined ? r.value : JSON.stringify(reply, null, 2).slice(0, 4000))
