import { ref, type Ref } from 'vue'
import { getDomSelectionSnapshot } from './selectionToolbar'

export interface CaretHandleRect {
  left: number
  top: number
  right: number
  bottom: number
}

interface CaretHandleLogger {
  debug(message: string, context?: Record<string, unknown>): void
}

export interface CreateEditorCaretHandleOptions {
  isEditorReady: () => boolean
  /** False while a sheet, prompt or the source mode owns the interaction. */
  canActivate: () => boolean
  /** The live editor root; the caret and the native handle both live in it. */
  getEditorHost: () => HTMLElement | null
  logger?: CaretHandleLogger
}

export interface EditorCaretHandle {
  /** The caret the app's own handle follows, in viewport coordinates. */
  rect: Ref<CaretHandleRect | null>
  visible: Ref<boolean>
  dragging: Ref<boolean>
  notifyDragStarted(): void
  notifyDragEnded(): void
  /** Re-measure now — for state changes no event announces (a sheet opened). */
  refresh(): void
  teardown(): void
}

// The WebView draws its own insertion handle — a bordered box with an inner
// caret glyph — in a compositor layer above all DOM content: no markup can
// cover it and no CSS can restyle it. It appears for GESTURE-placed carets
// (tap or long-press). Re-applying the same collapsed selection programmatically
// makes Chromium drop that handle while the caret, the focus and the keyboard
// stay exactly as they are, which is the mechanism this layer uses before
// showing the app's own handle in its place.
const NATIVE_HANDLE_SETTLE_MS = 60

