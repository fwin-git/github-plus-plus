export const CONFLUENCE_SITES_KEY = 'gdt:confluence-sites';
export const ATTACHMENT_PREFIX = 'gdt:confluence-attachment:';

export function normalizeSite(value) {
  const url = new URL(String(value).trim());
  if (url.protocol !== 'https:' || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.atlassian\.net$/.test(url.hostname) || url.port || url.username || url.password) {
    throw new Error('Enter an HTTPS Confluence Cloud site, such as https://team.atlassian.net.');
  }
  return url.origin;
}

export function validId(value) {
  const id = String(value ?? '');
  if (!/^\d{1,30}$/.test(id)) throw new Error('Invalid Confluence page or space ID.');
  return id;
}

export function pageKey(site, id) { return `${normalizeSite(site)}|${validId(id)}`; }

export function normalizeRepository(value) {
  let repo = String(value).trim();
  if (repo.startsWith('https://github.com/')) repo = repo.slice('https://github.com/'.length).replace(/\/$/, '');
  if (!/^[a-z0-9][a-z0-9-]*\/[a-z0-9_.-]+$/i.test(repo) || ['.', '..'].includes(repo.split('/')[1])) {
    throw new Error('Enter a repository as owner/repository.');
  }
  return repo.toLowerCase();
}

// Assignment belongs to an individual page; descendants keep their own group.
// Saved metadata lets attached pages appear before their space is expanded.
export function groupPages(pages, attachments) {
  const all = new Map();
  for (const page of [...Object.values(attachments), ...pages]) {
    try { all.set(pageKey(page.site, page.id), page); } catch { /* invalid stored metadata */ }
  }
  const spaces = new Map(), repositories = new Map();
  for (const [key, page] of all) {
    const repository = attachments[key]?.repository;
    const map = repository ? repositories : spaces;
    let group;
    try { group = repository ? normalizeRepository(repository) : pageKey(page.site, page.spaceId); } catch { continue; }
    if (!map.has(group)) map.set(group, []);
    map.get(group).push(page);
  }
  return { spaces, repositories };
}

export function pageUrl(site, id) {
  return `${normalizeSite(site)}/wiki/pages/viewpage.action?pageId=${validId(id)}`;
}

export function pageTreeRows(pages) {
  const byKey = new Map(pages.map(page => [pageKey(page.site, page.id), page]));
  const children = new Map(), roots = [];
  const sorted = [...byKey.values()].sort((a, b) => a.title.localeCompare(b.title));
  for (const page of sorted) {
    const parent = page.parentId ? pageKey(page.site, page.parentId) : null;
    if (!parent || !byKey.has(parent)) roots.push(page);
    else {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(page);
    }
  }
  const rows = [], seen = new Set();
  // Iterative walk handles very deep trees and cycles without stack overflow.
  const walk = page => {
    const stack = [{ page, depth: 0 }];
    while (stack.length) {
      const row = stack.pop(), key = pageKey(row.page.site, row.page.id);
      if (seen.has(key)) continue;
      seen.add(key); rows.push(row);
      for (const child of [...(children.get(key) || [])].reverse()) stack.push({ page: child, depth: Math.min(row.depth + 1, 8) });
    }
  };
  roots.forEach(walk);
  sorted.forEach(walk); // malformed/cyclic orphans still remain accessible
  return rows;
}
