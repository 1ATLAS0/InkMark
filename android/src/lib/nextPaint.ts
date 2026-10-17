/**
 * Resolve after one animation frame. Call sites use it to let a busy-state UI
 * paint — and a queued Cancel click land — before a synchronous pass occupies
 * the main thread. Resolves immediately where requestAnimationFrame is not
 * available (unit tests run in a node environment).
 */
export function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      resolve()
      return
    }
    requestAnimationFrame(() => resolve())
  })
}
