# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Recall is a MV3 Chrome extension that captures user messages from Claude, ChatGPT, and Gemini as a portable memory layer for future context retrieval across platforms.

See `MILESTONES.md` for a full record of what has been built and what remains.

## Commands
```bash
npm run build       # compile TS via esbuild
npm run watch       # rebuild on change
npm run typecheck   # tsc --noEmit
npm run package     # build + zip for Chrome Web Store submission → recall-v{version}.zip
```
Load unpacked from the project root (not `dist/`) in chrome://extensions → Developer mode.

## Releasing a new version
1. Bump `version` in both `manifest.json` and `package.json`
2. Update `MILESTONES.md` with what changed
3. Run `npm run package` → produces `recall-v{version}.zip`
4. Upload the zip to the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole)
5. Commit and push, then `git tag v{version}`

## Architecture

**Content scripts** (`src/content_{platform}.ts`) — one per platform, import bundled selectors, call `createExtractor`, send `CAPTURE_MESSAGE` to background.

**Extractor** (`src/extractor.ts`) — shared MutationObserver logic, 600ms debounce, streaming detection, SPA nav via `history.pushState` monkey-patch, fingerprint-based dedup.

**Background SW** (`src/background.ts`) — serial queue for storage writes, dedup, session stitching, rolling 100-conv eviction, `chrome.alarms` for daily auto-export at 23:59.

**Shared** (`src/shared/`) — `types.ts` (all interfaces), `settings.ts` (getSettings/saveSettings/validateSettings), `idb.ts` (FileSystemDirectoryHandle persistence).

**Popups** (`popup/`) — four separate windows opened via `chrome.windows.create`:
- `popup.html` — main view, conversations grouped by platform sorted by `updatedAt`
- `export.html` — validates settings, writes JSONL via File System Access API
- `settings.html` — Display (max convos) + Export (folder, auto-export toggle)
- `about.html` — product info

## Key design decisions
- Selectors bundled at build time (claude.ai CSP blocks `fetch(chrome.runtime.getURL(...))` from content scripts)
- `FileSystemDirectoryHandle` stored in IndexedDB (not JSON-serializable, can't go in `chrome.storage`)
- Folder name mirrored into `chrome.storage` settings so export popup can display it without IndexedDB round-trip
- Background SW can use the stored handle for auto-export if permission was previously granted — no user gesture needed in extension context
- Messages only captured after streaming completes (no streaming indicator on Claude currently — relies on debounce)

## Storage layout
```
chrome.storage.local:
  "conversations"   → ConversationsIndex { ids: string[] }
  "conv:{id}"       → Conversation
  "meta"            → Meta { lastExportedAt, lastUpdated, version }
  "settings"        → AppSettings

IndexedDB (db: "recall"):
  "handles" store, key "exportDir" → FileSystemDirectoryHandle
```

## Known fragile areas
- DOM selectors break on platform redeploys — always check `selectors.json` first
- Gemini title read from `[aria-current="true"] .conversation-title` — breaks if sidebar markup changes
- Auto-export silently skips if folder permission has expired — user must open export popup to re-authorize
