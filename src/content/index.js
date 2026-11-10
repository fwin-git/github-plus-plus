// Content-script entry: detects repo pages, injects the Docs tab, routes
// #docs hashes to the viewer, and survives GitHub's Turbo soft navigation.
import { parseHash } from '../common/route.js';
import { scanDecision } from '../common/scan-policy.js';
import { ext } from '../common/browser.js';
import { loadSettings, onSettingsChanged } from '../common/settings.js';
import { makeClient } from './github-api.js';
import { collectDocs } from '../common/docs-model.js';
import { ensureTab, setTabActive, findRepoNav, tabConnected, removeTab } from './tab.js';
import { createViewer } from './viewer.js';
import { createCommandPalette } from './command-palette.js';
import { startPrStats } from './pr-stats.js';
import { startPrCounts } from './pr-counts.js';
import { confluenceStorage } from '../common/confluence-storage.js';
import { CONFLUENCE_SITES_KEY, ATTACHMENT_PREFIX } from '../common/confluence.js';

const prStats = startPrStats();
const prCounts = startPrCounts();

const RESERVED_OWNERS = new Set([
  'about',
  'account',
  'apps',
  'codespaces',
  'collections',
  'contact',
  'customer-stories',
  'dashboard',
  'enterprise',
  'events',
  'explore',
  'features',
  'gist',
  'integrations',
  'issues',
  'join',
  'login',
  'logout',
  'marketplace',
  'new',
  'notifications',
  'organizations',
  'orgs',
  'pricing',
  'pulls',
  'search',
  'security',
  'sessions',
  'settings',
  'sponsors',
  'topics',
  'trending',
]);

function parseRepo(pathname) {
  const segs = pathname.split('/').filter(Boolean);
  if (segs.length < 2) return null;
  const [owner, repo] = segs;
  if (RESERVED_OWNERS.has(owner.toLowerCase())) return null;
  return { owner, repo };
}

let current = null; // { key, owner, repo, loading, settings, client, docs, truncated, total, viewer }
let scanTimer = 0;
let requestedSearch = null;
const palette = createCommandPalette({ onClose: () => { requestedSearch = null; } });

const hasDocs = state => state?.docs && (state.docs.length || state.confluenceSites?.length || parseHash(location.hash)?.source === 'confluence');

function updateDocsTab() {
  if (!hasDocs(current)) return;
  ensureTab({ owner: current.owner, repo: current.repo, count: current.total,
    showBadge: current.settings.showBadge && current.total > 0, position: current.settings.docsTabPosition });
}

function openRequestedSearch() {
  palette.closeIfNavigated();
  const info = parseRepo(location.pathname);
  if (!requestedSearch || requestedSearch !== current?.key || `${info?.owner}/${info?.repo}` !== requestedSearch || !current.docs) return;
  requestedSearch = null;
  if (!hasDocs(current)) {
    palette.setMessage('No documentation found in this repository.');
    return;
  }
  palette.setSource(getViewer().getSearchSource(), current.settings.theme);
}

// scan() is called repeatedly (boot, Turbo loads, mutation storms during
// GitHub's hydration). It must be idempotent and race-free: overlapping calls
// for the same repo are collapsed via current.loading, and a repo switch
// invalidates in-flight loads by object identity (current !== me).
async function scan({ forSearch = false } = {}) {
  palette.closeIfNavigated();
  const repoInfo = parseRepo(location.pathname);
  const nav = findRepoNav();
  const key = repoInfo ? `${repoInfo.owner}/${repoInfo.repo}` : null;

  if (requestedSearch && requestedSearch !== key) requestedSearch = null;
  const decision = scanDecision({ repoKey: key, navPresent: !!nav || forSearch, currentKey: current && current.key });
  if (decision !== 'proceed') {
    if (decision !== 'wait' && current) {
      // 'teardown' / 'teardown-wait': we actually left the repo (or switched
      // to another one). Transient nav absence on the SAME repo keeps all
      // in-memory state (docs, viewer, search index) for instant re-inject.
      current.viewer?.dispose();
      current = null;
    }
    return;
  }
  if (current && current.key === key) {
    if (current.docs) {
      updateDocsTab();
      applyRoute();
      openRequestedSearch();
      return;
    }
    if (current.loading) return;
    // previous attempt died without finishing — fall through and retry
  } else {
    current?.viewer?.dispose();
    current = { key, ...repoInfo };
  }

  const me = current;
  me.loading = true;
  try {
    const settings = await loadSettings();
    if (current !== me) return;
    me.settings = settings;
    me.confluenceSites = await confluenceStorage.listSites();
    if (current !== me) return;
    me.client = makeClient({
      owner: me.owner,
      repo: me.repo,
      token: settings.token,
      candidateFolders: settings.docsFolders,
    });
    let treeRes;
    try { treeRes = await me.client.getTree(); }
    catch (error) {
      if (!me.confluenceSites.length && parseHash(location.hash)?.source !== 'confluence') throw error;
      me.githubError = error.message;
      treeRes = { entries: [], truncated: false };
    }
    if (current !== me) return;
    const { docs, truncated, total } = collectDocs(treeRes.entries, {
      folders: settings.docsFolders,
      includeRootFiles: settings.includeRootFiles,
      maxFiles: settings.maxFiles,
    });
    me.docs = docs;
    me.truncated = truncated || treeRes.truncated;
    me.total = total;
    document.documentElement.removeAttribute('data-gdt-error'); // stale diagnostics confuse debugging
    if (hasDocs(me)) {
      updateDocsTab();
      applyRoute();
    }
    openRequestedSearch();
  } catch (err) {
    // No tab on rate-limited/private/empty repos we cannot read. The DOM
    // attribute makes failures diagnosable from the page (issue reports).
    console.debug('[github-plus-plus]', err && err.message);
    document.documentElement.setAttribute('data-gdt-error', `${err && err.name}: ${err && err.message}`.slice(0, 300));
    if (current === me && requestedSearch === me.key) {
      requestedSearch = null;
      palette.closeIfNavigated();
      palette.setMessage('Could not load documentation. Check repository access in the extension Options.');
    }
  } finally {
    me.loading = false;
  }
}

