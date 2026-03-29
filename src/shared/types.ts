export type Platform = 'claude' | 'chatgpt' | 'gemini';

// ── Wire format (content script → background) ─────────────────────────────────

/**
 * Minimal message shape sent over chrome.runtime.sendMessage.
 * background assigns id + seq before persisting.
 */
export interface Message {
  id: string;          // UUID — stable identity for dedup across exports
  seq: number;         // 0-indexed position within the conversation
  role: 'user' | 'assistant';
  content: string;
  capturedAt: number;  // Unix ms — used as incremental export cursor
}

// ── Storage types (IndexedDB) ─────────────────────────────────────────────────

/**
 * Conversation metadata stored in the 'conversations' IDB store.
 * Does NOT contain messages — those live in the 'messages' store.
 */
export interface ConversationMeta {
  id: string;
  platform: Platform;
  url: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;  // denormalized — avoids loading messages just to show a count
}

/**
 * Flat message record stored in the 'messages' IDB store.
 * Indexed by conversationId, capturedAt, platform.
 * platform is denormalized so cross-conversation queries don't need a join.
 */
export interface StoredMessage {
  id: string;
  conversationId: string;
  platform: Platform;   // denormalized from ConversationMeta
  seq: number;
  role: 'user' | 'assistant';
  content: string;
  capturedAt: number;
  favorite?: boolean;   // sparse — only present when true; indexed for fast favorites query
}

/**
 * Assembled conversation — ConversationMeta + its messages.
 * Not stored directly; constructed on demand for display or export.
 */
export type Conversation = ConversationMeta & { messages: StoredMessage[] };

// ── Storage layout ────────────────────────────────────────────────────────────
// chrome.storage.local:
//   "conversations"  → ConversationsIndex  (ordered id list, max 100)
//   "meta"           → Meta
//   "settings"       → AppSettings
//
// IndexedDB 'recall' v3:
//   'handles'        → FileSystemDirectoryHandle  (key: 'exportDir')
//   'conversations'  → ConversationMeta           (key: id)
//   'messages'       → StoredMessage              (key: id, indexes: conversationId, capturedAt, platform)

export interface ConversationsIndex {
  ids: string[]; // oldest → newest, max 100
}

export interface Meta {
  version: number;
  lastUpdated: number;
  lastExportedAt: number; // 0 if never exported — incremental export cursor
}

export interface PlatformSelectors {
  messageContainer: string;
  userMessage: string;
  assistantMessage: string;
  streamingIndicator: string;
  /** Optional: child selector within a message element to narrow text extraction (avoids capturing button labels) */
  textContent?: string;
  /** Optional: selector for the action-button bar inside an assistant message element.
   *  When set, the star button is appended there (next to copy/like/dislike).
   *  Falls back to a div below the message if selector matches nothing. */
  actionBar?: string;
}

export interface SelectorsFile {
  claude: PlatformSelectors;
  chatgpt: PlatformSelectors;
  gemini: PlatformSelectors;
}

// Flat export record — self-contained, no joins needed downstream
export interface ExportRecord {
  id: string;
  conversationId: string;
  platform: Platform;
  url: string;
  title: string;
  role: 'user' | 'assistant';
  content: string;
  capturedAt: number;
  seq: number;
}

// ── App settings (stored under "settings" key in chrome.storage.local) ──────

export interface DisplaySettings {
  maxConversationsPerPlatform: number; // 1–50, default 10
}

export interface CaptureSettings {
  roles: ('user' | 'assistant')[]; // at least one required; default ['user']
}

export interface LocalExportSettings {
  folderName: string | null; // display name only — actual handle lives in IndexedDB
}

export interface S3ExportSettings {
  bucket: string;
  prefix: string;
  region: string;
}

export interface ExportSettings {
  defaultMethod: 'local' | 's3';
  autoExport: boolean;       // trigger export daily at 11:59 PM if new messages exist
  local: LocalExportSettings;
  s3: S3ExportSettings;
}

export interface AppSettings {
  version: number;
  display: DisplaySettings;
  capture: CaptureSettings;
  export: ExportSettings;
}

export interface SettingsValidationError {
  field: string;
  message: string;
}

// ── Chrome messages ───────────────────────────────────────────────────────────

// Messages passed via chrome.runtime.sendMessage from content → background
export interface CaptureMessagePayload {
  type: 'CAPTURE_MESSAGE';
  platform: Platform;
  conversationId: string;
  message: Omit<Message, 'id' | 'seq'>; // background assigns id + seq
  title: string;
  url: string;
}

/** Sent from content scripts when the user clicks the star button injected into the page. */
export interface ToggleFavoritePayload {
  type: 'TOGGLE_FAVORITE';
  platform: Platform;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string; // used to match the stored message by exact content
}

/** Sent from content scripts on load to hydrate star button state from IDB. */
export interface GetFavoritesPayload {
  type: 'GET_FAVORITES';
  conversationId: string;
}

export type ExtensionMessage = CaptureMessagePayload | ToggleFavoritePayload | GetFavoritesPayload;
