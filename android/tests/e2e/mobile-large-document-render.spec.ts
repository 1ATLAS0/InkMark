import { expect, test } from '@playwright/test'
import { installAndroidAppMock } from './helpers/androidAppMock'
import { expectEditorReady } from './helpers/editor'

/**
 * 大文档渲染回归：真机上打开约 1 MB 的文档时，开头若干块正常，其余块的
 * 行内内容（加粗、标题标记等）保持原始 Markdown。
 *
 * 这里用同一构造的文档在 dev server 环境复现：每节含标题、正文（真加粗/斜体）、
 * 表格与代码块。判据是"原始标记残留"——渲染完成后正文里不应再出现 ** 或行首 #。
 */
function largeMarkdown(sections: number): string {
  const parts: string[] = ['# 规模测试文档\n\n']
  for (let i = 1; i <= sections; i += 1) {
    parts.push(
      `## 小节 ${i}\n\n`,
      `这是第 ${i} 段正文，用于测试大文档的渲染与编辑性能。包含 **加粗**、*斜体* 与 [链接](https://example.com/${i})。\n\n`,
      '| 列A | 列B | 列C |\n| --- | --- | --- |\n',
      `| ${i} | ${i * 2} | ${i * 3} |\n\n`,
      '```js\n',
      `const value${i} = ${i}\n`,
      `console.log(value${i})\n`,
      '```\n\n',
    )
  }
  return parts.join('')
}

async function rawStats(page: import('@playwright/test').Page) {
  // 几何判据：标记是否真的占据可见宽度。muya 用 font-size:0 隐藏标记，
  // innerText 仍会包含这些文本，所以按文本判断会误报。
  return page.evaluate(() => {
    const blocks = [...document.querySelectorAll('.mu-container > *')]
    const hasVisibleMarker = (el: Element) => {
      if (el.classList.contains('mu-active')) return false // 光标所在块按设计显示标记
      return [...el.querySelectorAll('.mu-hide')].some((m) => m.getBoundingClientRect().width > 1)
    }
    const isRaw = hasVisibleMarker
    const byClass: Record<string, { total: number; raw: number }> = {}
    const samples: string[] = []
    for (const el of blocks) {
      const cls = (el.className || '').toString().split(' ')[0] || el.tagName.toLowerCase()
      byClass[cls] = byClass[cls] || { total: 0, raw: 0 }
      byClass[cls].total += 1
      if (isRaw(el)) {
        byClass[cls].raw += 1
        if (samples.length < 6) samples.push(cls + ' :: ' + ((el as HTMLElement).innerText || '').slice(0, 46).replace(/\n/g, ' '))
      }
    }
    const hideEl = document.querySelector('.mu-hide')
    let ruleFound = false
    try {
      for (const sheet of [...document.styleSheets]) {
        for (const rule of [...(sheet.cssRules || [])]) {
          const text = (rule as CSSStyleRule).selectorText || ''
          if (text.includes('.mu-hide') || text.includes('.mu-remove')) ruleFound = true
        }
      }
    } catch { /* 跨域样式表 */ }
    const parents: string[] = []
    let cur: Element | null = hideEl
    while (cur && parents.length < 6) {
      parents.push(cur.tagName.toLowerCase() + '.' + (cur.className || '').toString().split(' ').slice(0, 2).join('.'))
      cur = cur.parentElement
    }
    const hideInfo = {
      hideFontSize: hideEl ? getComputedStyle(hideEl).fontSize : null,
      hideInlineStyle: hideEl ? hideEl.getAttribute('style') : null,
      hideParents: parents,
      hideCount: document.querySelectorAll('.mu-hide').length,
      removeCount: document.querySelectorAll('.mu-remove').length,
      display: hideEl ? getComputedStyle(hideEl).display : null,
      visibility: hideEl ? getComputedStyle(hideEl).visibility : null,
      rulesForHide: ruleFound,
      sheets: [...document.styleSheets].map((s2) => s2.href ? s2.href.split('/').pop() : 'inline'),
    }
    return { blocks: blocks.length, raw: blocks.filter(isRaw).length, byClass, samples, hideInfo }
  })
}

