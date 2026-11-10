import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectDocs,
  buildTree,
  sortTree,
  flattenTree,
  findNode,
  dirIndexDoc,
  prettifyName,
  displayDocTitle,
  DEFAULT_FOLDERS,
} from '../src/common/docs-model.js';

const blob = (path) => ({ path, type: 'blob', sha: `sha-${path}`, size: 100 });
const tree = (path) => ({ path, type: 'tree', sha: `sha-${path}` });

const OPTS = { folders: DEFAULT_FOLDERS, includeRootFiles: true, maxFiles: 500 };

test('collects root markdown files and conventional docs folders', () => {
  const entries = [
    blob('README.md'),
    blob('CONTRIBUTING.md'),
    blob('main.js'),
    tree('docs'),
    blob('docs/intro.md'),
    blob('docs/sub/deep.md'),
    blob('src/util.md'),
    blob('src/util.js'),
  ];
  const { docs, truncated, total } = collectDocs(entries, OPTS);
  const paths = docs.map((d) => d.path);
  assert.deepEqual(paths.sort(), ['CONTRIBUTING.md', 'README.md', 'docs/intro.md', 'docs/sub/deep.md']);
  assert.equal(truncated, false);
  assert.equal(total, 4);
});

test('respects includeRootFiles=false', () => {
  const { docs } = collectDocs([blob('README.md'), blob('docs/a.md')], { ...OPTS, includeRootFiles: false });
  assert.deepEqual(
    docs.map((d) => d.path),
    ['docs/a.md']
  );
});

test('matches docs folders at any depth and case-insensitively', () => {
  const entries = [blob('packages/a/docs/guide.md'), blob('DOCS/x.md'), blob('mydocs/y.md')];
  const { docs } = collectDocs(entries, OPTS);
  assert.deepEqual(
    docs.map((d) => d.path).sort(),
    ['DOCS/x.md', 'packages/a/docs/guide.md']
  );
});

test('matches multi-segment folder patterns as consecutive segments', () => {
  const entries = [blob('website/docs/intro.md'), blob('website/src/page.md'), blob('site/website/docs/a.md')];
  const { docs } = collectDocs(entries, { ...OPTS, folders: ['website/docs'], includeRootFiles: false });
  assert.deepEqual(
    docs.map((d) => d.path).sort(),
    ['site/website/docs/a.md', 'website/docs/intro.md']
  );
});

test('includes .github markdown', () => {
  const { docs } = collectDocs([blob('.github/PULL_REQUEST_TEMPLATE.md')], OPTS);
  assert.equal(docs.length, 1);
});

test('caps at maxFiles and reports truncation', () => {
  const entries = Array.from({ length: 10 }, (_, i) => blob(`docs/f${i}.md`));
  const { docs, truncated, total } = collectDocs(entries, { ...OPTS, maxFiles: 4 });
  assert.equal(docs.length, 4);
  assert.equal(truncated, true);
  assert.equal(total, 10);
});

test('DocFile shape', () => {
  const { docs } = collectDocs([blob('docs/getting-started.md')], OPTS);
  const d = docs[0];
  assert.equal(d.path, 'docs/getting-started.md');
  assert.equal(d.name, 'getting-started.md');
  assert.equal(d.dir, 'docs');
  assert.equal(d.title, 'getting-started');
  assert.equal(d.ext, '.md');
  assert.equal(d.sha, 'sha-docs/getting-started.md');
  assert.equal(d.size, 100);
});

test('prettifyName strips the extension only', () => {
  assert.equal(prettifyName('getting-started.md'), 'getting-started');
  assert.equal(prettifyName('README.md'), 'README');
});

