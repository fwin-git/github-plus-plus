import { isTestFile, parsePullRequest } from '../common/pr-stats.js';

export const FILE_FILTER_PARAM = 'gdt-files';
const HIDDEN = 'data-gdt-file-hidden';
const BANNER = '[data-gdt-file-filter-banner]';

export function selectedFileCategory() {
  if (!parsePullRequest(location.pathname) || !/\/(files|changes)\/?$/.test(location.pathname)) return null;
  const value = new URL(location.href).searchParams.get(FILE_FILTER_PARAM);
  return value === 'code' || value === 'tests' ? value : null;
}

export function fileCategoryURL(tab, category) {
  const target = new URL(tab.href);
  const url = target.pathname === location.pathname ? new URL(location.href) : target;
  url.hash = '';
  if (category === 'all') url.searchParams.delete(FILE_FILTER_PARAM);
  else url.searchParams.set(FILE_FILTER_PARAM, category);
  return url.href;
}

export function updateFileCategoryLink(link, tab) {
  const category = link.getAttribute('data-gdt-file-category');
  const active = category === selectedFileCategory();
  link.href = fileCategoryURL(tab, active ? 'all' : category);
  if (active) link.setAttribute('aria-current', 'true');
  else link.removeAttribute('aria-current');
  link.title = `${link.getAttribute('aria-label')}. ${active ? 'Active filter; click to show all files.' : `Show only ${category === 'code' ? 'code' : 'test'} files.`}`;
}

export async function buildFileFilterIndex(paths) {
  const byPath = new Map();
  const byId = new Map();
  const directories = new Map();
  await Promise.all(paths.map(async path => {
    const category = isTestFile(path) ? 'tests' : 'code';
    byPath.set(path, category);
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (!directories.has(dir)) directories.set(dir, new Set());
      directories.get(dir).add(category);
    }
    // GitHub identifies file regions by SHA-256 of their current path, even
    // before a progressive diff has rendered its header or contents.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path));
    const id = 'diff-' + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    byId.set(id, category);
  }));
  return { byPath, byId, directories };
}

export function clearFileFilter() {
  document.querySelectorAll(`[${HIDDEN}]`).forEach(node => node.removeAttribute(HIDDEN));
  document.querySelectorAll(BANNER).forEach(node => node.remove());
}

export function applyFileFilter(index) {
  const selected = selectedFileCategory();
  if (!selected || !index) { clearFileFilter(); return; }
  const hidden = new Set();
  let unknown = false;
  const pathCategory = node => index.byPath.get(node.getAttribute('data-path') || node.getAttribute('data-file-path'));
  const entries = new Set(document.querySelectorAll('[data-testid="progressive-diffs-list"] > *, .file[data-path], .file[data-file-path]'));
  for (const entry of entries) {
    const region = entry.matches('[id^="diff-"]') ? entry : entry.querySelector('[id^="diff-"]');
    const pathNode = entry.querySelector('[data-file-path], [data-path]');
    const category = pathCategory(entry) || (pathNode && pathCategory(pathNode)) || (region && index.byId.get(region.id));
    if (category && category !== selected) hidden.add(entry);
    else if (!category && (entry.hasAttribute('data-path') || entry.hasAttribute('data-file-path') || pathNode ||
      (region && region.id !== 'diff-placeholder'))) unknown = true;
  }
  // Fail open if GitHub changed its identifiers or the page has newer files.
  if (!unknown) {
    for (const item of document.querySelectorAll('[role="tree"] [role="treeitem"], file-tree [data-path], file-tree a[href*="#diff-"]')) {
      const path = item.getAttribute('data-path') || item.id;
      const category = index.byPath.get(path) || (item.hash && index.byId.get(item.hash.slice(1)));
      const categories = index.directories.get(path);
      if ((category && category !== selected) || (categories && !categories.has(selected))) hidden.add(item);
    }
  } else hidden.clear();
  for (const node of document.querySelectorAll(`[${HIDDEN}]`)) if (!hidden.has(node)) node.removeAttribute(HIDDEN);
  for (const node of hidden) node.setAttribute(HIDDEN, '');
  const list = document.querySelector('[data-testid="progressive-diffs-list"], #files');
  if (!list) return;
  let banner = document.querySelector(BANNER);
  if (!banner) {
    banner = document.createElement('div');
    banner.setAttribute('data-gdt-file-filter-banner', '');
    banner.className = 'gdt-file-filter-banner';
    const text = document.createElement('span');
    text.setAttribute('role', 'status');
    const reset = document.createElement('a');
    reset.setAttribute('data-gdt-file-category', 'all');
    reset.textContent = 'Show all files';
    banner.append(text, reset);
    list.before(banner);
  }
  if (banner.nextElementSibling !== list) list.before(banner);
  const text = unknown ? 'Some files could not be classified. Showing all files.' : `Showing only ${selected === 'code' ? 'code' : 'test'} files.`;
  if (banner.firstElementChild.textContent !== text) banner.firstElementChild.textContent = text;
  banner.lastElementChild.href = fileCategoryURL({ href: location.href }, 'all');
}

export function handleFileFilterClick(event, onChange) {
  const link = event.target.closest?.('a[data-gdt-file-category]');
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const url = new URL(link.href);
  if (url.origin !== location.origin || url.pathname !== location.pathname) return;
  event.preventDefault();
  event.stopPropagation();
  history.pushState({}, '', url.href);
  onChange();
}
