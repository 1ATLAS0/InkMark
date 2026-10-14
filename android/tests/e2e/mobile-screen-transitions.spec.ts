import { expect, test, type Page } from '@playwright/test'
import { expectEditorReady } from './helpers/editor'
import { DRAFTS_STORAGE_KEY } from './helpers/drafts'

/**
 * 整屏切换动效：打开文档等屏幕切换走原生式推入/退出（push/pop），同级切换
 * 交叉淡入；prefers-reduced-motion 下不产生动画；自动化会话（navigator.webdriver）
 * 完全不挂过渡类，其余用例的几何断言就不必与 200ms 位移竞争。
 */

const DRAFT_ID = 'screen-transition-draft'
const DRAFT_TITLE = /Transitions/

async function seedDraft(page: Page) {
  await page.goto('/')
  await page.evaluate(
    ({ key, id }) => {
      localStorage.clear()
      localStorage.setItem(
        key,
        JSON.stringify([
          {
            id,
            markdown: '# Transitions\n\nslides in and out',
            updatedAt: '2026-07-01T09:00:00.000Z',
            lastSavedAt: '2026-07-01T09:00:00.000Z',
          },
        ]),
      )
    },
    { key: DRAFTS_STORAGE_KEY, id: DRAFT_ID },
  )
  await page.reload()
}

function allowScreenMotion(page: Page) {
  return page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false })
  })
}

function watchShellClasses(page: Page, classNames: string[], windowMs = 3000) {
  return page.evaluate(
    ({ classNames, windowMs }) =>
      new Promise<boolean>((resolve) => {
        const seen = new Set<string>()
        const deadline = performance.now() + windowMs
        const tick = () => {
          for (const shell of document.querySelectorAll('.app-shell')) {
            for (const name of classNames) {
              if (shell.classList.contains(name)) {
                seen.add(name)
              }
            }
          }
          if (classNames.every(name => seen.has(name))) {
            resolve(true)
            return
          }
          if (performance.now() > deadline) {
            resolve(false)
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
    { classNames, windowMs },
  )
}

function watchShellMotion(page: Page, windowMs: number) {
  return page.evaluate(
    (windowMs) =>
      new Promise<string[]>((resolve) => {
        const seen: string[] = []
        const deadline = performance.now() + windowMs
        const tick = () => {
          for (const animation of document.getAnimations()) {
            const transition = animation as unknown as {
              transitionProperty?: string
              effect?: { target?: unknown } | null
            }
            const target = transition.effect?.target
            const property = transition.transitionProperty
            if (
              target instanceof Element &&
              target.classList.contains('app-shell') &&
              typeof property === 'string' &&
              !seen.includes(property)
            ) {
              seen.push(property)
            }
          }
          if (performance.now() > deadline) {
            resolve(seen)
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
    windowMs,
  )
}

test('slides a document in on open and out on close', async ({ page }) => {
  await allowScreenMotion(page)
  await seedDraft(page)

  const pushSeen = watchShellClasses(page, [
    'app-screen-push-enter-active',
    'app-screen-push-leave-active',
  ])
  await page.getByRole('button', { name: DRAFT_TITLE }).click()
  expect(await pushSeen, '开档应挂 push 过渡类').toBe(true)
  await expectEditorReady(page)

  const popSeen = watchShellClasses(page, [
    'app-screen-pop-enter-active',
    'app-screen-pop-leave-active',
  ])
  await page.getByTestId('back-button').click()
  expect(await popSeen, '退出应挂 pop 过渡类').toBe(true)
  await expect(page.getByRole('heading', { name: 'InkMark' })).toBeVisible()
})

test.describe('reduced motion', () => {
  // 该版本测试运行器忽略顶层 use.reducedMotion，需要走 contextOptions。
  test.use({ contextOptions: { reducedMotion: 'reduce' } })

  test('swaps screens without running an animation', async ({ page }) => {
    await allowScreenMotion(page)
    await seedDraft(page)
    expect(
      await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    ).toBe(true)

    const motion = watchShellMotion(page, 2500)
    await page.getByRole('button', { name: DRAFT_TITLE }).click()
    await expectEditorReady(page)
    expect(await motion, '减弱动效下屏幕不应有过渡动画').toEqual([])
  })
})

test('automation sessions swap screens without transition classes', async ({ page }) => {
  await seedDraft(page)
  expect(await page.evaluate(() => navigator.webdriver)).toBe(true)

  const transitionSeen = watchShellClasses(
    page,
    ['app-screen-push-enter-active', 'app-screen-push-leave-active'],
    1200,
  )
  await page.getByRole('button', { name: DRAFT_TITLE }).click()
  expect(await transitionSeen, '自动化会话不应挂过渡类').toBe(false)
  await expectEditorReady(page)
})
