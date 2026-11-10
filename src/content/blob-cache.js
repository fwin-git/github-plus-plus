// Content-addressed cache of raw file text, keyed by git blob SHA. Because a
// blob SHA is a hash of the file's content, a cache hit is always exact — no
// TTL is needed. Backed by storage.local (with the unlimitedStorage
// permission) and bounded by an LRU byte budget.
import { ext } from '../common/browser.js';

const BUDGET_BYTES = 24 * 1024 * 1024; // 24 MB across all repos
const BLOB_PREFIX = 'gdt:blob:';
const IDX_KEY = 'gdt:blobidx';
const blobKey = (sha) => BLOB_PREFIX + sha;

// Pure eviction planner (unit-tested): keep newest-first until the byte budget
// is exhausted; evict the rest. The most recent write is always kept, even if
// it alone exceeds the budget.
export function planBlobEviction(manifest, budgetBytes) {
  const sorted = [...manifest].sort((a, b) => b.at - a.at);
  let total = 0;
  const keep = [];
  const evict = [];
  for (const e of sorted) {
    if (keep.length === 0 || total + e.bytes <= budgetBytes) {
      keep.push(e);
      total += e.bytes;
    } else {
      evict.push(e.sha);
    }
  }
  return { keep, evict };
}

// Pure: is every doc a repo would index already present in the cached SHA set?
// Docs above the size limit are never indexed, so they don't need to be cached.
export function repoContentCached(docs, cachedShaSet, limitBytes) {
  return docs.every((d) => (d.size && d.size > limitBytes) || (d.sha && cachedShaSet.has(d.sha)));
}

// The set of blob SHAs currently in the persistent cache (one storage read).
export async function getCachedShaSet() {
  if (!ext) return new Set();
  try {
    const idx = (await ext.storage.local.get(IDX_KEY))[IDX_KEY] || [];
    return new Set(idx.map((e) => e.sha));
  } catch {
    return new Set();
  }
}

export async function readBlob(sha) {
  if (!sha || !ext) return null;
  try {
    const rec = (await ext.storage.local.get(blobKey(sha)))[blobKey(sha)];
    return rec && typeof rec.t === 'string' ? rec.t : null;
  } catch {
    return null;
  }
}

// Writes are serialized through a single chain so concurrent indexing workers
// don't clobber the shared manifest with lost read-modify-write updates.
let writeChain = Promise.resolve();

async function doWrite(sha, text) {
  try {
    const now = Date.now();
    await ext.storage.local.set({ [blobKey(sha)]: { t: text, at: now } });
    const idx = (await ext.storage.local.get(IDX_KEY))[IDX_KEY] || [];
    const next = idx.filter((e) => e.sha !== sha);
    next.push({ sha, at: now, bytes: text.length });
    const { keep, evict } = planBlobEviction(next, BUDGET_BYTES);
    if (evict.length) await ext.storage.local.remove(evict.map(blobKey));
    await ext.storage.local.set({ [IDX_KEY]: keep });
  } catch {
    // storage full or unavailable: content cache is best-effort
  }
}

export function writeBlob(sha, text) {
  if (!sha || !ext || typeof text !== 'string') return;
  writeChain = writeChain.then(() => doWrite(sha, text)).catch(() => {});
}

export async function clearBlobCache() {
  if (!ext) return 0;
  try {
    const all = await ext.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith(BLOB_PREFIX) || k === IDX_KEY);
    if (keys.length) await ext.storage.local.remove(keys);
    return keys.filter((k) => k.startsWith(BLOB_PREFIX)).length;
  } catch {
    return 0;
  }
}

export async function blobCacheStats() {
  if (!ext) return { count: 0, bytes: 0 };
  try {
    const idx = (await ext.storage.local.get(IDX_KEY))[IDX_KEY] || [];
    return { count: idx.length, bytes: idx.reduce((n, e) => n + (e.bytes || 0), 0) };
  } catch {
    return { count: 0, bytes: 0 };
  }
}
