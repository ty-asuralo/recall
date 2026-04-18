import * as bridgeClient from './memory/bridgeClient';
import { getSettings } from './shared/settings';
import {
  deleteConversationMetas,
  deleteMessagesByConversations,
  getConversationMeta,
  getConversationMetas,
  getExportDir,
  getMessagesByConversation,
  getMessagesAfterCursor,
  migrateConversationsFromStorage,
  migrateMessagesToFlatStore,
  saveConversationMeta,
  saveMessage,
  setMessageFavorite,
} from './shared/idb';
import type {
  CaptureMessagePayload,
  ConversationMeta,
  ConversationsIndex,
  ExportRecord,
  ExtensionMessage,
  GetFavoritesPayload,
  Meta,
  StoredMessage,
  ToggleFavoritePayload,
} from './shared/types';

const MAX_CONVERSATIONS = 100;
const KEY_INDEX = 'conversations';
const KEY_META = 'meta';
const ALARM_NAME = 'autoExport';

// ── Serial queue ──────────────────────────────────────────────────────────────
// Prevents concurrent storage read/write races when many messages arrive at once.

let queue: Promise<void> = Promise.resolve();
function enqueue(fn: () => Promise<void>): void {
  queue = queue.then(fn).catch((err) => console.error('[recall] error:', err));
}

// ── Message capture ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    if (message.type === 'CAPTURE_MESSAGE') {
      enqueue(() => handleCapture(message));
      return false;
    }
    if (message.type === 'TOGGLE_FAVORITE') {
      handleToggleFavorite(message)
        .then((res) => sendResponse(res))
        .catch((err) => {
          console.error('[recall] toggle favorite error:', err);
          sendResponse({ favorited: false });
        });
      return true; // keep message channel open for async sendResponse
    }
    if (message.type === 'GET_FAVORITES') {
      handleGetFavorites(message)
        .then((res) => sendResponse(res))
        .catch(() => sendResponse({ contents: [] }));
      return true;
    }
    if (message.type === 'SEARCH_QUERY') {
      bridgeClient.search(message.query, message.opts)
        .then((hits) => sendResponse({ ok: true, hits }))
        .catch((error) => sendResponse({ ok: false, error }));
      return true;
    }
    if (message.type === 'GET_CONVERSATION_FULL') {
      bridgeClient.getConversation(message.conversationId)
        .then((records) => sendResponse({ ok: true, records }))
        .catch((error) => sendResponse({ ok: false, error }));
      return true;
    }
    if (message.type === 'TRIGGER_INGEST') {
      bridgeClient.ingest(message.rebuild)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => sendResponse({ ok: false, error }));
      return true;
    }
    if (message.type === 'SET_BACKEND') {
      bridgeClient.setBackend(message.backend)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => sendResponse({ ok: false, error }));
      return true;
    }
    if (message.type === 'GET_BRIDGE_STATUS') {
      bridgeClient.ping()
        .then(async (ok) => {
          const status = bridgeClient.getStatus();
          const capabilities = ok ? await bridgeClient.getCapabilities().catch(() => null) : null;
          sendResponse({ ok, status, capabilities });
        })
        .catch(() => {
          sendResponse({ ok: false, status: bridgeClient.getStatus() });
        });
      return true;
    }
  },
);

async function handleCapture(payload: CaptureMessagePayload): Promise<void> {
  const { conversationId, platform, url, title, message } = payload;

  const settings = await getSettings();
  if (!settings.capture.roles.includes(message.role)) return;

  const now = Date.now();
  const index = await getIndex();

  let meta = await getConversationMeta(conversationId);

  if (!meta) {
    const existingId = await findConvIdByUrl(index, url);
    if (existingId) meta = await getConversationMeta(existingId);
  }

  if (!meta) {
    meta = { id: conversationId, platform, url, title, createdAt: now, updatedAt: now, messageCount: 0 };
  }

  // Dedup: check existing messages for this conversation
  const existing = await getMessagesByConversation(meta.id);
  const isDuplicate = existing.some(
    (m) => m.role === message.role && m.content === message.content,
  );
  if (isDuplicate) return;

  const newMessage: StoredMessage = {
    id: crypto.randomUUID(),
    conversationId: meta.id,
    platform: meta.platform,
    seq: meta.messageCount,
    role: message.role,
    content: message.content,
    capturedAt: message.capturedAt,
  };

  meta.messageCount += 1;
  meta.updatedAt = now;
  meta.title = title || meta.title;
  meta.url = url;

  if (!index.ids.includes(meta.id)) index.ids.push(meta.id);

  const evicted = index.ids.splice(0, Math.max(0, index.ids.length - MAX_CONVERSATIONS));
  if (evicted.length > 0) {
    await deleteConversationMetas(evicted);
    await deleteMessagesByConversations(evicted);
  }

  const storedMeta = await getMeta();
  await saveConversationMeta(meta);
  await saveMessage(newMessage);
  await chrome.storage.local.set({
    [KEY_INDEX]: index,
    [KEY_META]: { version: 1, lastUpdated: now, lastExportedAt: storedMeta?.lastExportedAt ?? 0 },
  });

  console.log(`[recall] stored msg ${newMessage.id} seq=${newMessage.seq} conv=${meta.id}`);
}

// ── Favorite toggle ───────────────────────────────────────────────────────────

