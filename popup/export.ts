import { getSettings } from '../src/shared/settings';
import type { ExportRecord, Meta } from '../src/shared/types';
import { getConversationMetas, getExportDir, getMessagesAfterCursor } from './idb';

async function collectNewRecords(): Promise<ExportRecord[]> {
  const result = await chrome.storage.local.get('meta');
  const meta = result['meta'] as Meta | undefined;
  const cursor = meta?.lastExportedAt ?? 0;

  const messages = await getMessagesAfterCursor(cursor);
  if (messages.length === 0) return [];

  // Join with ConversationMeta to get url + title
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
  const result = await chrome.storage.local.get('meta');
  const meta = result['meta'] as Meta | undefined;
  const now = Date.now();
  await chrome.storage.local.set({
    meta: { version: 1, lastUpdated: meta?.lastUpdated ?? now, lastExportedAt: now },
  });
}

async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts = { mode: 'readwrite' as const };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
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

function showWarning(msg: string, onLinkClick?: () => void): void {
  const el = document.getElementById('warning')!;
  const text = document.getElementById('warning-text')!;
  el.hidden = false;
  if (onLinkClick) {
    text.innerHTML = `${msg} <a id="warning-link">Open Settings</a>`;
    document.getElementById('warning-link')!.addEventListener('click', onLinkClick);
  } else {
    text.textContent = msg;
  }
}

function hideWarning(): void {
  document.getElementById('warning')!.hidden = true;
}

function setStatus(msg: string, type: 'error' | 'success' | '' = ''): void {
  const el = document.getElementById('status')!;
  el.textContent = msg;
  el.className = `status${type ? ' ' + type : ''}`;
}

async function main(): Promise<void> {
  const confirmBtn = document.getElementById('btn-confirm') as HTMLButtonElement;
  const cancelBtn = document.getElementById('btn-cancel') as HTMLButtonElement;
  const localMeta = document.getElementById('local-meta')!;

  const settings = await getSettings();
  const dir = await getExportDir();

  // Show folder status under the local option
  if (settings.export.local.folderName && dir) {
    localMeta.textContent = `Folder: ${settings.export.local.folderName}`;
    localMeta.className = 'option-meta configured';
  } else if (settings.export.local.folderName && !dir) {
    localMeta.textContent = `Folder handle lost — re-select in Settings`;
    showWarning(
      'The export folder is no longer accessible.',
      () => chrome.windows.create({ url: chrome.runtime.getURL('popup/settings.html'), type: 'popup', width: 400, height: 520 }),
    );
  } else {
    localMeta.textContent = 'No folder configured';
    showWarning(
      'No export folder is configured yet.',
      () => chrome.windows.create({ url: chrome.runtime.getURL('popup/settings.html'), type: 'popup', width: 400, height: 520 }),
    );
  }

  cancelBtn.addEventListener('click', () => window.close());

  confirmBtn.addEventListener('click', async () => {
    hideWarning();
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Exporting…';

    try {
      // Re-read settings in case they changed
      const latestSettings = await getSettings();
      const exportDir = await getExportDir();

      if (!latestSettings.export.local.folderName || !exportDir) {
        showWarning(
          'No export folder configured.',
          () => chrome.windows.create({ url: chrome.runtime.getURL('popup/settings.html'), type: 'popup', width: 400, height: 520 }),
        );
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Export';
        return;
      }

      const permitted = await ensurePermission(exportDir);
      if (!permitted) {
        showWarning('Folder permission denied. Re-select it in Settings → Export.');
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Export';
        return;
      }

      const records = await collectNewRecords();
      if (records.length === 0) {
        setStatus('No new messages to export.');
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Export';
        return;
      }

      const written = await writeExportFiles(exportDir, records);
      await advanceExportCursor();

      setStatus(`Exported:\n${written.join('\n')}`, 'success');
      confirmBtn.textContent = 'Export';
      confirmBtn.disabled = false;
    } catch (err) {
      setStatus(`Export failed: ${String(err)}`, 'error');
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Export';
    }
  });
}

void main();
