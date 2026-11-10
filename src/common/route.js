// Hash routing: "#docs" (index), "#docs/<encoded path>", optional "?h=<slug>".
import { encodePath } from './paths.js';
import { normalizeSite, validId } from './confluence.js';

export function parseHash(hash) {
  let h = hash || '';
  if (h.startsWith('#')) h = h.slice(1);
  if (h.startsWith('docs?')) {
    const params = new URLSearchParams(h.slice(5));
    if (params.get('source') !== 'confluence') return null;
    try {
      return { source: 'confluence', site: normalizeSite(params.get('site')), pageId: validId(params.get('page')), heading: params.get('h') || null };
    } catch { return null; }
  }
  if (h !== 'docs' && !h.startsWith('docs/')) return null;
  let rest = h === 'docs' ? '' : h.slice('docs/'.length);
  let heading = null;
  const q = rest.indexOf('?');
  if (q !== -1) {
    heading = new URLSearchParams(rest.slice(q + 1)).get('h') || null;
    rest = rest.slice(0, q);
  }
  let path = rest;
  try {
    path = decodeURIComponent(rest);
  } catch {
    // malformed escape: use as-is
  }
  return { path: path || null, heading };
}

export function buildConfluenceHash({ site, pageId, heading = null }) {
  const params = new URLSearchParams({ source: 'confluence', site: normalizeSite(site), page: validId(pageId) });
  if (heading) params.set('h', heading);
  return '#docs?' + params;
}

export function buildHash({ path = null, heading = null } = {}) {
  let h = '#docs';
  if (path) h += '/' + encodePath(path);
  if (heading) h += '?h=' + encodeURIComponent(heading);
  return h;
}
