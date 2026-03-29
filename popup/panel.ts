import { DEFAULT_SETTINGS, getSettings, saveSettings, validateSettings } from '../src/shared/settings';
import type { AppSettings, ConversationMeta, ConversationsIndex, ExportRecord, Meta, Platform, StoredMessage } from '../src/shared/types';
import { getConversationMetas, getExportDir, getFavoriteMessages, getMessagesByConversation, getMessagesAfterCursor, getStorageStats, saveExportDir, setMessageFavorite } from './idb';

// ── View switching ─────────────────────────────────────────────────────────

type View = 'conversations' | 'export' | 'settings' | 'about';

function switchView(view: View): void {
  document.querySelectorAll<HTMLElement>('.view').forEach((el) => {
    el.hidden = el.dataset.view !== view;
  });
  document.querySelectorAll<HTMLElement>('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === view);
  });
}

chrome.runtime.onMessage.addListener((msg: unknown) => {
  if (msg && typeof msg === 'object' && 'type' in msg && (msg as { type: string }).type === 'PANEL_NAV') {
    switchView((msg as unknown as { view: View }).view);
  }
});

// ── Shared helpers ─────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function platformColor(platform: Platform): string {
  return platform === 'claude' ? '#D97757' : platform === 'chatgpt' ? '#10A37F' : '#4285F4';
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Conversations view state ───────────────────────────────────────────────

type ConvFilter = Platform | 'all' | 'favorites';

let allConversations: ConversationMeta[] = [];
let currentFilter: ConvFilter = 'all';

// Favorites state
let favoriteMessages: StoredMessage[] = [];   // sorted newest-first, for flat list
let favoriteIds = new Set<string>();           // fast lookup by msg id
let msgConvMap = new Map<string, string>();    // msgId → convId (populated as threads load)

// ── Data loading ───────────────────────────────────────────────────────────

