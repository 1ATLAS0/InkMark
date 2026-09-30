#!/usr/bin/env node
/**
 * InkMark 品牌化脚本 —— 单一配置源，幂等执行。
 *
 *   node tools/rebrand.mjs            # 应用品牌
 *   node tools/rebrand.mjs --dry-run  # 只报告会改什么
 *
 * 原则:
 *  - 只改「用户可见」与「产品标识」；内部标识（window.marktext / MARKTEXT_* 环境变量 /
 *    包名 marktext / 菜单模板文件名）保持不动，避免破坏上游代码契约。
 *  - 每个替换都校验：找不到原文且目标已存在 => 已改过（跳过）；两者都没有 => 报错，
 *    说明上游代码变了，需要人工确认。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DESKTOP = join(ROOT, 'desktop')
const ANDROID = join(ROOT, 'android')
const DRY = process.argv.includes('--dry-run')

export const BRAND = {
  name: 'InkMark',
  desktopAppId: 'com.inkmark.desktop',
  androidAppId: 'com.inkmark.app',
  executable: 'inkmark',
  github: {
    owner: '1ATLAS0',
    repo: 'InkMark',
    get repoUrl() {
      return `https://github.com/${this.owner}/${this.repo}`
    },
  },
}

// 品牌强调色（来自图标渐变）：teal #1E6F7A
const ACCENT_HEX = '#1E6F7A'
const ACCENT_RGB = '30, 111, 122'
const LEGACY_GREEN_HEX = '#21b56f'
const LEGACY_GREEN_RGB = '33, 181, 111'

/** @type {{file:string, edits:[string,string,boolean?][]}[]} */
const OPS = [
  // ---------------------------------------------------------------- 桌面端
  {
    file: join(DESKTOP, 'packages/desktop/electron-builder.yml'),
    edits: [
      ['appId: com.github.marktext.marktext', `appId: ${BRAND.desktopAppId}`],
      ['productName: marktext', `productName: ${BRAND.name}`],
      ["executableName: marktext", `executableName: ${BRAND.executable}`],
      ["executableName: 'marktext'", `executableName: '${BRAND.executable}'`],
      ["artifactName: 'marktext-", `artifactName: '${BRAND.executable}-`, true],
      ["description: 'A simple and elegant open-source markdown editor that focused on speed and usability.'",
        `description: '${BRAND.name} - a free, open-source Markdown editor with inline live preview.'`],
      ["maintainer: 'MarkText Contributors'", `maintainer: '${BRAND.name} Contributors'`],
      ["StartupWMClass: 'marktext'", `StartupWMClass: '${BRAND.executable}'`],
      ["Keywords: 'marktext;'", `Keywords: '${BRAND.executable};'`],
    ],
  },
  {
    file: join(DESKTOP, 'packages/desktop/package.json'),
    edits: [
      ['"description": "MarkText",', `"description": "${BRAND.name}",\n  "productName": "${BRAND.name}",`],
      // 内部包名：避免升级缓存目录等仍叫 marktext
      ['"name": "marktext",', `"name": "${BRAND.executable}",`],
      ['"name": "inkmark",', `"name": "${BRAND.executable}",`],
    ],
  },
  {
    file: join(DESKTOP, 'package.json'),
    edits: [
      ['"name": "marktext-monorepo"', `"name": "${BRAND.executable}-monorepo"`],
      ['pnpm --filter marktext', `pnpm --filter ${BRAND.executable}`, true],
    ],
  },
  {
    file: join(DESKTOP, 'packages/desktop/src/renderer/index.html'),
    edits: [['<title>MarkText</title>', `<title>${BRAND.name}</title>`]],
  },
  {
    file: join(DESKTOP, 'packages/desktop/src/renderer/src/components/titleBar/index.vue'),
    edits: [['<span v-if="!filename">MarkText</span>', `<span v-if="!filename">${BRAND.name}</span>`]],
  },
  {
    file: join(DESKTOP, 'packages/desktop/src/renderer/src/components/about/index.vue'),
    edits: [["const name = 'MarkText'", `const name = '${BRAND.name}'`]],
  },
  {
    file: join(DESKTOP, 'packages/desktop/src/main/windows/editor.ts'),
    edits: [["message: 'MarkText has crashed'", `message: '${BRAND.name} has crashed'`]],
  },
  {
    file: join(DESKTOP, 'packages/desktop/src/main/cli/index.ts'),
    edits: [['writeLine(`MarkText: ${MARKTEXT_VERSION_STRING}`)', 'writeLine(`' + BRAND.name + ': ${MARKTEXT_VERSION_STRING}`)']],
  },
  {
    file: join(DESKTOP, 'packages/desktop/src/main/index.ts'),
    edits: [["productName: 'marktext',", `productName: '${BRAND.executable}',`]],
  },
  {
    file: join(DESKTOP, 'packages/desktop/src/main/exceptionHandler.ts'),
    edits: [
      ["companyName: 'marktext',", `companyName: '${BRAND.executable}',`],
      ["productName: 'marktext',", `productName: '${BRAND.executable}',`],
    ],
  },
  // 默认浅色主题的强调色：把 MarkText 绿换成品牌青
  {
    file: join(DESKTOP, 'packages/desktop/src/renderer/src/assets/styles/index.css'),
    edits: [[LEGACY_GREEN_RGB, ACCENT_RGB, true]],
  },
  // 默认主题（浅色）=> light（本身即品牌化后的基础主题），深色 => dark
  {
    file: join(DESKTOP, 'packages/desktop/static/preference.json'),
    edits: [
      ['"theme": "light"', `"theme": "light"`],
      ['"lightModeTheme": "light"', `"lightModeTheme": "light"`],
      ['"darkModeTheme": "dark"', `"darkModeTheme": "dark"`],
    ],
  },
  // ---------------------------------------------------------------- 安卓端
  {
    file: join(ANDROID, 'capacitor.config.ts'),
    edits: [
      ["appId: 'io.github.renakoni.marktextandroid'", `appId: '${BRAND.androidAppId}'`],
      ["appName: 'MarkText'", `appName: '${BRAND.name}'`],
    ],
  },
  {
    file: join(ANDROID, 'android/app/build.gradle'),
    edits: [
      // 注意：namespace 不要改。Java 源码在 io/github/renakoni/marktextandroid 下且未 import R，
      // 改 namespace 会导致 "找不到符号 R"；applicationId 才是安装标识。
      ['applicationId "io.github.renakoni.marktextandroid"', `applicationId "${BRAND.androidAppId}"`],
      ['applicationId "com.inkmark.app"', `applicationId "${BRAND.androidAppId}"`],
    ],
  },
  {
    file: join(ANDROID, 'android/app/src/debug/res/values/strings.xml'),
    edits: [
      ['<string name="app_name">MarkText Debug</string>', `<string name="app_name">${BRAND.name} Debug</string>`],
      ['<string name="app_name">InkMark Debug</string>', `<string name="app_name">${BRAND.name} Debug</string>`],
    ],
  },
  {
    file: join(ANDROID, 'android/app/src/main/res/values/strings.xml'),
    edits: [
      ['<string name="app_name">MarkText</string>', `<string name="app_name">${BRAND.name}</string>`],
      ['<string name="title_activity_main">MarkText</string>', `<string name="title_activity_main">${BRAND.name}</string>`],
      ['<string name="package_name">io.github.renakoni.marktextandroid</string>', `<string name="package_name">${BRAND.androidAppId}</string>`],
      ['<string name="custom_url_scheme">io.github.renakoni.marktextandroid</string>', `<string name="custom_url_scheme">${BRAND.androidAppId}</string>`],
    ],
  },
  {
    file: join(ANDROID, 'android/app/src/main/res/values/ic_launcher_background.xml'),
    edits: [['<color name="ic_launcher_background">#1A1A1A</color>', '<color name="ic_launcher_background">#17414B</color>']],
  },
  {
    file: join(ANDROID, 'index.html'),
    edits: [['<title>MarkText</title>', `<title>${BRAND.name}</title>`]],
  },
  {
    file: join(ANDROID, 'src/lib/appInfo.ts'),
    edits: [
      ["name: 'MarkText',", `name: '${BRAND.name}',`],
      // 更新检查指向自有仓库（否则会引导用户装回上游版本）
      ["repositoryUrl: 'https://github.com/Renakoni/marktext-android'", `repositoryUrl: '${BRAND.github.repoUrl}'`],
      ["releasesUrl: 'https://github.com/Renakoni/marktext-android/releases'", `releasesUrl: '${BRAND.github.repoUrl}/releases'`],
      [
        "latestReleaseApiUrl: 'https://api.github.com/repos/Renakoni/marktext-android/releases/latest'",
        `latestReleaseApiUrl: 'https://api.github.com/repos/${BRAND.github.owner}/${BRAND.github.repo}/releases/latest'`,
      ],
    ],
  },
  // 默认浅色固定主题切到 classic-light（再把它染成品牌色）
  {
    file: join(ANDROID, 'src/features/settings/appearanceSettings.ts'),
    edits: [["light: 'graphite',", "light: 'classic-light',"]],
  },
  {
    file: join(ANDROID, 'src/styles/themes/classic-light.css'),
    edits: [
      [LEGACY_GREEN_HEX, ACCENT_HEX, true],
      [LEGACY_GREEN_RGB, ACCENT_RGB, true],
      ['--accent: #188652;', '--accent: #17606B;'],
      ['--accent-strong: #136c42;', '--accent-strong: #124E57;'],
      ['--accent-hover: #167c4c;', '--accent-hover: #175A64;'],
      ['--accent-soft: #d9f1e4;', '--accent-soft: #D8EBEE;'],
    ],
  },
  {
    file: join(ANDROID, 'src/features/settings/themeCatalog.ts'),
    edits: [
      ["swatches: ['#ffffff', '#21b56f', '#333333', '#4d4d4d']", `swatches: ['#ffffff', '${ACCENT_HEX}', '#333333', '#4d4d4d']`],
      ["label: 'Classic Light'", `label: '${BRAND.name} Light'`],
    ],
  },
]

