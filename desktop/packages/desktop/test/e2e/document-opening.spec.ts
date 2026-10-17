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

function writeTempMarkdown(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkmark-opening-'))
  const file = path.join(dir, 'opening-target.md')
  fs.writeFileSync(file, content, 'utf-8')
  return file
}

async function openFileInNewWindow(app: ElectronApplication, filePath: string, autoCancel: boolean) {
  const windowPromise = app.waitForEvent('window')
  await app.evaluate(
    ({ app: electronApp, ipcMain }, { filePath: target, autoCancel: cancel }) => {
      electronApp.on('browser-window-created', (_event, win) => {
        win.webContents.on('dom-ready', () => {
          void win.webContents
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

test('a document open can be cancelled back to the recent list', async () => {
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

test('a normal open shows the overlay and then the editor', async () => {
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