async function loadConversations(): Promise<void> {
  const result = await chrome.storage.local.get('conversations');
  const index = result['conversations'] as ConversationsIndex | undefined;
  if (!index || index.ids.length === 0) { allConversations = []; return; }
  allConversations = await getConversationMetas(index.ids);
  allConversations.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function loadFavorites(): Promise<void> {
  const favs = await getFavoriteMessages();
  favoriteMessages = favs.sort((a, b) => b.capturedAt - a.capturedAt);
  favoriteIds = new Set(favs.map((m) => m.id));
  for (const m of favs) msgConvMap.set(m.id, m.conversationId);
}

// ── Conversation list rendering ────────────────────────────────────────────

function filteredConversations(): ConversationMeta[] {
  return currentFilter === 'all'
    ? allConversations
    : allConversations.filter((c) => c.platform === currentFilter);
}

function renderConvList(): void {
  const listEl = document.getElementById('conv-list')!;

  if (currentFilter === 'favorites') {
    renderFavoritesList(listEl);
    return;
  }

  const convs = filteredConversations();
  if (convs.length === 0) {
    listEl.innerHTML = `<div class="conv-list-empty">No conversations yet.<br>Open Claude, ChatGPT, or Gemini to start.</div>`;
    return;
  }

  listEl.innerHTML = convs.map((c) => `
    <div class="conv-item" data-id="${escHtml(c.id)}">
      <div class="conv-item-header">
        <span class="conv-platform-dot" style="background:${platformColor(c.platform)}"></span>
        <span class="conv-title">${escHtml(c.title || 'Untitled')}</span>
      </div>
      <div class="conv-meta">${c.messageCount} msg${c.messageCount !== 1 ? 's' : ''} · ${fmtDate(c.updatedAt)}</div>
    </div>`).join('');

  listEl.querySelectorAll('.conv-item').forEach((el) => {
    el.addEventListener('click', () => void showThread((el as HTMLElement).dataset.id!));
  });
}

function renderFavoritesList(listEl: HTMLElement): void {
  if (favoriteMessages.length === 0) {
    listEl.innerHTML = `<div class="conv-list-empty">No favorites yet.<br>Star any message in a conversation to save it here.</div>`;
    return;
  }

  const LABELS: Record<string, string> = { claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini' };

  listEl.innerHTML = favoriteMessages.map((m) => {
    const conv = allConversations.find((c) => c.id === m.conversationId);
    const convName = conv?.title || 'Untitled';
    const preview = m.content.length > 120 ? m.content.slice(0, 120) + '…' : m.content;
    const roleLabel = m.role === 'user' ? 'You' : 'AI';
    return `
      <div class="fav-msg-item" data-msg-id="${escHtml(m.id)}">
        <div class="fav-msg-item-header">
          <span class="conv-platform-dot" style="background:${platformColor(m.platform)}"></span>
          <span class="fav-conv-name">${escHtml(convName)}</span>
          <span class="role-badge ${m.role}">${roleLabel}</span>
          <span style="font-size:10px;color:#bbb;flex-shrink:0">${fmtDate(m.capturedAt)}</span>
        </div>
        <div class="fav-msg-preview">${escHtml(preview)}</div>
      </div>`;
  }).join('');

  listEl.querySelectorAll('.fav-msg-item').forEach((el) => {
    el.addEventListener('click', () => showFavoriteDetail((el as HTMLElement).dataset.msgId!));
  });
}

// ── Thread view (normal conversations) ────────────────────────────────────

async function showThread(id: string): Promise<void> {
  const conv = allConversations.find((c) => c.id === id);
  const messages = await getMessagesByConversation(id);
  for (const m of messages) msgConvMap.set(m.id, id);

  document.getElementById('conv-list-panel')!.hidden = true;
  document.getElementById('thread-panel')!.hidden = false;

  const threadEl = document.getElementById('thread')!;
  if (!conv || messages.length === 0) {
    threadEl.innerHTML = `<div class="thread-empty">No messages captured for this conversation.</div>`;
    return;
  }

  const LABELS: Record<string, string> = { claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini' };
  const header = `
    <div class="thread-header">
      <span class="thread-platform-dot" style="background:${platformColor(conv.platform)}"></span>
      <div class="thread-header-text">
        <div class="thread-title">${escHtml(conv.title || 'Untitled')}</div>
        <div class="thread-subtitle">${messages.length} message${messages.length !== 1 ? 's' : ''} · ${LABELS[conv.platform] ?? conv.platform}</div>
      </div>
    </div>`;

  const bubbles = messages.map((m) => {
    const starred = favoriteIds.has(m.id);
    return `
      <div class="msg-row ${m.role}" data-msg-id="${escHtml(m.id)}" data-conv-id="${escHtml(id)}">
        <div>
          <div class="msg-bubble">${escHtml(m.content)}</div>
          <div class="msg-footer">
            <span class="msg-time">${fmtTime(m.capturedAt)}</span>
            <button class="star-btn${starred ? ' starred' : ''}" title="${starred ? 'Remove from favorites' : 'Add to favorites'}">${starred ? '★' : '☆'}</button>
          </div>
        </div>
      </div>`;
  }).join('');

  threadEl.innerHTML = header + bubbles;
  threadEl.scrollTop = threadEl.scrollHeight;
}

// ── Favorite message detail view ───────────────────────────────────────────

function showFavoriteDetail(msgId: string): void {
  const msg = favoriteMessages.find((m) => m.id === msgId);
  if (!msg) return;
  const conv = allConversations.find((c) => c.id === msg.conversationId);

  document.getElementById('conv-list-panel')!.hidden = true;
  document.getElementById('thread-panel')!.hidden = false;

  const LABELS: Record<string, string> = { claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini' };
  const threadEl = document.getElementById('thread')!;

  const header = `
    <div class="thread-header">
      <span class="thread-platform-dot" style="background:${platformColor(msg.platform)}"></span>
      <div class="thread-header-text">
        <div class="thread-title">${escHtml(conv?.title || 'Untitled')}</div>
        <div class="thread-subtitle">${LABELS[msg.platform] ?? msg.platform} · ${msg.role === 'user' ? 'Your message' : 'AI response'} · ${fmtTime(msg.capturedAt)}</div>
      </div>
    </div>`;

  const bubble = `
    <div class="msg-row ${msg.role}" data-msg-id="${escHtml(msg.id)}" data-conv-id="${escHtml(msg.conversationId)}">
      <div>
        <div class="msg-bubble">${escHtml(msg.content)}</div>
        <div class="msg-footer">
          <span class="msg-time">${fmtTime(msg.capturedAt)}</span>
          <button class="star-btn starred" title="Remove from favorites">★</button>
        </div>
      </div>
    </div>`;

  threadEl.innerHTML = header + bubble;
}

// ── Favorite toggle ────────────────────────────────────────────────────────

async function toggleFavorite(msgId: string, convId: string, btn: HTMLElement): Promise<void> {
  const nowStarred = !favoriteIds.has(msgId);

  btn.textContent = nowStarred ? '★' : '☆';
  btn.classList.toggle('starred', nowStarred);
  btn.title = nowStarred ? 'Remove from favorites' : 'Add to favorites';

  if (nowStarred) {
    favoriteIds.add(msgId);
    msgConvMap.set(msgId, convId);
  } else {
    favoriteIds.delete(msgId);
  }

  await setMessageFavorite(msgId, nowStarred);
  await loadFavorites();
}

// ── Conversations init ─────────────────────────────────────────────────────

function initConversationsView(): void {
  document.querySelectorAll<HTMLButtonElement>('.filter-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      currentFilter = (tab.dataset.platform ?? 'all') as ConvFilter;
      document.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('conv-list-panel')!.hidden = false;
      document.getElementById('thread-panel')!.hidden = true;
      renderConvList();
    });
  });

  document.getElementById('back-btn')!.addEventListener('click', () => {
    document.getElementById('conv-list-panel')!.hidden = false;
    document.getElementById('thread-panel')!.hidden = true;
    if (currentFilter === 'favorites') renderConvList();
  });

  // Single delegated star listener — set up once, no duplication across thread loads
  document.getElementById('thread')!.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('.star-btn') as HTMLElement | null;
    if (!btn) return;
    const row = btn.closest('[data-msg-id]') as HTMLElement | null;
    if (!row) return;
    const msgId = row.dataset.msgId!;
    const convId = row.dataset.convId!;
    await toggleFavorite(msgId, convId, btn);
    // In favorites detail view, unstarring navigates back to the list
    if (currentFilter === 'favorites' && !favoriteIds.has(msgId)) {
      document.getElementById('conv-list-panel')!.hidden = false;
      document.getElementById('thread-panel')!.hidden = true;
      renderConvList();
    }
  });
}

