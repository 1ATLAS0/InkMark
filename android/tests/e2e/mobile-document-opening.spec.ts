import { expect, test } from '@playwright/test'
import { expectEditorReady } from './helpers/editor'

/**
 * 打开文档时的“打开中”界面：不是假等待——是一个可以放弃的开档事务。
 * 打开期间显示文件名、扫描进度条与取消按钮；取消后回到首页，且不影响
 * 下一次正常打开。
 */

function largeMarkdown(sections: number): string {
  const parts: string[] = ['# Opening target\n\n']
  for (let i = 1; i <= sections; i += 1) {
    parts.push(
      `## 小节 ${i}\n\n`,
      `第 ${i} 段正文，包含 **加粗** 与 [链接](https://example.com/${i})。\n\n`,
    )
  }
  return parts.join('')
}

async function seedLargeDraft(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.evaluate(
    (markdown) => {
      localStorage.clear()
      localStorage.setItem(
        'marktext-for-android:drafts',
        JSON.stringify([
          {
            id: 'opening-target',
            markdown,
            updatedAt: '2026-07-01T09:00:00.000Z',
            lastSavedAt: '2026-07-01T09:00:00.000Z',
          },
        ]),
      )
    },
    largeMarkdown(4000),
  )
  await page.reload()
  await expect(page.getByRole('heading', { name: 'InkMark' })).toBeVisible()
}

test('shows a cancellable opening state and abandons the open', async ({ page }) => {
  test.setTimeout(120_000)
  await seedLargeDraft(page)

  await page.getByRole('button', { name: /Opening target/ }).click()
  const opening = page.getByTestId('editor-opening')
  await expect(opening).toBeVisible()
  await expect(opening.getByText('Opening…')).toBeVisible()
  await expect(opening.getByText('Opening target')).toBeVisible()

  // 取消：放弃开档，回到首页
  await page.getByTestId('cancel-opening-button').click()
  await expect(opening).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'InkMark' })).toBeVisible()
  await expect(page.getByTestId('editor-host')).toHaveCount(0)

  // 取消之后仍能正常打开（不残留半成品状态）
  await page.getByRole('button', { name: /Opening target/ }).click()
  await expectEditorReady(page, 60000)
  await expect(page.getByTestId('editor-opening')).toHaveCount(0)
})

test('back during opening cancels instead of leaving the editor', async ({ page }) => {
  test.setTimeout(120_000)
  await seedLargeDraft(page)

  await page.getByRole('button', { name: /Opening target/ }).click()
  await expect(page.getByTestId('editor-opening')).toBeVisible()

  await page.getByTestId('back-button').click()
  await expect(page.getByRole('heading', { name: 'InkMark' })).toBeVisible()
  await expect(page.getByTestId('editor-opening')).toHaveCount(0)
})

test('reopening a document after returning home shows the opening state again', async ({ page }) => {
  test.setTimeout(120_000)
  await seedLargeDraft(page)

  await page.getByRole('button', { name: /Opening target/ }).click()
  await expect(page.getByTestId('editor-opening')).toBeVisible()
  await expectEditorReady(page, 60000)

  // 返回首页再打开同一文档：开档动画（与取消入口）必须再次出现，
  // 不能只在本次会话的第一次打开时出现。
  await page.getByTestId('back-button').click()
  await expect(page.getByRole('heading', { name: 'InkMark' })).toBeVisible()

  await page.getByRole('button', { name: /Opening target/ }).click()
  await expect(page.getByTestId('editor-opening')).toBeVisible()
  await expect(page.getByTestId('cancel-opening-button')).toBeVisible()
  await expectEditorReady(page, 60000)
  await expect(page.getByTestId('editor-opening')).toHaveCount(0)
})
