# MM2 TradeLens

An **independent, fan-made trading companion** for Murder Mystery 2 — a
separate always-on-top overlay (like keeping a calculator open beside the game)
that lets you look up item values, compare sources, and check whether a trade is
a win, fair, or a loss.

> MM2 TradeLens is not affiliated with, endorsed by or sponsored by Roblox
> Corporation, Nikilis, Murder Mystery 2, MM2Values or Supreme Values. Item
> values are community estimates and may change.

## Safety boundary

TradeLens is a **companion calculator, not an exploit**. It never:

- injects into or modifies the Roblox client, files, or memory
- intercepts game network traffic or authentication cookies
- automates, accepts, or declines trades
- asks for a Roblox password or claims official affiliation

It is simply an ordinary desktop window (and an optional browser popup) that
displays community value estimates.

## What's in the box

| Area | Path | Status |
| --- | --- | --- |
| Shared data model + validation | [packages/item-schema](packages/item-schema) | ✅ built & type-checked |
| Trading engine (values, fairness, confidence, search, trends) | [packages/trade-engine](packages/trade-engine) | ✅ 16 tests passing |
| Source normalisation + bundled sample data | [packages/source-adapters](packages/source-adapters) | ✅ 6 tests passing |
| Desktop overlay (React + Vite, Tauri shell) | [apps/desktop](apps/desktop) | ✅ builds; Rust shell needs Rust toolchain |
| Browser extension (MV3 popup) | [apps/browser-extension](apps/browser-extension) | ✅ builds via esbuild |
| Values API (normalise / validate / version / serve) | [services/values-api](services/values-api) | ✅ runs, endpoints verified |
| Snapshot updater (signed-style artefact + checksum) | [services/updater](services/updater) | ✅ produces validated snapshot |
| Admin dashboard (static review UI) | [services/admin-dashboard](services/admin-dashboard) | ✅ static server |

## Requirements

- **Node.js 18+** (developed on Node 26)
- **Rust + Tauri CLI** *(only needed to produce the native Windows build)* —
  install from <https://rustup.rs> then `cargo install tauri-cli`

## Quick start

```powershell
npm install

# Run all tests
npm test --workspaces --if-present

# Type-check everything
npm run typecheck --workspaces --if-present
```

### Run the desktop overlay in the browser (no Rust needed)

The frontend detects at runtime whether it is inside the Tauri shell. In a
normal browser it automatically falls back to a `localStorage` storage adapter
(instead of the native SQLite backend) and native window features become
no-ops, so you can preview and manually test the full UI:

```powershell
npm run dev:desktop
# open http://localhost:1420
```

Data saved in this mode lives only in that browser profile; the native app uses
the Rust-managed SQLite database instead.

Search an item, add stacks to *Your offer* / *Their offer*, and the calculator
shows the verdict, demand-adjusted result, confidence, and any warnings.

### Run the native desktop app (needs Rust)

```powershell
# generates icons once, from your own 1024x1024 source art
npm run tauri icon path\to\icon.png --workspace apps/desktop

npm run tauri dev  --workspace apps/desktop   # dev build with hot reload
npm run tauri build --workspace apps/desktop  # NSIS installer (code-signed when a certificate is configured)
```

The global hotkey **Ctrl + Shift + M** brings the overlay forward and toggles
its visibility.

### Run the values API + updater + admin dashboard

```powershell
npm run build --workspace services/values-api
npm run start --workspace services/values-api     # http://localhost:8787

npm run run:sample --workspace services/updater    # writes out/snapshot.json (+ .sha256)

npm run start --workspace services/admin-dashboard  # http://localhost:8080
```

### Build the browser extension

```powershell
npm run build --workspace apps/browser-extension
# then load apps/browser-extension/dist as an unpacked extension in Chrome/Edge
```

## Architecture

```
apps/
  desktop/            Tauri + React overlay (hotkey, tray, always-on-top)
  browser-extension/  MV3 toolbar popup, reuses the trade-engine
packages/
  item-schema/        canonical Item/Snapshot types + zod validation
  trade-engine/       resolveValue, evaluateTrade, search, trends
  source-adapters/    normalise sources -> one schema, bundled sample data
services/
  values-api/         serves a validated, versioned snapshot (+ checksum)
  updater/            builds the signed-style snapshot the app caches offline
  admin-dashboard/    static review UI over the values-api
```

The desktop app downloads a JSON value snapshot and keeps the latest valid copy
offline. When the client is built with a trusted public key the snapshot is
cryptographically verified before use; otherwise it is treated as an unverified
feed. When data is stale or unavailable the app says so plainly rather than
showing silent guesses.

