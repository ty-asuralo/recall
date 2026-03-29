import { getSettings } from '../src/shared/settings';
import { getConversationMetas, getMessagesAfterCursor } from '../src/shared/idb';
import type { ConversationMeta, ConversationsIndex, Meta, Platform } from '../src/shared/types';

interface ConvDisplay {
  id: string;
  title: string;
  totalMessages: number;
  exportableMessages: number;
}

interface PlatformGroup {
  platform: Platform;
  conversations: ConvDisplay[];
  totalExportable: number;
}

async function loadAll(): Promise<{
  conversations: ConversationMeta[];
  exportableCounts: Map<string, number>;
  meta: Meta | undefined;
}> {
  const result = await chrome.storage.local.get(['conversations', 'meta']);
  const index = result['conversations'] as ConversationsIndex | undefined;
  const meta = result['meta'] as Meta | undefined;
  const cursor = meta?.lastExportedAt ?? 0;

  if (!index || index.ids.length === 0) {
    return { conversations: [], exportableCounts: new Map(), meta };
  }

  // Load conversation metadata and new-message counts in parallel.
  // getMessagesAfterCursor uses the capturedAt index — no full table scan.
  const [conversations, newMessages] = await Promise.all([
    getConversationMetas(index.ids),
    getMessagesAfterCursor(cursor),
  ]);

  const exportableCounts = new Map<string, number>();
  for (const msg of newMessages) {
    exportableCounts.set(msg.conversationId, (exportableCounts.get(msg.conversationId) ?? 0) + 1);
  }

  return { conversations, exportableCounts, meta };
}

function formatCount(n: number, max = 10): string {
  return n > max ? `${max}+` : String(n);
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildPlatformGroups(
  conversations: ConversationMeta[],
  exportableCounts: Map<string, number>,
  maxPerPlatform: number,
): PlatformGroup[] {
  const order: Platform[] = ['claude', 'chatgpt', 'gemini'];
  const map = new Map<Platform, ConvDisplay[]>();
  for (const p of order) map.set(p, []);

  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);

  for (const conv of sorted) {
    map.get(conv.platform)?.push({
      id: conv.id,
      title: conv.title || 'Untitled',
      totalMessages: conv.messageCount,
      exportableMessages: exportableCounts.get(conv.id) ?? 0,
    });
  }

  return order
    .filter((p) => (map.get(p)?.length ?? 0) > 0)
    .map((p) => {
      const convs = map.get(p)!;
      return {
        platform: p,
        conversations: convs.slice(0, maxPerPlatform),
        totalExportable: convs.reduce((n, c) => n + c.exportableMessages, 0),
      };
    });
}

function render(groups: PlatformGroup[], totalExportable: number): void {
  const container = document.getElementById('conversations')!;
  const badge = document.getElementById('header-badge')!;

  badge.textContent = totalExportable > 0 ? `${formatCount(totalExportable, 99)} new` : '0 new';
  badge.className = `header-badge${totalExportable === 0 ? ' none' : ''}`;

  if (groups.length === 0) {
    container.innerHTML = `<div class="empty-state">No conversations captured yet.<br>Open Claude, ChatGPT or Gemini to start.</div>`;
    return;
  }

  container.innerHTML = groups
    .map((group) => {
      const rows = group.conversations
        .map((c) => {
          const newLabel =
            c.exportableMessages > 0
              ? `<span class="conv-new-count">${formatCount(c.exportableMessages)} new</span>`
              : `<span class="conv-new-count none">—</span>`;
          return `<div class="conv-row">
            <span class="conv-title-text">${escHtml(c.title)}</span>
            <span class="conv-msg-count">${c.totalMessages} msgs</span>
            ${newLabel}
          </div>`;
        })
        .join('');

      const newChip =
        group.totalExportable > 0
          ? `<span class="count-chip new">${formatCount(group.totalExportable)} new</span>`
          : `<span class="count-chip nonew">0 new</span>`;

      const PLATFORM_LABELS: Record<string, string> = { claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini' };
      const label = PLATFORM_LABELS[group.platform] ?? group.platform;

      return `<div class="platform-group open" data-platform="${group.platform}">
        <div class="platform-header">
          <span class="platform-dot ${group.platform}"></span>
          <span class="platform-name">${label}</span>
          <div class="platform-counts">
            <span class="count-chip total">${group.conversations.length} convos</span>
            ${newChip}
          </div>
          <span class="chevron">▶</span>
        </div>
        <div class="platform-body">${rows}</div>
      </div>`;
    })
    .join('');

  container.querySelectorAll('.platform-header').forEach((header) => {
    header.addEventListener('click', () => {
      header.closest('.platform-group')?.classList.toggle('open');
    });
  });
}

async function main(): Promise<void> {
  const [{ conversations, exportableCounts, meta }, settings] = await Promise.all([
    loadAll(),
    getSettings(),
  ]);
  const groups = buildPlatformGroups(conversations, exportableCounts, settings.display.maxConversationsPerPlatform);
  const totalExportable = groups.reduce((n, g) => n + g.totalExportable, 0);

  render(groups, totalExportable);

  document.getElementById('open-panel')!.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.windowId !== undefined) {
        void chrome.sidePanel.open({ windowId: tab.windowId });
      }
    });
  });

  document.getElementById('export-trigger')!.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.windowId !== undefined) {
        void chrome.sidePanel.open({ windowId: tab.windowId });
        // Ask the panel to navigate to export tab
        setTimeout(() => {
          void chrome.runtime.sendMessage({ type: 'PANEL_NAV', view: 'export' });
        }, 300);
      }
    });
  });
}

void main();
