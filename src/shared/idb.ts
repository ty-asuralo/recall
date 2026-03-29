// IndexedDB helpers for Recall.
//
// DB: 'recall', version 2
//   Store 'handles'       — FileSystemDirectoryHandle (not JSON-serializable)
//   Store 'conversations' — Conversation objects, keyed by conversation id

import type { Conversation } from './types';

const DB_NAME = 'recall';
const DB_VERSION = 2;
const STORE_HANDLES = 'handles';
const STORE_CONVS = 'conversations';
const KEY_EXPORT_DIR = 'exportDir';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_HANDLES)) {
        db.createObjectStore(STORE_HANDLES);
      }
      if (!db.objectStoreNames.contains(STORE_CONVS)) {
        db.createObjectStore(STORE_CONVS);
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

// ── Conversations ─────────────────────────────────────────────────────────────

export async function saveConversation(conv: Conversation): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CONVS, 'readwrite');
    tx.objectStore(STORE_CONVS).put(conv, conv.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getConversation(id: string): Promise<Conversation | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CONVS, 'readonly');
    const req = tx.objectStore(STORE_CONVS).get(id);
    req.onsuccess = () => resolve(req.result as Conversation | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function getConversations(ids: string[]): Promise<Conversation[]> {
  if (ids.length === 0) return [];
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CONVS, 'readonly');
    const store = tx.objectStore(STORE_CONVS);
    const results: (Conversation | undefined)[] = new Array(ids.length);
    let pending = ids.length;
    ids.forEach((id, i) => {
      const req = store.get(id);
      req.onsuccess = () => {
        results[i] = req.result as Conversation | undefined;
        if (--pending === 0) {
          resolve(results.filter((c): c is Conversation => c !== undefined));
        }
      };
      req.onerror = () => reject(req.error);
    });
  });
}

export async function deleteConversations(ids: string[]): Promise<void> {
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

// ── Migration ─────────────────────────────────────────────────────────────────
// Moves any conv:{id} entries still in chrome.storage.local into IndexedDB.
// Idempotent — safe to call on every startup. No-op once migration is complete.

export async function migrateConversationsFromStorage(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const legacyKeys = Object.keys(all).filter((k) => k.startsWith('conv:'));
  if (legacyKeys.length === 0) return;

  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_CONVS, 'readwrite');
    const store = tx.objectStore(STORE_CONVS);
    for (const key of legacyKeys) {
      const conv = all[key] as Conversation;
      store.put(conv, conv.id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  await chrome.storage.local.remove(legacyKeys);
  console.log(`[recall] migrated ${legacyKeys.length} conversations from chrome.storage → IndexedDB`);
}

// ── Storage stats ─────────────────────────────────────────────────────────────

export async function getStorageStats(): Promise<{ bytesUsed: number; quota: number }> {
  const estimate = await navigator.storage.estimate();
  return {
    bytesUsed: estimate.usage ?? 0,
    quota: estimate.quota ?? 0,
  };
}
