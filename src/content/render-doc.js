// Browser-side rendering: frontmatter split -> markdown-it -> DOMPurify ->
// DOM post-pass. Everything inserted into github.com MUST go through here.
import DOMPurify from 'dompurify';
import { parseFrontmatter } from '../common/frontmatter.js';
import { newRenderEnv } from './markdown.js';

const SANITIZE_CONFIG = {
  FORBID_TAGS: ['style', 'form', 'dialog'],
  FORBID_ATTR: ['style'],
  ADD_ATTR: ['target'],
};

let hooked = false;
function ensureHooks() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('target') === '_blank' && !node.hasAttribute('rel')) {
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

export function renderDoc(md, source, { path, ctx }) {
  ensureHooks();
  const { data, content, raw } = parseFrontmatter(source);
  const env = newRenderEnv(path);
  const html = md.render(content, env);
  const clean = DOMPurify.sanitize(html, SANITIZE_CONFIG);
  const tpl = document.createElement('template');
  tpl.innerHTML = clean;
  postProcess(tpl.content, path, ctx);
  return { fragment: tpl.content, toc: env.toc, meta: data, rawFrontmatter: raw };
}

function postProcess(fragment, path, ctx) {
  // Raw-HTML links authored inside markdown bypass the markdown-it rules;
  // classify them here so navigation stays inside the viewer.
  for (const a of fragment.querySelectorAll('a[href]')) {
    if (
      a.classList.contains('gdt-anchor') ||
      a.classList.contains('gdt-wikilink') ||
      a.hasAttribute('data-gdt-path') ||
      a.hasAttribute('data-gdt-heading') ||
      a.classList.contains('footnote-backref') ||
      a.classList.contains('gdt-external')
    ) {
      continue;
    }
    const href = a.getAttribute('href') ?? '';
    const c = ctx.classifyHref(href, path);
    if (!c) continue;
    if (c.type === 'external') {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
      a.classList.add('gdt-external');
    } else if (c.type === 'doc' || c.type === 'dyn-doc') {
      a.classList.add('gdt-internal');
      a.setAttribute('data-gdt-path', c.path);
      if (c.anchor) a.setAttribute('data-gdt-anchor', c.anchor);
      if (c.href) a.setAttribute('href', c.href);
    } else if (c.type === 'anchor') {
      a.classList.add('gdt-anchor-link');
      a.setAttribute('data-gdt-heading', c.anchor ?? '');
    } else if (c.type === 'repo-file' && c.href) {
      a.setAttribute('href', c.href);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  }

  for (const img of fragment.querySelectorAll('img')) {
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
    const src = img.getAttribute('src') ?? '';
    if (src && !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) {
      img.setAttribute('src', ctx.imageUrl(src, path));
    }
  }

  for (const table of fragment.querySelectorAll('table')) {
    if (table.parentElement && table.parentElement.classList.contains('gdt-table-wrap')) continue;
    const wrap = document.createElement('div');
    wrap.className = 'gdt-table-wrap';
    table.replaceWith(wrap);
    wrap.appendChild(table);
  }

  // User-authored checkboxes must never mutate real state.
  for (const input of fragment.querySelectorAll('input')) {
    input.setAttribute('disabled', '');
  }
}
