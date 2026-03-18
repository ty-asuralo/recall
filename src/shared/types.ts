export type Platform = 'claude' | 'chatgpt' | 'gemini';

export interface Message {
  id: string;          // UUID — stable identity for dedup across exports
  seq: number;         // 0-indexed position within the conversation
  role: 'user' | 'assistant';
  content: string;
  capturedAt: number;  // Unix ms — used as incremental export cursor
}

export interface Conversation {
  id: string;
  platform: Platform;
  url: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

// chrome.storage.local layout:
//   "conversations" → ConversationsIndex
//   "conv:{id}"     → Conversation
//   "meta"          → Meta
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

export type ExtensionMessage = CaptureMessagePayload;