async function handleToggleFavorite(
  payload: ToggleFavoritePayload,
): Promise<{ favorited: boolean }> {
  const { conversationId, platform, role, content } = payload;
  const messages = await getMessagesByConversation(conversationId);
  let msg = messages.find((m) => m.role === role && m.content === content);

  if (!msg) {
    // Message not captured by extractor yet (e.g. content mismatch or extractor
    // hasn't run). Create a stub so the user can favorite it immediately.
    const now = Date.now();
    msg = {
      id: crypto.randomUUID(),
      conversationId,
      platform,
      seq: messages.length,
      role,
      content,
      capturedAt: now,
    };
    await saveMessage(msg);
    console.log(`[recall] toggle favorite: created stub message ${msg.id} for conv ${conversationId}`);
  }

  const nowFavorited = !msg.favorite;
  await setMessageFavorite(msg.id, nowFavorited);
  console.log(`[recall] favorite ${nowFavorited ? 'set' : 'cleared'} for msg ${msg.id}`);
  return { favorited: nowFavorited };
}

async function handleGetFavorites(
  payload: GetFavoritesPayload,
): Promise<{ contents: string[] }> {
  const messages = await getMessagesByConversation(payload.conversationId);
  const contents = messages.filter((m) => m.favorite === true).map((m) => m.content);
  return { contents };
}

// ── Auto export alarm ─────────────────────────────────────────────────────────

function nextAlarmAt(): number {
  const now = new Date();
  const target = new Date(now);
  target.setHours(23, 59, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

async function scheduleAutoExportAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(ALARM_NAME, {
      when: nextAlarmAt(),
      periodInMinutes: 24 * 60,
    });
    console.log('[recall] auto-export alarm scheduled for', new Date(nextAlarmAt()).toLocaleString());
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  void scheduleAutoExportAlarm();
  void migrateConversationsFromStorage();
  void migrateMessagesToFlatStore();
  if (details.reason === 'install') {
    void chrome.windows.create({
      url: chrome.runtime.getURL('popup/onboarding.html'),
      type: 'popup',
      width: 520,
      height: 560,
    });
  }
});
chrome.runtime.onStartup.addListener(() => {
  void scheduleAutoExportAlarm();
  void migrateConversationsFromStorage();
  void migrateMessagesToFlatStore();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    enqueue(runAutoExport);
  }
});

async function runAutoExport(): Promise<void> {
  const settings = await getSettings();
  if (!settings.export.autoExport) return;
  if (settings.export.defaultMethod !== 'local') return;

  const records = await collectNewRecords();
  if (records.length === 0) {
    console.log('[recall] auto-export: no new messages');
    return;
  }

  const dir = await getExportDir();
  if (!dir) {
    console.warn('[recall] auto-export: no export folder configured');
    return;
  }

  const perm = await dir.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted') {
    console.warn('[recall] auto-export: folder permission not granted — open the export popup to re-authorize');
    return;
  }

  const written = await writeExportFiles(dir, records);
  await advanceExportCursor();
  console.log('[recall] auto-export complete:', written.join(', '));
  bridgeClient.ingest().catch(() => {});
}

// ── Export helpers ────────────────────────────────────────────────────────────

async function collectNewRecords(): Promise<ExportRecord[]> {
  const meta = await getMeta();
  const cursor = meta?.lastExportedAt ?? 0;

  const messages = await getMessagesAfterCursor(cursor);
  if (messages.length === 0) return [];

  // Join with ConversationMeta to get url + title for each message
  const convIds = [...new Set(messages.map((m) => m.conversationId))];
  const convMetas = await getConversationMetas(convIds);
  const convMap = new Map(convMetas.map((c) => [c.id, c]));

  const records: ExportRecord[] = [];
  for (const msg of messages) {
    const conv = convMap.get(msg.conversationId);
    if (!conv) continue;
    records.push({
      id: msg.id,
      conversationId: msg.conversationId,
      platform: msg.platform,
      url: conv.url,
      title: conv.title,
      role: msg.role,
      content: msg.content,
      capturedAt: msg.capturedAt,
      seq: msg.seq,
    });
  }

  return records.sort((a, b) => a.capturedAt - b.capturedAt || a.seq - b.seq);
}

async function advanceExportCursor(): Promise<void> {
  const meta = await getMeta();
  const now = Date.now();
  await chrome.storage.local.set({
    [KEY_META]: { version: 1, lastUpdated: meta?.lastUpdated ?? now, lastExportedAt: now },
  });
}

async function writeExportFiles(
  rootDir: FileSystemDirectoryHandle,
  records: ExportRecord[],
): Promise<string[]> {
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

// ── Storage helpers ───────────────────────────────────────────────────────────

async function findConvIdByUrl(index: ConversationsIndex, url: string): Promise<string | null> {
  if (index.ids.length === 0) return null;
  const metas = await getConversationMetas(index.ids);
  return metas.find((c) => c.url === url)?.id ?? null;
}

export async function getIndex(): Promise<ConversationsIndex> {
  const result = await chrome.storage.local.get(KEY_INDEX);
  return (result[KEY_INDEX] as ConversationsIndex | undefined) ?? { ids: [] };
}

export async function getMeta(): Promise<Meta | undefined> {
  const result = await chrome.storage.local.get(KEY_META);
  return result[KEY_META] as Meta | undefined;
}
