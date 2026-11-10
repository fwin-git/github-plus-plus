import { parsePullRequest } from '../common/pr-stats.js';
import { loadSettings } from '../common/settings.js';
import { makeClient } from './github-api.js';
import { syncCountSpinners } from './count-loading.js';
import { buildFileFilterIndex, applyFileFilter, clearFileFilter, updateFileCategoryLink, handleFileFilterClick } from './pr-file-filter.js';

const TTL = 5 * 60_000;
const RETRY_DELAY = 60_000;
const MARKER = '[data-gdt-pr-stats]';
const FILE_MARKER = '[data-gdt-pr-files]';

function nativeFileTabs() {
  const info = parsePullRequest(location.pathname);
  if (!info) return [];
  const prefix = `/${info.owner}/${info.repo}/pull/${info.number}/`;
  return [...document.querySelectorAll('nav[aria-label="Pull request navigation"] a[href]:not([data-gdt-file-category]), nav[aria-label="Pull request"] a[href]:not([data-gdt-file-category]), nav[aria-label="Pull request tabs"] a[href]:not([data-gdt-file-category])')]
    .filter(link => {
      const url = new URL(link.href);
      return url.origin === location.origin && [prefix + 'files', prefix + 'changes'].includes(url.pathname);
    });
}

function nativeFileCounters() {
  return nativeFileTabs().map(link => link.querySelector('[data-component="counter"], .Counter')).filter(Boolean);
}

function nativeFileTotal(node) {
  const label = node.querySelector('[data-component="CounterLabel"]') || node;
  const value = label.textContent.trim();
  return /^\d[\d,]*$/.test(value) ? Number(value.replaceAll(',', '')) : null;
}

function nativeSummaries() {
  const nodes = new Set(document.querySelectorAll('#diffstat'));
  // Overview puts totals in PageHeader.Description, beside the branches.
  // Older layouts put them in PH_Navigation. Scope both to the PR header so
  // individual file/commit diffstats never receive whole-PR totals.
  for (const section of document.querySelectorAll('[data-component="PH_Navigation"], [data-component="PageHeader"]')) {
    if (!section.querySelector('nav[aria-label="Pull request navigation"], nav[aria-label="Pull request"]')) continue;
    for (const square of section.querySelectorAll('[data-testid$=" diffstat"]')) {
      const group = square.parentElement?.parentElement;
      if (group) nodes.add(group);
    }
  }
  return [...nodes];
}

function nativeTotals(node) {
  const read = (selector) => {
    const text = node.querySelector(selector)?.textContent.trim();
    return text && /^[+−-][\d,\s]+$/.test(text) ? Number(text.replace(/[^\d]/g, '')) : null;
  };
  const additions = read('.fgColor-success, .color-fg-success, .text-green');
  const deletions = read('.fgColor-danger, .color-fg-danger, .text-red');
  return additions == null || deletions == null ? null : { additions, deletions };
}

function restoreNative() {
  clearFileFilter();
  document.querySelectorAll('.gdt-pr-files-tab').forEach(node => node.classList.remove('gdt-pr-files-tab'));
  document.querySelectorAll('.gdt-pr-files-item').forEach(node => node.classList.remove('gdt-pr-files-item'));
  document.querySelectorAll(`${MARKER}, ${FILE_MARKER}`).forEach((node) => node.remove());
  for (const attr of ['data-gdt-pr-native', 'data-gdt-pr-files-native']) {
    document.querySelectorAll(`[${attr}]`).forEach(node => node.removeAttribute(attr));
  }
}

function categoryIcon(label) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [name, value] of Object.entries({
    viewBox: '0 0 16 16', width: '14', height: '14', fill: 'none',
    stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round',
    'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false',
  })) svg.setAttribute(name, value);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', label === 'Code'
    ? 'M5 4 1 8l4 4m6-8 4 4-4 4M9 2 7 14'
    : 'M6 2h4M7 2v4l-4 6c-.6 1 .1 2 1.2 2h7.6c1.1 0 1.8-1 1.2-2L9 6V2M5 10h6');
  svg.append(path);
  return svg;
}