export function createEditorCaretHandle(
  options: CreateEditorCaretHandleOptions,
): EditorCaretHandle {
  const rect = ref<CaretHandleRect | null>(null)
  const visible = ref(false)
  const dragging = ref(false)

  let settleTimer: number | null = null
  let measureFrame: number | null = null

  function hideNativeInsertionHandle() {
    const host = options.getEditorHost()
    const active = document.activeElement
    if (!host || !active || !host.contains(active)) {
      return
    }

    const selection = document.getSelection()
    if (!selection || selection.rangeCount !== 1 || !selection.isCollapsed) {
      return
    }

    const range = selection.getRangeAt(0)
    if (!host.contains(range.startContainer)) {
      return
    }

    const clone = range.cloneRange()
    selection.removeAllRanges()
    selection.addRange(clone)
  }

  // Re-measures the caret the handle follows. Returns false when the handle
  // has no business being on screen: no collapsed caret in the focused editor
  // (an expanded selection shows the selection toolbar instead) or the editor
  // is gone.
  function measure(): boolean {
    const host = options.getEditorHost()
    if (!host || !options.isEditorReady() || !options.canActivate()) {
      return false
    }

    const active = document.activeElement
    if (!active || !host.contains(active)) {
      return false
    }

    const snapshot = getDomSelectionSnapshot(host)
    if (!snapshot?.withinEditor || !snapshot.collapsed || !snapshot.rect) {
      return false
    }

    rect.value = {
      left: snapshot.rect.left,
      top: snapshot.rect.top,
      right: snapshot.rect.right,
      bottom: snapshot.rect.bottom,
    }
    return true
  }

  function refresh() {
    const nextVisible = measure()
    if (nextVisible !== visible.value) {
      visible.value = nextVisible
      if (!nextVisible) {
        rect.value = null
      }
      options.logger?.debug(`editor caret handle ${nextVisible ? 'shown' : 'hidden'}`, {
        left: rect.value?.left ?? null,
        top: rect.value?.top ?? null,
      })
      return
    }

    if (!nextVisible) {
      rect.value = null
    }
  }

  function scheduleRefresh() {
    if (measureFrame !== null) {
      return
    }

    measureFrame = requestAnimationFrame(() => {
      measureFrame = null
      refresh()
    })
  }

  // The native handle is created from the gesture that placed the caret, a
  // frame or two after the caret itself exists: hide it once that has settled,
  // then publish the app's own handle.
  function handleGestureSettled() {
    if (settleTimer !== null) {
      window.clearTimeout(settleTimer)
    }

    settleTimer = window.setTimeout(() => {
      settleTimer = null
      hideNativeInsertionHandle()
      refresh()
      // What the WebView draws afterwards is a frame behind the re-apply; one
      // more pass covers it.
      requestAnimationFrame(() => {
        hideNativeInsertionHandle()
        refresh()
      })
    }, NATIVE_HANDLE_SETTLE_MS)
  }

  function isInsideEditorTarget(target: EventTarget | null) {
    const host = options.getEditorHost()
    return Boolean(host && target instanceof Node && host.contains(target))
  }

  function onDocumentTouchEnd(event: TouchEvent) {
    const touch = event.changedTouches[0]
    if (!touch || !isInsideEditorTarget(event.target)) {
      return
    }

    handleGestureSettled()
  }

  function onDocumentPointerUp(event: PointerEvent) {
    if (event.pointerType === 'mouse' || !isInsideEditorTarget(event.target)) {
      return
    }

    handleGestureSettled()
  }

  // Web dev and e2e have no touch: Chromium fires contextmenu for long-press
  // and right-click, the same fallback signal the selection toolbar listens
  // for. Never prevented — on Android the suppressed ActionMode covers the
  // long-press and the touch listener above already settled the handle, so
  // this only keeps the two environments showing the same surface.
  function onDocumentContextMenu(event: Event) {
    if (!isInsideEditorTarget(event.target)) {
      return
    }

    handleGestureSettled()
  }

  // Typing reclaims the screen: the native caret handle hides on the first
  // keystroke and the app's handle follows it out (the caret is still there,
  // but nothing is being repositioned).
  function hideForTyping() {
    if (settleTimer !== null) {
      window.clearTimeout(settleTimer)
      settleTimer = null
    }

    if (!visible.value) {
      return
    }

    visible.value = false
    rect.value = null
    options.logger?.debug('editor caret handle hidden', { reason: 'typing' })
  }

  function onDocumentSelectionChange() {
    if (dragging.value) {
      // The drag drives the caret itself; the handle stays under the finger.
      scheduleRefresh()
      return
    }

    if (!visible.value) {
      return
    }

    // A selection appeared (word select, select-all, widening a caret):
    // the selection toolbar owns the surface from here.
    if (!measure()) {
      visible.value = false
      rect.value = null
    }
  }

  // A scroll tracks the caret only while the handle is shown: it must not
  // resurrect a handle that typing or a competing surface put away — the next
  // gesture brings it back, exactly like the WebView's own handle.
  function onDocumentScroll() {
    if (visible.value) {
      scheduleRefresh()
    }
  }

  document.addEventListener('touchend', onDocumentTouchEnd, true)
  document.addEventListener('pointerup', onDocumentPointerUp, true)
  document.addEventListener('contextmenu', onDocumentContextMenu)
  document.addEventListener('selectionchange', onDocumentSelectionChange)
  document.addEventListener('scroll', onDocumentScroll, { capture: true, passive: true })
  document.addEventListener('keydown', hideForTyping, true)
  document.addEventListener('beforeinput', hideForTyping, true)

  return {
    rect,
    visible,
    dragging,
    notifyDragStarted() {
      dragging.value = true
    },
    notifyDragEnded() {
      dragging.value = false
      refresh()
    },
    refresh,
    teardown() {
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer)
        settleTimer = null
      }
      if (measureFrame !== null) {
        cancelAnimationFrame(measureFrame)
        measureFrame = null
      }
      document.removeEventListener('touchend', onDocumentTouchEnd, true)
      document.removeEventListener('pointerup', onDocumentPointerUp, true)
      document.removeEventListener('contextmenu', onDocumentContextMenu)
      document.removeEventListener('selectionchange', onDocumentSelectionChange)
      document.removeEventListener('scroll', onDocumentScroll, { capture: true })
      document.removeEventListener('keydown', hideForTyping, true)
      document.removeEventListener('beforeinput', hideForTyping, true)
    },
  }
}
