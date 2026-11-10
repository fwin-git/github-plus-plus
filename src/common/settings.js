import { ext } from './browser.js';
import { DEFAULT_FOLDERS } from './docs-model.js';

const KEY = 'gdt:settings';

export const DEFAULTS = {
  token: '',
  docsFolders: DEFAULT_FOLDERS,
  includeRootFiles: true,
  maxFiles: 500,
  theme: 'auto', // 'auto' | 'light' | 'dark'
  titleMode: 'heading', // 'heading' (first highest headline) | 'filename'
  showBadge: true,
  docsTabPosition: 'last', // 'last' or a one-based position in the repo tab row
  contentSearchLimitKB: 200,
};

export async function loadSettings() {
  const stored = await ext.storage.local.get(KEY);
  const s = stored[KEY];
  return { ...DEFAULTS, ...(s && typeof s === 'object' ? s : {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await loadSettings()), ...patch };
  await ext.storage.local.set({ [KEY]: next });
  return next;
}

export function onSettingsChanged(cb) {
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) {
      const v = changes[KEY].newValue;
      cb({ ...DEFAULTS, ...(v && typeof v === 'object' ? v : {}) });
    }
  });
}
