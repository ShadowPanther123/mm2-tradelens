# Third-Party Notices

MM2 TradeLens bundles the third-party assets and software listed below. Each is
redistributed under its own licence; the original licence text and copyright
notices are retained where required. TradeLens is an independent, fan-made
project and is not affiliated with, endorsed by, or connected to Roblox
Corporation or the creators of Murder Mystery 2.

## Bundled runtime assets

### Tesseract.js (WebAssembly OCR engine)

- Files: `apps/desktop/public/tesseract/tesseract-core.wasm.js`,
  `apps/desktop/public/tesseract/tesseract-core-simd.wasm.js`,
  `apps/desktop/public/tesseract/worker.min.js`
- Package: `tesseract.js` (see `apps/desktop/package.json`)
- Upstream: https://github.com/naptha/tesseract.js
- Licence: Apache License 2.0

### Tesseract trained data (English language model)

- Files: `apps/desktop/public/tessdata/eng.traineddata.gz`
- Upstream: https://github.com/tesseract-ocr/tessdata
- Licence: Apache License 2.0

## Application icons and item artwork

- Application icons under `apps/desktop/src-tauri/icons/` and the shared
  item-icon placeholder `apps/desktop/public/icons/placeholder.svg` are original
  artwork authored for TradeLens and released under CC0-1.0. They do not reuse
  Roblox or Murder Mystery 2 artwork.
- Category fallback glyphs are Unicode emoji rendered by the operating system's
  font stack; no emoji artwork is bundled.
- Per-item image assets, if added, must have a licensing record in
  `packages/source-adapters/src/licenses.ts` before being shipped.

## Fonts

The user interface uses the operating system's font stack (e.g. Segoe UI on
Windows). No font files are bundled or redistributed.

---

Apache-2.0 licence text: https://www.apache.org/licenses/LICENSE-2.0
