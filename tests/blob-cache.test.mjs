import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBlobEviction, repoContentCached } from '../src/content/blob-cache.js';

test('repoContentCached: true when every indexable doc SHA is cached', () => {
  const docs = [
    { path: 'a.md', sha: 's1', size: 100 },
    { path: 'b.md', sha: 's2', size: 100 },
  ];
  const cached = new Set(['s1', 's2']);
  assert.equal(repoContentCached(docs, cached, 200_000), true);
});

test('repoContentCached: false when any doc SHA is missing', () => {
  const docs = [
    { path: 'a.md', sha: 's1', size: 100 },
    { path: 'b.md', sha: 's2', size: 100 },
  ];
  assert.equal(repoContentCached(docs, new Set(['s1']), 200_000), false);
});

test('repoContentCached: ignores docs over the size limit (they are never indexed)', () => {
  const docs = [
    { path: 'a.md', sha: 's1', size: 100 },
    { path: 'big.md', sha: 's2', size: 999_999 },
  ];
  assert.equal(repoContentCached(docs, new Set(['s1']), 200_000), true);
});

test('repoContentCached: a repo with no indexable docs counts as cached', () => {
  assert.equal(repoContentCached([], new Set(), 200_000), true);
  assert.equal(repoContentCached([{ path: 'big.md', sha: 's', size: 999_999 }], new Set(), 200_000), true);
});


test('keeps everything when under budget', () => {
  const manifest = [
    { sha: 'a', at: 1, bytes: 100 },
    { sha: 'b', at: 2, bytes: 100 },
  ];
  const { keep, evict } = planBlobEviction(manifest, 1000);
  assert.deepEqual(evict, []);
  assert.equal(keep.length, 2);
});

test('evicts oldest first when over budget', () => {
  const manifest = [
    { sha: 'old', at: 10, bytes: 600 },
    { sha: 'mid', at: 20, bytes: 600 },
    { sha: 'new', at: 30, bytes: 600 },
  ];
  const { keep, evict } = planBlobEviction(manifest, 1000);
  // newest first: keep 'new' (600), 'mid' would make 1200 > 1000 -> evict mid, old
  assert.deepEqual(evict.sort(), ['mid', 'old']);
  assert.deepEqual(
    keep.map((e) => e.sha),
    ['new']
  );
});

test('a single oversized entry is still kept (never evict the newest write)', () => {
  const manifest = [{ sha: 'huge', at: 5, bytes: 5000 }];
  const { keep, evict } = planBlobEviction(manifest, 1000);
  assert.deepEqual(evict, []);
  assert.equal(keep.length, 1);
});

test('empty manifest is a no-op', () => {
  const { keep, evict } = planBlobEviction([], 1000);
  assert.deepEqual(keep, []);
  assert.deepEqual(evict, []);
});
