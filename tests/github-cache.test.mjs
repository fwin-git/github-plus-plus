import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRevalidate, mergeTruncatedTrees } from '../src/content/github-api.js';

const MIN = 60_000;

test('missing or malformed cache entries require a fetch', () => {
  assert.equal(shouldRevalidate(null, 0, 15 * MIN), 'fetch');
  assert.equal(shouldRevalidate({}, 0, 15 * MIN), 'fetch');
  assert.equal(shouldRevalidate({ entries: 'nope' }, 0, 15 * MIN), 'fetch');
});

test('fresh entries are used as-is', () => {
  const entry = { entries: [], fetchedAt: 100 * MIN, etag: 'W/"x"' };
  assert.equal(shouldRevalidate(entry, 110 * MIN, 15 * MIN), 'use');
});

test('stale entries revalidate when an etag exists, else refetch', () => {
  const withEtag = { entries: [], fetchedAt: 0, etag: 'W/"x"' };
  const withoutEtag = { entries: [], fetchedAt: 0 };
  assert.equal(shouldRevalidate(withEtag, 100 * MIN, 15 * MIN), 'revalidate');
  assert.equal(shouldRevalidate(withoutEtag, 100 * MIN, 15 * MIN), 'fetch');
});

test('mergeTruncatedTrees prefixes subtree paths and dedupes', () => {
  const root = [
    { path: 'README.md', type: 'blob', sha: 'r1' },
    { path: 'docs', type: 'tree', sha: 't1' },
  ];
  const subtrees = [
    {
      prefix: 'docs',
      entries: [
        { path: 'intro.md', type: 'blob', sha: 'b1' },
        { path: 'sub', type: 'tree', sha: 't2' },
        { path: 'sub/deep.md', type: 'blob', sha: 'b2' },
      ],
    },
  ];
  const merged = mergeTruncatedTrees(root, subtrees);
  const paths = merged.map((e) => e.path).sort();
  assert.deepEqual(paths, ['README.md', 'docs', 'docs/intro.md', 'docs/sub', 'docs/sub/deep.md']);
  assert.equal(merged.find((e) => e.path === 'docs/sub/deep.md').sha, 'b2');

  const deduped = mergeTruncatedTrees([{ path: 'a.md', type: 'blob', sha: 'old' }], [
    { prefix: '', entries: [{ path: 'a.md', type: 'blob', sha: 'new' }] },
  ]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].sha, 'new');
});