/** 全语言替换显示名：MarkText -> InkMark */
function localeOps() {
  const ops = []
  for (const dir of [join(DESKTOP, 'packages/desktop/static/locales')]) {
    for (const f of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'de', 'es', 'fr', 'nl', 'pt', 'ru', 'tr']) {
      const p = join(dir, `${f}.json`)
      if (existsSync(p)) ops.push({ file: p, edits: [['MarkText', BRAND.name, true]] })
    }
  }
  for (const f of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'de', 'es', 'fr', 'pt', 'tr']) {
    const p = join(ANDROID, `src/lib/locales/${f}.ts`)
    if (existsSync(p)) ops.push({ file: p, edits: [["'app.name': 'MarkText'", `'app.name': '${BRAND.name}'`], ['MarkText', BRAND.name, true]] })
  }
  return ops
}

let changed = 0
let skipped = 0
const problems = []

for (const { file, edits } of [...OPS, ...localeOps()]) {
  if (!existsSync(file)) {
    problems.push(`缺少文件: ${file}`)
    continue
  }
  let text = readFileSync(file, 'utf8')
  const before = text
  for (const [from, to, all] of edits) {
    if (from === to) continue // 无变化（占位规则）
    if (!text.includes(from)) {
      if (text.includes(to)) skipped++
      else problems.push(`未找到待替换内容: ${file} :: ${from.slice(0, 70)}`)
      continue
    }
    text = all ? text.split(from).join(to) : text.replace(from, to)
  }
  if (text !== before) {
    changed++
    const rel = file.replace(ROOT + '\\', '').replace(ROOT + '/', '')
    console.log(`${DRY ? '[dry] ' : ''}改: ${rel}`)
    if (!DRY) writeFileSync(file, text, 'utf8')
  }
}

console.log(`\n品牌: ${BRAND.name} | 桌面 appId: ${BRAND.desktopAppId} | 安卓包名: ${BRAND.androidAppId}`)
console.log(`修改文件: ${changed} | 已是最新(跳过): ${skipped} | 问题: ${problems.length}`)
for (const p of problems) console.log('  ! ' + p)
process.exit(problems.length ? 1 : 0)
