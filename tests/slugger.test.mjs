import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubSlug, createSlugger } from '../src/common/slugger.js';

test('lowercases and hyphenates spaces', () => {
  assert.equal(githubSlug('Hello World'), 'hello-world');
});

test('strips punctuation like GitHub', () => {
  assert.equal(githubSlug('Hello, World!'), 'hello-world');
  assert.equal(githubSlug("What's new?"), 'whats-new');
  assert.equal(githubSlug('C++ & Rust'), 'c--rust');
  assert.equal(githubSlug('2. Setup'), '2-setup');
});

test('keeps underscores and existing hyphens', () => {
  assert.equal(githubSlug('foo_bar'), 'foo_bar');
  assert.equal(githubSlug('already-hyphenated'), 'already-hyphenated');
});

test('keeps unicode letters', () => {
  assert.equal(githubSlug('Überblick Änderungen'), 'überblick-änderungen');
});

test('strips emoji (GitHub keeps resulting leading hyphen)', () => {
  assert.equal(githubSlug('🎉 Party'), '-party');
});

test('createSlugger dedupes with numeric suffixes', () => {
  const s = createSlugger();
  assert.equal(s.slug('Intro'), 'intro');
  assert.equal(s.slug('Intro'), 'intro-1');
  assert.equal(s.slug('Intro'), 'intro-2');
  assert.equal(s.slug('Other'), 'other');
});
