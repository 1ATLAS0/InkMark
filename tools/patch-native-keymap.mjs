#!/usr/bin/env node
/**
 * 让 native-keymap 能在未安装 "Spectre 缓解库" 的 MSVC 上编译（幂等）。
 *
 * 背景：native-keymap 的 binding.gyp 里 `'SpectreMitigation': 'Spectre'` 会要求
 * VS 安装 "MSVC v142 - C++ Spectre-mitigated libs" 组件；本机 VS2019 BuildTools 没装，
 * 报 MSB8040 导致 electron-rebuild 整体失败（该模块是 optionalDependency）。
 * 这里把该要求改为 false（仅本地构建用；如需官方级加固请安装 Spectre 库后撤回改动）。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const pnpmDir = join(ROOT, 'desktop', 'node_modules', '.pnpm')
const candidates = existsSync(pnpmDir)
  ? readdirSync(pnpmDir)
      .filter((n) => n.startsWith('native-keymap@'))
      .map((n) => join(pnpmDir, n, 'node_modules', 'native-keymap', 'binding.gyp'))
      .filter((p) => existsSync(p))
  : []

if (!candidates.length) {
  console.log('未找到 native-keymap/binding.gyp（跳过）')
  process.exit(0)
}
let changed = 0
for (const file of candidates) {
  const src = readFileSync(file, 'utf8')
  if (!src.includes("'SpectreMitigation': 'Spectre'")) {
    console.log(`Spectre 设置已处理: ${file}`)
    continue
  }
  writeFileSync(file, src.replace("'SpectreMitigation': 'Spectre'", "'SpectreMitigation': 'false'"), 'utf8')
  console.log(`已关闭 Spectre 要求: ${file}`)
  changed++
}
console.log(`完成，修改 ${changed} 个文件`)
