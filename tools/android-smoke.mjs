#!/usr/bin/env node
/**
 * 安卓真机冒烟测试：连上设备后一条命令完成安装、启动、截图与日志检查。
 *
 * 用法:
 *   node tools/android-smoke.mjs                      # 用 release/ 目录里最新的 APK
 *   node tools/android-smoke.mjs --apk <path.apk>
 *   node tools/android-smoke.mjs --skip-install       # 只启动 + 截图 + 日志
 *   node tools/android-smoke.mjs --text "中文输入测试"  # 额外发送一段文字（绕过输入法，仅验证文本写入）
 *
 * 前提：设备已开启 USB 调试并授权（设置 → 关于手机 → 连点版本号 → 开发者选项 → USB 调试）。
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const ADB = join(ROOT, '.toolchain', 'android-sdk', 'platform-tools', 'adb.exe')
const OUT_DIR = join(ROOT, 'tools', 'preview')

const args = process.argv.slice(2)
const getArg = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}
const SKIP_INSTALL = args.includes('--skip-install')
const TEXT = getArg('--text')

const adb = (cmdArgs, opts = {}) =>
  execFileSync(ADB, cmdArgs, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, ...opts }).toString('utf8').trim()

function pickApk() {
  const explicit = getArg('--apk')
  if (explicit) return explicit
  const dir = join(ROOT, 'release')
  const apks = readdirSync(dir)
    .filter((f) => f.endsWith('.apk'))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  if (!apks.length) throw new Error('release/ 下没有 APK，请先构建或指定 --apk')
  return join(dir, apks[0].f)
}

function main() {
  // 兼容 USB 与无线调试：无线调试的序列号形如
  // adb-XXXXXXXX-XXXXXX._adb-tls-connect._tcp，行尾带 transport_id，不能用行尾判断
  const devices = adb(['devices'])
    .split('\n')
    .slice(1)
    .filter((l) => l.trim() && l.split(/\s+/)[1] === 'device')
  if (!devices.length) {
    console.error('未检测到已授权的设备。检查：USB 连接方式（选"文件传输"）、开发者选项里的 USB 调试、')
    console.error('以及手机上弹出的"允许 USB 调试"授权框。无线调试可用 `adb pair` / `adb connect`。')
    process.exit(1)
  }
  const serial = devices[0].split(/\s+/)[0]
  console.log('设备:', serial, '| Android', adb(['-s', serial, 'shell', 'getprop', 'ro.build.version.release']))

  const pkg = 'com.inkmark.app'
  if (!SKIP_INSTALL) {
    const apk = pickApk()
    console.log('安装:', apk)
    console.log(adb(['-s', serial, 'install', '-r', '-d', apk]))
  }

  const packages = adb(['-s', serial, 'shell', 'pm', 'list', 'packages']).split('\n')
  if (!packages.some((p) => p.includes(pkg))) {
    console.error(`设备上未安装 ${pkg}`)
    process.exit(1)
  }
  console.log('版本:', adb(['-s', serial, 'shell', 'dumpsys', 'package', pkg])
    .split('\n')
    .filter((l) => l.includes('versionName') || l.includes('versionCode'))
    .map((l) => l.trim())
    .slice(0, 2)
    .join(' | '))

  console.log('清空日志并启动 …')
  adb(['-s', serial, 'logcat', '-c'])
  // 用 monkey 走 LAUNCHER intent 启动：applicationId 与 Java namespace 不同，
  // 写死 .MainActivity 会解析失败（本项目 namespace 保留了上游值）。
  const started = adb(['-s', serial, 'shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'])
  if (/No activities found|aborted/i.test(started)) {
    console.error('启动失败:', started.split('\n').slice(-3).join(' '))
    process.exit(1)
  }

  const waitMs = 9000
  console.log(`等待 ${waitMs / 1000}s 后截图 …`)
  execFileSync('powershell', ['-NoProfile', '-Command', `Start-Sleep -Milliseconds ${waitMs}`], { stdio: 'ignore' })

  mkdirSync(OUT_DIR, { recursive: true })
  const shot = join(OUT_DIR, 'device-screen.png')
  const png = execFileSync(ADB, ['-s', serial, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 })
  writeFileSync(shot, png)
  console.log('截图:', shot)

  if (TEXT) {
    console.log('发送文字（绕过输入法）:', TEXT)
    adb(['-s', serial, 'shell', 'input', 'text', TEXT.replace(/ /g, '%s')])
    execFileSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 1500'], { stdio: 'ignore' })
    const png2 = execFileSync(ADB, ['-s', serial, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 })
    writeFileSync(join(OUT_DIR, 'device-screen-after-text.png'), png2)
    console.log('截图:', join(OUT_DIR, 'device-screen-after-text.png'))
  }

  const log = adb(['-s', serial, 'logcat', '-d', '-v', 'brief', '-t', '400'])
  const interesting = log
    .split('\n')
    .filter((l) => /inkmark|InkMark|WebView|chromium|Capacitor|FATAL|AndroidRuntime|E\//i.test(l))
    .slice(-40)
  console.log('\n=== 相关日志（末尾 40 行）===')
  console.log(interesting.join('\n') || '(无匹配日志)')

  const crashes = log.split('\n').filter((l) => /FATAL EXCEPTION|AndroidRuntime: E/.test(l))
  if (crashes.length) {
    console.log('\n!! 检测到崩溃：')
    console.log(crashes.slice(-20).join('\n'))
  } else {
    console.log('\n无崩溃记录')
  }
}

main()
