import { getConversationMetas, getMessagesByConversation } from '../src/shared/idb';
import type { ConversationMeta, ConversationsIndex, Platform, StoredMessage } from '../src/shared/types';

const PLATFORM_LABELS: Record<string, string> = {
  claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini',
};

let allConversations: ConversationMeta[] = [];
let selectedId: string | null = null;
let currentFilter: Platform | 'all' = 'all';

// ── Data ──────────────────────────────────────────────────────────────────────

async function loadConversations(): Promise<void> {
  const result = await chrome.storage.local.get('conversations');
  const index = result['conversations'] as ConversationsIndex | undefined;
  if (!index || index.ids.length === 0) { allConversations = []; return; }
  allConversations = await getConversationMetas(index.ids);
  allConversations.sort((a, b) => b.updatedAt - a.updatedAt);
}

function filtered(): ConversationMeta[] {
  return currentFilter === 'all'
    ? allConversations
    : allConversations.filter((c) => c.platform === currentFilter);
}

// ── Formatting ────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Render: conversation list ─────────────────────────────────────────────────

function renderList(): void {
  const listEl = document.getElementById('conv-list')!;
  const convs = filtered();

  if (convs.length === 0) {
    listEl.innerHTML = `<div class="conv-list-empty">No conversations yet.<br>Open Claude, ChatGPT, or Gemini to start.</div>`;
    return;
  }

  listEl.innerHTML = convs
    .map((c) => `
      <div class="conv-item${c.id === selectedId ? ' selected' : ''}" data-id="${escHtml(c.id)}">
        <div class="conv-item-header">
          <span class="conv-platform-dot" style="background:${platformColor(c.platform)}"></span>
          <span class="conv-title">${escHtml(c.title || 'Untitled')}</span>
        </div>
        <div class="conv-meta">${c.messageCount} msg${c.messageCount !== 1 ? 's' : ''} · ${fmtDate(c.updatedAt)}</div>
      </div>
    `)
    .join('');

  listEl.querySelectorAll('.conv-item').forEach((el) => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.id!;
      void selectConversation(id);
    });
  });
}

// ── Render: thread ────────────────────────────────────────────────────────────

async function selectConversation(id: string): Promise<void> {
  selectedId = id;

  // Update selected state in list without full re-render
  document.querySelectorAll('.conv-item').forEach((el) => {
    el.classList.toggle('selected', (el as HTMLElement).dataset.id === id);
  });

  const conv = allConversations.find((c) => c.id === id);
  const messages = await getMessagesByConversation(id);
  renderThread(conv, messages);
}

function renderThread(conv: ConversationMeta | undefined, messages: StoredMessage[]): void {
  const threadEl = document.getElementById('thread')!;

  if (!conv || messages.length === 0) {
    threadEl.innerHTML = `<div class="thread-empty">No messages captured for this conversation.</div>`;
    return;
  }

  const color = platformColor(conv.platform);
  const header = `
    <div class="thread-header">
      <span class="thread-platform-dot" style="background:${color}"></span>
      <span class="thread-title">${escHtml(conv.title || 'Untitled')}</span>
      <span class="thread-msg-count">${messages.length} message${messages.length !== 1 ? 's' : ''} · ${PLATFORM_LABELS[conv.platform] ?? conv.platform}</span>
    </div>
  `;

  const bubbles = messages
    .map((m) => `
      <div class="msg-row ${m.role}">
        <div>
          <div class="msg-bubble">${escHtml(m.content)}</div>
          <div class="msg-time">${fmtTime(m.capturedAt)}</div>
        </div>
      </div>
    `)
    .join('');

  threadEl.innerHTML = header + bubbles;
  threadEl.scrollTop = threadEl.scrollHeight;
}

function platformColor(platform: Platform): string {
  return platform === 'claude' ? '#D97757'
       : platform === 'chatgpt' ? '#10A37F'
       : '#4285F4';
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await loadConversations();
  renderList();

  // Filter tabs
  document.querySelectorAll<HTMLButtonElement>('.filter-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      currentFilter = (tab.dataset.platform ?? 'all') as Platform | 'all';
      document.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      renderList();
    });
  });

  // Auto-select first conversation
  const first = filtered()[0];
  if (first) void selectConversation(first.id);
}

void main();
