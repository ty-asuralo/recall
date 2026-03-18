import { createExtractor } from './extractor';
import { getSettings } from './shared/settings';
import type { CaptureMessagePayload } from './shared/types';
// TODO: runtime fetch via chrome.runtime.getURL is blocked by claude.ai CSP.
// Selectors are bundled for now; hot-fix requires a rebuild + extension reload.
import allSelectors from '../selectors.json';

/** claude.ai URLs: /chat/{uuid} or /new */
function getConversationId(): string {
  const match = location.pathname.match(/\/chat\/([a-f0-9-]+)/i);
  return match ? match[1] : '';
}

function getTitle(): string {
  // Claude sets document.title to the conversation title once it has one
  return document.title.replace(/\s*[-|]?\s*Claude\s*$/i, '').trim() || 'Untitled';
}

console.log('[recall] content script loaded');

async function init(): Promise<void> {
  const settings = await getSettings();
  const captureRoles = settings.capture.roles;
  console.log('[recall] init started', allSelectors.claude, 'captureRoles:', captureRoles);

  createExtractor({
    platform: 'claude',
    selectors: allSelectors.claude,
    onMessage: (message) => {
      if (!captureRoles.includes(message.role)) return;
      const conversationId = getConversationId();
      if (!conversationId) return; // still on /new, no conversation yet
      console.log('[recall] captured:', message);

      const payload: CaptureMessagePayload = {
        type: 'CAPTURE_MESSAGE',
        platform: 'claude',
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
