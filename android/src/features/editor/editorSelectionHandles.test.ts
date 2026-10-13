// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createEditorSelectionHandles,
  type EditorSelectionHandles,
} from './editorSelectionHandles'

// A collapsed caret at x=16 on a 24px line, the way a real browser reports it:
// zero width, real height. happy-dom performs no layout (every rect is zero),
// so the caret's range carries the geometry the snapshot code reads. The
// stub lives on the prototype because the composable re-applies a CLONE of
// the range to hide the WebView's own handle, and the clone must report the
// same geometry.
const CARET_RECT = {
  left: 16,
  right: 40,
  top: 40,
  bottom: 64,
  width: 0,
  height: 24,
}

beforeEach(() => {
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue({
    ...CARET_RECT,
    x: CARET_RECT.left,
    y: CARET_RECT.top,
    toJSON: () => ({}),
  } as DOMRect)
})

afterEach(() => {
  vi.restoreAllMocks()
  document.getSelection()?.removeAllRanges()
  document.body.innerHTML = ''
})

interface Harness {
  handle: EditorSelectionHandles
  host: HTMLElement
  editor: HTMLElement
  paragraph: HTMLElement
  logger: { debug: ReturnType<typeof vi.fn> }
  setActivatable: (activatable: boolean) => void
}

function buildHarness(): Harness {
  const host = document.createElement('div')
  const editor = document.createElement('div')
  editor.className = 'mu-editor'
  editor.setAttribute('contenteditable', 'true')
  const paragraph = document.createElement('p')
  paragraph.textContent = 'Alpha bravo charlie'
  editor.append(paragraph)
  host.append(editor)
  document.body.append(host)

  let activatable = true
  const logger = { debug: vi.fn() }
  const handle = createEditorSelectionHandles({
    isEditorReady: () => true,
    getEditorHost: () => host,
    canActivate: () => activatable,
    logger,
  })

  return {
    handle,
    host,
    editor,
    paragraph,
    logger,
    setActivatable: next => {
      activatable = next
    },
  }
}

