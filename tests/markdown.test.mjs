import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMarkdownIt, newRenderEnv } from '../src/content/markdown.js';

const ctx = {
  resolveWikiLink(raw) {
    if (raw.startsWith('Known')) {
      return { path: 'docs/known.md', anchor: raw.includes('#') ? 'some-sec' : null };
    }
    return null;
  },
  classifyHref(href) {
    if (/^https?:\/\//.test(href)) return { type: 'external', href };
    if (href.startsWith('#')) return { type: 'anchor', href, anchor: href.slice(1) };
    if (href.endsWith('.md')) return { type: 'doc', href: '#docs/docs/other.md', path: 'docs/other.md', anchor: null };
    return { type: 'plain', href };
  },
  imageUrl(src) {
    return 'https://raw.test/' + src;
  },
};

function render(src, path = 'docs/guide.md') {
  const md = createMarkdownIt(ctx);
  const env = newRenderEnv(path);
  return { html: md.render(src, env), env };
}

test('renders resolved wiki links', () => {
  const { html } = render('See [[Known Page]] here.');
  assert.match(html, /<a[^>]*class="gdt-wikilink"[^>]*>Known Page<\/a>/);
  assert.match(html, /data-gdt-path="docs\/known\.md"/);
  assert.match(html, /href="#docs\/docs\/known\.md"/);
});

test('wiki link with anchor and label', () => {
  const { html } = render('[[Known Page#Some Sec|click]]');
  assert.match(html, />click<\/a>/);
  assert.match(html, /href="#docs\/docs\/known\.md\?h=some-sec"/);
  assert.match(html, /data-gdt-anchor="some-sec"/);
});

test('same-file anchor wiki link', () => {
  const { html } = render('[[#My Sec]]');
  assert.match(html, /data-gdt-path="docs\/guide\.md"/);
  assert.match(html, /href="#docs\/docs\/guide\.md\?h=my-sec"/);
});

test('broken wiki links get a distinct class and keep the target', () => {
  const { html } = render('[[Nope]]');
  assert.match(html, /class="gdt-wikilink gdt-wikilink-broken"/);
  assert.match(html, /data-gdt-target="Nope"/);
});

test('wiki syntax inside inline code stays literal', () => {
  const { html } = render('Use `[[Nope]]` verbatim.');
  assert.match(html, /<code>\[\[Nope\]\]<\/code>/);
  assert.ok(!html.includes('gdt-wikilink'));
});

test('GitHub alerts become styled asides', () => {
  const { html } = render('> [!NOTE]\n> Something useful.');
  assert.match(html, /<div class="gdt-alert gdt-alert-note">/);
  assert.match(html, /<p class="gdt-alert-title">Note<\/p>/);
  assert.match(html, /Something useful\./);
});

test('plain blockquotes stay blockquotes', () => {
  const { html } = render('> Just quoting.');
  assert.match(html, /<blockquote>/);
  assert.ok(!html.includes('gdt-alert'));
});

test('task lists render disabled checkboxes', () => {
  const { html } = render('- [x] done thing\n- [ ] open thing');
  assert.match(html, /<li class="gdt-task"><input class="gdt-task-check" type="checkbox" disabled checked>\s*done thing/);
  assert.match(html, /<input class="gdt-task-check" type="checkbox" disabled>\s*open thing/);
});

test('headings get GitHub-style ids, permalinks, and toc entries', () => {
  const { html, env } = render('# Hello World\n\n## Hello World\n\ntext');
  assert.match(html, /<h1 id="hello-world">/);
  assert.match(html, /<h2 id="hello-world-1">/);
  assert.match(html, /class="gdt-anchor" href="#docs\/docs\/guide\.md\?h=hello-world"/);
  assert.deepEqual(env.toc, [
    { level: 1, text: 'Hello World', slug: 'hello-world' },
    { level: 2, text: 'Hello World', slug: 'hello-world-1' },
  ]);
});

test('slugger state does not leak across environments', () => {
  const a = render('# Same');
  const b = render('# Same');
  assert.match(a.html, /id="same"/);
  assert.match(b.html, /id="same"/);
});

test('fenced code is highlighted and escaped', () => {
  const { html } = render('```js\nif (a < b) { return "x"; }\n```');
  assert.match(html, /<code class="language-js">/);
  assert.match(html, /hljs-keyword/);
  assert.ok(!html.includes('if (a < b)'), 'raw < must be escaped');
  const unknown = render('```nosuchlang\na < b\n```').html;
  assert.match(unknown, /a &lt; b/);
  assert.ok(!unknown.includes('hljs-'));
});

test('code blocks carry a copy button', () => {
  const { html } = render('```js\nx\n```');
  assert.match(html, /<button class="gdt-copy"[^>]*data-gdt-copy/);
});

test('mermaid fences render as labeled source', () => {
  const { html } = render('```mermaid\ngraph TD; A-->B;\n```');
  assert.match(html, /gdt-mermaid/);
  assert.match(html, /A--&gt;B/);
});

test('relative markdown links are rewritten to internal routes', () => {
  const { html } = render('[other](./other.md)');
  assert.match(html, /<a[^>]*data-gdt-path="docs\/other\.md"[^>]*href="#docs\/docs\/other\.md"/);
});

test('external links open in a new tab', () => {
  const { html } = render('[ex](https://example.com) and https://bare.example.com');
  assert.match(html, /<a[^>]*href="https:\/\/example\.com"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  assert.match(html, /<a[^>]*href="https:\/\/bare\.example\.com"[^>]*target="_blank"/);
});

test('anchor-only links are tagged for in-page scrolling', () => {
  const { html } = render('[jump](#setup)');
  assert.match(html, /class="gdt-anchor-link"/);
  assert.match(html, /data-gdt-heading="setup"/);
});

test('image sources are rewritten', () => {
  const { html } = render('![alt text](img/shot.png)');
  assert.match(html, /<img[^>]*src="https:\/\/raw\.test\/img\/shot\.png"/);
  assert.match(html, /alt="alt text"/);
});

test('footnotes render', () => {
  const { html } = render('Text[^1]\n\n[^1]: The note.');
  assert.match(html, /footnote-ref/);
  assert.match(html, /The note\./);
});

test('raw HTML passes through the markdown stage (sanitized later)', () => {
  const { html } = render('<details><summary>More</summary>hidden</details>');
  assert.match(html, /<details><summary>More<\/summary>hidden<\/details>/);
});