function renderSummary(native, stats) {
  native.setAttribute('data-gdt-pr-native', '');
  const updateLinks = summary => {
    const info = parsePullRequest(location.pathname);
    const tab = nativeFileTabs()[0] || { href: new URL(`/${info.owner}/${info.repo}/pull/${info.number}/files`, location.origin).href };
    for (const link of summary.querySelectorAll('[data-gdt-file-category]')) {
      updateFileCategoryLink(link, tab);
    }
  };
  if (native.nextElementSibling?.matches(MARKER)) {
    updateLinks(native.nextElementSibling);
    return;
  }
  const summary = document.createElement('span');
  summary.setAttribute('data-gdt-pr-stats', '');
  summary.className = 'gdt-pr-stats';
  const format = (n) => n.toLocaleString();
  summary.title = `Total: +${format(stats.total.additions)} −${format(stats.total.deletions)}. Tests includes test files, fixtures, snapshots, mocks, and test-runner configuration, detected by file path. Code includes all other files.`;
  for (const [label, counts] of [['Code', stats.code], ['Tests', stats.tests]]) {
    const group = document.createElement('a');
    group.className = 'gdt-pr-stats-group';
    group.setAttribute('data-gdt-file-category', label === 'Code' ? 'code' : 'tests');
    group.setAttribute('aria-label', `${label}: ${format(counts.additions)} additions, ${format(counts.deletions)} deletions`);
    group.title = `${label}: +${format(counts.additions)} −${format(counts.deletions)}. Show only ${label === 'Code' ? 'code' : 'test'} files.`;
    const icon = categoryIcon(label);
    const added = document.createElement('span');
    added.className = 'gdt-pr-added';
    added.textContent = `+${format(counts.additions)}`;
    const removed = document.createElement('span');
    removed.className = 'gdt-pr-removed';
    removed.textContent = `−${format(counts.deletions)}`;
    for (const child of [added, removed]) child.setAttribute('aria-hidden', 'true');
    group.append(icon, ' ', added, ' ', removed);
    summary.append(group);
    if (label === 'Code') summary.append(' · ');
  }
  native.after(summary);
  updateLinks(summary);
  native.setAttribute('data-gdt-pr-native', '');
}

function renderFileCounter(native, counts) {
  native.setAttribute('data-gdt-pr-files-native', '');
  const tab = native.closest('a');
  tab.classList.add('gdt-pr-files-tab');
  if (tab.parentElement.tagName === 'LI') tab.parentElement.classList.add('gdt-pr-files-item');
  const update = badge => {
    const style = getComputedStyle(tab);
    badge.style.marginBlockStart = style.marginBlockStart;
    badge.style.marginBlockEnd = style.marginBlockEnd;
    for (const link of badge.querySelectorAll('[data-gdt-file-category]')) {
      updateFileCategoryLink(link, tab);
    }
  };
  if (tab.nextElementSibling?.matches(FILE_MARKER)) {
    update(tab.nextElementSibling);
    return;
  }
  const badge = document.createElement('span');
  badge.setAttribute('data-gdt-pr-files', '');
  badge.className = 'gdt-pr-counts gdt-pr-files';
  badge.title = `Files changed: ${counts.code.toLocaleString()} code | ${counts.tests.toLocaleString()} tests. Total: ${counts.total.toLocaleString()}.`;
  for (const [label, value] of [['Code', counts.code], ['Tests', counts.tests]]) {
    if (label === 'Tests') {
      const separator = document.createElement('span');
      separator.setAttribute('aria-hidden', 'true');
      separator.textContent = ' | ';
      badge.append(separator);
    }
    const group = document.createElement('a');
    group.className = 'gdt-pr-count-group';
    group.setAttribute('data-gdt-file-category', label === 'Code' ? 'code' : 'tests');
    group.setAttribute('aria-label', `${label}: ${value.toLocaleString()} changed files`);
    group.title = `Show only ${label.toLowerCase()} files (${value.toLocaleString()})`;
    const number = document.createElement('span');
    number.setAttribute('aria-hidden', 'true');
    number.textContent = value.toLocaleString();
    group.append(categoryIcon(label), number);
    badge.append(group);
  }
  tab.after(badge);
  update(badge);
  native.setAttribute('data-gdt-pr-files-native', '');
}

