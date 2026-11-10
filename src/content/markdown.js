// Markdown pipeline factory. Node-safe: DOM-dependent sanitization lives in
// render-doc.js; tests exercise this module directly.
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import { createSlugger } from '../common/slugger.js';
import {
  wikiLinkPlugin,
  alertsPlugin,
  taskListPlugin,
  headingAnchorPlugin,
  fencePlugin,
  linkPlugin,
  imagePlugin,
} from './md-plugins.js';

// ctx contract:
//   resolveWikiLink(rawTarget, currentPath) -> {path, anchor}|null
//   classifyHref(href, currentPath) -> {type, href?, path?, anchor?}|null
//     type: 'external'|'doc'|'dyn-doc'|'repo-file'|'anchor'|'plain'
//   imageUrl(src, currentPath) -> string
export function createMarkdownIt(ctx) {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
  md.use(footnote);
  wikiLinkPlugin(md, ctx);
  alertsPlugin(md);
  taskListPlugin(md);
  headingAnchorPlugin(md);
  fencePlugin(md);
  linkPlugin(md, ctx);
  imagePlugin(md, ctx);
  return md;
}

export function newRenderEnv(currentPath) {
  return { currentPath, slugger: createSlugger(), toc: [] };
}
