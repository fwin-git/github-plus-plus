// The docs viewer UI: mounts inside GitHub's <main>, hides the original page
// content (restored on close), and renders sidebar tree / article / TOC /
// search. All remote markdown goes through render-doc.js (DOMPurify).
import {
  buildTree,
  sortTree,
  flattenTree,
  findNode,
  dirIndexDoc,
  displayDocTitle,
} from '../common/docs-model.js';
import { buildResolver } from '../common/wikilinks.js';
import { ContentIndex } from '../common/search.js';
import { normalizeTags, docTitle, parseFrontmatter, isPinned } from '../common/frontmatter.js';
import { resolveRelative, splitAnchor, isMarkdownPath, dirname, basename } from '../common/paths.js';
import { buildHash, buildConfluenceHash } from '../common/route.js';
import { githubSlug } from '../common/slugger.js';
import { mdToPlainText, extractHeadings, bestHeadingTitle } from '../common/md-text.js';
import { buildUnifiedPatch } from '../common/diff.js';
import { defaultCommitMessage, branchNameFor, editPageUrl } from '../common/edit-utils.js';
import { ext } from '../common/browser.js';
import { saveSettings } from '../common/settings.js';
import { createMarkdownIt } from './markdown.js';
import { renderDoc } from './render-doc.js';
import { createSearchUI } from './search-ui.js';
import { loadDrafts, saveDraft, removeDraft, clearDrafts } from './drafts.js';
import { loadOrgSelection, saveOrgSelection, buildOrgIndex, saveOrgSnapshot, loadOrgSnapshot, clearOrgSnapshot, indexOrgContent, ORG_SEP } from './org.js';
import { getCachedShaSet, repoContentCached } from './blob-cache.js';
import { RateLimitError } from './github-api.js';
import { createConfluenceViewer } from './confluence-viewer.js';
import { renderConfluence } from './confluence-render.js';
import { pageUrl } from '../common/confluence.js';

const ICONS = {
  chevron:
    '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"></path></svg>',
  file:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z"></path></svg>',
  folder:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"></path></svg>',
  pin:
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M4.456.734a1.75 1.75 0 0 1 2.826.504l.613 1.327a3.081 3.081 0 0 0 2.084 1.707l2.454.584c1.332.317 1.8 1.972.832 2.94L11.06 10l3.72 3.72a.749.749 0 1 1-1.06 1.06L10 11.06l-2.204 2.205c-.968.968-2.623.5-2.94-.832l-.584-2.454a3.081 3.081 0 0 0-1.707-2.084l-1.327-.613a1.75 1.75 0 0 1-.504-2.826L4.456.734ZM5.92 1.866a.25.25 0 0 0-.404-.072L1.794 5.516a.25.25 0 0 0 .072.404l1.328.613A4.582 4.582 0 0 1 5.73 9.63l.584 2.454a.25.25 0 0 0 .42.12l5.47-5.47a.25.25 0 0 0-.12-.42L9.63 5.73a4.581 4.581 0 0 1-3.098-2.537L5.92 1.866Z"></path></svg>',
  org:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M1.75 16A1.75 1.75 0 0 1 0 14.25V1.75C0 .784.784 0 1.75 0h8.5C11.216 0 12 .784 12 1.75v12.5c0 .085-.006.168-.018.25h2.268a.25.25 0 0 0 .25-.25V8.285a.25.25 0 0 0-.111-.208l-1.055-.703a.749.749 0 1 1 .832-1.248l1.055.703c.487.325.779.871.779 1.456v5.965A1.75 1.75 0 0 1 14.25 16h-3.5a.766.766 0 0 1-.197-.026c-.099.017-.2.026-.303.026h-3a.75.75 0 0 1-.75-.75V14h-1v1.25a.75.75 0 0 1-.75.75Zm-.25-1.75c0 .138.112.25.25.25H4v-1.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 .75.75v1.25h2.25a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25ZM3.75 6h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1 0-1.5ZM3 3.75A.75.75 0 0 1 3.75 3h.5a.75.75 0 0 1 0 1.5h-.5A.75.75 0 0 1 3 3.75Zm4 3A.75.75 0 0 1 7.75 6h.5a.75.75 0 0 1 0 1.5h-.5A.75.75 0 0 1 7 6.75ZM7.75 3h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1 0-1.5ZM3 9.75A.75.75 0 0 1 3.75 9h.5a.75.75 0 0 1 0 1.5h-.5A.75.75 0 0 1 3 9.75ZM7.75 9h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1 0-1.5Z"></path></svg>',
  heading:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M3.75 2a.75.75 0 0 1 .75.75V7h7V2.75a.75.75 0 0 1 1.5 0v10.5a.75.75 0 0 1-1.5 0V8.5h-7v4.75a.75.75 0 0 1-1.5 0V2.75A.75.75 0 0 1 3.75 2Z"></path></svg>',
  search:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z"></path></svg>',
  refresh:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z"></path></svg>',
  github:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path></svg>',
  edit:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z"></path></svg>',
  theme:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0Zm0 1.5v13a6.5 6.5 0 0 0 0-13Z"></path></svg>',
  sun:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-1.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm5.657-8.157a.75.75 0 0 1 0 1.061l-1.061 1.06a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l1.06-1.06a.75.75 0 0 1 1.06 0Zm-9.193 9.193a.75.75 0 0 1 0 1.06l-1.06 1.061a.75.75 0 1 1-1.061-1.06l1.06-1.061a.75.75 0 0 1 1.061 0ZM8 0a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0V.75A.75.75 0 0 1 8 0ZM3 8a.75.75 0 0 1-.75.75H.75a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 3 8Zm13 0a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 16 8Zm-8 5a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 8 13Zm3.536-1.464a.75.75 0 0 1 1.06 0l1.061 1.06a.75.75 0 0 1-1.06 1.061l-1.061-1.06a.75.75 0 0 1 0-1.061ZM2.343 2.343a.75.75 0 0 1 1.061 0l1.06 1.061a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018l-1.06-1.06a.75.75 0 0 1 0-1.06Z"></path></svg>',
  moon:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M9.598 1.591a.749.749 0 0 1 .785-.175 7.001 7.001 0 1 1-8.967 8.967.75.75 0 0 1 .961-.96 5.5 5.5 0 0 0 7.046-7.046.75.75 0 0 1 .175-.786Zm1.616 1.945a7 7 0 0 1-7.678 7.678 5.499 5.499 0 1 0 7.678-7.678Z"></path></svg>',
  link:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="m7.775 3.275 1.25-1.25a3.5 3.5 0 1 1 4.95 4.95l-2.5 2.5a3.5 3.5 0 0 1-4.95 0 .751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018 2 2 0 0 0 2.83 0l2.5-2.5a2.002 2.002 0 0 0-2.83-2.83l-1.25 1.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042Zm-4.69 9.64a2 2 0 0 0 2.83 0l1.25-1.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042l-1.25 1.25a3.5 3.5 0 1 1-4.95-4.95l2.5-2.5a3.5 3.5 0 0 1 4.95 0 .751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018 2 2 0 0 0-2.83 0l-2.5 2.5a2.002 2.002 0 0 0 0 2.83Z"></path></svg>',
  branch:
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"></path></svg>',
  copy:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>',
  check:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>',
  external:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z"></path></svg>',
  menu:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M1 2.75A.75.75 0 0 1 1.75 2h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 2.75Zm0 5A.75.75 0 0 1 1.75 7h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 7.75ZM1.75 12h12.5a.75.75 0 0 1 0 1.5H1.75a.75.75 0 0 1 0-1.5Z"></path></svg>',
};

