# Handoff — 2026-03-29

## What was built this session

### 1. Settings / Export panel rendering fix (`popup/panel.ts`)

**Problem:** `initExportView()` and `initSettingsView()` were only called if `Promise.all([loadFavorites(), loadConversations()])` succeeded. Any IDB or storage error silently skipped both inits, leaving panels blank.

**Fix:** Wrapped the `Promise.all` in try/catch so both inits always run regardless of data-load failure. Added `.catch()` guards on both init calls.

```typescript
try {
  await Promise.all([loadFavorites(), loadConversations()]);
} catch (err) {
  console.error('[recall] failed to load conversations/favorites:', err);
}
renderConvList();
void initExportView().catch((e) => console.error('[recall] export init failed:', e));
void initSettingsView().catch((e) => console.error('[recall] settings init failed:', e));
```

---

### 2. Favorites tab styling (`popup/panel.html`)

- Tab is gold/yellow by default (not just on hover/active)
- Pushed to far right with `margin-left:auto`
- Label changed to "★ Favorites"

```css
.filter-tab[data-platform="favorites"] { color: #f5a623; }
.filter-tab[data-platform="favorites"]:hover { color: #f5a623; }
.filter-tab[data-platform="favorites"].active { background: #111; color: #f5a623; }
```

```html
<button class="filter-tab" data-platform="favorites" style="margin-left:auto">★ Favorites</button>
```

---

### 3. DOM-injected star buttons — `src/injector.ts` (new file)

Injects `☆`/`★` star buttons into every captured message on the page so users can favorite from the chat page itself, not only from the Recall panel.

**Behavior:**
- User messages: star appears in a div below the bubble, right-aligned
- Assistant messages: star appends into `selectors.actionBar` if defined; otherwise falls back to a div below the bubble, left-aligned
- Injection skipped while streaming indicator is visible (incomplete response)
- Per-conversation favorites loaded from IDB on first injection — initial `★`/`☆` state is correct after page refresh

**Critical design — content extracted at click time, not injection time:**

The injector fires at 300 ms debounce; the extractor fires at 600 ms debounce after the last mutation. For assistant messages, action buttons (Copy, Like, Dislike) can appear inside the message container between those two windows. If content were extracted at injection time, `el.textContent` would include button labels and differ from what was stored in IDB — making the lookup fail.

By storing a reference to the live DOM element and re-extracting at click time, the DOM is fully settled (streaming done, all action buttons rendered) so the extracted string matches IDB exactly.

```typescript
btn.addEventListener('click', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  // Re-extract from the live element at click time — DOM is fully settled here
  const content = extractContent(el, selectors, role, transformContent);
  if (!content) return;
  const payload: ToggleFavoritePayload = { type: 'TOGGLE_FAVORITE', platform, conversationId, role, content };
  const res = await chrome.runtime.sendMessage(payload) as { favorited: boolean } | undefined;
  ...
});
```

---

### 4. New message types — `src/shared/types.ts`

```typescript
// Sent when user clicks a star button injected into the page
export interface ToggleFavoritePayload {
  type: 'TOGGLE_FAVORITE';
  platform: Platform;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string; // matched against IDB by exact content string
}

// Sent on conversation load to hydrate initial star state
export interface GetFavoritesPayload {
  type: 'GET_FAVORITES';
  conversationId: string;
}

export type ExtensionMessage = CaptureMessagePayload | ToggleFavoritePayload | GetFavoritesPayload;
```

Also added `actionBar?: string` to `PlatformSelectors`.

---

### 5. Background handlers — `src/background.ts`

Two new async handlers, both using `return true` to keep the message channel open:

```typescript
async function handleToggleFavorite(payload): Promise<{ favorited: boolean }> {
  const messages = await getMessagesByConversation(conversationId);
  const msg = messages.find((m) => m.role === role && m.content === content);
  if (!msg) return { favorited: false };
  const nowFavorited = !msg.favorite;
  await setMessageFavorite(msg.id, nowFavorited);
  return { favorited: nowFavorited };
}

async function handleGetFavorites(payload): Promise<{ contents: string[] }> {
  const messages = await getMessagesByConversation(payload.conversationId);
  return { contents: messages.filter((m) => m.favorite === true).map((m) => m.content) };
}
```

---

### 6. Content scripts wired up

All three content scripts now import and call `injectFavoriteButtons`. Gemini passes a `transformContent` function to strip the visually-hidden "You said" prefix from user messages before content matching — mirroring the same strip the extractor does before storing.

```typescript
// content_gemini.ts
injectFavoriteButtons('gemini', allSelectors.gemini, getConversationId,
  (role, content) => role === 'user' ? content.replace(/^\s*You said\s+/i, '').trim() : content,
);
```

---

### 7. `selectors.json` — `actionBar` field added

All three platforms have `"actionBar": ""` (empty). Empty string means the fallback (below-message div) is used. Needs real selectors to get inline placement next to Copy/Like/Dislike.

---

## Session 2 fixes (2026-03-29)

