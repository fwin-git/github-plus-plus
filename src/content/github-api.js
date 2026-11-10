// GitHub data access: recursive tree with ETag/storage caching, raw file
// contents, rate-limit awareness. api.github.com and raw.githubusercontent.com
// are CORS-open (ACAO: *), so the content script fetches directly.
import { ext } from '../common/browser.js';
import { encodePath, basename } from '../common/paths.js';
import { toBase64Utf8 } from '../common/edit-utils.js';
import { readBlob, writeBlob } from './blob-cache.js';
import { summarizePrFiles } from '../common/pr-stats.js';

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const TREE_TTL_MS = 15 * 60 * 1000;
const MAX_SUBTREE_FETCHES = 15;

export class RateLimitError extends Error {
  constructor(resetAt) {
    super('GitHub API rate limit exceeded');
    this.name = 'RateLimitError';
    this.resetAt = resetAt ?? null;
  }
}

export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
  }
}

// Pure cache-freshness decision (unit-tested).
export function shouldRevalidate(entry, now, ttlMs = TREE_TTL_MS) {
  if (!entry || !Array.isArray(entry.entries)) return 'fetch';
  if (now - (entry.fetchedAt ?? 0) < ttlMs) return 'use';
  return entry.etag ? 'revalidate' : 'fetch';
}

// Pure merge of a shallow root listing with recursively fetched subtrees
// (unit-tested). Later entries win on path collisions.
export function mergeTruncatedTrees(rootEntries, subtrees) {
  const out = new Map();
  for (const e of rootEntries || []) {
    if (e && typeof e.path === 'string') out.set(e.path, e);
  }
  for (const { prefix, entries } of subtrees || []) {
    for (const e of entries || []) {
      if (!e || typeof e.path !== 'string') continue;
      const path = prefix ? `${prefix}/${e.path}` : e.path;
      out.set(path, { ...e, path });
    }
  }
  return [...out.values()];
}

