import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWikiTarget, buildResolver } from '../src/common/wikilinks.js';

test('parseWikiTarget forms', () => {
  assert.deepEqual(parseWikiTarget('Page'), { target: 'Page', anchor: null, label: null });
  assert.deepEqual(parseWikiTarget('Page#Sec'), { target: 'Page', anchor: 'Sec', label: null });
  assert.deepEqual(parseWikiTarget('Page|Nice'), { target: 'Page', anchor: null, label: 'Nice' });
  assert.deepEqual(parseWikiTarget('Page#Sec|Nice'), { target: 'Page', anchor: 'Sec', label: 'Nice' });
  assert.deepEqual(parseWikiTarget('#Sec'), { target: '', anchor: 'Sec', label: null });
  assert.deepEqual(parseWikiTarget('a|b|c'), { target: 'a', anchor: null, label: 'b|c' });
});

const docs = [
  { path: 'README.md' },
  { path: 'docs/setup.md' },
  { path: 'docs/deep/nested/setup.md' },
  { path: 'docs/getting-started.md' },
  { path: 'docs/api/index.md' },
  { path: 'guides/deploy_notes.md' },
];

function resolver(meta = new Map()) {
  return buildResolver(docs, meta);
}

test('resolves exact paths with and without extension', () => {
  const r = resolver();
  assert.equal(r.resolve('docs/setup.md', '').path, 'docs/setup.md');
  assert.equal(r.resolve('docs/setup', '').path, 'docs/setup.md');
});

test('resolves by basename, case- and separator-insensitive', () => {
  const r = resolver();
  assert.equal(r.resolve('Getting Started', '').path, 'docs/getting-started.md');
  assert.equal(r.resolve('getting_started', '').path, 'docs/getting-started.md');
  assert.equal(r.resolve('Deploy Notes', '').path, 'guides/deploy_notes.md');
});

test('resolves by path suffix', () => {
  const r = resolver();
  assert.equal(r.resolve('api/index', '').path, 'docs/api/index.md');
});

test('resolves by frontmatter title', () => {
  const meta = new Map([['docs/getting-started.md', { title: 'Installation Guide' }]]);
  const r = resolver(meta);
  assert.equal(r.resolve('Installation Guide', '').path, 'docs/getting-started.md');
  assert.equal(r.resolve('installation-guide', '').path, 'docs/getting-started.md');
});

test('prefers same directory, then shortest path on ambiguity', () => {
  const r = resolver();
  assert.equal(r.resolve('setup', 'docs/deep/nested/other.md').path, 'docs/deep/nested/setup.md');
  assert.equal(r.resolve('setup', 'README.md').path, 'docs/setup.md');
});

test('passes through slugged anchors', () => {
  const r = resolver();
  const res = r.resolve('docs/setup#Install Steps', '');
  assert.equal(res.path, 'docs/setup.md');
  assert.equal(res.anchor, 'install-steps');
});

test('unresolvable targets return null', () => {
  const r = resolver();
  assert.equal(r.resolve('Nonexistent Page', ''), null);
  assert.equal(r.resolve('', 'docs/setup.md'), null);
});
