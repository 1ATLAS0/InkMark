import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchElectron } from './helpers'

test.describe('Check Launch', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const { app: electronApp, page: firstPage } = await launchElectron()
    app = electronApp
    page = firstPage
  })

  test.afterAll(async() => {
    await app.close()
  })

  test('Empty window title carries the product name', async() => {
    // 产品名从应用自身读取（app.getName() 取 package.json 的 productName），
    // 这样改名/换品牌后用例依然成立，不必写死 "MarkText"/"InkMark"。
    const productName = await app.evaluate(({ app: electronApp }) => electronApp.getName())
    const title = await page.title()
    expect(productName.length).toBeGreaterThan(0)
    expect(title === productName || title.endsWith(` - ${productName}`)).toBeTruthy()
  })
})