export function makeClient({ owner, repo, token = '', candidateFolders = [] }) {
  const treeKey = `gdt:tree:${owner}/${repo}`;
  const rate = { remaining: null, resetAt: null };

  const apiHeaders = () => {
    const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  };

  const trackRate = (res) => {
    const rem = res.headers.get('x-ratelimit-remaining');
    if (rem != null) rate.remaining = Number(rem);
    const reset = res.headers.get('x-ratelimit-reset');
    if (reset != null) rate.resetAt = Number(reset) * 1000;
    const retry = res.headers.get('retry-after');
    if (retry != null) {
      const retryAt = /^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry);
      if (Number.isFinite(retryAt)) rate.resetAt = Math.max(rate.resetAt || 0, retryAt);
    }
  };

  const isRateLimited = (res) =>
    res.status === 429 || (res.status === 403 &&
      (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after')));

  // Turns common auth failures into actionable messages (SAML SSO gating is
  // the usual reason a valid-looking token cannot see an org's private repo).
  const explainAuthFailure = (res) => {
    const sso = res.headers.get('x-github-sso');
    if (sso && sso.startsWith('required')) {
      return new Error(
        'Your organization requires SAML SSO authorization for this token — open github.com/settings/tokens and use "Configure SSO" on it.'
      );
    }
    if (res.status === 401) {
      return new Error('GitHub rejected the token (401) — it may be expired, revoked, or mistyped.');
    }
    if (res.status === 404) {
      return new NotFoundError(
        token
          ? `Token cannot access ${owner}/${repo} (404). For private org repos the token must be granted to ${owner} — ` +
              'fine-grained tokens need the org set as resource owner (and the org must allow fine-grained PATs); ' +
              'classic tokens need the "repo" scope (plus SSO authorization if the org enforces SAML).'
          : `Anonymous request got 404 for ${owner}/${repo} — if this repo is private, no token reached the request; ` +
              'add/save one in the extension options and reload this tab.'
      );
    }
    return null;
  };

  const storageGet = async (key) => {
    try {
      return (await ext.storage.local.get(key))[key];
    } catch {
      return undefined;
    }
  };
  const storageSet = async (key, val) => {
    try {
      await ext.storage.local.set({ [key]: val });
    } catch {
      // storage quota exceeded on a huge tree: run uncached
    }
  };

  const slim = (list) => (list || []).map(({ path, type, sha, size }) => ({ path, type, sha, size }));

  const cachedResult = (cached, stale) => ({
    sha: cached.sha,
    entries: cached.entries,
    truncated: !!cached.truncated,
    stale,
    fromCache: true,
  });

  async function fetchSubtree(sha) {
    const res = await fetch(`${API}/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`, { headers: apiHeaders() });
    trackRate(res);
    if (!res.ok) throw new Error(`subtree ${res.status}`);
    return res.json();
  }

  // The recursive listing got truncated (>100k entries / 7 MB). Fall back to a
  // shallow root listing plus recursive fetches of just the candidate folders.
  async function expandTruncated() {
    const res = await fetch(`${API}/repos/${owner}/${repo}/git/trees/HEAD`, { headers: apiHeaders() });
    trackRate(res);
    if (!res.ok) throw new Error(`root ${res.status}`);
    const root = await res.json();
    const rootEntries = slim(root.tree);
    const wanted = new Set(
      (candidateFolders || [])
        .map((f) => String(f).toLowerCase().split('/')[0])
        .filter((f) => f && !f.includes('/'))
    );
    const targets = rootEntries
      .filter((e) => e.type === 'tree' && wanted.has(e.path.toLowerCase()))
      .slice(0, MAX_SUBTREE_FETCHES);
    const subtrees = [];
    for (const t of targets) {
      try {
        const sub = await fetchSubtree(t.sha);
        subtrees.push({ prefix: t.path, entries: slim(sub.tree) });
      } catch {
        // partial coverage is still useful
      }
    }
    return { sha: root.sha, entries: mergeTruncatedTrees(rootEntries, subtrees), truncated: false };
  }

  // Background ETag revalidation (stale-while-revalidate): the UI renders
  // from cache instantly; a 304 just bumps freshness, a 200 updates storage
  // for the next load. Never blocks the Docs tab on a network round-trip.
  let revalidating = false;
  function revalidateInBackground(cached) {
    if (revalidating) return;
    revalidating = true;
    (async () => {
      try {
        const h = apiHeaders();
        if (cached.etag) h['If-None-Match'] = cached.etag;
        const res = await fetch(`${API}/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`, { headers: h });
        trackRate(res);
        const now = Date.now();
        if (res.status === 304) {
          await storageSet(treeKey, { ...cached, fetchedAt: now });
          return;
        }
        if (!res.ok) return;
        const body = await res.json();
        let result = { sha: body.sha, entries: slim(body.tree), truncated: !!body.truncated };
        if (result.truncated) {
          try {
            result = await expandTruncated();
          } catch {
            // keep the truncated listing
          }
        }
        await storageSet(treeKey, { etag: res.headers.get('etag'), fetchedAt: now, ...result });
      } catch {
        // offline or rate-limited: the stale cache stays valid
      } finally {
        revalidating = false;
      }
    })();
  }

  async function getTree({ force = false } = {}) {
    const cached = await storageGet(treeKey);
    const now = Date.now();
    if (!force) {
      const mode = shouldRevalidate(cached, now);
      if (mode === 'use') return cachedResult(cached, false);
      if (mode === 'revalidate') {
        revalidateInBackground(cached);
        return cachedResult(cached, true);
      }
    }

    const h = apiHeaders();
    if (cached && cached.etag) h['If-None-Match'] = cached.etag;
    let res;
    try {
      res = await fetch(`${API}/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`, { headers: h });
    } catch (err) {
      if (cached && Array.isArray(cached.entries)) return cachedResult(cached, true);
      throw err;
    }
    trackRate(res);

    if (res.status === 304 && cached) {
      await storageSet(treeKey, { ...cached, fetchedAt: now });
      return cachedResult(cached, false);
    }
    if (isRateLimited(res)) {
      if (cached && Array.isArray(cached.entries)) return cachedResult(cached, true);
      throw new RateLimitError(rate.resetAt);
    }
    if (!res.ok) {
      const explained = explainAuthFailure(res);
      if (explained) throw explained;
      if (res.status === 404 || res.status === 409) throw new NotFoundError(`No readable tree for ${owner}/${repo}`);
      if (cached && Array.isArray(cached.entries)) return cachedResult(cached, true);
      throw new Error(`GitHub API error ${res.status}`);
    }

    const body = await res.json();
    let result = { sha: body.sha, entries: slim(body.tree), truncated: !!body.truncated };
    if (result.truncated) {
      try {
        result = await expandTruncated();
      } catch {
        // keep the truncated recursive listing
      }
    }
    await storageSet(treeKey, { etag: res.headers.get('etag'), fetchedAt: now, ...result });
    return { ...result, stale: false, fromCache: false };
  }

  async function getRawText(path, { sha } = {}) {
    // Content-addressed cache: a matching blob SHA means identical content,
    // so we can skip the network entirely (persists across sessions).
    if (sha) {
      const cached = await readBlob(sha);
      if (cached != null) return cached;
    }
    let res;
    if (token) {
      // Authorization on raw.githubusercontent is unreliable for fine-grained
      // tokens and CORS preflight; the contents API supports both cleanly.
      res = await fetch(`${API}/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=HEAD`, {
        headers: { ...apiHeaders(), Accept: 'application/vnd.github.raw+json' },
      });
      trackRate(res);
    } else {
      res = await fetch(`${RAW}/${owner}/${repo}/HEAD/${encodePath(path)}`);
    }
    if (!res.ok) {
      if (isRateLimited(res)) throw new RateLimitError(rate.resetAt);
      if (res.status === 404) throw new NotFoundError(`Not found: ${path}`);
      throw new Error(`Fetch failed (${res.status}) for ${path}`);
    }
    const text = await res.text();
    if (sha) writeBlob(sha, text); // fire-and-forget persistent cache
    return text;
  }

  async function getBlobObjectURL(path) {
    const res = await fetch(`${API}/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=HEAD`, {
      headers: { ...apiHeaders(), Accept: 'application/vnd.github.raw+json' },
    });
    trackRate(res);
    if (!res.ok) throw new Error(`blob ${res.status}`);
    return URL.createObjectURL(await res.blob());
  }

  // ---- edit / propose-change support ---------------------------------------

  async function apiJson(method, url, body, { allow404 = false, signal, cache } = {}) {
    const res = await fetch(`${API}${url}`, {
      method,
      headers: { ...apiHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal,
      cache,
    });
    trackRate(res);
    if (allow404 && res.status === 404) return null;
    if (isRateLimited(res)) throw new RateLimitError(rate.resetAt);
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.json()).message || '';
      } catch {
        // no JSON body
      }
      const err = new Error(`GitHub API ${res.status}${detail ? `: ${detail}` : ''} (${method} ${url})`);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  async function getPullRequestCounts({ signal } = {}) {
    // Read total_count, not the returned items (search caps the item list).
    const count = async (draft) => {
      const query = `repo:${owner}/${repo} is:pr is:open draft:${draft}`;
      const result = await apiJson('GET', `/search/issues?q=${encodeURIComponent(query)}&per_page=1`, null,
        { signal, cache: 'no-store' });
      if (!result || result.incomplete_results !== false ||
          !Number.isSafeInteger(result.total_count) || result.total_count < 0) {
        throw new Error('Incomplete PR search counts');
      }
      return result.total_count;
    };
    const open = await count(false);
    const drafts = await count(true);
    return { open, drafts, total: open + drafts };
  }

  async function getPullRequestStats(number, { signal } = {}) {
    if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid PR number');
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`;
    const get = (url) => apiJson('GET', url, null, { signal, cache: 'no-store' });
    const before = await get(path);
    const validCount = (n) => Number.isSafeInteger(n) && n >= 0;
    if (!before || !validCount(before.changed_files) || !validCount(before.additions) ||
        !validCount(before.deletions) || !before.head?.sha || !before.base?.sha) {
      throw new Error('Incomplete PR metadata');
    }
    if (before.changed_files > 3000) throw new Error('PR exceeds the 3,000-file API limit');
    const files = [];
    for (let page = 1; files.length < before.changed_files; page++) {
      const batch = await get(`${path}/files?per_page=100&page=${page}`);
      if (!Array.isArray(batch) || !batch.length || batch.length > 100 || page > 30) {
        throw new Error('Incomplete PR file list');
      }
      files.push(...batch);
      if (batch.length < 100 && files.length < before.changed_files) throw new Error('Incomplete PR file list');
    }
    if (files.length !== before.changed_files) throw new Error('Incomplete PR file list');
    const summary = summarizePrFiles(files);
    const after = await get(path);
    if (before.head.sha !== after?.head?.sha || before.base.sha !== after?.base?.sha ||
        ['changed_files', 'additions', 'deletions'].some((key) => before[key] !== after[key])) {
      throw new Error('PR changed while collecting file statistics');
    }
    const total = { additions: before.additions, deletions: before.deletions };
    if (summary.code.additions + summary.tests.additions !== total.additions ||
        summary.code.deletions + summary.tests.deletions !== total.deletions) {
      throw new Error('PR file statistics do not match the total');
    }
    return { ...summary, total, filePaths: files.map(file => file.filename) };
  }

  let repoInfoCache = null;
  async function getRepoInfo() {
    if (!repoInfoCache) {
      const info = await apiJson('GET', `/repos/${owner}/${repo}`);
      repoInfoCache = {
        defaultBranch: info.default_branch,
        name: info.name,
        canPush: !!(info.permissions && (info.permissions.push || info.permissions.maintain || info.permissions.admin)),
      };
    }
    return repoInfoCache;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Create branch -> one commit per file -> open a single PR against the
  // default branch. Forks automatically when the token lacks push access.
  async function createBatchPr({ files, message, branch, title, body, onProgress = () => {} }) {
    if (!token) throw new Error('A GitHub token is required (extension options).');
    if (!files.length) throw new Error('Nothing to publish.');
    const info = await getRepoInfo();
    const base = info.defaultBranch;

    let headOwner = owner;
    let headRepo = repo;
    if (!info.canPush) {
      onProgress('No push access — creating (or reusing) your fork…');
      const fork = await apiJson('POST', `/repos/${owner}/${repo}/forks`, {});
      headOwner = fork.owner.login;
      headRepo = fork.name;
      // Forking is async; wait until the fork's default branch is readable.
      let ready = false;
      for (let i = 0; i < 20 && !ready; i++) {
        ready = !!(await apiJson('GET', `/repos/${headOwner}/${headRepo}/git/ref/${encodeURIComponent(`heads/${base}`)}`, null, { allow404: true }));
        if (!ready) await sleep(1500);
      }
      if (!ready) throw new Error('Fork is not ready yet — please retry in a moment.');
    }

    onProgress('Creating branch…');
    const baseRef = await apiJson('GET', `/repos/${headOwner}/${headRepo}/git/ref/${encodeURIComponent(`heads/${base}`)}`);
    let headBranch = branch;
    try {
      await apiJson('POST', `/repos/${headOwner}/${headRepo}/git/refs`, {
        ref: `refs/heads/${headBranch}`,
        sha: baseRef.object.sha,
      });
    } catch (err) {
      if (err.status !== 422) throw err; // 422: branch exists — reuse a suffixed one
      headBranch = `${branch}-${Math.random().toString(36).slice(2, 6)}`;
      await apiJson('POST', `/repos/${headOwner}/${headRepo}/git/refs`, {
        ref: `refs/heads/${headBranch}`,
        sha: baseRef.object.sha,
      });
    }

    for (const file of files) {
      onProgress(`Committing ${file.path}…`);
      const existing = await apiJson(
        'GET',
        `/repos/${headOwner}/${headRepo}/contents/${encodePath(file.path)}?ref=${encodeURIComponent(headBranch)}`,
        null,
        { allow404: true }
      );
      await apiJson('PUT', `/repos/${headOwner}/${headRepo}/contents/${encodePath(file.path)}`, {
        message: files.length > 1 ? `${message}: ${basename(file.path)}` : message,
        content: toBase64Utf8(file.content),
        branch: headBranch,
        ...(existing && existing.sha ? { sha: existing.sha } : {}),
      });
    }

    onProgress('Opening pull request…');
    const pr = await apiJson('POST', `/repos/${owner}/${repo}/pulls`, {
      title,
      body,
      base,
      head: headOwner === owner ? headBranch : `${headOwner}:${headBranch}`,
      maintainer_can_modify: true,
    });
    return { url: pr.html_url, number: pr.number };
  }

  function createEditPr({ path, content, ...rest }) {
    return createBatchPr({ files: [{ path, content }], ...rest });
  }

  // Repos of the owning org (falls back to user accounts). Capped at 500.
  async function listOwnerRepos() {
    let lastErr = null;
    for (const base of [`/orgs/${owner}/repos`, `/users/${owner}/repos`]) {
      const repos = [];
      try {
        for (let page = 1; page <= 5; page++) {
          const batch = await apiJson('GET', `${base}?per_page=100&page=${page}&sort=pushed`);
          repos.push(
            ...batch.map((r) => ({
              name: r.name,
              description: r.description || '',
              archived: !!r.archived,
              private: !!r.private,
            }))
          );
          if (batch.length < 100) break;
        }
        return repos;
      } catch (err) {
        lastErr = err;
        if (err.status !== 404) throw err; // 404 on /orgs -> try /users
      }
    }
    throw lastErr;
  }

  const rawUrl = (path) => `${RAW}/${owner}/${repo}/HEAD/${encodePath(path)}`;
  const blobUrl = (path) => `https://github.com/${owner}/${repo}/blob/HEAD/${encodePath(path)}`;
  const editUrl = (path) => `https://github.com/${owner}/${repo}/edit/HEAD/${encodePath(path)}`;

  return {
    owner,
    repo,
    hasToken: !!token,
    getTree,
    getRawText,
    getBlobObjectURL,
    getRepoInfo,
    getPullRequestStats,
    getPullRequestCounts,
    createEditPr,
    createBatchPr,
    listOwnerRepos,
    rawUrl,
    blobUrl,
    editUrl,
    get rateLimit() {
      return { ...rate };
    },
  };
}

export async function clearTreeCaches() {
  const all = await ext.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith('gdt:tree:'));
  if (keys.length) await ext.storage.local.remove(keys);
  return keys.length;
}