// Independent from Docs discovery: a repository without documentation (or
// without tree permission) still gets PR counts. Only one PR is cached per tab.
export function startPrStats() {
  let current = null;
  let timer = 0;
  let blockedUntil = 0;
  let token;
  const spinners = targets => syncCountSpinners(targets, 'data-gdt-pr-stats-spinner', 'Loading code and test counts');

  function reset() {
    current?.controller?.abort();
    current = null;
    restoreNative();
    spinners([]);
    document.documentElement.removeAttribute('data-gdt-pr-error');
    document.documentElement.removeAttribute('data-gdt-pr-loading');
  }

  function paint(state) {
    const natives = nativeSummaries();
    const fileCounters = nativeFileCounters();
    spinners(state.loading ? [...natives, ...fileCounters] : []);
    // Restore detached/replaced React summaries without leaving an orphan split.
    document.querySelectorAll(MARKER).forEach((node) => {
      if (!natives.includes(node.previousElementSibling)) node.remove();
    });
    document.querySelectorAll(FILE_MARKER).forEach(node => {
      if (!fileCounters.some(native => native.closest('a') === node.previousElementSibling)) node.remove();
    });
    if (!state.stats) return;
    const mismatch = natives.some((node) => {
      const total = nativeTotals(node);
      return total && (total.additions !== state.stats.total.additions || total.deletions !== state.stats.total.deletions);
    });
    if (mismatch || fileCounters.some(node => nativeFileTotal(node) !== state.stats.files.total)) {
      restoreNative();
      state.stats = null;
      return;
    }
    for (const native of natives) {
      if (nativeTotals(native)) renderSummary(native, state.stats);
    }
    for (const native of fileCounters) renderFileCounter(native, state.stats.files);
    applyFileFilter(state.filterIndex);
  }

  async function scan() {
    const info = parsePullRequest(location.pathname);
    if (current?.key !== info?.key) reset();
    if (!info) return;
    if (!current) current = { ...info, stats: null, loading: false, fetchedAt: 0, retryAt: 0 };
    const state = current;
    paint(state);
    if (state.loading || Date.now() < Math.max(state.retryAt, blockedUntil)) return;
    if (state.stats && Date.now() - state.fetchedAt < TTL) return;
    state.loading = true;
    state.stats = null;
    restoreNative();
    spinners([...nativeSummaries(), ...nativeFileCounters()]);
    state.controller = new AbortController();
    const timeout = setTimeout(() => state.controller.abort(), 30_000);
    document.documentElement.setAttribute('data-gdt-pr-loading', 'true');
    try {
      const settings = await loadSettings();
      if (current !== state) return;
      token = settings.token;
      const client = makeClient({ ...info, token });
      const stats = await client.getPullRequestStats(info.number, { signal: state.controller.signal });
      const filterIndex = await buildFileFilterIndex(stats.filePaths);
      if (current !== state || parsePullRequest(location.pathname)?.key !== state.key) return;
      state.stats = stats;
      state.filterIndex = filterIndex;
      state.fetchedAt = Date.now();
      // A lagging native header must not cause a tight refetch loop.
      state.retryAt = Date.now() + RETRY_DELAY;
      document.documentElement.removeAttribute('data-gdt-pr-error');
      paint(state);
    } catch (err) {
      if (current !== state) return;
      state.retryAt = Date.now() + RETRY_DELAY;
      if (err?.name === 'RateLimitError') blockedUntil = Math.max(state.retryAt, err.resetAt || 0);
      document.documentElement.setAttribute('data-gdt-pr-error', String(err?.message || err).slice(0, 300));
    } finally {
      clearTimeout(timeout);
      state.loading = false;
      if (current === state) {
        spinners([]);
        document.documentElement.removeAttribute('data-gdt-pr-loading');
      }
    }
  }

  function schedule() {
    // Throttle rather than debounce: hydration must not postpone the scan forever.
    if (!timer) timer = setTimeout(() => { timer = 0; void scan(); }, 100);
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  for (const event of ['turbo:load', 'turbo:render', 'soft-nav:success', 'pjax:end']) document.addEventListener(event, schedule);
  window.addEventListener('popstate', schedule);
  document.addEventListener('click', event => handleFileFilterClick(event, () => { if (current) paint(current); }), true);
  window.addEventListener('resize', schedule);
  window.addEventListener('focus', schedule);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
  void scan();

  return {
    settingsChanged(next) {
      if (next.token === token) return;
      token = next.token;
      blockedUntil = 0;
      reset();
      schedule();
    },
  };
}
