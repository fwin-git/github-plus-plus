import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, buildHash } from '../src/common/route.js';

test('non-docs hashes yield null', () => {
  assert.equal(parseHash(''), null);
  assert.equal(parseHash('#readme'), null);
  assert.equal(parseHash('#docsify'), null);
  assert.equal(parseHash('#L10'), null);
});

test('index route', () => {
  assert.deepEqual(parseHash('#docs'), { path: null, heading: null });
  assert.deepEqual(parseHash('#docs/'), { path: null, heading: null });
  assert.deepEqual(parseHash('docs'), { path: null, heading: null });
});

test('file route with and without heading', () => {
  assert.deepEqual(parseHash('#docs/README.md'), { path: 'README.md', heading: null });
  assert.deepEqual(parseHash('#docs/guide/setup.md?h=install-steps'), {
    path: 'guide/setup.md',
    heading: 'install-steps',
  });
});

test('round-trips encoded characters', () => {
  const route = { path: 'my docs/a b.md', heading: null };
  const h = buildHash(route);
  assert.equal(h, '#docs/my%20docs/a%20b.md');
  assert.deepEqual(parseHash(h), route);

  const tricky = { path: 'notes/a#1.md', heading: 'x-y' };
  assert.deepEqual(parseHash(buildHash(tricky)), tricky);
});

test('buildHash for index', () => {
  assert.equal(buildHash({ path: null, heading: null }), '#docs');
  assert.equal(buildHash({}), '#docs');
});
