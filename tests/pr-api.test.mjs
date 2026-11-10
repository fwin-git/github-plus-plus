import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClient, RateLimitError } from '../src/content/github-api.js';

const metadata = (changes = {}) => ({ head: { sha: 'head-a' }, base: { sha: 'base-a' }, changed_files: 2, additions: 15, deletions: 3, ...changes });
const files = [
  { filename: 'src/a.ts', status: 'modified', additions: 5, deletions: 2 },
  { filename: 'tests/a.ts', status: 'added', additions: 10, deletions: 1 },
];
const client = () => makeClient({ owner: 'acme', repo: 'widget', token: 'test-token' });

function serve(t, replies) {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const next = replies[count++];
    assert.ok(next, `Unexpected request: ${url}`);
    assert.equal(new URL(url).pathname + new URL(url).search, next.path);
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return new Response(JSON.stringify(next.body), { status: next.status || 200, headers: next.headers });
  });
}
const pr = (body = metadata()) => ({ path: '/repos/acme/widget/pulls/42', body });
const page = (body = files, number = 1) => ({ path: `/repos/acme/widget/pulls/42/files?per_page=100&page=${number}`, body });

test('fetches verified PR totals and splits test files', async (t) => {
  serve(t, [pr(), page(), pr()]);
  const result = await client().getPullRequestStats(42);
  assert.deepEqual(result.code, { additions: 5, deletions: 2 });
  assert.deepEqual(result.tests, { additions: 10, deletions: 1 });
  assert.deepEqual(result.total, { additions: 15, deletions: 3 });
});

test('includes files after the first page', async (t) => {
  const first = Array.from({ length: 100 }, (_, i) => ({ filename: `src/${i}.js`, additions: 1, deletions: 0 }));
  const meta = metadata({ changed_files: 101, additions: 110, deletions: 1 });
  serve(t, [pr(meta), page(first), page([files[1]], 2), pr(meta)]);
  const result = await client().getPullRequestStats(42);
  assert.deepEqual(result.code, { additions: 100, deletions: 0 });
  assert.deepEqual(result.tests, { additions: 10, deletions: 1 });
});

test('rejects truncated file lists and inconsistent totals', async (t) => {
  serve(t, [pr(), page([files[0]])]);
  await assert.rejects(client().getPullRequestStats(42), /incomplete/i);
});

test('rejects totals that do not match GitHub', async (t) => {
  serve(t, [pr(metadata({ additions: 100 })), page(), pr(metadata({ additions: 100 }))]);
  await assert.rejects(client().getPullRequestStats(42), /incomplete|match/i);
});

test('does not classify a PR beyond the API file limit', async (t) => {
  serve(t, [pr(metadata({ changed_files: 3001 }))]);
  await assert.rejects(client().getPullRequestStats(42), /3,?000|limit/i);
});

test('rejects PRs changed during pagination even when totals stay equal', async (t) => {
  serve(t, [pr(), page(), pr(metadata({ head: { sha: 'head-b' } }))]);
  await assert.rejects(client().getPullRequestStats(42), /changed/i);
});

test('rejects base updates during collection', async (t) => {
  serve(t, [pr(), page(), pr(metadata({ base: { sha: 'base-b' } }))]);
  await assert.rejects(client().getPullRequestStats(42), /changed/i);
});

test('propagates inaccessible repositories without returning zero counts', async (t) => {
  serve(t, [{ ...pr({ message: 'Not Found' }), status: 404 }]);
  await assert.rejects(client().getPullRequestStats(42));
});

test('treats HTTP 429 as a rate limit even without remaining header', async (t) => {
  serve(t, [{ ...pr({ message: 'Too many requests' }), status: 429, headers: { 'retry-after': '120' } }]);
  await assert.rejects(client().getPullRequestStats(42), RateLimitError);
});

test('empty PRs produce zero counts only after verification', async (t) => {
  const empty = metadata({ changed_files: 0, additions: 0, deletions: 0 });
  serve(t, [pr(empty), pr(empty)]);
  const result = await client().getPullRequestStats(42);
  assert.deepEqual(result.total, { additions: 0, deletions: 0 });
});
