# Changelog

All notable changes to Recall are documented here.

---

## [Unreleased]

### Changed
- **Conversations moved from `chrome.storage.local` to IndexedDB** (`src/shared/idb.ts`)
  - Conversation bodies (`conv:{id}`) now live in the `conversations` object store in IndexedDB (DB version 2)
  - `chrome.storage.local` now only holds the index, meta, and settings — all small, appropriate data
  - `popup/popup.ts` and `popup/export.ts` read conversations via `getConversations()` from IDB
  - `src/background.ts` writes/reads/deletes conversations via IDB

### Added
- **One-time migration** (`migrateConversationsFromStorage` in `src/shared/idb.ts`)
  - Automatically moves any existing `conv:{id}` entries from `chrome.storage.local` to IndexedDB on extension install or browser startup
  - Idempotent — safe to call multiple times, no-ops once migration is complete

- **Storage usage meter** in Settings popup
  - Shows bytes used vs. quota with a progress bar
  - Turns amber at 70%, red at 90%

### Cleanup task — migration code removal
> **Agent note:** The migration code exists to handle users upgrading from v0.3.x (where conversations lived in `chrome.storage.local`) to the IDB-based storage introduced in the Unreleased version above.
>
> **When to remove it:** 60 days after the IDB-based version ships to the Chrome Web Store. By then, Chrome auto-update will have migrated essentially all active users.
>
> **What to delete:**
> 1. `migrateConversationsFromStorage` function in `src/shared/idb.ts`
> 2. Its export from `popup/idb.ts`
> 3. The two `void migrateConversationsFromStorage()` calls in `src/background.ts` (in `onInstalled` and `onStartup` listeners)
>
> **Before deleting:** verify no `conv:` keys remain in chrome.storage across your test devices. In DevTools → Application → Storage → Local Storage for the extension origin, confirm no `conv:` keys exist.

---

## [0.3.0] — 2026-03-18

### Added
- Gemini integration
  - Conversation ID from `/app/{id}` URL pattern
  - Title read from `[aria-current="true"] .conversation-title` (sidebar active item)
  - User selector: `.query-text` / assistant: `model-response`
  - Streaming indicator: `[aria-label='Stop response']`
  - Text child selector `.query-text-line` to skip Gemini's "You said" accessibility label

---

## [0.2.0] — 2026-03-17

### Added
- ChatGPT integration
  - Conversation ID from `/c/{id}` URL pattern
  - Selectors: `[data-message-author-role]` with `.whitespace-pre-wrap` text child
  - Streaming indicator: `[data-testid='stop-button']`
- Capture settings — choose User / Assistant roles (default: User only)
  - Filter applied at content script level and enforced in background SW

### Fixed
- Platform label "ChatGPT" now renders correctly (was "Chatgpt")

---

## [0.1.0] — 2026-03-17

### Added
- MVP — captures user messages from Claude.ai
- MutationObserver with 600ms debounce, streaming-aware
- SPA navigation via `history.pushState` monkey-patch
- Storage: `chrome.storage.local` for index/meta/settings, IndexedDB for `FileSystemDirectoryHandle`
- JSONL export via File System Access API, incremental cursor
- Auto-export via `chrome.alarms` at 23:59 daily (opt-in)
- Popups: main view, export, settings, about
