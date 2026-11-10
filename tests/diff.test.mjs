import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, buildUnifiedPatch } from '../src/common/diff.js';

test('diffLines: identical inputs produce only equal ops', () => {
  const ops = diffLines(['a', 'b'], ['a', 'b']);
  assert.deepEqual(ops, [
    { op: ' ', text: 'a' },
    { op: ' ', text: 'b' },
  ]);
});

test('diffLines: simple replace', () => {
  const ops = diffLines(['a', 'old', 'c'], ['a', 'new', 'c']);
  assert.deepEqual(
    ops.map((o) => o.op + o.text),
    [' a', '-old', '+new', ' c']
  );
});

test('diffLines: insertion and deletion at edges', () => {
  assert.deepEqual(
    diffLines(['b'], ['a', 'b']).map((o) => o.op + o.text),
    ['+a', ' b']
  );
  assert.deepEqual(
    diffLines(['a', 'b'], ['a']).map((o) => o.op + o.text),
    [' a', '-b']
  );
  assert.deepEqual(
    diffLines([], ['x']).map((o) => o.op + o.text),
    ['+x']
  );
  assert.deepEqual(
    diffLines(['x'], []).map((o) => o.op + o.text),
    ['-x']
  );
});

test('buildUnifiedPatch: no changes yields empty string', () => {
  assert.equal(buildUnifiedPatch('docs/a.md', 'same\n', 'same\n'), '');
});

test('buildUnifiedPatch: single hunk with headers and context', () => {
  const oldText = 'one\ntwo\nthree\nfour\nfive\n';
  const newText = 'one\ntwo\nTHREE\nfour\nfive\n';
  const patch = buildUnifiedPatch('docs/a.md', oldText, newText);
  assert.match(patch, /^diff --git a\/docs\/a\.md b\/docs\/a\.md\n--- a\/docs\/a\.md\n\+\+\+ b\/docs\/a\.md\n/);
  assert.match(patch, /@@ -1,5 \+1,5 @@\n one\n two\n-three\n\+THREE\n four\n five\n$/);
});

test('buildUnifiedPatch: distant changes produce separate hunks', () => {
  const oldLines = Array.from({ length: 30 }, (_, i) => `line${i + 1}`);
  const newLines = [...oldLines];
  newLines[1] = 'CHANGED-A';
  newLines[27] = 'CHANGED-B';
  const patch = buildUnifiedPatch('f.md', oldLines.join('\n') + '\n', newLines.join('\n') + '\n');
  const hunks = patch.split('\n').filter((l) => l.startsWith('@@'));
  assert.equal(hunks.length, 2);
  assert.match(hunks[0], /^@@ -1,5 \+1,5 @@$/);
  assert.match(hunks[1], /^@@ -25,6 \+25,6 @@$/);
});

test('buildUnifiedPatch: pure insertion at start', () => {
  const patch = buildUnifiedPatch('f.md', 'b\nc\n', 'a\nb\nc\n');
  assert.match(patch, /@@ -1,2 \+1,3 @@\n\+a\n b\n c\n$/);
});

test('buildUnifiedPatch: marks missing trailing newline on both sides', () => {
  const patch = buildUnifiedPatch('f.md', 'a\nend', 'a\nEND');
  assert.match(patch, /-end\n\\ No newline at end of file\n\+END\n\\ No newline at end of file\n$/);
});

test('buildUnifiedPatch: newline added at end of file', () => {
  const patch = buildUnifiedPatch('f.md', 'a\nend', 'a\nend\n');
  assert.match(patch, /-end\n\\ No newline at end of file\n\+end\n$/);
});