test('buildTree nests folders', () => {
  const { docs } = collectDocs([blob('README.md'), blob('docs/a.md'), blob('docs/sub/b.md')], OPTS);
  const root = buildTree(docs);
  assert.equal(root.isDir, true);
  const names = root.children.map((c) => c.name);
  assert.ok(names.includes('README.md'));
  assert.ok(names.includes('docs'));
  const docsNode = root.children.find((c) => c.name === 'docs');
  assert.equal(docsNode.isDir, true);
  const sub = docsNode.children.find((c) => c.name === 'sub');
  assert.equal(sub.children[0].doc.path, 'docs/sub/b.md');
});

test('sortTree puts README/index first, then natural alpha with dirs interleaved', () => {
  const { docs } = collectDocs(
    [blob('zebra.md'), blob('README.md'), blob('beta.md'), blob('docs/10-later.md'), blob('docs/2-early.md'), blob('docs/index.md')],
    OPTS
  );
  const root = buildTree(docs);
  sortTree(root, new Map());
  assert.deepEqual(
    root.children.map((c) => c.name),
    ['README.md', 'beta.md', 'docs', 'zebra.md']
  );
  const docsNode = root.children.find((c) => c.name === 'docs');
  assert.deepEqual(
    docsNode.children.map((c) => c.name),
    ['index.md', '2-early.md', '10-later.md']
  );
});

test('sortTree honors frontmatter order/sidebar_position after README', () => {
  const { docs } = collectDocs([blob('docs/a.md'), blob('docs/b.md'), blob('docs/c.md'), blob('docs/README.md')], OPTS);
  const root = buildTree(docs);
  const meta = new Map([
    ['docs/b.md', { order: 1 }],
    ['docs/c.md', { sidebar_position: 2 }],
  ]);
  sortTree(root, meta);
  const docsNode = root.children.find((c) => c.name === 'docs');
  assert.deepEqual(
    docsNode.children.map((c) => c.name),
    ['README.md', 'b.md', 'c.md', 'a.md']
  );
});

test('flattenTree yields files in display order', () => {
  const { docs } = collectDocs([blob('README.md'), blob('docs/z.md'), blob('docs/a.md')], OPTS);
  const root = buildTree(docs);
  sortTree(root, new Map());
  assert.deepEqual(
    flattenTree(root).map((d) => d.path),
    ['README.md', 'docs/a.md', 'docs/z.md']
  );
});

test('findNode locates files and directories', () => {
  const { docs } = collectDocs([blob('docs/sub/b.md')], OPTS);
  const root = buildTree(docs);
  assert.equal(findNode(root, 'docs/sub/b.md').doc.path, 'docs/sub/b.md');
  assert.equal(findNode(root, 'docs/sub').isDir, true);
  assert.equal(findNode(root, 'nope'), null);
});

test('displayDocTitle: heading mode prefers frontmatter title, then headline, then filename', () => {
  const full = { fmTitle: 'Declared', headingTitle: 'Derived', fallback: 'file-name' };
  assert.equal(displayDocTitle(full, 'heading'), 'Declared');
  assert.equal(displayDocTitle({ ...full, fmTitle: null }, 'heading'), 'Derived');
  assert.equal(displayDocTitle({ fmTitle: null, headingTitle: null, fallback: 'file-name' }, 'heading'), 'file-name');
  assert.equal(displayDocTitle({ fmTitle: null, headingTitle: null, fallback: null }, 'heading'), '');
});

test('displayDocTitle: filename mode always shows the filename', () => {
  const full = { fmTitle: 'Declared', headingTitle: 'Derived', fallback: 'file-name' };
  assert.equal(displayDocTitle(full, 'filename'), 'file-name');
  assert.equal(displayDocTitle({ ...full, fallback: null }, 'filename'), 'Declared');
});

test('dirIndexDoc finds README or index inside a directory', () => {
  const { docs } = collectDocs([blob('docs/README.md'), blob('docs/a.md'), blob('guides/x.md')], OPTS);
  const root = buildTree(docs);
  assert.equal(dirIndexDoc(findNode(root, 'docs')).path, 'docs/README.md');
  assert.equal(dirIndexDoc(findNode(root, 'guides')), null);
});
