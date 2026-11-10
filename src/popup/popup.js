import { ext } from '../common/browser.js';
import { loadSettings } from '../common/settings.js';
import { clearTreeCaches } from '../content/github-api.js';
import { clearBlobCache, blobCacheStats } from '../content/blob-cache.js';

function ago(ts) {
  if (!ts) return '';
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

async function showBlobStats() {
  try {
    const { count, bytes } = await blobCacheStats();
    const el = document.getElementById('blob-stats');
    if (el) el.textContent = count ? `${count} files cached (${(bytes / 1048576).toFixed(1)} MB) — saves re-downloads` : 'No file content cached yet.';
  } catch {
    // ignore
  }
}

async function renderCache() {
  const all = await ext.storage.local.get(null);
  const items = Object.entries(all)
    .filter(([k]) => k.startsWith('gdt:tree:'))
    .map(([key, v]) => ({ key, repo: key.slice('gdt:tree:'.length), fetchedAt: (v && v.fetchedAt) || 0 }))
    .sort((a, b) => b.fetchedAt - a.fetchedAt);

  document.getElementById('cache-count').textContent = `Cached repositories (${items.length})`;
  const list = document.getElementById('cache-list');
  list.textContent = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'None yet — visit a repo with docs.';
    list.appendChild(li);
    return;
  }
  for (const item of items) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `https://github.com/${item.repo}#docs`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = item.repo;
    a.title = `Open ${item.repo} docs`;
    const age = document.createElement('span');
    age.className = 'age';
    age.textContent = ago(item.fetchedAt);
    const evict = document.createElement('button');
    evict.type = 'button';
    evict.className = 'evict';
    evict.textContent = '×';
    evict.title = 'Remove this cached listing';
    evict.addEventListener('click', async () => {
      await ext.storage.local.remove(item.key);
      renderCache();
    });
    li.appendChild(a);
    li.appendChild(age);
    li.appendChild(evict);
    list.appendChild(li);
  }
}

async function init() {
  const dot = document.getElementById('token-dot');
  const text = document.getElementById('token-text');
  try {
    const s = await loadSettings();
    if (s.token) {
      dot.classList.add('ok');
      text.textContent = 'Token configured — 5,000 requests/hour, private repos supported.';
    } else {
      dot.classList.add('warn');
      text.textContent = 'No token — anonymous access (60 requests/hour, public repos only).';
    }
  } catch {
    text.textContent = 'Could not read settings.';
  }

  document.getElementById('open-options').addEventListener('click', () => {
    ext.runtime.openOptionsPage();
  });

  document.getElementById('clear-cache').addEventListener('click', async () => {
    const n = await clearTreeCaches();
    const b = await clearBlobCache();
    const status = document.getElementById('status');
    status.textContent = `Cleared ${n} listing${n === 1 ? '' : 's'} and ${b} cached file${b === 1 ? '' : 's'}.`;
    status.hidden = false;
    renderCache();
    showBlobStats();
  });

  showBlobStats();

  renderCache();
}

init();
