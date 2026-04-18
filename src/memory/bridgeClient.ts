import {
  BRIDGE_HOST_NAME,
  type BridgeRequest,
  type BridgeResponse,
  type BridgeStatus,
  type Capabilities,
  type SearchHit,
  type SearchOpts,
} from './bridgeProtocol';
import type { ExportRecord } from '../shared/types';

type Pending = { resolve: (r: BridgeResponse) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> };

let port: chrome.runtime.Port | null = null;
let status: BridgeStatus = 'unknown';
const pending = new Map<string, Pending>();

function onMessage(response: BridgeResponse) {
  const entry = pending.get(response.id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(response.id);
  entry.resolve(response);
}

function onDisconnect() {
  const err = chrome.runtime.lastError;
  const msg = err?.message ?? '';
  console.error(`[recall] bridge disconnected: "${msg}"`);
  status = msg.includes('not found') || msg.includes('Native host has exited') || msg.includes('not installed')
    ? 'not-installed'
    : 'error';
  port = null;
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject({ code: 'DISCONNECTED', message: msg });
    pending.delete(id);
  }
}

function ensureConnected(): chrome.runtime.Port {
  if (port) return port;
  port = chrome.runtime.connectNative(BRIDGE_HOST_NAME);
  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(onDisconnect);
  status = 'unknown';
  return port;
}

function send<T extends BridgeResponse>(req: BridgeRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const p = ensureConnected();
    const timer = setTimeout(() => {
      pending.delete(req.id);
      reject({ code: 'TIMEOUT', message: `request ${req.id} timed out` });
    }, 10_000);
    pending.set(req.id, { resolve: resolve as (r: BridgeResponse) => void, reject, timer });
    p.postMessage(req);
  });
}

export async function ping(): Promise<boolean> {
  try {
    const res = await send({ id: crypto.randomUUID(), type: 'ping' });
    if (res.ok) status = 'ready';
    console.log(`[recall] bridge ping result: ok=${res.ok}, status=${status}`);
    return res.ok;
  } catch (err) {
    console.error('[recall] bridge ping failed:', err);
    return false;
  }
}

export async function getCapabilities(): Promise<Capabilities | null> {
  try {
    const res = await send({ id: crypto.randomUUID(), type: 'capabilities' });
    if (res.ok && res.type === 'capabilities') return res.data;
    return null;
  } catch {
    return null;
  }
}

export async function search(query: string, opts?: SearchOpts): Promise<SearchHit[]> {
  const res = await send({ id: crypto.randomUUID(), type: 'search', query, opts });
  if (res.ok && res.type === 'search') return res.data.hits;
  if (!res.ok) throw res.error;
  return [];
}

export async function getConversation(conversationId: string): Promise<ExportRecord[]> {
  const res = await send({ id: crypto.randomUUID(), type: 'conversation', conversationId });
  if (res.ok && res.type === 'conversation') return res.data.records;
  if (!res.ok) throw res.error;
  return [];
}

export async function setBackend(backend: 'mempalace' | 'gbrain' | 'mock'): Promise<{ backend: string; backendVersion: string }> {
  const res = await send({ id: crypto.randomUUID(), type: 'set-backend', backend });
  if (res.ok && res.type === 'set-backend') return res.data;
  if (!res.ok) throw res.error;
  return { backend, backendVersion: 'unknown' };
}

export async function ingest(rebuild?: boolean): Promise<{ ingested: number; skipped: number; durationMs: number }> {
  const res = await send({ id: crypto.randomUUID(), type: 'ingest', rebuild });
  if (res.ok && res.type === 'ingest') return res.data;
  if (!res.ok) throw res.error;
  return { ingested: 0, skipped: 0, durationMs: 0 };
}

export function getStatus(): BridgeStatus {
  return status;
}
