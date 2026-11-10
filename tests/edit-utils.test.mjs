import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultCommitMessage, branchNameFor, editPageUrl, toBase64Utf8 } from '../src/common/edit-utils.js';

test('defaultCommitMessage names the file', () => {
  assert.equal(defaultCommitMessage('docs/guide/setup.md'), 'docs: update setup.md');
  assert.equal(defaultCommitMessage('README.md'), 'docs: update README.md');
});

test('branchNameFor builds a safe slugged branch', () => {
  assert.equal(branchNameFor('docs/My File Name.md', 'abc123'), 'docs-tab/my-file-name-abc123');
  assert.equal(branchNameFor('docs/Ünïcode & stuff.mdx', 'x1'), 'docs-tab/ünïcode--stuff-x1');
  assert.ok(!branchNameFor('a b/c d.md', 'r').includes(' '));
});

test('editPageUrl is root-relative (same-origin on github.com and in the harness)', () => {
  assert.equal(editPageUrl('acme', 'widget', 'main', 'docs/my file.md'), '/acme/widget/edit/main/docs/my%20file.md');
});

test('toBase64Utf8 round-trips unicode', () => {
  const b64 = toBase64Utf8('héllo → wörld\n');
  assert.equal(Buffer.from(b64, 'base64').toString('utf8'), 'héllo → wörld\n');
  assert.equal(toBase64Utf8(''), '');
});
