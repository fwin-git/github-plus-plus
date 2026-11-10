import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClient, RateLimitError } from '../src/content/github-api.js';

const client = () => makeClient({ owner: 'acme', repo: 'widget', token: 'test-token' });

test('counts open non-draft PRs and open drafts separately, beyond search item limits', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, '/search/issues');
    assert.equal(parsed.searchParams.get('per_page'), '1');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    const query = parsed.searchParams.get('q');
    assert.ok(['repo:acme/widget is:pr is:open draft:false', 'repo:acme/widget is:pr is:open draft:true'].includes(query));
    return new Response(JSON.stringify({ total_count: query.endsWith('false') ? 1200 : 26, incomplete_results: false, items: [] }));
  });
  assert.deepEqual(await client().getPullRequestCounts(), { open: 1200, drafts: 26, total: 1226 });
});

test('zero is a valid count for either category', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ total_count: 0, incomplete_results: false, items: [] })));
  assert.deepEqual(await client().getPullRequestCounts(), { open: 0, drafts: 0, total: 0 });
});

for (const body of [
  { total_count: 10, incomplete_results: true },
  { total_count: -1, incomplete_results: false },
  { total_count: '10', incomplete_results: false },
  { total_count: 1.5, incomplete_results: false },
  { total_count: 10 },
]) {
  test(`rejects incomplete or malformed PR counts: ${JSON.stringify(body)}`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body)));
    await assert.rejects(client().getPullRequestCounts(), /incomplete/i);
  });
}

test('does not publish half a result when the second category is rate limited', async (t) => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => ++requests === 1
    ? new Response(JSON.stringify({ total_count: 100, incomplete_results: false, items: [] }))
    : new Response('{}', { status: 429, headers: { 'retry-after': '120' } }));
  await assert.rejects(client().getPullRequestCounts(), RateLimitError);
});

test('forwards cancellation to the counts request', async (t) => {
  const controller = new AbortController();
  controller.abort();
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.signal, controller.signal);
    options.signal.throwIfAborted();
  });
  await assert.rejects(client().getPullRequestCounts({ signal: controller.signal }), { name: 'AbortError' });
});
