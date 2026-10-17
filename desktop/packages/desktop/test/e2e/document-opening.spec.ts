import { expect, test } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchElectron, waitForEditor } from './helpers'

// Opening a document shows the opening overlay (name + sweep + Cancel). Cancel
// is a real transaction abort: the tab closes and the recent list returns.
//
// The open runs when the test says so: the app launches empty with
// `openFilesInNewWindow`, a dom-ready observer is injected into every future
// window (before its Vue bootstrap), and then the main process is asked to open
// the file. The observer can therefore click Cancel in the same microtask that
// inserts the overlay — before the parse occupies the renderer.

function largeMarkdown(sections: number): string {
  const parts: string[] = ['# Opening target', '']
  for (let i = 1; i <= sections; i += 1) {
    parts.push(
      `## Section ${i}`,
      '',
      `Paragraph ${i} with **bold** and a [link](https://example.com/${i}).`,
      ''
    )
  }
  return parts.join('\n')
}

function writeTempMarkdown(content: string, name = 'opening-target.md'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkmark-opening-'))
  const file = path.join(dir, name)
  fs.writeFileSync(file, content, 'utf-8')
  return file
}

async function openFileInNewWindow(app: ElectronApplication, filePath: string, autoCancel: boolean) {
  const windowPromise = app.waitForEvent('window')
  await app.evaluate(
    ({ app: electronApp, ipcMain }, { filePath: target, autoCancel: cancel }) => {
      electronApp.on('browser-window-created', (_event, win) => {
        win.webContents.on('dom-ready', () => {
          win.webContents
            .executeJavaScript(
              `
              window.__openingSeen = false;
              window.__autoCancel = ${cancel ? 'true' : 'false'};
              new MutationObserver(() => {
                if (document.querySelector('[data-testid="editor-opening"]'))
                  window.__openingSeen = true;
                const button = document.querySelector('[data-testid="cancel-opening-button"]');
                if (button && window.__autoCancel) {
                  window.__autoCancel = false;
                  button.click();
                }
              }).observe(document.documentElement, { childList: true, subtree: true });
            `
            )
            .catch(() => {})
        })
      })
      ipcMain.emit('app-open-file-by-id', 1, target, {})
    },
    { filePath, autoCancel }
  )
  return windowPromise
}

test('a document open can be cancelled back to the recent list', async() => {
  test.setTimeout(120_000)
  const filePath = writeTempMarkdown(largeMarkdown(16000))
  const { app } = await launchElectron([], { preferences: { openFilesInNewWindow: true } })
  try {
    const page = await openFileInNewWindow(app, filePath, true)

    await page.waitForSelector('.recent-files-projects', { timeout: 30_000 })
    expect(
      await page.evaluate(() => (window as unknown as { __openingSeen?: boolean }).__openingSeen)
    ).toBe(true)
    await expect(page.locator('.editor-component')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('a normal open shows the overlay and then the editor', async() => {
  test.setTimeout(120_000)
  const filePath = writeTempMarkdown(largeMarkdown(16000))
  const { app } = await launchElectron([], { preferences: { openFilesInNewWindow: true } })
  try {
    const page = await openFileInNewWindow(app, filePath, false)

    await waitForEditor(page, 60_000)
    expect(
      await page.evaluate(() => (window as unknown as { __openingSeen?: boolean }).__openingSeen)
    ).toBe(true)
    await expect(page.getByTestId('editor-opening')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('cancelling a document opened in a tab leaves the previous tab intact', async() => {
  test.setTimeout(120_000)
  const fileA = writeTempMarkdown('# Alpha page\n\nalpha body paragraph.\n', 'alpha.md')
  const fileB = writeTempMarkdown(largeMarkdown(16000), 'opening-target.md')
  const { app } = await launchElectron([fileA], { preferences: { openFilesInNewWindow: false } })
  try {
    const page = await app.firstWindow()
    await waitForEditor(page, 60_000)
    await expect(page.locator('.mu-container h1')).toContainText('Alpha page')

    // Cancel the moment the overlay's Cancel button exists — i.e. while the
    // second document is still an opening transaction.
    await page.evaluate(() => {
      const win = window as unknown as { __openingCancelled?: boolean }
      const observer = new MutationObserver(() => {
        const button = document.querySelector<HTMLElement>(
          '[data-testid="cancel-opening-button"]'
        )
        if (button && !win.__openingCancelled) {
          win.__openingCancelled = true
          button.click()
          observer.disconnect()
        }
      })
      observer.observe(document.documentElement, { childList: true, subtree: true })
    })
    await app.evaluate(({ ipcMain, BrowserWindow }, file) => {
      const win = BrowserWindow.getAllWindows()[0]
      ipcMain.emit('app-open-file-by-id', win.id, file, {})
    }, fileB)

    // The added tab is rolled back: one tab remains, showing alpha, and no
    // half-open overlay is left behind.
    await expect(page.getByTestId('editor-opening')).toHaveCount(0, { timeout: 60_000 })
    await expect(page.locator('.tabs-container li')).toHaveCount(1, { timeout: 20_000 })
    await expect(page.locator('.mu-container h1')).toContainText('Alpha page')
  } finally {
    await app.close()
  }
})

test('switching tabs shows the opening surface and restores the cached document', async() => {
  test.setTimeout(120_000)
  const fileA = writeTempMarkdown('# Alpha page\n\n' + 'alpha body paragraph.\n\n'.repeat(200), 'alpha.md')
  const fileB = writeTempMarkdown(
    '# Beta page\n\n' + '## Section\n\nbeta body paragraph with some words.\n\n'.repeat(4000),
    'beta.md'
  )
  const { app } = await launchElectron([fileA], { preferences: { openFilesInNewWindow: false } })
  try {
    const page = await app.firstWindow()
    await waitForEditor(page, 60_000)
    await expect(page.locator('.mu-container h1')).toContainText('Alpha page')

    // Open the second file as a tab in the same window.
    await app.evaluate(({ ipcMain, BrowserWindow }, file) => {
      const win = BrowserWindow.getAllWindows()[0]
      ipcMain.emit('app-open-file-by-id', win.id, file, {})
    }, fileB)
    await expect(page.locator('.mu-container h1')).toContainText('Beta page', { timeout: 60_000 })

    // Switching back: the opening surface appears (the opening animation on a
    // tab switch), and the cached engine state restores the document.
    await page.evaluate(() => {
      const win = window as unknown as { __openingSeen?: boolean }
      win.__openingSeen = false
      new MutationObserver(() => {
        if (document.querySelector('[data-testid="editor-opening"]')) win.__openingSeen = true
      }).observe(document.documentElement, { childList: true, subtree: true })
    })
    await page.locator('.tabs-container li', { hasText: 'alpha.md' }).click()
    await expect(page.locator('.mu-container h1')).toContainText('Alpha page', { timeout: 60_000 })
    expect(
      await page.evaluate(() => (window as unknown as { __openingSeen?: boolean }).__openingSeen)
    ).toBe(true)
    // Then back to Beta once more: its cache restores it as well.
    await page.locator('.tabs-container li', { hasText: 'beta.md' }).click()
    await expect(page.locator('.mu-container h1')).toContainText('Beta page', { timeout: 60_000 })
  } finally {
    await app.close()
  }
})