### 1. `extractContent` — strip recall buttons before text extraction (`src/injector.ts`)

**Problem:** For platforms where `selectors.textContent` doesn't match inside the assistant container (e.g. Gemini's `.query-text-line` inside `model-response`), extraction falls back to `el.textContent`. At click time the star button had already been appended inside `el`, so the content string included `☆`/`★` and didn't match what the extractor stored in IDB.

**Fix:** `extractContent` now clones the element and strips `.recall-star-wrap` / `[data-recall-btn]` nodes before extracting, making click-time content always match IDB.

### 2. `handleToggleFavorite` — create stub if message not in IDB (`src/background.ts`)

**Problem:** If the extractor hadn't yet captured a message (timing, shadow DOM, content mismatch), `handleToggleFavorite` returned `{ favorited: false }` and the star stayed blank.

**Fix:** When the message isn't found by content match, a stub `StoredMessage` is created on the spot with `favorite = true`. The star always turns gold; subsequent page reloads correctly show it starred via `GET_FAVORITES`.

### 3. Claude `assistantMessage` selector (`selectors.json`)

**Problem:** `assistantMessage` was empty for Claude, so no star buttons were injected on claude.ai.

**Fix:** Set to `.font-claude-response` — confirmed from DevTools inspection of a live Claude response. No `textContent` sub-selector needed (falls back to full `el.textContent`; stub approach handles any content drift).

---

## Session 3 additions (2026-03-29)

### 1. Auto-refresh panel on page star toggle (`src/injector.ts`, `popup/panel.ts`, `src/shared/types.ts`)

**Problem:** Favoriting a message on the page (via injected star button) had no effect on the Recall side panel until the user manually navigated away and back.

**Fix:** After a successful toggle in the injector click handler, broadcast `{ type: 'FAVORITES_UPDATED' }` to all extension pages:

```typescript
void chrome.runtime.sendMessage({ type: 'FAVORITES_UPDATED' }).catch(() => { /* panel not open */ });
```

The panel's `chrome.runtime.onMessage` listener handles this by reloading favorites from IDB and re-rendering:

```typescript
if (type === 'FAVORITES_UPDATED') {
  void loadFavorites().then(() => renderConvList());
}
```

Added `FavoritesUpdatedPayload` to `src/shared/types.ts` and included it in `ExtensionMessage`.

### 2. Refresh button in panel (`popup/panel.html`, `popup/panel.ts`)

Added a `⟳` button at the right end of the `.conv-filters` bar (after the Favorites tab). Clicking it calls `loadConversations() + loadFavorites()` then re-renders the list — useful as a manual fallback if the auto-refresh ever misses an update.

---

## Current state

- Build is clean (`npm run typecheck && npm run build` both pass)
- Extension loads unpacked from project root
- User message favoriting works on all three platforms
- Assistant message favoriting works on all three platforms (Claude ✓, ChatGPT ✓, Gemini ✓)
- Star buttons for Claude model responses now appear (`.font-claude-response` selector)
- Initial star state after page refresh works (GET_FAVORITES on conversation load)
- Favoriting a message on the page now auto-refreshes the panel's Favorites tab immediately
- Manual ⟳ refresh button available in the panel filter bar

---

## Next steps

### Priority 1 — Fill in `actionBar` selectors in `selectors.json`

Star buttons currently appear in a `div` below each message. The user wants them inline next to Copy/Like/Dislike buttons.

To fix: in Chrome DevTools, inspect an assistant message after streaming ends on each platform, find the CSS selector for the action-button row, and add to `selectors.json`. The selector must match a **child element within** the `assistantMessage` container (injector does `el.querySelector(selectors.actionBar)`).

```json
{
  "claude":  { ..., "actionBar": "<selector for Claude action row>" },
  "chatgpt": { ..., "actionBar": "<selector for ChatGPT action row>" },
  "gemini":  { ..., "actionBar": "<selector for Gemini action row>" }
}
```

### Priority 2 — Verify Gemini assistant favoriting end-to-end

Gemini's `model-response` may use shadow DOM, which would make `el.textContent` empty. In that case the stub message approach still persists the favorite, but the content string won't match if the extractor also sees empty content. Test on live Gemini to confirm stars work correctly.

---

## Key files

| File | Role |
|------|------|
| `src/injector.ts` | DOM injection — star buttons, click handlers, content re-extraction |
| `src/background.ts` | `TOGGLE_FAVORITE` and `GET_FAVORITES` handlers |
| `src/shared/types.ts` | `ToggleFavoritePayload`, `GetFavoritesPayload`, `PlatformSelectors.actionBar` |
| `src/shared/idb.ts` | `setMessageFavorite(id, bool)` — IDB write |
| `selectors.json` | CSS selectors per platform — `actionBar` needs real values |
| `popup/panel.ts` | Panel rendering, Favorites tab filter |
| `popup/panel.html` | Favorites tab gold styling, right-aligned position |
| `src/content_{claude,chatgpt,gemini}.ts` | Call `injectFavoriteButtons` on init |
