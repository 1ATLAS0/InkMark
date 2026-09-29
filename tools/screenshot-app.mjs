#!/usr/bin/env node
/**
 * 通过 Electron/Chromium 远程调试协议给应用界面截图（不依赖窗口是否在前台）。
 *
 * 用法:
 *   1) 以 --remote-debugging-port=9222 启动应用
 *   2) node tools/screenshot-app.mjs [port] [out.png]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const port = Number(process.argv[2] || 9222)
const out = process.argv[3] || 'D:/Markdown/tools/preview/app-cdp.png'
const scrollIdx = process.argv.indexOf('--scroll')
const scrollBy = scrollIdx > 0 ? Number(process.argv[scrollIdx + 1] || 0) : 0

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = targets.find((t) => t.type === 'page') || targets[0]
if (!page?.webSocketDebuggerUrl) {
  console.error('未找到可调试页面:', JSON.stringify(targets.map((t) => ({ type: t.type, title: t.title }))))
  process.exit(1)
}
console.log('目标页面:', page.title, '|', page.url)

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})
let seq = 0
const call = (method, params) => {
  const id = ++seq
  return new Promise((res) => {
    const onMsg = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.id === id) {
        ws.removeEventListener('message', onMsg)
        res(msg)
      }
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

if (scrollBy) {
  const expr = `(()=>{const el=document.querySelector('.mu-editor')||document.scrollingElement; el.scrollTop+=${scrollBy}; return el.scrollTop})()`
  const r = await call('Runtime.evaluate', { expression: expr })
  console.log('滚动到:', r.result?.result?.value)
  await new Promise((r2) => setTimeout(r2, 1200))
}

const msg = await call('Page.captureScreenshot', { format: 'png', fromSurface: true })
ws.close()
if (msg.error) {
  console.error('截图失败:', JSON.stringify(msg.error))
  process.exit(1)
}
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, Buffer.from(msg.result.data, 'base64'))
console.log('已保存:', out)
