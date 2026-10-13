<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { caretRangeAtPoint } from '../selectionToolbar'
import type { EditorHandleRole } from '../editorSelectionHandles'

interface CaretRect {
  left: number
  top: number
  right: number
  bottom: number
}

const props = defineProps<{
  /** What the capsule moves: the caret, or one end of a selection. */
  role: EditorHandleRole
  /** The edge the capsule hangs off, in viewport coordinates. */
  caretRect: CaretRect | null
}>()

const emit = defineEmits<{
  moveCaret: [range: Range]
  extendSelection: [role: 'selection-start' | 'selection-end', target: Range]
  dragStart: []
  dragEnd: []
}>()

// The capsule is drawn under the caret; its width drives the centering math and
// the drag feedback position, so both live here.
const HANDLE_WIDTH = 16
const CARET_GAP = 2
// A gesture that stays within this many pixels is a tap, not a drag.
const TAP_MAX_TRAVEL_PX = 8

const activePointerId = ref<number | null>(null)
const dragPoint = ref<{ x: number; y: number } | null>(null)
// Where inside the capsule the finger landed. Kept for the whole drag, so the
// capsule moves *with* the finger instead of snapping its top edge under it —
// the tip has to stay at the line the caret lookup aims at.
const grabOffset = ref(0)
// Switched off for exactly one lookup while a tap is resolved, so the caret
// lookup reaches the text under the handle instead of the handle itself.
const hitTransparent = ref(false)
const pointerStart = ref<{ x: number; y: number } | null>(null)
const dragging = computed(() => activePointerId.value !== null)

const style = computed(() => {
  const point = dragPoint.value
  if (point) {
    return {
      left: `${Math.round(point.x - HANDLE_WIDTH / 2)}px`,
      top: `${Math.round(point.y - grabOffset.value)}px`,
    }
  }

  const rect = props.caretRect
  if (!rect) {
    return {}
  }

  return {
    left: `${Math.round((rect.left + rect.right) / 2 - HANDLE_WIDTH / 2)}px`,
    top: `${Math.round(rect.bottom + CARET_GAP)}px`,
  }
})

// The shared point-to-caret lookup needs no local copy; the drag just feeds it
// the pointer position and forwards the resulting range.
function onPointerDown(event: PointerEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  activePointerId.value = event.pointerId
  grabOffset.value = event.clientY - rect.top
  pointerStart.value = { x: event.clientX, y: event.clientY }
  dragPoint.value = { x: event.clientX, y: event.clientY }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  emit('dragStart')
  event.preventDefault()
}

function onPointerMove(event: PointerEvent) {
  if (activePointerId.value !== event.pointerId) {
    return
  }

  dragPoint.value = { x: event.clientX, y: event.clientY }
  // The text position is looked up at the capsule's tip, not under the finger:
  // the handle is the topmost element at the pointer, and a lookup there would
  // resolve to the handle itself (and the lifted finger hides the line it aims
  // at). The tip sits on the target line, exactly like the native handle.
  const handleRect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const range = caretRangeAtPoint(event.clientX, handleRect.top - 1)
  if (!range) {
    event.preventDefault()
    return
  }

  if (props.role === 'caret') {
    emit('moveCaret', range)
  } else {
    emit('extendSelection', props.role, range)
  }
  event.preventDefault()
}

// A tap on the handle means what the same tap would mean without it: the caret
// goes where the finger is, which also ends the caret session (the caret moved).
// Hit testing is off for the lookup so it finds the text, not the handle.
async function resolveTapAt(x: number, y: number) {
  hitTransparent.value = true
  await nextTick()
  const range = caretRangeAtPoint(x, y)
  hitTransparent.value = false
  if (range) {
    emit('moveCaret', range)
  }
}

function onPointerUp(event: PointerEvent) {
  if (activePointerId.value !== event.pointerId) {
    return
  }

  const start = pointerStart.value
  const travel = start
    ? Math.hypot(event.clientX - start.x, event.clientY - start.y)
    : Number.POSITIVE_INFINITY
  activePointerId.value = null
  pointerStart.value = null
  dragPoint.value = null
  grabOffset.value = 0
  emit('dragEnd')

  if (travel <= TAP_MAX_TRAVEL_PX) {
    void resolveTapAt(event.clientX, event.clientY)
  }
}

function onPointerCancel(event: PointerEvent) {
  if (activePointerId.value !== event.pointerId) {
    return
  }

  activePointerId.value = null
  pointerStart.value = null
  dragPoint.value = null
  grabOffset.value = 0
  emit('dragEnd')
}
</script>

<template>
  <button
    v-if="caretRect || dragPoint"
    type="button"
    class="caret-handle"
    :class="{ 'is-dragging': dragging, 'is-hit-transparent': hitTransparent }"
    :data-role="role"
    data-testid="text-handle"
    aria-hidden="true"
    tabindex="-1"
    :style="style"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @mousedown.prevent
    @contextmenu.prevent
  />
</template>

<style scoped>
/* A flat capsule instead of the WebView's own text handles: those are a
   bordered teardrop (selection edges) or a rounded box with an inner caret
   glyph (insertion point), drawn above all DOM content. This handle is the
   app's own, so it matches the toolbar's radius and accent, and dragging it
   moves the caret or the selection edge through the app's selection code. */
.caret-handle {
  position: fixed;
  z-index: 23; /* one below the selection toolbar so the bar can overlap it */
  box-sizing: border-box;
  width: 16px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: var(--accent);
  box-shadow: var(--shadow-thumb);
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}

/* Touch target: the capsule stays small, but the draggable area reaches the
   recommended size around it. */
.caret-handle::after {
  content: '';
  position: absolute;
  inset: -10px -14px;
}

.caret-handle.is-dragging {
  width: 20px;
  margin-left: -2px;
}

/* While dragging, the padded hit area must not swallow the caret lookup the
   drag performs just above the capsule's tip: hit testing would resolve to the
   handle itself instead of the text line underneath. */
.caret-handle.is-dragging::after {
  pointer-events: none;
}

.caret-handle.is-hit-transparent {
  pointer-events: none;
}
</style>