## Design notes

- **Sources are never silently averaged.** When Supreme and MM2Values disagree,
  the UI shows both figures, the spread, and a confidence level. The "fair"
  band widens automatically when sources disagree or an item is unstable.
- **Guidance, not guarantees.** Verdicts (Big Win / Win / Fair / Loss / Big Loss)
  are framed as gentle guidance, with a separate demand-adjusted result and
  clear warnings for duplicates, collectibles, and stale data.
- **Local-first & private.** Favorites, history and settings live on your
  device via `localStorage`; a one-click action deletes all local data.

## Data

The app ships a bundled `mm2valuesSnapshot`, generated from a licensed
MM2Values CSV export by
[`packages/source-adapters/scripts/generate-mm2values.mjs`](packages/source-adapters/scripts/generate-mm2values.mjs).
Regenerate it after refreshing the export with `npm run generate:mm2values -w
@tradelens/source-adapters`. Deployments can still replace it at runtime with a
signed feed from an approved source (permission/API/partnership preferred over
scraping). A separate `sampleSnapshot` of **illustrative placeholder values**
remains for tests and offline demos.

### Importing Supreme values

You can refresh **Supreme Values** figures from a capture you took in your own
browser session — TradeLens never scrapes Supreme for you. Open **Settings →
Import Supreme values** and either:

- **Drag & drop** a saved Supreme page (`.html`), a copied table (`.txt`), or a
  JSON export (`.json`) onto the drop zone, or
- **Choose a file** with the picker, or
- **Paste** the copied text directly and click *Import*.

Only items already in your catalogue are updated — the importer reports how many
values changed and how many rows were unmatched, and it **never invents items**.
This keeps the import aligned with Supreme's terms: it processes data you
already have access to, in one click, on your own device.

### Price history & value alerts

Every time TradeLens adopts a newer snapshot — from a sync, a Supreme import, or
a bundled update — it records each item's per-source value as a point in a local
time series. Open any item to see its **Price history** chart (low / high /
latest), and enable notifications in **Settings** to get gentle alerts when a
favourite moves beyond your chosen threshold. History stays entirely on your
device.

## Install (Windows)


- **Per-user install.** The installer runs without administrator rights and
  installs for the current user only (no system-wide changes). Choose a
  per-machine build only if you specifically need one.
- **Supported:** Windows 10 (1809+) and Windows 11, 64-bit (x64). A WebView2
  runtime is required and is present by default on current Windows.
- **SmartScreen.** Until the signing certificate builds reputation, Windows may
  show a "Windows protected your PC" prompt on first run — choose *More info →
  Run anyway*. Verify the download against the published checksum first.
- **Updating / uninstalling.** Installing a newer version over an older one
  keeps your data. Uninstalling removes the app but **leaves your local
  database** (favorites, history, settings) in place unless you delete it
  yourself; you can also wipe everything from **Settings → Delete all local
  data**.

## Verifying a release

Each release publishes `SHA256SUMS.txt` plus an Ed25519 detached signature
(`SHA256SUMS.txt.sig.json`). To verify an installer:

```powershell
# 1. Confirm the installer hash matches the manifest
Get-FileHash .\MM2-TradeLens_x64-setup.exe -Algorithm SHA256

# 2. (Optional) Verify the manifest signature with the release public key
```

Value snapshots are **only** treated as signed when the client is built with a
trusted public key (`VITE_SNAPSHOT_PUBLIC_KEY`); otherwise the app runs offline
from cached/bundled data and shows an *Unverified feed* / *Offline* status in
Settings rather than claiming verified updates.

## Privacy

TradeLens is local-first. Favorites, trade history, settings and the value
database live only on your device. The app makes outbound network requests only
to check for a newer value snapshot (and only when online and not in Offline
mode). It sends no personal data, no telemetry, and never touches Roblox
accounts, cookies, or the game client. Diagnostics you export are written to a
file on your device and shared only if you choose to.

## Known limitations

- Item values are **community estimates**, may be incomplete, lag the market, or
  differ between sources — they are advisory, not guaranteed prices.
- The bundled catalogue is **not guaranteed to be complete**; new or renamed
  items may be missing until the data is refreshed.
- OCR scanning is best-effort and depends on screenshot quality.
- Windows x64 only at this time.

## Attribution & third-party notices

Item values are sourced from community projects (MM2Values, Supreme Values) used
for reference under their respective terms; TradeLens is not affiliated with
them. Item images, where shown, remain the property of their respective owners
and are used for identification only. Open-source dependency licences and any
required image attribution are listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), which is also bundled with the
installer.

## License

MIT — see [LICENSE](LICENSE).
