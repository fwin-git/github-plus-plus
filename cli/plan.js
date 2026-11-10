// Pure planner: turns (browser, mode) into what to launch, what to put in the
// clipboard, and which manual steps remain. The executable wrapper only
// executes plans; all decisions live here for testability.

// Trials open the extension's own repository — its docs/ folder is written to
// showcase the viewer (frontmatter, wiki links, pinned section, search).
export const DEMO_URL = 'https://github.com/fwin-git/github-plus-plus';

export function buildPlan(browser, { distPath, mode, tmpDir, platform }) {
  if (mode === 'trial') {
    if (browser.family === 'chromium') {
      return {
        kind: 'spawn',
        bin: browser.bin,
        args: [
          `--user-data-dir=${tmpDir}`,
          '--no-first-run',
          '--no-default-browser-check',
          `--load-extension=${distPath}`,
          DEMO_URL,
        ],
        clipboard: null,
        steps: [
          'A separate browser window opens with the extension already loaded (throwaway profile).',
          "It lands on the extension's own repository — click its Docs tab to see the viewer in action, then try any other repo.",
        ],
        note:
          browser.id === 'chrome'
            ? 'Branded Google Chrome (≥137) may ignore --load-extension. If the Docs tab does not appear, rerun without --trial for the guided permanent install, or use Brave/Edge/Chromium for trials.'
            : null,
      };
    }
    return {
      kind: 'webext',
      args: ['run', '--source-dir', distPath, '--start-url', DEMO_URL, ...(browser.bin ? ['--firefox', browser.bin] : [])],
      clipboard: null,
      steps: [
        "Mozilla's web-ext launches a fresh Firefox profile with the extension pre-loaded, landing on the extension's own repository.",
        'Click its Docs tab to see the viewer in action. Ctrl+C here when done.',
      ],
      note: 'Runs via `npx web-ext` (downloaded on first use). The session is temporary by design.',
    };
  }

  // guided permanent(ish) install
  if (browser.family === 'firefox') {
    return {
      kind: 'spawn',
      bin: browser.bin,
      args: [browser.extPage],
      clipboard: `${distPath}/manifest.json`,
      steps: [
        'Firefox opens about:debugging → "This Firefox".',
        'Click "Load Temporary Add-on…".',
        `Select dist/manifest.json — the full path is in your clipboard${platform === 'darwin' ? ' (press ⌘⇧G in the file dialog and paste)' : ''}.`,
        'Note: Firefox removes temporary add-ons on restart. For a permanent install, submit the zip from artifacts/ to addons.mozilla.org (self-distribution is fine).',
      ],
      note: null,
    };
  }
  return {
    kind: 'spawn',
    bin: browser.bin,
    args: [browser.extPage],
    clipboard: distPath,
    steps: [
      `${browser.name} opens its extensions page.`,
      'Enable "Developer mode" (toggle in the top-right corner).',
      `Click "Load unpacked" and select the dist folder — the full path is in your clipboard${platform === 'darwin' ? ' (press ⌘⇧G / Cmd+Shift+G in the file dialog and paste)' : ''}.`,
      'The extension persists across restarts (the browser may show a "developer mode extensions" reminder).',
    ],
    note: null,
  };
}