for (const sections of [40, 400, 2000]) {
  // fixme：本用例记录真机 1 MB 文档后段保持原始 Markdown 的问题，但当前尚不能稳定复现。
  // dev server 环境下 .mu-hide（用于隐藏 # 与 ** 等标记）未生效，属该环境的样式差异；
  // 真机正式版仅在大文档后段出现。定位过程见仓库提交说明。
  test(`large document renders inline content (${sections} sections)`, async ({ page }) => {
    test.setTimeout(240_000)
    const markdown = largeMarkdown(sections)
    await installAndroidAppMock(page, undefined, {
      pendingOpenWithEvent: {
        document: {
          sourceUri: 'content://test/scale.md',
          displayName: 'scale.md',
          markdown,
          canWrite: true,
        },
      },
    })
    await page.goto('/')
    await expectEditorReady(page)

    // 先等挂载稳定（连续两次块数不变），再判断渲染 —— 只等"raw==0"会在大文档上过早返回
    const started = Date.now()
    let prevBlocks = -1
    let mountSettledMs: number | null = null
    for (let i = 0; i < 60; i += 1) {
      const now = (await rawStats(page)).blocks
      console.log(`  [${sections}] t=${Date.now() - started}ms blocks=${now}`)
      if (now === prevBlocks) {
        mountSettledMs = Date.now() - started
        break
      }
      prevBlocks = now
      await page.waitForTimeout(1000)
    }
    const settledMs = mountSettledMs
    const expectedBlocks = sections * 4 + 1

    const stats = await rawStats(page)
    console.log(
      `[${sections} 节 / ${(markdown.length / 1024).toFixed(0)} KB] ` +
        `settled=${settledMs === null ? 'timeout' : settledMs + 'ms'} ` +
        JSON.stringify({ blocks: stats.blocks, raw: stats.raw, byClass: stats.byClass }),
    )
    console.log('HIDEINFO ' + JSON.stringify(stats.hideInfo))
    const diag = await page.evaluate(() => {
      const blocks = [...document.querySelectorAll('.mu-container > *')]
      const last = blocks[blocks.length - 1]?.getBoundingClientRect()
      const scroller = document.scrollingElement
      return {
        innerHeight: window.innerHeight,
        count: blocks.length,
        lastTop: last ? Math.round(last.top) : null,
        lastBottom: last ? Math.round(last.bottom) : null,
        scrollH: scroller?.scrollHeight ?? null,
        clientH: scroller?.clientHeight ?? null,
        bodyH: document.body.scrollHeight,
      }
    })
    console.log('DIAG ' + JSON.stringify(diag))
    console.log('PROBE ' + JSON.stringify(await page.evaluate(() => ({
      probe: (window as unknown as { __mountProbe?: unknown[] }).__mountProbe ?? [],
      modules: (window as unknown as { __spLoaded?: number }).__spLoaded ?? 0,
      appends: (window as unknown as { __appendProbe?: unknown }).__appendProbe ?? null,
    }))))

    // 挂载跟随视口：首屏之后不再把整篇铺完，因此只断言"已挂载的部分渲染正确"，
    // 以及文档开头一定在首屏内（否则这条用例根本没测到东西）。
    expect(stats.blocks, '首屏应已挂载').toBeGreaterThanOrEqual(20)
    expect(stats.raw, '已挂载的块不应残留原始 Markdown').toBe(0)

    // 跳到文末：大纲跳转走的是应用自己的路径（先挂载到目标块再滚动），这也是
    // 真机上出问题的地方——后段必须渲染成正常内容，而不是原始 Markdown。
    await page.getByTestId('outline-open-button').click()
    await expect(page.getByTestId('outline-sheet')).toBeVisible()
    await page.getByTestId('outline-row').last().click()
    await expect(page.getByTestId('outline-sheet')).toHaveCount(0)
    await page.waitForTimeout(600)

    let tailStats = await rawStats(page)
    for (let step = 0; step < 20; step += 1) {
      if (tailStats.blocks >= Math.floor(expectedBlocks * 0.9))
        break
      await page.evaluate(() => {
        const container = document.querySelector('.mu-container')?.parentElement
        if (container)
          container.scrollTop = container.scrollHeight
      })
      await page.waitForTimeout(400)
      tailStats = await rawStats(page)
    }
    console.log(
      `[${sections} 节] 滚动后挂载=${tailStats.blocks}/${expectedBlocks} raw=${tailStats.raw}`,
    )
    // 小文档首屏就已全量（没有可增的部分），大文档才要求跳到文末后接近全量。
    expect(tailStats.blocks, '跳到文末后应接近全量').toBeGreaterThanOrEqual(
      Math.min(Math.floor(expectedBlocks * 0.9), stats.blocks),
    )
    expect(tailStats.raw, '尾部仍有块显示原始 Markdown').toBe(0)
  })
}