// ── Export view ────────────────────────────────────────────────────────────

function showExportWarning(msg: string, onSettingsClick?: () => void): void {
  const el = document.getElementById('export-warning')!;
  const text = document.getElementById('export-warning-text')!;
  el.hidden = false;
  if (onSettingsClick) {
    text.innerHTML = `${msg} <a id="export-warning-link">Open Settings</a>`;
    document.getElementById('export-warning-link')!.addEventListener('click', onSettingsClick);
  } else {
    text.textContent = msg;
  }
}

function hideExportWarning(): void {
  document.getElementById('export-warning')!.hidden = true;
}

function setExportStatus(msg: string, type: 'error' | 'success' | '' = ''): void {
  const el = document.getElementById('export-status')!;
  el.textContent = msg;
  el.className = `export-status${type ? ' ' + type : ''}`;
}

async function collectNewRecords(): Promise<ExportRecord[]> {
  const result = await chrome.storage.local.get('meta');
  const meta = result['meta'] as Meta | undefined;
  const cursor = meta?.lastExportedAt ?? 0;
  const messages = await getMessagesAfterCursor(cursor);
  if (messages.length === 0) return [];
  const convIds = [...new Set(messages.map((m) => m.conversationId))];
  const convMetas = await getConversationMetas(convIds);
  const convMap = new Map(convMetas.map((c) => [c.id, c]));
  const records: ExportRecord[] = [];
  for (const msg of messages) {
    const conv = convMap.get(msg.conversationId);
    if (!conv) continue;
    records.push({ id: msg.id, conversationId: msg.conversationId, platform: msg.platform, url: conv.url, title: conv.title, role: msg.role, content: msg.content, capturedAt: msg.capturedAt, seq: msg.seq });
  }
  return records.sort((a, b) => a.capturedAt - b.capturedAt || a.seq - b.seq);
}

async function advanceExportCursor(): Promise<void> {
  const result = await chrome.storage.local.get('meta');
  const meta = result['meta'] as Meta | undefined;
  const now = Date.now();
  await chrome.storage.local.set({ meta: { version: 1, lastUpdated: meta?.lastUpdated ?? now, lastExportedAt: now } });
}