function getViewer() {
  if (!hasDocs(current)) return null;
  if (!current.viewer) {
    current.viewer = createViewer({
      client: current.client,
      settings: current.settings,
      docs: current.docs,
      truncated: current.truncated,
      total: current.total,
      onRequestRefresh: refreshRepo,
      confluenceSites: current.confluenceSites,
      githubError: current.githubError,
    });
  }
  return current.viewer;
}

async function refreshRepo() {
  if (!current) return;
  const { client, settings, key } = current;
  try {
    const treeRes = await client.getTree({ force: true });
    if (!current || current.key !== key) return;
    const { docs, truncated, total } = collectDocs(treeRes.entries, {
      folders: settings.docsFolders,
      includeRootFiles: settings.includeRootFiles,
      maxFiles: settings.maxFiles,
    });
    palette.close();
    current.viewer?.dispose();
    current.viewer = null;
    current.docs = docs;
    current.truncated = truncated || treeRes.truncated;
    current.total = total;
    current.githubError = null;
    updateDocsTab();
    applyRoute();
  } catch (err) {
    console.debug('[github-plus-plus] refresh failed', err && err.message);
  }
}

function applyRoute() {
  const route = parseHash(location.hash);
  if (route) {
    const viewer = getViewer();
    if (viewer) {
      viewer.open(route);
      setTabActive(true);
      return;
    }
  }
  if (current?.viewer?.isOpen()) current.viewer.close();
  setTabActive(false);
}

function scheduleScan() {
  palette.closeIfNavigated();
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scan, 200);
}

const routeChanged = () => { palette.closeIfNavigated(); applyRoute(); };
window.addEventListener('hashchange', routeChanged);
window.addEventListener('popstate', routeChanged);
window.addEventListener('keydown', event => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return;
  const info = parseRepo(location.pathname);
  if (!info) return;
  const key = `${info.owner}/${info.repo}`;
  const repoMeta = document.querySelector('meta[name="octolytics-dimension-repository_nwo"]')?.content;
  if (!findRepoNav() && current?.key !== key && repoMeta !== key) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.repeat) return;
  if (palette.isOpen()) { palette.close(); return; }
  requestedSearch = key;
  palette.open({ repository: key, theme: current?.settings?.theme });
  if (current?.key === key && current.docs) openRequestedSearch();
  else {
    void scan({ forSearch: true });
  }
}, true);
document.addEventListener('turbo:load', scheduleScan);
document.addEventListener('turbo:render', scheduleScan);
document.addEventListener('soft-nav:success', scheduleScan);
document.addEventListener('pjax:end', scheduleScan);

const observer = new MutationObserver(() => {
  // Covers: nav re-rendered by Turbo (tab vanished), nav appearing after our
  // boot scan, and recovery from a died load. Repos confirmed to have zero
  // docs are excluded so we don't rescan forever.
  if (!findRepoNav() || tabConnected()) return;
  if (current?.docs && !hasDocs(current)) return;
  scheduleScan();
});
observer.observe(document.documentElement, { childList: true, subtree: true });

