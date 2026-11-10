// Organization-wide docs: remembered repo selection + a cross-repo content
// index built from each repo's (ETag-cached) tree and file contents.
import { ext } from '../common/browser.js';
import { ContentIndex } from '../common/search.js';
import { collectDocs } from '../common/docs-model.js';
import { parseFrontmatter, normalizeTags, docTitle } from '../common/frontmatter.js';
import { mdToPlainText, extractHeadings, bestHeadingTitle } from '../common/md-text.js';
import { makeClient } from './github-api.js';

// Separates repo from path in index keys; NUL never appears in git paths.
export const ORG_SEP = '\u0000';

const selKey = (owner) => `gdt:org:${owner}`;
const snapKey = (owner) => `gdt:orgsnap:${owner}`;
const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function loadOrgSelection(owner) {
  try {
    return (await ext.storage.local.get(selKey(owner)))[selKey(owner)] ?? null;
  } catch {
    return null;
  }
}

export async function saveOrgSelection(owner, repos) {
  await ext.storage.local.set({ [selKey(owner)]: { repos, savedAt: Date.now() } });
}

// Lightweight snapshot for auto-restore: repo -> doc listings (small strings,
// no file contents). Powers the grouped sidebar instantly on reload; the
// full-text index is rebuilt in the background from these listings.
export async function saveOrgSnapshot(owner, repoDocs) {
  const entries = [...repoDocs.entries()].map(([repo, docs]) => [
    repo,
    docs.map((d) => ({ path: d.path, sha: d.sha, size: d.size, name: d.name, dir: d.dir, title: d.title, ext: d.ext })),
  ]);
  try {
    await ext.storage.local.set({ [snapKey(owner)]: { entries, savedAt: Date.now() } });
  } catch {
    // storage quota exceeded on a very large org: skip persistence, memory still works
  }
}

export async function loadOrgSnapshot(owner) {
  try {
    const snap = (await ext.storage.local.get(snapKey(owner)))[snapKey(owner)];
    if (!snap || !Array.isArray(snap.entries)) return null;
    if (Date.now() - (snap.savedAt || 0) > SNAPSHOT_TTL_MS) return null;
    return new Map(snap.entries);
  } catch {
    return null;
  }
}

export async function clearOrgSnapshot(owner) {
  try {
    await ext.storage.local.remove(snapKey(owner));
  } catch {
    // ignore
  }
}

// Rebuild only the content index from known doc listings (no tree calls,
// trees are cache-backed anyway). Used to restore org search after a reload.
export async function indexOrgContent({ owner, repoDocs, settings, onProgress = () => {} }) {
  const index = new ContentIndex();
  const repos = [...repoDocs.keys()];
  const total = repos.length;
  for (const [i, repo] of repos.entries()) {
    const docs = repoDocs.get(repo) || [];
    const client = makeClient({ owner, repo, token: settings.token, candidateFolders: settings.docsFolders });
    const limit = (settings.contentSearchLimitKB || 200) * 1024;
    const queue = docs.filter((d) => !d.size || d.size <= limit);
    const filesTotal = queue.length;
    let filesDone = 0;
    onProgress({ repo, index: i + 1, total, filesDone, filesTotal });
    const worker = async () => {
      while (queue.length) {
        const doc = queue.shift();
        try {
          const source = await client.getRawText(doc.path, { sha: doc.sha });
          const { data, content } = parseFrontmatter(source);
          index.add(`${repo}${ORG_SEP}${doc.path}`, {
            text: mdToPlainText(content),
            title: doc.title,
            headings: extractHeadings(content),
            tags: normalizeTags(data),
          });
        } catch {
          // unreadable file: skip
        } finally {
          filesDone++;
          onProgress({ repo, index: i + 1, total, filesDone, filesTotal });
        }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
  }
  return index;
}

// onProgress receives structured events:
//   {repo, index, total, phase: 'tree'}                     — listing the repo
//   {repo, index, total, phase: 'content', filesDone, filesTotal}
//   {repo, index, total, phase: 'done', docsCount}
//   {repo, index, total, phase: 'error', message}
export async function buildOrgIndex({ owner, repoNames, settings, onProgress = () => {} }) {
  const index = new ContentIndex();
  const repoDocs = new Map();
  const errors = [];
  const total = repoNames.length;
  for (const [i, repo] of repoNames.entries()) {
    const base = { repo, index: i + 1, total };
    onProgress({ ...base, phase: 'tree' });
    try {
      const client = makeClient({
        owner,
        repo,
        token: settings.token,
        candidateFolders: settings.docsFolders,
      });
      const treeRes = await client.getTree();
      const { docs } = collectDocs(treeRes.entries, {
        folders: settings.docsFolders,
        includeRootFiles: settings.includeRootFiles,
        maxFiles: settings.maxFiles,
      });
      const limit = (settings.contentSearchLimitKB || 200) * 1024;
      const queue = docs.filter((d) => !d.size || d.size <= limit);
      const filesTotal = queue.length;
      let filesDone = 0;
      onProgress({ ...base, phase: 'content', filesDone, filesTotal });
      const worker = async () => {
        while (queue.length) {
          const doc = queue.shift();
          try {
            const source = await client.getRawText(doc.path, { sha: doc.sha });
            const { data, content } = parseFrontmatter(source);
            doc.title = docTitle(data, '') || bestHeadingTitle(content) || doc.title;
            index.add(`${repo}${ORG_SEP}${doc.path}`, {
              text: mdToPlainText(content),
              title: doc.title,
              headings: extractHeadings(content),
              tags: normalizeTags(data),
            });
          } catch {
            // unreadable file: skip
          } finally {
            filesDone++;
            onProgress({ ...base, phase: 'content', filesDone, filesTotal });
          }
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
      repoDocs.set(repo, docs);
      onProgress({ ...base, phase: 'done', docsCount: docs.length });
    } catch (err) {
      const message = (err && err.message) || String(err);
      errors.push({ repo, message });
      onProgress({ ...base, phase: 'error', message });
    }
  }
  return { index, repoDocs, errors };
}
