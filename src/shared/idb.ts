// IndexedDB helpers for Recall.
//
// DB: 'recall', version 4
//   Store 'handles'       — FileSystemDirectoryHandle  (key: 'exportDir')
//   Store 'conversations' — ConversationMeta           (key: id)
//   Store 'messages'      — StoredMessage              (key: id)
//                           indexes: conversationId, capturedAt, platform
//                           favorite field scanned in-memory (booleans not valid IDB keys)

import type { ConversationMeta, StoredMessage } from './types';

const DB_NAME = 'recall';
const DB_VERSION = 4;
const STORE_HANDLES = 'handles';
const STORE_CONVS = 'conversations';
const STORE_MESSAGES = 'messages';
const KEY_EXPORT_DIR = 'exportDir';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = (event as IDBVersionChangeEvent).oldVersion;

      if (oldVersion < 1) {
        db.createObjectStore(STORE_HANDLES);
      }
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(STORE_CONVS)) {
          db.createObjectStore(STORE_CONVS);
        }
      }
      if (oldVersion < 3) {
        const msgStore = db.createObjectStore(STORE_MESSAGES);
        msgStore.createIndex('conversationId', 'conversationId', { unique: false });
        msgStore.createIndex('capturedAt', 'capturedAt', { unique: false });
        msgStore.createIndex('platform', 'platform', { unique: false });
      }
      if (oldVersion < 4) {
        // v4: favorite field added to StoredMessage. No schema change needed —
        // getFavoriteMessages uses a full scan since boolean is not a valid IDB key type.
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── FileSystemDirectoryHandle ─────────────────────────────────────────────────

export async function saveExportDir(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HANDLES, 'readwrite');
    tx.objectStore(STORE_HANDLES).put(handle, KEY_EXPORT_DIR);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getExportDir(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HANDLES, 'readonly');
    const req = tx.objectStore(STORE_HANDLES).get(KEY_EXPORT_DIR);
    req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
    req.onerror = () => reject(req.error);
  });
}

// ── ConversationMeta ──────────────────────────────────────────────────────────

export async function saveConversationMeta(meta: ConversationMeta): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CONVS, 'readwrite');
    tx.objectStore(STORE_CONVS).put(meta, meta.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getConversationMeta(id: string): Promise<ConversationMeta | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CONVS, 'readonly');
    const req = tx.objectStore(STORE_CONVS).get(id);
    req.onsuccess = () => resolve(req.result as ConversationMeta | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function getConversationMetas(ids: string[]): Promise<ConversationMeta[]> {
  if (ids.length === 0) return [];
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CONVS, 'readonly');
    const store = tx.objectStore(STORE_CONVS);
    const results: (ConversationMeta | undefined)[] = new Array(ids.length);
    let pending = ids.length;
    ids.forEach((id, i) => {
      const req = store.get(id);
      req.onsuccess = () => {
        results[i] = req.result as ConversationMeta | undefined;
        if (--pending === 0) {
          resolve(results.filter((c): c is ConversationMeta => c !== undefined));
        }
      };
      req.onerror = () => reject(req.error);
    });
  });
}

export async function deleteConversationMetas(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CONVS, 'readwrite');
    const store = tx.objectStore(STORE_CONVS);
    for (const id of ids) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Messages ──────────────────────────────────────────────────────────────────

export async function saveMessage(msg: StoredMessage): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MESSAGES, 'readwrite');
    tx.objectStore(STORE_MESSAGES).put(msg, msg.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Returns all messages for a conversation, sorted by seq. */
export async function getMessagesByConversation(conversationId: string): Promise<StoredMessage[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MESSAGES, 'readonly');
    const index = tx.objectStore(STORE_MESSAGES).index('conversationId');
    const req = index.getAll(IDBKeyRange.only(conversationId));
    req.onsuccess = () =>
      resolve((req.result as StoredMessage[]).sort((a, b) => a.seq - b.seq));
    req.onerror = () => reject(req.error);
  });
}

/** Returns all messages with capturedAt strictly after the cursor. Used for incremental export. */
export async function getMessagesAfterCursor(cursor: number): Promise<StoredMessage[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MESSAGES, 'readonly');
    const index = tx.objectStore(STORE_MESSAGES).index('capturedAt');
    const req = index.getAll(IDBKeyRange.lowerBound(cursor, true));
    req.onsuccess = () => resolve(req.result as StoredMessage[]);
    req.onerror = () => reject(req.error);
  });
}

/** Returns all favorited messages across all conversations. */
export async function getFavoriteMessages(): Promise<StoredMessage[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MESSAGES, 'readonly');
    const req = tx.objectStore(STORE_MESSAGES).getAll();
    req.onsuccess = () => resolve((req.result as StoredMessage[]).filter((m) => m.favorite === true));
    req.onerror = () => reject(req.error);
  });
}

