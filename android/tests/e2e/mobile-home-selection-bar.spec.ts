import { expect, test, type Page } from '@playwright/test'
import { longPress } from './helpers/androidAppMock'

/**
 * 选择模式的顶栏（分享/置顶/删除…）必须钉在列表顶部：长按进入选择后向下滚动
 * 勾选更多条目时，动作按钮应始终可见可点，而不用滚回列表顶部。普通模式的
 * 页头维持原有行为（随列表滚走）。
 */

const ROW_COUNT = 14

async function seedDocuments(page: Page) {
  await page.goto('/')
  await page.evaluate((count) => {
    localStorage.clear()
    const base = Date.parse('2026-07-01T08:00:00.000Z')
    const drafts = Array.from({ length: count }, (_, index) => ({
      id: `pinned-row-${index}`,
      markdown: `# Pinned selection ${index}\n\nbody ${index}`,
      updatedAt: new Date(base - index * 60_000).toISOString(),
      lastSavedAt: new Date(base - index * 60_000).toISOString(),
    }))
    localStorage.setItem('marktext-for-android:drafts', JSON.stringify(drafts))
  }, ROW_COUNT)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'InkMark' })).toBeVisible()
}

function scrollHomeList(page: Page, top: number) {
  return page.evaluate((value) => {
    const container = document.querySelector<HTMLElement>('.home-main')
    if (container) container.scrollTop = value
  }, top)
}

test('keeps the selection bar pinned while the document list scrolls', async ({ page }) => {
  await seedDocuments(page)

  // 0 号是「继续写作」大卡，长按列表里的普通行进入选择模式
  const firstRow = page.getByRole('button', { name: /Pinned selection 3/ })
  await longPress(page, firstRow)
  const bar = page.getByTestId('home-selection-bar')
  await expect(bar).toBeVisible()
  // Let the swap transition settle before measuring the resting position.
  await page.waitForTimeout(250)
  const before = await bar.boundingBox()
  expect(before).not.toBeNull()

  // 向下滚动列表：顶栏仍可见，且停在原位（钉住）
  await scrollHomeList(page, 999)
  await expect(bar).toBeVisible()
  const after = await bar.boundingBox()
  expect(after).not.toBeNull()
  expect(Math.abs((after?.y ?? -1) - (before?.y ?? -2))).toBeLessThanOrEqual(2)
  await expect(page.getByTestId('home-selection-count')).toHaveText('1')

  // 钉住状态下直接操作：退出选择，回到普通首页
  await page.getByTestId('home-selection-exit').click()
  await expect(bar).toHaveCount(0)

  // 普通模式页头维持随列表滚走（记录既有行为，避免误钉）
  await scrollHomeList(page, 999)
  await expect(page.getByRole('heading', { name: 'InkMark' })).not.toBeInViewport()
})
