# App icons

Tauri needs platform icons here (`32x32.png`, `128x128.png`, `128x128@2x.png`,
`icon.ico`, `icon.icns`). They are intentionally not committed as binaries.

Generate them from a single source PNG (1024×1024 recommended) once Rust and the
Tauri CLI are installed:

```powershell
npm run tauri icon path\to\source-icon.png
```

This writes all required sizes into this folder. Use original TradeLens
branding — do not reuse Roblox or MM2 artwork.

## Item icons

Per-item artwork lives in `apps/desktop/public/icons/items/` and follows a
canonical filename convention (see `packages/source-adapters/src/assets.ts`):

- Filename is the item id plus an allowed extension: `<item-id>.png` (also
  `.webp` or `.svg`). Ids are already slugs (lower-case, hyphenated).
- Icons should be square, at least 16×16 and at most 512×512, and stay under
  64 KB. Author raster icons at 128×128 (or 2×) so they stay crisp when scaled
  to the 32/64/128 px display sizes.
- Never hotlink external images — bundle the file locally and add a licensing
  record in `packages/source-adapters/src/licenses.ts`.
- Items without an icon fall back to `public/icons/placeholder.svg`, then to a
  category emoji glyph.

Run `npm run assets:validate` to check icons and bundle assets.
