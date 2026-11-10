import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyScore, parseQuery, searchFiles, ContentIndex } from '../src/common/search.js';

test('fuzzyScore rejects non-subsequences', () => {
  assert.equal(fuzzyScore('xyz', 'abc'), -Infinity);
  assert.equal(fuzzyScore('abcd', 'abc'), -Infinity);
});

test('fuzzyScore favors word starts and consecutive runs', () => {
  const wordStarts = fuzzyScore('gsg', 'getting-started-guide.md');
  const scattered = fuzzyScore('gsg', 'game-shop-warning.md');
  assert.ok(wordStarts > scattered, `${wordStarts} > ${scattered}`);
  const consecutive = fuzzyScore('set', 'setup.md');
  const spread = fuzzyScore('set', 's-e-t-random.md');
  assert.ok(consecutive > spread);
});

test('empty query matches everything with zero score', () => {
  assert.equal(fuzzyScore('', 'anything'), 0);
});

test('parseQuery splits terms, phrases, and tags', () => {
  assert.deepEqual(parseQuery('Hello "Exact Phrase" tag:API tag:cli world'), {
    terms: ['hello', 'world'],
    phrases: ['exact phrase'],
    tags: ['api', 'cli'],
  });
  assert.deepEqual(parseQuery(''), { terms: [], phrases: [], tags: [] });
});

test('searchFiles ranks filename fuzzy matches', () => {
  const docs = [
    { path: 'docs/getting-started-guide.md', title: 'getting-started-guide' },
    { path: 'docs/misc.md', title: 'misc' },
    { path: 'CHANGELOG.md', title: 'CHANGELOG' },
  ];
  const results = searchFiles(docs, new Map(), 'gsg');
  assert.equal(results[0].doc.path, 'docs/getting-started-guide.md');
  assert.ok(!results.some((r) => r.doc.path === 'docs/misc.md'));
});

test('searchFiles filters by tag from metadata', () => {
  const docs = [
    { path: 'a.md', title: 'a' },
    { path: 'b.md', title: 'b' },
  ];
  const meta = new Map([['a.md', { tags: ['API'] }]]);
  const results = searchFiles(docs, meta, 'tag:api');
  assert.deepEqual(
    results.map((r) => r.doc.path),
    ['a.md']
  );
});

function makeIndex() {
  const idx = new ContentIndex();
  idx.add('docs/install.md', {
    title: 'Installation',
    text: 'How to install the tool. Run the installer and follow the install steps carefully.',
    headings: ['Prerequisites', 'Install Steps'],
    tags: ['setup'],
  });
  idx.add('docs/usage.md', {
    title: 'Usage',
    text: 'Using the CLI after you install it. The install command is covered elsewhere.',
    headings: ['Basics'],
    tags: ['guide'],
  });
  idx.add('docs/faq.md', {
    title: 'FAQ',
    text: 'Frequently asked questions about everything.',
    headings: [],
    tags: [],
  });
  return idx;
}

test('ContentIndex finds body matches with highlighted snippets', () => {
  const idx = makeIndex();
  const results = idx.search(parseQuery('installer'), { limit: 10 });
  assert.equal(results.length, 1);
  const r = results[0];
  assert.equal(r.path, 'docs/install.md');
  assert.ok(r.snippet.text.toLowerCase().includes('installer'));
  const [s, e] = r.snippet.ranges[0];
  assert.equal(r.snippet.text.slice(s, e).toLowerCase(), 'installer');
});

test('heading matches outrank body-only matches', () => {
  const idx = makeIndex();
  const results = idx.search(parseQuery('install'), { limit: 10 });
  assert.equal(results[0].path, 'docs/install.md');
  assert.ok(results.some((r) => r.path === 'docs/usage.md'));
});

test('multiple terms are AND-ed', () => {
  const idx = makeIndex();
  const results = idx.search(parseQuery('install cli'), { limit: 10 });
  assert.deepEqual(
    results.map((r) => r.path),
    ['docs/usage.md']
  );
});

test('quoted phrases must match exactly', () => {
  const idx = makeIndex();
  const results = idx.search(parseQuery('"install steps"'), { limit: 10 });
  assert.deepEqual(
    results.map((r) => r.path),
    ['docs/install.md']
  );
});

test('tag filter narrows content results', () => {
  const idx = makeIndex();
  const results = idx.search(parseQuery('tag:setup install'), { limit: 10 });
  assert.deepEqual(
    results.map((r) => r.path),
    ['docs/install.md']
  );
});

test('tag-only queries list tagged docs', () => {
  const idx = makeIndex();
  const results = idx.search(parseQuery('tag:guide'), { limit: 10 });
  assert.deepEqual(
    results.map((r) => r.path),
    ['docs/usage.md']
  );
});

test('heading matches expose the matched heading text', () => {
  const idx = makeIndex();
  const results = idx.search(parseQuery('prerequisites'), { limit: 10 });
  assert.equal(results[0].path, 'docs/install.md');
  assert.equal(results[0].matchedHeading, 'Prerequisites');
  const body = idx.search(parseQuery('installer'), { limit: 10 });
  assert.equal(body[0].matchedHeading, null);
});

test('merge() folds another index in, keeping both sets searchable', () => {
  const a = new ContentIndex();
  a.add('r1 doc.md', { title: 'Alpha', text: 'alpha content', headings: [], tags: ['x'] });
  const b = new ContentIndex();
  b.add('r2 other.md', { title: 'Beta', text: 'beta zorblax content', headings: [], tags: ['y'] });
  a.merge(b);
  assert.equal(a.size, 2);
  assert.equal(a.search(parseQuery('zorblax'), { limit: 5 })[0].path, 'r2 other.md');
  assert.equal(a.search(parseQuery('alpha'), { limit: 5 })[0].path, 'r1 doc.md');
  assert.equal(a.allTags().get('y'), 1);
});

test('allTags aggregates counts; remove() drops entries', () => {
  const idx = makeIndex();
  assert.equal(idx.allTags().get('setup'), 1);
  assert.equal(idx.size, 3);
  idx.remove('docs/install.md');
  assert.equal(idx.size, 2);
  assert.equal(idx.search(parseQuery('installer'), { limit: 10 }).length, 0);
  assert.equal(idx.allTags().get('setup'), undefined);
});
