import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectEditorReady } from './helpers/editor'

const DRAFT_ID = 'caret-handle-probe'
const PARAGRAPH_NEEDLE = 'Alpha bravo charlie'
const SECOND_PARAGRAPH_NEEDLE = 'Second paragraph tail'

function paragraph(page: Page, needle: string): Locator {
  return page
    .locator('[data-testid="editor-host"] .mu-editor p')
    .filter({ hasText: needle })
    .first()
}

// The long-press entry in the web build: the contextmenu event is the fallback
// signal the real Android long-press reaches the app through. A plain click
// comes first because Chromium's right-click alone leaves the editor
// unfocused — the touch long-press on a device always focuses it, and the
// handle only follows a caret in the focused editor.
async function longPressParagraph(page: Page) {
  await paragraph(page, PARAGRAPH_NEEDLE).click()
  await paragraph(page, PARAGRAPH_NEEDLE).click({ button: 'right' })
}

async function openDraft(page: Page) {
  const now = '2026-07-01T09:00:00.000Z'
  await page.goto('/')
  await page.evaluate(
    ({ now, id, needle, tailNeedle }) => {
      localStorage.clear()
      localStorage.setItem(
        'marktext-for-android:drafts',
        JSON.stringify([
          {
            id,
            markdown: `# Caret Handle\n\n${needle} delta echo\n\n${tailNeedle}\n`,
            updatedAt: now,
            lastSavedAt: now,
          },
        ]),
      )
    },
    {
      now,
      id: DRAFT_ID,
      needle: PARAGRAPH_NEEDLE,
      tailNeedle: SECOND_PARAGRAPH_NEEDLE,
    },
  )
  await page.reload()
  await page.getByRole('button', { name: /Caret Handle/ }).click()
  await expectEditorReady(page)
}

// The caret as the app's own code sees it: a collapsed DOM range identified by
// its text node prefix and offset, which survives block-level re-rendering.
function readCaret(page: Page) {
  return page.evaluate(() => {
    const selection = document.getSelection()
    if (!selection || selection.rangeCount === 0) {
      return { collapsed: false, anchor: 'none', offset: -1 }
    }

    const node = selection.anchorNode
    return {
      collapsed: selection.isCollapsed,
      anchor: node?.textContent?.slice(0, 24) ?? 'element',
      offset: selection.anchorOffset,
    }
  })
}

test('a tapped caret gets the app its own handle', async ({ page }) => {
  await openDraft(page)

  await expect(page.getByTestId('caret-handle')).toHaveCount(0)
  await paragraph(page, PARAGRAPH_NEEDLE).tap()

  // A plain tap places a caret, not a selection: the floating toolbar stays
  // out of it, only the handle shows.
  await expect(page.getByTestId('mobile-selection-toolbar')).toHaveCount(0)
  const handle = page.getByTestId('caret-handle')
  await expect(handle).toBeVisible()

  const handleBox = await handle.boundingBox()
  const caretBox = await paragraph(page, PARAGRAPH_NEEDLE).boundingBox()
  expect(handleBox).not.toBeNull()
  expect(caretBox).not.toBeNull()
  // The capsule hangs off the caret line, inside the paragraph's column.
  expect(handleBox!.y).toBeGreaterThan(caretBox!.y)
  expect(handleBox!.x).toBeGreaterThanOrEqual(caretBox!.x - 40)
  expect(handleBox!.x).toBeLessThanOrEqual(caretBox!.x + caretBox!.width)
})

test('a long-pressed caret gets the app its own handle beside the toolbar', async ({ page }) => {
  await openDraft(page)

  await longPressParagraph(page)

  await expect(page.getByTestId('mobile-selection-toolbar')).toBeVisible()
  const handle = page.getByTestId('caret-handle')
  await expect(handle).toBeVisible()

  const handleBox = await handle.boundingBox()
  const caretBox = await paragraph(page, PARAGRAPH_NEEDLE).boundingBox()
  expect(handleBox).not.toBeNull()
  expect(caretBox).not.toBeNull()
  // The capsule hangs off the caret line, inside the paragraph's column.
  expect(handleBox!.y).toBeGreaterThan(caretBox!.y)
  expect(handleBox!.x).toBeGreaterThanOrEqual(caretBox!.x - 40)
  expect(handleBox!.x).toBeLessThanOrEqual(caretBox!.x + caretBox!.width)
})

test('the handle follows the caret to the next gesture', async ({ page }) => {
  await openDraft(page)
  await paragraph(page, PARAGRAPH_NEEDLE).tap()
  await expect(page.getByTestId('caret-handle')).toBeVisible()

  // A raw tap away from the first capsule: the handle hangs below the caret
  // line and legitimately sits above the text under it (the same way the
  // WebView's own handle does), so the tap must not land on the handle.
  await paragraph(page, SECOND_PARAGRAPH_NEEDLE).tap({ position: { x: 12, y: 4 } })

  await expect(page.getByTestId('caret-handle')).toBeVisible()
  const caret = await readCaret(page)
  expect(caret.collapsed).toBe(true)
  expect(caret.anchor).toContain('Second paragraph tail')
})

test('dragging the handle moves the caret without selecting text', async ({ page }) => {
  await openDraft(page)
  await longPressParagraph(page)
  await expect(page.getByTestId('caret-handle')).toBeVisible()

  const before = await readCaret(page)
  const box = await page.getByTestId('caret-handle').boundingBox()
  expect(box).not.toBeNull()

  const cx = box!.x + box!.width / 2
  const cy = box!.y + box!.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx - 90, cy - 30, { steps: 10 })

  // The capsule tracks the finger while the drag is live.
  const dragged = await page.getByTestId('caret-handle').boundingBox()
  expect(dragged).not.toBeNull()
  expect(Math.abs(dragged!.x + dragged!.width / 2 - (box!.x + box!.width / 2 - 90))).toBeLessThan(8)

  await page.mouse.up()

  const after = await readCaret(page)
  expect(after.collapsed).toBe(true)
  expect(`${after.anchor}:${after.offset}`).not.toBe(`${before.anchor}:${before.offset}`)
})

test('the handle disappears once the caret session ends', async ({ page }) => {
  await openDraft(page)
  await longPressParagraph(page)
  await expect(page.getByTestId('caret-handle')).toBeVisible()

  // Moving the caret ends the caret session (an ordinary tap or a caret move
  // both do; the key is immune to the floating toolbar covering nearby text).
  await page.keyboard.press('ArrowLeft')

  await expect(page.getByTestId('caret-handle')).toHaveCount(0)
})

test('a competing surface puts the handle away', async ({ page }) => {
  await openDraft(page)
  await paragraph(page, PARAGRAPH_NEEDLE).tap()
  await expect(page.getByTestId('caret-handle')).toBeVisible()

  await page.getByTestId('outline-open-button').click()

  await expect(page.getByTestId('caret-handle')).toHaveCount(0)
})
