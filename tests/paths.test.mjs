import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePath,
  resolveRelative,
  dirname,
  basename,
  stripExt,
  extname,
  isMarkdownPath,
  splitAnchor,
  encodePath,
} from '../src/common/paths.js';

test('normalizePath collapses dot segments', () => {
  assert.equal(normalizePath('a/./b/../c.md'), 'a/c.md');
  assert.equal(normalizePath('./a.md'), 'a.md');
  assert.equal(normalizePath('a//b.md'), 'a/b.md');
  assert.equal(normalizePath('/rooted/x.md'), 'rooted/x.md');
  assert.equal(normalizePath('a/b/'), 'a/b');
});

test('normalizePath returns null when escaping the root', () => {
  assert.equal(normalizePath('../x.md'), null);
  assert.equal(normalizePath('a/../../x.md'), null);
});

test('resolveRelative resolves against the containing directory', () => {
  assert.equal(resolveRelative('docs/guide/setup.md', './install.md'), 'docs/guide/install.md');
  assert.equal(resolveRelative('docs/guide/setup.md', '../intro.md'), 'docs/intro.md');
  assert.equal(resolveRelative('docs/guide/setup.md', 'deep/more.md'), 'docs/guide/deep/more.md');
  assert.equal(resolveRelative('README.md', 'docs/a.md'), 'docs/a.md');
  assert.equal(resolveRelative('docs/a.md', '/CONTRIBUTING.md'), 'CONTRIBUTING.md');
});

test('resolveRelative decodes percent-escapes', () => {
  assert.equal(resolveRelative('docs/a.md', 'my%20doc.md'), 'docs/my doc.md');
  assert.equal(resolveRelative('docs/a.md', 'weird%2520.md'), 'docs/weird%20.md');
});

test('resolveRelative returns null when escaping the repo root', () => {
  assert.equal(resolveRelative('README.md', '../outside.md'), null);
});

test('splitAnchor separates fragment', () => {
  assert.deepEqual(splitAnchor('a.md#section-1'), { path: 'a.md', anchor: 'section-1' });
  assert.deepEqual(splitAnchor('a.md'), { path: 'a.md', anchor: null });
  assert.deepEqual(splitAnchor('#only'), { path: '', anchor: 'only' });
});

test('isMarkdownPath matches markdown extensions case-insensitively', () => {
  for (const p of ['a.md', 'B.MD', 'x/y.mdx', 'z.markdown', 'w.mdown']) {
    assert.equal(isMarkdownPath(p), true, p);
  }
  for (const p of ['a.txt', 'README', 'x.markdownx', 'y.mda']) {
    assert.equal(isMarkdownPath(p), false, p);
  }
});

test('path part helpers', () => {
  assert.equal(dirname('a/b/c.md'), 'a/b');
  assert.equal(dirname('c.md'), '');
  assert.equal(basename('a/b/c.md'), 'c.md');
  assert.equal(basename('c.md'), 'c.md');
  assert.equal(stripExt('guide.md'), 'guide');
  assert.equal(stripExt('a/b.mdx'), 'a/b');
  assert.equal(stripExt('no-ext'), 'no-ext');
  assert.equal(extname('a/B.MD'), '.md');
  assert.equal(extname('noext'), '');
});

test('encodePath encodes segments but keeps slashes', () => {
  assert.equal(encodePath('a b/c#d.md'), 'a%20b/c%23d.md');
  assert.equal(encodePath('plain/path.md'), 'plain/path.md');
  assert.equal(encodePath('100%/x.md'), '100%25/x.md');
});
