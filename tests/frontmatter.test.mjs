import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, normalizeTags, docTitle, isPinned } from '../src/common/frontmatter.js';

test('no frontmatter passes content through', () => {
  const src = '# Title\n\nBody.';
  const r = parseFrontmatter(src);
  assert.equal(r.data, null);
  assert.equal(r.content, src);
  assert.equal(r.raw, null);
});

test('parses scalars: strings, numbers, booleans, null', () => {
  const r = parseFrontmatter('---\ntitle: My Doc\ncount: 5\ndraft: false\nnothing: null\n---\nBody');
  assert.deepEqual(r.data, { title: 'My Doc', count: 5, draft: false, nothing: null });
  assert.equal(r.content, 'Body');
  assert.match(r.raw, /title: My Doc/);
});

test('parses quoted strings containing colons and hashes', () => {
  const r = parseFrontmatter('---\ntitle: "All: about #tags"\nsingle: \'a: b\'\n---\nx');
  assert.equal(r.data.title, 'All: about #tags');
  assert.equal(r.data.single, 'a: b');
});

test('keeps URLs intact but strips trailing comments', () => {
  const r = parseFrontmatter('---\nurl: https://ex.com/p#frag\ncount: 5 # five\n---\nx');
  assert.equal(r.data.url, 'https://ex.com/p#frag');
  assert.equal(r.data.count, 5);
});

test('parses inline arrays', () => {
  const r = parseFrontmatter('---\ntags: [docs, "getting started", 3]\n---\nx');
  assert.deepEqual(r.data.tags, ['docs', 'getting started', 3]);
});

test('parses dash lists', () => {
  const r = parseFrontmatter('---\ntags:\n  - alpha\n  - beta\n---\nx');
  assert.deepEqual(r.data.tags, ['alpha', 'beta']);
});

test('parses nested maps via indentation', () => {
  const r = parseFrontmatter('---\nauthor:\n  name: Ada\n  links:\n    site: https://ada.dev\n---\nx');
  assert.deepEqual(r.data.author, { name: 'Ada', links: { site: 'https://ada.dev' } });
});

test('ignores full-line comments and blank lines', () => {
  const r = parseFrontmatter('---\n# a comment\n\ntitle: T\n---\nx');
  assert.deepEqual(r.data, { title: 'T' });
});

test('handles CRLF and BOM', () => {
  const r = parseFrontmatter('﻿---\r\ntitle: T\r\n---\r\nBody\r\nMore');
  assert.equal(r.data.title, 'T');
  assert.equal(r.content, 'Body\r\nMore');
});

test('unterminated fence is treated as content', () => {
  const src = '---\ntitle: T\nBody without end';
  const r = parseFrontmatter(src);
  assert.equal(r.data, null);
  assert.equal(r.content, src);
});

test('empty frontmatter block yields empty object', () => {
  const r = parseFrontmatter('---\n---\nBody');
  assert.deepEqual(r.data, {});
  assert.equal(r.content, 'Body');
});

test('normalizeTags handles arrays, comma strings, and fallbacks', () => {
  assert.deepEqual(normalizeTags({ tags: ['A', 'b'] }), ['A', 'b']);
  assert.deepEqual(normalizeTags({ tags: 'a, b,  c' }), ['a', 'b', 'c']);
  assert.deepEqual(normalizeTags({ keywords: 'x y' }), ['x y']);
  assert.deepEqual(normalizeTags({ tags: ['a'], categories: ['a', 'guide'] }), ['a', 'guide']);
  assert.deepEqual(normalizeTags({}), []);
  assert.deepEqual(normalizeTags(null), []);
  assert.deepEqual(normalizeTags({ tags: [1, true, 'ok'] }), ['1', 'true', 'ok']);
});

test('isPinned recognizes pinned/pin frontmatter flags', () => {
  assert.equal(isPinned({ pinned: true }), true);
  assert.equal(isPinned({ pin: true }), true);
  assert.equal(isPinned({ pinned: 'true' }), true);
  assert.equal(isPinned({ pinned: 'yes' }), true);
  assert.equal(isPinned({ pinned: false }), false);
  assert.equal(isPinned({ pinned: 'no' }), false);
  assert.equal(isPinned({}), false);
  assert.equal(isPinned(null), false);
});

test('docTitle prefers frontmatter title, coerces non-strings', () => {
  assert.equal(docTitle({ title: 'Real' }, 'fallback'), 'Real');
  assert.equal(docTitle({ title: 3.14 }, 'fallback'), '3.14');
  assert.equal(docTitle({}, 'fallback'), 'fallback');
  assert.equal(docTitle(null, 'fallback'), 'fallback');
  assert.equal(docTitle({ title: '' }, 'fallback'), 'fallback');
});
