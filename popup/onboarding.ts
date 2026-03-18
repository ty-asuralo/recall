import { getSettings, saveSettings } from '../src/shared/settings';
import { saveExportDir } from './idb';

const folderDisplay = document.getElementById('folder-display')!;
const btnChoose = document.getElementById('btn-choose') as HTMLButtonElement;
const btnDone = document.getElementById('btn-done') as HTMLButtonElement;
const btnSkip = document.getElementById('btn-skip') as HTMLButtonElement;
const status = document.getElementById('status')!;

btnChoose.addEventListener('click', async () => {
  try {
    const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
    await saveExportDir(dir);

    const settings = await getSettings();
    settings.export.local.folderName = dir.name;
    await saveSettings(settings);

    folderDisplay.textContent = dir.name;
    folderDisplay.classList.add('set');
    btnChoose.textContent = 'Change';
    status.style.display = 'block';
  } catch {
    // user cancelled
  }
});

function finish(): void {
  window.close();
}

btnDone.addEventListener('click', finish);
btnSkip.addEventListener('click', finish);
