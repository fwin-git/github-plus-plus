// Hash routing: "#docs" (index), "#docs/<encoded path>", optional "?h=<slug>".
import { encodePath } from './paths.js';

export function parseHash(hash) {
  let h = hash || '';
  if (h.startsWith('#')) h = h.slice(1);
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

export function buildHash({ path = null, heading = null } = {}) {
  let h = '#docs';
  if (path) h += '/' + encodePath(path);
  if (heading) h += '?h=' + encodeURIComponent(heading);
  return h;
}