async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts = { mode: 'readwrite' as const };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

async function writeExportFiles(rootDir: FileSystemDirectoryHandle, records: ExportRecord[]): Promise<string[]> {
  const groups: Record<string, Record<string, ExportRecord[]>> = {};
  for (const r of records) {
    (groups[r.platform] ??= {})[r.role] ??= [];
    groups[r.platform][r.role].push(r);
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const written: string[] = [];
  for (const [platform, byRole] of Object.entries(groups)) {
    const platformDir = await rootDir.getDirectoryHandle(platform, { create: true });
    for (const [role, recs] of Object.entries(byRole)) {
      if (recs.length === 0) continue;
      const filename = `${platform}_${role}_${ts}.jsonl`;
      const fileHandle = await platformDir.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(recs.map((r) => JSON.stringify(r)).join('\n'));
      await writable.close();
      written.push(`${platform}/${filename}`);
    }
  }
  return written;
}

async function initExportView(): Promise<void> {
  const confirmBtn = document.getElementById('btn-export-confirm') as HTMLButtonElement;
  const cancelBtn = document.getElementById('btn-export-cancel') as HTMLButtonElement;
  const localMeta = document.getElementById('local-meta')!;

  let settings: AppSettings;
  let dir: FileSystemDirectoryHandle | null;
  try {
    [settings, dir] = await Promise.all([getSettings(), getExportDir()]);
  } catch (err) {
    localMeta.textContent = 'Error loading settings';
    console.error('[recall] initExportView: failed to load settings/dir:', err);
    cancelBtn.addEventListener('click', () => switchView('conversations'));
    return;
  }

  if (settings.export.local.folderName && dir) {
    localMeta.textContent = `Folder: ${settings.export.local.folderName}`;
    localMeta.className = 'option-meta configured';
  } else if (settings.export.local.folderName && !dir) {
    localMeta.textContent = 'Folder handle lost — re-select in Settings';
    showExportWarning('The export folder is no longer accessible.', () => switchView('settings'));
  } else {
    localMeta.textContent = 'No folder configured';
    showExportWarning('No export folder is configured yet.', () => switchView('settings'));
  }

  cancelBtn.addEventListener('click', () => switchView('conversations'));

  confirmBtn.addEventListener('click', async () => {
    hideExportWarning();
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Exporting…';
    try {
      const latestSettings = await getSettings();
      const exportDir = await getExportDir();
      if (!latestSettings.export.local.folderName || !exportDir) {
        showExportWarning('No export folder configured.', () => switchView('settings'));
        confirmBtn.disabled = false; confirmBtn.textContent = 'Export'; return;
      }
      const permitted = await ensurePermission(exportDir);
      if (!permitted) {
        showExportWarning('Folder permission denied. Re-select it in Settings → Export.');
        confirmBtn.disabled = false; confirmBtn.textContent = 'Export'; return;
      }
      const records = await collectNewRecords();
      if (records.length === 0) {
        setExportStatus('No new messages to export.');
        confirmBtn.disabled = false; confirmBtn.textContent = 'Export'; return;
      }
      const written = await writeExportFiles(exportDir, records);
      await advanceExportCursor();
      setExportStatus(`Exported:\n${written.join('\n')}`, 'success');
      confirmBtn.textContent = 'Export';
      confirmBtn.disabled = false;
    } catch (err) {
      setExportStatus(`Export failed: ${String(err)}`, 'error');
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Export';
    }
  });
}

// ── Settings view ──────────────────────────────────────────────────────────

async function initSettingsView(): Promise<void> {
  const settings = await getSettings();

  const maxConvosInput = document.getElementById('max-convos') as HTMLInputElement;
  const captureUserChk = document.getElementById('capture-user') as HTMLInputElement;
  const captureAssistantChk = document.getElementById('capture-assistant') as HTMLInputElement;
  const captureRolesError = document.getElementById('capture-roles-error')!;
  const autoExportToggle = document.getElementById('auto-export-enabled') as HTMLInputElement;
  const localFolderName = document.getElementById('local-folder-name')!;
  const localFolderBtn = document.getElementById('local-folder-btn') as HTMLButtonElement;
  const saveBtn = document.getElementById('btn-save') as HTMLButtonElement;
  const saveStatus = document.getElementById('save-status')!;
  const maxConvosError = document.getElementById('max-convos-error')!;

  maxConvosInput.value = String(settings.display.maxConversationsPerPlatform);
  captureUserChk.checked = settings.capture.roles.includes('user');
  captureAssistantChk.checked = settings.capture.roles.includes('assistant');
  autoExportToggle.checked = settings.export.autoExport;

  function applyFolderDisplay(name: string | null): void {
    if (name) {
      localFolderName.textContent = name;
      localFolderName.classList.remove('unset');
      localFolderBtn.textContent = 'Change';
    } else {
      localFolderName.textContent = 'No folder selected';
      localFolderName.classList.add('unset');
      localFolderBtn.textContent = 'Choose';
    }
  }

  const savedHandle = await getExportDir();
  applyFolderDisplay(savedHandle ? (settings.export.local.folderName ?? savedHandle.name) : null);

  localFolderBtn.addEventListener('click', async () => {
    try {
      const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
      await saveExportDir(dir);
      applyFolderDisplay(dir.name);
      const current = await getSettings();
      current.export.local.folderName = dir.name;
      await saveSettings(current);
    } catch { /* user cancelled */ }
  });

  function clearErrors(): void {
    maxConvosInput.classList.remove('invalid');
    maxConvosError.hidden = true; maxConvosError.textContent = '';
    captureRolesError.hidden = true; captureRolesError.textContent = '';
  }

  saveBtn.addEventListener('click', async () => {
    clearErrors();
    const captureRoles: ('user' | 'assistant')[] = [
      ...(captureUserChk.checked ? ['user' as const] : []),
      ...(captureAssistantChk.checked ? ['assistant' as const] : []),
    ];
    const draft: AppSettings = {
      ...DEFAULT_SETTINGS,
      display: { maxConversationsPerPlatform: parseInt(maxConvosInput.value, 10) },
      capture: { roles: captureRoles },
      export: {
        defaultMethod: 'local', autoExport: autoExportToggle.checked,
        local: { folderName: settings.export.local.folderName },
        s3: { bucket: '', prefix: '', region: '' },
      },
    };
    const current = await getSettings();
    draft.export.local.folderName = current.export.local.folderName;
    const errors = validateSettings(draft);
    if (errors.length > 0) {
      for (const err of errors) {
        if (err.field === 'display.maxConversationsPerPlatform') {
          maxConvosInput.classList.add('invalid');
          maxConvosError.textContent = err.message; maxConvosError.hidden = false;
        }
        if (err.field === 'capture.roles') {
          captureRolesError.textContent = err.message; captureRolesError.hidden = false;
        }
      }
      saveStatus.textContent = 'Fix the errors above.';
      saveStatus.className = 'save-status error';
      return;
    }
    await saveSettings(draft);
    saveStatus.textContent = 'Saved.';
    saveStatus.className = 'save-status success';
    setTimeout(() => { saveStatus.textContent = ''; saveStatus.className = 'save-status'; }, 2500);
  });

  try {
    const { bytesUsed, quota } = await getStorageStats();
    if (quota > 0) {
      const pct = Math.min(100, (bytesUsed / quota) * 100);
      const barEl = document.getElementById('storage-bar')!;
      barEl.style.width = `${pct.toFixed(1)}%`;
      if (pct >= 90) barEl.classList.add('danger');
      else if (pct >= 70) barEl.classList.add('warn');
      document.getElementById('storage-stats-text')!.textContent =
        `${(bytesUsed / 1024 / 1024).toFixed(1)} MB used of ${(quota / 1024 / 1024).toFixed(0)} MB (${pct.toFixed(1)}%)`;
      document.getElementById('storage-stats')!.hidden = false;
    }
  } catch { /* unavailable */ }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchView(tab.dataset.view as View));
  });

  initConversationsView();

  // Load data — if this fails, still fall through so settings/export views initialize
  try {
    await Promise.all([loadFavorites(), loadConversations()]);
  } catch (err) {
    console.error('[recall] failed to load conversations/favorites:', err);
  }
  renderConvList();

  // Init other views — always runs regardless of conversation load outcome
  void initExportView().catch((e) => console.error('[recall] export init failed:', e));
  void initSettingsView().catch((e) => console.error('[recall] settings init failed:', e));
}

void main();
