import { getSettings } from '../src/shared/settings';
import { getConversations } from '../src/shared/idb';
import type { Conversation, ConversationsIndex, Meta, Platform } from '../src/shared/types';

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

async function loadAll(): Promise<{ conversations: Conversation[]; meta: Meta | undefined }> {
  const result = await chrome.storage.local.get(['conversations', 'meta']);
  const index = result['conversations'] as ConversationsIndex | undefined;
  const meta = result['meta'] as Meta | undefined;
  if (!index || index.ids.length === 0) return { conversations: [], meta };
  const conversations = await getConversations(index.ids);
  return { conversations, meta };
}

function formatCount(n: number, max = 10): string {
  return n > max ? `${max}+` : String(n);
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildPlatformGroups(conversations: Conversation[], cursor: number, maxPerPlatform: number): PlatformGroup[] {
  const order: Platform[] = ['claude', 'chatgpt', 'gemini'];
  const map = new Map<Platform, ConvDisplay[]>();
  for (const p of order) map.set(p, []);

  // Most recently touched first
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);

  for (const conv of sorted) {
    const exportable = conv.messages.filter((m) => m.capturedAt > cursor).length;
    map.get(conv.platform)?.push({
      id: conv.id,
      title: conv.title || 'Untitled',
      totalMessages: conv.messages.length,
      exportableMessages: exportable,
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
  const [{ conversations, meta }, settings] = await Promise.all([loadAll(), getSettings()]);
  const cursor = meta?.lastExportedAt ?? 0;
  const groups = buildPlatformGroups(conversations, cursor, settings.display.maxConversationsPerPlatform);
  const totalExportable = groups.reduce((n, g) => n + g.totalExportable, 0);

  render(groups, totalExportable);

  document.getElementById('menu-about')!.addEventListener('click', () => {
    chrome.windows.create({
      url: chrome.runtime.getURL('popup/about.html'),
      type: 'popup',
      width: 380,
      height: 300,
    });
  });

  document.getElementById('menu-settings')!.addEventListener('click', () => {
    chrome.windows.create({
      url: chrome.runtime.getURL('popup/settings.html'),
      type: 'popup',
      width: 380,
      height: 420,
    });
  });

  document.getElementById('export-trigger')!.addEventListener('click', () => {
    chrome.windows.create({
      url: chrome.runtime.getURL('popup/export.html'),
      type: 'popup',
      width: 400,
      height: 440,
    });
  });
}

void main();