/** Sets or clears the favorite flag on a message. */
export async function setMessageFavorite(id: string, favorite: boolean): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MESSAGES, 'readwrite');
    const store = tx.objectStore(STORE_MESSAGES);
    const req = store.get(id);
    req.onsuccess = () => {
      const msg = req.result as StoredMessage | undefined;
      if (!msg) { resolve(); return; }
      if (favorite) {
        msg.favorite = true;
      } else {
        delete msg.favorite;
      }
      store.put(msg, msg.id);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Deletes all messages belonging to the given conversation IDs. Used during eviction. */
export async function deleteMessagesByConversations(conversationIds: string[]): Promise<void> {
  if (conversationIds.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MESSAGES, 'readwrite');
    const index = tx.objectStore(STORE_MESSAGES).index('conversationId');
    let pending = conversationIds.length;
    const done = () => { if (--pending === 0) { /* tx will complete */ } };
    for (const convId of conversationIds) {
      const req = index.openCursor(IDBKeyRange.only(convId));
      req.onsuccess = () => {
        const cursor = req.result as IDBCursorWithValue | null;
        if (cursor) { cursor.delete(); cursor.continue(); }
        else done();
      };
      req.onerror = () => reject(req.error);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Migration: chrome.storage.local → IDB conversations (v2 legacy) ──────────
// Moves any conv:{id} entries still in chrome.storage.local into the conversations store.
// Idempotent — safe to call on every startup.

export async function migrateConversationsFromStorage(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const legacyKeys = Object.keys(all).filter((k) => k.startsWith('conv:'));
  if (legacyKeys.length === 0) return;

  const db = await openDB();

  // Each legacy entry is an old Conversation object with an embedded messages array.
  // Split into ConversationMeta + individual StoredMessage records.
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_CONVS, STORE_MESSAGES], 'readwrite');
    const convStore = tx.objectStore(STORE_CONVS);
    const msgStore = tx.objectStore(STORE_MESSAGES);

    for (const key of legacyKeys) {
      const conv = all[key] as any;
      const messages: any[] = Array.isArray(conv.messages) ? conv.messages : [];

      const meta: ConversationMeta = {
        id: conv.id,
        platform: conv.platform,
        url: conv.url,
        title: conv.title,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        messageCount: messages.length,
      };
      convStore.put(meta, meta.id);

      for (const msg of messages) {
        const stored: StoredMessage = {
          id: msg.id,
          conversationId: conv.id,
          platform: conv.platform,
          seq: msg.seq,
          role: msg.role,
          content: msg.content,
          capturedAt: msg.capturedAt,
        };
        msgStore.put(stored, stored.id);
      }
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  await chrome.storage.local.remove(legacyKeys);
  console.log(`[recall] migrated ${legacyKeys.length} conversations from chrome.storage → IDB`);
}

// ── Migration: IDB conversations with embedded messages → flat messages store ─
// Handles users who were on the v2 IDB schema (conversations stored as objects
// with a messages array rather than as flat ConversationMeta records).
// Idempotent — detects old format by presence of a messages array field.

export async function migrateMessagesToFlatStore(): Promise<void> {
  const db = await openDB();

  const allConvs = await new Promise<any[]>((resolve, reject) => {
    const tx = db.transaction(STORE_CONVS, 'readonly');
    const req = tx.objectStore(STORE_CONVS).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const toMigrate = allConvs.filter((c) => Array.isArray(c.messages));
  if (toMigrate.length === 0) return;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_CONVS, STORE_MESSAGES], 'readwrite');
    const convStore = tx.objectStore(STORE_CONVS);
    const msgStore = tx.objectStore(STORE_MESSAGES);

    for (const conv of toMigrate) {
      const messages: any[] = conv.messages;

      const meta: ConversationMeta = {
        id: conv.id,
        platform: conv.platform,
        url: conv.url,
        title: conv.title,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        messageCount: messages.length,
      };
      convStore.put(meta, meta.id);

      for (const msg of messages) {
        const stored: StoredMessage = {
          id: msg.id,
          conversationId: conv.id,
          platform: conv.platform,
          seq: msg.seq,
          role: msg.role,
          content: msg.content,
          capturedAt: msg.capturedAt,
        };
        msgStore.put(stored, stored.id);
      }
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  console.log(`[recall] migrated ${toMigrate.length} conversations to flat message store`);
}

// ── Storage stats ─────────────────────────────────────────────────────────────

export async function getStorageStats(): Promise<{ bytesUsed: number; quota: number }> {
  const estimate = await navigator.storage.estimate();
  return {
    bytesUsed: estimate.usage ?? 0,
    quota: estimate.quota ?? 0,
  };
}
