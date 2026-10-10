# Performance plan

This document records what makes the editor slow on large documents, the measurements behind those
conclusions, and the order in which the problems are being addressed.

## How it was measured

| Target | Method |
|---|---|
| Open, close | Application log timestamps (`MarkTextAndroid` records intent, import and editor init) |
| Background load | `adb shell top` sampling the app's CPU every few seconds after opening |
| Scrolling | `dumpsys gfxinfo <package>` frame statistics, plus its input-latency counter |
| Engine behaviour | `dumpsys`/CDP probes against a debug build with WebView debugging enabled |

Test device: vivo PD2509, Android 16. Test document: 1 MB Markdown, 2 839 sections, every section
carrying a table, a fenced code block and inline math — a deliberately heavy construction.

## Measurements

| Phase | Metric | Value |
|---|---|---|
| Open | intent → editor init complete | 3.1 s (engine init 1.4 s) |
| After open | app CPU at 8 / 15 / 25 / 40 / 60 s | 43% → 24% → 23% → 27% → 27% |
| Scrolling | janky frames over 15 swipes | 0.08%, 50th percentile 6 ms |
| Scrolling | high input latency counter | 4 685 |
| Close | back press → home | navigation 2 ms, frame 99th percentile 950 ms |

## What the numbers say

1. **Frames are fine; the main thread is not.** Rendering keeps up during scroll, but input events
   wait behind engine work. The problem is main-thread occupancy, not paint performance.
2. **The engine renders the whole document.** Every top-level block gets a DOM subtree, and every
   code block runs syntax highlighting while every formula runs typesetting. Chunked mounting spreads
   this work over time but does not reduce it, so the app stayed busy for over a minute after the
   document appeared.
3. **Leaving the editor pays the same cost.** Tearing down tens of thousands of nodes plus those
   caches produces sub-second frames right after the home screen appears.

## Plan

| # | Measure | Expected effect | Status |
|---|---|---|---|
| 1 | Pause background mounting while the reader is interacting; resume once the surface is quiet | Input latency during scroll | Implemented (`_interactionPauseMs` in the scroll page scheduler) |
| 2 | Dispose large editors after the home screen has had a frame; small documents still tear down inline | Sub-second frames when leaving | Implemented (deferred teardown above a document-size threshold) |
| 3 | Run syntax highlighting and math typesetting only for blocks near the viewport, with placeholders elsewhere | Long-running CPU after open | Planned |
| 4 | `content-visibility: auto` plus `contain-intrinsic-size` on block elements, so off-screen blocks skip layout and paint | Scroll smoothness; open cost | **Reverted.** No change in the scroll metric, and it mistook the height of never-rendered blocks for scroll restoration; field reports of lag and visual artifacts while scrolling a selection pointed the same way |
| 5 | Optional lightweight mode for very large documents (real-time highlighting and typesetting off by default, or a prompt on first open) | Fallback for the heaviest files | Planned |
| 6 | Viewport virtualisation: keep DOM only for blocks near the viewport, materialise others on demand | Removes the cost class entirely | Long-term |
| 7 | Move the draft store from `localStorage` to IndexedDB | Large documents stop being bounded by the measured ~5.2 M-character payload ceiling | Planned |

## Verification

Re-measured on the same device with the screen kept awake, comparing against the numbers above:

| Metric | Before | After |
|---|---|---|
| App CPU after open (8/15/25/40/60 s) | 43% → 24% → 23% → 27% → 27% | 43% → 27% → 20% → 20% → 27% |
| Worst frame when leaving the editor | 950 ms | **61 ms** |
| High input latency added by 15 swipes | not comparable (earlier counter was cumulative) | +3 586 |

- **Deferred teardown works.** The frame after the back press no longer waits for the teardown; the
  worst frame fell from 950 ms to 61 ms. The teardown itself still runs, just off the critical path —
  items 3 and 6 would reduce it rather than move it.
- **Pausing during interaction does not move the scroll metric.** The added input latency stays high
  because it is dominated by style and layout of newly appended blocks, which happens on the main
  thread after each chunk regardless of JavaScript pacing. Item 4 targets exactly that cost.
- **Open cost is unchanged**, as expected: neither measure reduces the total work of mounting and
  rendering the document. That is item 3 territory.

Measured again with containment enabled (documents above 600 blocks): the input-latency added by 15
swipes stayed at the same level (+3 928 against +3 586 without it), while jank stayed low (0.31%,
99th percentile 38 ms). Containment spares off-screen blocks, but a fast scroll keeps bringing new
blocks into view, and those still have to be realised — including syntax highlighting and math
typesetting, which is item 3. Containment is kept because it costs nothing measurable and is a
prerequisite for virtualisation later.

Containment was removed again: it bought nothing measurable, and its estimated heights for
never-rendered blocks affected scroll restoration and outline jumps (three resume tests failed until
the rule was gated by document size, which was itself a sign the trade was not worth taking).

## Field report follow-up

Two symptoms reported while using the build that carried the deferred teardown and containment, both
fixed and verified on the device:

1. **Leaving a large document and immediately opening it again felt worse than either step alone.**
   Two problems stacked up here.
   - *Teardown overlapped the next open.* The deferred teardown could still be running when the next
     document started to mount. A parked instance is now detached from the document the moment it is
     parked — it stops costing layout and paint immediately — and destroyed one second after the next
     editor reports ready, with a fallback timer when no further document is opened.
   - *The draft store ran into the storage quota.* Every open of a large file that Android cannot
     write back keeps the content as a local draft, and a 1 MB document is a ~1.5 MB draft. A few of
     them exhaust the origin: the measured ceiling for the draft payload is ~5.2 M characters, and the
     write that overflowed was one an incoming open performs *before* mounting the editor — the
     `QuotaExceededError` aborted the whole open transaction, so the document never opened. The store
     now reports a rejected write instead of throwing, and the open path treats that failure as
     non-fatal.

   Verified on the device with the draft store filled to 94 % of its measured ceiling: the incoming
   open logged the rejection (`local drafts did not fit the storage quota; nothing was written`),
   continued mounting (`Muya init complete` 2.1 s after the intent, against 3.1 s for a cold open),
   left the stored drafts untouched, reported no transaction failure, and put the cause on the home
   screen ("Storage is full: this document has no local draft. Delete old drafts from Home to free
   space."). Drafts are never evicted to make room — each record is the only durable copy of its
   content — so freeing space stays an explicit user action; moving the draft store off `localStorage`
   (plan item 7) removes the ceiling for good.
2. **Scrolling while a text selection is active was very slow and left visual artifacts.** The
   containment rule was the prime suspect (selections force the browser to render skipped subtrees)
   and has been reverted. On the device, the same 12-swipe burst measured with and without an active
   selection is now indistinguishable: 1 101 against 1 098 frames carrying high input latency, 0.18 %
   janky frames and a 9–11 ms 99th percentile in both, with no artifacts in the captured frames. What
   remains is the general cost of blocks entering the viewport, which is plan item 3.

## Re-measuring

```bash
# open, then watch CPU while the document loads
adb shell am force-stop com.inkmark.app
adb shell am start -a android.intent.action.VIEW -d "<content-uri>" -t text/markdown --grant-read-uri-permission -p com.inkmark.app

# scrolling
adb shell dumpsys gfxinfo com.inkmark.app reset
for i in $(seq 1 15); do adb shell input swipe 600 1900 600 600 140; sleep 0.25; done
adb shell dumpsys gfxinfo com.inkmark.app
```

Keep the screen awake (`adb shell svc power stayon true`) and the device unlocked while measuring;
otherwise the system freezes the app and the numbers become meaningless.
