import { DEFAULT_SETTINGS, getSettings, saveSettings, validateSettings } from '../src/shared/settings';
import type { AppSettings } from '../src/shared/types';
import { getExportDir, saveExportDir } from './idb';

async function main(): Promise<void> {
  const settings = await getSettings();

  // ── Display ──────────────────────────────────────────────────────────────

  const maxConvosInput = document.getElementById('max-convos') as HTMLInputElement;
  maxConvosInput.value = String(settings.display.maxConversationsPerPlatform);

  // ── Export: auto export toggle ────────────────────────────────────────────

  const autoExportToggle = document.getElementById('auto-export-enabled') as HTMLInputElement;
  autoExportToggle.checked = settings.export.autoExport;

  // ── Export: local ─────────────────────────────────────────────────────────

  const localFolderName = document.getElementById('local-folder-name')!;
  const localFolderBtn = document.getElementById('local-folder-btn') as HTMLButtonElement;

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

  // Restore folder name from settings, and verify handle still exists in IndexedDB
  const savedHandle = await getExportDir();
  const effectiveName = savedHandle ? (settings.export.local.folderName ?? savedHandle.name) : null;
  applyFolderDisplay(effectiveName);

  localFolderBtn.addEventListener('click', async () => {
    try {
      const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
      await saveExportDir(dir);
      applyFolderDisplay(dir.name);
      // Immediately persist folder name into settings so Export popup can read it
      const current = await getSettings();
      current.export.local.folderName = dir.name;
      await saveSettings(current);
    } catch {
      // user cancelled
    }
  });

  // ── Save ──────────────────────────────────────────────────────────────────

  const saveBtn = document.getElementById('btn-save') as HTMLButtonElement;
  const saveStatus = document.getElementById('save-status')!;
  const maxConvosError = document.getElementById('max-convos-error')!;

  function clearErrors(): void {
    maxConvosInput.classList.remove('invalid');
    maxConvosError.hidden = true;
    maxConvosError.textContent = '';
  }

  function showStatus(msg: string, type: 'success' | 'error'): void {
    saveStatus.textContent = msg;
    saveStatus.className = `save-status ${type}`;
    if (type === 'success') setTimeout(() => { saveStatus.textContent = ''; saveStatus.className = 'save-status'; }, 2500);
  }

  saveBtn.addEventListener('click', async () => {
    clearErrors();

    const draft: AppSettings = {
      ...DEFAULT_SETTINGS,
      display: {
        maxConversationsPerPlatform: parseInt(maxConvosInput.value, 10),
      },
      export: {
        defaultMethod: 'local',
        autoExport: autoExportToggle.checked,
        local: { folderName: settings.export.local.folderName },
        s3: { bucket: '', prefix: '', region: '' },
      },
    };

    // Keep folder name from most recent pick
    const current = await getSettings();
    draft.export.local.folderName = current.export.local.folderName;

    const errors = validateSettings(draft);
    if (errors.length > 0) {
      for (const err of errors) {
        if (err.field === 'display.maxConversationsPerPlatform') {
          maxConvosInput.classList.add('invalid');
          maxConvosError.textContent = err.message;
          maxConvosError.hidden = false;
        }
      }
      showStatus('Fix the errors above.', 'error');
      return;
    }

    await saveSettings(draft);
    showStatus('Saved.', 'success');
  });
}

void main();
