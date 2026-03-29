import type { AppSettings, SettingsValidationError } from './types';

const KEY = 'settings';

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  display: {
    maxConversationsPerPlatform: 10,
  },
  capture: {
    roles: ['user', 'assistant'],
  },
  export: {
    defaultMethod: 'local',
    autoExport: false,
    local: { folderName: null },
    s3: { bucket: '', prefix: '', region: '' },
  },
};

export async function getSettings(): Promise<AppSettings> {
  const result = await chrome.storage.local.get(KEY);
  const stored = result[KEY] as Partial<AppSettings> | undefined;
  if (!stored) return DEFAULT_SETTINGS;
  // Deep merge so new default fields are always present
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    display: { ...DEFAULT_SETTINGS.display, ...stored.display },
    capture: {
      roles: stored.capture?.roles?.length ? stored.capture.roles : DEFAULT_SETTINGS.capture.roles,
    },
    export: {
      ...DEFAULT_SETTINGS.export,
      ...stored.export,
      autoExport: stored.export?.autoExport ?? DEFAULT_SETTINGS.export.autoExport,
      local: { ...DEFAULT_SETTINGS.export.local, ...stored.export?.local },
      s3: { ...DEFAULT_SETTINGS.export.s3, ...stored.export?.s3 },
    },
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: settings });
}

export function validateSettings(s: AppSettings): SettingsValidationError[] {
  const errors: SettingsValidationError[] = [];
  const n = s.display.maxConversationsPerPlatform;
  if (!Number.isInteger(n) || n < 1 || n > 50) {
    errors.push({
      field: 'display.maxConversationsPerPlatform',
      message: 'Must be a whole number between 1 and 50',
    });
  }
  if (s.capture.roles.length === 0) {
    errors.push({
      field: 'capture.roles',
      message: 'At least one role must be selected',
    });
  }
  return errors;
}
