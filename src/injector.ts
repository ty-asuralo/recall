/**
 * DOM injector — adds a Recall star button to each captured message on the page.
 *
 * User messages:      star below the bubble, right-aligned.
 * Assistant messages: star appended inside the action bar (next to copy/like/dislike)
 *                     when `selectors.actionBar` matches a child element; otherwise
 *                     a div below the bubble, left-aligned.
 *
 * Key design points:
 *
 * Content is re-extracted from the live DOM element at CLICK TIME, not at injection
 * time. This is the critical correctness fix: when a model response streams in, the
 * injector fires at 300 ms and the extractor at 600 ms; if action buttons (Copy, Like…)
 * appear inside the container between those two debounces, el.textContent differs and
 * the IDB lookup fails. By the time the user actually clicks the star, the DOM is fully
 * settled and the extracted content matches IDB exactly.
 *
 * Injection is still skipped while the streaming indicator is visible so we never inject
 * a star on an incomplete partial response.
 *
 * On each new conversation, favorites are loaded from the background so star buttons
 * reflect existing favorites immediately after page load / navigation (Bug 2 fix).
 */

import type { GetFavoritesPayload, Platform, PlatformSelectors, ToggleFavoritePayload } from './shared/types';

const INJECTED_ATTR = 'data-recall-injected';

export function injectFavoriteButtons(
  platform: Platform,
  selectors: PlatformSelectors,
  getConversationId: () => string,
  /** Platform-specific content normaliser (e.g. Gemini strips "You said" prefix). */
  transformContent?: (role: 'user' | 'assistant', content: string) => string,
): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastConvId = '';
  // Content strings of messages currently favorited in IDB.
  // Shared across all buttons so a toggle in one button updates the set for all.
  let favoriteContents = new Set<string>();

  async function loadFavorites(conversationId: string): Promise<void> {
    try {
      const payload: GetFavoritesPayload = { type: 'GET_FAVORITES', conversationId };
      const res = await chrome.runtime.sendMessage(payload) as { contents: string[] } | undefined;
      favoriteContents = new Set(res?.contents ?? []);
    } catch {
      favoriteContents = new Set();
    }
  }

  function schedule(): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => void injectAll(), 300);
  }

  async function injectAll(): Promise<void> {
    // Never inject while streaming — content is incomplete and won't match IDB.
    if (selectors.streamingIndicator && document.querySelector(selectors.streamingIndicator)) return;

    const conversationId = getConversationId();
    if (!conversationId) return;

    // Reload favorites whenever we enter a new conversation.
    if (conversationId !== lastConvId) {
      lastConvId = conversationId;
      await loadFavorites(conversationId);
    }

    const parts: { sel: string; role: 'user' | 'assistant' }[] = [];
    if (selectors.userMessage) parts.push({ sel: selectors.userMessage, role: 'user' });
    if (selectors.assistantMessage) parts.push({ sel: selectors.assistantMessage, role: 'assistant' });

    for (const { sel, role } of parts) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
        if (role === 'assistant' && selectors.actionBar) {
          // Wait for the action bar — it only appears after streaming ends.
          // Check inside el first (Gemini: bar is inside model-response).
          // Fall back to el.parentElement for platforms where the bar is a
          // sibling of the message container (ChatGPT pattern).
          const bar = el.querySelector(selectors.actionBar)
            ?? el.parentElement?.querySelector(selectors.actionBar) ?? null;
          if (!bar) continue;
          if (el.getAttribute(INJECTED_ATTR)) continue;

          // Use injection-time content only to check initial favorite state.
          // The actual toggle uses live DOM extraction at click time.
          const injectionContent = extractContent(el, selectors, role, transformContent);
          el.setAttribute(INJECTED_ATTR, '1');
          bar.appendChild(makeButton(platform, conversationId, role, el, selectors, injectionContent, favoriteContents, transformContent));
        } else {
          if (el.getAttribute(INJECTED_ATTR)) continue;

          const injectionContent = extractContent(el, selectors, role, transformContent);
          el.setAttribute(INJECTED_ATTR, '1');
          const btn = makeButton(platform, conversationId, role, el, selectors, injectionContent, favoriteContents, transformContent);
          const wrap = document.createElement('div');
          wrap.className = 'recall-star-wrap';
          wrap.style.cssText = role === 'user'
            ? 'display:flex;justify-content:flex-end;margin-top:4px;padding-right:4px;'
            : 'display:flex;justify-content:flex-start;margin-top:4px;padding-left:4px;';
          wrap.appendChild(btn);
          el.appendChild(wrap);
        }
      }
    }
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  schedule();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractContent(
  el: HTMLElement,
  selectors: PlatformSelectors,
  role: 'user' | 'assistant',
  transform?: (role: 'user' | 'assistant', content: string) => string,
): string {
  // Clone so we can strip injected recall buttons without touching the live DOM.
  // This prevents the star character ("☆"/"★") from contaminating the content
  // string, which must exactly match what the extractor stored in IDB.
  const clone = el.cloneNode(true) as HTMLElement;
  for (const node of Array.from(clone.querySelectorAll('.recall-star-wrap, [data-recall-btn]'))) {
    node.remove();
  }
  let raw: string;
  if (selectors.textContent) {
    const textEls = Array.from(clone.querySelectorAll(selectors.textContent));
    raw = textEls.length > 0
      ? textEls.map((e) => (e as HTMLElement).textContent?.trim() ?? '').filter(Boolean).join('\n\n')
      : clone.textContent?.trim() ?? '';
  } else {
    raw = clone.textContent?.trim() ?? '';
  }
  return transform ? transform(role, raw) : raw;
}

