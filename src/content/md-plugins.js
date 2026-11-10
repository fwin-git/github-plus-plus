// markdown-it plugins for the docs viewer. Node-safe (no DOM access):
// unit tests exercise these directly via createMarkdownIt.
import hljs from 'highlight.js/lib/common';
import { parseWikiTarget } from '../common/wikilinks.js';
import { githubSlug, createSlugger } from '../common/slugger.js';
import { buildHash } from '../common/route.js';

export function wikiLinkPlugin(md, ctx) {
  md.inline.ruler.before('link', 'gdt_wikilink', (state, silent) => {
    const { src, pos } = state;
    if (src.charCodeAt(pos) !== 0x5b /* [ */ || src.charCodeAt(pos + 1) !== 0x5b) return false;
    const end = src.indexOf(']]', pos + 2);
    if (end === -1) return false;
    const inner = src.slice(pos + 2, end);
    if (!inner || inner.includes('\n') || inner.includes('[[')) return false;
    if (!silent) {
      const env = state.env || {};
      const { target, anchor, label } = parseWikiTarget(inner);
      let resolved = null;
      if (!target && anchor) {
        resolved = env.currentPath ? { path: env.currentPath, anchor: githubSlug(anchor) } : null;
      } else if (target) {
        resolved = ctx.resolveWikiLink(anchor ? `${target}#${anchor}` : target, env.currentPath) || null;
      }
      const text = label ?? (target ? (anchor ? `${target}#${anchor}` : target) : `#${anchor ?? ''}`);
      const open = state.push('gdt_wikilink_open', 'a', 1);
      if (resolved) {
        open.attrs = [
          ['class', 'gdt-wikilink'],
          ['data-gdt-path', resolved.path],
        ];
        if (resolved.anchor) open.attrs.push(['data-gdt-anchor', resolved.anchor]);
        open.attrs.push(['href', buildHash({ path: resolved.path, heading: resolved.anchor })]);
      } else {
        open.attrs = [
          ['class', 'gdt-wikilink gdt-wikilink-broken'],
          ['data-gdt-target', inner.split('|')[0].trim()],
          ['href', '#'],
          ['title', 'Document not found — opens search'],
        ];
      }
      state.push('text', '', 0).content = text;
      state.push('gdt_wikilink_close', 'a', -1);
    }
    state.pos = end + 2;
    return true;
  });
}

const ALERT_RE = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\r?\n|$)/i;

export function alertsPlugin(md) {
  md.core.ruler.after('block', 'gdt_alerts', (state) => {
    const tokens = state.tokens;
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (tokens[i].type !== 'blockquote_open') continue;
      let j = i + 1;
      while (j < tokens.length && tokens[j].type !== 'inline' && tokens[j].type !== 'blockquote_close') j++;
      if (j >= tokens.length || tokens[j].type !== 'inline') continue;
      const m = ALERT_RE.exec(tokens[j].content);
      if (!m) continue;
      const type = m[1].toLowerCase();
      let depth = 1;
      let k = i + 1;
      for (; k < tokens.length; k++) {
        if (tokens[k].type === 'blockquote_open') depth++;
        else if (tokens[k].type === 'blockquote_close' && --depth === 0) break;
      }
      if (k >= tokens.length) continue;
      tokens[i].tag = 'div';
      tokens[i].attrJoin('class', `gdt-alert gdt-alert-${type}`);
      tokens[k].tag = 'div';
      tokens[j].content = tokens[j].content.replace(ALERT_RE, '');
      if (tokens[j].content === '') {
        tokens[j].hidden = true;
        if (tokens[j - 1] && tokens[j - 1].type === 'paragraph_open') tokens[j - 1].hidden = true;
        if (tokens[j + 1] && tokens[j + 1].type === 'paragraph_close') tokens[j + 1].hidden = true;
      }
      const title = new state.Token('html_block', '', 0);
      title.content = `<p class="gdt-alert-title">${type[0].toUpperCase()}${type.slice(1)}</p>\n`;
      title.block = true;
      tokens.splice(i + 1, 0, title);
    }
  });
}

const TASK_RE = /^\[( |x|X)\] /;

