# Milestones

## v0.1.0 — MVP (2026-03-17)

Commit: `687596e`

First working end-to-end version of Recall. Captures user messages from Claude.ai and stores them locally as a portable memory layer.

### What's in it

**Capture**
- MV3 content script on claude.ai using MutationObserver
- Streaming-aware: 600ms debounce, skips capture mid-stream
- SPA navigation handled via `history.pushState` monkey-patch
- Selectors bundled at build time (claude.ai CSP blocks runtime fetch of `selectors.json`)

**Storage**
- `chrome.storage.local`: conversations, index, meta, settings
- IndexedDB: `FileSystemDirectoryHandle` (not JSON-serializable)
- Dedup by role+content, session stitching by URL
- Rolling eviction at 100 conversations
- Each message stamped with UUID, `seq`, and `capturedAt`

**Export**
- JSONL per platform/role: `{platform}/{platform}_{role}_{timestamp}.jsonl`
- Incremental cursor (`meta.lastExportedAt`) — only new messages each run
- File System Access API with persisted folder handle
- Auto export via `chrome.alarms` at 11:59 PM daily (opt-in)

**UI**
- Main popup: conversations grouped by platform, collapsible, sorted by `updatedAt`
- Export popup: reads settings, validates folder config, shows warnings
- Settings popup: Display (max convos per platform) + Export (folder path, auto export toggle)
- About popup

### What's not yet done
- ChatGPT and Gemini selectors (stubs only)
- S3 export (UI placeholder, not implemented)
- Query/retrieval layer above the exported JSONL
- Assistant message capture (user messages only for now)

---

## v0.2.0 — ChatGPT integration + capture settings (2026-03-17)

### What's in it

**ChatGPT capture**
- Content script with conversation ID from `/c/{id}` URL pattern, title strips "ChatGPT" suffix
- Selectors: `[data-message-author-role='user']` / `[data-message-author-role='assistant']`
- Streaming indicator: `[data-testid='stop-button']`
- Text child selector (`.whitespace-pre-wrap`) to avoid capturing button labels
- Verified end-to-end: capture and JSONL export confirmed working

**Capture settings**
- New "Capture" section in Settings popup: multi-select checkboxes for User / Assistant roles
- Default: User only
- Validation: at least one role must be selected
- Filter applied at content script init (reads settings once, gates `sendMessage`) and in background SW (authoritative safety net)
- `CaptureSettings` type added to `AppSettings`; deep merge preserves stored value across extension updates

**Popup**
- Platform label map: "ChatGPT" renders correctly (was "Chatgpt")
- `PlatformSelectors.textContent` optional field for narrowing text extraction per platform

### What's not yet done
- Gemini selectors (stub only)
- S3 export (UI placeholder, not implemented)
- Query/retrieval layer above the exported JSONL

---

## v0.3.0 — Gemini integration (2026-03-18)

### What's in it

**Gemini capture**
- Content script with conversation ID from `/app/{id}` URL pattern
- Title read from `[aria-current="true"] .conversation-title` (sidebar active item) — `document.title` is always "Google Gemini" and unusable
- User message selector: `.query-text`; assistant selector: `model-response`
- Streaming indicator: `[aria-label='Stop response']`
- Text child selector: `.query-text-line` to skip the visually-hidden "You said" accessibility label injected by Gemini
- Additional strip of "You said" prefix in content script as a defensive fallback

### What's not yet done
- S3 export (UI placeholder, not implemented)
- Query/retrieval layer above the exported JSONL

---

## v0.4.0 — Favorites, side panel, and inline star buttons (2026-03-29)

### What's in it

**Favorites**
- Star buttons (`☆`/`★`) injected into every captured message on the page via `src/injector.ts`
- User messages: star appears below the bubble (right-aligned); assistant messages: star appears inline in the platform action bar when `selectors.actionBar` is set, otherwise below the bubble (left-aligned)
- Gemini star placed inline inside `.buttons-container-v2` (Angular DOM is stable); Claude and ChatGPT use below-bubble fallback (React re-renders remove injected nodes)
- Injection skipped while streaming indicator is visible (incomplete responses)
- Initial `★`/`☆` state hydrated from IDB on conversation load via `GET_FAVORITES` message
- Content extracted at click time (not injection time) so the string always matches IDB exactly, even after action buttons render inside the container post-stream
- `extractContent` clones the element and strips `.recall-star-wrap`/`[data-recall-btn]` nodes before text extraction to prevent star characters contaminating the content string
- `handleToggleFavorite` creates a stub `StoredMessage` in IDB when the message isn't found by content match, so favorites always persist regardless of capture timing or content drift

**Favorites tab in side panel**
- Gold `★ Favorites` tab in the panel filter bar (right-aligned, always gold)
- Flat list of all favorited messages across platforms, sorted newest-first
- Click a favorite to open a detail view; unstarring navigates back to the list

**Auto-refresh panel on page star toggle**
- After a star click, injector broadcasts `FAVORITES_UPDATED` to all extension pages
- Panel `onMessage` listener reloads favorites + re-renders immediately — no manual navigation needed
- Manual `⟳` refresh button in the filter bar as a fallback

**Side panel conversation browser** (v0.3.x addition, now complete)
- Full conversation thread view with per-message star buttons
- Platform filter tabs: All / Claude / ChatGPT / Gemini / ★ Favorites
- Settings and Export panels always render even if IDB/storage load fails

**New message types**
- `TOGGLE_FAVORITE` — content script → background, toggles favorite by exact content match
- `GET_FAVORITES` — content script → background, returns favorited content strings for a conversation
- `FAVORITES_UPDATED` — content script → panel broadcast after any toggle

### What's not yet done
- S3 export (UI placeholder, not implemented)
- Query/retrieval layer above the exported JSONL
- Inline action bar star for Claude and ChatGPT (React re-renders remove injected nodes)
