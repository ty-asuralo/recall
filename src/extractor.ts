import type { Message, Platform, PlatformSelectors } from './shared/types';

type RawMessage = Omit<Message, 'id' | 'seq'>;

export interface ExtractorOptions {
  platform: Platform;
  selectors: PlatformSelectors;
  onMessage: (message: RawMessage) => void;
}

const DEBOUNCE_MS = 600;

/**
 * Boots the MutationObserver for a given platform.
 * Handles SPA navigation via history.pushState monkey-patch.
 * Only emits messages after streaming has completed.
 */
export function createExtractor(options: ExtractorOptions): void {
  const { selectors, onMessage } = options;

  // Fingerprints of already-emitted messages — cleared on SPA navigation.
  const seen = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let observer: MutationObserver | null = null;

  function fingerprint(msg: RawMessage): string {
    return `${msg.role}::${msg.content.slice(0, 120)}`;
  }

  function flush(): void {
    if (isStreaming(document, selectors)) return;

    const messages = extractMessages(document, selectors);
    console.log('[recall] flush — messages found:', messages.length, 'seen:', seen.size);
    for (const msg of messages) {
      const fp = fingerprint(msg);
      if (!seen.has(fp)) {
        seen.add(fp);
        onMessage(msg);
      }
    }
  }

  function scheduleFlush(): void {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, DEBOUNCE_MS);
  }

  function startObserving(): void {
    if (observer) {
      observer.disconnect();
    }
    observer = new MutationObserver(scheduleFlush);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function onNavigate(): void {
    seen.clear();
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    // Re-observe after a tick to let the SPA render the new page
    setTimeout(() => {
      startObserving();
      scheduleFlush();
    }, 300);
  }

  // Monkey-patch history.pushState to detect SPA navigation
  const originalPushState = history.pushState.bind(history);
  history.pushState = function (...args) {
    originalPushState(...args);
    onNavigate();
  };
  window.addEventListener('popstate', onNavigate);

  startObserving();
}

/**
 * Returns true if the platform is still streaming a response.
 */
export function isStreaming(root: Document | Element, selectors: PlatformSelectors): boolean {
  if (!selectors.streamingIndicator) return false;
  return root.querySelector(selectors.streamingIndicator) !== null;
}

/**
 * Parses all current messages visible in the DOM.
 */
export function extractMessages(root: Document | Element, selectors: PlatformSelectors): RawMessage[] {
  const messages: RawMessage[] = [];
  const now = Date.now();

  const parts = [
    selectors.userMessage && { sel: selectors.userMessage, role: 'user' as const },
    selectors.assistantMessage && { sel: selectors.assistantMessage, role: 'assistant' as const },
  ].filter(Boolean) as { sel: string; role: 'user' | 'assistant' }[];

  if (parts.length === 0) return messages;

  const combined = parts.map((p) => p.sel).join(', ');
  for (const el of Array.from(root.querySelectorAll(combined))) {
    const role = parts.find((p) => el.matches(p.sel))?.role ?? 'user';
    const content = el.textContent?.trim() ?? '';
    if (content) messages.push({ role, content, capturedAt: now });
  }

  return messages;
}
