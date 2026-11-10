// [[Wiki link]] parsing and target resolution against the docs collection.
import { dirname, normalizePath, stripExt } from './paths.js';
import { githubSlug } from './slugger.js';

export function parseWikiTarget(inner) {
  const pipe = inner.indexOf('|');
  const label = pipe === -1 ? null : inner.slice(pipe + 1) || null;
  const head = pipe === -1 ? inner : inner.slice(0, pipe);
  const hashIdx = head.indexOf('#');
  const target = (hashIdx === -1 ? head : head.slice(0, hashIdx)).trim();
  const anchor = hashIdx === -1 ? null : head.slice(hashIdx + 1).trim() || null;
  return { target, anchor, label };
}

const norm = (s) => s.toLowerCase().replace(/[\s_-]+/g, '-');

export function buildResolver(docs, metaByPath = new Map()) {
  const byPath = new Map();
  const byPathNoExt = new Map();
  const byBase = new Map();
  const put = (map, key, doc) => {
    if (!key) return;
    const list = map.get(key);
    if (list) list.push(doc);
    else map.set(key, [doc]);
  };
  for (const doc of docs) {
    const lower = doc.path.toLowerCase();
    put(byPath, lower, doc);
    put(byPathNoExt, stripExt(lower), doc);
    put(byBase, norm(stripExt(doc.path.slice(doc.path.lastIndexOf('/') + 1))), doc);
  }
  const byTitle = new Map();
  for (const [path, meta] of metaByPath) {
    if (meta && typeof meta.title === 'string' && meta.title) {
      const doc = docs.find((d) => d.path === path);
      if (doc) put(byTitle, norm(meta.title), doc);
    }
  }

  function choose(cands, fromPath) {
    if (cands.length === 1) return cands[0];
    const fromDir = dirname(fromPath || '');
    const sameDir = cands.filter((d) => dirname(d.path) === fromDir);
    const pool = sameDir.length ? sameDir : cands;
    return pool.slice().sort((a, b) => {
      const segA = a.path.split('/').length;
      const segB = b.path.split('/').length;
      return segA - segB || a.path.length - b.path.length || (a.path < b.path ? -1 : 1);
    })[0];
  }

  return {
    resolve(rawTarget, fromPath = '') {
      const hashIdx = rawTarget.indexOf('#');
      const targetPart = (hashIdx === -1 ? rawTarget : rawTarget.slice(0, hashIdx)).trim();
      const anchorPart = hashIdx === -1 ? null : rawTarget.slice(hashIdx + 1).trim();
      if (!targetPart) return null;
      const anchor = anchorPart ? githubSlug(anchorPart) : null;

      const cleaned = (normalizePath(targetPart) ?? targetPart).toLowerCase();
      let cands =
        byPath.get(cleaned) ??
        byPathNoExt.get(cleaned) ??
        (cleaned.includes('/')
          ? docs.filter((d) => {
              const p = stripExt(d.path.toLowerCase());
              return p.endsWith('/' + cleaned) || p === cleaned;
            })
          : null);
      if (!cands || !cands.length) cands = byBase.get(norm(targetPart));
      if (!cands || !cands.length) cands = byTitle.get(norm(targetPart));
      if (!cands || !cands.length) return null;
      return { path: choose(cands, fromPath).path, anchor };
    },
  };
}
