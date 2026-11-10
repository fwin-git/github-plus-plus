import { DEFAULTS, loadSettings, saveSettings } from '../common/settings.js';
import { initConfluenceOptions } from './confluence-options.js';

const $ = (id) => document.getElementById(id);

function tokenType(t) {
  if (t.startsWith('github_pat_')) return 'fine-grained';
  if (t.startsWith('ghp_')) return 'classic';
  if (t.startsWith('gho_') || t.startsWith('ghs_')) return 'app/oauth';
  return 'unrecognized prefix';
}

function showSaved(s) {
  $('saved-token').textContent = s.token
    ? `Currently saved: ${s.token.slice(0, 10)}… (${s.token.length} chars, ${tokenType(s.token)}). The extension uses this saved value — if it does not match what you pasted, a password manager may have autofilled the field before saving.`
    : 'Currently saved: no token (anonymous access).';
}

function fill(s) {
  $('token').value = s.token;
  showSaved(s);
  $('folders').value = s.docsFolders.join('\n');
  $('include-root').checked = s.includeRootFiles;
  $('show-badge').checked = s.showBadge;
  $('docs-tab-position').value = String(s.docsTabPosition);
  $('max-files').value = s.maxFiles;
  $('search-limit').value = s.contentSearchLimitKB;
}

function showStatus(el, text, ok) {
  el.textContent = text;
  el.classList.toggle('ok', !!ok);
  el.classList.toggle('err', !ok);
  el.hidden = false;
}

async function init() {
  initConfluenceOptions();
  fill(await loadSettings());

  $('save').addEventListener('click', async () => {
    const folders = $('folders')
      .value.split('\n')
      .map((f) => f.trim().replace(/^\/+|\/+$/g, ''))
      .filter(Boolean);
    const clamp = (v, lo, hi, dflt) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
    };
    await saveSettings({
      token: $('token').value.trim(),
      docsFolders: folders.length ? folders : DEFAULTS.docsFolders,
      includeRootFiles: $('include-root').checked,
      showBadge: $('show-badge').checked,
      docsTabPosition: $('docs-tab-position').value === 'last' ? 'last' : clamp($('docs-tab-position').value, 1, 12, 12),
      maxFiles: clamp($('max-files').value, 10, 5000, DEFAULTS.maxFiles),
      contentSearchLimitKB: clamp($('search-limit').value, 10, 2000, DEFAULTS.contentSearchLimitKB),
    });
    showStatus($('save-status'), 'Saved — reload open GitHub tabs to apply.', true);
    showSaved(await loadSettings());
    setTimeout(() => ($('save-status').hidden = true), 4000);
  });

  $('reset').addEventListener('click', async () => {
    await saveSettings({ ...DEFAULTS, token: $('token').value.trim() });
    fill(await loadSettings());
    showStatus($('save-status'), 'Defaults restored (token kept).', true);
    setTimeout(() => ($('save-status').hidden = true), 4000);
  });

  // Inline save appears once a *field* token tests OK and differs from what
  // is stored — the exact situation where forgetting to save bites.
  $('token').addEventListener('input', () => {
    $('save-token').hidden = true;
  });

  $('save-token').addEventListener('click', async () => {
    await saveSettings({ token: $('token').value.trim() });
    showSaved(await loadSettings());
    $('save-token').hidden = true;
    showStatus($('token-status'), 'Token saved — reload open GitHub tabs to apply.', true);
  });

  $('test-token').addEventListener('click', async () => {
    const field = $('token').value.trim();
    const stored = (await loadSettings()).token;
    const token = field || stored;
    const status = $('token-status');
    $('save-token').hidden = true;
    if (!token) {
      showStatus(status, 'No token entered — the extension will use anonymous access.', true);
      return;
    }
    showStatus(status, 'Checking…', true);
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      });
      if (res.ok) {
        const user = await res.json();
        const limit = res.headers.get('x-ratelimit-limit');
        const unsaved = field && field !== stored;
        showStatus(
          status,
          `Token OK — authenticated as ${user.login} (${limit || '5000'} requests/hour).` +
            (unsaved ? ' Not saved yet — click "Save token".' : '') +
            ' Note: this does not verify repo access — for private org repos, fine-grained tokens must be granted to that org, ' +
            'and orgs with SAML SSO require "Configure SSO" on classic tokens.',
          true
        );
        $('save-token').hidden = !unsaved;
      } else {
        showStatus(status, `Token rejected by GitHub (HTTP ${res.status}).`, false);
      }
    } catch {
      showStatus(status, 'Network error while checking the token.', false);
    }
  });
}

init();