export function taskListPlugin(md) {
  md.core.ruler.after('inline', 'gdt_tasklist', (state) => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      if (tokens[i].type !== 'inline') continue;
      if (tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue;
      const first = tokens[i].children && tokens[i].children[0];
      if (!first || first.type !== 'text') continue;
      const m = TASK_RE.exec(first.content);
      if (!m) continue;
      first.content = first.content.slice(4);
      const box = new state.Token('html_inline', '', 0);
      box.content = `<input class="gdt-task-check" type="checkbox" disabled${m[1].toLowerCase() === 'x' ? ' checked' : ''}> `;
      tokens[i].children.unshift(box);
      tokens[i - 2].attrJoin('class', 'gdt-task');
    }
  });
}

export function headingAnchorPlugin(md) {
  md.core.ruler.after('inline', 'gdt_heading_anchors', (state) => {
    const env = state.env || {};
    env.slugger ??= createSlugger();
    env.toc ??= [];
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'heading_open') continue;
      const inline = tokens[i + 1];
      if (!inline || inline.type !== 'inline') continue;
      const text = (inline.children || [])
        .filter((t) => t.type === 'text' || t.type === 'code_inline')
        .map((t) => t.content)
        .join('');
      const slug = env.slugger.slug(text);
      tokens[i].attrSet('id', slug);
      env.toc.push({ level: Number(tokens[i].tag.slice(1)), text, slug });
      if (env.currentPath) {
        const a = new state.Token('html_inline', '', 0);
        a.content = `<a class="gdt-anchor" href="${buildHash({ path: env.currentPath, heading: slug })}" aria-label="Permalink: ${md.utils.escapeHtml(text)}"></a>`;
        inline.children.push(a);
      }
    }
  });
}

export function fencePlugin(md) {
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const lang = (token.info || '').trim().split(/\s+/)[0];
    const esc = md.utils.escapeHtml;
    if (lang === 'mermaid') {
      return (
        '<div class="gdt-mermaid"><div class="gdt-mermaid-label">Mermaid diagram source</div>' +
        `<pre class="gdt-code"><code class="language-mermaid">${esc(token.content)}</code></pre></div>\n`
      );
    }
    let inner = null;
    if (lang && hljs.getLanguage(lang)) {
      try {
        inner = hljs.highlight(token.content, { language: lang, ignoreIllegals: true }).value;
      } catch {
        inner = null;
      }
    }
    if (inner == null) inner = esc(token.content);
    const cls = lang ? ` class="language-${esc(lang)}"` : '';
    return (
      '<div class="gdt-codeblock">' +
      '<button class="gdt-copy" type="button" title="Copy" data-gdt-copy aria-label="Copy code"></button>' +
      `<pre class="gdt-code"><code${cls}>${inner}</code></pre></div>\n`
    );
  };
}

export function linkPlugin(md, ctx) {
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const href = token.attrGet('href') ?? '';
    const c = ctx.classifyHref(href, env && env.currentPath);
    if (c) {
      if (c.type === 'external') {
        if (c.href != null) token.attrSet('href', c.href);
        token.attrSet('target', '_blank');
        token.attrSet('rel', 'noopener noreferrer');
        token.attrJoin('class', 'gdt-external');
      } else if (c.type === 'doc' || c.type === 'dyn-doc') {
        const title = token.attrGet('title');
        token.attrs = [
          ['class', c.type === 'doc' ? 'gdt-internal' : 'gdt-internal gdt-dyn'],
          ['data-gdt-path', c.path],
        ];
        if (c.anchor) token.attrs.push(['data-gdt-anchor', c.anchor]);
        token.attrs.push(['href', c.href ?? '#']);
        if (title) token.attrs.push(['title', title]);
      } else if (c.type === 'anchor') {
        token.attrJoin('class', 'gdt-anchor-link');
        token.attrSet('data-gdt-heading', c.anchor ?? '');
      } else if (c.href != null && c.href !== href) {
        token.attrSet('href', c.href);
      }
    }
    return self.renderToken(tokens, idx, options);
  };
}

export function imagePlugin(md, ctx) {
  const defaultImage = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet('src') ?? '';
    token.attrSet('src', ctx.imageUrl(src, env && env.currentPath));
    token.attrJoin('class', 'gdt-img');
    return defaultImage(tokens, idx, options, env, self);
  };
}