function makeButton(
  platform: Platform,
  conversationId: string,
  role: 'user' | 'assistant',
  /** Live DOM element — used to re-extract content at click time. */
  el: HTMLElement,
  selectors: PlatformSelectors,
  /** Content string at injection time — used only for initial ★/☆ state. */
  injectionContent: string,
  favoriteContents: Set<string>,
  transformContent?: (role: 'user' | 'assistant', content: string) => string,
): HTMLButtonElement {
  const initiallyStarred = favoriteContents.has(injectionContent);

  const btn = document.createElement('button');
  btn.className = 'recall-star-btn';
  btn.setAttribute('data-recall-btn', '1');
  btn.textContent = initiallyStarred ? '★' : '☆';
  btn.title = initiallyStarred ? 'Remove from Recall' : 'Save to Recall';
  btn.style.cssText = [
    'background:none',
    'border:none',
    'cursor:pointer',
    'font-size:14px',
    `color:${initiallyStarred ? '#f5a623' : '#bbb'}`,
    'padding:2px 5px',
    'border-radius:4px',
    'line-height:1',
    'transition:color 0.15s',
    'flex-shrink:0',
    'vertical-align:middle',
  ].join(';');
  if (initiallyStarred) btn.classList.add('recall-starred');

  btn.addEventListener('mouseenter', () => {
    if (!btn.classList.contains('recall-starred')) btn.style.color = '#f5a623';
  });
  btn.addEventListener('mouseleave', () => {
    if (!btn.classList.contains('recall-starred')) btn.style.color = '#bbb';
  });

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Re-extract from the live element at click time — by now the DOM is fully
    // settled (streaming done, action buttons rendered) so this matches IDB exactly.
    const content = extractContent(el, selectors, role, transformContent);
    if (!content) return;

    const payload: ToggleFavoritePayload = { type: 'TOGGLE_FAVORITE', platform, conversationId, role, content };

    try {
      const res = await chrome.runtime.sendMessage(payload) as { favorited: boolean } | undefined;
      const nowFavorited = res?.favorited ?? false;

      if (nowFavorited) {
        favoriteContents.add(content);
        btn.textContent = '★';
        btn.style.color = '#f5a623';
        btn.title = 'Remove from Recall';
        btn.classList.add('recall-starred');
      } else {
        favoriteContents.delete(content);
        btn.textContent = '☆';
        btn.style.color = '#bbb';
        btn.title = 'Save to Recall';
        btn.classList.remove('recall-starred');
      }
      // Notify the Recall panel (if open) to refresh its favorites list.
      void chrome.runtime.sendMessage({ type: 'FAVORITES_UPDATED' }).catch(() => { /* panel not open */ });
    } catch (err) {
      console.error('[recall] toggle favorite failed:', err);
    }
  });

  return btn;
}