function placeCaret(node: Node, offset = 0) {
  const range = document.createRange()
  range.setStart(node.firstChild ?? node, offset)
  range.collapse(true)
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

// Moves the caret the way an editor does after the handle exists: the live
// range is mutated in place, which fires no event of its own. Real browsers
// deliver selectionchange asynchronously, after the mutation completed, so
// the manual dispatch below reproduces what the composable sees in
// production (happy-dom would otherwise report the mid-mutation state).
function moveCaret(node: Node, offset: number) {
  const selection = document.getSelection()!
  const range = selection.getRangeAt(0)
  range.setStart(node.firstChild ?? node, offset)
  range.collapse(true)
  fireSelectionChange()
}

function widenSelection(node: Node) {
  const selection = document.getSelection()!
  selection.getRangeAt(0).selectNodeContents(node)
  fireSelectionChange()
}

// happy-dom dispatches neither touch nor pointer events from user gestures;
// the composable only reads pointerType and changedTouches, so plain events
// carrying those properties exercise the same code paths.
function fireTouchEnd(target: EventTarget) {
  const event = new Event('touchend', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'changedTouches', { value: [{}] })
  target.dispatchEvent(event)
}

function firePointerUp(target: EventTarget, pointerType: string) {
  const event = new Event('pointerup', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'pointerType', { value: pointerType })
  target.dispatchEvent(event)
}

function fireContextMenu(target: EventTarget) {
  target.dispatchEvent(new Event('contextmenu', { bubbles: true, cancelable: true }))
}

function fireSelectionChange() {
  document.dispatchEvent(new Event('selectionchange'))
}

function fireKeydown() {
  document.body.dispatchEvent(new Event('keydown', { bubbles: true }))
}

function fireScroll() {
  document.dispatchEvent(new Event('scroll'))
}

function focusEditor(harness: Harness) {
  harness.editor.focus()
  placeCaret(harness.paragraph, 5)
}

function settleDelay() {
  return new Promise(resolve => setTimeout(resolve, 120))
}

describe('createEditorCaretHandle', () => {
  it('shows the handle once a touch gesture settles inside the editor', async () => {
    const harness = buildHarness()
    focusEditor(harness)

    fireTouchEnd(harness.paragraph)

    await vi.waitFor(() => expect(harness.handle.visible.value).toBe(true))
    expect(harness.handle.handles.value).toEqual([
      {
        role: 'caret',
        rect: {
          left: CARET_RECT.left,
          top: CARET_RECT.top,
          right: CARET_RECT.right,
          bottom: CARET_RECT.bottom,
        },
      },
    ])
    expect(harness.logger.debug).toHaveBeenCalledWith(
      'editor handles shown',
      expect.objectContaining({ roles: 'caret' }),
    )
  })

  it('shows the handle for the web long-press signal (contextmenu)', async () => {
    const harness = buildHarness()
    focusEditor(harness)

    fireContextMenu(harness.paragraph)

    await vi.waitFor(() => expect(harness.handle.visible.value).toBe(true))
  })

  it('shows the handle for a touch pointerup but ignores the mouse', async () => {
    const harness = buildHarness()
    focusEditor(harness)

    firePointerUp(harness.paragraph, 'touch')
    await vi.waitFor(() => expect(harness.handle.visible.value).toBe(true))

    harness.handle.teardown()
    const second = buildHarness()
    focusEditor(second)
    firePointerUp(second.paragraph, 'mouse')
    await settleDelay()
    expect(second.handle.visible.value).toBe(false)
  })

  it('ignores gestures that end outside the editor', async () => {
    const harness = buildHarness()
    focusEditor(harness)
    const outsider = document.createElement('div')
    document.body.append(outsider)

    fireTouchEnd(outsider)

    await settleDelay()
    expect(harness.handle.visible.value).toBe(false)
  })

  it('hides when typing starts', async () => {
    const harness = buildHarness()
    focusEditor(harness)
    fireTouchEnd(harness.paragraph)
    await vi.waitFor(() => expect(harness.handle.visible.value).toBe(true))

    fireKeydown()

    expect(harness.handle.visible.value).toBe(false)
    expect(harness.handle.handles.value).toEqual([])
    expect(harness.logger.debug).toHaveBeenCalledWith('editor handles hidden', {
      reason: 'typing',
    })
  })

  it('hides when a competing surface takes over the interaction', async () => {
    const harness = buildHarness()
    focusEditor(harness)
    fireTouchEnd(harness.paragraph)
    await vi.waitFor(() => expect(harness.handle.visible.value).toBe(true))

    harness.setActivatable(false)
    harness.handle.refresh()

    expect(harness.handle.visible.value).toBe(false)
  })

  it('hides when focus leaves the editor', async () => {
    const harness = buildHarness()
    focusEditor(harness)
    fireTouchEnd(harness.paragraph)
    await vi.waitFor(() => expect(harness.handle.visible.value).toBe(true))

    harness.editor.blur()
    fireSelectionChange()

    expect(harness.handle.visible.value).toBe(false)
  })

  it('does not resurrect on a scroll after typing put it away', async () => {
    const harness = buildHarness()
    focusEditor(harness)
    fireTouchEnd(harness.paragraph)
    await vi.waitFor(() => expect(harness.handle.visible.value).toBe(true))

    fireKeydown()
    expect(harness.handle.visible.value).toBe(false)

    fireScroll()
    await settleDelay()

    expect(harness.handle.visible.value).toBe(false)
  })

  it('tracks the caret while shown and a scroll re-measures it', async () => {
    const harness = buildHarness()
    focusEditor(harness)
    fireTouchEnd(harness.paragraph)
    await vi.waitFor(() => expect(harness.handle.visible.value).toBe(true))

    moveCaret(harness.paragraph, 11)
    fireScroll()

    await vi.waitFor(() =>
      expect(harness.handle.handles.value[0]?.rect).toEqual({
        left: CARET_RECT.left,
        top: CARET_RECT.top,
        right: CARET_RECT.right,
        bottom: CARET_RECT.bottom,
      }),
    )
    expect(harness.handle.visible.value).toBe(true)
  })

  it('keeps the drag state across selection changes and ends it on demand', async () => {
    const harness = buildHarness()
    focusEditor(harness)
    fireTouchEnd(harness.paragraph)
    await vi.waitFor(() => expect(harness.handle.visible.value).toBe(true))

    harness.handle.notifyDragStarted()
    expect(harness.handle.dragging.value).toBe(true)

    // The drag drives the caret itself; the handle stays under the finger.
    moveCaret(harness.paragraph, 9)
    await vi.waitFor(() => expect(harness.handle.visible.value).toBe(true))

    harness.handle.notifyDragEnded()
    expect(harness.handle.dragging.value).toBe(false)
    expect(harness.handle.visible.value).toBe(true)
  })

  it('shows one capsule per selection edge, at the edge it points at', async () => {
    const harness = buildHarness()
    focusEditor(harness)
    fireTouchEnd(harness.paragraph)
    await vi.waitFor(() => expect(harness.handle.visible.value).toBe(true))

    widenSelection(harness.paragraph)

    expect(harness.handle.handles.value).toEqual([
      {
        role: 'selection-start',
        rect: {
          left: CARET_RECT.left,
          top: CARET_RECT.top,
          right: CARET_RECT.left,
          bottom: CARET_RECT.bottom,
        },
      },
      {
        role: 'selection-end',
        rect: {
          left: CARET_RECT.right,
          top: CARET_RECT.top,
          right: CARET_RECT.right,
          bottom: CARET_RECT.bottom,
        },
      },
    ])
  })

  it('keeps the capsules mounted while a drag collapses the selection', async () => {
    const harness = buildHarness()
    focusEditor(harness)
    fireTouchEnd(harness.paragraph)
    await vi.waitFor(() => expect(harness.handle.visible.value).toBe(true))
    widenSelection(harness.paragraph)
    expect(harness.handle.handles.value).toHaveLength(2)

    harness.handle.notifyDragStarted()
    // The drag runs the selection back to a caret; the capsules the finger is
    // holding must not vanish mid-gesture.
    placeCaret(harness.paragraph, 3)
    fireSelectionChange()

    expect(harness.handle.handles.value).toHaveLength(2)
    expect(harness.handle.dragging.value).toBe(true)

    harness.handle.notifyDragEnded()
    expect(harness.handle.handles.value.map(handle => handle.role)).toEqual(['caret'])
  })

  it('stops listening once torn down', async () => {
    const harness = buildHarness()
    focusEditor(harness)
    harness.handle.teardown()

    fireTouchEnd(harness.paragraph)

    await settleDelay()
    expect(harness.handle.visible.value).toBe(false)
  })
})
