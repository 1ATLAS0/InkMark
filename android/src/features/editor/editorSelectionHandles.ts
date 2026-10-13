import { computed, ref, type Ref } from 'vue'
import { getDomSelectionSnapshot } from './selectionToolbar'

export interface HandleRect {
  left: number
  top: number
  right: number
  bottom: number
}

export type EditorHandleRole = 'caret' | 'selection-start' | 'selection-end'

export interface EditorHandle {
  role: EditorHandleRole
  /** Where the capsule hangs, in viewport coordinates. */
  rect: HandleRect
}

interface HandleLogger {
  debug(message: string, context?: Record<string, unknown>): void
}

export interface CreateEditorSelectionHandlesOptions {
  isEditorReady: () => boolean
  /** False while a sheet, prompt or the source mode owns the interaction. */
  canActivate: () => boolean
  /** The live editor root; the caret and the native handles both live in it. */
  getEditorHost: () => HTMLElement | null
  logger?: HandleLogger
}

export interface EditorSelectionHandles {
  /** The capsules to draw: one for a caret, two for a selection. Empty = none. */
  handles: Ref<EditorHandle[]>
  visible: Ref<boolean>
  dragging: Ref<boolean>
  notifyDragStarted(): void
  notifyDragEnded(): void
  /** Re-measure now — for state changes no event announces (a sheet opened). */
  refresh(): void
  teardown(): void
}

// The WebView draws its own text handles — a bordered teardrop for a selection
// edge, a rounded box with an inner caret glyph for the insertion point — in a
// compositor layer above all DOM content: no markup can cover them and no CSS
// can restyle them. They appear for GESTURE-made selections and gestures that
// place a caret. Re-applying the same selection programmatically makes Chromium
// drop those handles while the selection, the focus and the keyboard stay
// exactly as they are, which is the mechanism this layer uses before showing
// the app's own capsules in their place.
const NATIVE_HANDLE_SETTLE_MS = 60

export function createEditorSelectionHandles(
  options: CreateEditorSelectionHandlesOptions,
): EditorSelectionHandles {
  const handles = ref<EditorHandle[]>([])
  const dragging = ref(false)
  const visible = computed(() => handles.value.length > 0)

  let settleTimer: number | null = null
  let measureFrame: number | null = null

  function hideNativeGestureHandles() {
    const host = options.getEditorHost()
    const active = document.activeElement
    if (!host || !active || !host.contains(active)) {
      return
    }

    const selection = document.getSelection()
    if (!selection || selection.rangeCount !== 1) {
      return
    }

    const range = selection.getRangeAt(0)
    if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) {
      return
    }

    const clone = range.cloneRange()
    selection.removeAllRanges()
    selection.addRange(clone)
  }

  // The capsule for one edge of a range: a collapsed range at the edge reports
  // the line box it sits in, so the capsule can hang off the line the edge is
  // on. Cheaper and steadier than walking every client rect of a long
  // selection, and it matches where the native handles point.
  function edgeRect(range: Range, edge: 'start' | 'end'): HandleRect | null {
    const edgeRange = document.createRange()
    const node = edge === 'start' ? range.startContainer : range.endContainer
    const offset = edge === 'start' ? range.startOffset : range.endOffset

    try {
      edgeRange.setStart(node, offset)
      edgeRange.setEnd(node, offset)
    } catch {
      return null
    }

    const rect = edgeRange.getBoundingClientRect()
    if (rect.height === 0 && rect.width === 0) {
      return null
    }

    const x = edge === 'start' ? rect.left : rect.right
    return { left: x, top: rect.top, right: x, bottom: rect.bottom }
  }

  // Re-measures the handles. Returns an empty list when neither kind has any
  // business on screen: the editor is gone, unfocused, or a sheet owns the
  // surface.
  function measure(): EditorHandle[] {
    const host = options.getEditorHost()
    if (!host || !options.isEditorReady() || !options.canActivate()) {
      return []
    }

    const active = document.activeElement
    if (!active || !host.contains(active)) {
      return []
    }

    const snapshot = getDomSelectionSnapshot(host)
    if (!snapshot?.withinEditor) {
      return []
    }

    if (snapshot.collapsed) {
      if (!snapshot.rect) {
        return []
      }

      return [
        {
          role: 'caret',
          rect: {
            left: snapshot.rect.left,
            top: snapshot.rect.top,
            right: snapshot.rect.right,
            bottom: snapshot.rect.bottom,
          },
        },
      ]
    }

    const selection = document.getSelection()
    if (!selection || selection.rangeCount === 0) {
      return []
    }

    const range = selection.getRangeAt(0)
    const next: EditorHandle[] = []
    const start = edgeRect(range, 'start')
    const end = edgeRect(range, 'end')
    if (start) {
      next.push({ role: 'selection-start', rect: start })
    }
    if (end) {
      next.push({ role: 'selection-end', rect: end })
    }
    return next
  }

  function refresh() {
    // A drag owns the surface while it lasts: the handle under the finger
    // positions itself, and freezing the set keeps both capsules mounted even
    // if the drag collapses the selection.
    if (dragging.value) {
      return
    }

    const next = measure()
    const changed =
      next.length !== handles.value.length ||
      next.some((handle, index) => handle.role !== handles.value[index]?.role)
    handles.value = next

    if (changed) {
      options.logger?.debug(`editor handles ${next.length > 0 ? 'shown' : 'hidden'}`, {
        roles: next.map(handle => handle.role).join(','),
      })
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

  // The native handles are created from the gesture that made the selection or
  // placed the caret, a frame or two after that state exists: hide them once it
  // has settled, then publish the app's own capsules.
  function handleGestureSettled() {
    if (settleTimer !== null) {
      window.clearTimeout(settleTimer)
    }

    settleTimer = window.setTimeout(() => {
      settleTimer = null
      hideNativeGestureHandles()
      refresh()
      // What the WebView draws afterwards is a frame behind the re-apply; one
      // more pass covers it.
      requestAnimationFrame(() => {
        hideNativeGestureHandles()
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
  // long-press and the touch listener above already settled the handles, so
  // this only keeps the two environments showing the same surface.
  function onDocumentContextMenu(event: Event) {
    if (!isInsideEditorTarget(event.target)) {
      return
    }

    handleGestureSettled()
  }

  // Typing reclaims the screen: the native handles hide on the first keystroke
  // and the app's capsules follow them out (an edit also ends the selection
  // they belonged to).
  function hideForTyping() {
    if (settleTimer !== null) {
      window.clearTimeout(settleTimer)
      settleTimer = null
    }

    if (handles.value.length === 0) {
      return
    }

    handles.value = []
    options.logger?.debug('editor handles hidden', { reason: 'typing' })
  }

  function onDocumentSelectionChange() {
    if (dragging.value) {
      // The drag drives the selection itself; both capsules stay put until the
      // finger lifts.
      return
    }

    if (handles.value.length === 0) {
      return
    }

    // Keeps a shown set in step with the live selection (a widening caret, a
    // selection that collapsed to a caret, the editor losing focus).
    refresh()
  }

  // A scroll tracks the selection only while capsules are shown: it must not
  // resurrect handles that typing or a competing surface put away — the next
  // gesture brings them back, exactly like the WebView's own handles.
  function onDocumentScroll() {
    if (handles.value.length > 0) {
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
    handles,
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
