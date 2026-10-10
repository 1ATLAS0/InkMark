#!/usr/bin/env node
/**
 * 把安卓应用 WebView 的 devtools 套接字转发到本机端口（应用每次重启都需要重新绑定）。
 *
 * 用法: node tools/android-cdp.mjs [port]     # 默认 9222
 *
 * 前提：设备已授权、应用为 debug 构建（Capacitor 在 debug 下打开 WebView 调试）。
 * 绑定后即可用 tools/probe-dom.mjs、tools/screenshot-app.mjs、tools/cdp-capture.mjs 连它。
 */
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const ADB = join(ROOT, '.toolchain', 'android-sdk', 'platform-tools', 'adb.exe')
const port = Number(process.argv[2] || 9222)

const adb = (a, env) => execFileSync(ADB, a, { encoding: 'utf8', env: { ...process.env, ...env } }).trim()

const devices = adb(['devices']).split('\n').slice(1).filter((l) => l.split(/\s+/)[1] === 'device')
if (!devices.length) {
  console.error('没有已授权的设备')
  process.exit(1)
}
const serial = devices[0].split(/\s+/)[0]
const list = adb(['-s', serial, 'shell', 'cat /proc/net/unix'])
const socks = [...list.matchAll(/@(webview_devtools_remote_\d+)/g)].map((m) => m[1])
if (!socks.length) {
  console.error('没找到 devtools 套接字：应用是否为 debug 构建、且已启动？')
  process.exit(1)
}
const sock = socks[socks.length - 1]
try {
  adb(['-s', serial, 'forward', '--remove', `tcp:${port}`])
} catch {
  /* 没有旧绑定 */
}
adb(['-s', serial, 'forward', `tcp:${port}`, `localabstract:${sock}`])
console.log(`已绑定 tcp:${port} -> ${sock}`)
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
for (const t of targets) console.log(`  ${t.type} | ${t.title} | ${(t.url || '').slice(0, 50)}`)