export function createViewer({ client, settings, docs, truncated, total, onRequestRefresh, confluenceSites = [], githubError = null }) {
  const docByPath = new Map(docs.map((d) => [d.path, d]));
  const metaByPath = new Map();
  const contentCache = new Map();
  const index = new ContentIndex();
  const tree = buildTree(docs);
  sortTree(tree, new Map());
  let flat = flattenTree(tree);

  let resolver = null;
  let resolverDirty = true;
  let root = null;
  let refs = null;
  let searchUI = null;
  let mounted = false;
  let disposed = false;
  let searchPrepared = false;
  const searchListeners = new Set();
  const notifySearch = () => { if (!disposed) for (const fn of searchListeners) fn(); };
  let currentPath = null;
  let confluenceRoute = null;
  let loadSeq = 0;
  let origTitle = null;
  let keydownHandler = null;
  let tocObserver = null;
  const expansion = new Set();
  const indexState = { started: false, finished: false, done: 0, total: docs.length };
  let theme = settings.theme || 'auto';
  let titleMode = settings.titleMode === 'filename' ? 'filename' : 'heading';
  let treeFilter = '';
  let editor = null; // { path, original, savedDraftContent, el, textarea, preview, status, dirty, buttons }
  let drafts = {}; // { [path]: {content, baseSha, savedAt} } — staged session edits
  let orgSession = null; // { org, index, repoDocs, totalDocs, errors }
  const orgExpanded = new Set([client.repo]);
  const confluence = confluenceSites.length ? createConfluenceViewer({
    sites: confluenceSites,
    repository: `${client.owner}/${client.repo}`.toLowerCase(),
    onChange: () => { if (mounted) renderTree(); notifySearch(); },
  }) : null;
  loadDrafts(client.owner, client.repo).then((d) => {
    drafts = d;
    if (mounted) {
      renderTree();
    }
  });

  // ---- markdown context -----------------------------------------------------

  function ensureResolver() {
    if (resolverDirty) {
      resolver = buildResolver(docs, resolverMeta());
      resolverDirty = false;
    }
    return resolver;
  }

  function parseGithubFileUrl(href) {
    let u;
    try {
      u = new URL(href);
    } catch {
      return null;
    }
    const segs = u.pathname.split('/').filter(Boolean);
    if (u.hostname === 'github.com' && segs.length >= 5 && ['blob', 'tree', 'raw'].includes(segs[2])) {
      return {
        owner: segs[0],
        repo: segs[1],
        path: segs.slice(4).map(decodeURIComponent).join('/'),
        anchor: u.hash ? u.hash.slice(1).replace(/^user-content-/, '') : null,
      };
    }
    if (u.hostname === 'raw.githubusercontent.com' && segs.length >= 4) {
      return { owner: segs[0], repo: segs[1], path: segs.slice(3).map(decodeURIComponent).join('/'), anchor: null };
    }
    return null;
  }

  const ctx = {
    resolveWikiLink(raw, from) {
      return ensureResolver().resolve(raw, from ?? currentPath ?? '');
    },
    classifyHref(href, from) {
      if (!href) return null;
      if (href.startsWith('#')) return { type: 'anchor', href, anchor: href.slice(1) };
      if (href.startsWith('//')) return { type: 'external', href: 'https:' + href };
      const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href);
      if (scheme) {
        const s = scheme[1].toLowerCase();
        if (s === 'http' || s === 'https') {
          const gh = parseGithubFileUrl(href);
          if (
            gh &&
            gh.owner.toLowerCase() === client.owner.toLowerCase() &&
            gh.repo.toLowerCase() === client.repo.toLowerCase() &&
            isMarkdownPath(gh.path)
          ) {
            const type = docByPath.has(gh.path) ? 'doc' : 'dyn-doc';
            return { type, path: gh.path, anchor: gh.anchor, href: buildHash({ path: gh.path, heading: gh.anchor }) };
          }
          return { type: 'external', href };
        }
        return { type: 'plain', href };
      }
      const { path: p, anchor } = splitAnchor(href);
      if (!p) return { type: 'anchor', href, anchor };
      const resolved = resolveRelative(from ?? currentPath ?? '', p);
      if (!resolved) return { type: 'plain', href };
      if (isMarkdownPath(resolved)) {
        const type = docByPath.has(resolved) ? 'doc' : 'dyn-doc';
        return { type, path: resolved, anchor, href: buildHash({ path: resolved, heading: anchor }) };
      }
      const node = findNode(tree, resolved);
      if (node && node.isDir) {
        const idx = dirIndexDoc(node);
        if (idx) return { type: 'doc', path: idx.path, anchor, href: buildHash({ path: idx.path, heading: anchor }) };
      }
      return { type: 'repo-file', href: client.blobUrl(resolved) + (anchor ? '#' + anchor : ''), path: resolved };
    },
    imageUrl(src, from) {
      if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) return src;
      const resolved = resolveRelative(from ?? currentPath ?? '', src);
      return resolved ? client.rawUrl(resolved) : src;
    },
  };

  const md = createMarkdownIt(ctx);

  // ---- metadata -------------------------------------------------------------

  // Frontmatter and heading-derived titles are stored separately; which one a
  // label shows depends on the sidebar title mode (toggle in the side head).
  function recordMeta(path, data, headingTitle) {
    const doc = docByPath.get(path);
    const prev = metaByPath.get(path);
    const rec = {
      fmTitle: data ? docTitle(data, '') || null : (prev && prev.fmTitle) ?? null,
      headingTitle: headingTitle !== undefined ? headingTitle : (prev && prev.headingTitle) ?? null,
      tags: data ? normalizeTags(data) : (prev && prev.tags) ?? [],
      order: data && typeof data.order === 'number' ? data.order : prev && prev.order,
      sidebar_position:
        data && typeof data.sidebar_position === 'number' ? data.sidebar_position : prev && prev.sidebar_position,
      pinned: data ? isPinned(data) : (prev && prev.pinned) ?? false,
      data: data ?? (prev && prev.data) ?? null,
    };
    metaByPath.set(path, rec);
    resolverDirty = true;
    return displayTitleOf(rec, doc) !== (prev ? displayTitleOf(prev, doc) : doc && doc.title);
  }

  function displayTitleOf(rec, doc) {
    return displayDocTitle(
      {
        fmTitle: rec ? rec.fmTitle : null,
        headingTitle: rec ? rec.headingTitle : null,
        fallback: doc ? doc.title : null,
      },
      titleMode
    );
  }

  function displayTitle(path) {
    return displayTitleOf(metaByPath.get(path), docByPath.get(path)) || basename(path);
  }

  // Mode-aware view for sorting, tree labels, and search result titles.
  function displayMeta() {
    const m = new Map();
    for (const [path, rec] of metaByPath) {
      m.set(path, { ...rec, title: displayTitleOf(rec, docByPath.get(path)) || undefined });
    }
    return m;
  }

  // Mode-independent titles for wiki-link resolution: both declared and
  // heading titles should resolve regardless of the display toggle.
  function resolverMeta() {
    const m = new Map();
    for (const [path, rec] of metaByPath) {
      const t = rec.fmTitle || rec.headingTitle;
      if (t) m.set(path, { title: t });
    }
    return m;
  }

  // Both search surfaces use the same sources, ordering, and navigation.
  function searchOptions() {
    return {
      getDocs: () => docs,
      getMeta: () => displayMeta(),
      getIndex: () => index,
      getIndexState: () => indexState,
      getConfluenceResults: parsed => confluence?.search(parsed) || [],
      getOrgResults: (parsed) => {
        if (!orgSession || !orgSession.index.size) return [];
        return orgSession.index.search(parsed, { limit: 12 }).map((r) => {
          const sep = r.path.indexOf(ORG_SEP);
          const repo = r.path.slice(0, sep);
          const path = r.path.slice(sep + 1);
          const doc = (orgSession.repoDocs.get(repo) || []).find((d) => d.path === path);
          return {
            href: `/${client.owner}/${repo}${buildHash({ path, heading: r.matchedHeading ? githubSlug(r.matchedHeading) : null })}`,
            title: (doc && doc.title) || basename(path),
            subtitle: `${repo} › ${path}`,
            snippet: r.snippet && r.snippet.text ? r.snippet : null,
          };
        });
      },
      onNavigate: ({ path, heading, href }) => {
        if (href) {
          location.href = href;
          return;
        }
        location.hash = buildHash({ path, heading });
      },
      subscribe(listener) { searchListeners.add(listener); return () => searchListeners.delete(listener); },
    };
  }

  function prepareSearch() {
    if (searchPrepared || disposed) return;
    searchPrepared = true;
    void startIndexing();
    void maybeRestoreOrg();
    confluence?.start().catch(() => {});
  }

  // ---- DOM scaffold ---------------------------------------------------------

  function h(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function buildDom() {
    root = h(`
      <div id="gdt-root" data-gdt-theme="${theme}">
        <div class="gdt-shell">
          <aside class="gdt-sidebar" data-gdt-sidebar>
            <div class="gdt-org-title" data-gdt-org-title hidden>
              ${ICONS.org}
              <span class="gdt-org-title-name" data-gdt-org-title-name></span>
              <button type="button" class="gdt-draft-x" data-gdt-org-exit title="Leave organization mode">×</button>
            </div>
            <div class="gdt-side-head">
              <span class="gdt-doc-count" data-gdt-count-label></span>
              <span class="gdt-side-actions">
                <button class="gdt-iconbtn" data-gdt-org type="button" title="Search across the whole organization…">${ICONS.org}</button>
                <button class="gdt-iconbtn" data-gdt-title-toggle type="button"></button>
                <button class="gdt-iconbtn" data-gdt-refresh type="button" title="Refresh docs list">${ICONS.refresh}</button>
              </span>
            </div>
            <div class="gdt-truncated" data-gdt-truncated hidden></div>
            <input class="gdt-filter-input" data-gdt-filter type="search" placeholder="Filter files…" autocomplete="off" spellcheck="false" aria-label="Filter file tree" />
            <div class="gdt-tags" data-gdt-tags hidden></div>
            <div class="gdt-pinned" data-gdt-pinned hidden>
              <div class="gdt-pinned-title">${ICONS.pin} Pinned</div>
              <div class="gdt-pinned-list" data-gdt-pinned-list></div>
            </div>
            <div class="gdt-drafts" data-gdt-drafts hidden>
              <div class="gdt-drafts-title">${ICONS.edit} Drafts <span data-gdt-drafts-count></span></div>
              <div class="gdt-drafts-list" data-gdt-drafts-list></div>
              <div class="gdt-drafts-actions">
                <button type="button" class="gdt-btn gdt-btn-sm gdt-btn-primary" data-gdt-publish-session>Publish session…</button>
                <button type="button" class="gdt-btn gdt-btn-sm" data-gdt-discard-session>Discard all</button>
              </div>
            </div>
            <nav class="gdt-tree" data-gdt-tree aria-label="Documentation files"></nav>
            <div class="gdt-side-foot" data-gdt-progress hidden aria-live="polite"></div>
          </aside>
          <div class="gdt-main">
            <header class="gdt-topbar">
              <button class="gdt-iconbtn gdt-side-toggle" data-gdt-side-toggle type="button" title="Toggle sidebar">${ICONS.menu}</button>
              <nav class="gdt-breadcrumbs" data-gdt-crumbs aria-label="Breadcrumb"></nav>
              <div class="gdt-searchbox">
                <span class="gdt-search-icon">${ICONS.search}</span>
                <input class="gdt-search-input" data-gdt-search type="search" aria-label="Search docs" placeholder="Search docs…  (Cmd/Ctrl+K or /)" autocomplete="off" spellcheck="false" />
                <div class="gdt-search-results" data-gdt-results hidden></div>
              </div>
              <div class="gdt-actions">
                <button class="gdt-iconbtn" data-gdt-copy-link type="button" title="Copy deep link to this document" disabled>${ICONS.link}</button>
                <button class="gdt-iconbtn" data-gdt-copy-md type="button" title="Copy document markdown" disabled>${ICONS.copy}</button>
                <button class="gdt-iconbtn" data-gdt-live-edit type="button" title="Edit this document in the viewer" disabled>${ICONS.edit}</button>
                <button class="gdt-iconbtn" data-gdt-theme-toggle type="button" title="Theme: auto">${ICONS.theme}</button>
                <a class="gdt-iconbtn" data-gdt-open-gh target="_blank" rel="noopener noreferrer" title="View on GitHub">${ICONS.github}</a>
                <a class="gdt-iconbtn" data-gdt-edit-gh target="_blank" rel="noopener noreferrer" title="Edit on GitHub (opens github.com editor)">${ICONS.external}</a>
              </div>
            </header>
            <div class="gdt-body">
              <article class="gdt-article" data-gdt-article></article>
              <aside class="gdt-toc" data-gdt-toc hidden aria-label="On this page"></aside>
            </div>
          </div>
        </div>
      </div>
    `);
    refs = {
      sidebar: root.querySelector('[data-gdt-sidebar]'),
      countLabel: root.querySelector('[data-gdt-count-label]'),
      truncatedBox: root.querySelector('[data-gdt-truncated]'),
      filter: root.querySelector('[data-gdt-filter]'),
      tags: root.querySelector('[data-gdt-tags]'),
      pinned: root.querySelector('[data-gdt-pinned]'),
      pinnedList: root.querySelector('[data-gdt-pinned-list]'),
      orgTitle: root.querySelector('[data-gdt-org-title]'),
      orgTitleName: root.querySelector('[data-gdt-org-title-name]'),
      draftsBox: root.querySelector('[data-gdt-drafts]'),
      draftsList: root.querySelector('[data-gdt-drafts-list]'),
      draftsCount: root.querySelector('[data-gdt-drafts-count]'),
      tree: root.querySelector('[data-gdt-tree]'),
      progress: root.querySelector('[data-gdt-progress]'),
      titleToggle: root.querySelector('[data-gdt-title-toggle]'),
      liveEdit: root.querySelector('[data-gdt-live-edit]'),
      copyMd: root.querySelector('[data-gdt-copy-md]'),
      copyLink: root.querySelector('[data-gdt-copy-link]'),
      crumbs: root.querySelector('[data-gdt-crumbs]'),
      searchInput: root.querySelector('[data-gdt-search]'),
      results: root.querySelector('[data-gdt-results]'),
      article: root.querySelector('[data-gdt-article]'),
      toc: root.querySelector('[data-gdt-toc]'),
      themeToggle: root.querySelector('[data-gdt-theme-toggle]'),
      openGh: root.querySelector('[data-gdt-open-gh]'),
      editGh: root.querySelector('[data-gdt-edit-gh]'),
    };

    searchUI = createSearchUI({
      input: refs.searchInput,
      panel: refs.results,
      ...searchOptions(),
    });

    root.querySelector('[data-gdt-refresh]').addEventListener('click', () => {
      // In organization mode the refresh button re-opens the repo picker so
      // you can change the selection and re-index; otherwise it refreshes the
      // current repo's document listing.
      if (orgSession) openOrgModal();
      else if (onRequestRefresh) onRequestRefresh();
    });
    updateTitleToggle();
    refs.titleToggle.addEventListener('click', () => {
      titleMode = titleMode === 'heading' ? 'filename' : 'heading';
      saveSettings({ titleMode }).catch(() => {});
      updateTitleToggle();
      sortTree(tree, displayMeta());
      flat = flattenTree(tree);
      renderTree();
      if (currentPath) {
        renderCrumbs(currentPath);
        renderPrevNext();
        document.title = `${displayTitle(currentPath)} · Docs · ${client.owner}/${client.repo}`;
      }
    });
    root.querySelector('[data-gdt-side-toggle]').addEventListener('click', () => {
      root.classList.toggle('gdt-side-open');
    });
    refs.themeToggle.addEventListener('click', cycleTheme);
    root.querySelector('[data-gdt-org]').addEventListener('click', openOrgModal);
    root.querySelector('[data-gdt-org-exit]').addEventListener('click', () => {
      orgSession = null;
      clearOrgSnapshot(client.owner);
      renderTree();
    });
    root.querySelector('[data-gdt-publish-session]').addEventListener('click', openSessionModal);
    root.querySelector('[data-gdt-discard-session]').addEventListener('click', async () => {
      if (!window.confirm(`Discard all ${Object.keys(drafts).length} drafted change(s)?`)) return;
      drafts = await clearDrafts(client.owner, client.repo);
      renderTree();
      if (currentPath) refreshDraftBanner();
    });
    refs.liveEdit.addEventListener('click', () => {
      if (currentPath) openEditor(currentPath);
    });
    refs.copyLink.addEventListener('click', () => {
      if (!currentPath && !confluenceRoute) return;
      const activeSlug = refs.toc.querySelector('a.gdt-toc-active')?.getAttribute('data-gdt-toc-slug') || null;
      const hash = confluenceRoute ? buildConfluenceHash({ ...confluenceRoute, heading: activeSlug }) : buildHash({ path: currentPath, heading: activeSlug });
      const url = `https://github.com/${client.owner}/${client.repo}${hash}`;
      copyText(url).then((ok) => {
        refs.copyLink.innerHTML = ok ? ICONS.check : ICONS.link;
        refs.copyLink.title = ok ? 'Link copied!' : 'Clipboard unavailable';
        setTimeout(() => {
          refs.copyLink.innerHTML = ICONS.link;
          refs.copyLink.title = 'Copy deep link to this document';
        }, 1400);
      });
    });
    refs.copyMd.addEventListener('click', async () => {
      if (!currentPath) return;
      let source = contentCache.get(currentPath);
      if (source == null) {
        try {
          source = await client.getRawText(currentPath, { sha: (docByPath.get(currentPath) || {}).sha });
          contentCache.set(currentPath, source);
        } catch {
          return;
        }
      }
      const fallbackCopy = () => {
        try {
          const ta = document.createElement('textarea');
          ta.value = source;
          ta.style.cssText = 'position:fixed;opacity:0';
          document.body.appendChild(ta);
          ta.select();
          const ok = document.execCommand('copy');
          ta.remove();
          return ok;
        } catch {
          return false;
        }
      };
      const done = (ok) => {
        refs.copyMd.innerHTML = ok ? ICONS.check : ICONS.copy;
        refs.copyMd.title = ok ? 'Copied!' : 'Clipboard unavailable';
        setTimeout(() => {
          refs.copyMd.innerHTML = ICONS.copy;
          refs.copyMd.title = 'Copy document markdown';
        }, 1400);
      };
      navigator.clipboard.writeText(source).then(
        () => done(true),
        () => done(fallbackCopy())
      );
    });

    let filterTimer = 0;
    refs.filter.addEventListener('input', () => {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(() => {
        treeFilter = refs.filter.value.trim().toLowerCase();
        renderTree();
      }, 100);
    });
    refs.filter.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && refs.filter.value) {
        e.stopPropagation();
        refs.filter.value = '';
        treeFilter = '';
        renderTree();
      }
    });

    root.addEventListener('click', onRootClick);
  }

  function onRootClick(e) {
    const a = e.target.closest('a');
    if (!a || !root.contains(a)) return;
    if (a.classList.contains('gdt-wikilink-broken')) {
      e.preventDefault();
      const target = a.getAttribute('data-gdt-target') || '';
      searchUI.setQuery(target);
      return;
    }
    const href = a.getAttribute('href') || '';
    if (a.hasAttribute('data-gdt-heading')) {
      e.preventDefault();
      scrollToHeading(a.getAttribute('data-gdt-heading'));
      return;
    }
    if (href.startsWith('#') && !href.startsWith('#docs')) {
      // footnote refs and other in-article fragment links
      e.preventDefault();
      scrollToHeading(href.slice(1));
    }
  }

  // Copy buttons via delegation (buttons are re-created on every render).
  function onArticleClick(e) {
    const btn = e.target.closest('[data-gdt-copy]');
    if (!btn) return;
    const pre = btn.parentElement && btn.parentElement.querySelector('pre');
    if (!pre) return;
    navigator.clipboard
      .writeText(pre.textContent)
      .then(() => {
        btn.classList.add('gdt-copied');
        setTimeout(() => btn.classList.remove('gdt-copied'), 1200);
      })
      .catch(() => {});
  }

  // ---- mount / unmount ------------------------------------------------------

  let hiddenMain = null;

  function mount() {
    const main = document.querySelector('main');
    if (!main) return false;
    hiddenMain = main;
    for (const child of [...main.children]) {
      if (child.id !== 'gdt-root') child.setAttribute('data-gdt-hidden', '');
    }
    main.appendChild(root);
    mounted = true;
    origTitle = document.title;
    refs.article.addEventListener('click', onArticleClick);
    keydownHandler = (e) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = e.target;
        const typing =
          t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
        if (!typing) {
          e.preventDefault();
          searchUI.focus();
        }
      }
    };
    document.addEventListener('keydown', keydownHandler, true);
    updateSidebarMeta();
    renderTree();
    renderTags();
    refs.progress.hidden = !indexState.started || indexState.finished;
    if (indexState.started && !indexState.finished) refs.progress.textContent = `Indexing content… ${Math.round((indexState.done / Math.max(1, indexState.total)) * 100)}%`;
    refs.openGh.href = `https://github.com/${client.owner}/${client.repo}`;
    return true;
  }

  function close() {
    if (!mounted) return;
    if (editor) closeEditor(true);
    mounted = false;
    loadSeq++;
    confluenceRoute = null;
    document.removeEventListener('keydown', keydownHandler, true);
    if (tocObserver) {
      tocObserver.disconnect();
      tocObserver = null;
    }
    root.remove();
    document.querySelectorAll('[data-gdt-hidden]').forEach((el) => el.removeAttribute('data-gdt-hidden'));
    if (origTitle != null) document.title = origTitle;
    currentPath = null;
    hiddenMain = null;
  }

  // ---- theme ----------------------------------------------------------------

  function applyTheme() {
    root.setAttribute('data-gdt-theme', theme);
    const next = theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto';
    refs.themeToggle.innerHTML = theme === 'auto' ? ICONS.theme : theme === 'light' ? ICONS.sun : ICONS.moon;
    refs.themeToggle.title =
      theme === 'auto' ? `Theme: auto (follows GitHub) — click for light` : `Theme: ${theme} — click for ${next}`;
  }

  function updateTitleToggle() {
    refs.titleToggle.innerHTML = titleMode === 'heading' ? ICONS.heading : ICONS.file;
    refs.titleToggle.title =
      titleMode === 'heading'
        ? 'Sidebar titles: document titles (frontmatter title, else first headline) — click for filenames'
        : 'Sidebar titles: filenames — click for document titles';
  }

  function cycleTheme() {
    theme = theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto';
    applyTheme();
    saveSettings({ theme }).catch(() => {});
  }

  // ---- sidebar --------------------------------------------------------------

  function updateSidebarMeta() {
    if (!mounted) return;
    // Icons stand in for the words "documents" (file) and "repos" (branch) so
    // the counts fit one row. Numbers are ours (no user data) so innerHTML is
    // safe here; the org name uses textContent separately.
    const docIcon = `<span class="gdt-count-ico">${ICONS.file}</span>`;
    const branchIcon = `<span class="gdt-count-ico">${ICONS.branch}</span>`;
    if (orgSession) {
      const n = orgSession.totalDocs;
      const repos = orgSession.repoDocs.size;
      const indexed = [...orgSession.repoState.values()].filter((s) => s.phase === 'done').length;
      refs.orgTitle.hidden = false;
      refs.orgTitleName.textContent = orgSession.org;
      refs.countLabel.innerHTML =
        `${docIcon}${n.toLocaleString()}<span class="gdt-count-sep">·</span>${branchIcon}${indexed}/${repos}` +
        (orgSession.indexing ? '<span class="gdt-count-indexing">indexing…</span>' : '');
      refs.countLabel.title = `${n.toLocaleString()} documents · ${indexed} of ${repos} repositories indexed for search`;
      refs.truncatedBox.hidden = true;
      return;
    }
    refs.orgTitle.hidden = true;
    refs.countLabel.innerHTML = `${docIcon}${total}`;
    refs.countLabel.title = `${total} document${total === 1 ? '' : 's'}`;
    if (truncated) {
      refs.truncatedBox.hidden = false;
      refs.truncatedBox.textContent = `Showing the first ${docs.length} of ${total} docs (raise the limit in Options).`;
    }
  }

  function docLabel(child) {
    return displayTitleOf(metaByPath.get(child.path), child.doc) || child.doc.title;
  }

  function matchesFilter(child) {
    if (!treeFilter) return true;
    const hay = `${docLabel(child)} ${child.path}`.toLowerCase();
    return treeFilter.split(/\s+/).every((tok) => hay.includes(tok));
  }

  function renderTree() {
    if (!mounted) return;
    updateSidebarMeta();
    if (orgSession) {
      renderOrgTree();
      renderPinned();
      renderDrafts();
      markSelection();
      return;
    }
    const treeEl = refs.tree;
    treeEl.textContent = '';
    const repoBodies = new Map();
    let filesContainer = treeEl;
    if (confluence) {
      const group = document.createElement('details');
      group.className = 'gdt-confluence-group'; group.open = true;
      const summary = document.createElement('summary'); summary.textContent = `${client.owner}/${client.repo}`;
      group.append(summary); treeEl.append(group); filesContainer = group;
      repoBodies.set(`${client.owner}/${client.repo}`.toLowerCase(), group);
      if (githubError) {
        const note = document.createElement('p'); note.className = 'gdt-confluence-note'; note.textContent = githubError;
        group.append(note);
      }
    }
    const list = renderNodes(tree, 0);
    if (treeFilter && !list.querySelector('a')) {
      const empty = document.createElement('div');
      empty.className = 'gdt-tree-empty';
      empty.textContent = 'No files match the filter';
      filesContainer.appendChild(empty);
    } else {
      filesContainer.appendChild(list);
    }
    confluence?.decorate(treeEl, repoBodies, treeFilter, confluenceRoute);
    renderPinned();
    renderDrafts();
    markSelection();
  }

  function renderNodes(node, depth, hrefBase = '') {
    const ul = document.createElement('ul');
    ul.className = 'gdt-tree-list';
    for (const child of node.children) {
      const li = document.createElement('li');
      if (child.isDir) {
        const sub = renderNodes(child, depth + 1, hrefBase);
        if (treeFilter && !sub.querySelector('a')) continue; // no matching descendants
        const open = treeFilter ? true : expansion.has(child.path) || depth < 1;
        if (open && !treeFilter) expansion.add(child.path);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gdt-dir' + (open ? ' gdt-open' : '');
        btn.innerHTML = `<span class="gdt-chevron">${ICONS.chevron}</span><span class="gdt-folder-ico">${ICONS.folder}</span>`;
        btn.appendChild(Object.assign(document.createElement('span'), { textContent: child.name, className: 'gdt-label' }));
        btn.addEventListener('click', () => {
          if (expansion.has(child.path)) expansion.delete(child.path);
          else expansion.add(child.path);
          const nowOpen = expansion.has(child.path);
          btn.classList.toggle('gdt-open', nowOpen);
          sub.hidden = !nowOpen;
        });
        li.appendChild(btn);
        sub.hidden = !open;
        li.appendChild(sub);
      } else {
        if (!matchesFilter(child)) continue;
        const a = document.createElement('a');
        a.className = 'gdt-file' + (!hrefBase && drafts[child.path] ? ' gdt-has-draft' : '');
        a.href = hrefBase + buildHash({ path: child.path });
        if (!hrefBase) a.setAttribute('data-gdt-tree-path', child.path);
        a.innerHTML = `<span class="gdt-file-ico">${ICONS.file}</span>`;
        a.appendChild(Object.assign(document.createElement('span'), { textContent: docLabel(child), className: 'gdt-label' }));
        li.appendChild(a);
      }
      ul.appendChild(li);
    }
    return ul;
  }

  function renderOrgTree() {
    const treeEl = refs.tree;
    treeEl.textContent = '';
    orgSession.ringEls = new Map();
    const repoBodies = new Map();
    const repos = [...orgSession.repoDocs.keys()].sort((a, b) =>
      a === client.repo ? -1 : b === client.repo ? 1 : a.localeCompare(b)
    );
    for (const repo of repos) {
      const docsOfRepo = orgSession.repoDocs.get(repo) || [];
      const repoIndexed = (orgSession.repoState.get(repo) || {}).phase === 'done';
      const group = document.createElement('div');
      group.className = 'gdt-org-group' + (repoIndexed ? '' : ' gdt-org-unindexed');
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'gdt-dir gdt-org-repo' + (orgExpanded.has(repo) ? ' gdt-open' : '');
      head.innerHTML = `<span class="gdt-chevron">${ICONS.chevron}</span><span class="gdt-folder-ico">${ICONS.org}</span>`;
      head.appendChild(
        Object.assign(document.createElement('span'), { textContent: repo, className: 'gdt-label' })
      );
      head.appendChild(
        Object.assign(document.createElement('span'), { textContent: String(docsOfRepo.length), className: 'gdt-org-count' })
      );
      const ring = document.createElement('span');
      ring.className = 'gdt-org-ring';
      head.appendChild(ring);
      orgSession.ringEls.set(repo, ring);
      paintRing(repo);
      const isCurrent = repo === client.repo;
      const body = document.createElement('div');
      repoBodies.set(`${client.owner}/${repo}`.toLowerCase(), body);
      // Prompt shown when expanding an unindexed, non-current repo. Reads the
      // LIVE index state (not the render-time `repoIndexed`) so a repo indexed
      // via this prompt is not re-prompted after collapse/expand.
      const maybePrompt = () => {
        const indexedNow = (orgSession.repoState.get(repo) || {}).phase === 'done';
        if (isCurrent || indexedNow || orgSession.browseAck.has(repo)) return;
        if (body.querySelector('.gdt-org-prompt')) return;
        const prompt = h(`<div class="gdt-org-prompt"><span>Index <b>${md.utils.escapeHtml(repo)}</b> so it appears in search?</span><span class="gdt-org-prompt-btns"><button type="button" class="gdt-btn gdt-btn-sm gdt-btn-primary" data-p-index>Index</button><button type="button" class="gdt-btn gdt-btn-sm" data-p-browse>Just browse</button></span></div>`);
        prompt.querySelector('[data-p-index]').addEventListener('click', () => {
          prompt.remove();
          runOrgIndex([repo]);
        });
        prompt.querySelector('[data-p-browse]').addEventListener('click', () => {
          orgSession.browseAck.add(repo);
          prompt.remove();
        });
        body.insertBefore(prompt, body.firstChild);
      };
      const filesEl = isCurrent
        ? renderNodes(tree, 0)
        : renderNodes(sortTree(buildTree(docsOfRepo), new Map()), 0, `/${client.owner}/${repo}`);
      body.appendChild(filesEl);
      body.hidden = !orgExpanded.has(repo);
      if (orgExpanded.has(repo)) maybePrompt();
      head.addEventListener('click', () => {
        if (orgExpanded.has(repo)) orgExpanded.delete(repo);
        else orgExpanded.add(repo);
        const open = orgExpanded.has(repo);
        head.classList.toggle('gdt-open', open);
        body.hidden = !open;
        if (open) maybePrompt();
      });
      group.appendChild(head);
      group.appendChild(body);
      treeEl.appendChild(group);
    }
    confluence?.decorate(treeEl, repoBodies, treeFilter, confluenceRoute);
    const errs = orgSession.errors || [];
    if (errs.length) {
      const note = document.createElement('div');
      note.className = 'gdt-tree-empty';
      note.textContent = `${errs.length} repo(s) skipped: ${errs.map((e) => e.repo).join(', ')}`;
      treeEl.appendChild(note);
    }
  }

  function paintRing(repo) {
    const ring = orgSession && orgSession.ringEls && orgSession.ringEls.get(repo);
    if (!ring) return;
    const st = (orgSession.repoState && orgSession.repoState.get(repo)) || { phase: 'idle', pct: 0 };
    ring.classList.remove('gdt-ring-done', 'gdt-ring-err', 'gdt-ring-active');
    ring.style.background = '';
    ring.textContent = '';
    if (st.phase === 'done') {
      ring.classList.add('gdt-ring-done');
      ring.title = 'Indexed for search';
    } else if (st.phase === 'error') {
      ring.classList.add('gdt-ring-err');
      ring.title = st.message || 'Indexing failed';
    } else if (st.phase === 'idle') {
      ring.title = 'Not indexed yet';
    } else {
      ring.classList.add('gdt-ring-active');
      const deg = Math.max(0, Math.min(100, st.pct || 0)) * 3.6;
      ring.style.background = `conic-gradient(var(--gdt-accent) ${deg}deg, var(--gdt-border) 0)`;
      ring.title = `Indexing… ${st.pct || 0}%`;
    }
  }

  // Records per-repo index state and repaints only that ring (no full re-render).
  function setRepoState(repo, state) {
    if (!orgSession) return;
    orgSession.repoState = orgSession.repoState || new Map();
    orgSession.repoState.set(repo, state);
    paintRing(repo);
    updateSidebarMeta(); // keep the "X/Y repos indexed" header current
  }

  function orgProgressToState(ev) {
    if (ev.phase === 'done') return { phase: 'done' };
    if (ev.phase === 'error') return { phase: 'error', message: ev.message };
    if (ev.phase === 'tree') return { phase: 'indexing', pct: 3 };
    const frac = ev.filesTotal ? ev.filesDone / ev.filesTotal : 1;
    return { phase: ev.filesDone >= ev.filesTotal ? 'done' : 'indexing', pct: Math.round(frac * 100) };
  }

  function renderPinned() {
    const pinnedDocs = docs.filter((d) => {
      const m = metaByPath.get(d.path);
      if (!m || !m.pinned) return false;
      if (!treeFilter) return true;
      const hay = `${displayTitleOf(m, d)} ${d.path}`.toLowerCase();
      return treeFilter.split(/\s+/).every((tok) => hay.includes(tok));
    });
    refs.pinnedList.textContent = '';
    if (!pinnedDocs.length) {
      refs.pinned.hidden = true;
      return;
    }
    refs.pinned.hidden = false;
    for (const d of pinnedDocs) {
      const a = document.createElement('a');
      a.className = 'gdt-file gdt-pin-item';
      a.href = buildHash({ path: d.path });
      a.setAttribute('data-gdt-tree-path', d.path);
      a.innerHTML = `<span class="gdt-file-ico gdt-pin-ico">${ICONS.pin}</span>`;
      a.appendChild(
        Object.assign(document.createElement('span'), { textContent: displayTitle(d.path), className: 'gdt-label' })
      );
      refs.pinnedList.appendChild(a);
    }
  }

  function renderDrafts() {
    const paths = Object.keys(drafts);
    refs.draftsBox.hidden = !paths.length;
    refs.draftsCount.textContent = paths.length ? `(${paths.length})` : '';
    refs.draftsList.textContent = '';
    for (const path of paths) {
      const row = document.createElement('div');
      row.className = 'gdt-draft-row';
      const a = document.createElement('a');
      a.className = 'gdt-file gdt-draft-item';
      a.href = buildHash({ path });
      a.setAttribute('data-gdt-tree-path', path);
      a.appendChild(Object.assign(document.createElement('span'), { textContent: displayTitle(path), className: 'gdt-label' }));
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'gdt-draft-x';
      x.textContent = '×';
      x.title = 'Discard this draft';
      x.addEventListener('click', async (e) => {
        e.preventDefault();
        drafts = await removeDraft(client.owner, client.repo, path);
        renderTree();
        if (currentPath === path) refreshDraftBanner();
      });
      row.appendChild(a);
      row.appendChild(x);
      refs.draftsList.appendChild(row);
    }
  }

  function markSelection() {
    for (const el of refs.sidebar.querySelectorAll('a[data-gdt-tree-path][aria-current]')) el.removeAttribute('aria-current');
    if (!currentPath) return;
    const els = refs.sidebar.querySelectorAll(`a[data-gdt-tree-path="${cssEscape(currentPath)}"]`);
    els.forEach((el) => el.setAttribute('aria-current', 'page'));
    const inTree = refs.tree.querySelector(`a[data-gdt-tree-path="${cssEscape(currentPath)}"]`);
    if (inTree) inTree.scrollIntoView({ block: 'nearest' });
  }

  function expandAncestors(path) {
    let dir = dirname(path);
    let changed = false;
    while (dir) {
      if (!expansion.has(dir)) {
        expansion.add(dir);
        changed = true;
      }
      dir = dirname(dir);
    }
    return changed;
  }

  function cssEscape(s) {
    return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\\]]/g, '\\$&');
  }

  function renderTags() {
    const tags = [...index.allTags().entries()].sort((a, b) => b[1] - a[1]).slice(0, 24);
    refs.tags.textContent = '';
    if (!tags.length) {
      refs.tags.hidden = true;
      return;
    }
    refs.tags.hidden = false;
    for (const [tag, count] of tags) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'gdt-tag-chip';
      chip.textContent = tag;
      const c = document.createElement('span');
      c.className = 'gdt-tag-count';
      c.textContent = String(count);
      chip.appendChild(c);
      chip.addEventListener('click', () => searchUI.setQuery(`tag:${tag} `));
      refs.tags.appendChild(chip);
    }
  }

  // ---- indexing -------------------------------------------------------------

  async function startIndexing() {
    if (indexState.started) return;
    indexState.started = true;
    const queue = [...docs];
    const limitBytes = (settings.contentSearchLimitKB || 200) * 1024;
    if (refs) refs.progress.hidden = false;
    const tick = () => {
      notifySearch();
      if (refs) refs.progress.textContent = `Indexing content… ${Math.round((indexState.done / Math.max(1, indexState.total)) * 100)}%`;
    };
    tick();
    const worker = async () => {
      while (queue.length && !disposed) {
        const doc = queue.shift();
        try {
          if (doc.size && doc.size > limitBytes) continue;
          let source = contentCache.get(doc.path);
          if (source == null) {
            source = await client.getRawText(doc.path, { sha: doc.sha });
            contentCache.set(doc.path, source);
          }
          addToIndex(doc, source);
        } catch {
          // unreadable file: skip silently
        } finally {
          indexState.done++;
          if (indexState.done % 5 === 0 || indexState.done === indexState.total) tick();
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    indexState.finished = true;
    if (refs) refs.progress.hidden = true;
    notifySearch();
    if (orgSession) foldCurrentRepoIntoOrg();
    sortTree(tree, displayMeta());
    flat = flattenTree(tree);
    if (mounted) {
      renderTree();
      renderTags();
      if (currentPath) renderPrevNext();
    }
  }

  function addToIndex(doc, source) {
    const { data, content } = parseFrontmatter(source);
    recordMeta(doc.path, data, bestHeadingTitle(content));
    const m = metaByPath.get(doc.path);
    index.add(doc.path, {
      text: mdToPlainText(content),
      title: (m && (m.fmTitle || m.headingTitle)) || doc.title,
      headings: extractHeadings(content),
      tags: (m && m.tags) || [],
    });
  }

  // ---- article --------------------------------------------------------------

  function defaultPath() {
    const rootIndex = tree.children.find((c) => !c.isDir && /^readme\./i.test(c.name));
    if (rootIndex) return rootIndex.doc.path;
    return flat.length ? flat[0].path : null;
  }

  async function renderRoute(route) {
    if (route.source === 'confluence') {
      if (editor && !closeEditor(false)) { location.hash = buildHash({ path: editor.path }); return; }
      await renderConfluenceArticle(route);
      return;
    }
    const wasConfluence = Boolean(confluenceRoute);
    confluenceRoute = null;
    if (wasConfluence) renderTree();
    const target = route.path ?? defaultPath();
    if (editor) {
      if (target === editor.path) return; // stay in the editor
      if (!closeEditor(false)) {
        location.hash = buildHash({ path: editor.path });
        return;
      }
    }
    if (!target) {
      ++loadSeq;
      refs.liveEdit.disabled = refs.copyMd.disabled = refs.copyLink.disabled = true;
      refs.editGh.hidden = true;
      renderMessage('Choose a document', githubError || (confluence ? 'Browse Confluence spaces in the sidebar, or connect another site in extension Options.' : 'This repository has no markdown documents in its docs folders.'));
      return;
    }
    if (target === currentPath && !refs.article.querySelector('[data-gdt-error]')) {
      if (route.heading) scrollToHeading(route.heading);
      return;
    }
    await renderArticle(target, route.heading ?? null);
  }

  async function renderArticle(path, heading) {
    const seq = ++loadSeq;
    currentPath = path;
    renderCrumbs(path);
    if (expandAncestors(path)) renderTree();
    else markSelection();
    refs.article.innerHTML = '<div class="gdt-loading"><div class="gdt-spinner"></div>Loading…</div>';
    refs.toc.hidden = true;
    refs.editGh.hidden = false;
    refs.openGh.innerHTML = ICONS.github;
    refs.openGh.title = 'View on GitHub';
    refs.liveEdit.disabled = refs.copyMd.disabled = refs.copyLink.disabled = true;

    let source = contentCache.get(path);
    if (source == null) {
      try {
        source = await client.getRawText(path, { sha: (docByPath.get(path) || {}).sha });
        contentCache.set(path, source);
      } catch (err) {
        if (seq !== loadSeq) return;
        renderError(path, err);
        return;
      }
    }
    if (seq !== loadSeq) return;

    let rd;
    try {
      rd = renderDoc(md, source, { path, ctx });
    } catch (err) {
      renderMessage('Render failed', String((err && err.message) || err));
      return;
    }
    let headingTitle = null;
    if (rd.toc.length) {
      const minLevel = Math.min(...rd.toc.map((t) => t.level));
      headingTitle = (rd.toc.find((t) => t.level === minLevel) || {}).text || null;
    }
    const titleChanged = recordMeta(path, rd.meta, headingTitle);
    if (titleChanged) renderTree();

    const m = metaByPath.get(path);
    const doc = docByPath.get(path);
    const title = displayTitle(path);
    document.title = `${title} · Docs · ${client.owner}/${client.repo}`;
    refs.editGh.href = client.editUrl(path);
    refs.openGh.href = client.blobUrl(path);
    refs.liveEdit.disabled = false;
    refs.copyMd.disabled = false;
    refs.copyLink.disabled = false;

    refs.article.textContent = '';
    refreshDraftBanner();
    const header = buildArticleHeader(path, m, doc, rd);
    if (header) refs.article.appendChild(header);
    const body = document.createElement('div');
    body.className = 'gdt-md';
    body.appendChild(rd.fragment);
    refs.article.appendChild(body);
    renderPrevNext();
    renderToc(rd.toc);
    if (heading) scrollToHeading(heading);
    else window.scrollTo({ top: 0 });
  }

  async function renderConfluenceArticle(route) {
    const seq = ++loadSeq;
    currentPath = null;
    confluenceRoute = route;
    refs.liveEdit.disabled = refs.copyMd.disabled = true;
    refs.copyLink.disabled = false;
    refs.editGh.hidden = true;
    refs.openGh.innerHTML = ICONS.external;
    refs.openGh.title = 'Open in Confluence';
    refs.openGh.href = pageUrl(route.site, route.pageId);
    refs.crumbs.textContent = 'Confluence';
    refs.toc.hidden = true;
    if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }
    refs.article.innerHTML = '<div class="gdt-loading"><div class="gdt-spinner"></div>Loading Confluence page…</div>';
    renderTree();
    try {
      if (!confluence) throw new Error('Add this Confluence site in extension Options first.');
      const page = await confluence.fetchPage(route);
      if (seq !== loadSeq || !mounted) return;
      const rendered = renderConfluence(page);
      refs.article.replaceChildren();
      const title = document.createElement('h1'); title.className = 'gdt-doc-title'; title.textContent = page.title;
      const source = document.createElement('a'); source.textContent = 'Open in Confluence'; source.href = page.url;
      source.target = '_blank'; source.rel = 'noopener noreferrer'; source.className = 'gdt-confluence-original';
      const note = document.createElement('p'); note.className = 'gdt-confluence-note';
      note.textContent = 'Read-only view. Open Confluence for images, interactive macros, comments, or editing.';
      const body = document.createElement('div'); body.className = 'gdt-md'; body.append(rendered.fragment);
      refs.article.append(title, source, confluence.controls(page), note, body);
      refs.crumbs.textContent = `Confluence / ${page.title}`;
      document.title = `${page.title} · Confluence · Docs`;
      renderToc(rendered.toc);
      if (route.heading) scrollToHeading(route.heading);
      else window.scrollTo({ top: 0 });
    } catch (error) {
      if (seq !== loadSeq || !mounted) return;
      renderMessage('Cannot read Confluence page', error.message);
      if (confluence) refs.article.append(confluence.recovery('Check the connection and try again.', route.site, () => renderConfluenceArticle(route)));
      else {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'gdt-btn'; button.textContent = 'Connection settings';
        button.addEventListener('click', () => ext.runtime.openOptionsPage()); refs.article.append(button);
      }
    }
  }

  // Slim banner shown at the top of drafted documents in reading mode.
  function refreshDraftBanner() {
    refs.article.querySelector('.gdt-draft-banner')?.remove();
    if (!currentPath || !drafts[currentPath]) return;
    const banner = h(`
      <div class="gdt-draft-banner">
        ${ICONS.edit}
        <span>You have a drafted edit for this document.</span>
        <button type="button" class="gdt-btn gdt-btn-sm" data-b-edit>Continue editing</button>
        <button type="button" class="gdt-btn gdt-btn-sm" data-b-discard>Discard draft</button>
      </div>
    `);
    const path = currentPath;
    banner.querySelector('[data-b-edit]').addEventListener('click', () => openEditor(path));
    banner.querySelector('[data-b-discard]').addEventListener('click', async () => {
      drafts = await removeDraft(client.owner, client.repo, path);
      renderTree();
      banner.remove();
    });
    refs.article.insertBefore(banner, refs.article.firstChild);
  }

  async function ensureBaseSource(path) {
    let base = contentCache.get(path);
    if (base == null) {
      base = await client.getRawText(path, { sha: (docByPath.get(path) || {}).sha });
      contentCache.set(path, base);
    }
    return base;
  }

  async function openOrgModal() {
    const backdrop = h(`
      <div class="gdt-modal-backdrop">
        <div class="gdt-modal gdt-modal-wide" role="dialog" aria-label="Organization docs">
          <h3>Search across ${md.utils.escapeHtml(client.owner)}</h3>
          <p class="gdt-modal-note" data-o-note>Loading repositories…</p>
          <div data-o-select hidden>
            <input class="gdt-filter-input" data-o-filter type="search" placeholder="Filter repositories…" autocomplete="off" spellcheck="false" />
            <div class="gdt-org-toolbar">
              <button type="button" class="gdt-btn gdt-btn-sm" data-o-all>All</button>
              <button type="button" class="gdt-btn gdt-btn-sm" data-o-none>None</button>
              <span class="gdt-org-selcount" data-o-count></span>
            </div>
            <div class="gdt-org-repolist" data-o-list></div>
          </div>
          <div data-o-run hidden>
            <div class="gdt-org-overall">
              <div class="gdt-prog gdt-prog-lg"><i data-o-overall-bar></i></div>
              <span class="gdt-org-overall-label" data-o-overall-label>0%</span>
            </div>
            <div class="gdt-org-runlist" data-o-runlist></div>
          </div>
          <div class="gdt-modal-actions">
            <button type="button" class="gdt-btn" data-o-cancel>Cancel</button>
            <button type="button" class="gdt-btn gdt-btn-primary" data-o-go disabled>Index selected</button>
          </div>
        </div>
      </div>
    `);
    const q = (sel) => backdrop.querySelector(sel);
    const closeModal = () => backdrop.remove();
    q('[data-o-cancel]').addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });
    root.appendChild(backdrop);

    let repoList;
    try {
      repoList = await client.listOwnerRepos();
    } catch (err) {
      q('[data-o-note]').textContent = `Could not list repositories: ${(err && err.message) || err}`;
      return;
    }
    if (!repoList.length) {
      q('[data-o-note]').textContent = 'No repositories found.';
      return;
    }
    const previous = await loadOrgSelection(client.owner);
    const preselected = new Set(previous ? previous.repos : repoList.filter((r) => !r.archived).map((r) => r.name));

    q('[data-o-note]').textContent = client.hasToken
      ? `${repoList.length} repositories. Listings are cached per repo; content is indexed for this page session.`
      : 'Warning: no token configured — anonymous API access (60 requests/hour) will not get far. Add a token in the extension options first.';
    q('[data-o-select]').hidden = false;

    const listEl = q('[data-o-list]');
    const rows = [];
    for (const r of repoList) {
      const label = document.createElement('label');
      label.className = 'gdt-org-repo-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = preselected.has(r.name);
      cb.value = r.name;
      const name = Object.assign(document.createElement('span'), {
        textContent: r.name,
        className: 'gdt-org-repo-name',
      });
      label.appendChild(cb);
      label.appendChild(name);
      if (r.archived) {
        label.appendChild(Object.assign(document.createElement('span'), { textContent: 'archived', className: 'gdt-org-chip' }));
      }
      const desc = Object.assign(document.createElement('span'), {
        textContent: r.description,
        className: 'gdt-org-repo-desc',
        title: r.description,
      });
      label.appendChild(desc);
      listEl.appendChild(label);
      cb.addEventListener('change', updateCount);
      rows.push({ row: label, cb, haystack: `${r.name} ${r.description}`.toLowerCase() });
    }

    const goBtn = q('[data-o-go]');
    function updateCount() {
      const n = rows.filter((r) => r.cb.checked).length;
      q('[data-o-count]').textContent = `${n} of ${repoList.length} selected`;
      goBtn.disabled = n === 0;
      goBtn.textContent = `Index ${n} repositor${n === 1 ? 'y' : 'ies'}`;
    }
    const visibleRows = () => rows.filter((r) => !r.row.hidden);
    q('[data-o-all]').addEventListener('click', () => {
      visibleRows().forEach((r) => (r.cb.checked = true));
      updateCount();
    });
    q('[data-o-none]').addEventListener('click', () => {
      visibleRows().forEach((r) => (r.cb.checked = false));
      updateCount();
    });
    q('[data-o-filter]').addEventListener('input', () => {
      const needle = q('[data-o-filter]').value.trim().toLowerCase();
      for (const r of rows) r.row.hidden = !!needle && !r.haystack.includes(needle);
    });
    updateCount();

    goBtn.addEventListener('click', async () => {
      const chosen = rows.filter((r) => r.cb.checked).map((r) => r.cb.value);
      await saveOrgSelection(client.owner, chosen);

      // swap to the progress view: one row + bar per repo, plus an overall bar
      q('[data-o-select]').hidden = true;
      q('[data-o-note]').hidden = true;
      q('[data-o-run]').hidden = false;
      goBtn.hidden = true;
      q('[data-o-cancel]').disabled = true;
      const runlist = q('[data-o-runlist]');
      const runRows = new Map();
      for (const repo of chosen) {
        const row = h(
          `<div class="gdt-org-runrow"><span class="gdt-org-runname">${md.utils.escapeHtml(repo)}</span><span class="gdt-prog"><i></i></span><span class="gdt-org-runstatus">queued</span></div>`
        );
        runlist.appendChild(row);
        runRows.set(repo, { row, bar: row.querySelector('.gdt-prog i'), status: row.querySelector('.gdt-org-runstatus') });
      }
      const overallBar = q('[data-o-overall-bar]');
      const overallLabel = q('[data-o-overall-label]');
      let finished = 0;
      let currentFraction = 0;
      const updateOverall = () => {
        const pct = Math.round(((finished + currentFraction) / chosen.length) * 100);
        overallBar.style.width = `${pct}%`;
        overallLabel.textContent = `${finished}/${chosen.length} repositories · ${pct}%`;
      };
      updateOverall();

      const modalState = new Map();
      const onProgress = (ev) => {
        modalState.set(ev.repo, orgProgressToState(ev));
        const r = runRows.get(ev.repo);
        if (!r) return;
        if (ev.phase === 'tree') {
          r.status.textContent = 'listing…';
          r.bar.style.width = '8%';
          currentFraction = 0.05;
        } else if (ev.phase === 'content') {
          const frac = ev.filesTotal ? ev.filesDone / ev.filesTotal : 1;
          r.status.textContent = ev.filesTotal ? `${ev.filesDone}/${ev.filesTotal} files` : 'no files';
          r.bar.style.width = `${Math.round(8 + frac * 92)}%`;
          currentFraction = 0.05 + frac * 0.95;
        } else if (ev.phase === 'done') {
          r.status.textContent = `${ev.docsCount} docs`;
          r.bar.style.width = '100%';
          r.row.classList.add('gdt-run-ok');
          finished++;
          currentFraction = 0;
        } else if (ev.phase === 'error') {
          r.status.textContent = ev.message.slice(0, 60);
          r.status.title = ev.message;
          r.bar.style.width = '100%';
          r.row.classList.add('gdt-run-err');
          finished++;
          currentFraction = 0;
        }
        updateOverall();
        r.row.scrollIntoView({ block: 'nearest' });
      };

      try {
        const result = await buildOrgIndex({ owner: client.owner, repoNames: chosen, settings, onProgress });
        if (!result.repoDocs.has(client.repo)) result.repoDocs.set(client.repo, docs);
        let totalDocs = 0;
        for (const docsOfRepo of result.repoDocs.values()) totalDocs += docsOfRepo.length;
        const repoState = new Map();
        for (const repo of result.repoDocs.keys()) repoState.set(repo, modalState.get(repo) || { phase: 'done' });
        orgSession = { org: client.owner, ...result, totalDocs, indexing: false, repoState, browseAck: new Set() };
        saveOrgSnapshot(client.owner, result.repoDocs);
        renderTree();
        if (result.errors.length) {
          overallLabel.textContent = `Done — ${result.errors.length} repositor${result.errors.length === 1 ? 'y' : 'ies'} skipped (see rows)`;
          const cancel = q('[data-o-cancel]');
          cancel.disabled = false;
          cancel.textContent = 'Close';
        } else {
          setTimeout(closeModal, 500);
        }
      } catch (err) {
        overallLabel.textContent = `Failed: ${(err && err.message) || err}`;
        q('[data-o-cancel]').disabled = false;
      }
    });
  }

  function openSessionModal() {
    const paths = Object.keys(drafts);
    if (!paths.length) return;
    const backdrop = h(`
      <div class="gdt-modal-backdrop">
        <div class="gdt-modal" role="dialog" aria-label="Publish drafted changes">
          <h3>Publish session (${paths.length} file${paths.length === 1 ? '' : 's'})</h3>
          <ul class="gdt-session-files" data-s-files></ul>
          <label>Commit message base <input data-s-msg autocomplete="off" spellcheck="false" /></label>
          <label>Branch name <input data-s-branch autocomplete="off" spellcheck="false" /></label>
          <label>Pull request title <input data-s-title autocomplete="off" /></label>
          <label>Description <textarea data-s-body rows="4"></textarea></label>
          <p class="gdt-modal-note" data-s-note></p>
          <div class="gdt-modal-actions">
            <button type="button" class="gdt-btn" data-s-cancel>Cancel</button>
            <button type="button" class="gdt-btn" data-s-patch title="One multi-file unified diff — apply with git apply">Download .patch</button>
            <button type="button" class="gdt-btn gdt-btn-primary" data-s-go>Create pull request</button>
          </div>
          <p class="gdt-modal-progress" data-s-progress hidden aria-live="polite"></p>
        </div>
      </div>
    `);
    const q = (sel) => backdrop.querySelector(sel);
    const filesEl = q('[data-s-files]');
    for (const path of paths) {
      const li = document.createElement('li');
      li.textContent = path;
      filesEl.appendChild(li);
    }
    const msg = paths.length === 1 ? defaultCommitMessage(paths[0]) : `docs: update ${paths.length} documents`;
    q('[data-s-msg]').value = msg;
    q('[data-s-branch]').value = `docs-tab/session-${Math.random().toString(36).slice(2, 8)}`;
    q('[data-s-title]').value = msg;
    q('[data-s-body]').value = `Updates:\n${paths.map((p) => `- ${p}`).join('\n')}\n\nProposed from the Github++ extension.`;
    if (!client.hasToken) {
      q('[data-s-note]').textContent =
        'Creating the PR needs a GitHub token (extension options). The .patch download works without one.';
      q('[data-s-go]').disabled = true;
    } else {
      q('[data-s-note]').textContent =
        'Creates one branch with a commit per file, then opens a single pull request (your fork is used automatically without push access).';
    }
    const closeModal = () => backdrop.remove();
    q('[data-s-cancel]').addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });
    q('[data-s-patch]').addEventListener('click', async () => {
      const progress = q('[data-s-progress]');
      progress.hidden = false;
      progress.textContent = 'Building patch…';
      try {
        let patch = '';
        for (const path of paths) {
          patch += buildUnifiedPatch(path, await ensureBaseSource(path), drafts[path].content);
        }
        if (!patch) {
          progress.textContent = 'Drafts are identical to the repository — nothing to patch.';
          return;
        }
        const url = URL.createObjectURL(new Blob([patch], { type: 'text/x-patch' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'docs-session.patch';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        progress.textContent = 'Patch downloaded — apply with: git apply docs-session.patch';
      } catch (err) {
        progress.textContent = `Failed: ${(err && err.message) || err}`;
      }
    });
    q('[data-s-go]').addEventListener('click', async () => {
      const progress = q('[data-s-progress]');
      progress.hidden = false;
      q('[data-s-go]').disabled = true;
      q('[data-s-cancel]').disabled = true;
      try {
        const result = await client.createBatchPr({
          files: paths.map((p) => ({ path: p, content: drafts[p].content })),
          message: q('[data-s-msg]').value.trim() || msg,
          branch: q('[data-s-branch]').value.trim() || `docs-tab/session-${Math.random().toString(36).slice(2, 8)}`,
          title: q('[data-s-title]').value.trim() || msg,
          body: q('[data-s-body]').value,
          onProgress: (t) => (progress.textContent = t),
        });
        drafts = await clearDrafts(client.owner, client.repo);
        renderTree();
        refreshDraftBanner();
        const panel = q('.gdt-modal');
        panel.textContent = '';
        panel.appendChild(
          h(
            `<div><h3>Pull request created</h3><p><a class="gdt-btn gdt-btn-primary" target="_blank" rel="noopener noreferrer" href="${result.url}">Open pull request #${result.number} ↗</a></p><p><button type="button" class="gdt-btn" data-s-close>Close</button></p></div>`
          )
        );
        panel.querySelector('[data-s-close]').addEventListener('click', closeModal);
      } catch (err) {
        progress.textContent = `Failed: ${(err && err.message) || err}`;
        q('[data-s-go]').disabled = false;
        q('[data-s-cancel]').disabled = false;
      }
    });
    root.appendChild(backdrop);
  }

  function buildArticleHeader(path, m, doc, rd) {
    const hasMeta = m && m.data && Object.keys(m.data).length > 0;
    const isMdx = /\.mdx$/i.test(path);
    if (!hasMeta && !isMdx) return null;
    const wrap = document.createElement('div');
    wrap.className = 'gdt-doc-head';
    if (m && m.data && typeof m.data.title === 'string' && m.data.title.trim()) {
      const t = document.createElement('h1');
      t.className = 'gdt-doc-title';
      t.textContent = m.data.title;
      wrap.appendChild(t);
    }
    if (m && m.data && typeof m.data.description === 'string' && m.data.description.trim()) {
      const d = document.createElement('p');
      d.className = 'gdt-doc-desc';
      d.textContent = m.data.description;
      wrap.appendChild(d);
    }
    const badges = document.createElement('div');
    badges.className = 'gdt-doc-badges';
    if (isMdx) {
      const b = document.createElement('span');
      b.className = 'gdt-badge';
      b.textContent = 'MDX rendered as Markdown';
      badges.appendChild(b);
    }
    if (m && m.tags && m.tags.length) {
      for (const tag of m.tags) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'gdt-tag-chip gdt-tag-inline';
        chip.textContent = tag;
        chip.addEventListener('click', () => searchUI.setQuery(`tag:${tag} `));
        badges.appendChild(chip);
      }
    }
    if (badges.children.length) wrap.appendChild(badges);
    if (hasMeta) {
      const extra = Object.entries(m.data).filter(
        ([k]) => !['title', 'description', 'tags', 'keywords', 'categories'].includes(k)
      );
      if (extra.length) {
        const det = document.createElement('details');
        det.className = 'gdt-fm';
        const sum = document.createElement('summary');
        sum.textContent = 'Metadata';
        det.appendChild(sum);
        const dl = document.createElement('dl');
        for (const [k, v] of extra) {
          const dt = document.createElement('dt');
          dt.textContent = k;
          const dd = document.createElement('dd');
          dd.textContent = typeof v === 'object' ? JSON.stringify(v) : String(v);
          dl.appendChild(dt);
          dl.appendChild(dd);
        }
        det.appendChild(dl);
        wrap.appendChild(det);
      }
    }
    return wrap.children.length ? wrap : null;
  }

  function renderCrumbs(path) {
    const crumbs = refs.crumbs;
    crumbs.textContent = '';
    const mkLink = (text, hash) => {
      const a = document.createElement('a');
      a.textContent = text;
      a.href = hash;
      return a;
    };
    crumbs.appendChild(mkLink('Docs', buildHash({})));
    const segs = path.split('/');
    let acc = '';
    segs.forEach((seg, i) => {
      const sep = document.createElement('span');
      sep.className = 'gdt-crumb-sep';
      sep.textContent = '/';
      crumbs.appendChild(sep);
      acc = acc ? `${acc}/${seg}` : seg;
      if (i === segs.length - 1) {
        const cur = document.createElement('span');
        cur.className = 'gdt-crumb-current';
        cur.textContent = displayTitle(path) || seg;
        crumbs.appendChild(cur);
      } else {
        const node = findNode(tree, acc);
        const idx = node && node.isDir ? dirIndexDoc(node) : null;
        if (idx) crumbs.appendChild(mkLink(seg, buildHash({ path: idx.path })));
        else {
          const s = document.createElement('span');
          s.textContent = seg;
          crumbs.appendChild(s);
        }
      }
    });
  }

  function renderPrevNext() {
    refs.article.querySelector('.gdt-prevnext')?.remove();
    const i = flat.findIndex((d) => d.path === currentPath);
    if (i === -1) return;
    const wrap = document.createElement('nav');
    wrap.className = 'gdt-prevnext';
    const mk = (doc, cls, label) => {
      const a = document.createElement('a');
      a.className = `gdt-pn ${cls}`;
      a.href = buildHash({ path: doc.path });
      const l = document.createElement('span');
      l.className = 'gdt-pn-label';
      l.textContent = label;
      const t = document.createElement('span');
      t.className = 'gdt-pn-title';
      t.textContent = displayTitle(doc.path);
      a.appendChild(l);
      a.appendChild(t);
      return a;
    };
    if (i > 0) wrap.appendChild(mk(flat[i - 1], 'gdt-prev', '← Previous'));
    if (i < flat.length - 1) wrap.appendChild(mk(flat[i + 1], 'gdt-next', 'Next →'));
    if (wrap.children.length) refs.article.appendChild(wrap);
  }

  function renderToc(toc) {
    const entries = toc.filter((t) => t.level >= 1 && t.level <= 3);
    if (tocObserver) {
      tocObserver.disconnect();
      tocObserver = null;
    }
    if (entries.length < 2) {
      refs.toc.hidden = true;
      return;
    }
    refs.toc.hidden = false;
    refs.toc.textContent = '';
    const title = document.createElement('div');
    title.className = 'gdt-toc-title';
    title.textContent = 'On this page';
    refs.toc.appendChild(title);
    const ul = document.createElement('ul');
    for (const entry of entries) {
      const li = document.createElement('li');
      li.className = `gdt-toc-l${entry.level}`;
      const a = document.createElement('a');
      a.textContent = entry.text;
      a.href = confluenceRoute
        ? buildConfluenceHash({ ...confluenceRoute, heading: entry.slug })
        : buildHash({ path: currentPath, heading: entry.slug });
      a.setAttribute('data-gdt-toc-slug', entry.slug);
      li.appendChild(a);
      ul.appendChild(li);
    }
    refs.toc.appendChild(ul);

    tocObserver = new IntersectionObserver(
      (obsEntries) => {
        for (const oe of obsEntries) {
          if (oe.isIntersecting) {
            for (const link of refs.toc.querySelectorAll('a.gdt-toc-active')) link.classList.remove('gdt-toc-active');
            const link = refs.toc.querySelector(`a[data-gdt-toc-slug="${cssEscape(oe.target.id)}"]`);
            if (link) link.classList.add('gdt-toc-active');
          }
        }
      },
      { rootMargin: '0px 0px -75% 0px' }
    );
    for (const entry of entries) {
      const el = refs.article.querySelector(`#${cssEscape(entry.slug)}`);
      if (el) tocObserver.observe(el);
    }
  }

  function scrollToHeading(anchor) {
    if (!anchor) return;
    const tryIds = [anchor, githubSlug(anchor), `user-content-${anchor}`];
    for (const id of tryIds) {
      const el = refs.article.querySelector(`#${cssEscape(id)}`) || refs.article.querySelector(`#${cssEscape('gdt-cf-' + id)}`) || refs.article.querySelector(`[name="${cssEscape(id)}"]`);
      if (el) {
        el.scrollIntoView({ block: 'start' });
        el.classList.add('gdt-flash');
        setTimeout(() => el.classList.remove('gdt-flash'), 1600);
        return;
      }
    }
  }

  function renderMessage(title, body) {
    refs.article.textContent = '';
    const box = document.createElement('div');
    box.className = 'gdt-message';
    box.setAttribute('data-gdt-error', '');
    const t = document.createElement('h2');
    t.textContent = title;
    const p = document.createElement('p');
    p.textContent = body;
    box.appendChild(t);
    box.appendChild(p);
    refs.article.appendChild(box);
    return box;
  }

  function renderError(path, err) {
    if (err instanceof RateLimitError) {
      const when = err.resetAt ? ` Limits reset at ${new Date(err.resetAt).toLocaleTimeString()}.` : '';
      const box = renderMessage(
        'GitHub rate limit reached',
        `Anonymous GitHub API access is limited to 60 requests/hour.${when} ` +
          'Add a personal access token in the extension options (click the extension icon in your toolbar) ' +
          'to raise the limit to 5,000/hour and enable private repositories.'
      );
      box.classList.add('gdt-ratelimit');
      return;
    }
    const box = renderMessage('Could not load document', `${path}: ${(err && err.message) || err}`);
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'gdt-btn';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => {
      contentCache.delete(path);
      const p = currentPath;
      currentPath = null;
      renderArticle(p, null);
    });
    box.appendChild(retry);
  }

  // ---- clipboard ------------------------------------------------------------

  function copyText(text) {
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    };
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => fallback()
    );
  }

  // ---- live editor ----------------------------------------------------------

  async function openEditor(path) {
    let source = contentCache.get(path);
    if (source == null) {
      try {
        source = await client.getRawText(path, { sha: (docByPath.get(path) || {}).sha });
        contentCache.set(path, source);
      } catch (err) {
        renderError(path, err);
        return;
      }
    }
    if (editor && !closeEditor(false)) return;
    if (tocObserver) {
      tocObserver.disconnect();
      tocObserver = null;
    }
    refs.toc.hidden = true;
    refs.article.textContent = '';
    buildEditor(path, source, drafts[path] ? drafts[path].content : null);
    updateEditorState(true);
  }

  function closeEditor(silent) {
    if (!editor) return true;
    const val = editor.textarea.value;
    const unsaved = val !== editor.original && val !== editor.savedDraftContent;
    if (!silent && unsaved && !window.confirm('Discard your unsaved edits? (Use "Save draft" to keep them for this session.)')) {
      return false;
    }
    const path = editor.path;
    editor.el.remove();
    editor = null;
    if (!silent && mounted) {
      currentPath = null; // force re-render of the article
      renderArticle(path, null);
    }
    return true;
  }

  function buildEditor(path, source, draftContent) {
    const el = h(`
      <div class="gdt-editor">
        <div class="gdt-ed-toolbar" data-ed-toolbar>
          <span class="gdt-ed-file">${md.utils.escapeHtml(path)}</span>
        </div>
        <div class="gdt-ed-split">
          <textarea class="gdt-ed-source" spellcheck="false" aria-label="Markdown source"></textarea>
          <div class="gdt-ed-preview"><article class="gdt-md" data-ed-preview></article></div>
        </div>
        <div class="gdt-ed-footer">
          <span class="gdt-ed-status" data-ed-status></span>
          <span class="gdt-ed-actions">
            <button type="button" class="gdt-btn" data-ed-cancel>Cancel</button>
            <button type="button" class="gdt-btn" data-ed-draft title="Stage this edit locally — batch several files, then publish the session as one PR">Save draft</button>
            <button type="button" class="gdt-btn" data-ed-copy-patch>Copy patch</button>
            <button type="button" class="gdt-btn" data-ed-download>Download .patch</button>
            <button type="button" class="gdt-btn" data-ed-github title="Opens GitHub's own editor pre-filled with your changes — commit with your logged-in account">Propose via GitHub editor</button>
            <button type="button" class="gdt-btn gdt-btn-primary" data-ed-pr>Create pull request…</button>
          </span>
        </div>
      </div>
    `);
    const textarea = el.querySelector('.gdt-ed-source');
    textarea.value = draftContent ?? source;
    editor = {
      path,
      original: source,
      savedDraftContent: draftContent,
      el,
      textarea,
      preview: el.querySelector('[data-ed-preview]'),
      status: el.querySelector('[data-ed-status]'),
      dirty: false,
      buttons: ['[data-ed-copy-patch]', '[data-ed-download]', '[data-ed-github]', '[data-ed-pr]'].map((sel) =>
        el.querySelector(sel)
      ),
    };

    const TOOLS = [
      ['B', 'Bold', () => wrapSelection('**')],
      ['I', 'Italic', () => wrapSelection('_')],
      ['S̶', 'Strikethrough', () => wrapSelection('~~')],
      ['<>', 'Inline code', () => wrapSelection('`')],
      ['H2', 'Heading', () => prefixLines('## ')],
      ['•', 'List item', () => prefixLines('- ')],
      ['☑', 'Task item', () => prefixLines('- [ ] ')],
      ['❝', 'Quote', () => prefixLines('> ')],
      ['🔗', 'Link', () => insertAtSelection('[', '](https://)')],
      ['[[ ]]', 'Wiki link', () => insertAtSelection('[[', ']]')],
    ];
    const toolbar = el.querySelector('[data-ed-toolbar]');
    for (const [label, title, run] of TOOLS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gdt-ed-btn';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', () => {
        run();
        textarea.focus();
        onEdited();
      });
      toolbar.appendChild(b);
    }

    let previewTimer = 0;
    const onEdited = () => {
      updateEditorState(false);
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => updateEditorState(true), 250);
    };
    textarea.addEventListener('input', onEdited);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        insertAtSelection('  ', '');
        onEdited();
      }
    });

    el.querySelector('[data-ed-cancel]').addEventListener('click', () => closeEditor(false));
    el.querySelector('[data-ed-draft]').addEventListener('click', async () => {
      const val = editor.textarea.value;
      let note;
      if (val === editor.original) {
        drafts = await removeDraft(client.owner, client.repo, path);
        editor.savedDraftContent = null;
        note = 'No changes vs the repository — draft removed.';
      } else {
        drafts = await saveDraft(client.owner, client.repo, path, {
          content: val,
          baseSha: (docByPath.get(path) || {}).sha ?? null,
          savedAt: Date.now(),
        });
        editor.savedDraftContent = val;
        note = `Draft saved — ${Object.keys(drafts).length} file(s) staged in this session.`;
      }
      renderTree();
      updateEditorState(false);
      editor.status.textContent = note;
    });
    el.querySelector('[data-ed-download]').addEventListener('click', downloadPatch);
    el.querySelector('[data-ed-copy-patch]').addEventListener('click', copyPatch);
    el.querySelector('[data-ed-github]').addEventListener('click', proposeViaGitHub);
    el.querySelector('[data-ed-pr]').addEventListener('click', () => openPrModal());
    refs.article.appendChild(el);
    textarea.focus();
  }

  function updateEditorState(renderPreview) {
    if (!editor) return;
    const val = editor.textarea.value;
    editor.dirty = val !== editor.original;
    const draftBaseline = editor.savedDraftContent ?? editor.original;
    if (val === editor.savedDraftContent) editor.status.textContent = 'Editing saved draft';
    else editor.status.textContent = editor.dirty ? 'Unsaved changes' : 'No changes yet';
    for (const b of editor.buttons) b.disabled = !editor.dirty;
    const draftBtn = editor.el.querySelector('[data-ed-draft]');
    if (draftBtn) draftBtn.disabled = val === draftBaseline;
    if (renderPreview) {
      try {
        const rd = renderDoc(md, val, { path: editor.path, ctx });
        editor.preview.textContent = '';
        editor.preview.appendChild(rd.fragment);
      } catch (err) {
        editor.preview.textContent = `Preview error: ${(err && err.message) || err}`;
      }
    }
  }

  function wrapSelection(marker) {
    const ta = editor.textarea;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const inner = value.slice(s, e) || 'text';
    ta.value = value.slice(0, s) + marker + inner + marker + value.slice(e);
    ta.setSelectionRange(s + marker.length, s + marker.length + inner.length);
  }

  function insertAtSelection(before, after) {
    const ta = editor.textarea;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const inner = value.slice(s, e);
    ta.value = value.slice(0, s) + before + inner + after + value.slice(e);
    const pos = s + before.length + inner.length;
    ta.setSelectionRange(pos, pos);
  }

  function prefixLines(prefix) {
    const ta = editor.textarea;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const lineEnd = value.indexOf('\n', e) === -1 ? value.length : value.indexOf('\n', e);
    const block = value.slice(lineStart, lineEnd);
    const prefixed = block
      .split('\n')
      .map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : prefix + l))
      .join('\n');
    ta.value = value.slice(0, lineStart) + prefixed + value.slice(lineEnd);
    ta.setSelectionRange(lineStart, lineStart + prefixed.length);
  }

  function currentPatch() {
    return buildUnifiedPatch(editor.path, editor.original, editor.textarea.value);
  }

  function downloadPatch() {
    const patch = currentPatch();
    if (!patch) return;
    const url = URL.createObjectURL(new Blob([patch], { type: 'text/x-patch' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${basename(editor.path)}.patch`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    editor.status.textContent = `Patch downloaded — apply with: git apply ${basename(editor.path)}.patch`;
  }

  function copyPatch() {
    const patch = currentPatch();
    if (!patch) return;
    navigator.clipboard
      .writeText(patch)
      .then(() => (editor.status.textContent = 'Patch copied to clipboard'))
      .catch(() => (editor.status.textContent = 'Clipboard unavailable — use Download instead'));
  }

  async function proposeViaGitHub() {
    const path = editor.path;
    const content = editor.textarea.value;
    try {
      await ext.storage.local.set({
        'gdt:pending-edit': { owner: client.owner, repo: client.repo, path, content, savedAt: Date.now() },
      });
    } catch {
      editor.status.textContent = 'Could not stash the edit — try Download .patch instead.';
      return;
    }
    let branch = 'main';
    try {
      branch = (await client.getRepoInfo()).defaultBranch;
    } catch {
      // default guess is fine; GitHub will 404 visibly if wrong
    }
    editor.dirty = false; // handing off — do not block navigation with a confirm
    location.href = editPageUrl(client.owner, client.repo, branch, path);
  }

  function openPrModal() {
    const path = editor.path;
    const backdrop = h(`
      <div class="gdt-modal-backdrop">
        <div class="gdt-modal" role="dialog" aria-label="Create pull request">
          <h3>Propose change as pull request</h3>
          <label>Commit message <input data-pr-msg autocomplete="off" spellcheck="false" /></label>
          <label>Branch name <input data-pr-branch autocomplete="off" spellcheck="false" /></label>
          <label>Pull request title <input data-pr-title autocomplete="off" /></label>
          <label>Description <textarea data-pr-body rows="3"></textarea></label>
          <p class="gdt-modal-note" data-pr-note></p>
          <div class="gdt-modal-actions">
            <button type="button" class="gdt-btn" data-pr-cancel>Cancel</button>
            <button type="button" class="gdt-btn gdt-btn-primary" data-pr-go>Create pull request</button>
          </div>
          <p class="gdt-modal-progress" data-pr-progress hidden aria-live="polite"></p>
        </div>
      </div>
    `);
    const q = (sel) => backdrop.querySelector(sel);
    const msg = defaultCommitMessage(path);
    q('[data-pr-msg]').value = msg;
    q('[data-pr-branch]').value = branchNameFor(path, Math.random().toString(36).slice(2, 8));
    q('[data-pr-title]').value = msg;
    q('[data-pr-body]').value = 'Proposed from the Github++ extension.';
    if (!client.hasToken) {
      q('[data-pr-note]').textContent =
        'A GitHub token with Contents and Pull requests (write) permission is required — add one in the extension options, or use "Propose via GitHub editor" instead.';
      q('[data-pr-go]').disabled = true;
    } else {
      q('[data-pr-note]').textContent =
        'Creates a branch and a single-file commit, then opens a pull request. Your fork is used automatically if you lack push access.';
    }
    const closeModal = () => backdrop.remove();
    q('[data-pr-cancel]').addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });
    q('[data-pr-go]').addEventListener('click', async () => {
      const progress = q('[data-pr-progress]');
      progress.hidden = false;
      q('[data-pr-go]').disabled = true;
      q('[data-pr-cancel]').disabled = true;
      try {
        const result = await client.createEditPr({
          path,
          content: editor.textarea.value,
          message: q('[data-pr-msg]').value.trim() || msg,
          branch: q('[data-pr-branch]').value.trim() || branchNameFor(path, Math.random().toString(36).slice(2, 8)),
          title: q('[data-pr-title]').value.trim() || msg,
          body: q('[data-pr-body]').value,
          onProgress: (t) => (progress.textContent = t),
        });
        editor.original = editor.textarea.value; // committed — no longer dirty
        updateEditorState(false);
        const panel = q('.gdt-modal');
        panel.textContent = '';
        const done = h(
          `<div><h3>Pull request created</h3><p><a class="gdt-btn gdt-btn-primary" target="_blank" rel="noopener noreferrer" href="${result.url}">Open pull request #${result.number} ↗</a></p><p><button type="button" class="gdt-btn" data-pr-close>Close</button></p></div>`
        );
        panel.appendChild(done);
        panel.querySelector('[data-pr-close]').addEventListener('click', closeModal);
      } catch (err) {
        progress.textContent = `Failed: ${(err && err.message) || err}`;
        q('[data-pr-go]').disabled = false;
        q('[data-pr-cancel]').disabled = false;
      }
    });
    root.appendChild(backdrop);
  }

  // Auto-restore org mode from the persisted snapshot: grouped sidebar comes
  // back instantly; the search index rebuilds in the background.
  // Restore the grouped sidebar from the cached snapshot only. Content is NOT
  // fetched automatically (that would be dozens of requests on every page
  // load) — repos show as available-but-unindexed until the user indexes them
  // via the re-index button or by expanding a repo and confirming.
  let orgRestoreTried = false;
  async function maybeRestoreOrg() {
    if (orgRestoreTried || orgSession) return;
    orgRestoreTried = true;
    const snap = await loadOrgSnapshot(client.owner);
    if (!snap || !snap.size || disposed || orgSession) return;
    if (!snap.has(client.repo)) snap.set(client.repo, docs);
    let totalDocs = 0;
    for (const d of snap.values()) totalDocs += d.length;
    const repoState = new Map();
    for (const repo of snap.keys()) repoState.set(repo, { phase: 'idle', pct: 0 });
    orgSession = {
      org: client.owner,
      index: new ContentIndex(),
      repoDocs: snap,
      errors: [],
      totalDocs,
      indexing: false,
      repoState,
      browseAck: new Set(),
    };
    renderTree();
    foldCurrentRepoIntoOrg(); // free: current repo's content is already fetched

    // Repos whose every document is already in the persistent blob cache can
    // be indexed with zero network — do so automatically so they show up
    // indexed (green, searchable) instead of prompting the user to re-index.
    const limitBytes = (settings.contentSearchLimitKB || 200) * 1024;
    const cachedShas = await getCachedShaSet();
    const readyFromCache = [...snap.keys()].filter(
      (repo) => repo !== client.repo && repoContentCached(snap.get(repo) || [], cachedShas, limitBytes)
    );
    if (readyFromCache.length && orgSession && !disposed) runOrgIndex(readyFromCache);
  }

  // Fold the current repo's already-indexed content into the org index at no
  // request cost (reuses the single-repo ContentIndex entries via contentCache).
  function foldCurrentRepoIntoOrg() {
    if (!orgSession || !indexState.finished) return;
    const st = orgSession.repoState.get(client.repo);
    if (st && st.phase === 'done') return;
    for (const doc of docs) {
      const source = contentCache.get(doc.path);
      if (source == null) continue;
      const { data, content } = parseFrontmatter(source);
      orgSession.index.add(`${client.repo}${ORG_SEP}${doc.path}`, {
        text: mdToPlainText(content),
        title: displayTitle(doc.path),
        headings: extractHeadings(content),
        tags: (metaByPath.get(doc.path) || {}).tags || [],
      });
    }
    setRepoState(client.repo, { phase: 'done' });
  }

  // Fetch + index a set of repos, updating their rings live. Used by the
  // re-index button (all repos) and the per-repo expand confirmation.
  async function runOrgIndex(repoNames) {
    if (disposed || !orgSession || !repoNames.length) return;
    const subset = new Map();
    for (const repo of repoNames) subset.set(repo, orgSession.repoDocs.get(repo) || []);
    orgSession.indexing = true;
    updateSidebarMeta();
    try {
      await indexOrgContent({
        owner: client.owner,
        repoDocs: subset,
        settings,
        onProgress: (ev) => {
          if (!orgSession) return;
          const frac = ev.filesTotal ? ev.filesDone / ev.filesTotal : 1;
          setRepoState(ev.repo, { phase: ev.filesDone >= ev.filesTotal ? 'done' : 'indexing', pct: Math.round(frac * 100) });
        },
        // merge into the existing org index rather than replacing it
      }).then((idx) => {
        if (!orgSession) return;
        orgSession.index.merge(idx);
        notifySearch();
      });
    } catch {
      // per-repo errors already surface via ring state
    } finally {
      if (orgSession) {
        orgSession.indexing = false;
        // Re-render so newly-indexed repos un-fade and their render-time
        // closures pick up the fresh state (no stale re-prompts). Expansion
        // state persists across renderTree, so open repos stay open.
        renderTree();
      }
    }
  }

  // ---- public ---------------------------------------------------------------

  return {
    async open(route) {
      if (!root) buildDom();
      if (mounted && !root.isConnected) {
        // Turbo replaced <main> under us — the old mount is gone.
        mounted = false;
        document.querySelectorAll('[data-gdt-hidden]').forEach((el) => el.removeAttribute('data-gdt-hidden'));
      }
      if (!mounted) {
        if (!mount()) return;
        applyTheme();
        prepareSearch();
      }
      await renderRoute(route);
    },
    close,
    dispose() { disposed = true; close(); confluence?.stop(); searchListeners.clear(); searchUI?.destroy(); },
    getSearchSource() { prepareSearch(); return searchOptions(); },
    focusSearch: () => searchUI?.focus(),
    refreshConfluenceAttachments: () => confluence?.reloadAttachments(),
    isOpen: () => mounted,
  };
}
