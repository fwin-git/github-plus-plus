import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mdToPlainText, extractHeadings, bestHeadingTitle } from '../src/common/md-text.js';

test('mdToPlainText strips markdown syntax but keeps readable text', () => {
  const src = [
    '# Title',
    '',
    'Some **bold** and _em_ text with `code`.',
    '',
    '```js',
    'const x = 1;',
    '```',
    '',
    '> quoted line',
    '',
    '- [x] task item',
    '',
    '[label](https://x.y) and ![alt](img.png) and [[Wiki|Shown]] and [[Plain]]',
  ].join('\n');
  const out = mdToPlainText(src);
  assert.ok(out.includes('Title'));
  assert.ok(out.includes('Some bold and em text with code.'));
  assert.ok(out.includes('const x = 1;'));
  assert.ok(out.includes('quoted line'));
  assert.ok(out.includes('task item'));
  assert.ok(out.includes('label'));
  assert.ok(out.includes('alt'));
  assert.ok(out.includes('Shown'));
  assert.ok(out.includes('Plain'));
  assert.ok(!out.includes('**'));
  assert.ok(!out.includes('](')); // link syntax gone
  assert.ok(!out.includes('```'));
  assert.ok(!out.includes('[['));
});

test('bestHeadingTitle picks the first heading of the highest level present', () => {
  assert.equal(bestHeadingTitle('## Sub\n\ntext\n\n# Main\n\n## Other'), 'Main');
  assert.equal(bestHeadingTitle('### Deep\n\n## Two\n\n### More\n\n## Later'), 'Two');
  assert.equal(bestHeadingTitle('#### Only'), 'Only');
  assert.equal(bestHeadingTitle('no headings here'), null);
  assert.equal(bestHeadingTitle(''), null);
});

test('bestHeadingTitle ignores headings inside code fences', () => {
  assert.equal(bestHeadingTitle('```\n# fenced\n```\n\n## Real'), 'Real');
});

test('bestHeadingTitle supports setext headings', () => {
  assert.equal(bestHeadingTitle('My Title\n========\n\n## Sub'), 'My Title');
  assert.equal(bestHeadingTitle('Sub Title\n---------\n\n### Deep'), 'Sub Title');
});

test('bestHeadingTitle strips inline markdown', () => {
  assert.equal(bestHeadingTitle('# **Bold** `code` [link](https://x.y)'), 'Bold code link');
  assert.equal(bestHeadingTitle('# Title with *em*'), 'Title with em');
});

test('extractHeadings returns heading texts in order', () => {
  const src = '# One\n\ntext\n\n## Two `code`\n\n```md\n# not a heading\n```\n\n### Three\n';
  assert.deepEqual(extractHeadings(src), ['One', 'Two code', 'Three']);
});
