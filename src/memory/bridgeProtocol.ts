import type { ExportRecord, Platform } from '../shared/types';

export const BRIDGE_HOST_NAME = 'com.recall.bridge';
export const BRIDGE_PROTOCOL_VERSION = 1;

export interface SearchOpts {
  limit?: number;
  platforms?: Platform[];
  since?: number;
  until?: number;
  role?: 'user' | 'assistant';
}

export type BridgeRequest =
  | { id: string; type: 'ping' }
  | { id: string; type: 'capabilities' }
  | { id: string; type: 'ingest'; rebuild?: boolean }
  | { id: string; type: 'search'; query: string; opts?: SearchOpts }
  | { id: string; type: 'conversation'; conversationId: string }
  | { id: string; type: 'set-backend'; backend: 'mempalace' | 'gbrain' | 'mock' };

export interface Capabilities {
  protocolVersion: number;
  bridgeVersion: string;
  backend: 'mempalace' | 'gbrain' | 'mock';
  backendVersion: string;
  features: { semantic: boolean; keyword: boolean; filters: string[] };
}

export interface SearchHit {
  record: ExportRecord;
  score: number;
  snippet: string;
  matchedBy: 'keyword' | 'semantic' | 'both';
}

export interface BridgeError {
  code: string;
  message: string;
}

export type BridgeResponse =
  | { id: string; ok: true; type: 'ping'; data: { now: number } }
  | { id: string; ok: true; type: 'capabilities'; data: Capabilities }
  | { id: string; ok: true; type: 'ingest'; data: { ingested: number; skipped: number; durationMs: number } }
  | { id: string; ok: true; type: 'search'; data: { hits: SearchHit[] } }
  | { id: string; ok: true; type: 'conversation'; data: { records: ExportRecord[] } }
  | { id: string; ok: true; type: 'set-backend'; data: { backend: string; backendVersion: string } }
  | { id: string; ok: false; error: BridgeError };

export type BridgeStatus = 'unknown' | 'not-installed' | 'ready' | 'error';
