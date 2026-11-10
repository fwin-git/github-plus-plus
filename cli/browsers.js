// Browser registry + detection. Pure: platform, exists(path) and env are
// injected so this is unit-testable without touching the filesystem.

const APPDATA = (env) => env.LOCALAPPDATA || 'C:\\Users\\Default\\AppData\\Local';

export const BROWSERS = [
  {
    id: 'chrome',
    name: 'Google Chrome',
    family: 'chromium',
    extPage: 'chrome://extensions/',
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    linuxBins: ['google-chrome', 'google-chrome-stable', 'chrome'],
    win32: (env) => [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      `${APPDATA(env)}\\Google\\Chrome\\Application\\chrome.exe`,
    ],
  },
  {
    id: 'brave',
    name: 'Brave',
    family: 'chromium',
    extPage: 'brave://extensions/',
    darwin: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
    linuxBins: ['brave-browser', 'brave'],
    win32: (env) => [
      'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      `${APPDATA(env)}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
    ],
  },
  {
    id: 'edge',
    name: 'Microsoft Edge',
    family: 'chromium',
    extPage: 'edge://extensions/',
    darwin: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    linuxBins: ['microsoft-edge', 'microsoft-edge-stable'],
    win32: () => [
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
  },
  {
    id: 'chromium',
    name: 'Chromium',
    family: 'chromium',
    extPage: 'chrome://extensions/',
    darwin: ['/Applications/Chromium.app/Contents/MacOS/Chromium'],
    linuxBins: ['chromium', 'chromium-browser'],
    win32: () => [],
  },
  {
    id: 'firefox',
    name: 'Firefox',
    family: 'firefox',
    extPage: 'about:debugging#/runtime/this-firefox',
    darwin: [
      '/Applications/Firefox.app/Contents/MacOS/firefox',
      '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox',
    ],
    linuxBins: ['firefox', 'firefox-developer-edition'],
    win32: () => ['C:\\Program Files\\Mozilla Firefox\\firefox.exe', 'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe'],
  },
];

export function findOnPath(name, pathVar, exists) {
  for (const dir of String(pathVar || '').split(':')) {
    if (!dir) continue;
    const candidate = `${dir}/${name}`;
    if (exists(candidate)) return candidate;
  }
  return null;
}

export function detectBrowsers(platform, exists, env = {}) {
  const found = [];
  for (const b of BROWSERS) {
    let bin = null;
    if (platform === 'darwin') {
      bin = (b.darwin || []).find(exists) ?? null;
    } else if (platform === 'win32') {
      bin = (b.win32 ? b.win32(env) : []).find(exists) ?? null;
    } else {
      for (const name of b.linuxBins || []) {
        bin = findOnPath(name, env.PATH, exists);
        if (bin) break;
      }
    }
    if (bin) found.push({ id: b.id, name: b.name, family: b.family, extPage: b.extPage, bin });
  }
  return found;
}
