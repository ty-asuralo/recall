import { createExtractor } from './extractor';
import { getSettings } from './shared/settings';
import type { CaptureMessagePayload } from './shared/types';
import allSelectors from '../selectors.json';

/** gemini.google.com URLs: /app/{id} */
function getConversationId(): string {
  const match = location.pathname.match(/\/app\/([^/?#]+)/);
  return match ? match[1] : '';
}

function getTitle(): string {
  return document.querySelector('[aria-current="true"] .conversation-title')?.textContent?.trim() || 'Untitled';
}

console.log('[recall] gemini content script loaded');

async function init(): Promise<void> {
  console.log('[recall] gemini init started', allSelectors.gemini);

  createExtractor({
    platform: 'gemini',
    selectors: allSelectors.gemini,
    onMessage: async (message) => {
      let capture;
      try { ({ capture } = await getSettings()); } catch { return; }
      if (!capture.roles.includes(message.role)) return;
      const conversationId = getConversationId();
      if (!conversationId) return;

      // Gemini injects a visually-hidden "You said" label inside .query-text
      const content = message.role === 'user'
        ? message.content.replace(/^\s*You said\s+/i, '').trim()
        : message.content;
      if (!content) return;

      console.log('[recall] gemini captured:', { ...message, content });

      const payload: CaptureMessagePayload = {
        type: 'CAPTURE_MESSAGE',
        platform: 'gemini',
        conversationId,
        message: { ...message, content },
        title: getTitle(),
        url: location.href,
      };
      void chrome.runtime.sendMessage(payload);
    },
  });
}

void init();