// In-viewer preferences (theme, title mode) are handled by the viewer itself —
// only changes that affect what we collect or show require a full rebuild.
const REBUILD_KEYS = ['token', 'docsFolders', 'includeRootFiles', 'maxFiles', 'showBadge', 'contentSearchLimitKB'];

onSettingsChanged((next) => {
  prStats.settingsChanged(next);
  prCounts.settingsChanged(next);
  if (current && current.settings) {
    const needsRebuild = REBUILD_KEYS.some((k) => JSON.stringify(next[k]) !== JSON.stringify(current.settings[k]));
    current.settings = { ...current.settings, theme: next.theme, titleMode: next.titleMode, docsTabPosition: next.docsTabPosition };
    if (!needsRebuild) {
      updateDocsTab();
      return;
    }
  }
  palette.close();
  const old = current;
  current = null;
  old?.viewer?.dispose();
  removeTab();
  scheduleScan();
});

ext.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[CONFLUENCE_SITES_KEY]) {
    palette.close();
    current?.viewer?.dispose(); current = null; removeTab(); scheduleScan();
  } else if (Object.keys(changes).some(key => key.startsWith(ATTACHMENT_PREFIX))) {
    current?.viewer?.refreshConfluenceAttachments()?.catch(() => {});
  }
});

// ---- "Propose via GitHub editor" handoff ------------------------------------
// The viewer stashes edited content and navigates to GitHub's own /edit/ page;
// here (also github.com, so this content script runs) we pre-fill GitHub's
// editor so the user commits with their own logged-in account.

function parseEditPage(pathname) {
  const segs = pathname.split('/').filter(Boolean);
  if (segs.length >= 5 && segs[2] === 'edit') {
    return { owner: segs[0], repo: segs[1], path: segs.slice(4).map(decodeURIComponent).join('/') };
  }
  return null;
}

function showToast(text, copyContent) {
  document.querySelector('.gdt-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'gdt-toast';
  const span = document.createElement('span');
  span.textContent = text;
  toast.appendChild(span);
  if (copyContent) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Copy edited content';
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(copyContent).then(
        () => (btn.textContent = 'Copied ✓'),
        () => (btn.textContent = 'Copy failed')
      );
    });
    toast.appendChild(btn);
  }
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'gdt-toast-x';
  x.textContent = '×';
  x.addEventListener('click', () => toast.remove());
  toast.appendChild(x);
  document.body.appendChild(toast);
  if (!copyContent) setTimeout(() => toast.remove(), 20000);
}

async function maybePrefillGithubEditor() {
  const stage = (s) => document.documentElement.setAttribute('data-gdt-prefill', s);
  const info = parseEditPage(location.pathname);
  if (!info) return;
  stage('edit-page');
  let stored;
  try {
    stored = (await ext.storage.local.get('gdt:pending-edit'))['gdt:pending-edit'];
  } catch (err) {
    stage('storage-error:' + (err && err.message));
    return;
  }
  if (!stored || stored.owner !== info.owner || stored.repo !== info.repo || stored.path !== info.path) {
    stage('no-match');
    return;
  }
  stage('matched');
  if (Date.now() - stored.savedAt > 10 * 60 * 1000) {
    ext.storage.local.remove('gdt:pending-edit');
    return;
  }
  const deadline = Date.now() + 12000;
  const finish = (success) => {
    ext.storage.local.remove('gdt:pending-edit');
    showToast(
      success
        ? 'Docs Tab: your edited content is filled in below — review it and use "Commit changes…".'
        : "Docs Tab: couldn't auto-fill GitHub's editor. Copy your edited content and paste it (select all first).",
      success ? null : stored.content
    );
  };
  stage('polling');
  const timer = setInterval(() => {
    const cm = document.querySelector('.cm-content');
    const ta = document.querySelector('textarea[name="value"]');
    if (ta) {
      clearInterval(timer);
      stage('filling-textarea');
      ta.value = stored.content;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      finish(true);
    } else if (cm) {
      clearInterval(timer);
      let ok = false;
      try {
        cm.focus();
        document.execCommand('selectAll');
        ok = document.execCommand('insertText', false, stored.content);
      } catch {
        ok = false;
      }
      finish(ok);
    } else if (Date.now() > deadline) {
      clearInterval(timer);
      finish(false);
    }
  }, 400);
}

document.documentElement.setAttribute('data-gdt-boot', '1');
scan().catch((err) => {
  document.documentElement.setAttribute('data-gdt-error', `boot ${err && err.name}: ${err && err.message}`.slice(0, 300));
});
maybePrefillGithubEditor();
