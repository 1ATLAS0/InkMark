import { expect, test, type Page } from '@playwright/test'
import { installAndroidAppMock } from './helpers/androidAppMock'
import { expectEditorReady } from './helpers/editor'

/**
 * PDF 导出：进度覆盖层可取消（取消后不拉起分享面板）；导出的 HTML 里
 * 行内公式必须渲染成 KaTeX —— 中文紧邻与中文标点结尾的写法同样生效
 * （此前这类公式在导出的 PDF 里全部退回原始 `$…$`）。
 */

function mathMarkdown(sections: number): string {
  const parts: string[] = ['# Math export\n\n']
  for (let i = 1; i <= sections; i += 1) {
    parts.push(
      `## 小节 ${i}\n\n`,
      `这是第${i}段，行内公式$E=mc^2$紧邻中文，闭合在句号前$a_b$。\n\n`,
    )
  }
  return parts.join('')
}

async function openMathDocument(page: Page) {
  await installAndroidAppMock(page)
  await page.goto('/')
  await page.evaluate((markdown) => {
    localStorage.clear()
    localStorage.setItem(
      'marktext-for-android:drafts',
      JSON.stringify([
        {
          id: 'math-export',
          markdown,
          updatedAt: '2026-07-01T09:00:00.000Z',
          lastSavedAt: '2026-07-01T09:00:00.000Z',
        },
      ]),
    )
  }, mathMarkdown(4000))
  await page.reload()
  await page.getByRole('button', { name: /Math export/ }).click()
  await expectEditorReady(page, 60_000)
}

async function startExport(page: Page) {
  await page.getByTestId('editor-menu-button').click()
  await page.getByTestId('export-pdf-button').click()
}

const exportPayloadCount = (page: Page) =>
  page.evaluate(
    () =>
      ((window as unknown as { __exportPdfPayloads?: unknown[] }).__exportPdfPayloads ?? []).length,
  )

test('the PDF export task can be cancelled before the share sheet opens', async ({ page }) => {
  test.setTimeout(120_000)
  await openMathDocument(page)

  // Click Cancel from inside the renderer the moment the task overlay appears:
  // a real click dispatched from the test can lose the race against the short
  // export render (the button is gone by the time the click lands).
  await page.evaluate(() => {
    const win = window as unknown as { __taskOverlaySeen?: boolean; __autoCancelTask?: boolean }
    win.__taskOverlaySeen = false
    win.__autoCancelTask = true
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="document-task-overlay"]'))
        win.__taskOverlaySeen = true
      const button = document.querySelector('[data-testid="cancel-task-button"]')
      if (button && win.__autoCancelTask) {
        win.__autoCancelTask = false
        ;(button as HTMLElement).click()
      }
    }).observe(document.documentElement, { childList: true, subtree: true })
  })

  await startExport(page)
  await expect(page.getByTestId('document-task-overlay')).toHaveCount(0, { timeout: 60_000 })
  expect(await page.evaluate(() => (window as unknown as { __taskOverlaySeen?: boolean }).__taskOverlaySeen)).toBe(true)
  await expect(page.getByTestId('editor-host')).toBeVisible()
  expect(await exportPayloadCount(page)).toBe(0)
})

test('exported HTML renders inline math next to CJK text as KaTeX', async ({ page }) => {
  test.setTimeout(120_000)
  await openMathDocument(page)
  await startExport(page)

  const overlay = page.getByTestId('document-task-overlay')
  await expect(overlay).toBeVisible()
  await expect(overlay).toHaveCount(0, { timeout: 60_000 })

  const payloads = await page.evaluate(
    () =>
      (window as unknown as { __exportPdfPayloads?: Array<{ html: string }> }).__exportPdfPayloads ??
      [],
  )
  expect(payloads.length).toBe(1)
  expect(payloads[0].html).toContain('class="katex')
  expect(payloads[0].html).not.toContain('$E=mc^2$')
  expect(payloads[0].html).not.toContain('$a_b$')
})
