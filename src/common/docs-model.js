// Pure model: turns a flat git tree into the docs collection and nav tree.
import { basename, dirname, extname, isMarkdownPath, stripExt } from './paths.js';

export const DEFAULT_FOLDERS = [
  'docs',
  'doc',
  'documentation',
  'wiki',
  'guides',
  'guide',
  'handbook',
  'manual',
  '.github',
  'website/docs',
];

export function prettifyName(filename) {
  return stripExt(filename);
}

export function isIndexName(name) {
  return /^(readme|index)\.[a-z]+$/i.test(name);
}

export function collectDocs(entries, { folders = DEFAULT_FOLDERS, includeRootFiles = true, maxFiles = 500 } = {}) {
  const single = new Set();
  const multi = [];
  for (const f of folders) {
    const norm = String(f).trim().toLowerCase().replace(/^\/+|\/+$/g, '');
    if (!norm) continue;
    if (norm.includes('/')) multi.push(norm.split('/'));
    else single.add(norm);
  }
  const docs = [];
  let total = 0;
  for (const e of entries) {
    if (!e || e.type !== 'blob' || typeof e.path !== 'string' || !isMarkdownPath(e.path)) continue;
    const dir = dirname(e.path);
    let included;
    if (!dir) {
      included = includeRootFiles;
    } else {
      const segs = dir.toLowerCase().split('/');
      included = segs.some((s) => single.has(s)) || multi.some((pat) => hasConsecutive(segs, pat));
    }
    if (!included) continue;
    total++;
    if (docs.length < maxFiles) {
      const name = basename(e.path);
      docs.push({
        path: e.path,
        sha: e.sha,
        size: e.size ?? 0,
        name,
        dir,
        title: prettifyName(name),
        ext: extname(e.path),
      });
    }
  }
  return { docs, truncated: total > docs.length, total };
}

function hasConsecutive(segs, pat) {
  outer: for (let i = 0; i + pat.length <= segs.length; i++) {
    for (let j = 0; j < pat.length; j++) {
      if (segs[i + j] !== pat[j]) continue outer;
    }
    return true;
  }
  return false;
}

export function buildTree(docs) {
  const root = { name: '', path: '', isDir: true, children: [] };
  const dirNodes = new Map([['', root]]);
  const ensureDir = (path) => {
    let node = dirNodes.get(path);
    if (node) return node;
    const parent = ensureDir(dirname(path));
    node = { name: basename(path), path, isDir: true, children: [] };
    parent.children.push(node);
    dirNodes.set(path, node);
    return node;
  };
  for (const doc of docs) {
    ensureDir(doc.dir).children.push({ name: doc.name, path: doc.path, isDir: false, children: [], doc });
  }
  return root;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortTree(root, metaByPath = new Map()) {
  const orderOf = (node) => {
    if (node.isDir) return Infinity;
    const meta = metaByPath.get(node.path);
    const o = meta ? meta.order ?? meta.sidebar_position : undefined;
    return typeof o === 'number' ? o : Infinity;
  };
  const rank = (node) => (!node.isDir && isIndexName(node.name) ? 0 : 1);
  const label = (node) => {
    if (node.isDir) return node.name;
    const meta = metaByPath.get(node.path);
    return (meta && meta.title) || node.doc.title;
  };
  const cmp = (a, b) => rank(a) - rank(b) || orderOf(a) - orderOf(b) || collator.compare(label(a), label(b));
  const walk = (node) => {
    node.children.sort(cmp);
    for (const c of node.children) if (c.isDir) walk(c);
  };
  walk(root);
  return root;
}

export function flattenTree(root) {
  const out = [];
  const walk = (node) => {
    for (const c of node.children) {
      if (c.isDir) walk(c);
      else out.push(c.doc);
    }
  };
  walk(root);
  return out;
}

export function findNode(root, path) {
  if (!path) return root;
  let node = root;
  while (node) {
    const next = node.children.find((c) => c.path === path || (c.isDir && path.startsWith(c.path + '/')));
    if (!next) return null;
    if (next.path === path) return next;
    node = next;
  }
  return null;
}

// Display-title precedence. 'heading' mode: a declared frontmatter title
// always beats the headline derived from content, which beats the filename.
// 'filename' mode: the filename, full stop (titles only as last resort when
// there is no filename, e.g. dynamically loaded docs).
export function displayDocTitle({ fmTitle, headingTitle, fallback }, mode) {
  if (mode === 'filename') return fallback || fmTitle || headingTitle || '';
  return fmTitle || headingTitle || fallback || '';
}

export function dirIndexDoc(dirNode) {
  if (!dirNode || !dirNode.isDir) return null;
  const hit = dirNode.children.find((c) => !c.isDir && isIndexName(c.name));
  return hit ? hit.doc : null;
}
