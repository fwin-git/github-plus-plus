// Pure path helpers for repo-root-relative paths ("docs/guide/setup.md").
// No leading slashes in normalized form; "" means the repo root directory.

const MD_EXTS = new Set(['.md', '.mdx', '.markdown', '.mdown']);

export function normalizePath(p) {
  if (typeof p !== 'string') return null;
  const out = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!out.length) return null;
      out.pop();
    } else {
      out.push(part);
    }
  }
  return out.join('/');
}

export function resolveRelative(fromFile, href) {
  let decoded = href;
  try {
    decoded = decodeURIComponent(href);
  } catch {
    // malformed escape: use as-is
  }
  if (decoded.startsWith('/')) return normalizePath(decoded);
  const dir = dirname(fromFile);
  return normalizePath(dir ? `${dir}/${decoded}` : decoded);
}

export function dirname(p) {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

export function basename(p) {
  return p.slice(p.lastIndexOf('/') + 1);
}

export function extname(p) {
  const name = basename(p);
  const m = /\.[A-Za-z0-9]+$/.exec(name);
  return m ? m[0].toLowerCase() : '';
}

export function stripExt(p) {
  const ext = extname(p);
  return ext ? p.slice(0, -ext.length) : p;
}

export function isMarkdownPath(p) {
  return MD_EXTS.has(extname(p));
}

export function splitAnchor(href) {
  const i = href.indexOf('#');
  if (i === -1) return { path: href, anchor: null };
  return { path: href.slice(0, i), anchor: href.slice(i + 1) || null };
}

export function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}
