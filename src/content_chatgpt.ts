import { createExtractor } from './extractor';
import { getSettings } from './shared/settings';
import type { CaptureMessagePayload } from './shared/types';
import allSelectors from '../selectors.json';

/** chatgpt.com URLs: /c/{id} */
function getConversationId(): string {
  const match = location.pathname.match(/\/c\/([^/?#]+)/);
  return match ? match[1] : '';
}

function getTitle(): string {
  return document.title.replace(/\s*[-|]?\s*ChatGPT\s*$/i, '').trim() || 'Untitled';
}

console.log('[recall] chatgpt content script loaded');

async function init(): Promise<void> {
  console.log('[recall] chatgpt init started', allSelectors.chatgpt);

  createExtractor({
    platform: 'chatgpt',
    selectors: allSelectors.chatgpt,
    onMessage: async (message) => {
      let capture;
      try { ({ capture } = await getSettings()); } catch { return; }
      if (!capture.roles.includes(message.role)) return;
      const conversationId = getConversationId();
      if (!conversationId) return;
      console.log('[recall] chatgpt captured:', message);

      const payload: CaptureMessagePayload = {
        type: 'CAPTURE_MESSAGE',
        platform: 'chatgpt',
        conversationId,
        message,
        title: getTitle(),
        url: location.href,
      };
      void chrome.runtime.sendMessage(payload);
    },
  });
}

void init();
