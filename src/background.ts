import { getSettings } from './shared/settings';
import { getExportDir } from './shared/idb';
import type {
  CaptureMessagePayload,
  Conversation,
  ConversationsIndex,
  ExportRecord,
  ExtensionMessage,
  Meta,
} from './shared/types';

const MAX_CONVERSATIONS = 100;
const KEY_INDEX = 'conversations';
const KEY_META = 'meta';
const ALARM_NAME = 'autoExport';
const convKey = (id: string) => `conv:${id}`;

// ── Serial queue ──────────────────────────────────────────────────────────────
// Prevents concurrent storage read/write races when many messages arrive at once.

let queue: Promise<void> = Promise.resolve();
function enqueue(fn: () => Promise<void>): void {
  queue = queue.then(fn).catch((err) => console.error('[recall] error:', err));
}

// ── Message capture ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, _sendResponse) => {
    if (message.type === 'CAPTURE_MESSAGE') {
      enqueue(() => handleCapture(message));
    }
  },
);

async function handleCapture(payload: CaptureMessagePayload): Promise<void> {
  const { conversationId, platform, url, title, message } = payload;

  const settings = await getSettings();
  if (!settings.capture.roles.includes(message.role)) return;

  const now = Date.now();

  const index = await getIndex();
  let conv = await getConversation(conversationId);

  if (!conv) {
    const existingId = await findConvIdByUrl(index, url);
    if (existingId) conv = await getConversation(existingId);
  }

  if (!conv) {
    conv = { id: conversationId, platform, url, title, messages: [], createdAt: now, updatedAt: now };
  }

  const isDuplicate = conv.messages.some(
    (m) => m.role === message.role && m.content === message.content,
  );
  if (isDuplicate) return;

  const newMessage = { ...message, id: crypto.randomUUID(), seq: conv.messages.length };
  conv.messages.push(newMessage);
  conv.updatedAt = now;
  conv.title = title || conv.title;
  conv.url = url;

  if (!index.ids.includes(conv.id)) index.ids.push(conv.id);

  const evicted = index.ids.splice(0, Math.max(0, index.ids.length - MAX_CONVERSATIONS));
  if (evicted.length > 0) await chrome.storage.local.remove(evicted.map(convKey));

  const meta = await getMeta();
  await chrome.storage.local.set({
    [convKey(conv.id)]: conv,
    [KEY_INDEX]: index,
    [KEY_META]: { version: 1, lastUpdated: now, lastExportedAt: meta?.lastExportedAt ?? 0 },
  });

  console.log(`[recall] stored msg ${newMessage.id} seq=${newMessage.seq} conv=${conv.id}`);
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

chrome.runtime.onInstalled.addListener(() => { void scheduleAutoExportAlarm(); });
chrome.runtime.onStartup.addListener(() => { void scheduleAutoExportAlarm(); });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    enqueue(runAutoExport);
  }
});

async function runAutoExport(): Promise<void> {
  const settings = await getSettings();
  if (!settings.export.autoExport) return;
  if (settings.export.defaultMethod !== 'local') return; // only local supported currently

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
}

// ── Export helpers (shared with popup via duplication) ────────────────────────

async function collectNewRecords(): Promise<ExportRecord[]> {
  const meta = await getMeta();
  const cursor = meta?.lastExportedAt ?? 0;
  const index = await getIndex();
  if (index.ids.length === 0) return [];

  const keys = index.ids.map(convKey);
  const result = await chrome.storage.local.get(keys);
  const records: ExportRecord[] = [];

  for (const id of index.ids) {
    const conv = result[convKey(id)] as Conversation | undefined;
    if (!conv) continue;
    for (const msg of conv.messages) {
      if (msg.capturedAt > cursor) {
        records.push({
          id: msg.id, conversationId: conv.id, platform: conv.platform,
          url: conv.url, title: conv.title, role: msg.role,
          content: msg.content, capturedAt: msg.capturedAt, seq: msg.seq,
        });
      }
    }
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
  const keys = index.ids.map(convKey);
  const result = await chrome.storage.local.get(keys);
  for (const id of index.ids) {
    const conv = result[convKey(id)] as Conversation | undefined;
    if (conv?.url === url) return id;
  }
  return null;
}

export async function getIndex(): Promise<ConversationsIndex> {
  const result = await chrome.storage.local.get(KEY_INDEX);
  return (result[KEY_INDEX] as ConversationsIndex | undefined) ?? { ids: [] };
}

export async function getConversation(id: string): Promise<Conversation | undefined> {
  const result = await chrome.storage.local.get(convKey(id));
  return result[convKey(id)] as Conversation | undefined;
}

export async function getMeta(): Promise<Meta | undefined> {
  const result = await chrome.storage.local.get(KEY_META);
  return result[KEY_META] as Meta | undefined;
}
