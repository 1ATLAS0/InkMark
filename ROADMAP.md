# Roadmap

Releases are published from this repository. Version numbers follow the base editor generation:
`0.<minor>.<revision>`, where the minor tracks the upstream editor line (0.20 at present) and the
revision counts InkMark changes. Release tags are `v`-prefixed and start the release workflow.

Items below are intentions rather than commitments; priorities shift as upstream changes land and as
testing turns up problems.

## 0.20.x — daily usable

Shipped:

- Desktop and Android builds produced from a single tag, with installers, checksums and an update
  feed (`latest.yml`) attached to each release
- Branding handled by a scripted layer, so name, identifiers, icons and default theme colour can be
  replayed after an upstream merge
- Test baseline recorded: 946 unit tests pass, and the Playwright suite runs on Windows. Upstream
  runs that suite on Linux only, so a few Windows assumptions had to be corrected.
- **Large documents — viewport-bounded mounting (0.20.5).** Both engines now mount the viewport plus
  a three-viewport read-ahead instead of the whole document; opening a 1 MB document on Windows
  settles in about 7 seconds against 41 seconds before (first blocks at 6.3 s), and leaving the
  editor no longer pays a whole-document teardown. The Android side uses the same scheme. Search
  opts back into a whole-document background fill, and outline jumps mount through the target block.
  Measurements and before/after tables live in [PERFORMANCE.md](PERFORMANCE.md) and
  [PERFORMANCE.zh-CN.md](PERFORMANCE.zh-CN.md).
- **Android screen transitions and text handles (0.20.5).** Document opening and closing animate as
  a native push/pop, reduced-motion is respected, and the native selection handles are replaced by
  app-drawn ones.

Open:

- **Markdown parsing at scale.** With mounting bounded, the parse (`markdownToState`) dominates the
  remaining open cost: about 5–6 s for 1 MB, 12 s for 2 MB and 33 s for 3 MB on the reference
  machine. Incremental or streaming parsing is the next lever.
- **Documents above about 3 MB.** The parser overflows the JavaScript call stack
  (`RangeError: Maximum call stack size exceeded` at `lexBlock`) between 2 and 3 MB for the `perf/`
  fixture structure; 5 MB and 10 MB do not open at all.
- **Signed Android releases.** Until keystore secrets are configured, the release workflow attaches
  a debug-signed APK.
- **Update round trip.** Installing an older build and confirming that it detects and applies a newer
  release has not been tested end to end.
- **Input methods.** Chinese composition through the system IME was checked on one Android device
  (vivo, Android 16): text commits correctly, no input-connection errors in the logs. Windows IMEs
  and other Android keyboards remain untested.
- **Android markers and large documents — resolved (0.20.4).** Syntax markers (`#`, `**`) stayed visible on
  Android WebViews because they were hidden with `font-size: 0` only, which WebView font clamping can override;
  a 1 MB document therefore read as raw Markdown. Hiding now also sets `visibility: hidden`. Verified on a vivo
  device: a 1 MB document renders completely, including the tail and inline math.
- **Encoding.** GB18030/GBK detection and CRLF handling need a test pass with real files.

## 0.21 — editing and export

- Export matrix: docx, odt, epub, LaTeX and OPML through Pandoc, with PDF layout options for margins,
  headers, footers and page breaks
- Image workflows: relative `assets` directory policy, uPic and custom command uploaders, retry and
  rollback when an upload fails
- Markdown extensions: highlight, superscript and subscript, definition lists
- Chinese typography: spacing between CJK and Latin text, punctuation conversion
- Table editing: column resizing, row and column operations, alignment
- Search: regular expressions, case and whole-word options, search across files
- Themes: import and export of custom CSS

## 0.22 — platform coverage

- Linux packages: AppImage, deb and rpm for x64 and arm64, verified on Kylin V10 with Phytium CPUs
- Windows arm64 and macOS builds
- CI matrix covering all target platforms

## Known issues

| Problem | Impact | Status |
|---|---|---|
| Large documents open slowly | 1 MB about 35 s, 2 MB about 63 s | Quadratic cost removed; DOM and layout work remains |
| Android release APK is debug-signed | Launcher shows the debug label | Waiting on keystore secrets |
| macOS and Linux builds missing | Two platforms unsupported | Planned for 0.22 |
| Input methods and file encodings untested | Possible composition or decoding bugs | Test pass pending |

## Release process

1. Update versions in `desktop/package.json`, `desktop/packages/desktop/package.json`,
   `android/android/app/build.gradle` (`versionName` and `versionCode`) and
   `android/src/lib/appInfo.ts`.
2. Run `node tools/rebrand.mjs --dry-run`; it should report no changes.
3. Optionally build locally with `tools\build-desktop.cmd` and `tools\build-android.cmd`.
4. Create and push the tag: `git tag -a v<version> -m "<summary>"`. The release workflow builds both
   platforms, creates the release, and writes the run result to the `ci-status` branch.
5. Check the release: installer, portable ZIP, APK, `latest.yml` and `SHA256SUMS.txt` should all be
   attached.

## Testing

- Unit tests, from `desktop/`: `npx pnpm@10 --filter inkmark test:unit`
- End-to-end: `npx pnpm@10 --filter inkmark test:e2e`. Playwright drives the local Electron build and
  needs no browser download.
- Performance and encoding: `node tools/perf-baseline.mjs`, which writes `perf/baseline.json`.
  Fixtures are generated by `tools/make-perf-fixtures.py`.
- CI results without repository access: fetch the `ci-status` branch and read `.ci/status.json`.

## Maintenance notes

- The branding layer is scripted. After an upstream merge, re-run `tools/rebrand.mjs` and
  `tools/make_brand_assets.py` rather than resolving those conflicts by hand.
- Functional changes are kept in as few upstream files as possible to keep upstream merges
  manageable.
- Releases are cut from `main`. The `ci-status` branch is written by CI and should not be edited
  manually.
