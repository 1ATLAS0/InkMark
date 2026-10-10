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
| 4 | `content-visibility: auto` plus `contain-intrinsic-size` on block elements, so off-screen blocks skip layout and paint | Scroll smoothness; open cost | Planned |
| 5 | Optional lightweight mode for very large documents (real-time highlighting and typesetting off by default, or a prompt on first open) | Fallback for the heaviest files | Planned |
| 6 | Viewport virtualisation: keep DOM only for blocks near the viewport, materialise others on demand | Removes the cost class entirely | Long-term |

Items 1 and 2 are implemented and covered by the existing test suites (721 unit tests). Their effect
still needs a controlled re-measurement: the first attempt was confounded by the screen locking and
the system freezing the application, which also drives CPU readings to zero.

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
