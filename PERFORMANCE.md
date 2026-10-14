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
| Window open, mount and render (desktop) | `tools/perf-baseline.mjs` drives the packaged Windows build over CDP with the fixtures in `perf/` |

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
2. **The engine rendered the whole document.** Every top-level block got a DOM subtree (a 1 MB
   fixture measured 472 309 elements), and chunked mounting spread that work over time without
   reducing it, so the app stayed busy for about a minute after the document appeared. An
   instrumented run later split the JS side: 2 839 KaTeX renders cost 283 ms in total and Prism
   highlighting stayed in the same low range, which leaves DOM construction, style, layout and GC as
   the cost. The plan item that only deferred highlighting and typesetting is therefore not the
   lever it looked like, and the mount itself is (below).
3. **Leaving the editor pays the same cost.** Tearing down tens of thousands of nodes plus those
   caches produces sub-second frames right after the home screen appears.

## Plan

| # | Measure | Expected effect | Status |
|---|---|---|---|
| 1 | Pause background mounting while the reader is interacting; resume once the surface is quiet | Input latency during scroll | Implemented (`_interactionPauseMs` in the scroll page scheduler) |
| 2 | Dispose large editors after the home screen has had a frame; small documents still tear down inline | Sub-second frames when leaving | Implemented (deferred teardown above a document-size threshold) |
| 3 | Run syntax highlighting and math typesetting only for blocks near the viewport, with placeholders elsewhere | Long-running CPU after open | **Measured and dropped.** An instrumented 1 MB open put KaTeX at 283 ms of 36 s (roughly 1 %) and Prism below that, so deferring them alone would not be felt |
| 4 | `content-visibility: auto` plus `contain-intrinsic-size` on block elements, so off-screen blocks skip layout and paint | Scroll smoothness; open cost | **Reverted.** No change in the scroll metric, and it mistook the height of never-rendered blocks for scroll restoration; field reports of lag and visual artifacts while scrolling a selection pointed the same way |
| 5 | Optional lightweight mode for very large documents (real-time highlighting and typesetting off by default, or a prompt on first open) | Fallback for the heaviest files | Planned |
| 6 | Mount only what the viewport reaches, materialise the rest on demand | Removes the cost class entirely | **Partially shipped.** The mount target follows the viewport plus a three-viewport read-ahead, refreshed from a capture-phase scroll listener; a 400-section document now opens with ~190 blocks instead of 1 601, and the outline jump (or scrolling) materialises the rest. The search opts back into the whole-document background fill, because it walks block text. The same scheme now backs the **desktop** engine (2026-10-14): a 1 MB document settles in ~7 s instead of 41 s with only the viewport prefix mounted; outline jumps mount through the target heading first. Unloading blocks the reader has passed would need exact heights for arbitrary selections and reading-position restore — still long-term |
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

## Desktop baseline (Windows)

Measured on 2026-10-14 by driving the packaged Windows build (Electron 42, Windows 10.0.26300) with
`node tools/perf-baseline.mjs` over CDP; fixtures are the `perf/` samples, whose structure matches
the Android test document (headings, paragraphs, tables, fenced code, inline math). "Window" is the
time until the renderer answers CDP; "first response" until a trivial evaluate returns; "content
stable" until the body text length stops changing across three 400 ms samples.

**Before the port** — the desktop engine mounted every block at open:

| Fixture | Window | First response | Content stable | Notes |
|---|---|---|---|---|
| 1 MB | 874 ms | 988 ms | 40.9 s | 766 K characters rendered |
| 2 MB | — | — | — | first blocks only appear at 92.3 s; 29 062 blocks eventually mount |
| 3 MB | — | — | — | editor never mounts (120 s observation) |
| 5 MB | 745 ms | 865 ms | — | editor never mounts (93 s observation) |
| 10 MB | 772 ms | 888 ms | — | editor never mounts (109 s observation) |
| GBK sample | 822 ms | 925 ms | 3.0 s | content correct |
| CRLF sample | 1 180 ms | 1 309 ms | 3.5 s | content correct |

1. **A 1 MB document cost about 41 s of rendering work on the desktop**, and 2 MB only started
   showing blocks after 92 s, while the window answered within a second. This was the mount cost of
   plan item 6, which had shipped in the Android engine only.
2. **Documents of 3 MB and above did not open.** The markdown-to-state conversion overflows the
   JavaScript call stack — `RangeError: Maximum call stack size exceeded`, top frame `lexBlock`,
   caller `MarkdownToState._convertMarkdownT…` (captured from the renderer console on the 5 MB
   fixture) — the open aborts and the editor pane stays empty (`.mu-container` absent when probed at
   90 s, body text limited to window chrome plus the word count). This is a parser limit separate
   from the mount cost above, and it is unchanged by the port.

**After viewport-bounded mounting** (plan item 6 ported to the desktop engine, same fixtures and
method):

| Fixture | First blocks in the DOM | Content stable | Notes |
|---|---|---|---|
| 1 MB | 6.3 s | 7.2 s | 9 557 characters mounted (the viewport prefix) instead of 766 K |
| 2 MB | 13.2 s | 15.2 s | 2 726 blocks mounted |
| 3 MB | 34.1 s | 36.2 s | mounts now; used to never mount |
| 5 MB / 10 MB | — | — | unchanged: the parser's `RangeError` still aborts the open |
| GBK sample | — | 3.2 s | content correct |
| CRLF sample | — | 3.1 s | content correct |

The remaining open cost is the markdown parse (`markdownToState`), which runs before the first block
appears: about 5–6 s for 1 MB, 12 s for 2 MB and 33 s for 3 MB on this machine. The port removed the
mount cost class, not the parse — the parse is the next lever if near-instant opening matters.

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

```bash
# desktop: window / first response / content stable for every fixture in perf/
node tools/perf-baseline.mjs --app <build>/win-unpacked/inkmark.exe
```

`perf-baseline.mjs` connects to port 9333; remove any `adb forward tcp:9333` left over from device
work first, or the measurements land on the phone's WebView.
